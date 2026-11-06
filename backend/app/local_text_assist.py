"""Shared structured-result transport for selection translation and paper assistance."""
import json
import jsonschema


def assist_result(store, codex, pid, sid, schema):
    session = codex.session(sid)
    if session['project_id'] != pid:
        raise ValueError('会话不属于当前项目')
    result = {'status': session['status'], 'error': session.get('error'), 'session_id': sid}
    if session['status'] in {'running', 'starting'}:
        event = store.one("SELECT payload_json FROM agent_messages WHERE session_id=? AND event='error' ORDER BY id DESC LIMIT 1", (sid,))
        if event:
            payload = event['payload']; message = payload.get('error', {}).get('message', '')
            if payload.get('willRetry'):
                result['notice'] = 'Codex 连接中断，正在重试：' + message
            else:
                result.update(status='failed', error=message or 'Codex 请求失败')
    if session['status'] == 'completed':
        messages = store.all("SELECT * FROM agent_messages WHERE session_id=? AND event='item/completed' ORDER BY id DESC", (sid,))
        raw = next((m['payload']['item'].get('text', '') for m in messages if m['payload'].get('item', {}).get('type') == 'agentMessage'), '')
        try:
            output = json.loads(raw)
            jsonschema.validate(output, schema)
        except (ValueError, jsonschema.ValidationError):
            raise ValueError('Codex 未返回有效结构化结果，请重试或查看会话')
        result['output'] = output
    return result
