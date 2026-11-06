import json
from unittest.mock import Mock

import pytest
import requests
from app.local_store import encode, now, uid


def connect(services, monkeypatch, papers=(), total=None):
    (services['store'].root / 'literature-catalog.json').write_text(json.dumps({'api_url': 'http://127.0.0.1:5000/api'}), 'utf-8')
    response = Mock()
    response.json.return_value = {'papers': list(papers), 'total': len(papers) if total is None else total}
    get = Mock(return_value=response)
    monkeypatch.setattr('app.literature_catalog.requests.get', get)
    return get


def test_catalog_queries_database_with_filters_and_collects_only_locally(client, project, services, monkeypatch):
    store = services['store']
    venue = store.one("SELECT id FROM venues WHERE abbreviation='ICML'")['id']
    paper = {'id': 'remote-paper', 'title': 'Catalog graph learning TEST', 'authors': ['Test Author'], 'year': 2024,
             'venue_id': venue, 'venue_name': 'ICML', 'rank': 'A', 'doi': '10.1234/catalog.test',
             'dblp_key': 'conf/icml/catalog-test', 'dblp_url': 'https://dblp.org/rec/conf/icml/catalog-test',
             'pdf_path': 'private-file-must-not-transfer', 'metadata': {'source_url': 'https://example.org/paper'}}
    get = connect(services, monkeypatch, [paper], total=61)
    params = {'q': 'graph', 'rank': 'A', 'year_from': 2023, 'author': 'Test', 'offset': 30, 'limit': 30,
              'project_id': project['id']}
    result = client.get('/api/literature/search', query_string=params)
    assert result.status_code == 200 and result.json['catalog']['total'] == 61
    assert result.json['catalog']['papers'][0]['id'] == 'catalog:remote-paper'
    assert result.json['catalog']['papers'][0]['from_catalog'] is True
    assert 'private-file-must-not-transfer' not in result.get_data(as_text=True)
    assert get.call_args.args == ('http://127.0.0.1:5000/api/papers',)
    assert get.call_args.kwargs['params'] == {'q': 'graph', 'rank': 'A', 'year_from': '2023', 'author': 'Test', 'offset': '30', 'limit': '30', 'source': 'ccf'}
    assert get.call_args.kwargs['allow_redirects'] is False
    assert store.one('SELECT COUNT(*) n FROM papers')['n'] == 0
    path = f"/api/projects/{project['id']}/literature/catalog/collect"
    first = client.post(path, json={'catalog_id': 'remote-paper'})
    assert first.status_code == 200
    assert client.post(path, json={'catalog_id': 'remote-paper'}).json['id'] == first.json['id']
    saved = store.one('SELECT * FROM papers WHERE id=?', (first.json['id'],))
    assert saved['pdf_path'] is None and saved['metadata']['discovery'] == 'local_catalog'
    assert store.one('SELECT COUNT(*) n FROM paper_library_entries')['n'] == 1
    assert client.post(path, json={'catalog_id': 'unknown'}).status_code == 400
    get.assert_called_once()


def test_catalog_without_external_connection_searches_own_database(client, monkeypatch):
    get = Mock(side_effect=AssertionError('Unexpected network request'))
    monkeypatch.setattr('app.literature_catalog.requests.get', get)
    client.post('/api/papers', json={'title': 'Unique local database TEST'})
    result = client.get('/api/literature/search', query_string={'q': 'Unique local'})
    assert result.json['total'] == 1 and 'catalog' not in result.json
    get.assert_not_called()


def test_catalog_failure_is_explicit_and_cannot_import_arbitrary_client_papers(client, project, services, monkeypatch):
    get = connect(services, monkeypatch)
    get.side_effect = requests.ConnectionError('offline')
    response = client.get('/api/literature/search', query_string={'q': 'graph'})
    assert response.status_code == 400 and '主库服务' in response.json['error']
    result = client.post(f"/api/projects/{project['id']}/literature/catalog/collect", json={'catalog_id': 'unseen', 'title': 'Untrusted'})
    assert result.status_code == 400
    assert services['store'].one('SELECT COUNT(*) n FROM papers')['n'] == 0


@pytest.mark.parametrize('url', ['https://outside.example/api', 'http://127.0.0.1:5000/api?secret=x', 'http://user:secret@127.0.0.1/api'])
def test_catalog_rejects_nonlocal_or_credentialled_urls(client, services, monkeypatch, url):
    get = connect(services, monkeypatch)
    (services['store'].root / 'literature-catalog.json').write_text(json.dumps({'api_url': url}), 'utf-8')
    assert client.get('/api/literature/search').status_code == 400
    get.assert_not_called()


def test_chat_search_records_history_and_keeps_projects_separate(client, project, services, monkeypatch):
    store, codex = services['store'], services['codex']
    def create(pid, stage, role, context, read_only, web_search):
        assert read_only and web_search == 'disabled'
        ident = uid()
        store.execute('INSERT INTO agent_sessions(id,project_id,role,stage,status,context_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                      (ident, pid, role, stage, 'running', encode(context), now(), now()))
        return codex.session(ident)
    turn = Mock()
    monkeypatch.setattr(codex, 'create_session', create)
    monkeypatch.setattr(codex, 'turn', turn)
    path = f"/api/projects/{project['id']}/literature"
    response = client.post(path + '/assist', json={'kind': 'search', 'text': '只要近三年', 'history': ['查找图神经网络论文'], 'network': False})
    assert response.status_code == 202
    rows = client.get(path + '/searches').json['searches']
    assert rows[0]['text'] == '只要近三年' and rows[0]['network'] is False
    assert '查找图神经网络论文' in turn.call_args.args[1]
    other = client.post('/api/projects', json={'name': 'Other isolated project'}).json['project']['id']
    assert client.get(f'/api/projects/{other}/literature/searches').json['searches'] == []
    assert client.post(path + '/assist', json={'kind': 'search', 'text': 'bad', 'history': [{}]}).status_code == 400
