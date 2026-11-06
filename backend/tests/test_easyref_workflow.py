import json
import sys
from pathlib import Path
import pytest
from app.local_workflow import catalog, progress, save_brief
from app.local_store import encode, now, uid


def test_brief_requires_venue_and_preserves_revisions(client, services, project):
    pid = project['id']; url = f'/api/projects/{pid}/research-brief'
    assert client.put(url,json={'research_question':'A falsifiable question'}).status_code == 400
    first = client.put(url,json={'research_question':'A falsifiable question','target_venue':'TKDE'}).json['brief']
    second = client.put(url,json={'research_question':'A narrower question','target_venue':'TKDE','expected_revision':first['component']['revision_id']}).json['brief']
    assert first['component']['id'] == second['component']['id']
    assert first['component']['revision_id'] != second['component']['revision_id']
    assert client.put(url,json={'research_question':'stale','target_venue':'AAAI','expected_revision':first['component']['revision_id']}).status_code == 400
    assert json.loads((Path(project['root_path'])/'research/brief.json').read_text('utf8'))['target_venue'] == 'TKDE'
    items = catalog(services['store'],pid)['skills']
    assert [s['name'] for s in items] == ['easyref-research']
    assert Path(items[0]['path']).is_file()


def test_workflow_rejects_phantom_completion_and_detects_changed_goal(services,project):
    store=services['store']; pid=project['id']; root=Path(project['root_path'])
    save_brief(store,pid,{'research_question':'Q','target_venue':'TKDE'})
    path=root/'research/workflow.json'
    path.write_text(json.dumps({'research_question':'old Q','target_venue':'TKDE','phases':{'experiments':{'status':'completed','artifacts':['missing.json']}}}))
    value=progress(store,pid)
    assert value['stale'] and value['phases']['experiments']['status']=='blocked'
    assert value['phases']['experiments']['missing_artifacts']==['missing.json']
    path.write_text(json.dumps({'phases':{'paper':{'status':'completed','artifacts':['../outside.tex']}}}))
    with pytest.raises(ValueError): progress(store,pid)


def test_empty_brief_cannot_start_easyref_skill(services,project,monkeypatch):
    a=services['codex']; ident=uid()
    a.store.execute('INSERT INTO agent_sessions(id,project_id,thread_id,role,stage,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',(ident,project['id'],'thread','Assistant','Idea','idle',now(),now()))
    monkeypatch.setattr(a,'resume',lambda ident: {})
    with pytest.raises(ValueError,match='研究问题与目标'):
        a.turn(ident,'Start research',skills=[catalog(a.store)['skills'][0]['path']])


def test_experiment_pins_project_python(services,project):
    root=Path(project['root_path']); (root/'run.py').write_text('print("runtime witness")')
    store=services['store']
    store.execute('UPDATE projects SET settings_json=? WHERE id=?',(encode({'python_executable':sys.executable}),project['id']))
    run=services['experiments'].register(project['id'],{'command':['python','run.py'],'config':{'dataset':'test','split':'test','seed':0,'hyperparameters':{},'evaluation_protocol':'test'}})
    assert Path(run['environment']['interpreter']).resolve()==Path(sys.executable).resolve()
    assert run['environment']['runtime_version'].startswith('Python')
    assert len(run['environment']['interpreter_sha256'])==64


def test_paper_discovery_under_managed_easyref_parent(services,tmp_path):
    root=tmp_path/'.easyref'/'projects'/'managed'; root.mkdir(parents=True)
    p=services['store'].create_project('Managed paper',root)
    (root/'paper').mkdir(); (root/'paper/main.tex').write_text('article')
    (root/'.easyref').mkdir(exist_ok=True); (root/'.easyref/private.tex').write_text('private')
    assert services['paper'].files(p['id'])==['paper/main.tex']


def test_actual_returned_model_identity_is_preserved(services,project,monkeypatch):
    a=services['codex']
    monkeypatch.setattr(a,'rpc',lambda *args,**kwargs: {'thread':{'id':'actual-thread'},'model':'actual-returned-model','modelProvider':'test-provider','reasoningEffort':'medium'})
    s=a.create_session(project['id'],'Review',context={'review_id':'review-witness'},read_only=True)
    context=a.context(s,[])
    assert context['executor']['model']=='actual-returned-model'
    assert context['review_id']=='review-witness'
    assert context['session_id']==s['id']
    assert a.store.one("SELECT event FROM agent_messages WHERE session_id=?",(s['id'],))['event']=='session/identity'


def test_personal_reference_retains_primary_url(services):
    literature=services['literature']
    ident=literature.upsert({'title':'Actual source metadata test','url':'https://arxiv.org/abs/2604.05543'},'personal')
    item=services['store'].one('SELECT * FROM papers WHERE id=?',(ident,))
    assert item['dblp_url']=='https://arxiv.org/abs/2604.05543'


def test_session_tail_retains_conclusions_without_replaying_large_logs(services,project,client):
    store=services['store']; ident=uid(); stamp=now()
    store.execute('INSERT INTO agent_sessions(id,project_id,role,stage,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',(ident,project['id'],'Assistant','Idea','completed',stamp,stamp))
    with store.transaction() as conn:
        events=[('user/message',{'text':'Original research question'})]
        events.extend(('item/commandExecution/outputDelta',{'delta':str(i)}) for i in range(1500))
        events.append(('item/completed',{'item':{'type':'agentMessage','id':'final','text':'Actual final conclusion'}}))
        conn.executemany('INSERT INTO agent_messages(session_id,event,payload_json,created_at) VALUES(?,?,?,?)',[(ident,event,encode(payload),stamp) for event,payload in events])
    result=client.get(f'/api/sessions/{ident}?tail=1').json['messages']
    assert len(result)==201
    assert result[0]['payload']['text']=='Original research question'
    assert result[-1]['payload']['item']['text']=='Actual final conclusion'
    assert client.get(f"/api/sessions/{ident}?after={result[-1]['id']}").json['messages']==[]


def test_project_python_preview_is_plain_text_and_stays_inside_root(project,client):
    root=Path(project['root_path']); (root/'adapter.py').write_text('print("source only")')
    response=client.get(f"/api/projects/{project['id']}/file",query_string={'path':'adapter.py'})
    assert response.status_code==200 and response.mimetype=='text/plain'
    assert b'source only' in response.data
    assert client.get(f"/api/projects/{project['id']}/file",query_string={'path':'../outside.py'}).status_code==400
