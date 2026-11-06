"""Local research persistence. No cloud SDK is imported on the local startup path."""
import hashlib
import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


def uid():
    return str(uuid4())


def now():
    return datetime.now(timezone.utc).isoformat()


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def digest(value):
    return hashlib.sha256((value if isinstance(value, bytes) else str(value).encode('utf-8'))).hexdigest()


def file_hash(path):
    with Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def inside(root, relative, must_exist=False):
    root = Path(root).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or path == root:
        raise ValueError('路径必须位于已选择的项目目录内')
    if any(p.lower() in {'.git', '.env', 'auth.json', 'credentials.json'} for p in path.relative_to(root).parts):
        raise ValueError('不能访问 Git 内部文件或凭据')
    if must_exist and not path.is_file():
        raise ValueError('文件不存在')
    return path


def atomic_write(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + uid() + '.tmp')
    try:
        temp.write_text(text, encoding='utf-8')
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def row_decode(row):
    if row is None:
        return None
    result = dict(row)
    for key in list(result):
        if key.endswith('_json'):
            result[key[:-5]] = json.loads(result.pop(key))
    return result


class Store:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / 'easyref.sqlite3'
        self.lock = threading.RLock()
        self.migrate()

    @contextmanager
    def transaction(self):
        conn = sqlite3.connect(self.path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('PRAGMA busy_timeout=30000')
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def migrate(self):
        with self.lock, self.transaction() as conn:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)')
            for path in sorted((Path(__file__).parent / 'migrations').glob('*.sql')):
                sql = path.read_text(encoding='utf-8')
                old = conn.execute('SELECT sha256 FROM schema_migrations WHERE version=?', (path.name,)).fetchone()
                if old:
                    if old['sha256'] != digest(sql):
                        raise RuntimeError('已执行的迁移被修改: ' + path.name)
                    continue
                # executescript otherwise commits implicitly. Include the migration record
                # in the same explicit transaction as the DDL, with rollback on failure.
                script = "BEGIN IMMEDIATE;\n" + sql + "\nINSERT INTO schema_migrations VALUES ('%s','%s','%s');\nCOMMIT;" % (path.name, digest(sql), now())
                try:
                    conn.executescript(script)
                except Exception:
                    conn.rollback()
                    raise

    def all(self, sql, args=()):
        with self.transaction() as conn:
            return [row_decode(x) for x in conn.execute(sql, args).fetchall()]

    def one(self, sql, args=(), required=False):
        rows = self.all(sql, args)
        if not rows and required:
            raise ValueError('记录不存在')
        return rows[0] if rows else None

    def execute(self, sql, args=()):
        with self.transaction() as conn:
            return conn.execute(sql, args).lastrowid

    def project(self, project_id):
        return self.one('SELECT * FROM projects WHERE id=?', (project_id,), True)

    def component(self, component_id, project_id=None):
        item = self.one('SELECT * FROM components WHERE id=?', (component_id,), True)
        if project_id and item['project_id'] != project_id:
            raise ValueError('组件不属于当前项目')
        if item['status']=='absent_in_branch':
            raise ValueError('此组件不在当前研究分支，请切换至所属分支')
        return item

    def create_project(self, name, root_path=None):
        from .local_git import GitService
        if not name or not str(name).strip():
            raise ValueError('请输入项目名称')
        project_id = uid()
        root = Path(root_path).resolve() if root_path else self.root / 'projects' / project_id
        if root_path and not root.is_dir():
            raise ValueError('导入的本地项目目录不存在')
        root.mkdir(parents=True, exist_ok=True)
        GitService(root).initialize(allow_nested=not bool(root_path))
        stamp = now()
        self.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)', (project_id, name.strip(), str(root), '{}', stamp, stamp))
        return self.project(project_id)

    def check_component_export(self, component):
        path=inside(self.project(component['project_id'])['root_path'],f"research/{component['kind']}/{component['id']}.json")
        if not path.exists(): return
        try: exported=json.loads(path.read_text('utf8'))
        except (ValueError,OSError): raise ValueError('组件文件包含外部修改，请在 Assistant 检查建议后再保存')
        if exported.get('data')!=component['data'] or exported.get('name')!=component['name']:
            raise ValueError('组件文件包含外部修改，请在 Assistant 检查建议并采纳，避免覆盖修改')

    def save_component(self, project_id, kind, name, data, component_id=None, expected_revision=None, purpose='', accept_external=False):
        if kind not in {'idea', 'blueprint', 'module', 'claim', 'paragraph', 'figure', 'table', 'section', 'venue_profile', 'task'}:
            raise ValueError('不支持的组件类型')
        if not isinstance(data, dict) or not name.strip():
            raise ValueError('组件需要名称和结构化内容')
        project = self.project(project_id)
        component_id = component_id or uid()
        with self.lock, self.transaction() as conn:
            old = row_decode(conn.execute('SELECT * FROM components WHERE id=?', (component_id,)).fetchone())
            if old and (old['project_id'] != project_id or old['kind'] != kind):
                raise ValueError('组件身份不能改变')
            if old and old['status']=='absent_in_branch': raise ValueError('不能修改其他分支的组件')
            if old and expected_revision != old['revision_id']:
                raise ValueError('版本已变化，请刷新后再保存，避免覆盖其他修改')
            if old and not accept_external: self.check_component_export(old)
            if kind == 'blueprint':
                ids = []
                for module in data.get('modules', []):
                    module.setdefault('id', uid())
                    ids.append(module['id'])
                if len(ids) != len(set(ids)):
                    raise ValueError('模型模块 ID 重复')
                for edge in data.get('edges', []):
                    if edge.get('source') not in ids or edge.get('target') not in ids:
                        raise ValueError('连接必须引用现有模块 ID')
            if kind == 'claim' and data.get('status') == 'Verified':
                raise ValueError('请通过证据核验操作标记 Verified')
            revision_id, stamp = uid(), now()
            payload = encode(data)
            status = 'Needs Review' if old and kind == 'claim' else ('Unsupported' if kind == 'claim' else (old or {}).get('status', 'draft'))
            conn.execute('INSERT INTO components VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,data_json=excluded.data_json,revision_id=excluded.revision_id,status=excluded.status,updated_at=excluded.updated_at',
                         (component_id, project_id, kind, name, payload, revision_id, status, (old or {}).get('created_at', stamp), stamp))
            conn.execute('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)', (revision_id, component_id, (old or {}).get('revision_id'), payload, digest(payload), purpose, stamp))
        # SQLite is authoritative for structured records. Files are a recoverable export
        # for Git and Codex; a failed export is surfaced rather than losing the revision.
        atomic_write(inside(project['root_path'], f'research/{kind}/{component_id}.json'), encode(self.component(component_id)))
        return self.component(component_id)

    def promote_idea(self, idea_id):
        idea = self.component(idea_id)
        if idea['kind'] != 'idea':
            raise ValueError('请选择 Idea')
        result = self.save_component(idea['project_id'], 'blueprint', idea['name'], {
            'idea_id': idea_id, 'idea_revision': idea['revision_id'], 'markdown': idea['data'].get('proposed_method', ''),
            'modules': [], 'edges': [], 'code_entry': '', 'design_decisions': idea['data']})
        self.execute('INSERT INTO component_links VALUES(?,?,?)', (idea_id, result['id'], 'motivates'))
        return result

    def evidence_hash(self, experiment_id=None, paper_id=None, component_id=None):
        if experiment_id:
            row = self.one('SELECT * FROM experiments WHERE id=?', (experiment_id,), True)
            if row['status'] != 'completed' or not row['metrics']:
                raise ValueError('实验没有已完成的真实指标')
            return digest(encode({'metrics': row['metrics'], 'config': row['config'], 'git_commit': row['git_commit']}))
        if paper_id:
            row = self.one('SELECT * FROM papers WHERE id=?', (paper_id,), True)
            return digest(encode({k: row[k] for k in ('title', 'doi', 'dblp_key', 'pdf_hash')}))
        return self.component(component_id)['revision_id']

    def add_evidence(self, claim_id, payload):
        claim = self.component(claim_id)
        if claim['kind'] != 'claim':
            raise ValueError('证据必须关联 Research Claim')
        fields = [payload.get(k) or None for k in ('experiment_id', 'paper_id', 'component_id')]
        if sum(x is not None for x in fields) != 1 or not payload.get('locator', '').strip():
            raise ValueError('指定一个证据源及具体指标、页码或位置')
        if fields[0]:
            exp = self.one('SELECT * FROM experiments WHERE id=?', (fields[0],), True)
            if exp['project_id'] != claim['project_id']:
                raise ValueError('实验不属于当前项目')
            if payload['locator'] not in exp['metrics']:
                raise ValueError('证据 locator 必须是实验中实际存在的指标名称')
        if fields[2]:
            source = self.component(fields[2], claim['project_id'])
            if source['id'] == claim_id or source['kind'] == 'claim':
                raise ValueError('不能用论点自身或另一个论点作为已验证证据')
        fingerprint = self.evidence_hash(*fields)
        key = uid()
        self.execute('INSERT INTO evidence_links VALUES(?,?,?,?,?,?,?,?,?)', (key, claim_id, *fields, payload['locator'], payload.get('note', ''), fingerprint, now()))
        self.execute("UPDATE components SET status='Needs Review' WHERE id=?", (claim_id,))
        return key

    def verify_claim(self, claim_id, note):
        claim = self.component(claim_id)
        if claim['kind'] != 'claim' or not note.strip():
            raise ValueError('核验需要人工填写证据支持该论点的理由')
        links = self.all('SELECT * FROM evidence_links WHERE claim_id=?', (claim_id,))
        if not links:
            raise ValueError('缺少证据，不能标记 Verified')
        for link in links:
            current = self.evidence_hash(link['experiment_id'], link['paper_id'], link['component_id'])
            if link['source_hash'] != current:
                raise ValueError('证据已改变，请更新证据关联后重新核验')
        data = {**claim['data'], 'verification_note': note, 'verified_at': now(), 'verified_by': 'local-user'}
        result = self.save_component(claim['project_id'], 'claim', claim['name'], data, claim_id, claim['revision_id'], 'Human evidence verification')
        self.execute("UPDATE components SET status='Verified' WHERE id=?", (claim_id,))
        return self.component(result['id'])

    def invalidate_experiment(self, experiment_id, conn=None):
        if conn is None:
            with self.transaction() as tx:
                return self.invalidate_experiment(experiment_id, tx)
        ids = [r[0] for r in conn.execute('SELECT claim_id FROM evidence_links WHERE experiment_id=?', (experiment_id,))]
        affected = []
        for claim_id in ids:
            conn.execute("UPDATE components SET status='Needs Review' WHERE id=?", (claim_id,))
            related = conn.execute('SELECT source_id FROM component_links WHERE target_id=?', (claim_id,)).fetchall()
            for row in related:
                conn.execute("UPDATE components SET status='Needs Review' WHERE id=?", (row[0],))
                conn.execute('UPDATE paragraph_outlines SET needs_review=1 WHERE paragraph_id=?', (row[0],))
                affected.append(row[0])
            conn.execute("UPDATE review_issues SET status='needs_review' WHERE component_id=? OR experiment_id=?", (claim_id, experiment_id))
        return {'claims': ids, 'components': affected}

    def backup(self):
        path = self.root / 'backups' / (uid() + '.sqlite3')
        path.parent.mkdir(exist_ok=True)
        with self.transaction() as source, sqlite3.connect(path) as target:
            source.backup(target)
        return path
