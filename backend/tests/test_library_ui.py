import io
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from app.local_library import download_pdf
from app.local_store import encode, now, uid


def add(client, project, title, year=2024):
    paper = client.post('/api/papers', json={'title': title, 'year': year}).json['id']
    assert client.post(f'/api/papers/{paper}/library', json={'project_id': project['id']}).status_code == 200
    return paper


def test_collection_pin_archive_restore_isolated(client, project, services):
    a = add(client, project, 'Earlier paper', 2020)
    b = add(client, project, 'Later paper', 2025)
    other = client.post('/api/projects', json={'name': 'Other project'}).json['project']
    base = f"/api/projects/{project['id']}/library/{a}"
    params = {'project_id': project['id'], 'source': 'all', 'sort': 'year'}
    assert [p['id'] for p in client.get('/api/papers', query_string=params).json['papers']] == [b, a]
    assert client.patch(base, json={'pinned': True}).status_code == 200
    assert client.post(f'/api/papers/{a}/library', json={'project_id': project['id'], 'notes': 'Keep this note'}).status_code == 200
    assert client.get('/api/papers', query_string=params).json['papers'][0]['id'] == a
    assert client.patch(base, json={'archived': True}).status_code == 200
    assert client.get('/api/papers', query_string=params).json['total'] == 1
    archived = client.get('/api/papers', query_string={**params, 'archived': '1'}).json['papers']
    assert archived[0]['id'] == a and archived[0]['pinned'] == 1
    assert client.patch(f"/api/projects/{other['id']}/library/{a}", json={'archived': False}).status_code == 400
    assert client.post(f'/api/papers/{a}/library', json={'project_id': project['id']}).status_code == 200
    entry = client.get('/api/papers', query_string=params).json['papers'][0]
    assert entry['pinned'] == 1
    assert services['store'].one('SELECT notes FROM paper_library_entries WHERE project_id=? AND paper_id=?', (project['id'], a))['notes'] == 'Keep this note'
    assert client.get('/api/papers', query_string=params).json['total'] == 2
    assert client.get('/api/papers', query_string={**params, 'year_from': 2022, 'year_to': 2026}).json['papers'][0]['id'] == b


def test_pdf_upload_and_link_share_deduplicated_storage(client, project, services, monkeypatch):
    a = add(client, project, 'PDF paper')
    b = add(client, project, 'Another paper')
    content = b'%PDF-1.4\nTEST PDF ATTACHMENT\n%%EOF'
    uploaded = client.post(f'/api/papers/{a}/pdf', data={'file': (io.BytesIO(content), 'paper.pdf')})
    assert uploaded.status_code == 200
    monkeypatch.setattr('app.local_library.download_pdf', lambda url: content)
    linked = client.post(f'/api/papers/{b}/pdf-link', json={'url': 'https://example.org/paper.pdf'})
    assert linked.status_code == 200
    assert uploaded.json['pdf_path'] == linked.json['pdf_path']
    assert Path(linked.json['pdf_path']).parent == services['store'].root/'pdfs'
    assert client.get(f'/api/papers/{b}/pdf').data == content
    monkeypatch.setattr('app.local_library.download_pdf', lambda url: b'<html>Not a PDF</html>')
    assert client.post(f'/api/papers/{b}/pdf-link', json={'url': 'https://example.org/article'}).status_code == 400
    assert client.get(f'/api/papers/{b}/pdf').data == content


def test_pdf_link_rejects_local_addresses(monkeypatch):
    monkeypatch.setattr('socket.getaddrinfo', lambda *args, **kwargs: [(2,1,6,'',('127.0.0.1',80))])
    with pytest.raises(ValueError, match='内网'): download_pdf('http://localhost/private.pdf')
    with pytest.raises(ValueError): download_pdf('file:///etc/passwd')


def test_codex_literature_helpers_use_read_only_sessions(client, project, services, monkeypatch):
    codex = services['codex']; calls = []
    def create(pid, stage, role, context, read_only):
        assert read_only and stage == 'Literature'
        ident = uid()
        services['store'].execute('INSERT INTO agent_sessions(id,project_id,role,stage,status,context_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)', (ident,pid,role,stage,'running',encode(context),now(),now()))
        return codex.session(ident)
    monkeypatch.setattr(codex, 'create_session', create)
    monkeypatch.setattr(codex, 'turn', lambda *args, **kwargs: calls.append((args, kwargs)))
    response = client.post(f"/api/projects/{project['id']}/literature/assist", json={'kind': 'search', 'text': 'Find graph neural networks since 2022'})
    assert response.status_code == 202
    sid = response.json['session_id']
    codex.record(sid, 'error', {'error': {'message': 'request timed out'}, 'willRetry': True})
    retry = client.get(f"/api/projects/{project['id']}/literature/assist/{sid}").json
    assert retry['status'] == 'running' and '正在重试' in retry['notice']
    output = {'q': 'graph neural', 'rank': 'A', 'year_from': 2022, 'year_to': None, 'author': '', 'type': 'Conference', 'venue': '', 'explanation': '图神经网络'}
    services['store'].execute("UPDATE agent_sessions SET status='completed' WHERE id=?", (sid,))
    codex.record(sid, 'item/completed', {'item': {'type': 'agentMessage', 'text': json.dumps(output)}})
    result = client.get(f"/api/projects/{project['id']}/literature/assist/{sid}")
    assert result.status_code == 200 and result.json['output'] == output
    assert calls[0][1]['output_schema']['additionalProperties'] is False
    paper = add(client, project, 'Translation paper')
    assert client.post(f"/api/projects/{project['id']}/literature/assist", json={'kind': 'translate', 'text': 'Evidence supports the hypothesis.', 'paper_id': paper}).status_code == 202
    assert calls[-1][0][2] == [{'kind': 'paper', 'id': paper}]


def test_dblp_update_reuses_downloader_and_skips_unchanged_snapshot(services, monkeypatch):
    updater = services['dblp_update']; literature = services['literature']; store = services['store']
    source = Path(__file__).resolve().parents[2]/'dblp/dblp.xml'
    store.execute('INSERT INTO import_jobs(id,source_path,fingerprint,status,created_at,updated_at) VALUES(?,?,?,?,?,?)', (uid(),str(source),'known','completed',now(),now()))
    monkeypatch.setattr(literature, 'fingerprint', lambda path: 'known')
    runner = Mock(return_value=SimpleNamespace(returncode=2))
    monkeypatch.setattr('app.local_library.subprocess.run', runner)
    importer = Mock(); monkeypatch.setattr(literature, 'start_import', importer)
    updater.run()
    assert updater.status()['status'] == 'completed'
    assert runner.call_args.args[0][2].endswith('download_dblp.py')
    importer.assert_not_called()
    runner.return_value.returncode = 0
    importer.return_value = {'id': 'new-job'}
    updater.run()
    importer.assert_called_once_with(str(source))
    assert updater.state['job_id'] == 'new-job'
