import pytest


@pytest.mark.parametrize('mode', [None, 'disabled', 'live'])
def test_web_search_is_scoped_to_session_and_survives_resume(services, project, monkeypatch, mode):
    adapter = services['codex']
    calls = []
    def rpc(method, params):
        calls.append((method, params))
        return {'thread': {'id': 'scoped-thread'}}
    monkeypatch.setattr(adapter, 'rpc', rpc)
    session = adapter.create_session(project['id'], read_only=True, web_search=mode)
    assert calls[0][1]['sandbox'] == 'read-only'
    if mode is None:
        assert 'config' not in calls[0][1]
    else:
        assert calls[0][1]['config'] == {'web_search': mode}
        assert session['context']['web_search'] == mode
    adapter.resume(session['id'])
    assert calls[-1][1].get('config') == calls[0][1].get('config')
