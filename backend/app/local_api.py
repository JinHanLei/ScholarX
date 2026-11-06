import atexit
import difflib
import io
import json
import mimetypes
import os
import shutil
import sqlite3
import time
import zipfile
from pathlib import Path
from urllib.parse import urlparse
from flask import Blueprint, Response, jsonify, request, send_file, send_from_directory, stream_with_context
from werkzeug.exceptions import HTTPException
from .local_store import Store, atomic_write, digest, encode, file_hash, inside, now, uid
from .local_git import GitService
from .local_literature import Literature
from .local_codex import CodexAdapter
from .local_experiments import Experiments
from .local_workflow import brief, save_brief, progress
from .local_paper import PaperService, anchor_source
from .local_review import Reviews, ROLES
from .local_versions import Versions
from .local_proposals import Proposals
from .local_latex import detect_engine


def configure_local(app):
    # Windows registry can incorrectly associate .mjs with text/plain.
    mimetypes.add_type('text/javascript','.mjs')
    default=Path(__file__).resolve().parents[2]/'.easyref'
    store=Store(app.config.get('DATA_DIR') or os.getenv('EASYREF_DATA_DIR') or default)
    literature=Literature(store); codex=CodexAdapter(store); experiments=Experiments(store); paper=PaperService(store); reviews=Reviews(store,codex)
    versions_service=Versions(store)
    proposals_service=Proposals(store)
    atexit.register(experiments.close)
    app.extensions['easyref']={'store':store,'literature':literature,'codex':codex,'experiments':experiments,'paper':paper,'reviews':reviews,'versions':versions_service}
    app.config['MAX_CONTENT_LENGTH']=100*1024*1024
    api=Blueprint('local_api',__name__)

    def body():
        data=request.get_json(silent=False)
        if not isinstance(data,dict): raise ValueError('请求体必须是 JSON 对象')
        return data

    @app.before_request
    def local_only():
        # Prevent remote pages from driving a privileged loopback service (CSRF/DNS rebinding).
        if app.testing: return
        hostname=request.host.split(':')[0].strip('[]')
        if hostname not in {'localhost','127.0.0.1','::1'}: return jsonify(error='仅允许本机访问'),403
        origin=request.headers.get('Origin')
        if origin and urlparse(origin).hostname not in {'localhost','127.0.0.1','::1'}: return jsonify(error='拒绝跨站请求'),403
        if request.method in {'POST','PUT','PATCH','DELETE'} and not (request.is_json or request.mimetype=='multipart/form-data'):
            return jsonify(error='写操作必须使用 JSON 或上传表单'),415

    @app.errorhandler(Exception)
    def error(exc):
        if isinstance(exc,HTTPException): return jsonify(error=exc.description),exc.code
        code=400 if isinstance(exc,(ValueError,KeyError,TypeError,sqlite3.IntegrityError)) else 500
        app.logger.warning('Local API failed: %s',exc)
        return jsonify(error=str(exc)),code

    @app.get('/health')
    def health(): return jsonify(status='ok',storage='sqlite',database=str(store.path))

    @api.get('/status')
    def status():
        compiler=detect_engine()
        return jsonify(name='EasyRef',storage='sqlite',data_dir=str(store.root),registry=literature.registry_info,
                       dblp={'cutoff':None,'imported_at':(store.one("SELECT updated_at FROM import_jobs WHERE status='completed' ORDER BY updated_at DESC LIMIT 1") or {}).get('updated_at')},
                       counts={table:store.one('SELECT COUNT(*) AS n FROM '+table)['n'] for table in ['projects','papers','venues','venue_dblp_mappings']},
                       capabilities={'pdf_paragraph_mapping':False,'latex_compile':compiler['available'],'latex_engine':compiler})

    @api.route('/projects',methods=['GET','POST'])
    def projects():
        if request.method=='GET': return jsonify(projects=store.all('SELECT * FROM projects ORDER BY updated_at DESC'))
        data=body()
        entry=data.get('research_brief')
        settings=data.get('settings',{})
        if not isinstance(settings,dict): raise ValueError('项目设置必须为对象')
        if not isinstance(data.get('name'),str) or not data['name'].strip(): raise ValueError('请输入项目名称')
        if data.get('root_path'):
            raise ValueError('已有目录须先通过 Import Project 预览，再确认建立独立副本；不会直接改写源目录')
        if entry is not None and (not isinstance(entry,dict) or not all(isinstance(entry.get(k),str) and entry[k].strip() for k in ('research_question','target_venue'))):
            raise ValueError('第一步需要研究问题和目标期刊/会议')
        created=store.create_project(data.get('name',''),data.get('root_path'))
        if settings: store.execute('UPDATE projects SET settings_json=? WHERE id=?',(encode(settings),created['id']))
        if entry is not None: save_brief(store,created['id'],entry)
        return jsonify(project=store.project(created['id'])),201

    @api.route('/projects/<pid>',methods=['GET','PATCH'])
    def project(pid):
        item=store.project(pid)
        if request.method=='PATCH':
            data=body(); settings=data.get('settings',item['settings'])
            if not isinstance(settings,dict): raise ValueError('项目设置必须为对象')
            name=data.get('name',item['name'])
            if not isinstance(name,str) or not name.strip(): raise ValueError('请输入项目名称')
            store.execute('UPDATE projects SET name=?,settings_json=?,updated_at=? WHERE id=?',(name.strip(),encode(settings),now(),pid))
        return jsonify(project=store.project(pid),git=GitService(item['root_path']).status())

    @api.route('/projects/<pid>/components',methods=['GET','POST'])
    def components(pid):
        store.project(pid)
        if request.method=='GET':
            return jsonify(components=store.all("SELECT * FROM components WHERE project_id=? AND status!='absent_in_branch'"+(' AND kind=?' if request.args.get('kind') else '')+' ORDER BY created_at', (pid,request.args['kind']) if request.args.get('kind') else (pid,)))
        data=body(); return jsonify(component=store.save_component(pid,data['kind'],data['name'],data.get('data',{}),purpose=data.get('purpose',''))),201

    @api.route('/projects/<pid>/research-brief',methods=['GET','PUT'])
    def research_brief(pid):
        return jsonify(brief=save_brief(store,pid,body()) if request.method=='PUT' else brief(store,pid))

    @api.get('/projects/<pid>/workflow')
    def research_workflow(pid):
        return jsonify(workflow=progress(store,pid))

    @api.route('/components/<ident>',methods=['GET','PUT'])
    def component(ident):
        old=store.component(ident)
        if request.method=='PUT':
            data=body(); old=store.save_component(old['project_id'],old['kind'],data.get('name',old['name']),data['data'],ident,data.get('expected_revision'),data.get('purpose',''))
        return jsonify(component=old,revisions=store.all('SELECT * FROM revisions WHERE component_id=? ORDER BY created_at DESC',(ident,)))

    @api.post('/components/<ident>/restore')
    def restore_component(ident):
        data=body(); old=store.component(ident)
        if not data.get('confirmed'): raise ValueError('回退核心设计需要明确确认')
        rev=store.one('SELECT * FROM revisions WHERE id=? AND component_id=?',(data['revision_id'],ident),True)
        return jsonify(component=store.save_component(old['project_id'],old['kind'],old['name'],rev['data'],ident,old['revision_id'],'Restore revision '+rev['id']))

    @api.get('/components/<ident>/diff')
    def component_diff(ident):
        old=store.one('SELECT * FROM revisions WHERE id=? AND component_id=?',(request.args['before'],ident),True)
        after=store.one('SELECT * FROM revisions WHERE id=? AND component_id=?',(request.args['after'],ident),True)
        return jsonify(before=old,after=after,diff=''.join(difflib.unified_diff(json.dumps(old['data'],ensure_ascii=False,indent=2).splitlines(True),json.dumps(after['data'],ensure_ascii=False,indent=2).splitlines(True),fromfile=old['id'],tofile=after['id'])))

    @api.post('/ideas/<ident>/blueprint')
    def promote(ident): return jsonify(component=store.promote_idea(ident)),201

    @api.post('/components/<ident>/link')
    def link(ident):
        data=body(); source=store.component(ident); target=store.component(data['target_id'],source['project_id'])
        store.execute('INSERT OR IGNORE INTO component_links VALUES(?,?,?)',(ident,target['id'],data.get('relation','related')))
        return jsonify(ok=True)

    @api.get('/projects/<pid>/proposals')
    def proposals(pid): return jsonify(proposals=proposals_service.list(pid))

    @api.post('/projects/<pid>/proposals/apply')
    def apply_proposal(pid):
        data=body()
        return jsonify(component=proposals_service.apply(pid,data['path'],data['sha256']))

    @api.route('/claims/<ident>/evidence',methods=['GET','POST'])
    def evidence(ident):
        if request.method=='POST': store.add_evidence(ident,body())
        return jsonify(evidence=store.all('SELECT * FROM evidence_links WHERE claim_id=?',(ident,)))

    @api.post('/claims/<ident>/verify')
    def verify(ident): return jsonify(claim=store.verify_claim(ident,body().get('note','')))

    @api.get('/venues')
    def venues():
        return jsonify(venues=store.all('SELECT v.*,m.stream FROM venues v LEFT JOIN venue_dblp_mappings m ON m.venue_id=v.id ORDER BY rank,abbreviation'),registry=literature.registry_info)

    @api.get('/papers')
    def papers(): return jsonify(literature.search(request.args))

    @api.post('/papers/online')
    def online(): return jsonify(literature.online(body().get('q','')))

    @api.post('/papers')
    def manual_paper(): return jsonify(id=literature.upsert(body(),'personal')),201

    @api.post('/papers/<ident>/library')
    def save_paper(ident):
        data=body(); store.project(data['project_id'])
        existing=store.one('SELECT * FROM paper_library_entries WHERE paper_id=? AND project_id=?',(ident,data['project_id'])) or {}
        store.execute('INSERT INTO paper_library_entries(id,paper_id,project_id,folder,tags_json,notes,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(paper_id,project_id) DO UPDATE SET folder=excluded.folder,tags_json=excluded.tags_json,notes=excluded.notes,archived=0',
                      (uid(),ident,data['project_id'],data.get('folder',existing.get('folder','')),encode(data.get('tags',existing.get('tags',[]))),data.get('notes',existing.get('notes','')),now()))
        return jsonify(ok=True)

    @api.get('/papers/<ident>/bibtex')
    def bibtex(ident): return Response(literature.bibtex(ident),mimetype='application/x-bibtex',headers={'Content-Disposition':'attachment; filename="reference.bib"'})

    @api.post('/papers/<ident>/pdf')
    def attach_pdf(ident):
        from .local_library import save_pdf
        return jsonify(save_pdf(store,ident,request.files['file'].read()))

    @api.get('/papers/<ident>/pdf')
    def pdf(ident):
        row=store.one('SELECT pdf_path FROM papers WHERE id=?',(ident,),True)
        if not row['pdf_path']: raise ValueError('尚未关联本地 PDF')
        return send_file(inside(store.root,row['pdf_path'],True),mimetype='application/pdf')

    @api.route('/papers/<ident>/annotations',methods=['GET','POST'])
    def annotations(ident):
        if request.method=='POST':
            data=body(); store.project(data['project_id'])
            store.execute('INSERT INTO annotations VALUES(?,?,?,?,?,?,?)',(uid(),ident,data['project_id'],data.get('page'),data.get('quote',''),data.get('note',''),now()))
        return jsonify(annotations=store.all('SELECT * FROM annotations WHERE paper_id=? ORDER BY created_at',(ident,)))

    @api.route('/imports',methods=['GET','POST'])
    def imports():
        if request.method=='GET': return jsonify(jobs=store.all('SELECT * FROM import_jobs ORDER BY created_at DESC'))
        return jsonify(job=literature.start_import(body().get('source_path'))),202

    @api.post('/imports/<ident>/<action>')
    def import_action(ident,action):
        if action=='resume': return jsonify(job=literature.start_import(job_id=ident)),202
        if action=='pause': literature.cancel(ident); return jsonify(ok=True)
        raise ValueError('不支持的导入操作')

    @api.route('/projects/<pid>/experiments',methods=['GET','POST'])
    def runs(pid):
        if request.method=='POST': return jsonify(experiment=experiments.register(pid,body())),201
        return jsonify(experiments=store.all('SELECT * FROM experiments WHERE project_id=? ORDER BY created_at DESC',(pid,)))

    @api.post('/experiments/<ident>/start')
    def run_start(ident): return jsonify(experiment=experiments.start(ident,body().get('authorized') is True)),202

    @api.post('/experiments/<ident>/cancel')
    def run_cancel(ident): return jsonify(experiment=experiments.cancel(ident))

    @api.get('/experiments/<ident>')
    def run_detail(ident):
        run=experiments.get(ident)
        logs=''
        if run['log_path'] and Path(run['log_path']).is_file():
            with Path(run['log_path']).open('rb') as stream:
                stream.seek(max(0,Path(run['log_path']).stat().st_size-100000))
                logs=stream.read().decode('utf8','replace')
        return jsonify(experiment=run,log=logs,artifacts=store.all('SELECT * FROM experiment_artifacts WHERE experiment_id=?',(ident,)))

    @api.post('/experiments/<ident>/metrics')
    def metrics(ident):
        data=body(); return jsonify(affected=experiments.update_metrics(ident,data['metrics'],data.get('reason','')))

    @api.get('/experiments/compare')
    def compare(): return jsonify(experiments.compare(request.args['left'],request.args['right']))

    @api.get('/projects/<pid>/paper/files')
    def tex_files(pid): return jsonify(files=paper.files(pid))

    @api.post('/projects/<pid>/paper/import')
    def tex_import(pid):
        if request.files:
            upload=request.files['file']
            if upload.filename.lower().endswith('.zip'): return jsonify(paper.import_zip(pid,upload.stream)),201
            return jsonify(paper.import_source(pid,upload.filename,upload.read().decode('utf-8-sig'))),201
        data=body(); return jsonify(paper.import_source(pid,data.get('filename','main.tex'),data['source'])),201

    @api.route('/projects/<pid>/paper',methods=['GET','PUT'])
    def tex(pid):
        if request.method=='GET': return jsonify(paper.read(pid,request.args['path']))
        data=body(); return jsonify(paper.save(pid,data['path'],data['source'],data.get('expected_hash')))

    @api.post('/projects/<pid>/paper/anchors')
    def anchors(pid):
        data=body(); old=paper.read(pid,data['path'])
        return jsonify(paper.save(pid,data['path'],anchor_source(old['source']),old['sha256']))

    @api.post('/projects/<pid>/paper/compile')
    def compile_paper(pid): return jsonify(paper.compile(pid,body()['path']))

    @api.get('/projects/<pid>/file')
    def file(pid):
        project=store.project(pid); path=inside(project['root_path'],request.args['path'],True)
        if path.suffix.lower() not in {'.pdf','.png','.jpg','.jpeg','.svg','.tex','.bib','.md','.json','.log','.txt','.py'}: raise ValueError('不支持预览该文件类型')
        response=send_file(path,mimetype='text/plain' if path.suffix.lower()=='.py' else None)
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Content-Security-Policy']="sandbox; default-src 'none'; style-src 'unsafe-inline'"
        return response

    @api.route('/paragraphs/<ident>',methods=['PUT'])
    def paragraph(ident):
        data=body(); comp=store.component(ident)
        return jsonify(paper.edit_paragraph(comp['project_id'],ident,data['content'],data['expected_hash']))

    @api.route('/paragraphs/<ident>/outline',methods=['GET','PUT'])
    def outline(ident):
        comp=store.component(ident)
        if request.method=='GET': return jsonify(outline=store.one('SELECT * FROM paragraph_outlines WHERE paragraph_id=?',(ident,),True))
        return jsonify(outline=paper.outline(comp['project_id'],ident,body()))

    @api.get('/paragraphs/<ident>/outline/history')
    def outline_history(ident):
        store.component(ident)
        return jsonify(versions=store.all('SELECT * FROM outline_versions WHERE paragraph_id=? ORDER BY created_at DESC',(ident,)))

    @api.post('/projects/<pid>/paper/evolve')
    def evolve(pid):
        data=body(); return jsonify(paper.evolve(pid,data['path'],data['parent_ids'],data['contents'],data['operation'],data['expected_hash']))

    @api.get('/projects/<pid>/paper/versions')
    def versions(pid): return jsonify(versions=store.all('SELECT id,path,sha256,created_at FROM paper_versions WHERE project_id=? AND path=? ORDER BY created_at DESC',(pid,request.args['path'])))

    @api.get('/projects/<pid>/paper/diff')
    def paper_diff(pid): return jsonify(diff=paper.diff(pid,request.args['version_id'],request.args['path']))

    @api.post('/projects/<pid>/paper/restore')
    def paper_restore(pid):
        data=body()
        if not data.get('confirmed'): raise ValueError('回退论文需要确认')
        version=store.one('SELECT * FROM paper_versions WHERE id=? AND project_id=?',(data['version_id'],pid),True)
        return jsonify(paper.save(pid,version['path'],version['source_text'],data['expected_hash'],initial=True))

    @api.get('/codex/status')
    def codex_status(): return jsonify(codex.probe())

    @api.get('/projects/<pid>/skills')
    def skills(pid): return jsonify(codex.skills(pid))

    @api.route('/projects/<pid>/sessions',methods=['GET','POST'])
    def sessions(pid):
        if request.method=='GET': return jsonify(sessions=store.all('SELECT * FROM agent_sessions WHERE project_id=? ORDER BY created_at DESC',(pid,)))
        data=body(); return jsonify(session=codex.create_session(pid,data.get('stage','Literature'),context=data.get('context',{}))),201

    @api.get('/sessions/<ident>')
    def session(ident):
        if request.args.get('tail')=='1':
            # One SQLite snapshot: keep conclusions plus recent diagnostics, and
            # start the live stream after the newest returned event. Large tool
            # logs must not delay the current answer on every page reload.
            messages=store.all('''SELECT * FROM (
                SELECT * FROM (SELECT * FROM agent_messages WHERE session_id=? AND
                    (event IN ('user/message','user/steer','review/conclusion','review/error','adapter/error','session/identity')
                     OR (event='item/completed' AND json_extract(payload_json,'$.item.type')='agentMessage'))
                    ORDER BY id DESC LIMIT 200)
                UNION SELECT * FROM (SELECT * FROM agent_messages WHERE session_id=? ORDER BY id DESC LIMIT 200)
                ) ORDER BY id''',(ident,ident))
        else:
            messages=store.all('SELECT * FROM agent_messages WHERE session_id=? AND id>? ORDER BY id LIMIT 1000',(ident,int(request.args.get('after',0))))
        return jsonify(session=codex.session(ident),messages=messages,
                       approvals=[{'request_id':key,'method':v['method'],'params':v['params']} for key,v in codex.approvals.items() if v['session_id']==ident])

    @api.get('/sessions/<ident>/events')
    def events(ident):
        codex.session(ident)
        start=int(request.args.get('after',request.headers.get('Last-Event-ID',0)))
        @stream_with_context
        def generate():
            cursor=start; deadline=time.monotonic()+25
            while time.monotonic()<deadline:
                rows=store.all('SELECT * FROM agent_messages WHERE session_id=? AND id>? ORDER BY id LIMIT 200',(ident,cursor))
                for row in rows:
                    cursor=row['id']; yield f'id: {cursor}\nevent: research\ndata: {encode(row)}\n\n'
                if not rows: yield ': heartbeat\n\n'
                time.sleep(0.4)
        return Response(generate(),mimetype='text/event-stream',headers={'Cache-Control':'no-cache','X-Accel-Buffering':'no'})

    @api.post('/sessions/<ident>/<action>')
    def session_action(ident,action):
        data=body()
        if action=='turn': return jsonify(codex.turn(ident,data.get('text',''),data.get('selected',[]),data.get('skills',[]))),202
        if action=='steer': return jsonify(codex.steer(ident,data.get('text','')))
        if action=='interrupt': return jsonify(codex.interrupt(ident))
        if action=='resume': codex.resume(ident); return jsonify(session=codex.session(ident))
        if action=='approve': codex.approve(ident,data['request_id'],data['response']); return jsonify(ok=True)
        raise ValueError('不支持的会话操作')

    @api.route('/projects/<pid>/reviews',methods=['GET','POST'])
    def review_list(pid):
        if request.method=='POST': return jsonify(review=reviews.start(pid,body())),202
        return jsonify(reviews=store.all('SELECT * FROM reviews WHERE project_id=? ORDER BY created_at DESC',(pid,)),roles=ROLES)

    @api.get('/reviews/<ident>')
    def review(ident): return jsonify(review=reviews.get(ident))

    @api.post('/reviews/<ident>/stop')
    def review_stop(ident): return jsonify(review=reviews.stop(ident))

    @api.post('/issues/<ident>/task')
    def issue_task(ident):
        data=body(); issue=store.one('SELECT i.*,r.project_id FROM review_issues i JOIN reviews r ON r.id=i.review_id WHERE i.id=?',(ident,),True)
        return jsonify(component=store.save_component(issue['project_id'],'task',issue['problem'][:100],{'issue_id':ident,'type':data.get('type','writing'),'suggested_fix':issue['suggested_fix'],'verification':issue['verification'],'component_id':issue['component_id'],'experiment_id':issue['experiment_id']})),201

    @api.patch('/issues/<ident>')
    def issue_update(ident):
        data=body()
        if data.get('status') not in {'open','rejected','in_progress','resolved','needs_review'}: raise ValueError('无效的问题状态')
        if data['status'] in {'resolved','rejected'} and not data.get('note','').strip(): raise ValueError('请填写验证结果或拒绝理由')
        store.execute('UPDATE review_issues SET status=?,verification=verification || ? WHERE id=?',(data['status'],'\nUser: '+data.get('note',''),ident))
        return jsonify(ok=True)

    @api.get('/projects/<pid>/git')
    def git_status(pid):
        git=GitService(store.project(pid)['root_path']); return jsonify(**git.status(),diff=git.diff())

    @api.post('/projects/<pid>/git/<action>')
    def git_action(pid,action):
        data=body(); git=GitService(store.project(pid)['root_path'])
        if action=='checkpoint': return jsonify(commit=versions_service.checkpoint(pid,data.get('message','')))
        if action=='branch': return jsonify(git.branch(data['name'],data.get('ref','HEAD'),data.get('switch',False)))
        if action=='switch': return jsonify(versions_service.switch(pid,data['name']))
        if action=='restore':
            if not data.get('confirmed'): raise ValueError('恢复文件需要确认；当前文件会备份')
            return jsonify(git.restore_file(data['path'],data['ref']))
        raise ValueError('不支持的 Git 操作')

    @api.route('/projects/<pid>/submissions',methods=['GET','POST'])
    def submissions(pid):
        if request.method=='GET': return jsonify(submissions=store.all('SELECT * FROM submission_attempts WHERE project_id=? ORDER BY submitted_at DESC',(pid,)))
        data=body(); project=store.project(pid); git=GitService(project['root_path'])
        if data.get('parent_id'):
            store.one('SELECT id FROM submission_attempts WHERE id=? AND project_id=?',(data['parent_id'],pid),True)
        if data.get('venue_profile_id'):
            profile=store.component(data['venue_profile_id'],pid)
            if profile['kind']!='venue_profile': raise ValueError('请选择 Venue Profile')
        versions_service.export_state(pid)
        if git.status()['changes']: raise ValueError('提交快照要求 Git 工作目录和暂存区干净；请先保存 checkpoint')
        commit=git.resolve('HEAD'); ident=uid(); branch=data['branch']
        # Archive committed text sources; include explicit PDF and experiment evidence separately.
        archive=git.run('archive','--format=zip',commit,binary=True)
        snapshot=store.root/'snapshots'/(ident+'.zip'); snapshot.parent.mkdir(exist_ok=True)
        manifest={'commit':commit,'venue':data.get('venue',''),'experiments':[],'components':store.all("SELECT * FROM components WHERE project_id=? AND status!='absent_in_branch'",(pid,)),
                  'outlines':store.all("SELECT o.* FROM paragraph_outlines o JOIN components c ON c.id=o.paragraph_id WHERE c.project_id=? AND c.status!='absent_in_branch'",(pid,))}
        for eid in data.get('experiment_ids',[]):
            exp=experiments.get(eid)
            if exp['project_id']!=pid: raise ValueError('实验不属于此项目')
            manifest['experiments'].append(exp)
        pdf_path=inside(project['root_path'],data['pdf_path'],True) if data.get('pdf_path') else None
        if pdf_path and pdf_path.suffix.lower()!='.pdf': raise ValueError('提交 PDF 路径无效')
        kind='submitted' if data.get('submitted') is True else 'prepared'
        if kind=='submitted' and not pdf_path: raise ValueError('记录实际投稿必须提供当时提交的 PDF；可先创建准备快照')
        manifest['snapshot_kind']=kind
        manifest['pdf_hash']=file_hash(pdf_path) if pdf_path else None
        snapshot.write_bytes(archive)
        created_branch=False
        try:
            with zipfile.ZipFile(snapshot,'a',compression=zipfile.ZIP_DEFLATED) as z:
                z.writestr('easyref-manifest.json',encode(manifest))
                if pdf_path: z.write(pdf_path,'submission.pdf')
            git.branch(branch,commit)
            created_branch=True
            store.execute('INSERT INTO submission_attempts(id,project_id,parent_id,venue_profile_id,venue,branch,git_commit,snapshot_path,sha256,manifest_json,submitted_at,snapshot_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(ident,pid,data.get('parent_id'),data.get('venue_profile_id'),data.get('venue',''),branch,commit,str(snapshot),file_hash(snapshot),encode(manifest),now(),kind))
        except Exception:
            snapshot.unlink(missing_ok=True)
            if created_branch: git.run('update-ref','-d','refs/heads/'+branch,commit)
            raise
        return jsonify(submission=store.one('SELECT * FROM submission_attempts WHERE id=?',(ident,))),201

    @api.get('/submissions/<ident>/snapshot')
    def submission_download(ident):
        row=store.one('SELECT * FROM submission_attempts WHERE id=?',(ident,),True)
        path=inside(store.root,row['snapshot_path'],True)
        if file_hash(path)!=row['sha256']: raise ValueError('快照哈希不一致，请检查备份')
        return send_file(path,as_attachment=True,download_name='EasyRef-submission-'+ident[:8]+'.zip')

    @api.post('/submissions/<ident>/events')
    def submission_event(ident):
        data=body(); store.execute('INSERT INTO submission_events VALUES(?,?,?,?,?)',(uid(),ident,data.get('kind','review_result'),encode(data.get('data',{})),now()))
        return jsonify(events=store.all('SELECT * FROM submission_events WHERE submission_id=?',(ident,)))

    @api.post('/backup')
    def backup():
        path=store.backup(); return send_file(path,as_attachment=True,download_name='EasyRef-backup.sqlite3')

    @api.get('/projects/<pid>/export')
    def export(pid):
        from .research_schema.bridge import ResearchSchemaService
        from .research_schema.exchange import export_project
        ResearchSchemaService(store).checkpoint(pid,'project.export.checkpoint')
        target=store.root/'exports'/(uid()+'.zip')
        export_project(store.project(pid)['root_path'],target)
        return send_file(target,as_attachment=True,download_name='EasyRef-project.zip')

    app.register_blueprint(api,url_prefix='/api')
    from .local_library import register_library_api
    register_library_api(app,store,literature,codex)
    from .research_schema.api import register_schema_api
    register_schema_api(app,store,codex)
    dist=Path(__file__).resolve().parents[2]/'frontend'/'dist'
    @app.get('/')
    @app.get('/<path:path>')
    def frontend(path='index.html'):
        if path.startswith('api/'): return jsonify(error='API endpoint not found'),404
        if not dist.exists(): return jsonify(name='EasyRef',message='前端尚未构建。运行 npm --prefix frontend run build，或启动 Vite 开发服务。')
        file=dist/path
        return send_from_directory(dist,path if file.is_file() else 'index.html')
    return app
