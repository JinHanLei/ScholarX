import json
import shutil
import time
from pathlib import Path

import pytest
from app.local_store import Store, encode
from app.local_tracking import ExperimentTracking, thin_points
from app.local_experiments import Experiments
from app.research_schema.bridge import ResearchSchemaService
from experiment_result_fixture import add_run, add_version

TRAIN = '''import json, os, time
from pathlib import Path
from easyref_tracking import log_metrics
config=json.loads(Path(os.environ['EASYREF_CONFIG']).read_text('utf8'))
weight=0.0
for epoch in range(config['hyperparameters']['epochs']):
    loss=(weight-2)**2
    log_metrics({'train/loss':loss, 'validation/loss':loss/2},step=epoch)
    weight-=.2*(weight-2)
    print('TEST training epoch',epoch,flush=True)
    time.sleep(.12)
Path(os.environ['EASYREF_METRICS_PATH']).write_text(json.dumps({'test_error':(weight-2)**2}),encoding='utf8')
'''


def register(services, project, epochs=8):
    path = Path(project['root_path']) / 'tracking_test.py'
    path.write_text(TRAIN, encoding='utf8')
    return services['experiments'].register(project['id'], {
        'name': 'MLflow real execution TEST DATA', 'command': ['python', path.name], 'metrics_path': 'test_result.json',
        'config': {'dataset': 'Synthetic scalar TEST DATA', 'split': 'fixed fixture', 'seed': 1,
                   'hyperparameters': {'epochs': epochs, 'learning_rate': .2}, 'evaluation_protocol': 'Fixed scalar loss'}, 'test_data': True})


def finish(services, ident):
    deadline = time.time() + 30
    while time.time() < deadline:
        if ident not in services['experiments'].threads:
            return services['experiments'].get(ident)
        time.sleep(.05)
    pytest.fail('Executor did not finish')


def test_real_tracking_keeps_live_curves_separate_from_final_results(client, services, project):
    tracker = services['experiments'].tracking
    tracker.interval = .1
    run = register(services, project)
    version = add_version(services['ideas'], project['id'])['version']
    services['store'].execute('INSERT INTO idea_version_runs VALUES(?,?,?,?)', (project['id'], version['id'], run['id'], 1))
    # Warm the local MLflow DB so this short test also observes intermediate steps.
    tracker.ensure(run)
    services['experiments'].start(run['id'], authorized=True)
    deadline = time.time() + 10
    while time.time() < deadline:
        report = tracker.read(project['id'], run['id'], ['train/loss'])
        if report['series']: break
        time.sleep(.05)
    assert report['series'][0]['points'][0]['value'] == 4
    assert services['experiments'].get(run['id'])['metrics'] == {}
    result = finish(services, run['id'])
    assert result['status'] == 'completed', result['error']
    report = tracker.read(project['id'], run['id'], ['train/loss', 'system/process_memory_mb'])
    assert report['mlflow_status'] == 'FINISHED'
    assert len(report['series'][0]['points']) == 8
    assert report['series'][0]['points'][-1]['value'] < 4
    tracked = tracker.client.get_run(report['tracking']['mlflow_run_id'])
    assert tracked.data.tags['easyref.idea_version_ids'] == encode([version['id']])
    assert tracked.data.params['hyperparameters.epochs'] == '8'
    assert tracked.data.metrics['final/test_error'] == result['metrics']['test_error']
    assert 'train/loss' not in result['metrics']
    assert tracked.data.metrics['system/process_memory_mb'] > 0
    before = len(tracker.client.get_metric_history(tracked.info.run_id, 'train/loss'))
    tracker.sync(project['id'], run['id'])
    assert len(tracker.client.get_metric_history(tracked.info.run_id, 'train/loss')) == before
    assert services['experiments'].get(run['id']) == result
    assert client.get(f"/api/projects/other/experiments/{run['id']}/tracking").status_code == 400


def test_tracking_failure_never_changes_successful_experiment(services, project, monkeypatch):
    tracker = services['experiments'].tracking
    tracker.interval = .1
    monkeypatch.setattr(tracker, 'ensure', lambda *a, **kw: (_ for _ in ()).throw(RuntimeError('TEST offline tracking store')))
    run = register(services, project, epochs=2)
    services['experiments'].start(run['id'], authorized=True)
    result = finish(services, run['id'])
    assert result['status'] == 'completed' and result['metrics']['test_error'] > 0
    assert 'offline tracking' in tracker.record(run['id'])['error']
    assert tracker.journal_paths(result)
    monkeypatch.undo()
    recovered = tracker.sync(project['id'], run['id'])
    assert not recovered['tracking']['error']
    assert recovered['mlflow_status'] == 'FINISHED'
    assert len(tracker.client.get_metric_history(recovered['tracking']['mlflow_run_id'], 'train/loss')) == 2


def test_partial_invalid_reserved_events_and_missing_gpu_do_not_fabricate_data(services, project):
    tracker = services['experiments'].tracking
    ident = add_run(services['store'], project['id'], 'TEST journal', {'score': 0})
    run = tracker.run(project['id'], ident); directory = tracker.paths(run) / 'events'; directory.mkdir(parents=True)
    path = directory / 'training-123.jsonl'
    records = [{'step': 0, 'timestamp': 1000, 'metrics': {'train/loss': 0}},
               {'step': 1, 'timestamp': 1001, 'metrics': {'final/score': 999}},
               {'step': 2, 'timestamp': 1002, 'metrics': {'system/gpu_0_memory_mb': 999}}]
    path.write_text(''.join(json.dumps(r) + '\n' for r in records) + '{"step":3', encoding='utf8')
    tracker.sync(project['id'], ident)
    report = tracker.read(project['id'], ident, ['train/loss'])
    assert report['series'][0]['points'][0]['value'] == 0
    assert len(report['tracking']['warnings']) == 1
    metrics = {m['key']: m['value'] for m in report['metrics']}
    assert metrics['final/score'] == 0
    assert 'system/gpu_0_memory_mb' not in metrics
    with path.open('a', encoding='utf8') as stream: stream.write(',"timestamp":1003,"metrics":{"train/loss":0.2}}\n')
    tracker.sync(project['id'], ident)
    assert tracker.read(project['id'], ident, ['train/loss'])['series'][0]['total'] == 2


def test_historical_sync_and_portable_journal_restore_keep_identity(services, project, tmp_path):
    tracker = services['experiments'].tracking; pid = project['id']
    ident = add_run(services['store'], pid, 'TEST old result', {'score': .7})
    original = tracker.run(pid, ident)
    historical = tracker.sync(pid, ident)
    assert historical['tracking']['origin'] == 'historical'
    assert not historical['series']
    assert tracker.run(pid, ident) == original
    # Portable metadata cannot accidentally resolve to another instance's MLflow.
    ResearchSchemaService(services['store']).checkpoint(pid)
    restored = Store(tmp_path / 'restored-tracking')
    ResearchSchemaService(restored).restore(project['root_path'])
    other = ExperimentTracking(restored)
    assert other.read(pid, ident)['archived']
    copied = other.sync(pid, ident)
    assert copied['tracking']['mlflow_run_id'] != historical['tracking']['mlflow_run_id']
    assert copied['metrics'] == historical['metrics']
    assert other.run(pid, ident)['metrics'] == original['metrics']


def test_cancellation_terminates_mlflow_and_preserves_collected_history(services, project):
    tracker = services['experiments'].tracking; tracker.interval = .1
    run = register(services, project, epochs=100)
    tracker.ensure(run)
    services['experiments'].start(run['id'], authorized=True)
    deadline = time.time() + 10
    while time.time() < deadline:
        if tracker.read(project['id'], run['id'])['series']: break
        time.sleep(.05)
    services['experiments'].cancel(run['id'])
    assert finish(services, run['id'])['status'] == 'cancelled'
    report = tracker.read(project['id'], run['id'])
    assert report['mlflow_status'] == 'KILLED'
    assert not any(m['key'].startswith('final/') for m in report['metrics'])
    assert report['series']


def test_chart_downsampling_keeps_real_extrema_and_endpoints():
    points = [{'step': i, 'timestamp': i, 'value': (-999 if i == 432 else 999 if i == 433 else i % 20)} for i in range(2000)]
    shown = thin_points(points)
    assert len(shown) <= 400 and shown[0] == points[0] and shown[-1] == points[-1]
    assert points[432] in shown and points[433] in shown
    assert all(point in points for point in shown)


def test_terminal_drain_and_portable_replay_preserve_all_curve_points(services, project, tmp_path):
    tracker = services['experiments'].tracking; pid = project['id']
    ident = add_run(services['store'], pid, 'TEST portable telemetry', {'score': .4})
    run = tracker.run(pid, ident); directory = tracker.paths(run) / 'events'; directory.mkdir(parents=True)
    path = directory / 'training-456.jsonl'
    path.write_text(''.join(json.dumps({'step': i, 'timestamp': 1000 + i, 'metrics': {'train/loss': i / 1000}}) + '\n' for i in range(2101)), encoding='utf8')
    original = tracker.sync(pid, ident)
    assert tracker.read(pid, ident, ['train/loss'])['series'][0]['total'] == 2101
    ResearchSchemaService(services['store']).checkpoint(pid)
    destination = tmp_path / 'portable-project'
    shutil.copytree(project['root_path'], destination, ignore=shutil.ignore_patterns('.git', '.easyref'))
    restored = Store(tmp_path / 'restored-live')
    ResearchSchemaService(restored).restore(destination)
    other = ExperimentTracking(restored)
    assert other.read(pid, ident)['archived']
    copied = other.sync(pid, ident)
    assert not copied['tracking']['error']
    assert copied['tracking']['mlflow_run_id'] != original['tracking']['mlflow_run_id']
    assert other.read(pid, ident, ['train/loss'])['series'][0]['total'] == 2101
    assert other.run(pid, ident)['metrics'] == run['metrics']


def test_restart_closes_interrupted_tracking_without_restart_of_training(services, project):
    store = services['store']; pid = project['id']
    ident = add_run(store, pid, 'TEST interrupted', {}, status='running')
    tracker = services['experiments'].tracking
    tracker.flush(tracker.run(pid, ident))
    restarted = Experiments(store)
    assert restarted.get(ident)['status'] == 'interrupted'
    assert restarted.tracking.read(pid, ident)['mlflow_status'] == 'FAILED'
    assert not restarted.threads and not restarted.processes
