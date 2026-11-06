"""Build an actual, explicitly synthetic research project and optional local Codex smoke."""
import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.research_schema import new_project,new_object,ResearchProject
from app.research_schema.model import task_data,uid
from app.research_schema.storage import sha,atomic
from app.research_schema.exchange import export_project,import_project,discover

def build(destination):
    destination=Path(destination).resolve()
    if destination.exists(): raise ValueError('Example output must be a new directory')
    with tempfile.TemporaryDirectory(prefix='easyref-example-') as tmp:
        root=Path(tmp)/'source'; root.mkdir(); (root/'src').mkdir(); (root/'paper').mkdir()
        script='''"""Synthetic integration fixture, not a scientific result."""
import json
from pathlib import Path
values = [1, 2, 3, 4]
Path("results.json").write_text(json.dumps({"count": len(values), "mean": sum(values)/len(values)}), encoding="utf-8")
print("TEST DATA: computed mean of four integers")
'''
        (root/'src/baseline.py').write_text(script,encoding='utf-8')
        run=subprocess.run([sys.executable,'src/baseline.py'],cwd=root,capture_output=True,text=True,check=True)
        (root/'run.log').write_text(run.stdout,encoding='utf-8'); metrics=json.loads((root/'results.json').read_text('utf-8'))
        (root/'README.md').write_text('# EasyRef portable example\n\nTEST DATA ONLY. A real Python execution computed the mean of [1,2,3,4]. A second experiment remains interrupted. No scientific performance claim is made.\n',encoding='utf-8')
        (root/'AGENTS.md').write_text('# Project conventions\n\nRead research.yaml and handoff.yaml before proposing work. Preserve stable IDs and paragraph anchors. Treat results as synthetic integration fixtures. Do not execute project commands without user authorization.\n',encoding='utf-8')
        doc=new_project('EasyRef portable research example — TEST DATA'); pid=doc['project_id']
        doc['objects'][0]['data']['objective']='Verify portable research state using a deterministic, synthetic Python computation.'
        idea=new_object('Idea',pid,'Deterministic computation',{'statement':'Use the mean of four known integers to verify result provenance.'})
        module=new_object('ModelModule',pid,'Mean computation',{'purpose':'Compute an auditable arithmetic mean','code_refs':['src/baseline.py']})
        blueprint=new_object('ModelBlueprint',pid,'Fixture blueprint',{'design_goal':'Preserve module identity through export','modules':[module['id']],'edges':[],'code_refs':['src/baseline.py'],'history':[],'decisions':[]})
        experiment=new_object('Experiment',pid,'Synthetic baseline',{'objective':'Execute deterministic fixture','config':{'values':[1,2,3,4]}})
        result=new_object('ExperimentRun',pid,'Executed synthetic baseline',{'execution_status':'succeeded','config':{'values':[1,2,3,4]},'metrics':metrics,'outputs':['results.json','run.log']}); result['status']='completed'; result['provenance']={'kind':'fact','actor':'Python subprocess','sources':['src/baseline.py','results.json','run.log']}
        evidence=new_object('Evidence',pid,'Actual metrics file',{'source_id':result['id'],'locator':'results.json','sha256':sha(root/'results.json')})
        claim=new_object('ResearchClaim',pid,'Synthetic arithmetic result',{'statement':'For fixture values [1,2,3,4], the computed mean is 2.5. This is TEST DATA.','evidence':[evidence['id']]})
        issue=new_object('ReviewIssue',pid,'No generalization claim',{'problem':'This arithmetic fixture cannot support a scientific model comparison.','verification':'Keep every output labeled TEST DATA.','resolution_status':'open'})
        task=new_object('Task',pid,'Continue synthetic second run',task_data('Check partial outputs before planning a second fixture run'))
        task['status']='interrupted'; task['data']['stage']='Experiment'; task['data']['checkpoint'].update(completed_steps=['prepared fixture inputs'],written_files=['src/baseline.py','results.json'],successful_commands=['python src/baseline.py'],reusable_outputs=['results.json'],processes=['original Python process exited'],git_changes='not a Git repository',preflight_checks=['Read prior metrics and verify their hash','Decide whether a second run is needed'])
        doc['objects'] += [idea,module,blueprint,experiment,result,evidence,claim,issue,task]
        paragraphs=[]
        for title,purpose,text in [('Motivation','State the fixture scope','This paper is a synthetic integration fixture.'),('Method','Explain the deterministic operation','The fixture computes the mean of four known integers.'),('Results','Link the measured output','The observed mean is 2.5; no scientific comparison is claimed.')]:
            p=new_object('PaperParagraph',pid,title,{'source_path':'paper/main.tex','anchor':'','claims':[claim['id']] if title=='Results' else []}); p['data']['anchor']=p['id']
            outline=new_object('ParagraphOutline',pid,title+' outline',{'paragraph_id':p['id'],'purpose':purpose,'main_claim':claim['data']['statement'] if title=='Results' else 'unknown','evidence':[evidence['id']] if title=='Results' else [],'locked':True,'pinned':True})
            doc['objects'] += [p,outline]; paragraphs.append('% easyref:paragraph:'+p['id']+'\n'+text+'\n')
        (root/'paper/main.tex').write_text('\\documentclass{article}\n\\begin{document}\n'+'\n'.join(paragraphs)+'\\end{document}\n',encoding='utf-8')
        paper=new_object('Paper',pid,'Synthetic fixture paper',{'source_path':'paper/main.tex','sections':[]}); doc['objects'].append(paper)
        doc['relationships']=[{'id':uid(),'type':'supports','source':evidence['id'],'target':claim['id'],'evidence':[evidence['id']],'provenance':{'kind':'fact','actor':'fixture author','sources':['results.json']}}, {'id':uid(),'type':'addresses','source':task['id'],'target':issue['id'],'evidence':[],'provenance':{'kind':'hypothesis','actor':'fixture author','sources':[]}}]
        doc['files']=discover(root)[0]; ResearchProject(root).save(doc,'example.actual-python-run')
        export_project(root,destination)
    return {'path':str(destination),'metrics':metrics,'objects':len(doc['objects']),'test_data':True}

def codex_smoke():
    from app.local_store import Store
    from app.local_codex import CodexAdapter
    from app.research_schema.bridge import ResearchSchemaService
    with tempfile.TemporaryDirectory(prefix='easyref-codex-schema-') as tmp:
        store=Store(Path(tmp)/'app'); project=store.create_project('Schema recovery integration — TEST DATA')
        store.execute('UPDATE projects SET settings_json=? WHERE id=?',(json.dumps({'codex_effort':'low'}),project['id']))
        idea=store.save_component(project['id'],'idea','Fixture fact',{'statement':'TEST DATA: actual_value=17'})
        adapter=CodexAdapter(store)
        try:
            probe=adapter.probe(); print(json.dumps(probe,ensure_ascii=False),flush=True)
            session=adapter.create_session(project['id'],'Idea',read_only=True)
            adapter.turn(session['id'],'This is an authorized integration check. Do not use tools, skills, delegate or modify files. Read the selected structured research context and reply with the literal actual_value, labeling it TEST DATA.',selected=[{'kind':'idea','id':idea['id']}])
            deadline=time.monotonic()+180
            while adapter.session(session['id'])['status'] in {'starting','running','waiting_approval'} and time.monotonic()<deadline: time.sleep(.3)
            row=adapter.session(session['id']); messages=store.all("SELECT * FROM agent_messages WHERE session_id=? AND event='item/completed'",(session['id'],))
            texts=[r['payload']['item'].get('text','') for r in messages if r['payload'].get('item',{}).get('type')=='agentMessage']
            if row['status']!='completed' or not any('17' in x for x in texts):
                print(json.dumps({'status':row['status'],'output':texts,'events':store.all('SELECT event FROM agent_messages WHERE session_id=?',(session['id'],))},ensure_ascii=False),flush=True)
                raise ValueError('Local Codex smoke failed: '+str(row.get('error') or row['status']))
            ResearchSchemaService(store).checkpoint(project['id'],'codex.actual-smoke')
            return {'passed':True,'cli_version':probe.get('version'),'transport':'app-server stdio','output':texts,'test_data':True}
        finally: adapter.close()

def analysis_smoke(interactive=False):
    from app.local_store import Store
    from app.research_schema.analysis import ImportPreviews
    with tempfile.TemporaryDirectory(prefix='easyref-analysis-smoke-') as tmp:
        source=Path(tmp)/'source'; source.mkdir()
        (source/'README.md').write_text('TEST DATA: This unfinished project investigates whether stable research IDs survive migration. No model has been evaluated yet.',encoding='utf-8')
        (source/'model.py').write_text('class IdentityModel:\n    def forward(self, value):\n        return value\n',encoding='utf-8')
        previews=ImportPreviews(Store(Path(tmp)/'app'),analysis_effort='low'); preview=previews.preview(source)
        job=previews.start_analysis(preview['preview_id']); print('Local Codex import analysis started',flush=True)
        deadline=time.monotonic()+260
        while previews.status(job['id'])['status'] in {'running','waiting_approval'} and time.monotonic()<deadline:
            current=previews.status(job['id'])
            if current['status']=='waiting_approval':
                if not interactive:
                    for adapter,session_id in list(previews.adapters.values()): adapter.close()
                    raise ValueError('Analysis requires interactive approval; rerun with --interactive')
                for approval in current.get('approvals',[]):
                    print(json.dumps(approval,ensure_ascii=False,indent=2),flush=True)
                    response=json.loads(input('Explicit approval response JSON: '))
                    previews.approve(job['id'],approval['request_id'],response)
            time.sleep(.5)
        result=previews.status(job['id'])
        if result['status']!='completed': raise ValueError(str(result))
        draft=previews.get(preview['preview_id'],source,preview['fingerprint'])['document']
        assert all(o['validation_status']!='verified' for o in draft['objects'])
        assert not (source/'research.yaml').exists()
        return {'passed':True,'test_data':True,'analysis':result['result'],'source_unchanged':True}

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--output'); parser.add_argument('--codex',action='store_true'); parser.add_argument('--analyze',action='store_true'); parser.add_argument('--interactive',action='store_true'); args=parser.parse_args()
    print(json.dumps(analysis_smoke(args.interactive) if args.analyze else codex_smoke() if args.codex else build(args.output),ensure_ascii=False,indent=2))
