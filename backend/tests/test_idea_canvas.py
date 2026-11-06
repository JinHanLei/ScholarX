"""Real persistence and execution tests. Synthetic computations below are TEST DATA only."""
import copy
import json
import threading
from pathlib import Path
from uuid import uuid4

import pytest
from app.local_ideas import IdeaService
from app.local_store import Store
from app.research_schema.bridge import ResearchSchemaService


def model():
    a, b = str(uuid4()), str(uuid4())
    return {'name': 'TEST DATA model', 'description': 'Test-only deterministic calculation.', 'graph': {
        'nodes': [{'id': a, 'label': 'Input', 'kind': 'input', 'position': {'x': 0, 'y': 0}},
                  {'id': b, 'label': 'Backbone', 'kind': 'backbone', 'position': {'x': 300, 'y': 0}}],
        'edges': [{'id': str(uuid4()), 'source': a, 'target': b, 'label': 'features'}]}}


def publish(service, project, doc=None, record=None):
    record = record or service.create(project['id'])
    return service.save(project['id'], record['idea_id'], {'expected_revision': record['revision'], 'document': doc or model(), 'purpose': 'TEST DATA design change'})


def executable_plan(value, workspace):
    (workspace / 'train.py').write_text("import json, os\nfrom pathlib import Path\nfrom helper import calculate\nconfig=json.loads(Path(os.environ['EASYREF_CONFIG']).read_text())\nPath(os.environ['EASYREF_METRICS_PATH']).write_text(json.dumps({'test_result':calculate(config['seed'])}))\nprint('TEST DATA calculation complete')\n", encoding='utf8')
    return {'status': 'ready', 'summary': 'TEST DATA executable', 'runs': [
        {'name': 'TEST DATA seed', 'command': ['python', 'train.py'], 'cwd': '.', 'metrics_path': 'metrics.json',
         'config': {'dataset': 'TEST DATA', 'split': 'fixed fixture', 'seed': 3, 'hyperparameters': {}, 'evaluation_protocol': 'deterministic test'}}]}


def test_atomic_versions_layout_and_conflicting_edit(services, project):
    service = services['ideas']
    first = publish(service, project)
    assert first['published'] and first['version']['number'] == 1
    draft = copy.deepcopy(first['idea']['document'])
    draft['graph']['nodes'][0]['position']['x'] = 125
    moved = publish(service, project, draft, first['idea'])
    assert not moved['published'] and len(service.versions(project['id'])) == 1
    draft['graph']['nodes'][1]['description'] = 'New architecture'
    changed = publish(service, project, draft, moved['idea'])
    assert changed['version']['number'] == 2
    old_version = service.version(first['version']['id'])
    assert old_version['document']['graph']['nodes'][0]['position']['x'] == 0
    bp = services['store'].one('SELECT data_json FROM revisions WHERE id=?', (changed['version']['blueprint_revision'],))
    assert bp['data']['version'] == 2 and bp['data']['idea_revision'] == changed['version']['idea_revision']
    with pytest.raises(ValueError, match='另一个编辑'): publish(service, project, draft, first['idea'])
    assert len(service.versions(project['id'])) == 2
    with pytest.raises(ValueError, match='统一版本'):
        component = services['store'].component(changed['idea']['blueprint_id'])
        services['store'].save_component(project['id'], 'blueprint', 'bypass', {}, component['id'], component['revision_id'])


def test_invalid_graph_and_cross_project_are_rejected(services, project, client):
    service = services['ideas']; record = service.create(project['id'])
    doc = model(); doc['graph']['edges'][0]['target'] = 'missing'
    with pytest.raises(ValueError, match='不存在'): publish(service, project, doc, record)
    assert service.document(project['id'], record['idea_id'])['revision'] == 0
    other = client.post('/api/projects', json={'name': 'Other TEST DATA'}).json['project']
    assert client.get(f"/api/projects/{other['id']}/ideas/{record['idea_id']}").status_code == 400
    doc = model(); doc['graph']['nodes'][0]['position']['x'] = float('inf')
    with pytest.raises(ValueError, match='坐标'): publish(service, project, doc, record)


def test_unified_numbers_are_project_wide(services, project):
    service = services['ideas']
    assert publish(service, project)['version']['number'] == 1
    assert publish(service, project)['version']['number'] == 2


def test_auto_queue_executes_snapshot_and_retains_real_metrics(services, project, monkeypatch):
    service = services['ideas']; root = Path(project['root_path'])
    (root / 'helper.py').write_text('def calculate(seed): return seed * 7\n')
    monkeypatch.setattr(service, 'prepare', executable_plan)
    result = publish(service, project)
    original_start = services['experiments'].start
    def edit_original_then_start(ident, authorized=False):
        (root / 'helper.py').write_text('def calculate(seed): return -999\n')
        return original_start(ident, authorized)
    monkeypatch.setattr(services['experiments'], 'start', edit_original_then_start)
    service.run_version(result['version']['id'])
    version = service.version(result['version']['id'])
    assert version['stage'] == 'completed', version['message']
    run = version['runs'][0]
    assert run['metrics'] == {'test_result': 21}
    assert run['blueprint_revision'] == version['blueprint_revision']
    assert run['name'].startswith('V1') and str(root / '.easyref' / 'idea-versions') in run['cwd']
    assert {'snapshotting', 'implementing', 'validating', 'running', 'summarizing', 'completed'} <= {e['stage'] for e in version['events']}
    assert (root / version['workspace'] / 'helper.py').read_text() == 'def calculate(seed): return seed * 7\n'


def test_missing_prerequisite_does_not_invent_run(services, project, monkeypatch):
    service = services['ideas']
    monkeypatch.setattr(service, 'prepare', lambda *_: {'status': 'blocked', 'summary': 'Missing dataset', 'runs': []})
    result = publish(service, project)
    service.run_version(result['version']['id'])
    value = service.version(result['version']['id'])
    assert value['stage'] == 'blocked' and value['message'] == 'Missing dataset' and not value['runs']
    assert service.retry(value['id'])['number'] == 1


def test_source_mutation_invalidates_run_and_archives_original_code(services, project, monkeypatch):
    import zipfile
    service = services['ideas']; root = Path(project['root_path'])
    (root / 'helper.py').write_text('def calculate(seed): return seed * 7\n')
    def prepare(value, workspace):
        plan = executable_plan(value, workspace)
        script = workspace / 'train.py'
        script.write_text(script.read_text(encoding='utf8') + "Path('helper.py').write_text('def calculate(seed): return -1\\n')\n", encoding='utf8')
        return plan
    monkeypatch.setattr(service, 'prepare', prepare)
    result = publish(service, project)
    service.run_version(result['version']['id'])
    version = service.version(result['version']['id'])
    assert version['stage'] == 'blocked' and '快照被修改' in version['message']
    assert version['runs'][0]['status'] == 'failed'
    artifact = services['store'].one("SELECT path FROM experiment_artifacts WHERE experiment_id=? AND kind='implementation_source'", (version['runs'][0]['id'],))
    with zipfile.ZipFile(artifact['path']) as bundle:
        assert bundle.read('helper.py') == (root / 'helper.py').read_bytes()


def test_queued_versions_run_serially_without_extra_confirmation(services, project, monkeypatch):
    service = services['ideas']; began = threading.Event(); finish = threading.Event(); seen = []
    def fake_run(ident):
        seen.append(service.version(ident)['number']); service.transition(ident, 'implementing', 'TEST DATA')
        began.set(); finish.wait(5); service.transition(ident, 'completed', 'TEST DATA queue only')
    monkeypatch.setattr(service, 'run_version', fake_run)
    service.autostart = True
    try:
        first = publish(service, project); assert began.wait(3)
        doc = copy.deepcopy(first['idea']['document']); doc['description'] = 'Changed'
        second = publish(service, project, doc, first['idea'])
        assert service.version(second['version']['id'])['stage'] == 'queued' and seen == [1]
        worker = service.workers[project['id']]; finish.set(); worker.join(5)
        assert seen == [1, 2] and not worker.is_alive()
    finally: finish.set(); service.close()


def test_restart_preserves_stage_and_does_not_rerun_active_work(services, project):
    service = services['ideas']; result = publish(service, project)
    service.transition(result['version']['id'], 'running', 'TEST DATA running')
    recovered = IdeaService(services['store'], services['codex'], services['experiments'], autostart=False)
    assert recovered.version(result['version']['id'])['stage'] == 'interrupted'
    assert recovered.version(result['version']['id'])['number'] == 1
    recovered.close()


def test_context_endpoint_and_portable_version_roundtrip(services, project, client, tmp_path):
    result = publish(services['ideas'], project)
    active = client.get('/api/idea-context').json
    assert active['idea']['idea_id'] == result['idea']['idea_id']
    bridge = ResearchSchemaService(services['store'])
    doc = bridge.checkpoint(project['id'], 'TEST DATA idea roundtrip')
    assert doc['extensions']['sqlite_projection']['tables']['idea_versions'][0]['number'] == 1
    recovered = Store(tmp_path / 'restored')
    ResearchSchemaService(recovered).restore(project['root_path'])
    version = recovered.one('SELECT * FROM idea_versions WHERE id=?', (result['version']['id'],))
    assert version['stage'] == 'interrupted' and version['document']['name'] == 'TEST DATA model'


def test_codex_workspace_is_constrained_and_used(services, project, monkeypatch):
    adapter = services['codex']; observed = []
    workspace = Path(project['root_path']) / '.easyref' / 'isolated'; workspace.mkdir(parents=True)
    def rpc(method, params, **kwargs):
        observed.append((method, params)); return {'thread': {'id': str(uuid4())}}
    monkeypatch.setattr(adapter, 'rpc', rpc)
    session = adapter.create_session(project['id'], workspace=str(workspace))
    assert observed[0][1]['cwd'] == str(workspace.resolve())
    assert adapter.context(session, [])['project_root'] == str(workspace.resolve())
    with pytest.raises(ValueError, match='项目目录'): adapter.create_session(project['id'], workspace=str(workspace.anchor))
