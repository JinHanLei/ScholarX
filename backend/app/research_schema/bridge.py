"""Checkpoint adapter for the existing five workspaces.

SQLite changes are provisional until checkpointed. The portable document is the
durable recovery boundary; its SQLite projection is never a second editable API.
"""
import copy
import json
import shutil
from pathlib import Path
from uuid import UUID, uuid5, NAMESPACE_URL
from .model import new_project, new_object, task_data, now, uid, canonical, validate
from .storage import ResearchProject, hash_value, sha, safe_path, atomic
from .exchange import discover, crate

KINDS={'idea':'Idea','blueprint':'ModelBlueprint','module':'ModelModule','claim':'ResearchClaim','paragraph':'PaperParagraph','figure':'Figure','table':'Table','section':'PaperSection','venue_profile':'VenueProfile','task':'Task'}
DIRECT=['components','experiments','paper_versions','agent_sessions','reviews','submission_attempts','annotations','paper_library_entries']
IDEA_TABLES = ['idea_documents', 'idea_versions', 'idea_version_runs', 'idea_version_events']
DIRECT += IDEA_TABLES
CHILDREN=[('revisions','component_id','components'),('paragraph_outlines','paragraph_id','components'),('outline_versions','paragraph_id','components'),('component_links','source_id','components'),('evidence_links','claim_id','components'),('paragraph_evolution','parent_id','components'),('experiment_artifacts','experiment_id','experiments'),('agent_messages','session_id','agent_sessions'),('skill_runs','session_id','agent_sessions'),('review_issues','review_id','reviews'),('submission_events','submission_id','submission_attempts')]
TABLES=['projects','venues','papers',*DIRECT,'revisions','paragraph_outlines','outline_versions','component_links','evidence_links','paragraph_evolution','experiment_artifacts','agent_messages','skill_runs','review_issues','submission_events']
TABLES = [table for table in TABLES if table not in IDEA_TABLES] + IDEA_TABLES
def stable(pid,key): return str(uuid5(NAMESPACE_URL,'urn:easyref:'+pid+':'+key))

class ResearchSchemaService:
    def __init__(self,store): self.store=store

    def snapshot(self,pid):
        # One SQLite read transaction makes all tables belong to the same snapshot.
        with self.store.transaction() as conn:
            conn.execute('BEGIN')
            read=lambda sql,args=():[dict(r) for r in conn.execute(sql,args)]
            tables={'projects':read('SELECT * FROM projects WHERE id=?',(pid,))}
            for table in DIRECT: tables[table]=read('SELECT * FROM '+table+' WHERE project_id=?',(pid,))
            for table,fk,parent in CHILDREN: tables[table]=read('SELECT t.* FROM '+table+' t JOIN '+parent+' p ON p.id=t.'+fk+' WHERE p.project_id=?',(pid,))
            tables['papers']=read('SELECT * FROM papers WHERE id IN (SELECT paper_id FROM paper_library_entries WHERE project_id=?) OR id IN (SELECT e.paper_id FROM evidence_links e JOIN components c ON c.id=e.claim_id WHERE c.project_id=?)',(pid,pid))
            tables['venues']=read('SELECT * FROM venues WHERE id IN (SELECT venue_id FROM papers WHERE id IN (SELECT paper_id FROM paper_library_entries WHERE project_id=?) OR id IN (SELECT e.paper_id FROM evidence_links e JOIN components c ON c.id=e.claim_id WHERE c.project_id=?))',(pid,pid))
        return tables

    def checkpoint(self,pid,activity='workspace.checkpoint'):
        with self.store.lock:
            return self._checkpoint(pid,activity)

    def _checkpoint(self,pid,activity):
        project=self.store.project(pid); root=Path(project['root_path']); portable=ResearchProject(root)
        existing=portable.read() if (root/'research.yaml').exists() else None
        marker=self.store.one('SELECT document_hash FROM research_checkpoints WHERE project_id=?',(pid,))
        if existing and marker and marker['document_hash']!=hash_value(existing):
            raise ValueError('Standard files changed outside EasyRef. Reconcile them before checkpointing; they will not be overwritten.')
        tables=self.snapshot(pid)
        for source in (Path(__file__).parent/'schemas').iterdir():
            if source.is_file():
                target=safe_path(root,'schemas/'+source.name)
                if not target.exists():
                    target.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(source,target)
        # Copy only selected-project files living in the application store into a portable location.
        external=[]
        for table,fields in [('papers',['pdf_path']),('submission_attempts',['snapshot_path']),('experiment_artifacts',['path']),('experiments',['log_path','metrics_path','cwd'])]:
            for row in tables[table]:
                for field in fields:
                    value=row.get(field)
                    if not value: continue
                    candidate=Path(value)
                    if not candidate.is_absolute():
                        candidate=(self.store.root/value) if table in {'papers','submission_attempts'} else (root/value)
                    candidate=candidate.resolve()
                    if field=='cwd':
                        row[field]=candidate.relative_to(root).as_posix() if candidate.is_relative_to(root) else '.'
                        continue
                    if candidate.is_relative_to(root) and '.easyref' not in candidate.relative_to(root).parts:
                        row[field]=candidate.relative_to(root).as_posix(); continue
                    name='research-assets/'+table+'/'+row['id']+'/'+candidate.name
                    if candidate.is_file() and (candidate.is_relative_to(root) or candidate.is_relative_to(self.store.root)):
                        target=safe_path(root,name); target.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(candidate,target); row[field]=name
                    else:
                        external.append({'path':name,'reason':'resource outside transferable project or missing'}); row[field]=None if table=='papers' else name
        # Preserve the implementation corresponding to each model version in portable exports.
        for version in tables.get('idea_versions', []):
            if not version.get('workspace'): continue
            source=safe_path(root,version['workspace'])
            files=json.loads(version['manifest_json']).get('implementation',{})
            destination='artifacts/idea-versions/'+version['id']
            for relative,checksum in files.items():
                original=safe_path(source,relative)
                if original.is_file() and sha(original)==checksum:
                    target=safe_path(root,destination+'/'+relative)
                    target.parent.mkdir(parents=True,exist_ok=True)
                    if original!=target: shutil.copy2(original,target)
            version['workspace']=destination
        tables['projects'][0]['root_path']='.'
        for session in tables['agent_sessions']:
            # Thread IDs are diagnostic only; they are not a transferable process checkpoint.
            session['thread_id']=None; session['turn_id']=None
        for run in tables['skill_runs']: run['skill_path']='skills/'+run['skill_name']+'/SKILL.md'
        doc=copy.deepcopy(existing) if existing else new_project(project['name'],pid)
        old={o['id']:o for o in doc['objects']}; objects=[]; relations=[]
        def add(kind,ident,title,data,row=None):
            obj=new_object(kind,pid,title,data,ident)
            if ident in old:
                obj={**copy.deepcopy(old[ident]),'data':data,'title':title}
            if row:
                obj['created_at']=row.get('created_at') or row.get('submitted_at') or obj['created_at']
                status=row.get('status','pending'); obj['status']={'running':'in_progress','queued':'pending','idle':'pending','starting':'in_progress','waiting_approval':'blocked','draft':'pending','open':'pending','resolved':'completed'}.get(status,status if status in {'pending','in_progress','blocked','interrupted','completed','failed','cancelled'} else 'pending')
                obj['provenance']={'kind':'fact','actor':'EasyRef checkpoint adapter','sources':['SQLite checkpoint; see extensions.sqlite_projection']}
            if ident in old and obj!=old[ident] and kind!='SubmissionAttempt': obj.update(revision=uid(),updated_at=now())
            if kind=='SubmissionAttempt' and ident in old: obj=copy.deepcopy(old[ident])
            prior=next((i for i,o in enumerate(objects) if o['id']==ident),None)
            if prior is None: objects.append(obj)
            else:
                if objects[prior]['type']!=kind: raise ValueError('Stable ID has conflicting object types')
                objects[prior]=obj
            return obj
        def edge(kind,source,target,evidence=None):
            relations.append({'id':stable(pid,kind+source+target),'type':kind,'source':source,'target':target,'evidence':evidence or [],'provenance':{'kind':'fact','actor':'EasyRef checkpoint adapter','sources':['SQLite checkpoint']}})
        from ..local_workflow import brief
        add('ResearchProject',pid,project['name'],{'objective':brief(self.store,pid).get('research_question') or (old.get(pid) or {}).get('data',{}).get('objective','unknown'),'environment_requirements':(old.get(pid) or {}).get('data',{}).get('environment_requirements',[])},project)
        for row in tables['components']:
            if row['status']=='absent_in_branch': continue
            data=json.loads(row['data_json']); kind=KINDS.get(row['kind'])
            if not kind: continue
            if kind=='Idea': payload={**data,'statement':data.get('proposed_method') or data.get('statement') or row['name']}
            elif kind=='ModelBlueprint':
                modules=[]
                module_ids={}
                for module in data.get('modules',[]):
                    mid=module['id']
                    try: UUID(mid)
                    except ValueError: mid=stable(pid,'module:'+row['id']+':'+mid)
                    module_ids[module['id']]=mid
                    modules.append(mid)
                    add('ModelModule',mid,module.get('name',mid),{'purpose':module.get('purpose','unknown'),'code_refs':[module['code_path']] if module.get('code_path') else []})
                    edge('belongs_to',mid,row['id'])
                payload={**data,'modules':modules,'design_goal':data.get('design_goal') or row['name'],'edges':data.get('edges',[]),'code_refs':[data['code_entry']] if data.get('code_entry') else [],'history':[r['id'] for r in tables['revisions'] if r['component_id']==row['id']],'decisions':[]}
                payload['edges']=[{**item,'source':module_ids.get(item['source'],item['source']),'target':module_ids.get(item['target'],item['target'])} for item in payload['edges']]
            elif kind=='ModelModule': payload={**data,'purpose':data.get('purpose','unknown'),'code_refs':data.get('code_refs',[])}
            elif kind=='ResearchClaim': payload={**data,'statement':data.get('statement') or row['name'],'evidence':[r['id'] for r in tables['evidence_links'] if r['claim_id']==row['id']]}
            elif kind=='PaperParagraph': payload={**data,'source_path':data.get('path','paper/main.tex'),'anchor':row['id'],'claims':data.get('claims',[])}
            elif kind=='Task':
                payload={**task_data(row['name']),**data}
                if row['status']=='completed' and not payload['verification']: row={**row,'status':'interrupted'}
            elif kind=='PaperSection': payload={**data,'heading':row['name'],'paragraphs':[]}
            elif kind=='VenueProfile': payload={**data,'name':row['name']}
            else: payload={**data,'caption':data.get('caption',row['name'])}
            obj=add(kind,row['id'],row['name'],payload,row)
            obj['extensions']={**obj.get('extensions',{}),'sqlite_component':row['id']}
            if row.get('revision_id'): obj['revision']=row['revision_id']
        for row in tables['paragraph_outlines']:
            outline=next((o for o in old.values() if o['type']=='ParagraphOutline' and o['data']['paragraph_id']==row['paragraph_id']),None)
            outline_id=outline['id'] if outline else stable(pid,'outline:'+row['paragraph_id'])
            evidence=outline['data']['evidence'] if outline else [] # Legacy outlines link Claims, not Evidence objects.
            data={'paragraph_id':row['paragraph_id'],'purpose':row['purpose'],'main_claim':row['main_claim'],'evidence':evidence,'claims':json.loads(row['evidence_json']),'locked':bool(row['locked']),'pinned':bool(row['pinned']),'section':row['section'],'connection':row['connection'],'references':json.loads(row['references_json']),'experiments':json.loads(row['experiments_json']),'needs_review':bool(row['needs_review'])}
            add('ParagraphOutline',outline_id,'Paragraph outline',data,row)
            edge('describes',outline_id,row['paragraph_id'])
        for row in tables['papers']:
            add('LiteratureReference',row['id'],row['title'],{'title':row['title'],'doi':row['doi'],'dblp_key':row['dblp_key'],'authors':json.loads(row['authors_json']),'year':row['year'],'bibtex':row['bibtex']},row)
        for row in tables['experiments']:
            add('ExperimentRun',row['id'],row['name'],{'execution_status':{'completed':'succeeded','running':'running','queued':'queued','cancelled':'cancelled','failed':'failed','interrupted':'interrupted'}.get(row['status'],'unknown'),'config':json.loads(row['config_json']),'metrics':json.loads(row['metrics_json']),'outputs':[r['path'] for r in tables['experiment_artifacts'] if r['experiment_id']==row['id']],'git_commit':row['git_commit'],'command':json.loads(row['command_json'])},row)
        for row in tables['evidence_links']:
            source=row['experiment_id'] or row['paper_id'] or row['component_id']
            fingerprint=row['source_hash'] if len(row['source_hash'])==64 else hash_value(row['source_hash'])
            add('Evidence',row['id'],row['locator'],{'source_id':source,'locator':row['locator'],'sha256':fingerprint,'note':row['note']},row)
            edge('supports',row['id'],row['claim_id'],[row['id']])
        for row in tables['reviews']: add('Review',row['id'],'Review',{'scope':[],'legacy_scope':json.loads(row['scope_json'])},row)
        for row in tables['review_issues']:
            add('ReviewIssue',row['id'],row['problem'],{'problem':row['problem'],'verification':row['verification'],'resolution_status':row['status'] if row['status'] in {'open','in_progress','resolved','dismissed','needs_review'} else 'needs_review','suggested_fix':row['suggested_fix']},row)
        for row in tables['agent_sessions']: add('AgentSession',row['id'],row['role'],{'executor':'local Codex','stage':row['stage']},row)
        for row in tables['skill_runs']: add('SkillRun',row['id'],row['skill_name'],{'skill_name':row['skill_name'],'inputs':[],'outputs':[],'input_record':json.loads(row['input_json']),'result_record':json.loads(row['result_json'])},row)
        for row in tables['submission_attempts']:
            add('SubmissionAttempt',row['id'],row['venue'],{'venue':row['venue'],'branch':row['branch'],'git_commit':row['git_commit'],'snapshot_path':row['snapshot_path'],'sha256':row['sha256'],'submission_status':'submitted' if row.get('snapshot_kind')=='submitted' else 'prepared','manifest':json.loads(row['manifest_json'])},row)
        for row in tables['submission_events']:
            add('Decision',row['id'],row['kind'],{'rationale':'Recorded submission event','outcome':row['data_json'],'submission_id':row['submission_id']},row)
        for row in tables['paragraph_evolution']: edge('derived_from',row['child_id'],row['parent_id'])
        for row in tables['component_links']:
            kind={'motivates':'derived_from','supports':'describes','related':'depends_on'}.get(row['relation'],row['relation'])
            from .model import RELATIONS
            if kind in RELATIONS:
                if row['relation']=='motivates': edge(kind,row['target_id'],row['source_id'])
                else: edge(kind,row['source_id'],row['target_id'])
        # Objects introduced by the protocol API survive legacy workspace checkpoints.
        current_ids={o['id'] for o in objects}
        objects += [o for o in doc['objects'] if o['id'] not in current_ids and not o.get('extensions',{}).get('sqlite_component')]
        ids={o['id'] for o in objects}; relations=[r for r in relations if r['source'] in ids and r['target'] in ids]
        relation_ids={r['id'] for r in relations}
        relations += [r for r in doc['relationships'] if r['id'] not in relation_ids and r['source'] in ids and r['target'] in ids]
        doc.update(objects=objects,relationships=relations)
        doc['extensions']['sqlite_projection']={'tables':tables,'format':'easyref-local-projection-1','semantic_hash':hash_value(objects)}
        doc['external_resources']=external
        files,skipped=discover(root)
        doc['files']=[r for r in files if r['path'] not in {'research.yaml','handoff.yaml','ro-crate-metadata.json','checksums.json','RECOVERY_REPORT.json','export-report.json'} and not r['path'].startswith(('history/','schemas/'))]
        doc['external_resources']+=skipped
        portable.save(doc,activity)
        atomic(root/'ro-crate-metadata.json',json.dumps(crate(doc),ensure_ascii=False,indent=2))
        self.store.execute('INSERT INTO research_checkpoints VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET document_hash=excluded.document_hash,updated_at=excluded.updated_at',(pid,hash_value(doc),now()))
        return doc

    def restore(self,root):
        root=Path(root).resolve(); doc=ResearchProject(root).read(True); pid=doc['project_id']
        if self.store.one('SELECT id FROM projects WHERE id=?',(pid,)): raise ValueError('Project ID already registered; use a fresh local data directory to restore this identity')
        projection=doc.get('extensions',{}).get('sqlite_projection')
        if projection:
            if projection.get('semantic_hash')!=hash_value(doc['objects']): raise ValueError('Stale SQLite projection; reconcile portable edits before rebuilding the application database')
            # Import may have marked running objects interrupted, so overlay their status below.
            tables=copy.deepcopy(projection['tables'])
            if set(tables)-set(TABLES): raise ValueError('Unsupported SQLite projection table')
            if len(tables.get('projects',[]))!=1 or tables['projects'][0]['id']!=pid: raise ValueError('Invalid project projection')
            tables['projects'][0]['root_path']=str(root)
            portable_objects={o['id']:o for o in doc['objects']}
            for row in tables.get('components',[]):
                obj=portable_objects.get(row['id'])
                if obj and obj['type']=='Task': row['status']=obj['status']
            for table in DIRECT:
                if any(r['project_id']!=pid for r in tables.get(table,[])): raise ValueError('Cross-project projection rejected')
            for table,fields in [('papers',['pdf_path']),('submission_attempts',['snapshot_path']),('experiment_artifacts',['path']),('experiments',['cwd','log_path','metrics_path'])]:
                for row in tables.get(table,[]):
                    for field in fields:
                        if row.get(field):
                            row[field]=str(root) if row[field]=='.' and field=='cwd' else str(safe_path(root,row[field]))
            for row in tables.get('agent_sessions',[]):
                row['thread_id']=None; row['turn_id']=None
                if row['status'] in {'running','starting','waiting_approval'}: row['status']='interrupted'
            for row in tables.get('skill_runs',[]):
                if row['status'] in {'running','pending'}: row['status']='interrupted'
            for row in tables.get('experiments',[]):
                if row['status'] in {'running','queued'}: row['status']='interrupted'
            for row in tables.get('idea_versions',[]):
                if row['stage'] not in {'completed','blocked','failed','cancelled','interrupted','imported'}:
                    row['stage']='interrupted'; row['message']='导入的版本保留历史；运行进程不能迁移'
            with self.store.transaction() as conn:
                conn.execute('PRAGMA defer_foreign_keys=ON')
                for table in TABLES:
                    columns={r[1] for r in conn.execute('PRAGMA table_info('+table+')')}
                    for row in tables.get(table,[]):
                        if set(row)-columns: raise ValueError('Unknown projection column')
                        if table in {'papers','venues'} and conn.execute('SELECT 1 FROM '+table+' WHERE id=?',(row['id'],)).fetchone(): continue
                        keys=list(row)
                        conn.execute('INSERT INTO '+table+' ('+','.join(keys)+') VALUES('+','.join('?' for _ in keys)+')',[row[k] for k in keys])
        else:
            project=next(o for o in doc['objects'] if o['id']==pid)
            self.store.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)',(pid,project['title'],str(root),'{}',project['created_at'],project['updated_at']))
            # Native standard projects are visible through the shared schema browser;
            # editable legacy components are projected without changing their IDs.
            inverse={v:k for k,v in KINDS.items()}
            with self.store.transaction() as conn:
                for obj in doc['objects']:
                    if obj['type'] not in inverse: continue
                    payload=copy.deepcopy(obj['data'])
                    if obj['type']=='ModelBlueprint':
                        lookup={o['id']:o for o in doc['objects']}
                        payload['modules']=[{'id':i,'name':lookup[i]['title'],**lookup[i]['data']} for i in payload['modules']]
                    if obj['type']=='PaperParagraph': payload['path']=payload['source_path']
                    data=canonical(payload)
                    conn.execute('INSERT INTO components VALUES(?,?,?,?,?,?,?,?,?)',(obj['id'],pid,inverse[obj['type']],obj['title'],data,obj['revision'],obj['status'],obj['created_at'],obj['updated_at']))
                    conn.execute('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)',(obj['revision'],obj['id'],None,data,hash_value(obj['data']),'Import standard object',obj['updated_at']))
                for obj in doc['objects']:
                    if obj['type']!='ParagraphOutline': continue
                    d=obj['data']; conn.execute('INSERT INTO paragraph_outlines VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(d['paragraph_id'],d.get('section',''),d['purpose'],d['main_claim'],canonical(d.get('claims',[])),d.get('connection',''),canonical(d.get('references',[])),canonical(d.get('experiments',[])),int(d['locked']),int(d['pinned']),1,obj['updated_at']))
        self.store.execute('INSERT INTO research_checkpoints VALUES(?,?,?)',(pid,hash_value(doc),now()))
        ResearchProject(root).rebuild(doc)
        from ..local_git import GitService
        GitService(root).initialize(allow_nested=True,preserve_files=True)
        return self.store.project(pid)

    def reconcile(self,pid,expected_hash):
        """Apply explicitly reviewed file edits to supported legacy edit forms."""
        project=self.store.project(pid); document=ResearchProject(project['root_path']).read(True)
        if hash_value(document)!=expected_hash: raise ValueError('Research files changed after preview')
        snapshot=document.get('extensions',{}).get('sqlite_projection',{}).get('tables',{})
        lookup={o['id']:o for o in document['objects']}
        with self.store.lock,self.store.transaction() as conn:
            for before in snapshot.get('components',[]):
                if before['status']=='absent_in_branch': continue
                current=conn.execute('SELECT * FROM components WHERE id=? AND project_id=?',(before['id'],pid)).fetchone()
                if not current or dict(current)!=before: raise ValueError('Concurrent SQLite edit; reconcile the conflicting component first')
                obj=lookup.get(before['id'])
                if not obj: raise ValueError('Object deletion requires explicit component evolution')
                data=copy.deepcopy(obj['data'])
                if obj['type']=='ModelBlueprint': data['modules']=[{'id':i,'name':lookup[i]['title'],**lookup[i]['data']} for i in data['modules']]
                if obj['type']=='PaperParagraph': data['path']=data['source_path']
                revision=uid(); content=canonical(data)
                conn.execute('INSERT INTO revisions VALUES(?,?,?,?,?,?,?)',(revision,obj['id'],current['revision_id'],content,hash_value(data),'Reconcile reviewed portable edit',now()))
                conn.execute('UPDATE components SET name=?,data_json=?,revision_id=?,updated_at=? WHERE id=?',(obj['title'],content,revision,now(),obj['id']))
            for obj in document['objects']:
                if obj['type']!='ParagraphOutline': continue
                d=obj['data']
                conn.execute('UPDATE paragraph_outlines SET purpose=?,main_claim=?,locked=?,pinned=?,evidence_json=?,updated_at=? WHERE paragraph_id=?',(d['purpose'],d['main_claim'],int(d['locked']),int(d['pinned']),canonical(d.get('claims',[])),now(),d['paragraph_id']))
            conn.execute('UPDATE research_checkpoints SET document_hash=? WHERE project_id=?',(hash_value(document),pid))
        for before in snapshot.get('components',[]):
            if before['status']=='absent_in_branch': continue
            row=self.store.component(before['id'],pid)
            atomic(safe_path(project['root_path'],'research/'+row['kind']+'/'+row['id']+'.json'),canonical(row))
        return self.checkpoint(pid,'files.reconcile')

    def context(self,pid,selected):
        doc=self.checkpoint(pid,'codex.context')
        ids={o['id'] for o in doc['objects']}
        return ResearchProject(self.store.project(pid)['root_path']).context([i for i in selected if i in ids])
