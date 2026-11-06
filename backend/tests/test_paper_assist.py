import pytest
from app.local_store import uid, now, encode
from app.local_paper_assist import utf16_slice


@pytest.fixture
def fake_codex(services, monkeypatch):
    store, codex = services['store'], services['codex']
    turns = []
    def create(pid, stage, role, context, read_only=False):
        assert read_only is True
        sid = uid()
        store.execute('INSERT INTO agent_sessions(id,project_id,role,stage,status,context_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                      (sid, pid, role, stage, 'running', encode(context), now(), now()))
        return codex.session(sid)
    monkeypatch.setattr(codex, 'create_session', create)
    monkeypatch.setattr(codex, 'turn', lambda *a, **k: turns.append((a, k)))
    def complete(sid, output):
        store.execute("UPDATE agent_sessions SET status='completed' WHERE id=?", (sid,))
        codex.record(sid, 'item/completed', {'item': {'type': 'agentMessage', 'text': encode(output)}})
    return complete, turns


def imported(client, project):
    return client.post(f"/api/projects/{project['id']}/paper/import", json={'filename': 'test.tex',
        'source': '\\begin{document}\n\\section{Intro}\n\n😀 repeat repeat end.\n\nSecond paragraph.\n\\end{document}'}).json


def test_revision_uses_exact_utf16_offsets_and_conflict_check(client, project, services, fake_codex):
    complete, turns = fake_codex
    doc = imported(client, project); p = doc['paragraphs'][1]
    base = f"/api/projects/{project['id']}/paper/assist"
    data = {'kind': 'revise', 'path': doc['path'], 'expected_hash': doc['sha256'], 'paragraph_id': p['id'],
            'text': 'repeat', 'start': 10, 'end': 16, 'instruction': 'Make this precise'}
    r = client.post(base, json=data); assert r.status_code == 202, r.json
    sid = r.json['session_id']; complete(sid, {'replacement': 'revised', 'explanation': 'Precise wording'})
    assert turns[0][1]['output_schema']['properties']['replacement']
    other = client.post('/api/projects', json={'name': 'other'}).json['project']
    assert client.get(f"/api/projects/{other['id']}/paper/assist/{sid}").status_code == 400
    assert client.post(f'{base}/{sid}/apply', json={'replacement': '% easyref:paragraph:injected'}).status_code == 400
    applied = client.post(f'{base}/{sid}/apply', json={'replacement': 'revised'})
    assert applied.status_code == 200, applied.json
    assert applied.json['paragraphs'][1]['content'] == '😀 repeat revised end.'
    assert [p['id'] for p in applied.json['paragraphs']] == [p['id'] for p in doc['paragraphs']]
    assert applied.json['paragraphs'][2]['content'] == doc['paragraphs'][2]['content']
    assert client.post(f'{base}/{sid}/apply', json={'replacement': 'again'}).status_code == 400
    assert client.post(base, json={**data, 'text': 'wrong'}).status_code == 400


def test_utf16_rejects_surrogate_split():
    assert utf16_slice('😀a', 2, 3) == ('😀', 'a', '')
    with pytest.raises(ValueError): utf16_slice('😀a', 1, 2)


def test_plan_requires_real_venue_references_then_confirmation(client, project, services, fake_codex, monkeypatch):
    complete, turns = fake_codex
    class Response:
        def raise_for_status(self): pass
        def json(self): return {'message': {'items': [
            {'DOI': '10.1234/good', 'title': ['Graph methods'], 'container-title': ['Target Journal'], 'published': {'date-parts': [[2025]]}},
            {'DOI': '10.1234/wrong', 'title': ['Unrelated venue'], 'container-title': ['Other Journal']}]}}
    monkeypatch.setattr('app.local_paper_assist.requests.get', lambda *a, **k: Response())
    base = f"/api/projects/{project['id']}/paper/assist"
    r = client.post(base, json={'kind': 'plan', 'topic': 'graph methods', 'venue': 'Target Journal'})
    assert r.status_code == 202, r.json
    sid = r.json['session_id']
    plan = {'title': 'Graph Study', 'sections': [{'title': 'Introduction', 'paragraphs': [
        {'purpose': 'Explain gap', 'main_claim': 'Gap', 'evidence_needed': 'Need experiment', 'references': ['10.1234/good']}]},
        {'title': 'Method', 'paragraphs': [{'purpose': 'Explain method', 'main_claim': 'Method', 'evidence_needed': 'Proof', 'references': []}]}]}
    complete(sid, plan)
    result = client.get(f'{base}/{sid}').json
    assert [w['id'] for w in result['references']] == ['10.1234/good']
    assert services['paper'].files(project['id']) == []
    assert client.post(base, json={'kind': 'draft', 'plan_session_id': sid}).status_code == 400
    forged = {**plan, 'sections': [{'title': 'Bad', 'paragraphs': [{**plan['sections'][0]['paragraphs'][0], 'references': ['made-up']}]}]}
    assert client.post(base, json={'kind': 'draft', 'confirmed': True, 'plan_session_id': sid, 'plan': forged}).status_code == 400
    draft = client.post(base, json={'kind': 'draft', 'confirmed': True, 'plan_session_id': sid, 'plan': plan})
    assert draft.status_code == 202, draft.json
    dsid = draft.json['session_id']; complete(dsid, {'paragraphs': ['Gap remains. [TODO: evidence required]', 'Method needs validation.']})
    saved = client.post(f'{base}/{dsid}/apply', json={'filename': 'main.tex'})
    assert saved.status_code == 200, saved.json
    assert [p['section'] for p in saved.json['paragraphs'][:2]] == ['Introduction', 'Method']
    assert saved.json['paragraphs'][0]['outline']['purpose'] == 'Explain gap'
    assert '\\cite{ref1}' in saved.json['source']
    assert client.post(f'{base}/{dsid}/apply', json={'filename': 'main.tex'}).status_code == 400


def test_empty_results_never_start_plan(client, project, fake_codex, monkeypatch):
    class Empty:
        def raise_for_status(self): pass
        def json(self): return {'message': {'items': []}}
    monkeypatch.setattr('app.local_paper_assist.requests.get', lambda *a, **k: Empty())
    result = client.post(f"/api/projects/{project['id']}/paper/assist", json={'kind': 'plan', 'topic': 'graph', 'venue': 'Missing'})
    assert result.status_code == 400
    assert fake_codex[1] == []


def test_translation_still_uses_shared_result_contract(client, project, fake_codex):
    complete, _ = fake_codex
    paper = client.post('/api/papers', json={'title': 'Translation TEST DATA'}).json['id']
    base = f"/api/projects/{project['id']}/literature/assist"
    started = client.post(base, json={'kind': 'translate', 'text': 'Research evidence', 'paper_id': paper})
    assert started.status_code == 202, started.json
    sid = started.json['session_id']; complete(sid, {'translation': '研究证据'})
    assert client.get(f'{base}/{sid}').json['output'] == {'translation': '研究证据'}
    assert client.get(f"/api/projects/{project['id']}/paper/assist/{sid}").status_code == 400
