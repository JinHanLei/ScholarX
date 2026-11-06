"""Traceable result tables over immutable run configurations and actual metrics."""
import math
from uuid import UUID
from flask import Blueprint, jsonify, request
from .local_store import digest, encode, now


def text(value, name, limit=300, required=True):
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise ValueError(name + ' 无效')
    return value.strip()


def clean_mapping(value, run):
    if not isinstance(value, dict): raise ValueError('请提供结果表设置')
    rows = value.get('rows')
    if not isinstance(rows, list) or not 1 <= len(rows) <= 40: raise ValueError('结果表需要 1 至 40 个方法')
    result = []
    for row in rows:
        if not isinstance(row, dict) or row.get('role') not in {'baseline', 'ours', 'unclassified'}: raise ValueError('请选择 Baseline 或 Ours')
        metrics = row.get('metrics')
        if not isinstance(metrics, list) or not 1 <= len(metrics) <= 100: raise ValueError('请至少选择一项真实指标')
        columns, labels = [], set()
        for metric in metrics:
            if not isinstance(metric, dict): raise ValueError('指标映射无效')
            source = text(metric.get('source'), '指标来源')
            if source not in run['metrics']: raise ValueError('指标来源不存在于此 Run：' + source)
            label = text(metric.get('label'), '指标名称', 80)
            unit = text(metric.get('unit', ''), '指标单位', 30, False)
            direction = metric.get('direction', '')
            if direction not in {'', 'higher', 'lower'} or (label, unit) in labels: raise ValueError('指标方向无效或同一方法包含重复指标')
            labels.add((label, unit)); columns.append({'source': source, 'label': label, 'unit': unit, 'direction': direction})
        result.append({'method': text(row.get('method'), '方法名称', 150), 'role': row['role'],
                       'scope': text(row.get('scope', ''), '评估范围', 80, False), 'metrics': columns})
    return {'rows': result, 'reason': text(value.get('reason'), '整理理由', 2000)}


class ExperimentResults:
    def __init__(self, store): self.store = store

    def run(self, pid, ident):
        run = self.store.one('SELECT * FROM experiments WHERE id=? AND project_id=?', (ident, pid), True)
        return run

    def records(self, pid, ident):
        self.run(pid, ident)
        return self.store.all('SELECT * FROM experiment_result_records WHERE project_id=? AND experiment_id=? ORDER BY created_at DESC,id DESC', (pid, ident))

    def append(self, pid, ident, kind, payload):
        if not isinstance(payload, dict): raise ValueError('请求格式无效')
        try: record_id = str(UUID(payload.get('id', '')))
        except (ValueError, TypeError, AttributeError): raise ValueError('记录需要稳定 UUID，重试时复用同一 ID')
        request_hash = digest(encode({'kind': kind, 'payload': payload}))
        with self.store.lock:
            run = self.run(pid, ident)
            prior = self.store.one('SELECT * FROM experiment_result_records WHERE id=?', (record_id,))
            if prior:
                if prior['project_id'] != pid or prior['experiment_id'] != ident or prior['request_hash'] != request_hash: raise ValueError('记录 ID 已用于不同内容')
                return prior
            if kind == 'mapping':
                latest = next((r for r in self.records(pid, ident) if r['kind'] == 'mapping'), None)
                if payload.get('expected_revision') != (latest['id'] if latest else None): raise ValueError('结果表设置已更新，请重新加载后再整理')
                data = clean_mapping(payload.get('mapping'), run)
            else:
                data = {'text': text(payload.get('text'), '实验记录', 10000),
                        'status': run['status'], 'config': run['config'], 'metrics': run['metrics'],
                        'version_ids': [r['version_id'] for r in self.store.all('SELECT version_id FROM idea_version_runs WHERE experiment_id=?', (ident,))]}
            self.store.execute('INSERT INTO experiment_result_records VALUES(?,?,?,?,?,?,?)',
                               (record_id, pid, ident, kind, encode(data), request_hash, now()))
        return self.store.one('SELECT * FROM experiment_result_records WHERE id=?', (record_id,), True)

    def overview(self, pid):
        self.store.project(pid)
        runs = self.store.all('SELECT * FROM experiments WHERE project_id=? ORDER BY created_at DESC,id DESC', (pid,))
        versions = self.store.all('SELECT id,idea_id,number,stage,purpose,message,created_at,document_json FROM idea_versions WHERE project_id=? ORDER BY number DESC', (pid,))
        links = self.store.all('SELECT * FROM idea_version_runs WHERE project_id=?', (pid,))
        records = self.store.all('SELECT * FROM experiment_result_records WHERE project_id=? ORDER BY created_at DESC,id DESC', (pid,))
        conclusions = self.store.all('SELECT * FROM idea_research_records WHERE project_id=? ORDER BY created_at DESC,id DESC', (pid,))
        report_runs, rows = [], []
        for run in runs:
            related = [r for r in records if r['experiment_id'] == run['id']]
            for conclusion in conclusions:
                evidence = next((e for e in conclusion['data'].get('experiments', []) if e['id'] == run['id']), None)
                if conclusion['data'].get('kind') == 'conclusion' and evidence:
                    related.append({'id': conclusion['id'], 'kind': 'note', 'source': 'idea', 'created_at': conclusion['created_at'],
                                    'data': {'text': conclusion['data']['conclusion'], 'status': evidence['status'], 'config': evidence['config'], 'metrics': evidence['metrics']}})
            related.sort(key=lambda r: (r['created_at'], r['id']), reverse=True)
            mapping = next((r for r in related if r['kind'] == 'mapping'), None)
            version_ids = [r['version_id'] for r in links if r['experiment_id'] == run['id']]
            default = {'rows': [{'method': 'Ours' if version_ids else run['name'], 'role': 'ours' if version_ids else 'unclassified', 'scope': '',
                                'metrics': [{'source': k, 'label': k, 'unit': '', 'direction': ''} for k in run['metrics']]}], 'reason': ''}
            settings = mapping['data'] if mapping else default
            for index, setting in enumerate(settings['rows']):
                metrics = []
                for metric in setting['metrics']:
                    value = run['metrics'].get(metric['source'])
                    valid = run['status'] == 'completed' and isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
                    metrics.append({**metric, 'value': value if valid else None})
                rows.append({**setting, 'id': f"{run['id']}:{index}", 'run_id': run['id'], 'version_ids': version_ids,
                             'dataset': run['config'].get('dataset'), 'split': run['config'].get('split'),
                             'protocol': run['config'].get('evaluation_protocol'), 'seed': run['config'].get('seed'),
                             'parameters': run['config'].get('hyperparameters', {}), 'status': run['status'],
                             'test_data': bool(run['environment'].get('test_data')), 'metrics': metrics})
            report_runs.append({**run, 'version_ids': version_ids, 'mapping': settings, 'mapping_revision': mapping['id'] if mapping else None,
                                'records': related})
        return {'runs': report_runs, 'rows': rows, 'versions': versions,
                'workflow': {'mapping_endpoint': f'/projects/{pid}/experiments/<run_id>/report',
                             'notes_endpoint': f'/projects/{pid}/experiments/<run_id>/notes',
                             'policy': 'Use real metric source keys only; no metric values are accepted in mappings. Dataset, split, seed and parameters come from the saved run. Version links come only from idea_version_runs; never retroactively assign a legacy run to Vn. Mapping and notes do not start experiments.'}}


def register_experiment_results_api(app, store):
    service = ExperimentResults(store); app.extensions['easyref']['experiment_results'] = service
    api = Blueprint('experiment_results', __name__)

    @api.get('/projects/<pid>/experiment-results')
    def results(pid): return jsonify(service.overview(pid))

    @api.post('/projects/<pid>/experiments/<ident>/report')
    def mapping(pid, ident): return jsonify(record=service.append(pid, ident, 'mapping', request.get_json()))

    @api.post('/projects/<pid>/experiments/<ident>/notes')
    def note(pid, ident): return jsonify(record=service.append(pid, ident, 'note', request.get_json()))

    app.register_blueprint(api, url_prefix='/api')
    return service
