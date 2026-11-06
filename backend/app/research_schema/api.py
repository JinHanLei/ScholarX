"""Project-wide protocol endpoints shared by Literature/Idea/Experiment/Paper/Review."""
import json
from pathlib import Path
from flask import Blueprint, jsonify, request, send_file
from .bridge import ResearchSchemaService
from .storage import ResearchProject, hash_value
from .exchange import preview_import, import_project, export_project, resume_plan, recovery_report
from .model import uid

WORKSPACES={
    'Literature':{'LiteratureReference','Evidence'}, 'Idea':{'Idea','ResearchQuestion','Hypothesis','ResearchProject'},
    'Experiment':{'ModelBlueprint','ModelModule','Experiment','ExperimentRun','ResearchClaim','Evidence','Task'},
    'Paper':{'Paper','PaperSection','PaperParagraph','ParagraphOutline','Figure','Table','ResearchClaim'},
    'Review':{'Review','ReviewIssue','Decision','SubmissionAttempt','VenueProfile','Task'},
}

def register_schema_api(app,store,codex):
    service=ResearchSchemaService(store); app.extensions['easyref']['schema']=service
    from .analysis import ImportPreviews
    previews=ImportPreviews(store)
    api=Blueprint('research_schema',__name__)
    def root(pid): return Path(store.project(pid)['root_path'])
    def load(pid):
        path=root(pid)
        if not (path/'research.yaml').exists(): service.checkpoint(pid)
        return ResearchProject(path)
    @api.post('/research/import/preview')
    def preview(): return jsonify(previews.preview(request.json['path']))
    @api.post('/research/import/analyze')
    def analyze():
        if request.json.get('approved') is not True: raise ValueError('Approve local Codex analysis of the isolated copy first')
        return jsonify(previews.start_analysis(request.json['preview_id'])),202
    @api.get('/research/import/analysis/<ident>')
    def analysis_status(ident): return jsonify(previews.status(ident))
    @api.post('/research/import/analysis/<ident>/approve')
    def analysis_approve(ident): return jsonify(previews.approve(ident,request.json['request_id'],request.json['response']))
    @api.post('/research/import')
    def import_():
        data=request.json
        if data.get('confirmed') is not True or not data.get('fingerprint'): raise ValueError('Review the import preview and confirm its fingerprint first')
        preview=previews.get(data['preview_id'],data['path'],data['fingerprint']) if data.get('preview_id') else preview_import(data['path'])
        pid=preview['document']['project_id']
        if preview['format']=='standard' and store.one('SELECT id FROM projects WHERE id=?',(pid,)): raise ValueError('This project identity is already registered')
        destination=store.root/'projects'/uid()
        result=import_project(data['path'],destination,True,data['fingerprint'],preview['document'] if preview['format']=='unstructured' else None)
        result['project']=service.restore(destination)
        return jsonify(result),201
    @api.route('/projects/<pid>/research/objects',methods=['GET','PUT'])
    def objects(pid):
        project=load(pid)
        if request.method=='PUT':
            data=request.json
            # Existing SQLite-owned edit forms remain the write interface until projection reconciliation.
            if project.read().get('extensions',{}).get('sqlite_projection'): raise ValueError('Edit through the existing workspace forms; external edits require reconciliation')
            project.save(data['document'],'objects.update',expected=data['expected_hash'])
        doc=project.read(); workspace=request.args.get('workspace')
        if workspace and workspace not in WORKSPACES: raise ValueError('Unknown workspace')
        return jsonify(objects=[o for o in doc['objects'] if not workspace or o['type'] in WORKSPACES[workspace]],relationships=doc['relationships'],document_hash=hash_value(doc))
    @api.post('/projects/<pid>/research/checkpoint')
    def checkpoint(pid): return jsonify(document=service.checkpoint(pid))
    @api.post('/projects/<pid>/research/reconcile')
    def reconcile(pid): return jsonify(document=service.reconcile(pid,request.json['expected_hash']))
    @api.get('/projects/<pid>/research/validate')
    def validate_(pid):
        project=load(pid); doc=project.read(True)
        return jsonify(valid=True,project_id=pid,objects=len(doc['objects']),relationships=len(doc['relationships']))
    @api.get('/projects/<pid>/research/status')
    def status(pid): return jsonify(recovery_report(load(pid).read(),root(pid)))
    @api.get('/projects/<pid>/research/timeline')
    def timeline(pid): return jsonify(events=load(pid).events())
    @api.get('/projects/<pid>/research/context')
    def context(pid): return jsonify(load(pid).context(request.args.getlist('id')))
    @api.get('/projects/<pid>/research/resume')
    def plan(pid): load(pid); return jsonify(resume_plan(root(pid)))
    @api.post('/projects/<pid>/research/resume')
    def resume(pid):
        data=request.json; plan=resume_plan(root(pid),data.get('selected',[]))
        if data.get('approved') is not True or data.get('plan_hash')!=hash_value(plan): raise ValueError('Review and approve the current recovery plan first')
        if not plan['can_start']: raise ValueError('Resolve missing inputs and confirm environment requirements before executing')
        session=codex.create_session(pid,stage=plan['context']['handoff']['current_stage'],context={'research_schema':plan['context']})
        codex.turn(session['id'],data.get('objective') or 'Continue the approved research task using the recovery plan. Verify inputs and outputs; do not assume an old process is alive.')
        return jsonify(session=session)
    @api.get('/projects/<pid>/research/resume-plan')
    def plan_hash(pid):
        load(pid); plan=resume_plan(root(pid)); return jsonify(plan=plan,plan_hash=hash_value(plan))
    @api.post('/projects/<pid>/research/export')
    def export_(pid):
        data=request.json or {}; service.checkpoint(pid,'project.export.checkpoint')
        destination=store.root/'exports'/(uid()+'.zip')
        export_project(root(pid),destination,data.get('mode','portable'),bool(data.get('git_history')))
        return send_file(destination,as_attachment=True,download_name='EasyRef-project.zip')
    app.register_blueprint(api,url_prefix='/api')

    @app.after_request
    def checkpoint_mutations(response):
        if request.method not in {'POST','PUT','PATCH','DELETE'} or response.status_code>=400 or '/research/' in request.path: return response
        # CCF corpus ingestion remains application data and is intentionally excluded.
        if request.path.startswith(('/api/imports','/api/papers/online','/api/backup')): return response
        if not request.path.startswith('/api/'): return response
        if '/git/' in request.path or '/submissions' in request.path: return response
        try:
            args=request.view_args or {}; data=request.get_json(silent=True) or {}; ids=set()
            if args.get('pid'): ids.add(args['pid'])
            if data.get('project_id'): ids.add(data['project_id'])
            result=response.get_json(silent=True) or {}
            if isinstance(result.get('project'),dict): ids.add(result['project']['id'])
            if args.get('ident'):
                for table in ['components','experiments','agent_sessions','reviews']:
                    row=store.one('SELECT project_id FROM '+table+' WHERE id=?',(args['ident'],))
                    if row: ids.add(row['project_id'])
            for pid in ids: service.checkpoint(pid,'api.'+request.method.lower()+':'+request.path)
        except Exception as exc:
            # Never report a durable success if only SQLite received the update.
            response= jsonify(error='Local edit saved, but portable checkpoint failed: '+str(exc),checkpoint_required=True)
            response.status_code=409
        return response

    def on_turn(ident,status):
        session=store.one('SELECT project_id FROM agent_sessions WHERE id=?',(ident,))
        if session:
            try: service.checkpoint(session['project_id'],'codex.'+status)
            except Exception as exc: codex.record(ident,'adapter/error',{'message':'Portable checkpoint failed: '+str(exc)})
    codex.turn_callbacks.append(on_turn)
    return service
