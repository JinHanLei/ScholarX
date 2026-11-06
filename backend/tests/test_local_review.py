"""Rebuttal orchestration with deterministic Codex transport fixtures, no live user data."""
import json
import threading
import time
import pytest
from app.local_store import encode, now, uid


SOURCE = 'Reviewer 1\nClarify the evaluation split.\nReviewer 2\nAdd a new dataset.'


def wait_review(service, ident):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        value = service.get(ident)
        if value['status'] != 'running':
            return value
        time.sleep(.01)
    raise AssertionError('Review did not finish')


def fake_codex(services, monkeypatch, defect=None, gate=None):
    store, codex = services['store'], services['codex']
    calls = []

    def create(pid, stage, role, context, read_only):
        if defect == 'startup':
            raise ValueError('Codex offline')
        ident = uid()
        store.execute('INSERT INTO agent_sessions(id,project_id,role,stage,status,context_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',
                      (ident, pid, role, stage, 'idle', encode(context), now(), now()))
        calls.append(read_only)
        return codex.session(ident)

    def turn(ident, prompt, selected, output_schema):
        if gate is not None:
            store.execute("UPDATE agent_sessions SET status='running' WHERE id=?", (ident,))
            gate.set()
            return
        if 'comments' in output_schema['properties']:
            output = {'summary': 'Two requests', 'comments': [
                {'reviewer': 'Reviewer 1', 'original': 'Clarify the evaluation split.', 'request': 'Explain split', 'action': 'Read protocol'},
                {'reviewer': 'Reviewer 2', 'original': 'Add a new dataset.', 'request': 'New data', 'action': 'Find dataset'},
            ]}
            if defect == 'quote':
                output['comments'][0]['original'] = 'Invented criticism'
        elif 'responses' in output_schema['properties']:
            comments = json.loads(prompt.split('\nComments:\n')[1])
            output = {'summary': 'One draft, one blocked', 'responses': [
                {'id': c['id'], 'response': 'Thank you for the comment.', 'evidence': 'paper/main.tex, section 3',
                 'changes': 'No changes needed' if i == 0 else 'None', 'validation': 'Read protocol',
                 'status': 'drafted' if i == 0 else 'blocked', 'blocker': '' if i == 0 else 'Dataset missing'}
                for i, c in enumerate(comments)
            ]}
            if defect == 'coverage': output['responses'].pop()
            if defect == 'duplicate': output['responses'][1]['id'] = output['responses'][0]['id']
            if defect == 'evidence': output['responses'][0]['evidence'] = ''
        else:
            output = {'summary': 'No issues', 'issues': []}
        codex.record(ident, 'item/completed', {'item': {'type': 'agentMessage', 'text': json.dumps(output)}})
        store.execute("UPDATE agent_sessions SET status='completed' WHERE id=?", (ident,))

    def interrupt(ident):
        store.execute("UPDATE agent_sessions SET status='interrupted' WHERE id=?", (ident,))

    monkeypatch.setattr(codex, 'create_session', create)
    monkeypatch.setattr(codex, 'turn', turn)
    monkeypatch.setattr(codex, 'interrupt', interrupt)
    return calls


def test_rebuttal_automatically_populates_and_edits_persist(client, services, project, monkeypatch):
    calls = fake_codex(services, monkeypatch)
    r = client.post(f"/api/projects/{project['id']}/reviews", json={'source': SOURCE})
    assert r.status_code == 202
    review = wait_review(services['reviews'], r.json['review']['id'])
    assert review['status'] == 'completed'
    assert calls == [True, False]
    assert review['scope']['source'] == SOURCE
    assert [r['status'] for r in review['scope']['responses']] == ['drafted', 'blocked']
    assert review['issues'] == []
    assert len(review['sessions']) == 2
    scope = review['scope']
    item = scope['responses'][0]
    payload = {'revision': scope['revision'], 'responses': [{'id': item['id'], 'response': 'Edited response', 'original': 'overwrite attempt'}]}
    saved = client.patch(f"/api/reviews/{review['id']}/responses", json=payload)
    assert saved.status_code == 200
    assert saved.json['review']['scope']['responses'][0]['original'] == item['original']
    assert client.get(f"/api/reviews/{review['id']}").json['review']['scope']['responses'][0]['response'] == 'Edited response'
    assert client.patch(f"/api/reviews/{review['id']}/responses", json=payload).status_code == 400


@pytest.mark.parametrize('defect', ['startup', 'quote', 'coverage', 'duplicate', 'evidence'])
def test_failures_preserve_source_and_error(services, project, monkeypatch, defect):
    fake_codex(services, monkeypatch, defect)
    review = services['reviews'].start(project['id'], {'source': SOURCE})
    result = wait_review(services['reviews'], review['id'])
    assert result['status'] == 'failed'
    assert result['scope']['source'] == SOURCE
    assert result['scope']['error']
    if defect in {'coverage', 'duplicate', 'evidence'}:
        assert len(result['scope']['responses']) == 2
        assert all(r['status'] == 'pending' for r in result['scope']['responses'])


def test_stop_interrupts_codex_and_prevents_concurrent_runs(client, services, project, monkeypatch):
    gate = threading.Event()
    fake_codex(services, monkeypatch, gate=gate)
    service = services['reviews']
    review = service.start(project['id'], {'source': SOURCE})
    assert gate.wait(3)
    assert client.post(f"/api/projects/{project['id']}/reviews", json={'mode': 'adversarial'}).status_code == 400
    assert client.patch(f"/api/reviews/{review['id']}/responses", json={}).status_code == 400
    service.stop(review['id'])
    result = wait_review(service, review['id'])
    assert result['status'] == 'interrupted'
    assert services['codex'].session(result['sessions'][0])['status'] == 'interrupted'


def test_adversarial_is_explicit_and_separate(client, services, project, monkeypatch):
    calls = fake_codex(services, monkeypatch)
    assert client.post(f"/api/projects/{project['id']}/reviews", json={}).status_code == 400
    r = client.post(f"/api/projects/{project['id']}/reviews", json={'mode': 'adversarial', 'roles': ['Methodology Reviewer']})
    review = wait_review(services['reviews'], r.json['review']['id'])
    assert review['status'] == 'completed'
    assert review['scope']['mode'] == 'adversarial'
    assert calls == [True]


@pytest.mark.parametrize('data', [{'source': '   '}, {'source': []}, {'source': 'x', 'language': 'bad'}, {'source': 'x', 'language': []}, {'source': 'x', 'max_seconds': 0}, {'source': 'x', 'max_seconds': None}, {'source': 'x', 'max_seconds': 30.5}, {'mode': 'unknown'}])
def test_input_validation(client, project, data):
    assert client.post(f"/api/projects/{project['id']}/reviews", json=data).status_code == 400
