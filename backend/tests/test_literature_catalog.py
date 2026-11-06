import json
from unittest.mock import Mock

import pytest
import requests


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


def test_search_selection_is_project_scoped_and_excludes_archived_papers(client, project):
    other = client.post('/api/projects', json={'name': 'Other collection'}).json['project']['id']
    ids = {name: client.post('/api/papers', json={'title': name + ' graph', 'year': 2024}).json['id']
           for name in ('Selected', 'Archived', 'Other', 'Uncollected')}
    for name, pid in [('Selected', project['id']), ('Archived', project['id']), ('Other', other)]:
        assert client.post(f"/api/papers/{ids[name]}/library", json={'project_id': pid}).status_code == 200
    assert client.patch(f"/api/projects/{project['id']}/library/{ids['Archived']}", json={'archived': True}).status_code == 200
    query = {'q': 'graph', 'project_id': project['id']}
    result = client.get('/api/literature/search', query_string=query).json
    assert result['total'] == 4 and result['selected_total'] == 1
    assert {p['id'] for p in result['papers'] if p['in_library']} == {ids['Selected']}
    page = client.get('/api/literature/search', query_string={**query, 'sort': 'title', 'offset': 1, 'limit': 1}).json
    assert page['selected_total'] == 1 and len(page['papers']) == 1
    assert not page['papers'][0]['in_library']
    filtered = client.get('/api/literature/search', query_string={**query, 'year_from': 2025}).json
    assert filtered['selected_total'] == 0
    result = client.get('/api/literature/search', query_string={**query, 'project_id': other}).json
    assert result['selected_total'] == 1
    assert {p['id'] for p in result['papers'] if p['in_library']} == {ids['Other']}
    # Restoring an archived paper makes it selected on the next search.
    client.post(f"/api/papers/{ids['Archived']}/library", json={'project_id': project['id']})
    assert client.get('/api/literature/search', query_string=query).json['selected_total'] == 2


def test_catalog_selection_matches_persisted_identity_across_pages_and_projects(client, project, services, monkeypatch):
    originals = [
        {'title': 'Graph original DOI', 'doi': '10.1234/selection', 'year': 2024},
        {'title': 'Graph original key', 'dblp_key': 'conf/test/selection', 'year': 2024},
    ]
    for paper in originals:
        ident = client.post('/api/papers', json=paper).json['id']
        client.post(f'/api/papers/{ident}/library', json={'project_id': project['id']})
    connect(services, monkeypatch, [
        {'id': 'remote-doi', 'title': 'Graph different title DOI', 'authors': [], 'doi': originals[0]['doi']},
        {'id': 'remote-key', 'title': 'Graph different title key', 'authors': [], 'dblp_key': originals[1]['dblp_key']},
    ], total=101)
    query = {'q': 'graph', 'project_id': project['id'], 'offset': 30, 'limit': 30}
    result = client.get('/api/literature/search', query_string=query).json
    assert result['papers'] == [] and result['selected_total'] == 2
    assert all(p['in_library'] for p in result['catalog']['papers'])
    other = client.post('/api/projects', json={'name': 'Empty collection'}).json['project']['id']
    result = client.get('/api/literature/search', query_string={**query, 'project_id': other}).json
    assert result['selected_total'] == 0
    assert not any(p['in_library'] for p in result['catalog']['papers'])
    result = client.get('/api/literature/search', query_string={'q': 'graph'}).json
    assert result['selected_total'] == 0
    assert not any(p['in_library'] for p in result['catalog']['papers'])
