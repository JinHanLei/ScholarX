import json
import threading
import time
from .local_store import encode, now, uid

ROLES=['Novelty Reviewer','Methodology Reviewer','Experiment Reviewer','Reproducibility Reviewer','Writing Reviewer','Author / Rebuttal Agent']
ISSUE_SCHEMA={'type':'object','additionalProperties':False,'required':['summary','issues'],'properties':{
    'summary':{'type':'string'},'issues':{'type':'array','items':{'type':'object','additionalProperties':False,
    'required':['severity','component_id','experiment_id','problem','evidence','suggested_fix','verification'],
    'properties':{key:({'type':['string','null']} if key in {'component_id','experiment_id'} else {'type':'string'}) for key in ['severity','component_id','experiment_id','problem','evidence','suggested_fix','verification']}}}}}


class Reviews:
    def __init__(self,store,codex):
        self.store=store; self.codex=codex; self.stops={}
        store.execute("UPDATE reviews SET status='interrupted' WHERE status='running'")

    def start(self,project_id,data):
        project=self.store.project(project_id)
        roles=data.get('roles') or ['Methodology Reviewer','Author / Rebuttal Agent']
        if not roles or any(role not in ROLES for role in roles): raise ValueError('无效的审稿角色')
        rounds=int(data.get('max_rounds',1)); seconds=int(data.get('max_seconds',600))
        if not 1<=rounds<=5 or not 30<=seconds<=3600: raise ValueError('讨论限制为 1–5 轮、30–3600 秒')
        ident=uid(); scope={'roles':roles,'selected':data.get('selected',[]),'instructions':data.get('instructions',''),'model_note':'不同审稿角色，沿用同一 Codex 配置；不是独立模型交叉验证'}
        self.store.execute('INSERT INTO reviews(id,project_id,scope_json,status,max_rounds,max_seconds,created_at) VALUES(?,?,?,?,?,?,?)',(ident,project_id,encode(scope),'running',rounds,seconds,now()))
        stop=threading.Event(); self.stops[ident]=stop
        threading.Thread(target=self._run,args=(ident,stop),daemon=True).start()
        return self.get(ident)

    def get(self,ident):
        review=self.store.one('SELECT * FROM reviews WHERE id=?',(ident,),True)
        review['issues']=self.store.all('SELECT * FROM review_issues WHERE review_id=? ORDER BY created_at',(ident,))
        return review

    def _run(self,ident,stop):
        review=self.get(ident); deadline=time.monotonic()+review['max_seconds']; session_id=None
        try:
            for round_index in range(review['max_rounds']):
                self.store.execute('UPDATE reviews SET round=? WHERE id=?',(round_index+1,ident))
                for role in review['scope']['roles']:
                    if stop.is_set() or time.monotonic()>=deadline: raise InterruptedError('审稿已停止或达到时间预算')
                    session=self.codex.create_session(review['project_id'],'Review',role,{'review_id':ident},read_only=True)
                    session_id=session['id']; review['sessions'].append(session_id)
                    self.store.execute('UPDATE reviews SET sessions_json=? WHERE id=?',(encode(review['sessions']),ident))
                    issues=self.store.all('SELECT * FROM review_issues WHERE review_id=?',(ident,))
                    components=self.store.all("SELECT id,kind,name FROM components WHERE project_id=? AND status!='absent_in_branch'",(review['project_id'],))
                    prompt=f'Conduct round {round_index+1} as {role}. Review the actual project files and selected source evidence. Do not modify files. Report only substantiated issues; an empty issues list is valid. Never invent metrics or citations. Component IDs may be null when no reliable mapping exists. Explain disagreement with earlier reviewers in summary; no hidden chain of thought. Do not mark an issue resolved without verification.\nUser scope: '+review['scope']['instructions']+'\nKnown components: '+encode(components)+'\nPrior issues: '+encode(issues)
                    self.codex.turn(session_id,prompt,review['scope']['selected'],output_schema=ISSUE_SCHEMA)
                    while self.codex.session(session_id)['status'] in {'running','starting','waiting_approval'}:
                        if stop.wait(0.4) or time.monotonic()>=deadline:
                            self.codex.interrupt(session_id); raise InterruptedError('审稿已停止或达到时间预算')
                    current=self.codex.session(session_id)
                    if current['status']!='completed': raise ValueError(current.get('error') or '审稿会话未完成')
                    messages=self.store.all("SELECT * FROM agent_messages WHERE session_id=? AND event='item/completed' ORDER BY id DESC",(session_id,))
                    text=next((m['payload']['item'].get('text','') for m in messages if m['payload'].get('item',{}).get('type')=='agentMessage'),'')
                    try: output=json.loads(text)
                    except json.JSONDecodeError: raise ValueError('审稿输出不是有效结构化 JSON；保留原始会话供检查')
                    import jsonschema
                    jsonschema.validate(output,ISSUE_SCHEMA)
                    self.codex.record(session_id,'review/conclusion',output)
                    for issue in output['issues']:
                        component=issue['component_id'] or None; experiment=issue['experiment_id'] or None
                        if component: self.store.component(component,review['project_id'])
                        if experiment: self.store.one('SELECT id FROM experiments WHERE id=? AND project_id=?',(experiment,review['project_id']),True)
                        self.store.execute('INSERT INTO review_issues VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(uid(),ident,session_id,issue['severity'],component,experiment,issue['problem'],issue['evidence'],issue['suggested_fix'],issue['verification'],'open',now()))
                # A round with no issues is a concrete stop condition.
                if not self.store.one('SELECT id FROM review_issues WHERE review_id=?',(ident,)): break
            self.store.execute("UPDATE reviews SET status='completed' WHERE id=?",(ident,))
        except Exception as exc:
            self.store.execute('UPDATE reviews SET status=? WHERE id=?',('interrupted' if isinstance(exc,InterruptedError) else 'failed',ident))
            if session_id: self.codex.record(session_id,'review/error',{'message':str(exc)})
        finally: self.stops.pop(ident,None)

    def stop(self,ident):
        if ident in self.stops: self.stops[ident].set()
        return self.get(ident)
