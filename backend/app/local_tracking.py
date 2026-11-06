"""Local MLflow adapter. Runs own execution; tracking cannot change their outcome.

Training telemetry is journaled inside each run and ingested into a separate
MLflow SQLite store. Run IDs and Idea links always originate in EasyRef.
"""
import importlib.metadata
import json
import math
import os
import re
import threading
import time
from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request
from .local_store import atomic_write, digest, encode, file_hash, inside, now, uid

TERMINAL = {'completed', 'failed', 'cancelled', 'interrupted'}


def milliseconds(value):
    return int(datetime.fromisoformat(value).timestamp() * 1000) if value else int(time.time() * 1000)


def thin_points(points, limit=400):
    """Retain endpoints and actual min/max observations per time/step bucket."""
    if len(points) <= limit:
        return points
    output = [points[0]]
    buckets = (limit - 2) // 2
    for index in range(buckets):
        start = 1 + index * (len(points) - 2) // buckets
        end = 1 + (index + 1) * (len(points) - 2) // buckets
        chunk = list(enumerate(points[start:end], start))
        selected = {min(chunk, key=lambda x: x[1]['value'])[0], max(chunk, key=lambda x: x[1]['value'])[0]}
        output.extend(points[i] for i in sorted(selected))
    return output + [points[-1]]


class ExperimentTracking:
    def __init__(self, store):
        self.store = store
        self.directory = store.root / 'mlflow'
        self.uri = 'sqlite:///' + (self.directory / 'tracking.db').as_posix()
        self.lock = threading.RLock()
        self._client = None
        self._store_id = None
        self.interval = 2.0

    def status(self):
        try:
            version = importlib.metadata.version('mlflow-skinny')
        except importlib.metadata.PackageNotFoundError:
            return {'engine': 'MLflow', 'available': False, 'message': '尚未安装实验监控依赖，请安装 requirements-local.txt'}
        return {'engine': 'MLflow', 'available': True, 'version': version, 'mode': 'local',
                'message': '本地记录 · 随运行自动采集', 'interval_seconds': self.interval}

    @property
    def store_id(self):
        with self.lock:
            if self._store_id is None:
                self.directory.mkdir(parents=True, exist_ok=True)
                identity = self.directory / 'store-id'
                if not identity.exists(): atomic_write(identity, uid())
                self._store_id = identity.read_text('utf8').strip()
            return self._store_id

    @property
    def client(self):
        with self.lock:
            if self._client is None:
                from mlflow import MlflowClient
                self.directory.mkdir(parents=True, exist_ok=True)
                self._client = MlflowClient(tracking_uri=self.uri)
            return self._client

    def run(self, pid, ident):
        return self.store.one('SELECT * FROM experiments WHERE project_id=? AND id=?', (pid, ident), True)

    def record(self, ident):
        row = self.store.one('SELECT * FROM experiment_tracking WHERE id=?', (ident,))
        return row['data'] if row else {}

    def save(self, run, data):
        self.store.execute('INSERT INTO experiment_tracking VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json,updated_at=excluded.updated_at',
                           (run['id'], run['project_id'], encode(data), now()))

    def paths(self, run):
        root = Path(self.store.project(run['project_id'])['root_path'])
        return inside(root, '.easyref/runs/' + run['id'])

    def ensure(self, run, historical=False):
        with self.lock:
            data = self.record(run['id'])
            if data.get('store_id') == self.store_id and data.get('mlflow_run_id'):
                # A copied DB or a removed MLflow run must never attach to another run.
                tracked = self.client.get_run(data['mlflow_run_id'])
                if tracked.data.tags.get('easyref.run_id') != run['id']:
                    raise ValueError('MLflow 运行关联不匹配')
                return data
            project = self.store.project(run['project_id'])
            name = 'easyref-' + run['project_id']
            experiment = self.client.get_experiment_by_name(name)
            experiment_id = experiment.experiment_id if experiment else self.client.create_experiment(
                name, artifact_location=(self.directory / 'artifacts' / run['project_id']).as_uri(),
                tags={'easyref.project_name': project['name']})
            versions = self.store.all('SELECT v.id,v.number,v.idea_id FROM idea_version_runs l JOIN idea_versions v ON v.id=l.version_id WHERE l.experiment_id=?', (run['id'],))
            tags = {'easyref.run_id': run['id'], 'easyref.project_id': run['project_id'],
                    'easyref.idea_version_ids': encode([v['id'] for v in versions]),
                    'easyref.idea_versions': ','.join('V' + str(v['number']) for v in versions),
                    'easyref.origin': 'historical' if historical else 'live',
                    'easyref.test_data': str(bool(run['environment'].get('test_data'))).lower(),
                    'mlflow.source.git.commit': run['git_commit'] or '', 'mlflow.note.content': run['purpose']}
            tracked = self.client.create_run(experiment_id, start_time=milliseconds(run['started_at'] or run['created_at']), tags=tags, run_name=run['name'])
            data = {'store_id': self.store_id, 'mlflow_run_id': tracked.info.run_id, 'mlflow_experiment_id': experiment_id,
                    'origin': 'historical' if historical else 'live', 'offsets': {}, 'error': '', 'warnings': [], 'last_synced_at': None}
            self.save(run, data)  # Persist identity before logging; retries reuse the same run.
            return data

    def parameters(self, run, data):
        from mlflow.entities import Param
        if data.get('parameters_logged'): return
        values = {k: v for k, v in run['config'].items() if k != 'hyperparameters'}
        values.update({'hyperparameters.' + k: v for k, v in run['config'].get('hyperparameters', {}).items()})
        params = [Param(k[:200], (v if isinstance(v, str) else encode(v))[:5000]) for k, v in values.items()]
        for index in range(0, len(params), 100):
            self.client.log_batch(data['mlflow_run_id'], params=params[index:index + 100], synchronous=True)
        data['parameters_logged'] = True

    def journal_paths(self, run):
        directory = self.paths(run) / 'events'
        paths = list(directory.glob('*.jsonl')) if directory.exists() else []
        # Portable project restore relocates registered artifacts; replay these too.
        artifacts = self.store.all("SELECT path FROM experiment_artifacts WHERE experiment_id=? AND kind='telemetry'", (run['id'],))
        root = Path(self.store.project(run['project_id'])['root_path'])
        for item in artifacts:
            path = inside(root, item['path'])
            if path.is_file() and path not in paths: paths.append(path)
        return paths

    def ingest(self, run, data):
        from mlflow.entities import Metric
        for path in self.journal_paths(run):
            root = Path(self.store.project(run['project_id'])['root_path'])
            path = inside(root, str(path), True)
            key = path.relative_to(root).as_posix()
            offset = data['offsets'].get(key, 0)
            if path.stat().st_size < offset: raise ValueError('监控日志被截断；已保留此前记录')
            points, invalid = [], 0
            with path.open('rb') as stream:
                stream.seek(offset)
                count = 0
                while count < 2000 or run['status'] in TERMINAL:
                    count += 1
                    start = stream.tell(); line = stream.readline(65537)
                    if not line: break
                    if not line.endswith(b'\n'):
                        if len(line) > 65536: raise ValueError('单条监控记录过大')
                        stream.seek(start); break  # Another process is still writing.
                    try:
                        entry = json.loads(line)
                        step, stamp, values = entry['step'], entry['timestamp'], entry['metrics']
                        if not isinstance(step, int) or isinstance(step, bool) or step < 0: raise ValueError()
                        if not isinstance(stamp, int) or isinstance(stamp, bool) or stamp <= 0: raise ValueError()
                        if not isinstance(values, dict) or not 1 <= len(values) <= 100: raise ValueError()
                        batch = []
                        for name, value in values.items():
                            if not re.fullmatch(r'[\w .\-/]{1,180}', name) or name.startswith('final/') or (name.startswith('system/') and not path.name.startswith('system-')): raise ValueError()
                            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value): raise ValueError()
                            batch.append(Metric(name, value, stamp, step))
                        points.extend(batch)
                    except (ValueError, TypeError, KeyError): invalid += 1
                    if len(points) >= 500:
                        self.client.log_batch(data['mlflow_run_id'], metrics=points[:500], synchronous=True)
                        points = points[500:]
                offset = stream.tell()
            for index in range(0, len(points), 500):
                self.client.log_batch(data['mlflow_run_id'], metrics=points[index:index + 500], synchronous=True)
            data['offsets'][key] = offset
            if invalid:
                warning = f'{path.name} 有无效记录，未作为指标采用'
                if warning not in data['warnings']: data['warnings'].append(warning)

    def flush(self, run):
        with self.lock:
            try:
                data = self.ensure(run)
                self.parameters(run, data)
                self.ingest(run, data)
                data.update(error='', last_synced_at=now())
                self.save(run, data)
                return data
            except Exception as exc:
                data = self.record(run['id'])
                data.update(error=str(exc)[:1500])
                self.save(run, data)
                return data

    def finish(self, run):
        with self.lock:
            data = self.flush(run)
            try:
                if data.get('error'): return
                from mlflow.entities import Metric
                fingerprint = digest(encode(run['metrics']))
                if run['status'] == 'completed' and data.get('final_digest') != fingerprint:
                    stamp = milliseconds(run['finished_at']) if not data.get('final_digest') else int(time.time() * 1000)
                    points = [Metric('final/' + name, value, stamp, 0) for name, value in run['metrics'].items()]
                    self.client.log_batch(data['mlflow_run_id'], metrics=points, synchronous=True)
                    data['final_digest'] = fingerprint
                self.client.set_tag(data['mlflow_run_id'], 'easyref.status', run['status'])
                status = {'completed': 'FINISHED', 'cancelled': 'KILLED'}.get(run['status'], 'FAILED')
                self.client.set_terminated(data['mlflow_run_id'], status=status, end_time=milliseconds(run['finished_at']))
                logs = self.paths(run)
                logs.mkdir(parents=True, exist_ok=True)
                snapshot = logs / 'run-record.json'
                atomic_write(snapshot, encode({k: run[k] for k in ['id', 'project_id', 'name', 'status', 'config', 'metrics', 'git_commit', 'purpose', 'error']}))
                for path in [snapshot, logs / 'config.json', logs / 'output.log']:
                    if path.is_file() and path.stat().st_size <= 20 * 1024 * 1024:
                        self.client.log_artifact(data['mlflow_run_id'], str(path), artifact_path='easyref')
                if run['log_path'] and Path(run['log_path']).is_file() and Path(run['log_path']) != logs / 'output.log':
                    original_log = inside(self.store.project(run['project_id'])['root_path'], run['log_path'], True)
                    if original_log.stat().st_size <= 20 * 1024 * 1024:
                        self.client.log_artifact(data['mlflow_run_id'], str(original_log), artifact_path='easyref')
                data.update(error='', last_synced_at=now())
            except Exception as exc: data['error'] = str(exc)[:1500]
            finally:
                self.save(run, data)
                for path in self.journal_paths(run):
                    self.store.execute('INSERT OR IGNORE INTO experiment_artifacts VALUES(?,?,?,?,?)', (uid(), run['id'], str(path), file_hash(path), 'telemetry'))

    def sync(self, pid, ident):
        run = self.run(pid, ident)
        if run['status'] not in TERMINAL: raise ValueError('运行中的监控由执行器自动同步，请等待运行结束')
        with self.lock:
            self.ensure(run, historical=not bool(self.journal_paths(run)))
            self.finish(run)
        return self.read(pid, ident)

    def read(self, pid, ident, keys=()):
        run = self.run(pid, ident)
        data = self.record(ident)
        result = {'engine': 'MLflow', 'run_id': ident, 'run_status': run['status'], 'tracking': data,
                  'available': self.status()['available'], 'metrics': [], 'series': [], 'archived': False,
                  'started_at': run['started_at'], 'finished_at': run['finished_at']}
        if not data.get('mlflow_run_id'): return result
        if data.get('store_id') != self.store_id:
            return {**result, 'archived': True}
        try:
            tracked = self.client.get_run(data['mlflow_run_id'])
            if tracked.data.tags.get('easyref.run_id') != ident: raise ValueError('MLflow 运行关联不匹配')
            result['mlflow_status'] = tracked.info.status
            result['metrics'] = [{'key': k, 'value': v} for k, v in sorted(tracked.data.metrics.items()) if math.isfinite(v)]
            names = [k for k in tracked.data.metrics if not k.startswith(('system/', 'final/'))]
            names += [k for k in tracked.data.metrics if k.startswith('system/')]
            chosen = list(dict.fromkeys(keys or names[:4]))[:8]
            for key in chosen:
                if key not in tracked.data.metrics: continue
                points = [{'step': p.step, 'timestamp': p.timestamp, 'value': p.value} for p in self.client.get_metric_history(data['mlflow_run_id'], key) if math.isfinite(p.value)]
                points.sort(key=lambda p: (p['timestamp'], p['step']) if key.startswith('system/') else (p['step'], p['timestamp']))
                result['series'].append({'key': key, 'total': len(points), 'points': thin_points(points)})
        except Exception as exc: result['read_error'] = str(exc)[:1500]
        return result

    def prepare(self, run, env):
        events = self.paths(run) / 'events'
        events.mkdir(parents=True, exist_ok=True)
        env['EASYREF_TRACKING_DIR'] = str(events)
        helper = str(Path(__file__).resolve().parents[1] / 'tracking')
        env['PYTHONPATH'] = helper + (os.pathsep + env['PYTHONPATH'] if env.get('PYTHONPATH') else '')
        return Capture(self, run, events)


class Capture:
    def __init__(self, service, run, events):
        self.service, self.run, self.events = service, run, events
        self.process = None
        self.gpu = None
        self.gpu_checked = False
        self.sample = 0

    def close(self):
        if self.gpu:
            try: self.gpu.nvmlShutdown()
            except Exception: pass

    def poll(self, process):
        # Collection and ingestion both fail independently of the actual experiment.
        if process.poll() is not None:
            self.service.flush(self.run)
            return
        warnings, metrics = [], {}
        try:
            import psutil
            if self.process is None:
                self.process = psutil.Process(process.pid)
                self.process.cpu_percent()
            metrics['system/process_cpu_percent'] = self.process.cpu_percent()
            processes = [self.process] + self.process.children(recursive=True)
            metrics['system/process_memory_mb'] = sum(p.memory_info().rss for p in processes if p.is_running()) / 1024 ** 2
            metrics['system/host_memory_percent'] = psutil.virtual_memory().percent
        except Exception as exc: warnings.append('进程资源采集不可用：' + str(exc)[:200])
        try:
            if not self.gpu_checked:
                self.gpu_checked = True
                import pynvml
                pynvml.nvmlInit()
                self.gpu = pynvml
            if self.gpu:
                for i in range(self.gpu.nvmlDeviceGetCount()):
                    handle = self.gpu.nvmlDeviceGetHandleByIndex(i)
                    metrics[f'system/gpu_{i}_utilization_percent'] = self.gpu.nvmlDeviceGetUtilizationRates(handle).gpu
                    metrics[f'system/gpu_{i}_memory_mb'] = self.gpu.nvmlDeviceGetMemoryInfo(handle).used / 1024 ** 2
        except Exception as exc: warnings.append('GPU 整卡监控不可用：' + str(exc)[:200])
        try:
            if metrics:
                with (self.events / 'system-host.jsonl').open('a', encoding='utf8') as stream:
                    stream.write(encode({'metrics': metrics, 'step': self.sample, 'timestamp': int(time.time() * 1000)}) + '\n')
                self.sample += 1
            data = self.service.flush(self.run)
            for warning in warnings:
                if warning not in data.setdefault('warnings', []): data['warnings'].append(warning)
            self.service.save(self.run, data)
        except Exception:
            pass  # e.g. a full journal disk must not abort training.


def register_tracking_api(app, service):
    api = Blueprint('experiment_tracking', __name__)

    @api.get('/experiment-tracking/status')
    def status(): return jsonify(service.status())

    @api.get('/projects/<pid>/experiments/<ident>/tracking')
    def tracking(pid, ident): return jsonify(service.read(pid, ident, request.args.getlist('metric')))

    @api.post('/projects/<pid>/experiments/<ident>/tracking/sync')
    def sync(pid, ident): return jsonify(service.sync(pid, ident))

    app.register_blueprint(api, url_prefix='/api')
