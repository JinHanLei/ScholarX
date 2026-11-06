"""TEST DATA only: discussion records, figure integrity and evidence linkage."""
import copy
from uuid import uuid4
import pytest
from app.local_store import Store, encode
from app.research_schema.bridge import ResearchSchemaService


def document():
    return {'name': 'Research TEST DATA', 'description': 'No research claim.', 'graph': {
        'nodes': [{'id': 'input', 'kind': 'input', 'label': 'Input', 'position': {'x': 0, 'y': 0}}], 'edges': []},
        'figure': {'width': 600, 'height': 240, 'title': 'TEST DATA method', 'caption': 'A test fixture.', 'elements': [
            {'id': 'panel', 'type': 'rect', 'x': 20, 'y': 20, 'width': 560, 'height': 200, 'fill': '#eef4ff'},
            {'id': 'label', 'type': 'text', 'x': 40, 'y': 60, 'width': 300, 'height': 40, 'text': 'Input <not markup>', 'fontSize': 20}]}}


def decision():
    return {'id': str(uuid4()), 'kind': 'decision', 'title': 'TEST DATA confirmed change', 'change': 'Add a method figure.',
            'reason': 'A confirmed discussion checkpoint.', 'validation': 'No execution; verify persistence only.', 'source': 'Codex test fixture'}


def test_decision_is_atomic_idempotent_and_only_bound_on_publish(services, project, client, monkeypatch):
    service = services['ideas']; queued = []; monkeypatch.setattr(service, 'kick', queued.append)
    idea = service.create(project['id'])
    url = f"/api/projects/{project['id']}/ideas/{idea['idea_id']}"
    payload = {'expected_revision': 0, 'document': document(), 'record': decision()}
    response = client.post(url + '/records', json=payload)
    assert response.status_code == 200, response.json
    saved = response.json['idea']
    assert not response.json['published'] and not queued and not service.versions(project['id'])
    records = service.records(project['id'], idea['idea_id'])
    assert len(records) == 1 and records[0]['version_id'] is None
    assert 'document' not in records[0]
    assert client.post(url + '/records', json=payload).json['idea']['revision'] == 1
    assert len(service.records(project['id'], idea['idea_id'])) == 1
    tampered = copy.deepcopy(payload); tampered['record']['reason'] = 'Different decision'
    assert client.post(url + '/records', json=tampered).status_code == 400
    draft = copy.deepcopy(saved['document']); draft['description'] = 'Second checkpoint'
    second = client.post(url + '/records', json={'expected_revision': 1, 'document': draft, 'record': decision()}).json['idea']
    published = client.post(url + '/versions', json={'expected_revision': 2, 'document': second['document']}).json
    records = service.records(project['id'], idea['idea_id'])
    assert {r['version_id'] for r in records} == {published['version']['id']} and queued == [project['id']]
    first_snapshot = client.get(url + '/records/' + payload['record']['id']).json['record']['document']
    assert first_snapshot['description'] == 'No research claim.'
    assert first_snapshot['figure'] == saved['document']['figure']


def test_invalid_or_stale_discussion_never_partially_writes(services, project, client):
    service = services['ideas']; idea = service.create(project['id'])
    url = f"/api/projects/{project['id']}/ideas/{idea['idea_id']}"
    note = decision(); note['reason'] = ''
    response = client.post(url + '/records', json={'expected_revision': 0, 'document': document(), 'record': note})
    assert response.status_code == 400 and service.document(project['id'], idea['idea_id'])['revision'] == 0
    note = decision()
    assert client.post(url + '/records', json={'expected_revision': 3, 'document': document(), 'record': note}).status_code == 400
    assert service.records(project['id'], idea['idea_id']) == []
    other = client.post('/api/projects', json={'name': 'Other TEST DATA'}).json['project']
    assert client.get(f"/api/projects/{other['id']}/ideas/{idea['idea_id']}/records").status_code == 400


def test_vector_figure_validation_and_stale_source_guard(services, project, client):
    service = services['ideas']; idea = service.create(project['id'])
    url = f"/api/projects/{project['id']}/ideas/{idea['idea_id']}"
    bad = document(); bad['figure']['elements'].append({'id': 'external', 'type': 'image', 'src': 'https://example.invalid'})
    assert client.put(url, json={'expected_revision': 0, 'document': bad}).status_code == 400
    bad = document(); bad['figure']['elements'][0]['x'] = float('inf')
    assert client.put(url, json={'expected_revision': 0, 'document': bad}).status_code == 400
    saved = client.put(url, json={'expected_revision': 0, 'document': document()}).json['idea']
    assert not saved['figure_stale'] and len(saved['document']['figure']['source_hash']) == 64
    moved = copy.deepcopy(saved['document']); moved['graph']['nodes'][0]['position']['x'] += 200
    saved = client.put(url, json={'expected_revision': 1, 'document': moved}).json['idea']
    assert not saved['figure_stale']
    changed = copy.deepcopy(saved['document']); changed['graph']['nodes'][0]['description'] = 'New architecture'
    saved = client.put(url, json={'expected_revision': 2, 'document': changed}).json['idea']
    assert saved['figure_stale']
    assert client.post(url + '/versions', json={'expected_revision': 3, 'document': saved['document']}).status_code == 400
    fixed = copy.deepcopy(saved['document']); fixed['figure']['elements'][1]['text'] = 'Updated architecture'
    result = client.post(url + '/versions', json={'expected_revision': 3, 'document': fixed})
    assert result.status_code == 200 and not result.json['idea']['figure_stale']
    assert result.json['version']['document']['figure']['elements'][1]['text'] == 'Updated architecture'


def test_records_and_figure_survive_portable_export(services, project, tmp_path):
    service = services['ideas']; idea = service.create(project['id'])
    note = decision()
    saved = service.save(project['id'], idea['idea_id'], {'expected_revision': 0, 'document': document(), 'record': note})
    ResearchSchemaService(services['store']).checkpoint(project['id'], 'TEST DATA record export')
    restored = Store(tmp_path / 'research-roundtrip')
    ResearchSchemaService(restored).restore(project['root_path'])
    record = restored.one('SELECT * FROM idea_research_records WHERE id=?', (note['id'],))
    assert record['data']['reason'] == note['reason']
    assert record['document']['figure'] == saved['idea']['document']['figure']
    assert record['version_id'] is None


def test_conclusion_uses_actual_version_run_and_keeps_older_design(services, project, client):
    service, store = services['ideas'], services['store']; idea = service.create(project['id'])
    first = service.save(project['id'], idea['idea_id'], {'expected_revision': 0, 'document': document()}, publish_version=True)
    version = first['version']; run_id = str(uuid4())
    store.execute('INSERT INTO experiments(id,project_id,name,config_json,command_json,cwd,purpose,status,environment_json,metrics_json,git_commit,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
                  (run_id, project['id'], 'TEST DATA run', encode({'seed': 1, 'dataset': 'TEST DATA', 'split': 'fixed', 'hyperparameters': {}, 'evaluation_protocol': 'fixture'}), '["python","fixture.py"]', '.', 'TEST DATA', 'completed', '{}', encode({'fixture_metric': 0.25}), 'a' * 40, '2026-01-01T00:00:00Z'))
    store.execute('INSERT INTO idea_version_runs VALUES(?,?,?,?)', (project['id'], version['id'], run_id, 1))
    changed = copy.deepcopy(first['idea']['document']); changed['description'] = 'Next draft'
    current = service.save(project['id'], idea['idea_id'], {'expected_revision': 1, 'document': changed})['idea']
    note = {'id': str(uuid4()), 'kind': 'conclusion', 'title': 'TEST DATA interpretation', 'version_id': version['id'],
            'experiment_ids': [run_id], 'conclusion': 'Fixture value, not a research claim.', 'metrics': {'fixture_metric': 999}}
    url = f"/api/projects/{project['id']}/ideas/{idea['idea_id']}/records"
    result = client.post(url, json={'expected_revision': 2, 'document': current['document'], 'record': note})
    assert result.status_code == 200, result.json
    record = client.get(url + '/' + note['id']).json['record']
    assert record['data']['experiments'][0]['metrics'] == {'fixture_metric': 0.25}
    assert record['document']['description'] == 'No research claim.'
    assert result.json['idea']['document']['description'] == 'Next draft'
    note['id'] = str(uuid4()); note['experiment_ids'] = [str(uuid4())]
    assert client.post(url, json={'expected_revision': 3, 'document': current['document'], 'record': note}).status_code == 400
