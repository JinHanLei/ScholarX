"""Synthetic UI/test values only. Never use this helper with a live user store."""
from uuid import uuid4
from app.local_store import encode, now


def add_run(store, pid, name, metrics, *, dataset='Dataset A · TEST DATA', seed=1, status='completed', protocol='Fixed test protocol', test_data=False):
    ident = str(uuid4())
    config = {'dataset': dataset, 'split': {'train': '2010–2016', 'valid': '2017', 'test': '2019'}, 'seed': seed,
              'hyperparameters': {'learning_rate': 0.001, 'batch_size': 64, 'epochs': 20}, 'evaluation_protocol': protocol}
    store.execute('INSERT INTO experiments(id,project_id,name,config_json,command_json,cwd,purpose,status,environment_json,metrics_json,git_commit,created_at,finished_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                  (ident, pid, name, encode(config), '["python","test_fixture.py"]', '.', 'Synthetic fixture; not a research finding.', status, encode({'test_data': test_data}), encode(metrics), 'a' * 40, now(), now() if status == 'completed' else None))
    return ident


def add_version(service, pid, idea=None, description='TEST DATA V1'):
    idea = idea or service.create(pid, 'Test model')
    document = {'name': 'TEST DATA model', 'description': description, 'graph': {'nodes': [{'id': 'model', 'label': 'Test model', 'kind': 'module', 'position': {'x': 0, 'y': 0}}], 'edges': []}}
    return service.save(pid, idea['idea_id'], {'expected_revision': idea['revision'], 'document': document}, publish_version=True)


def seed_report_project(app):
    assert app.testing, 'Fixture only accepts a testing app'
    services = app.extensions['easyref']; store = services['store']; reports = services['experiment_results']; ideas = services['ideas']
    with app.test_client() as client: project = client.post('/api/projects', json={'name': 'Experiment results TEST DATA'}).json['project']
    pid = project['id']; first = add_version(ideas, pid); second = add_version(ideas, pid, first['idea'], 'TEST DATA V2')
    baseline = add_run(store, pid, 'Baseline fixture', {'accuracy': 0.80, 'loss': 0.25})
    ours1 = add_run(store, pid, 'Ours V1 fixture', {'accuracy': 0.82, 'loss': 0.23})
    ours2 = add_run(store, pid, 'Ours V2 fixture', {'accuracy': 0.85, 'loss': 0.20})
    other = add_run(store, pid, 'Other dataset fixture', {'accuracy': 0.73, 'loss': 0.3}, dataset='Dataset B · TEST DATA')
    testing = add_run(store, pid, 'Hidden system fixture', {'accuracy': 999}, test_data=True)
    for run, version in [(ours1, first), (ours2, second), (other, second)]:
        store.execute('INSERT INTO idea_version_runs VALUES(?,?,?,?)', (pid, version['version']['id'], run, 1))
    for run, method, role in [(baseline, 'Reference method', 'baseline'), (ours1, 'Ours', 'ours'), (ours2, 'Ours', 'ours'), (other, 'Ours', 'ours')]:
        reports.append(pid, run, 'mapping', {'id': str(uuid4()), 'expected_revision': None, 'mapping': {'reason': 'Synthetic UI fixture mapping.', 'rows': [{'method': method, 'role': role, 'scope': 'test', 'metrics': [{'source': 'accuracy', 'label': 'Accuracy', 'direction': 'higher', 'unit': ''}, {'source': 'loss', 'label': 'Loss', 'direction': 'lower', 'unit': ''}]}]}})
    return {'project': pid, 'baseline': baseline, 'ours1': ours1, 'ours2': ours2, 'other': other, 'testing': testing, 'v1': first['version']['id'], 'v2': second['version']['id']}
