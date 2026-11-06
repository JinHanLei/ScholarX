"""EasyRef-owned skill catalog and versioned research entrypoint."""
import json
from pathlib import Path
from .local_store import atomic_write, encode, inside, now

SKILL = Path(__file__).resolve().parents[1] / 'skills' / 'easyref-research' / 'SKILL.md'
PHASES = ('problem', 'literature', 'protocol', 'experiments', 'review', 'paper')


def catalog(store, pid=None):
    path = str(SKILL.resolve())
    return {'skills': [{'name': 'easyref-research', 'path': path, 'stage': '全流程',
        'description': 'EasyRef 内置：研究问题与投稿目标 → 文献 → 协议 → 实验 → 审查 → 论文',
        'available': SKILL.is_file(), 'enabled': True, 'source': 'easyref',
        'input_requirements': '第一步必须明确研究问题与目标期刊/会议；沿用项目已保存的选择。',
        'expected_output': '可恢复流程记录、文献证据、实验协议、真实 Run、审查记录与论文草稿。',
        'runs': store.all('SELECT r.* FROM skill_runs r JOIN agent_sessions s ON s.id=r.session_id WHERE r.skill_path=? AND s.project_id=? ORDER BY r.created_at DESC LIMIT 10', (path,pid)) if pid else []}], 'errors': []}


def brief(store, pid):
    project = store.project(pid)
    ident = project['settings'].get('research_brief_id')
    if ident:
        try:
            component = store.component(ident, pid)
            return {'component': component, **component['data']}
        except ValueError:
            pass  # A branch may not contain the entrypoint from another branch.
    return {'research_question': '', 'target_venue': ''}


def save_brief(store, pid, data):
    question = data.get('research_question', '')
    venue = data.get('target_venue', '')
    if not isinstance(question, str) or not question.strip():
        raise ValueError('第一步请明确研究问题')
    if not isinstance(venue, str) or not venue.strip():
        raise ValueError('第一步请选择目标期刊或会议')
    previous = brief(store, pid).get('component')
    content = {**(previous['data'] if previous else {}),
               'research_question': question.strip(), 'target_venue': venue.strip()}
    component = store.save_component(pid, 'idea', previous['name'] if previous else '研究问题与投稿目标', content,
        previous['id'] if previous else None, data.get('expected_revision'), '明确研究问题与投稿目标')
    project = store.project(pid)
    settings = {**project['settings'], 'research_brief_id': component['id']}
    store.execute('UPDATE projects SET settings_json=?,updated_at=? WHERE id=?', (encode(settings), now(), pid))
    sync_brief(store, pid)
    return brief(store, pid)


def sync_brief(store, pid):
    value = brief(store, pid)
    if value.get('component'):
        atomic_write(inside(store.project(pid)['root_path'], 'research/brief.json'), encode(value))
    return value


def progress(store, pid):
    root = store.project(pid)['root_path']
    path = inside(root, 'research/workflow.json')
    if not path.exists(): return {'phases': {}, 'available': False}
    value = json.loads(path.read_text('utf-8'))
    if not isinstance(value, dict) or not isinstance(value.get('phases'), dict):
        raise ValueError('流程记录格式无效')
    for key, phase in value['phases'].items():
        if key not in PHASES or not isinstance(phase, dict): raise ValueError('流程阶段无效')
        if phase.get('status') not in {'pending', 'running', 'completed', 'blocked'}: raise ValueError('流程状态无效')
        artifacts = phase.get('artifacts', [])
        if not isinstance(artifacts, list) or not all(isinstance(p, str) for p in artifacts): raise ValueError('流程产物必须为路径列表')
        phase['missing_artifacts'] = [p for p in artifacts if not inside(root, p).is_file()]
        if phase['status'] == 'completed' and (not artifacts or phase['missing_artifacts']):
            phase['status'] = 'blocked'
            phase['summary'] = '完成声明缺少可验证产物；请检查流程记录'
    current = brief(store, pid)
    value['stale'] = any(value.get(k) != current.get(k) for k in ('research_question', 'target_venue'))
    return {**value, 'available': True}
