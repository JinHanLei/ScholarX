"""Validated vector figures and immutable discussion records owned by Idea."""
import math
import re
from uuid import UUID
from .local_idea_pptx import clean_presentation


def clean_figure(value):
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError('论文模型图必须为结构化对象')

    def number(obj, key, default=None, low=0, high=4000):
        n = obj.get(key, default)
        if not isinstance(n, (int, float)) or isinstance(n, bool) or not math.isfinite(n) or not low <= n <= high:
            raise ValueError(f'论文图 {key} 数值无效')
        return n

    def string(obj, key, default='', limit=5000):
        s = obj.get(key, default)
        if not isinstance(s, str) or len(s) > limit:
            raise ValueError(f'论文图 {key} 文本无效')
        return s

    def color(obj, key, default):
        s = obj.get(key, default)
        if not isinstance(s, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}|none', s):
            raise ValueError('论文图仅支持十六进制颜色或 none')
        return s

    width, height = number(value, 'width', low=100), number(value, 'height', low=100)
    source_hash = string(value, 'source_hash', limit=64)
    if source_hash and not re.fullmatch(r'[0-9a-f]{64}', source_hash):
        raise ValueError('论文图来源标记无效')
    if value.get('presentation') is not None:
        return {'width': width, 'height': height, 'title': string(value, 'title', limit=300),
                'caption': string(value, 'caption'), 'source_hash': source_hash,
                'presentation': clean_presentation(value['presentation'])}
    elements = value.get('elements')
    if not isinstance(elements, list) or not 1 <= len(elements) <= 1000:
        raise ValueError('论文图需要 1 至 1000 个矢量元素')
    clean, ids = [], set()
    for element in elements:
        if not isinstance(element, dict): raise ValueError('论文图元素无效')
        ident, kind = string(element, 'id', limit=100), element.get('type')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', ident) or ident in ids:
            raise ValueError('论文图元素 ID 无效或重复')
        ids.add(ident)
        if kind not in {'rect', 'ellipse', 'text', 'line', 'polyline'}:
            raise ValueError('论文图不支持此元素类型')
        item = {'id': ident, 'type': kind, 'fill': color(element, 'fill', 'none'),
                'stroke': color(element, 'stroke', '#334155'), 'strokeWidth': number(element, 'strokeWidth', 1.5, high=12),
                'dash': bool(element.get('dash', False)), 'node_id': string(element, 'node_id', limit=100)}
        if kind in {'line', 'polyline'}:
            points = element.get('points')
            if not isinstance(points, list) or not 2 <= len(points) <= 500 or (kind == 'line' and len(points) != 2):
                raise ValueError('论文图线段需要有效坐标点')
            item['points'] = []
            for point in points:
                if not isinstance(point, list) or len(point) != 2: raise ValueError('论文图坐标点无效')
                item['points'].append([number({'v': point[0]}, 'v', high=width), number({'v': point[1]}, 'v', high=height)])
            item['arrowEnd'] = bool(element.get('arrowEnd', False))
        else:
            item.update(x=number(element, 'x', high=width), y=number(element, 'y', high=height),
                        width=number(element, 'width', low=1, high=width), height=number(element, 'height', low=1, high=height))
            if item['x'] + item['width'] > width or item['y'] + item['height'] > height:
                raise ValueError('论文图元素超出画幅')
            if kind == 'rect': item['radius'] = number(element, 'radius', 0, high=50)
            if kind == 'text':
                item.update(text=string(element, 'text', limit=3000), fontSize=number(element, 'fontSize', 16, low=8, high=80),
                            bold=bool(element.get('bold', False)), align=element.get('align', 'left'), color=color(element, 'color', '#1e293b'))
                if item['align'] not in {'left', 'center', 'right'}: raise ValueError('论文图文本对齐无效')
        clean.append(item)
    return {'width': width, 'height': height, 'title': string(value, 'title', limit=300),
            'caption': string(value, 'caption'), 'source_hash': source_hash, 'elements': clean}


def clean_record(value, service, pid, ident):
    if not isinstance(value, dict): raise ValueError('请提供研究记录')
    try: key = str(UUID(value.get('id', '')))
    except (ValueError, TypeError, AttributeError): raise ValueError('研究记录需要稳定 UUID，重试时复用同一 ID')
    kind = value.get('kind', 'decision')
    if kind not in {'decision', 'conclusion'}: raise ValueError('研究记录类型无效')
    data = {'kind': kind}
    for field in ('title', 'change', 'reason', 'validation', 'conclusion', 'source'):
        text = value.get(field, '')
        if not isinstance(text, str) or len(text) > (300 if field == 'title' else 10000):
            raise ValueError('研究记录字段过长或格式无效')
        data[field] = text.strip()
    if not data['title']: raise ValueError('研究记录需要标题')
    if kind == 'decision' and not all(data[k] for k in ('change', 'reason', 'validation')):
        raise ValueError('确定的修改需要记录：修改内容、理由、预期验证')
    version_id = value.get('version_id') or None
    if kind == 'decision' and version_id:
        raise ValueError('新决策先记录为草稿，由保存为版本归入新版本')
    if version_id:
        version = service.version(version_id)
        if version['project_id'] != pid or version['idea_id'] != ident: raise ValueError('研究记录版本不属于当前 Idea')
    if kind == 'conclusion' and (not version_id or not data['conclusion']):
        raise ValueError('实验结论需要指定正式版本并填写结论')
    run_ids = value.get('experiment_ids', [])
    if not isinstance(run_ids, list) or len(run_ids) > 100 or any(not isinstance(k, str) for k in run_ids):
        raise ValueError('实验引用无效')
    data['experiments'] = []
    for run_id in dict.fromkeys(run_ids):
        if not version_id: raise ValueError('引用实验时需要指定正式版本')
        run = next((r for r in version['runs'] if r['id'] == run_id), None)
        if not run: raise ValueError('引用实验不属于此版本')
        # Evidence comes from the actual run, never from submitted numbers.
        data['experiments'].append({k: run.get(k) for k in ('id', 'name', 'status', 'metrics', 'config', 'finished_at', 'error')})
    return key, version_id, data
