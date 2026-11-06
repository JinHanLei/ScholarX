"""Browser acceptance fixture: actual tiny CPU optimization, never research data."""
import threading
import time
from pathlib import Path

from experiment_result_fixture import add_version

SCRIPT = '''import os,json,time
from pathlib import Path
from easyref_tracking import log_metrics
config=json.loads(Path(os.environ['EASYREF_CONFIG']).read_text('utf8'))
weight=float(config['seed'])/10
for epoch in range(config['hyperparameters']['epochs']):
    loss=(weight-2.0)**2
    log_metrics({'train/loss':loss,'validation/loss':loss/2},step=epoch)
    weight-=config['hyperparameters']['learning_rate']*(weight-2.0)
    print('Synthetic monitoring test, epoch',epoch,'loss',loss,flush=True)
    time.sleep(.35)
Path(os.environ['EASYREF_METRICS_PATH']).write_text(json.dumps({'test_error':(weight-2.0)**2}),encoding='utf8')
'''


def seed_tracking_project(app):
    assert app.testing
    services = app.extensions['easyref']; store = services['store']; experiments = services['experiments']
    with app.test_client() as client:
        project = client.post('/api/projects', json={'name': 'MLflow 接入验收 · TEST DATA'}).json['project']
    first = add_version(services['ideas'], project['id'])
    second = add_version(services['ideas'], project['id'], first['idea'], 'TEST DATA V2')
    path = Path(project['root_path']) / 'monitor_test.py'; path.write_text(SCRIPT, encoding='utf8')
    runs = []
    for seed, version in [(1, first['version']), (2, second['version'])]:
        run = experiments.register(project['id'], {'name': f'监控验收 V{seed} · TEST DATA', 'command': ['python', path.name],
            'metrics_path': f'monitor-result-{seed}.json', 'test_data': True, 'purpose': 'Actual scalar CPU optimization for monitoring acceptance only.',
            'config': {'dataset': 'Synthetic CPU · TEST DATA', 'split': 'fixed scalar example', 'seed': seed,
                       'hyperparameters': {'epochs': 24, 'learning_rate': .2}, 'evaluation_protocol': 'Synthetic scalar error'}})
        store.execute('INSERT INTO idea_version_runs VALUES(?,?,?,?)', (project['id'], version['id'], run['id'], 1))
        experiments.tracking.ensure(run)
        store.execute("UPDATE idea_versions SET stage='running',message='Synthetic monitoring acceptance run' WHERE id=?", (version['id'],))
        experiments.start(run['id'], authorized=True)
        runs.append(run['id'])

    def complete():
        for ident, version in zip(runs, [first['version'], second['version']]):
            while ident in experiments.threads: time.sleep(.1)
            result = experiments.get(ident)
            store.execute('UPDATE idea_versions SET stage=?,message=? WHERE id=?', (result['status'], 'Synthetic acceptance finished', version['id']))
    threading.Thread(target=complete, daemon=True).start()
    return {'project': project['id'], 'runs': runs, 'v1': first['version']['id'], 'v2': second['version']['id']}
