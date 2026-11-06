"""Branch-specific structured state is versioned alongside the authoritative source files."""
import json
from pathlib import Path
from .local_store import atomic_write, encode, row_decode, now
from .local_git import GitService


class Versions:
    def __init__(self,store): self.store=store

    def export_state(self,pid):
        project=self.store.project(pid); root=Path(project['root_path']); directory=root/'research'
        rows=self.store.all("SELECT * FROM components WHERE project_id=? AND status!='absent_in_branch'",(pid,))
        for row in rows: self.store.check_component_export(row)
        for row in rows: atomic_write(directory/row['kind']/(row['id']+'.json'),encode(row))
        state={
            'components':[r['id'] for r in rows],
            'outlines':self.store.all("SELECT o.* FROM paragraph_outlines o JOIN components c ON c.id=o.paragraph_id WHERE c.project_id=? AND c.status!='absent_in_branch'",(pid,)),
            'links':self.store.all("SELECT l.* FROM component_links l JOIN components c ON c.id=l.source_id WHERE c.project_id=? AND c.status!='absent_in_branch'",(pid,)),
            'evidence':self.store.all("SELECT e.* FROM evidence_links e JOIN components c ON c.id=e.claim_id WHERE c.project_id=? AND c.status!='absent_in_branch'",(pid,)),
        }
        atomic_write(directory/'state.json',encode(state))

    def checkpoint(self,pid,message):
        self.export_state(pid)
        from .research_schema.bridge import ResearchSchemaService
        ResearchSchemaService(self.store).checkpoint(pid,'git.checkpoint')
        return GitService(self.store.project(pid)['root_path']).checkpoint(message)

    def switch(self,pid,name):
        project=self.store.project(pid); root=Path(project['root_path']); git=GitService(root)
        active=self.store.one("SELECT id FROM agent_sessions WHERE project_id=? AND status IN ('starting','running','waiting_approval')",(pid,))
        experiment=self.store.one("SELECT id FROM experiments WHERE project_id=? AND status IN ('queued','running')",(pid,))
        if active or experiment: raise ValueError('项目有正在运行的任务，先中断或等待完成再切换分支')
        # Materialize database edits so a branch switch cannot silently discard them.
        self.export_state(pid)
        previous=git.status()['branch']
        git.switch(name)
        try:
            state_path=root/'research'/'state.json'
            state=json.loads(state_path.read_text('utf8')) if state_path.exists() else {'components':[],'outlines':[],'links':[],'evidence':[]}
            components=[]
            for path in (root/'research').glob('*/*.json'):
                row=json.loads(path.read_text('utf8'))
                if row.get('id') not in state['components']: continue
                if row['project_id']!=pid: raise ValueError('分支组件属于另一个项目')
                revision=self.store.one('SELECT * FROM revisions WHERE id=? AND component_id=?',(row['revision_id'],row['id']),True)
                if revision['data']!=row['data']: raise ValueError('分支文件与已登记修订不一致；请先导入外部修改为新修订')
                components.append(row)
            if len(components)!=len(state['components']): raise ValueError('分支结构化组件缺失')
            with self.store.transaction() as conn:
                conn.execute("UPDATE components SET status='absent_in_branch' WHERE project_id=?",(pid,))
                for row in components:
                    conn.execute('UPDATE components SET data_json=?,revision_id=?,name=?,status=?,updated_at=? WHERE id=?',
                                 (encode(row['data']),row['revision_id'],row['name'],row['status'],row['updated_at'],row['id']))
                conn.execute('DELETE FROM component_links WHERE source_id IN (SELECT id FROM components WHERE project_id=?)',(pid,))
                for link in state['links']: conn.execute('INSERT INTO component_links VALUES(?,?,?)',(link['source_id'],link['target_id'],link['relation']))
                conn.execute('DELETE FROM evidence_links WHERE claim_id IN (SELECT id FROM components WHERE project_id=?)',(pid,))
                for evidence in state['evidence']:
                    conn.execute('INSERT INTO evidence_links VALUES(?,?,?,?,?,?,?,?,?)',tuple(evidence[k] for k in ['id','claim_id','experiment_id','paper_id','component_id','locator','note','source_hash','created_at']))
                for outline in state['outlines']:
                    conn.execute('''INSERT INTO paragraph_outlines VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(paragraph_id) DO UPDATE SET
                        section=excluded.section,purpose=excluded.purpose,main_claim=excluded.main_claim,evidence_json=excluded.evidence_json,
                        connection=excluded.connection,references_json=excluded.references_json,experiments_json=excluded.experiments_json,
                        locked=excluded.locked,pinned=excluded.pinned,needs_review=excluded.needs_review,updated_at=excluded.updated_at''',
                        (outline['paragraph_id'],outline['section'],outline['purpose'],outline['main_claim'],encode(outline['evidence']),outline['connection'],encode(outline['references']),encode(outline['experiments']),outline['locked'],outline['pinned'],outline['needs_review'],outline['updated_at']))
                # Shared experiment results can have been corrected while this branch was inactive.
                for evidence in state['evidence']:
                    if evidence.get('experiment_id'):
                        try: current=self.store.evidence_hash(experiment_id=evidence['experiment_id'])
                        except ValueError: current=None
                        if current!=evidence['source_hash']: self.store.invalidate_experiment(evidence['experiment_id'],conn)
            from .research_schema.storage import ResearchProject, hash_value
            if (root/'research.yaml').exists():
                document=ResearchProject(root).read()
                self.store.execute('UPDATE research_checkpoints SET document_hash=?,updated_at=? WHERE project_id=?',(hash_value(document),now(),pid))
            return git.status()
        except Exception:
            git.switch(previous)
            raise
