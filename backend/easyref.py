"""Run with: python backend/easyref.py <command> <project>."""
import argparse
import json
import sys
import zipfile
import yaml
from jsonschema import ValidationError
from pathlib import Path
from app.research_schema import ResearchProject
from app.research_schema.exchange import preview_import, import_project, export_project, resume_plan, recovery_report, verify_package

def main(argv=None):
    # Windows redirected stdout otherwise inherits a legacy code page, making
    # JSON pipelines fail on project titles even though files are UTF-8.
    for stream in (sys.stdout,sys.stderr):
        if hasattr(stream,'reconfigure'): stream.reconfigure(encoding='utf-8')
    parser=argparse.ArgumentParser(prog='easyref',description='Portable EasyRef Research Schema tools')
    sub=parser.add_subparsers(dest='command',required=True)
    for command in ['validate','status','resume','rebuild','timeline']:
        child=sub.add_parser(command); child.add_argument('project')
        if command=='resume':
            child.add_argument('--execute',action='store_true',help='Display plan, require interactive approval, then start local Codex')
            child.add_argument('--data-dir',default='.easyref-cli')
    child=sub.add_parser('import'); child.add_argument('path'); child.add_argument('--destination'); child.add_argument('--confirm',action='store_true'); child.add_argument('--fingerprint')
    child=sub.add_parser('export'); child.add_argument('project'); child.add_argument('--output',required=True); child.add_argument('--mode',choices=['metadata','portable','reproducible'],default='portable'); child.add_argument('--git-history',action='store_true')
    args=parser.parse_args(argv)
    try:
        if args.command=='import':
            if args.confirm and (not args.destination or not args.fingerprint): raise ValueError('--confirm requires --destination and the preview --fingerprint')
            result=import_project(args.path,args.destination or '',args.confirm,args.fingerprint)
        elif args.command=='export': result=export_project(args.project,args.output,args.mode,args.git_history)
        elif args.command=='validate':
            doc=verify_package(Path(args.project).resolve()); result={'valid':True,'project_id':doc['project_id'],'objects':len(doc['objects'])}
        elif args.command=='status': result=recovery_report(ResearchProject(args.project).read(),args.project)
        elif args.command=='timeline': result=ResearchProject(args.project).events()
        elif args.command=='rebuild': result={'index':str(ResearchProject(args.project).rebuild())}
        else:
            result=resume_plan(args.project)
            if args.execute:
                print(json.dumps(result,ensure_ascii=False,indent=2))
                if not result['can_start']: raise ValueError('Missing or unconfirmed prerequisites; no process started')
                if not sys.stdin.isatty() or input('Start local Codex for this plan? Type APPROVE: ')!='APPROVE': raise ValueError('Execution not approved')
                from app.local_store import Store
                from app.local_codex import CodexAdapter
                from app.research_schema.bridge import ResearchSchemaService
                store=Store(args.data_dir); service=ResearchSchemaService(store); pid=result['context']['project']['id']
                if not store.one('SELECT id FROM projects WHERE id=?',(pid,)): service.restore(args.project)
                adapter=CodexAdapter(store)
                try:
                    session=adapter.create_session(pid,context={'research_schema':result['context']})
                    adapter.turn(session['id'],'Continue the explicitly approved recovery plan. Check existing outputs first.')
                    import time
                    while adapter.session(session['id'])['status'] in {'running','starting','waiting_approval'}:
                        pending=[(k,v) for k,v in adapter.approvals.items() if v['session_id']==session['id']]
                        for key,approval in pending:
                            print(json.dumps(approval,ensure_ascii=False,indent=2))
                            response=json.loads(input('Enter the explicit approval response JSON (or Ctrl+C to interrupt): '))
                            adapter.approve(session['id'],key,response)
                        time.sleep(.5)
                    result={'session':adapter.session(session['id'])}
                finally:
                    adapter.close(); service.checkpoint(pid,'cli.resume.finished')
        print(json.dumps(result,ensure_ascii=False,indent=2)); return 0
    except (ValueError,OSError,KeyError,json.JSONDecodeError,zipfile.BadZipFile,yaml.YAMLError,ValidationError) as exc:
        print(json.dumps({'error':str(exc)},ensure_ascii=False),file=sys.stderr); return 1

if __name__=='__main__': raise SystemExit(main())
