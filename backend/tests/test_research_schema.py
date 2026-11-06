import copy
import json
import sqlite3
import zipfile
from pathlib import Path
import pytest
from app.research_schema import ResearchProject, new_project, new_object, validate, migrate
from app.research_schema.model import task_data, uid
from app.research_schema.storage import sha, hash_value
from app.research_schema.exchange import export_project, import_project, preview_import, resume_plan, inspect_archive

def fixture_project(root):
    root.mkdir(); (root/'main.tex').write_text('Paragraph one.\n\nParagraph two.\n\nParagraph three.',encoding='utf-8')
    (root/'model.py').write_text('print("partial result")\n',encoding='utf-8')
    (root/'partial.csv').write_text('step,loss\n1,0.4\n',encoding='utf-8')
    doc=new_project('Portable research'); pid=doc['project_id']
    idea=new_object('Idea',pid,'Idea',{'statement':'Test a hypothesis'})
    module=new_object('ModelModule',pid,'Encoder',{'purpose':'Encoding','code_refs':['model.py']})
    blueprint=new_object('ModelBlueprint',pid,'Blueprint',{'design_goal':'Test design','modules':[module['id']],'edges':[],'code_refs':['model.py'],'history':[],'decisions':[]})
    run=new_object('ExperimentRun',pid,'Partial run',{'execution_status':'interrupted','config':{'seed':1},'metrics':{},'outputs':['partial.csv']})
    task=new_object('Task',pid,'Continue run',task_data('Finish run')); task['status']='interrupted'; task['data']['checkpoint']['written_files']=['model.py','partial.csv']; task['data']['checkpoint']['completed_steps']=['prepare','first step']
    doc['objects'] += [idea,module,blueprint,run,task]
    for i in range(3):
        paragraph=new_object('PaperParagraph',pid,'Paragraph '+str(i),{'source_path':'main.tex','anchor':'p'+str(i),'claims':[]})
        outline=new_object('ParagraphOutline',pid,'Outline '+str(i),{'paragraph_id':paragraph['id'],'purpose':'purpose '+str(i),'main_claim':'unknown','evidence':[],'locked':True,'pinned':True})
        doc['objects'] += [paragraph,outline]
    issue=new_object('ReviewIssue',pid,'Review',{'problem':'More seeds needed','verification':'Run three seeds','resolution_status':'open'})
    doc['objects'].append(issue)
    doc['relationships']=[{'id':uid(),'type':'addresses','source':task['id'],'target':issue['id'],'evidence':[],'provenance':{'kind':'fact','actor':'user','sources':[]}}]
    doc['files']=[{'path':p.name,'sha256':sha(p),'size':p.stat().st_size} for p in root.iterdir()]
    ResearchProject(root).save(doc)
    return doc

def test_a_b_d_g_roundtrip_interruption_outlines_rebuild(tmp_path):
    source=tmp_path/'source'; doc=fixture_project(source); archive=tmp_path/'project.zip'
    export_project(source,archive); dest=tmp_path/'restored'; import_project(archive,dest,True)
    recovered=ResearchProject(dest).read(True)
    assert recovered['objects']==doc['objects']; assert recovered['relationships']==doc['relationships']
    assert (dest/'partial.csv').read_bytes()==(source/'partial.csv').read_bytes()
    assert next(o for o in recovered['objects'] if o['type']=='Task')['status']=='interrupted'
    assert len([o for o in recovered['objects'] if o['type']=='ParagraphOutline' and o['data']['pinned']])==3
    index=dest/'.easyref/research-index.sqlite3'; index.unlink(); ResearchProject(dest).rebuild()
    with sqlite3.connect(index) as db: assert db.execute('select count(*) from objects').fetchone()[0]==len(doc['objects'])
    assert len(ResearchProject(dest).events())>=3

def test_c_nonstandard_read_only_preview(tmp_path):
    source=tmp_path/'repo'; source.mkdir()
    for name,text in {'model.py':'class Model: pass','README.md':'Unfinished research','config.yaml':'seed: 1','results1.csv':'loss\n1','results2.csv':'loss\n2','main.tex':'Draft','references.bib':'@article{known,title={User supplied}}'}.items(): (source/name).write_text(text,encoding='utf-8')
    before={p.name:sha(p) for p in source.iterdir()}; preview=preview_import(source)
    assert preview['requires_confirmation']; assert len([o for o in preview['objects'] if o['type']=='ExperimentRun'])==2
    assert all(o['validation_status']!='verified' for o in preview['document']['objects'])
    import_project(source,tmp_path/'copy',True,preview['fingerprint'])
    assert before=={p.name:sha(p) for p in source.iterdir()}

def test_f_missing_resources(tmp_path):
    root=tmp_path/'p'; doc=fixture_project(root)
    task=next(o for o in doc['objects'] if o['type']=='Task'); task['data']['required_inputs']=['dataset.csv','weights.pt']
    doc['objects'][0]['data']['environment_requirements']=['CUDA GPU']
    ResearchProject(root).save(doc)
    plan=resume_plan(root); assert not plan['can_start']; assert not plan['resume_process']; assert len(plan['checks'])==3

@pytest.mark.parametrize('name',['../escape','/absolute','C:/evil','a\\evil','CON.txt','a/../evil','a:b','a.'])
def test_h_unsafe_zip_paths(tmp_path,name):
    archive=tmp_path/'bad.zip'
    info=zipfile.ZipInfo(); info.filename=name
    with zipfile.ZipFile(archive,'w') as z: z.writestr(info,'bad')
    with pytest.raises(ValueError): inspect_archive(archive,tmp_path/'out')

def test_h_corruption_secret_invalid_reference(tmp_path):
    root=tmp_path/'p'; doc=fixture_project(root)
    (root/'.env').write_text('SECRET=private',encoding='utf-8')
    (root/'key.txt').write_text('-----BEGIN PRIVATE KEY-----',encoding='utf-8')
    archive=tmp_path/'p.zip'; result=export_project(root,archive)
    assert {r['path'] for r in result['excluded']} >= {'.env','key.txt'}
    with zipfile.ZipFile(archive) as z: assert '.env' not in z.namelist() and 'key.txt' not in z.namelist()
    doc['relationships'][0]['target']=uid()
    with pytest.raises(ValueError,match='Unresolved'): validate(doc)
    (root/'model.py').write_text('corrupt',encoding='utf-8')
    with pytest.raises(ValueError,match='corrupt'): ResearchProject(root).read(True)

def test_i_migration_preserves_ids_extensions(tmp_path):
    doc=new_project('Old'); doc['schema_version']='0.9.0'; obj=doc['objects'][0]; obj['revision_id']=obj.pop('revision'); obj.pop('approval_status'); obj['vendor:unknown']={'keep':True}
    result=migrate(doc); validate(result); assert result['objects'][0]['id']==obj['id']; assert result['objects'][0]['vendor:unknown']=={'keep':True}
    doc['schema_version']='99.0.0'
    with pytest.raises(ValueError,match='Unsupported'): migrate(doc)

def test_i_old_version_fixture_import(tmp_path):
    source=tmp_path/'old'; source.mkdir()
    raw=(Path(__file__).parent/'fixtures/research-schema-0.9.json').read_text('utf-8')
    (source/'research.yaml').write_text(raw,encoding='utf-8')
    dest=tmp_path/'migrated'; import_project(source,dest,True)
    doc=ResearchProject(dest).read()
    assert doc['schema_version']=='1.0.0'
    assert doc['project_id']=='2dd86d74-34c7-4202-9117-dae5ae1ce087'
    assert doc['objects'][0]['vendor:preserved']['meaning'].startswith('unknown')
    assert (source/'research.yaml').read_text('utf-8')==raw

def test_task_completion_and_concurrent_edit(tmp_path):
    root=tmp_path/'p'; doc=fixture_project(root); project=ResearchProject(root); task=next(o for o in doc['objects'] if o['type']=='Task')
    with pytest.raises(ValueError): project.transition(task['id'],'completed')
    project.transition(task['id'],'in_progress')
    with pytest.raises(ValueError,match='verification'): project.transition(task['id'],'completed')
    with pytest.raises(ValueError,match='changed'): project.save(doc,expected=hash_value(doc))

def test_e_immutable_submission(tmp_path):
    root=tmp_path/'p'; doc=fixture_project(root)
    snapshot=new_object('SubmissionAttempt',doc['project_id'],'AAAI submission',{'venue':'AAAI','branch':'submission/aaai','git_commit':'a'*40,'snapshot_path':'main.tex','sha256':sha(root/'main.tex'),'submission_status':'submitted'})
    doc['objects'].append(snapshot); project=ResearchProject(root); project.save(doc)
    snapshot['data']['venue']='TKDE'
    with pytest.raises(ValueError,match='immutable'): project.save(doc)

def test_existing_workspaces_restore_without_database(client,services,project,tmp_path):
    from app.local_store import Store
    from app.research_schema.bridge import ResearchSchemaService
    pid=project['id']; store=services['store']
    idea=store.save_component(pid,'idea','Actual idea',{'proposed_method':'Measure a deterministic baseline'})
    blueprint=store.promote_idea(idea['id'])
    paper=services['paper'].import_source(pid,'main.tex','\\documentclass{article}\n\\begin{document}\nFirst.\n\nSecond.\n\nThird.\n\\end{document}')
    for index,p in enumerate(paper['paragraphs']):
        response=client.put('/api/paragraphs/'+p['id']+'/outline',json={'purpose':'Intent '+str(index),'pinned':True,'locked':True})
        assert response.status_code==200,response.json
    task=store.save_component(pid,'task','Running legacy task',task_data('Finish pending experiment'))
    store.execute("UPDATE components SET status='in_progress' WHERE id=?",(task['id'],))
    services['versions'].checkpoint(pid,'Conference version')
    submitted=client.post(f'/api/projects/{pid}/submissions',json={'venue':'AAAI','branch':'submission/aaai'})
    assert submitted.status_code==201,submitted.json
    original_snapshot=Path(submitted.json['submission']['snapshot_path']).read_bytes()
    service=services['schema']; doc=service.checkpoint(pid)
    output=tmp_path/'portable.zip'; export_project(project['root_path'],output)
    dest=tmp_path/'restored'; import_project(output,dest,True)
    rebuilt=Store(tmp_path/'fresh-app'); ResearchSchemaService(rebuilt).restore(dest)
    ResearchProject(dest).read(True)
    assert rebuilt.component(idea['id'])['data']==idea['data']
    assert rebuilt.component(blueprint['id'])['kind']=='blueprint'
    assert rebuilt.component(task['id'])['status']=='interrupted'
    assert len(rebuilt.all('SELECT * FROM paragraph_outlines WHERE pinned=1 AND locked=1'))==3
    snapshot=rebuilt.one('SELECT * FROM submission_attempts')
    assert Path(snapshot['snapshot_path']).read_bytes()==original_snapshot
    assert rebuilt.all('SELECT * FROM papers')==[]

def test_standard_preview_does_not_write_source(tmp_path):
    root=tmp_path/'p'; fixture_project(root); exported=tmp_path/'exported'; export_project(root,exported)
    before={p.relative_to(exported).as_posix():sha(p) for p in exported.rglob('*') if p.is_file()}
    preview_import(exported)
    assert before=={p.relative_to(exported).as_posix():sha(p) for p in exported.rglob('*') if p.is_file()}

def test_native_standard_project_can_be_edited_and_reexported(tmp_path):
    from app.local_store import Store
    from app.research_schema.bridge import ResearchSchemaService
    root=tmp_path/'native'; doc=fixture_project(root); service=ResearchSchemaService(Store(tmp_path/'app'))
    service.restore(root); checkpoint=service.checkpoint(doc['project_id'])
    assert {o['id'] for o in doc['objects']}=={o['id'] for o in checkpoint['objects']}
    assert len([o for o in checkpoint['objects'] if o['type']=='ParagraphOutline'])==3
    export_project(root,tmp_path/'native.zip')

def test_failed_checkpoint_rolls_forward(tmp_path,monkeypatch):
    import app.research_schema.storage as storage
    root=tmp_path/'p'; doc=fixture_project(root); doc['objects'][0]['title']='Changed'
    original=storage.atomic
    def fail(path,content):
        if Path(path).name=='handoff.yaml': raise OSError('simulated crash')
        return original(path,content)
    monkeypatch.setattr(storage,'atomic',fail)
    with pytest.raises(OSError): ResearchProject(root).save(doc)
    monkeypatch.setattr(storage,'atomic',original)
    assert ResearchProject(root).read()['objects'][0]['title']=='Changed'
    assert not (root/'.easyref/schema-journal.json').exists()

def test_e_real_submission_branch_semantic_diff_and_bundle(tmp_path):
    from app.local_git import GitService
    from app.research_schema.versioning import submission_snapshot,compare_snapshots,evolve_component,merge_component
    root=tmp_path/'p'; doc=fixture_project(root); git=GitService(root); git.initialize(allow_nested=True)
    first=submission_snapshot(root,'AAAI','submission/aaai','submitted')
    original=(root/first['data']['snapshot_path']).read_bytes()
    git.checkpoint('Record AAAI snapshot'); git.branch('submission/tkde',switch=True)
    idea=next(o for o in doc['objects'] if o['type']=='Idea')
    evolve_component(root,idea['id'],{'statement':'Revised journal hypothesis'})
    git.checkpoint('Journal revision'); second=submission_snapshot(root,'TKDE','submission/tkde')
    diff=compare_snapshots(root,first['id'],second['id'])
    assert idea['id'] in [x['id'] for x in diff['changed']]
    assert (root/first['data']['snapshot_path']).read_bytes()==original
    git.checkpoint('Record TKDE snapshot')
    output=tmp_path/'reproducible.zip'; export_project(root,output,'reproducible',True)
    dest=tmp_path/'restored'; import_project(output,dest,True)
    assert (dest/'history.git.bundle').is_file()
    assert compare_snapshots(dest,first['id'],second['id'])==diff
    assert merge_component({'a':1},{'a':2},{'a':3})['conflicts']==['a']

def test_metadata_mode_external_resources_and_zip_symlink(tmp_path):
    root=tmp_path/'p'; fixture_project(root); archive=tmp_path/'metadata.zip'
    export_project(root,archive,'metadata'); imported=tmp_path/'copy'; import_project(archive,imported,True)
    assert not (imported/'model.py').exists(); assert not resume_plan(imported)['can_start']
    bad=tmp_path/'symlink.zip'; info=zipfile.ZipInfo('link'); info.create_system=3; info.external_attr=0o120777<<16
    with zipfile.ZipFile(bad,'w') as z: z.writestr(info,'../outside')
    with pytest.raises(ValueError,match='special'): inspect_archive(bad,tmp_path/'unsafe')

def test_verified_claim_requires_fresh_evidence(tmp_path):
    root=tmp_path/'p'; doc=fixture_project(root); source=next(o for o in doc['objects'] if o['type']=='ExperimentRun')
    evidence=new_object('Evidence',doc['project_id'],'evidence',{'source_id':source['id'],'locator':'partial.csv','sha256':sha(root/'partial.csv')})
    claim=new_object('ResearchClaim',doc['project_id'],'claim',{'statement':'fixture only','evidence':[evidence['id']],'verification':[{'passed':True,'reviewer':'fixture reviewer','evidence':[evidence['id']]}]})
    claim['validation_status']='verified'; doc['objects'] += [evidence,claim]; validate(doc)
    evidence['data']['sha256']='0'*64
    with pytest.raises(ValueError,match='untraceable'): validate(doc)

def test_reconcile_external_component_edit(client,services,project):
    pid=project['id']; row=services['store'].save_component(pid,'idea','Edit me',{'statement':'old'})
    service=services['schema']; doc=service.checkpoint(pid); root=Path(project['root_path'])
    obj=next(o for o in doc['objects'] if o['id']==row['id']); obj['data']['statement']='reviewed edit'
    (root/'research.yaml').write_text(json.dumps(doc),encoding='utf-8')
    with pytest.raises(ValueError,match='outside'): service.checkpoint(pid)
    service.reconcile(pid,hash_value(doc))
    assert services['store'].component(row['id'])['data']['statement']=='reviewed edit'

def test_import_preview_keeps_ids_and_requires_analysis_approval(client,tmp_path):
    source=tmp_path/'ordinary'; source.mkdir(); (source/'model.py').write_text('class Model: pass',encoding='utf-8')
    preview=client.post('/api/research/import/preview',json={'path':str(source)})
    assert preview.status_code==200
    p=preview.json
    denied=client.post('/api/research/import/analyze',json={'preview_id':p['preview_id']})
    assert denied.status_code==400
    result=client.post('/api/research/import',json={'path':str(source),'preview_id':p['preview_id'],'fingerprint':p['fingerprint'],'confirmed':True})
    assert result.status_code==201,result.json
    doc=ResearchProject(result.json['path']).read()
    assert [o['id'] for o in doc['objects']]==[o['id'] for o in p['document']['objects']]
    assert not (source/'research.yaml').exists() and not (source/'.git').exists()
