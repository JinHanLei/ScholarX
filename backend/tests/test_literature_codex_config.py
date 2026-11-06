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


def test_search_configuration_and_version_workspace_coexist(services, project, monkeypatch):
    from pathlib import Path
    workspace = Path(project['root_path']) / 'version-source'
    workspace.mkdir()
    calls = []
    adapter = services['codex']
    def rpc(method, params):
        calls.append((method, params))
        return {'thread': {'id': 'version-search-thread'}}
    monkeypatch.setattr(adapter, 'rpc', rpc)
    session = adapter.create_session(project['id'], workspace=str(workspace), web_search='live')
    assert Path(calls[0][1]['cwd']) == workspace
    assert calls[0][1]['config'] == {'web_search': 'live'}
    assert adapter.context(session, [])['project_root'] == str(workspace)
    adapter.resume(session['id'])
    assert calls[-1][1]['config'] == {'web_search': 'live'}
