import json
import os
from unittest.mock import Mock

import pytest
import requests
from app.literature_translation import DEFAULTS, TranslationSettings, translate_stream


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    # All tests use disposable credentials and transport stubs, never a live API.
    post = Mock(side_effect=AssertionError('Live API requests are forbidden in these tests'))
    monkeypatch.setattr('app.literature_translation.requests.post', post)
    return post


def test_settings_are_local_persistent_and_redacted(tmp_path, no_network):
    settings = TranslationSettings(tmp_path)
    assert settings.public() == {**DEFAULTS, 'has_key': False}
    key = 'sk-disposable-unit-test-only'
    public = settings.save({'api_key': key})
    assert public == {**DEFAULTS, 'has_key': True}
    assert key not in json.dumps(public)
    recreated = TranslationSettings(tmp_path)
    assert recreated.connection() == (DEFAULTS['base_url'], DEFAULTS['model'], key)
    if os.name == 'nt':
        assert key not in settings.path.read_text('utf-8')
    else:
        assert settings.path.stat().st_mode & 0o777 == 0o600
    recreated.save({'api_key': '', 'model': 'another-model'})
    assert recreated.connection()[2] == key
    recreated.save({'remove_key': True})
    assert recreated.public()['has_key'] is False
    with pytest.raises(ValueError, match='尚未配置'):
        recreated.connection()
    no_network.assert_not_called()


@pytest.mark.parametrize('data', [
    {'base_url': 'http://example.org/v1'}, {'base_url': 'https://user:secret@example.org/v1'},
    {'base_url': 'https://example.org/v1?key=secret'}, {'base_url': 'https://example.org/#secret'},
    {'model': ''}, {'model': 'model\nname'}, {'api_key': 'invalid\nsecret'}, {'api_key': []},
    {'remove_key': 'true'}, [],
])
def test_invalid_settings_do_not_write(tmp_path, data):
    settings = TranslationSettings(tmp_path)
    with pytest.raises(ValueError):
        settings.save(data)
    assert not settings.path.exists()


def test_changing_destination_requires_reentering_key(tmp_path):
    settings = TranslationSettings(tmp_path)
    settings.save({'api_key': 'sk-old-disposable-test'})
    with pytest.raises(ValueError, match='更换 API 地址'):
        settings.save({'base_url': 'https://example.org/v1'})
    assert settings.public()['base_url'] == DEFAULTS['base_url']
    settings.save({'base_url': 'https://example.org/v1/', 'api_key': 'sk-new-disposable-test'})
    assert settings.connection() == ('https://example.org/v1', DEFAULTS['model'], 'sk-new-disposable-test')


class ResponseStub:
    def __init__(self, events=(), status=200):
        self.status_code = status
        self.events = events
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.closed = True

    def iter_lines(self, **kwargs):
        for event in self.events:
            yield 'data: ' + json.dumps(event, ensure_ascii=False)
            yield ''


def stub_transport(monkeypatch, events=(), status=200):
    response = ResponseStub(events, status)
    post = Mock(return_value=response)
    monkeypatch.setattr('app.literature_translation.requests.post', post)
    return post, response


def test_stream_uses_only_selected_text_and_incremental_output(monkeypatch):
    post, response = stub_transport(monkeypatch, [
        {'type': 'response.output_text.delta', 'delta': '注意力'},
        {'type': 'response.output_text.delta', 'delta': '机制'},
        {'type': 'response.completed'},
    ])
    output = list(translate_stream(DEFAULTS['base_url'], DEFAULTS['model'], 'sk-test-only', 'attention mechanism'))
    assert len(output) == 3
    assert '注意力' in output[0] and '机制' in output[1] and 'event: done' in output[2]
    args, kwargs = post.call_args
    assert args == ('https://api.openai.com/v1/responses',)
    assert kwargs['json']['input'] == 'attention mechanism'
    assert kwargs['json']['stream'] is True and kwargs['json']['store'] is False
    assert kwargs['json']['reasoning'] == {'effort': 'none'}
    assert kwargs['allow_redirects'] is False
    assert 'sk-test-only' not in ''.join(output)
    assert response.closed


@pytest.mark.parametrize('status', [400, 401, 403, 404, 429, 503, 302])
def test_http_errors_are_safe_and_not_success(monkeypatch, status):
    _, response = stub_transport(monkeypatch, status=status)
    output = ''.join(translate_stream(DEFAULTS['base_url'], DEFAULTS['model'], 'sk-test-only', 'text'))
    assert 'event: error' in output and 'event: done' not in output
    assert 'sk-test-only' not in output
    assert response.closed


@pytest.mark.parametrize('event', [
    {'type': 'response.failed', 'error': {'message': 'sk-test-only'}},
    {'type': 'response.incomplete'}, {'type': 'response.refusal.done'},
])
def test_incomplete_stream_does_not_claim_completion(monkeypatch, event):
    stub_transport(monkeypatch, [{'type': 'response.output_text.delta', 'delta': '部分译文'}, event])
    output = ''.join(translate_stream(DEFAULTS['base_url'], DEFAULTS['model'], 'sk-test-only', 'text'))
    assert '部分译文' in output and 'event: error' in output and 'event: done' not in output
    assert 'sk-test-only' not in output


def test_timeout_and_disconnect_are_handled(monkeypatch):
    monkeypatch.setattr('app.literature_translation.requests.post', Mock(side_effect=requests.Timeout('sk-test-only')))
    output = ''.join(translate_stream(DEFAULTS['base_url'], DEFAULTS['model'], 'sk-test-only', 'text'))
    assert '超时' in output and 'sk-test-only' not in output
    _, response = stub_transport(monkeypatch, [{'type': 'response.output_text.delta', 'delta': '译文'}])
    stream = translate_stream(DEFAULTS['base_url'], DEFAULTS['model'], 'sk-test-only', 'text')
    next(stream)
    stream.close()
    assert response.closed


def test_settings_routes_and_missing_key_do_not_start_codex(client, services, no_network):
    assert client.get('/api/settings/translation').json['settings']['has_key'] is False
    ident = client.post('/api/papers', json={'title': 'Translation TEST paper'}).json['id']
    result = client.post(f'/api/papers/{ident}/translate', json={'text': 'Test excerpt'})
    assert result.status_code == 409 and 'API Key' in result.json['error']
    saved = client.put('/api/settings/translation', json={'api_key': 'sk-test-only'})
    assert saved.status_code == 200 and saved.json['settings']['has_key'] is True
    assert 'sk-test-only' not in saved.get_data(as_text=True)
    assert saved.headers['Cache-Control'] == 'no-store'
    assert services['store'].one('SELECT COUNT(*) AS n FROM agent_sessions')['n'] == 0
    no_network.assert_not_called()


def test_translation_route_streams_and_rejects_bad_input(client, monkeypatch):
    client.put('/api/settings/translation', json={'api_key': 'sk-test-only'})
    ident = client.post('/api/papers', json={'title': 'Translation TEST paper'}).json['id']
    for text in ['', None, 'x' * 16001]:
        assert client.post(f'/api/papers/{ident}/translate', json={'text': text}).status_code == 400
    stub_transport(monkeypatch, [{'type': 'response.output_text.delta', 'delta': '译文'}, {'type': 'response.completed'}])
    result = client.post(f'/api/papers/{ident}/translate', json={'text': 'text'})
    assert result.mimetype == 'text/event-stream'
    assert '译文' in result.get_data(as_text=True) and 'event: done' in result.get_data(as_text=True)
