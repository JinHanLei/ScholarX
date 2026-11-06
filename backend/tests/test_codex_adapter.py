"""Deterministic transport/control tests; live model acceptance is smoke_codex.py."""
import json
import threading
import time
from types import SimpleNamespace
import pytest
from app.local_store import uid,now


def session(services,project):
    a=services['codex']; ident=uid(); thread=uid()
    a.store.execute('INSERT INTO agent_sessions(id,project_id,thread_id,role,stage,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',(ident,project['id'],thread,'Assistant','Idea','idle',now(),now()))
    a.threads[thread]=ident
    return a,ident,thread


def test_disconnect_wakes_pending_request_and_marks_session(services,project,monkeypatch):
    a,ident,thread=session(services,project)
    a.schema_dir.joinpath('v2').mkdir(parents=True)
    a.schema_dir.joinpath('v2/TurnInterruptParams.json').write_text(json.dumps({'type':'object'}))
    process=SimpleNamespace(stdout=iter([])); a.process=process
    a.store.execute("UPDATE agent_sessions SET status='running' WHERE id=?",(ident,))
    monkeypatch.setattr(a,'_send',lambda message: threading.Thread(target=a._read,args=(process,),daemon=True).start())
    try:
        with pytest.raises(ValueError,match='关闭'): a.rpc('turn/interrupt',{'threadId':thread,'turnId':'t'},start=False,timeout=2)
        assert a.session(ident)['status']=='disconnected'
    finally: a.process=None


def test_approval_response_is_validated_forwarded_and_not_auto_accepted(services,project,monkeypatch):
    a,ident,thread=session(services,project); sent=[]
    monkeypatch.setattr(a,'_send',sent.append)
    a.schema_dir.mkdir(parents=True,exist_ok=True)
    a.schema_dir.joinpath('CommandExecutionRequestApprovalResponse.json').write_text(json.dumps({'type':'object','required':['decision'],'properties':{'decision':{'enum':['accept','decline']}}}))
    a._event({'id':42,'method':'item/commandExecution/requestApproval','params':{'threadId':thread,'command':'python train.py'}})
    assert sent==[] and a.session(ident)['status']=='waiting_approval'
    key=next(iter(a.approvals))
    a.approve(ident,key,{'decision':'decline'})
    assert sent==[{'id':42,'result':{'decision':'decline'}}]
    with pytest.raises(ValueError): a.approve(ident,key,{'decision':'accept'})


def test_skill_sequence_uses_separate_ordered_turns(services,project,monkeypatch):
    a,ident,thread=session(services,project); calls=[]
    monkeypatch.setattr(a,'resume',lambda ident: {})
    monkeypatch.setattr(a,'skills',lambda pid: {'skills':[{'name':'first','path':'first/SKILL.md','available':True},{'name':'second','path':'second/SKILL.md','available':True}]})
    def rpc(method,params,**kw):
        assert method=='turn/start'; calls.append(params)
        turn_id='turn-'+str(len(calls))
        a._event({'method':'turn/started','params':{'threadId':thread,'turn':{'id':turn_id,'status':'inProgress','items':[]}}})
        return {'turn':{'id':turn_id}}
    monkeypatch.setattr(a,'rpc',rpc)
    a.turn(ident,'Ordered workflow',skills=['first/SKILL.md','second/SKILL.md'])
    assert len(calls)==1 and calls[0]['input'][1]['name']=='first'
    statuses=a.store.all('SELECT status FROM skill_runs WHERE session_id=? ORDER BY position',(ident,))
    assert [s['status'] for s in statuses]==['running','pending']
    a._event({'method':'item/completed','params':{'threadId':thread,'item':{'type':'agentMessage','id':'a','text':'First result'}}})
    a._event({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':'turn-1','status':'completed','items':[]}}})
    deadline=time.monotonic()+3
    while len(calls)<2 and time.monotonic()<deadline: time.sleep(.02)
    assert len(calls)==2 and calls[1]['input'][1]['name']=='second'
    a._event({'method':'item/completed','params':{'threadId':thread,'item':{'type':'agentMessage','id':'b','text':'Second result'}}})
    a._event({'method':'turn/completed','params':{'threadId':thread,'turn':{'id':'turn-2','status':'completed','items':[]}}})
    runs=a.store.all('SELECT * FROM skill_runs WHERE session_id=? ORDER BY position',(ident,))
    assert [r['status'] for r in runs]==['completed','completed']
    assert runs[0]['result']['output']=='First result' and runs[1]['result']['output']=='Second result'
