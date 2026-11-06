"""Bounded PPTX uploads; preserve the editable source and inspect the first slide."""
import hashlib
import io
import posixpath
import re
import zipfile
from pathlib import PurePosixPath
from xml.etree import ElementTree as ET

from .local_store import inside, file_hash

MAX_UPLOAD = 25 * 1024 * 1024
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def inspect_pptx(content, filename):
    name = PurePosixPath(filename.replace('\\', '/')).name
    if not name.lower().endswith('.pptx'):
        raise ValueError('请选择 .pptx 文件；旧版 .ppt 请先在 PowerPoint 中另存为 .pptx')
    if not content or len(content) > MAX_UPLOAD:
        raise ValueError('PPTX 文件需小于 25 MB')
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            entries = archive.infolist()
            if len(entries) > 4000 or len({e.filename for e in entries}) != len(entries):
                raise ValueError('PPTX 文件条目过多或重复')
            if sum(e.file_size for e in entries) > 128 * 1024 * 1024 or any(e.file_size > 32 * 1024 * 1024 or e.flag_bits & 1 for e in entries):
                raise ValueError('PPTX 解压大小过大或文件已加密')
            if any('..' in PurePosixPath(e.filename).parts or e.filename.startswith('/') or '\\' in e.filename for e in entries):
                raise ValueError('PPTX 内部路径无效')
            if any(e.filename.lower().endswith('vbaproject.bin') for e in entries):
                raise ValueError('请另存为不含宏的 .pptx 文件')

            def xml(path):
                raw = archive.read(path)
                if len(raw) > 8 * 1024 * 1024 or b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
                    raise ValueError('PPTX XML 内容无效')
                return ET.fromstring(raw)

            presentation = xml('ppt/presentation.xml')
            slides = presentation.findall(f'{{{P}}}sldIdLst/{{{P}}}sldId')
            if not slides: raise ValueError('PPTX 中没有幻灯片')
            rel_id = slides[0].get(f'{{{R}}}id')
            rels = {r.get('Id'): r for r in xml('ppt/_rels/presentation.xml.rels')}
            relation = rels.get(rel_id)
            if relation is None or relation.get('TargetMode') == 'External': raise ValueError('第一张幻灯片引用无效')
            target = relation.get('Target', '')
            path = posixpath.normpath(target.lstrip('/') if target.startswith('/') else posixpath.join('ppt', target))
            if not path.startswith('ppt/slides/') or not path.endswith('.xml'): raise ValueError('第一张幻灯片路径无效')
            slide = xml(path)
            size = presentation.find(f'{{{P}}}sldSz')
            width, height = int(size.get('cx')), int(size.get('cy'))
            if width <= 0 or height <= 0 or not .1 <= width / height <= 10: raise ValueError('幻灯片尺寸无效')
            scale = 1200 / max(width, height)
            text = '\n'.join(''.join(p.itertext()) for p in slide.iter(f'{{{A}}}t'))[:20000]
    except (zipfile.BadZipFile, KeyError, ET.ParseError, TypeError, AttributeError, RuntimeError, OverflowError) as exc:
        raise ValueError('无法读取 PPTX，请确认文件未损坏且未设置密码') from exc
    sha = hashlib.sha256(content).hexdigest()
    return {'width': round(width * scale, 3), 'height': round(height * scale, 3),
            'title': name.rsplit('.', 1)[0][:300], 'caption': f'{name[:240]} · 第 1 张 / 共 {len(slides)} 张',
            'source_hash': '', 'presentation': {'sha256': sha, 'name': name[:250], 'slide': 1, 'slide_count': len(slides), 'text': text}}


def pptx_path(store, pid, ident, sha, must_exist=True):
    if not isinstance(sha, str) or not re.fullmatch('[0-9a-f]{64}', sha): raise ValueError('PPTX 文件标识无效')
    store.component(ident, pid)
    path = inside(store.project(pid)['root_path'], f'research-assets/idea-ppt/{ident}/{sha}.pptx', must_exist)
    if must_exist and (path.stat().st_size > MAX_UPLOAD or file_hash(path) != sha):
        raise ValueError('原始 PPTX 文件已在外部改变，请重新导入；历史版本不会使用被改写的文件')
    return path


def clean_presentation(value):
    if not isinstance(value, dict) or not re.fullmatch('[0-9a-f]{64}', str(value.get('sha256', ''))):
        raise ValueError('PPTX 文件标识无效')
    if value.get('slide') != 1 or not isinstance(value.get('slide_count'), int) or not 1 <= value['slide_count'] <= 4000:
        raise ValueError('PPTX 默认使用第一张幻灯片')
    for key, limit in [('name', 250), ('text', 20000)]:
        if not isinstance(value.get(key), str) or len(value[key]) > limit: raise ValueError('PPTX 文件信息无效')
    return {key: value[key] for key in ('sha256', 'name', 'slide', 'slide_count', 'text')}
