import io
import json
import sqlite3
import threading
import time
import zipfile
from pathlib import Path
import pytest
from app import create_app
from app.local_store import Store, encode, digest, file_hash, uid, now, inside
from app.local_git import GitService
from app.local_paper import parse_paragraphs


def post(client,url,data,code=200):
    result=client.post(url,json=data)
    assert result.status_code==code,result.json
    return result.json


def component(client,pid,kind='idea',name='Research',data=None):
    return post(client,f'/api/projects/{pid}/components',{'kind':kind,'name':name,'data':data or {}},201)['component']


def wait_run(service,ident):
    deadline=time.monotonic()+15
    while service.get(ident)['status'] in {'queued','running'} and time.monotonic()<deadline:
        time.sleep(.05)
    return service.get(ident)


def make_run(services,project,seed=1,split='test',script=None):
    root=Path(project['root_path'])
    (root/'experiment.py').write_text(script or "import os,json,random\nfrom pathlib import Path\nc=json.loads(Path(os.environ['EASYREF_CONFIG']).read_text())\nr=random.Random(c['seed'])\nvalues=[r.random() for _ in range(20)]\nmetrics={'test_mean':sum(values)/len(values),'count':len(values)}\nPath(os.environ['EASYREF_METRICS_PATH']).write_text(json.dumps(metrics))\nprint('ACTUAL TEST DATA',metrics)\n",encoding='utf8')
    run=services['experiments'].register(project['id'],{'name':'TEST DATA / seed '+str(seed),'command':['python','experiment.py'],
        'config':{'dataset':'synthetic TEST DATA','split':split,'seed':seed,'hyperparameters':{'samples':20},'evaluation_protocol':'arithmetic sample mean'},'test_data':True})
    services['experiments'].start(run['id'],True)
    return wait_run(services['experiments'],run['id'])


def test_no_supabase_startup_and_migration(client,services):
    assert client.get('/health').json['storage']=='sqlite'
    store=services['store']
    with store.transaction() as db:
        assert db.execute('PRAGMA journal_mode').fetchone()[0]=='wal'
        assert db.execute('PRAGMA foreign_keys').fetchone()[0]==1
    before=store.all('SELECT * FROM schema_migrations')
    store.migrate()
    assert store.all('SELECT * FROM schema_migrations')==before
    assert store.one('SELECT count(*) AS n FROM venues')['n']==681
    assert store.one("SELECT v.rank,m.stream FROM venues v JOIN venue_dblp_mappings m ON m.venue_id=v.id WHERE v.abbreviation='AsiaCCS'")['stream']=='conf/asiaccs'
    assert store.one("SELECT rank FROM venues WHERE abbreviation='IJCAI'")['rank']=='B'


def test_transaction_rollback_foreign_keys(services):
    store=services['store']
    with pytest.raises(sqlite3.IntegrityError),store.transaction() as conn:
        conn.execute('INSERT INTO component_links VALUES(?,?,?)',('missing','missing','related'))
    assert not store.all('SELECT * FROM component_links')


def test_dblp_whitelist_fts_dedupe_resume_and_personal(client,services,tmp_path):
    records=[]
    for key,venue in [('conf/aaai/Test2026','AAAI'),('conf/ijcai/Test2026','IJCAI'),('conf/aistats/Test2026','AISTATS'),('conf/notccf/Test','Other'),('conf/aaai/WorkshopTest','AAAI Workshop')]:
        records.append(f'<inproceedings key="{key}"><author>Test Author</author><title>Reproducible retrieval test</title><year>2026</year><booktitle>{venue}</booktitle></inproceedings>')
    source=tmp_path/'sample.xml'; source.write_text('<dblp>'+''.join(records)+'</dblp>',encoding='utf8')
    lit=services['literature']; job=lit.start_import(str(source)); lit.workers[job['id']][0].join(10)
    job=services['store'].one('SELECT * FROM import_jobs WHERE id=?',(job['id'],))
    assert job['status']=='completed' and job['imported']==3 and job['skipped']==2,job
    for rank in 'ABC':
        data=client.get('/api/papers',query_string={'q':'retrieval','rank':rank}).json
        assert data['total']==1,data
        assert data['papers'][0]['publication_type']=='unknown'
    lit.start_import(job_id=job['id']); lit.workers[job['id']][0].join(10)
    again=lit.start_import(str(source)); lit.workers[again['id']][0].join(10)
    assert client.get('/api/papers').json['total']==3
    post(client,'/api/papers',{'title':'Private reference','authors':['Me']},201)
    assert client.get('/api/papers').json['total']==3
    assert client.get('/api/papers?source=personal').json['total']==1
    assert client.get('/api/papers?q=%22%3BDELETE').status_code==200


def test_import_pause_resume_and_file_change(services,tmp_path):
    source=tmp_path/'resume.xml'; source.write_text('<dblp>'+''.join(f'<article key="journals/tocs/T{i}"><title>Checkpoint {i}</title><journal>TOCS</journal><year>2026</year></article>' for i in range(601))+'</dblp>',encoding='utf8')
    lit=services['literature']; key=uid(); stop=threading.Event(); stop.set()
    services['store'].execute('INSERT INTO import_jobs(id,source_path,fingerprint,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',(key,str(source),lit.fingerprint(source),'pending',now(),now()))
    lit.import_xml(key,stop)
    assert services['store'].one('SELECT status FROM import_jobs WHERE id=?',(key,))['status']=='paused'
    lit.start_import(job_id=key); lit.workers[key][0].join(10)
    assert services['store'].one('SELECT imported FROM import_jobs WHERE id=?',(key,))['imported']==601
    source.write_text('<dblp/>')
    with pytest.raises(ValueError,match='改变'): lit.start_import(job_id=key)


def test_dblp_doi_deduplication_preserves_stable_paper_identity(services):
    lit=services['literature']
    first=lit.upsert({'dblp_key':'conf/aaai/DoiOriginal','title':'DOI deduplication TEST DATA','authors':['Tester'],'venue_name':'AAAI','doi':'https://doi.org/10.1234/easyref-test'})
    second=lit.upsert({'dblp_key':'conf/aaai/DoiUpdated','title':'Updated DOI record TEST DATA','authors':['Tester'],'venue_name':'AAAI','doi':'10.1234/EASYREF-TEST'})
    assert first==second
    assert services['store'].one('SELECT COUNT(*) AS n FROM papers')['n']==1
    assert services['store'].one('SELECT title FROM papers WHERE id=?',(first,))['title']=='Updated DOI record TEST DATA'


def test_external_xml_entity_rejected(services,tmp_path):
    secret=tmp_path/'secret.txt'; secret.write_text('PRIVATE TEST CONTENT')
    source=tmp_path/'xxe.xml'; source.write_text(f'<!DOCTYPE dblp [<!ENTITY steal SYSTEM "{secret.as_uri()}">]><dblp><article key="journals/tocs/X"><title>&steal;</title></article></dblp>')
    lit=services['literature']; job=lit.start_import(str(source)); lit.workers[job['id']][0].join(10)
    assert services['store'].one('SELECT status FROM import_jobs WHERE id=?',(job['id'],))['status']=='failed'
    assert not services['store'].all('SELECT * FROM papers')


def test_dblp_adjunct_exclusion_and_explicit_stream(services):
    lit=services['literature']
    assert lit.classify({'dblp_key':'conf/ismar/OtooBRSFD25','venue_name':'ISMAR-Adjunct'}) is None
    assert lit.classify({'dblp_key':'conf/acl/Test','venue_name':'Findings of ACL'}) is None
    mapped=lit.classify({'dblp_key':'journals/example/Paper','venue_name':'VLDB','streams':['streams/conf/vldb'],'record_type':'article'})
    assert mapped is not None and mapped['publication_type']=='unknown'


def test_idea_blueprint_revisions(client,services,project):
    idea=component(client,project['id'],data={'research_question':'Can this be tested?','proposed_method':'Measure a baseline.'})
    bp=post(client,f"/api/ideas/{idea['id']}/blueprint",{},201)['component']
    data={**bp['data'],'modules':[{'id':'encoder-module','name':'Encoder','code_path':'model.py'}],'edges':[]}
    result=client.put('/api/components/'+bp['id'],json={'data':data,'expected_revision':bp['revision_id'],'purpose':'Add encoder'})
    assert result.status_code==200,result.json
    after=result.json['component']
    diff=client.get(f"/api/components/{bp['id']}/diff",query_string={'before':bp['revision_id'],'after':after['revision_id']}).json
    assert 'Encoder' in diff['diff'] and diff['before']['data']['modules']==[]
    assert services['store'].component(idea['id'])['data']['proposed_method']=='Measure a baseline.'
    assert client.put('/api/components/'+bp['id'],json={'data':data,'expected_revision':bp['revision_id']}).status_code==400
    restored=post(client,f"/api/components/{bp['id']}/restore",{'confirmed':True,'revision_id':bp['revision_id']})['component']
    assert restored['revision_id']!=bp['revision_id'] and restored['data']['modules']==[]


def test_real_experiments_diff_logs_and_failure(services,project,client):
    a=make_run(services,project,1); b=make_run(services,project,2,split='changed-test')
    assert a['status']==b['status']=='completed'
    assert a['metrics']['count']==20 and a['metrics']['test_mean']!=b['metrics']['test_mean']
    compare=services['experiments'].compare(a['id'],b['id'])
    assert not compare['comparable'] and any('split' in w for w in compare['warnings'])
    assert compare['metrics']['test_mean']['delta']==b['metrics']['test_mean']-a['metrics']['test_mean']
    assert 'ACTUAL TEST DATA' in client.get('/api/experiments/'+a['id']).json['log']
    stale=make_run(services,project,3,script="print('No metrics produced')\n")
    assert stale['status']=='completed' and stale['metrics']=={}
    failed=make_run(services,project,4,script="raise RuntimeError('intentional test failure')\n")
    assert failed['status']=='failed' and failed['error']


def test_command_restrictions_and_cancel(services,project):
    exp=services['experiments']; base={'config':{'dataset':'x','split':'x','seed':1,'hyperparameters':{},'evaluation_protocol':'x'}}
    for command in [['cmd','/c','echo unsafe'],['python','-c','print(1)'],['node','../escape.js']]:
        with pytest.raises(ValueError): exp.register(project['id'],{**base,'command':command})
    (Path(project['root_path'])/'sleep.py').write_text('import time\ntime.sleep(20)\n')
    run=exp.register(project['id'],{**base,'command':['python','sleep.py']})
    with pytest.raises(ValueError): exp.start(run['id'])
    exp.start(run['id'],True); exp.cancel(run['id']); result=wait_run(exp,run['id'])
    assert result['status']=='cancelled',result


SOURCE='\\documentclass{article}\n\\begin{document}\n\\section{Introduction}\nFirst paragraph.\n\nSecond paragraph.\n\\end{document}\n'


def test_paragraph_ids_outline_lock_and_evolution(client,services,project):
    pid=project['id']; doc=post(client,f'/api/projects/{pid}/paper/import',{'source':SOURCE},201)
    ids=[p['id'] for p in doc['paragraphs']]
    assert len(ids)==2
    paragraph=ids[0]
    response=client.put(f'/api/paragraphs/{paragraph}/outline',json={'purpose':'Explain motivation','locked':True})
    assert response.status_code==200
    assert client.put(f'/api/paragraphs/{paragraph}/outline',json={'purpose':'Unapproved replacement'}).status_code==400
    result=client.put(f'/api/paragraphs/{paragraph}',json={'content':'\\section{Introduction}\nRevised text.','expected_hash':doc['sha256']})
    assert result.status_code==200,result.json
    revised=result.json
    assert [p['id'] for p in revised['paragraphs']]==ids
    assert revised['paragraphs'][0]['outline']['purpose']=='Explain motivation'
    assert revised['paragraphs'][0]['outline']['needs_review']==1
    moved=revised['source'].replace('Revised text.','Revised text.\nMore lines.\n')
    updated=client.put(f'/api/projects/{pid}/paper',json={'path':doc['path'],'source':moved,'expected_hash':revised['sha256']}).json
    assert [p['id'] for p in updated['paragraphs']]==ids
    bad=client.put(f'/api/projects/{pid}/paper',json={'path':doc['path'],'source':SOURCE,'expected_hash':updated['sha256']})
    assert bad.status_code==400 and 'Paragraph ID' in bad.json['error']
    evolved=post(client,f'/api/projects/{pid}/paper/evolve',{'path':doc['path'],'parent_ids':[paragraph],'contents':['Split one.','Split two.'],'operation':'split','expected_hash':updated['sha256']})
    assert len(evolved['paragraphs'])==3
    assert services['store'].component(paragraph)['status']=='retired'
    assert len(services['store'].all('SELECT * FROM paragraph_evolution WHERE parent_id=?',(paragraph,)))==2


def test_paper_zip_paths_and_optimistic_lock(client,project):
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as z: z.writestr('../escape.tex',SOURCE)
    stream.seek(0)
    response=client.post(f"/api/projects/{project['id']}/paper/import",data={'file':(stream,'unsafe.zip')},content_type='multipart/form-data')
    assert response.status_code==400
    doc=post(client,f"/api/projects/{project['id']}/paper/import",{'source':SOURCE},201)
    assert client.put(f"/api/projects/{project['id']}/paper",json={'path':doc['path'],'source':doc['source'],'expected_hash':'stale'}).status_code==400
    assert client.get(f"/api/projects/{project['id']}/file?path=../outside.txt").status_code==400


def test_evidence_invalidation(client,services,project):
    pid=project['id']; run=make_run(services,project)
    claim=component(client,pid,'claim','Mean of test data',{'statement':'The synthetic sample mean is measured.'})
    assert post(client,f"/api/claims/{claim['id']}/verify",{'note':'No evidence yet'},400)
    post(client,f"/api/claims/{claim['id']}/evidence",{'experiment_id':run['id'],'locator':'test_mean','note':'Synthetic test only'})
    verified=post(client,f"/api/claims/{claim['id']}/verify",{'note':'Checked the actual metrics JSON; this is test data only'})
    assert verified['claim']['status']=='Verified'
    doc=post(client,f'/api/projects/{pid}/paper/import',{'source':SOURCE},201); paragraph=doc['paragraphs'][0]['id']
    assert client.put(f'/api/paragraphs/{paragraph}/outline',json={'purpose':'State claim','evidence':[claim['id']]}).status_code==200
    affected=post(client,f"/api/experiments/{run['id']}/metrics",{'metrics':{'test_mean':.25,'count':20},'reason':'Test correction propagation'})['affected']
    assert claim['id'] in affected['claims'] and paragraph in affected['components']
    assert services['store'].component(claim['id'])['status']=='Needs Review'
    assert post(client,f"/api/claims/{claim['id']}/verify",{'note':'Stale evidence'},400)


def test_git_snapshot_branch_rollback_and_staged_protection(client,services,project):
    pid=project['id']; root=Path(project['root_path']); git=GitService(root)
    paper=post(client,f'/api/projects/{pid}/paper/import',{'source':SOURCE},201)
    first=post(client,f'/api/projects/{pid}/git/checkpoint',{'message':'Paper baseline'})['commit']
    assert git.status()['changes']==''
    snap=post(client,f'/api/projects/{pid}/submissions',{'venue':'TEST VENUE','branch':'submission/test'},201)['submission']
    snap_path=Path(snap['snapshot_path']); before=snap_path.read_bytes()
    with pytest.raises(sqlite3.IntegrityError): services['store'].execute('UPDATE submission_attempts SET venue=? WHERE id=?',('forged',snap['id']))
    target=root/paper['path']; target.write_text(target.read_text('utf8').replace('First paragraph.','Changed text.'),encoding='utf8')
    with pytest.raises(ValueError,match='修改'): git.switch('submission/test')
    git.restore_file(paper['path'],first)
    assert 'First paragraph.' in target.read_text('utf8')
    assert snap_path.read_bytes()==before
    git.switch('submission/test'); assert git.status()['branch']=='submission/test'
    target.write_text(target.read_text('utf8').replace('First paragraph.','Branch change.'),encoding='utf8')
    git.run('add','--',paper['path']); index=git.run('diff','--cached')
    with pytest.raises(ValueError,match='暂存'): git.checkpoint('Must not consume staged work')
    assert git.run('diff','--cached')==index
    assert client.get('/api/submissions/'+snap['id']+'/snapshot').status_code==200


def test_restart_persistence_and_database_backup(client,services,project):
    pid=project['id']; idea=component(client,pid,data={'hypothesis':'Stable after restart'})
    doc=post(client,f'/api/projects/{pid}/paper/import',{'source':SOURCE},201)
    para=doc['paragraphs'][0]['id']; client.put(f'/api/paragraphs/{para}/outline',json={'purpose':'Persistent outline'})
    sid=uid(); services['store'].execute('INSERT INTO agent_sessions(id,project_id,role,stage,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(sid,pid,'Assistant','Idea','running',now(),now()))
    services['codex'].record(sid,'user/message',{'text':'Persistent context'})
    backup=services['store'].backup()
    with sqlite3.connect(backup) as db: assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    again=create_app({'TESTING':True,'DATA_DIR':services['store'].root}); c=again.test_client()
    assert c.get('/api/components/'+idea['id']).json['component']['data']['hypothesis']=='Stable after restart'
    assert c.get('/api/sessions/'+sid).json['session']['status']=='disconnected'
    assert c.get('/api/sessions/'+sid).json['messages'][0]['payload']['text']=='Persistent context'
    assert c.get(f'/api/projects/{pid}/paper?path={doc["path"]}').json['paragraphs'][0]['outline']['purpose']=='Persistent outline'
    again.extensions['easyref']['codex'].close()


def test_codex_reasoning_not_persisted(services,project):
    adapter=services['codex']; sid=uid(); store=services['store']
    store.execute('INSERT INTO agent_sessions(id,project_id,thread_id,role,stage,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',(sid,project['id'],'thread-test','Assistant','Idea','running',now(),now()))
    adapter.threads['thread-test']=sid
    adapter._event({'method':'item/reasoning/textDelta','params':{'threadId':'thread-test','delta':'HIDDEN CONTENT'}})
    adapter._event({'method':'item/completed','params':{'threadId':'thread-test','item':{'type':'reasoning','text':'HIDDEN CONTENT'}}})
    adapter._event({'method':'item/completed','params':{'threadId':'thread-test','item':{'type':'agentMessage','text':'Visible conclusion'}}})
    messages=store.all('SELECT * FROM agent_messages WHERE session_id=?',(sid,))
    assert len(messages)==1 and 'HIDDEN' not in encode(messages)


def test_loopback_csrf_guard(app):
    app.testing=False; client=app.test_client()
    assert client.post('/api/projects',json={'name':'bad'},headers={'Origin':'https://evil.example'}).status_code==403
    assert client.get('/api/projects',headers={'Host':'evil.example'}).status_code==403
    assert client.post('/api/projects',data='name=bad',content_type='application/x-www-form-urlencoded').status_code==415


def test_branch_components_and_outline_are_isolated(client,services,project):
    pid=project['id']; versions=services['versions']
    idea=component(client,pid,data={'hypothesis':'Research core'})
    doc=post(client,f'/api/projects/{pid}/paper/import',{'source':SOURCE},201)
    paragraph=doc['paragraphs'][0]['id']
    client.put(f'/api/paragraphs/{paragraph}/outline',json={'purpose':'Core outline'})
    versions.checkpoint(pid,'Research main state')
    GitService(project['root_path']).branch('submission/isolated')
    versions.switch(pid,'submission/isolated')
    client.put('/api/components/'+idea['id'],json={'data':{'hypothesis':'Submission revision'},'expected_revision':idea['revision_id']})
    client.put(f'/api/paragraphs/{paragraph}/outline',json={'purpose':'Submission outline'})
    versions.checkpoint(pid,'Submission state')
    versions.switch(pid,'research/main')
    assert services['store'].component(idea['id'])['data']['hypothesis']=='Research core'
    assert services['store'].one('SELECT purpose FROM paragraph_outlines WHERE paragraph_id=?',(paragraph,))['purpose']=='Core outline'
    versions.switch(pid,'submission/isolated')
    assert services['store'].component(idea['id'])['data']['hypothesis']=='Submission revision'
    assert services['store'].one('SELECT purpose FROM paragraph_outlines WHERE paragraph_id=?',(paragraph,))['purpose']=='Submission outline'


def test_backup_export_restore_without_overwrite(client,services,project,tmp_path):
    from scripts.local_data import export_data,restore_data
    pid=project['id']; doc=post(client,f'/api/projects/{pid}/paper/import',{'source':SOURCE},201)
    services['versions'].checkpoint(pid,'Backup test')
    output=tmp_path/'backup.zip'; export_data(services['store'].root,output)
    dest=tmp_path/'restored'; restore_data(output,dest)
    restored=Store(dest); p=restored.project(pid)
    assert str(dest) in p['root_path']
    assert (Path(p['root_path'])/doc['path']).exists()
    assert GitService(p['root_path']).status()['commit']==GitService(project['root_path']).status()['commit']
    with pytest.raises(ValueError,match='为空'): restore_data(output,dest)


def test_codex_nested_reasoning_is_filtered(services,project):
    adapter=services['codex']; sid=uid(); store=services['store']
    store.execute('INSERT INTO agent_sessions(id,project_id,thread_id,role,stage,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',(sid,project['id'],'nested-thread','Assistant','Idea','running',now(),now()))
    adapter.threads['nested-thread']=sid
    adapter._event({'method':'turn/completed','params':{'threadId':'nested-thread','turn':{'id':'turn','status':'completed','items':[{'type':'reasoning','text':'HIDDEN'},{'type':'agentMessage','text':'Public conclusion'}]}}})
    payload=store.all('SELECT * FROM agent_messages WHERE session_id=?',(sid,))
    assert 'HIDDEN' not in encode(payload) and 'Public conclusion' in encode(payload)
