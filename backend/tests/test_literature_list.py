import io
import json
from unittest.mock import Mock
from pypdf import PdfWriter
import pytest
from app.local_store import encode, now, uid


def add(client, project, title, year=None, venue_id=None):
    response = client.post('/api/papers', json={'title': title, 'year': year, 'venue_id': venue_id})
    ident = response.json['id']
    client.post(f'/api/papers/{ident}/library', json={'project_id': project['id']})
    return ident


def test_composite_sort_is_applied_before_pagination_and_keeps_unknown_last(client, project, services):
    venue = services['store'].one("SELECT id FROM venues WHERE rank='A'")['id']
    a = add(client, project, 'Alpha', 2023, venue)
    b = add(client, project, 'Beta', 2023)
    c = add(client, project, 'Gamma', 2025)
    unknown = add(client, project, 'Unknown')
    query = {'source': 'all', 'project_id': project['id'], 'sort_by': 'year:asc,title:desc'}
    assert [p['id'] for p in client.get('/api/papers', query_string=query).json['papers']] == [b, a, c, unknown]
    assert client.get('/api/papers', query_string={**query, 'offset': 1, 'limit': 1}).json['papers'][0]['id'] == a
    query['sort_by'] = 'year:desc,rank:asc'
    assert [p['id'] for p in client.get('/api/papers', query_string=query).json['papers']] == [c, a, b, unknown]
    assert client.get('/api/papers', query_string={**query, 'sort_by': 'year;DROP:asc'}).status_code == 400
    assert client.get('/api/papers', query_string={**query, 'sort_by': 'year:asc,year:desc'}).status_code == 400


@pytest.fixture
def assistant(services, monkeypatch):
    codex = services['codex']; modes = []
    def create(pid, stage, role, context, read_only, web_search):
        assert read_only
        modes.append(web_search)
        ident = uid()
        services['store'].execute('INSERT INTO agent_sessions(id,project_id,role,stage,status,context_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
            (ident, pid, role, stage, 'running', encode(context), now(), now()))
        return codex.session(ident)
    monkeypatch.setattr(codex, 'create_session', create)
    monkeypatch.setattr(codex, 'turn', Mock())
    def complete(sid, output, web=True):
        if web: codex.record(sid, 'item/completed', {'item': {'type': 'webSearch', 'status': 'completed'}})
        codex.record(sid, 'item/completed', {'item': {'type': 'agentMessage', 'text': json.dumps(output)}})
        services['store'].execute("UPDATE agent_sessions SET status='completed' WHERE id=?", (sid,))
    return modes, complete


def test_network_search_requires_web_evidence_and_collects_without_duplicates(client, project, services, assistant):
    modes, complete = assistant
    existing = add(client, project, 'Graph retrieval', 2024)
    path = f"/api/projects/{project['id']}/literature/assist"
    sid = client.post(path, json={'kind': 'search', 'text': 'graph retrieval', 'network': True}).json['session_id']
    assert modes == ['live']
    output = {'q': 'graph', 'rank': '', 'year_from': None, 'year_to': None, 'author': '', 'type': '', 'venue': '', 'explanation': '图检索',
        'papers': [{'title': 'Graph retrieval', 'authors': ['Test Author'], 'year': 2024, 'venue_name': '', 'doi': '', 'url': 'https://example.org/graph'},
                   {'title': 'New network result', 'authors': ['Test Author'], 'year': 2025, 'venue_name': 'ICML', 'doi': '', 'url': 'https://example.org/new'}]}
    complete(sid, output, web=False)
    assert client.get(path + '/' + sid).status_code == 400
    services['codex'].record(sid, 'item/completed', {'item': {'type': 'webSearch', 'status': 'completed'}})
    result = client.get(path + '/' + sid).json['output']['papers']
    assert result[0]['id'] == existing and result[1]['rank'] == 'A'
    # Looking at network results must not write to the local collection.
    assert services['store'].one('SELECT COUNT(*) n FROM paper_library_entries')['n'] == 1
    assert client.post(path + '/' + sid + '/collect', json={'candidate': 0}).json['id'] == existing
    first = client.post(path + '/' + sid + '/collect', json={'candidate': 1}).json['id']
    assert client.post(path + '/' + sid + '/collect', json={'candidate': 1}).json['id'] == first
    assert services['store'].one('SELECT COUNT(*) n FROM paper_library_entries')['n'] == 2
    other = client.post('/api/projects', json={'name': 'Other'}).json['project']['id']
    assert client.post(f'/api/projects/{other}/literature/assist/{sid}/collect', json={'candidate': 1}).status_code == 400


def test_codex_pdf_download_is_validated_saved_once_and_reports_not_found(client, project, services, assistant, monkeypatch):
    modes, complete = assistant
    ident = add(client, project, 'PDF target', 2025)
    path = f"/api/projects/{project['id']}/literature/assist"
    sid = client.post(path, json={'kind': 'pdf', 'text': 'PDF target', 'paper_id': ident}).json['session_id']
    assert modes == ['live']
    complete(sid, {'candidates': [{'url': 'https://example.org/file.pdf', 'source_url': 'https://example.org/paper', 'title': 'PDF target'}], 'explanation': '公开版本'})
    writer = PdfWriter(); writer.add_blank_page(width=200, height=200); buffer = io.BytesIO(); writer.write(buffer)
    download = Mock(return_value=buffer.getvalue())
    monkeypatch.setattr('app.local_library.download_pdf', download)
    first = client.post(path + '/' + sid + '/pdf', json={})
    assert first.status_code == 200
    assert client.post(path + '/' + sid + '/pdf', json={}).json == first.json
    download.assert_called_once()
    assert client.get(f'/api/papers/{ident}/pdf').data == buffer.getvalue()
    sid2 = client.post(path, json={'kind': 'pdf', 'text': 'PDF target', 'paper_id': ident}).json['session_id']
    complete(sid2, {'candidates': [], 'explanation': '未找到公开全文'})
    response = client.post(path + '/' + sid2 + '/pdf', json={})
    assert response.status_code == 400 and '未找到' in response.json['error']


def test_network_results_respect_explicit_filters_and_remove_duplicates(client, project, services, assistant):
    _, complete = assistant
    venue = services['store'].one("SELECT id FROM venues WHERE abbreviation='ICML'")['id']
    path = f"/api/projects/{project['id']}/literature/assist"
    sid = client.post(path, json={'kind': 'search', 'text': 'graph', 'network': True,
        'filters': {'rank': 'A', 'venue_id': venue, 'year_from': '2023'}}).json['session_id']
    paper = {'title': 'Filtered result', 'authors': ['Author'], 'year': 2025, 'venue_name': 'ICML', 'doi': '', 'url': 'https://example.org/filtered'}
    complete(sid, {'q': 'graph', 'rank': '', 'year_from': None, 'year_to': None, 'author': '', 'type': '', 'venue': '', 'explanation': 'Results',
        'papers': [paper, paper, {**paper, 'title': 'Too old', 'year': 2020}, {**paper, 'title': 'Wrong venue', 'venue_name': 'Unknown'}]})
    output = client.get(path + '/' + sid).json['output']
    assert output['rank'] == 'A' and output['year_from'] == 2023
    assert output['venue_id'] == venue and len(output['papers']) == 1
    assert client.post(path + '/' + sid + '/collect', json={'candidate': 2}).status_code == 400
