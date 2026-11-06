from uuid import uuid4
import pytest
from app.local_store import Store, encode
from app.research_schema.bridge import ResearchSchemaService
from experiment_result_fixture import add_run, add_version


def mapping(source='score', role='baseline'):
    return {'id': str(uuid4()), 'expected_revision': None, 'mapping': {'reason': 'Test presentation change only.', 'rows': [
        {'method': 'TEST method', 'role': role, 'scope': 'test', 'metrics': [{'source': source, 'label': 'Score', 'direction': 'higher', 'unit': '', 'value': 9999}]}]}}


def test_mapping_reads_real_values_is_atomic_and_keeps_run_immutable(client, services, project, monkeypatch):
    store = services['store']; pid = project['id']; ident = add_run(store, pid, 'TEST zero', {'score': 0})
    before = services['experiments'].get(ident); url = f'/api/projects/{pid}/experiments/{ident}/report'
    monkeypatch.setattr(services['experiments'], 'start', lambda *a, **kw: pytest.fail('Reporting must not start a run'))
    payload = mapping(); response = client.post(url, json=payload)
    assert response.status_code == 200, response.json
    assert client.post(url, json=payload).json['record']['id'] == payload['id']
    overview = client.get(f'/api/projects/{pid}/experiment-results').json
    assert overview['rows'][0]['metrics'][0]['value'] == 0
    assert overview['rows'][0]['version_ids'] == []
    assert services['experiments'].get(ident) == before
    bad = mapping('invented'); bad['expected_revision'] = payload['id']
    assert client.post(url, json=bad).status_code == 400
    assert client.post(url, json=mapping()).status_code == 400
    assert len(services['experiment_results'].records(pid, ident)) == 1
    other = client.post('/api/projects', json={'name': 'Other TEST DATA'}).json['project']['id']
    assert client.post(f'/api/projects/{other}/experiments/{ident}/report', json=mapping()).status_code == 400


def test_versions_come_from_real_links_and_pending_metrics_are_not_results(client, services, project):
    pid = project['id']; store = services['store']; service = services['experiment_results']
    first = add_version(services['ideas'], pid); second = add_version(services['ideas'], pid, first['idea'], 'TEST second')
    one = add_run(store, pid, 'V1 TEST', {'score': .1}); two = add_run(store, pid, 'V2 TEST', {'score': .2}, status='running')
    old = add_run(store, pid, 'Old TEST', {'score': .3}, test_data=True)
    for ident, version in [(one, first), (two, second)]: store.execute('INSERT INTO idea_version_runs VALUES(?,?,?,?)', (pid, version['version']['id'], ident, 1))
    rows = {r['run_id']: r for r in service.overview(pid)['rows']}
    assert rows[one]['version_ids'] == [first['version']['id']] and rows[one]['role'] == 'ours'
    assert rows[two]['version_ids'] == [second['version']['id']] and rows[two]['metrics'][0]['value'] is None
    assert rows[old]['version_ids'] == [] and rows[old]['role'] == 'unclassified' and rows[old]['test_data']


def test_notes_capture_actual_parameters_and_metrics_without_overwriting_history(client, services, project):
    pid = project['id']; store = services['store']; ident = add_run(store, pid, 'TEST note', {'score': .4})
    url = f'/api/projects/{pid}/experiments/{ident}/notes'; payload = {'id': str(uuid4()), 'text': 'TEST observation', 'metrics': {'score': 123}}
    result = client.post(url, json=payload); assert result.status_code == 200, result.json
    assert result.json['record']['data']['metrics'] == {'score': .4}
    assert result.json['record']['data']['config']['seed'] == 1
    store.execute('UPDATE experiments SET metrics_json=? WHERE id=?', (encode({'score': .5}), ident))
    assert client.post(url, json=payload).json['record']['data']['metrics'] == {'score': .4}
    assert len(services['experiment_results'].records(pid, ident)) == 1
    changed = {**payload, 'text': 'Different text'}
    assert client.post(url, json=changed).status_code == 400


def test_result_records_survive_portable_restore(services, project, tmp_path):
    pid = project['id']; ident = add_run(services['store'], pid, 'TEST portable', {'score': .7})
    service = services['experiment_results']; entry = service.append(pid, ident, 'mapping', mapping())
    note = service.append(pid, ident, 'note', {'id': str(uuid4()), 'text': 'Persist this fixture note.'})
    ResearchSchemaService(services['store']).checkpoint(pid)
    restored = Store(tmp_path / 'restored-results'); ResearchSchemaService(restored).restore(project['root_path'])
    assert restored.one('SELECT * FROM experiment_result_records WHERE id=?', (entry['id'],))['data']['rows'][0]['metrics'][0]['source'] == 'score'
    assert restored.one('SELECT * FROM experiment_result_records WHERE id=?', (note['id'],))['data']['metrics'] == {'score': .7}
