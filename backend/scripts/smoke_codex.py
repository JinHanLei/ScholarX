"""Opt-in real CLI acceptance smoke. Uses an isolated TEST DATA project, never research results.
Run: python backend/scripts/smoke_codex.py [--review]
"""
import argparse
import json
import sys
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import create_app


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--review',action='store_true'); args=parser.parse_args()
    output=Path(__file__).resolve().parents[1]/'data'/'live-smoke'
    app=create_app({'TESTING':True,'DATA_DIR':output})
    services=app.extensions['easyref']; store=services['store']; codex=services['codex']
    projects=store.all('SELECT * FROM projects')
    project=projects[0] if projects else store.create_project('LIVE INTEGRATION TEST - not research')
    root=Path(project['root_path']); skill=root/'.agents'/'skills'/'easyref-local-smoke'; skill.mkdir(parents=True,exist_ok=True)
    # This isolated test explicitly requests low effort; normal projects inherit CLI defaults.
    store.execute('UPDATE projects SET settings_json=? WHERE id=?',(json.dumps({'codex_effort':'low'}),project['id']))
    (skill/'SKILL.md').write_text('---\nname: easyref-local-smoke\ndescription: Read local smoke evidence and report its literal value. Only for EasyRef integration verification.\n---\nRead evidence.txt. Report the literal value and explicitly identify test data. Do not edit files, browse, delegate, or invent results.\n',encoding='utf8')
    (root/'evidence.txt').write_text('TEST DATA: actual_value=17\n',encoding='utf8')
    result={'project_id':project['id'],'test_data':True}
    try:
        skills=codex.skills(project['id'])['skills']; found=next(s for s in skills if s['name']=='easyref-local-smoke')
        print('SKILLS',len(skills),'fixture discovered',flush=True)
        session=codex.create_session(project['id'],'Literature',read_only=True); ident=session['id']
        result['session_id']=ident; print('SESSION',ident,flush=True)
        codex.turn(ident,'Use the selected skill. Report the value in one sentence.',skills=[found['path']])
        print('TURN_STARTED',flush=True)
        try:
            codex.steer(ident,'Label the result explicitly as TEST DATA.'); result['steer']='accepted'
        except ValueError as exc: result['steer']=str(exc)
        deadline=time.monotonic()+300
        while codex.session(ident)['status'] in {'running','starting','waiting_approval'} and time.monotonic()<deadline: time.sleep(.5)
        result['session']=codex.session(ident)
        result['messages']=store.all("SELECT * FROM agent_messages WHERE session_id=? AND event IN ('item/completed','error','adapter/error')",(ident,))
        texts=[m['payload']['item'].get('text','') for m in result['messages'] if m['payload'].get('item',{}).get('type')=='agentMessage']
        print('STATUS',result['session']['status'],result['session'].get('error'),flush=True)
        print('OUTPUT','\n'.join(texts),flush=True)
        if result['session']['status']!='completed' or not any('17' in text for text in texts): raise RuntimeError('Real Codex Skill smoke did not complete with evidence value')
        # A second real turn exercises interruption and disconnect recovery.
        codex.turn(ident,'Read evidence.txt again and inspect the project files; wait for my follow-up before changing anything.')
        codex.interrupt(ident); time.sleep(1)
        result['interrupted_status']=codex.session(ident)['status']
        codex.close(); time.sleep(.5); codex.resume(ident)
        result['resumed_status']=codex.session(ident)['status']
        if args.review:
            doc=services['paper'].import_source(project['id'],'review-test-'+str(int(time.time()))+'.tex','\\documentclass{article}\n\\begin{document}\n\\section{Results}\nThis TEST manuscript claims 99 percent accuracy, but supplies no experiment or citation.\n\\end{document}')
            pid=doc['paragraphs'][0]['id']
            review=services['reviews'].start(project['id'],{'mode':'adversarial','roles':['Experiment Reviewer'],'selected':[{'kind':'paragraph','id':pid}], 'instructions':'Review only the selected TEST DATA paragraph. The unsupported accuracy statement is deliberately present to test issue registration. Identify the missing evidence, using the exact selected paragraph ID. Do not review application code or call other skills.','max_rounds':1,'max_seconds':300})
            deadline=time.monotonic()+305
            while services['reviews'].get(review['id'])['status']=='running' and time.monotonic()<deadline: time.sleep(1)
            result['review']=services['reviews'].get(review['id'])
            print('REVIEW',result['review']['status'],'issues',len(result['review']['issues']),flush=True)
            if result['review']['status']!='completed' or not result['review']['issues']: raise RuntimeError('Real review issue registration did not complete')
        print('LIVE_ACCEPTANCE_PASS',flush=True)
    finally:
        codex.close()
        output.parent.joinpath('live-smoke-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')


if __name__=='__main__': main()
