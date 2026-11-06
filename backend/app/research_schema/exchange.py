"""Read-only discovery, safe copy/import/export, RO-Crate and recovery reports."""
import copy
import json
import mimetypes
import os
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile
from pathlib import Path
from urllib.parse import quote
from uuid import UUID
from .model import ACTIVITIES, RELATIONS, new_project, new_object, task_data, validate, now, uid, canonical
from .storage import ResearchProject, safe_path, relative, sha, hash_value, atomic, git_state, read_yaml, handoff

OMIT_DIRS={'.git','.easyref','.venv','venv','node_modules','__pycache__','.ssh','.aws','.azure','.codex','.claude'}
SECRET_NAMES={'auth.json','credentials.json','credentials','id_rsa','id_ed25519','id_ecdsa','.npmrc','.pypirc'}
SECRET=re.compile(rb'-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|(?:api[_-]?key|access[_-]?token|password|secret)\s*[=:]\s*[\x22\x27]?[^\s\x22\x27,}]{8,}',re.I)
GENERATED={'research.yaml','handoff.yaml','ro-crate-metadata.json','checksums.json','export-report.json','RECOVERY_REPORT.json'}
MAX_FILES=20000; MAX_TOTAL=1024*1024*1024; MAX_FILE=100*1024*1024

def excluded(name):
    parts=Path(name).parts; base=parts[-1].lower()
    return any(p.lower() in OMIT_DIRS for p in parts) or base in SECRET_NAMES or base.startswith('.env') or base.endswith(('.pem','.key','.p12','.sqlite3','.sqlite','.db'))

def discover(root):
    root=Path(root).resolve(); included=[]; skipped=[]; total=0
    for directory,dirs,files in os.walk(root,followlinks=False):
        dirs[:]=sorted(d for d in dirs if d.lower() not in OMIT_DIRS and not (Path(directory)/d).is_symlink() and not getattr(Path(directory)/d,'is_junction',lambda:False)())
        for filename in sorted(files):
            path=Path(directory)/filename; name=path.relative_to(root).as_posix()
            if len(included)+len(skipped)>=MAX_FILES: raise ValueError('Too many project files')
            if excluded(name): skipped.append({'path':name,'reason':'private/local file'}); continue
            try: safe_path(root,name)
            except ValueError: skipped.append({'path':name,'reason':'unsafe path or link'}); continue
            size=path.stat().st_size
            if size>MAX_FILE: skipped.append({'path':name,'reason':'large external resource','sha256':sha(path)}); continue
            if total+size>MAX_TOTAL: skipped.append({'path':name,'reason':'project payload size limit','sha256':sha(path)}); continue
            content=path.read_bytes()
            if SECRET.search(content): skipped.append({'path':name,'reason':'possible secret'}); continue
            included.append({'path':name,'sha256':sha(path),'size':size})
            total+=size
    return included,skipped

def object_iri(ident):
    try:
        UUID(ident); return 'urn:uuid:'+ident
    except ValueError: return 'urn:easyref:object:'+quote(ident,safe='')

def crate(document):
    project=next(o for o in document['objects'] if o['id']==document['project_id'])
    oid=object_iri
    graph=[{'@id':'ro-crate-metadata.json','@type':'CreativeWork','about':{'@id':'./'},'conformsTo':{'@id':'https://w3id.org/ro/crate/1.3'}},
           {'@id':'./','@type':'Dataset','name':project['title'],'description':project['data']['objective'],
            'datePublished':project['created_at'],'license':{'@id':'#license'},
            'hasPart':[{'@id':quote(f['path'],safe='/')} for f in document['files']]+[{'@id':p} for p in ['research.yaml','handoff.yaml','history/events.jsonl']],
            'about':[{'@id':oid(o['id'])} for o in document['objects']],
            'er:profile':{'@id':'schemas/PROFILE.md'}},
           {'@id':'#license','@type':'CreativeWork','name':'License unspecified; obtain permission from the rights holder'},
           {'@id':'schemas/PROFILE.md','@type':['File','CreativeWork'],'name':'EasyRef Research Schema local extension profile','version':'1.0.0'}]
    graph += [{'@id':p,'@type':'File','name':p} for p in ['research.yaml','handoff.yaml','history/events.jsonl']]
    nodes={}
    for obj in document['objects']:
        node={'@id':oid(obj['id']),'@type':['CreativeWork','er:'+obj['type'],'prov:Activity' if obj['type'] in ACTIVITIES else 'prov:Entity'],
              'name':obj['title'],'identifier':obj['id'],'er:revision':obj['revision'],'er:status':obj['status'],
              'subjectOf':{'@id':'research.yaml'},'er:validationStatus':obj['validation_status']}
        nodes[obj['id']]=node; graph.append(node)
    for edge in document['relationships']:
        node=nodes[edge['source']]; target={'@id':oid(edge['target'])}
        node.setdefault('er:'+edge['type'],[]).append(target)
        prov=RELATIONS[edge['type']][4]
        if prov: node.setdefault('prov:'+prov,[]).append(target)
    for file in document['files']:
        if file['path']=='schemas/PROFILE.md': continue
        graph.append({'@id':quote(file['path'],safe='/'),'@type':'File','name':file['path'],'contentSize':str(file['size']),'sha256':file['sha256']})
    return {'@context':['https://w3id.org/ro/crate/1.3/context',{'er':'urn:easyref:terms:','prov':'http://www.w3.org/ns/prov#','sha256':'http://schema.org/sha256'}],'@graph':graph}

def check_crate(root,document):
    value=json.loads(safe_path(root,'ro-crate-metadata.json').read_text('utf-8')); nodes={n['@id']:n for n in value['@graph']}
    if nodes.get('ro-crate-metadata.json',{}).get('about')!={'@id':'./'} or nodes['ro-crate-metadata.json'].get('conformsTo')!={'@id':'https://w3id.org/ro/crate/1.3'}: raise ValueError('Invalid RO-Crate descriptor')
    if nodes.get('./',{}).get('@type')!='Dataset': raise ValueError('Invalid RO-Crate root')
    if not all(k in nodes['./'] for k in ['name','description','datePublished','license']): raise ValueError('Incomplete RO-Crate root')
    for obj in document['objects']:
        node=nodes.get(object_iri(obj['id']),{})
        if node.get('er:revision')!=obj['revision'] or node.get('er:status')!=obj['status']: raise ValueError('Stale RO-Crate object')

def inspect_archive(source,destination):
    with zipfile.ZipFile(source) as archive:
        infos=archive.infolist(); seen=set(); total=0
        if len(infos)>MAX_FILES: raise ValueError('Archive has too many entries')
        for info in infos:
            relative(info.orig_filename.rstrip('/'))
            name=relative(info.filename.rstrip('/')); target=safe_path(destination,name)
            key=name.casefold()
            if key in seen: raise ValueError('Duplicate/case-colliding ZIP entry')
            seen.add(key); total+=info.file_size
            mode=info.external_attr>>16
            if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in {0,stat.S_IFREG,stat.S_IFDIR}): raise ValueError('Archive contains special file')
            if excluded(name): raise ValueError('Archive contains private/runtime path: '+name)
            if info.file_size>MAX_FILE or total>MAX_TOTAL or (info.file_size>1024*1024 and info.file_size/max(info.compress_size,1)>1000): raise ValueError('Archive size limit exceeded')
            if info.flag_bits&1: raise ValueError('Encrypted archives are unsupported')
        for info in infos:
            target=safe_path(destination,info.filename.rstrip('/'))
            if info.is_dir(): target.mkdir(parents=True,exist_ok=True); continue
            target.parent.mkdir(parents=True,exist_ok=True)
            with archive.open(info) as src,target.open('xb') as dst: shutil.copyfileobj(src,dst)

def verify_package(root):
    if safe_path(root,'.easyref/schema-journal.json').exists(): raise ValueError('Source has an unfinished checkpoint; recover it locally before import')
    project=ResearchProject(root); doc=project.read(check_files=True)
    projection=doc.get('extensions',{}).get('sqlite_projection')
    if projection and projection.get('semantic_hash')!=hash_value(doc['objects']): raise ValueError('Stale SQLite projection: reconcile edited objects before importing')
    checksum_path=safe_path(root,'checksums.json')
    if checksum_path.exists():
        checks=json.loads(checksum_path.read_text('utf-8'))
        actual={p.relative_to(root).as_posix() for p in Path(root).rglob('*') if p.is_file() and '.easyref' not in p.relative_to(root).parts and p.name!='checksums.json'}
        if actual!=set(checks): raise ValueError('Package manifest does not cover exactly the payload')
        for name,value in checks.items():
            if sha(safe_path(root,name))!=value: raise ValueError('Checksum mismatch: '+name)
    if (Path(root)/'ro-crate-metadata.json').exists(): check_crate(root,doc)
    return doc

def export_project(source,destination,mode='portable',git_history=False):
    if mode not in {'metadata','portable','reproducible'}: raise ValueError('Unknown export mode')
    project=ResearchProject(source); doc=copy.deepcopy(project.read()); dest=Path(destination).resolve()
    if dest.exists() or dest.is_relative_to(project.root): raise ValueError('Export destination must be new and outside the project')
    dest.parent.mkdir(parents=True,exist_ok=True)
    files,excluded_files=discover(project.root)
    with tempfile.TemporaryDirectory(prefix='easyref-export-',dir=dest.parent) as tmp:
        stage=Path(tmp)/'project'; stage.mkdir()
        selected=[]
        for row in files:
            name=row['path']
            if name in GENERATED or name.startswith('schemas/'): continue
            if mode=='metadata' and not name.startswith('history/'):
                excluded_files.append({**row,'reason':'metadata-only export'}); continue
            if Path(name).suffix.lower()=='.zip':
                try:
                    with tempfile.TemporaryDirectory(prefix='easyref-archive-check-') as check:
                        inspect_archive(project.root/name,Path(check))
                        nested,unsafe=discover(check)
                        if unsafe or any(Path(f['path']).suffix.lower() in {'.zip','.tar','.gz','.bundle'} for f in nested): raise ValueError('Unsafe nested archive')
                except (ValueError,zipfile.BadZipFile):
                    excluded_files.append({**row,'reason':'archive could not be safely inspected'}); continue
            elif Path(name).suffix.lower() in {'.tar','.gz','.bundle'}:
                excluded_files.append({**row,'reason':'opaque archive excluded; export from original source'}); continue
            target=safe_path(stage,name); target.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(safe_path(project.root,name),target); selected.append(row)
            if sha(target)!=row['sha256']: raise ValueError('Source changed during export: '+name)
        doc['external_resources']+=excluded_files
        # A credential in structured data must stop the export, not leak through YAML.
        if SECRET.search(canonical(doc).encode('utf-8')): raise ValueError('Possible secret in research metadata; redact before export')
        schemas=Path(__file__).parent/'schemas'; shutil.copytree(schemas,stage/'schemas')
        if git_history:
            if mode!='reproducible': raise ValueError('Git history requires reproducible mode')
            export_bundle(project.root,stage/'history.git.bundle')
        doc['files']=discover(stage)[0]
        doc['files']=[r for r in doc['files'] if r['path'] not in GENERATED and not r['path'].startswith('history/events')]
        # Event journal and handoff are derived and covered by checksums, avoiding hash cycles.
        ResearchProject(stage).save(doc,'project.export')
        atomic(stage/'ro-crate-metadata.json',json.dumps(crate(doc),ensure_ascii=False,indent=2)+'\n')
        atomic(stage/'export-report.json',json.dumps({'mode':mode,'excluded':excluded_files,'external_resources':doc['external_resources'],'git_history':git_history},ensure_ascii=False,indent=2))
        checks={p.relative_to(stage).as_posix():sha(p) for p in stage.rglob('*') if p.is_file() and '.easyref' not in p.relative_to(stage).parts}
        atomic(stage/'checksums.json',canonical(checks)); verify_package(stage)
        if dest.suffix.lower()=='.zip':
            temporary=Path(tmp)/'output.zip'
            with zipfile.ZipFile(temporary,'w',zipfile.ZIP_DEFLATED) as archive:
                for name in [*checks,'checksums.json']: archive.write(stage/name,name)
            os.replace(temporary,dest)
        else:
            # The stage is a private temp directory under the destination's parent.
            private=(stage/'.easyref').resolve()
            if not private.is_relative_to(Path(tmp).resolve()): raise ValueError('Invalid temporary export directory')
            shutil.rmtree(private); os.replace(stage,dest)
    return {'path':str(dest),'excluded':excluded_files,'mode':mode}

def export_bundle(root,target):
    def git(*args):
        result=subprocess.run(['git','-c','core.fsmonitor=false','-C',str(root),*args],capture_output=True,timeout=60,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if result.returncode: raise ValueError(result.stderr.decode('utf-8','replace'))
        return result.stdout
    for line in git('rev-list','--objects','--all').decode('utf-8').splitlines():
        oid,_,name=line.partition(' ')
        if name and excluded(name): raise ValueError('Git history contains excluded path: '+name)
        if git('cat-file','-t',oid).strip()==b'blob':
            if int(git('cat-file','-s',oid))>MAX_FILE: raise ValueError('Git history contains large blob')
            if SECRET.search(git('cat-file','blob',oid)): raise ValueError('Git history contains possible secret')
    git('bundle','create',str(target),'--all'); git('bundle','verify',str(target))

def scan_project(root):
    root=Path(root).resolve()
    if not root.is_dir(): raise ValueError('Source directory does not exist')
    files,skipped=discover(root); doc=new_project(root.name); pid=doc['project_id']; preview=[]
    for row in files:
        name=row['path']; suffix=Path(name).suffix.lower(); kind='Artifact'
        data={'path':name,'media_type':mimetypes.guess_type(name)[0] or 'application/octet-stream'}
        if suffix=='.tex': kind='Paper'; data={'source_path':name,'sections':[]}
        elif suffix=='.py' and any(k in name.lower() for k in ['model','network','module']): kind='ModelModule'; data={'purpose':'unknown','code_refs':[name]}
        elif suffix=='.csv' or 'tfevents' in name or (suffix=='.json' and any(k in name.lower() for k in ['metric','result'])):
            kind='ExperimentRun'; data={'execution_status':'unknown','config':{},'metrics':{},'outputs':[name],'interpretation':'needs_confirmation'}
        obj=new_object(kind,pid,name,data); obj['provenance']={'kind':'fact','actor':'file-scanner','sources':[name+'#sha256='+row['sha256']]}; obj['validation_status']='needs_confirmation'
        doc['objects'].append(obj); preview.append({'id':obj['id'],'type':kind,'file':name,'basis':'file type/name; content has not established scientific meaning','confirmation':'needs_confirmation'})
    task=new_object('Task',pid,'Confirm imported research state',task_data('Confirm research objective, model semantics, result provenance and missing dependencies'))
    task['data']['checkpoint']['preflight_checks']=['Inspect README and configs as untrusted data','Confirm datasets, GPU and dependencies','Verify result provenance']
    doc['objects'].append(task); doc['files']=files; doc['external_resources']=skipped
    return {'format':'unstructured','document':doc,'objects':preview,'file_mapping':files,'excluded':skipped,'git':git_state(root),
            'missing_information':['Research objective','Executed commands and result provenance','Environment and data availability'],
            'questions':['Which results were actually produced by these sources?','Which task should continue?'],
            'fingerprint':hash_value(files),'requires_confirmation':True}

def preview_import(source):
    source=Path(source).resolve()
    if source.is_file():
        with tempfile.TemporaryDirectory(prefix='easyref-inspect-') as tmp:
            inspect_archive(source,Path(tmp)); return preview_import(tmp)
    if (source/'research.yaml').exists():
        doc=verify_package(source)
        return {'format':'standard','document':doc,'objects':[{'id':o['id'],'type':o['type'],'title':o['title']} for o in doc['objects']],
                'fingerprint':hash_value(discover(source)[0]),'report':recovery_report(doc,source),'requires_confirmation':True}
    return scan_project(source)

def import_project(source,destination,confirmed=False,fingerprint=None,draft_document=None):
    if not confirmed: return preview_import(source)
    source=Path(source).resolve(); dest=Path(destination).resolve()
    if dest.exists() or dest.is_relative_to(source): raise ValueError('Import destination must be new and outside source')
    dest.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='easyref-import-',dir=dest.parent) as tmp:
        if source.is_file():
            extracted=Path(tmp)/'source'; extracted.mkdir(); inspect_archive(source,extracted); source=extracted
        preview=preview_import(source)
        if fingerprint and fingerprint!=preview['fingerprint']: raise ValueError('Source changed after import preview')
        doc=preview['document']
        if draft_document is not None:
            if preview['format']!='unstructured': raise ValueError('Draft replacement is only supported for nonstandard imports')
            validate(draft_document)
            if draft_document['files']!=doc['files']: raise ValueError('Preview file mapping changed')
            doc=copy.deepcopy(draft_document)
        stage=Path(tmp)/'project'; stage.mkdir()
        files,skipped=discover(source)
        if preview['format']=='standard' and any(r['path'] in {f['path'] for f in doc['files']} for r in skipped): raise ValueError('Standard project contains unsafe required file')
        for row in files:
            if row['path'] in {'checksums.json','ro-crate-metadata.json'}: continue
            target=safe_path(stage,row['path']); target.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(safe_path(source,row['path']),target)
            if sha(target)!=row['sha256']: raise ValueError('Source changed during import: '+row['path'])
        for obj in doc['objects']:
            if obj['type'] in {'Task','ExperimentRun','AgentSession','SkillRun'} and (obj['status']=='in_progress' or obj['data'].get('execution_status') in {'running','queued'}):
                obj.update(status='interrupted',updated_at=now(),revision=uid())
                if obj['type']=='Task': obj['data']['checkpoint']['preflight_checks'].append('Previous process is not resumed; verify reusable files and environment')
                if obj['type']=='ExperimentRun': obj['data']['execution_status']='interrupted'
        if 'sqlite_projection' in doc['extensions']:
            doc['extensions']['sqlite_projection']['semantic_hash']=hash_value(doc['objects'])
        # The verified imported event chain is retained before the recovery event is appended.
        ResearchProject(stage).save(doc,'project.import')
        ResearchProject(stage).read(check_files=True)
        atomic(stage/'RECOVERY_REPORT.json',json.dumps(recovery_report(doc,stage),ensure_ascii=False,indent=2))
        atomic(stage/'ro-crate-metadata.json',json.dumps(crate(doc),ensure_ascii=False,indent=2))
        os.replace(stage,dest)
    return {'path':str(dest),'project_id':doc['project_id'],'report':recovery_report(doc,dest)}

def recovery_report(document,root):
    objects=document['objects']; project=next(o for o in objects if o['id']==document['project_id'])
    def items(kind): return [{'id':o['id'],'title':o['title'],'status':o['status'],'data':o['data'],'sources':o['provenance']['sources']} for o in objects if o['type']==kind]
    tasks=items('Task'); missing=[*document['external_resources']]
    for obj in objects:
        if obj['type']=='Task':
            for name in obj['data']['required_inputs']:
                try: present=safe_path(root,name).is_file()
                except ValueError: present=False
                if not present: missing.append({'path':name,'reason':'required task input missing','affected_tasks':[obj['id']]})
    return {'goal':{'value':project['data']['objective'],'source':project['id']},
            'completed_work':[t for t in tasks if t['status']=='completed'],'model':items('ModelBlueprint')+items('ModelModule'),
            'experiments':items('ExperimentRun'),'verified_results':[o['id'] for o in objects if o['validation_status']=='verified'],
            'experiments_without_validated_results':[o['id'] for o in objects if o['type']=='ExperimentRun' and o['validation_status']!='verified'],
            'paper':items('Paper')+items('PaperParagraph'),'review_issues':items('ReviewIssue'),
            'last_decision':next(iter([o for o in sorted(objects,key=lambda x:x['updated_at'],reverse=True) if o['type']=='Decision']),None),
            'next_actions':[t['data']['next_action'] for t in tasks if t['status'] not in {'completed','cancelled'}],
            'missing_dependencies':missing,'git':git_state(root),'resume_context':True,'resume_task':True,'resume_process':False}

def resume_plan(root,selected=None):
    project=ResearchProject(root); doc=project.read(); report=recovery_report(doc,root)
    requirements=next(o for o in doc['objects'] if o['id']==doc['project_id'])['data']['environment_requirements']
    checks=[{'requirement':r,'status':'needs_confirmation'} for r in requirements]
    checks+=[{'requirement':r['path'],'status':'missing'} for r in report['missing_dependencies']]
    # No project command or executable is run during preflight.
    return {'report':report,'context':project.context(selected),'checks':checks,'git':git_state(root),
            'suggested_skills':['inspect available local skills for '+read_yaml(project.root/'handoff.yaml')['current_stage']],
            'execution_requires_approval':True,'can_start':not checks,'resume_process':False,
            'plan':['Review recovery report','Check Git changes and prerequisites','Approve selected task and local Codex session','Verify outputs before marking completed']}
