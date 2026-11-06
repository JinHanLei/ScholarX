import json
import math
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import threading
from pathlib import Path
from .local_git import GitService
from .local_store import encode, file_hash, inside, now, uid


class Experiments:
    def __init__(self, store):
        self.store = store
        self.processes = {}
        self.cancelled = set()
        self.lock = threading.RLock()
        store.execute("UPDATE experiments SET status='interrupted',error='EasyRef 重启，执行已中断；请从此记录派生重试' WHERE status IN ('running','queued')")

    def close(self):
        for ident in list(self.processes):
            try: self.cancel(ident)
            except (OSError,subprocess.SubprocessError): pass

    def get(self, ident):
        return self.store.one('SELECT * FROM experiments WHERE id=?', (ident,), True)

    def register(self, project_id, data):
        project = self.store.project(project_id)
        root = Path(project['root_path'])
        config = data.get('config', {})
        for key in ['dataset','split','seed','hyperparameters','evaluation_protocol']:
            if key not in config: raise ValueError('实验配置缺少 ' + key)
        if not isinstance(config['hyperparameters'],dict): raise ValueError('Hyperparameters 必须是 JSON 对象')
        args = data.get('command', [])
        if not isinstance(args,list) or not args or not all(isinstance(x,str) and x and '\x00' not in x for x in args):
            raise ValueError('命令必须是非空 argv 字符串数组')
        # Launch a project script via a fixed interpreter, never -c/eval/shell syntax.
        executable = args[0].lower()
        if executable not in {'python','python3','node','rscript'} or len(args)<2 or args[1].startswith('-'):
            raise ValueError('支持 python/node/Rscript 项目脚本；不接受 Shell 或 -c/-e 字符串')
        script = inside(root,args[1],True)
        expected = {'python':'.py','python3':'.py','node':'.js','rscript':'.r'}[executable]
        if script.suffix.lower() != expected: raise ValueError('脚本扩展名与解释器不匹配')
        cwd = root if data.get('cwd','.') == '.' else inside(root,data['cwd'])
        if not cwd.is_dir(): raise ValueError('工作目录不存在')
        # Paths are resolved from root consistently even when cwd differs.
        args[1] = str(script)
        metrics_path = str(inside(root,data.get('metrics_path','metrics.json')))
        parent = data.get('parent_id') or None
        if parent and self.get(parent)['project_id'] != project_id: raise ValueError('Baseline 不属于当前项目')
        revision = data.get('blueprint_revision') or None
        if revision:
            rev = self.store.one('SELECT c.kind,c.project_id FROM revisions r JOIN components c ON c.id=r.component_id WHERE r.id=?',(revision,),True)
            if rev['kind']!='blueprint' or rev['project_id']!=project_id: raise ValueError('Blueprint 修订不属于当前项目')
        git = GitService(root)
        state = git.status()
        ident, stamp = uid(), now()
        interpreter = sys.executable if executable in {'python','python3'} else shutil.which(args[0])
        if executable in {'python','python3'} and project['settings'].get('python_executable'):
            configured = Path(project['settings']['python_executable'])
            if not configured.is_absolute() or not configured.is_file() or not re.fullmatch(r'python(?:3(?:\.\d+)?)?(?:\.exe)?',configured.name,re.I):
                raise ValueError('Python 解释器必须是已存在的 python 可执行文件绝对路径')
            interpreter = str(configured.resolve())
        if not interpreter: raise ValueError('未找到实验解释器')
        probe = subprocess.run([interpreter,'--version'],capture_output=True,text=True,timeout=15,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        if probe.returncode: raise ValueError('实验解释器无法启动')
        runtime_version = (probe.stdout+probe.stderr).strip()
        self.store.execute('''INSERT INTO experiments(id,project_id,name,parent_id,blueprint_revision,git_commit,git_diff,config_json,command_json,cwd,purpose,status,environment_json,metrics_path,created_at)
                              VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
                           (ident,project_id,data.get('name') or 'Experiment',parent,revision,state['commit'],git.diff(),encode(config),encode(args),str(cwd),data.get('purpose',''),'registered',
                            encode({'platform':platform.platform(),'runtime_version':runtime_version,'interpreter':interpreter,
                                    'interpreter_sha256':file_hash(interpreter),'test_data':bool(data.get('test_data')),'git_changes':state['changes'],'script_sha256':file_hash(script)}),metrics_path,stamp))
        return self.get(ident)

    def start(self, ident, authorized=False):
        if not authorized: raise ValueError('请确认执行界面显示的脚本、参数和工作目录')
        with self.lock:
            run = self.get(ident)
            if run['status'] != 'registered': raise ValueError('该 Run 已执行；请派生新 Run 保留历史')
            project=self.store.project(run['project_id'])
            script=inside(project['root_path'],run['command'][1],True)
            if run['environment'].get('script_sha256')!=file_hash(script):
                raise ValueError('登记后实验脚本已改变，请重新登记并核对命令')
            git=GitService(project['root_path']); state=git.status()
            environment={**run['environment'],'git_changes':state['changes'],'captured_at':now()}
            self.store.execute("UPDATE experiments SET status='queued',started_at=?,git_commit=?,git_diff=?,environment_json=? WHERE id=?",(now(),state['commit'],git.diff(),encode(environment),ident))
            thread = threading.Thread(target=self._run,args=(ident,),daemon=True)
            thread.start()
        return self.get(ident)

    def _run(self, ident):
        run = self.get(ident)
        project = self.store.project(run['project_id'])
        logs = Path(project['root_path']) / '.easyref' / 'runs' / ident
        logs.mkdir(parents=True,exist_ok=True)
        log_path = logs / 'output.log'
        self.store.execute('UPDATE experiments SET log_path=? WHERE id=?',(str(log_path),ident))
        process = None
        try:
            args = run['command'][:]
            executable = args[0].lower()
            args[0] = run['environment'].get('interpreter') or (sys.executable if executable in {'python','python3'} else shutil.which(args[0]))
            if not args[0]: raise ValueError('未安装实验所需解释器')
            expected_interpreter = run['environment'].get('interpreter_sha256')
            if expected_interpreter and file_hash(args[0]) != expected_interpreter: raise ValueError('登记后解释器已改变，请重新登记')
            root = Path(project['root_path'])
            script=inside(root,args[1],True)
            if file_hash(script)!=run['environment'].get('script_sha256'): raise ValueError('启动前脚本已改变，本次运行已拒绝')
            script_copy=logs/('entrypoint'+script.suffix)
            shutil.copy2(script,script_copy)
            self.store.execute('INSERT INTO experiment_artifacts VALUES(?,?,?,?,?)',(uid(),ident,str(script_copy),file_hash(script_copy),'entrypoint'))
            metric = inside(root,run['metrics_path'])
            previous_hash = file_hash(metric) if metric.exists() else None
            previous_time = metric.stat().st_mtime_ns if metric.exists() else None
            config_path = logs / 'config.json'
            config_path.write_text(encode(run['config']),encoding='utf-8')
            env = dict(os.environ, EASYREF_RUN_ID=ident,EASYREF_CONFIG=str(config_path),EASYREF_METRICS_PATH=str(metric),PYTHONUNBUFFERED='1')
            with log_path.open('w',encoding='utf-8') as log:
                with self.lock:
                    if ident in self.cancelled: raise InterruptedError('实验已取消')
                    process = subprocess.Popen(args,cwd=run['cwd'],stdout=log,stderr=subprocess.STDOUT,env=env,
                                               start_new_session=os.name!='nt',creationflags=(getattr(subprocess,'CREATE_NO_WINDOW',0)|getattr(subprocess,'CREATE_NEW_PROCESS_GROUP',0)))
                    self.processes[ident] = process
                    self.store.execute("UPDATE experiments SET status='running' WHERE id=?",(ident,))
                code = process.wait()
            if ident in self.cancelled: raise InterruptedError('实验已取消')
            if code: raise ValueError('实验进程退出码 ' + str(code))
            metrics = {}
            if metric.exists() and (previous_time != metric.stat().st_mtime_ns or previous_hash != file_hash(metric)):
                metrics = json.loads(metric.read_text('utf-8-sig'))
                self.validate_metrics(metrics)
                immutable = logs / 'metrics.json'
                shutil.copy2(metric,immutable)
                self.store.execute('INSERT INTO experiment_artifacts VALUES(?,?,?,?,?)',(uid(),ident,str(immutable),file_hash(immutable),'metrics'))
            self.store.execute("UPDATE experiments SET status='completed',metrics_json=?,error=?,finished_at=? WHERE id=?",(encode(metrics),None if metrics else '执行成功，但没有生成新的指标文件',now(),ident))
        except Exception as exc:
            self.store.execute('UPDATE experiments SET status=?,error=?,finished_at=? WHERE id=?',('cancelled' if isinstance(exc,InterruptedError) else 'failed',str(exc),now(),ident))
        finally:
            if log_path.exists():
                self.store.execute('INSERT OR IGNORE INTO experiment_artifacts VALUES(?,?,?,?,?)',(uid(),ident,str(log_path),file_hash(log_path),'log'))
            with self.lock: self.processes.pop(ident,None)
            try:
                from .research_schema.bridge import ResearchSchemaService
                ResearchSchemaService(self.store).checkpoint(self.get(ident)['project_id'],'experiment.finished')
            except Exception as checkpoint_error:
                self.store.execute('UPDATE experiments SET error=COALESCE(error,\'\') || ? WHERE id=?',(' Portable checkpoint failed: '+str(checkpoint_error),ident))

    @staticmethod
    def validate_metrics(metrics):
        if not isinstance(metrics,dict) or not metrics or any(not isinstance(v,(int,float)) or isinstance(v,bool) or not math.isfinite(v) for v in metrics.values()):
            raise ValueError('指标文件必须是包含有限数值的 JSON 对象')

    def update_metrics(self, ident, metrics, reason):
        self.validate_metrics(metrics)
        run = self.get(ident)
        if run['status']!='completed' or not reason.strip(): raise ValueError('仅可校正已完成实验，且必须记录理由')
        project = self.store.project(run['project_id'])
        audit = Path(project['root_path']) / '.easyref' / 'runs' / ident / ('correction-' + uid() + '.json')
        audit.parent.mkdir(parents=True,exist_ok=True)
        audit.write_text(encode({'before':run['metrics'],'after':metrics,'reason':reason,'at':now()}),encoding='utf-8')
        with self.store.transaction() as conn:
            conn.execute('INSERT INTO experiment_artifacts VALUES(?,?,?,?,?)',(uid(),ident,str(audit),file_hash(audit),'metric_correction'))
            conn.execute('UPDATE experiments SET metrics_json=? WHERE id=?',(encode(metrics),ident))
            affected = self.store.invalidate_experiment(ident,conn)
        return affected

    def cancel(self, ident):
        with self.lock:
            self.cancelled.add(ident)
            process = self.processes.get(ident)
            if process and process.poll() is None:
                if os.name == 'nt': subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True,timeout=15)
                else: os.killpg(process.pid,signal.SIGTERM)
        return self.get(ident)

    def compare(self, left, right):
        a,b = self.get(left),self.get(right)
        if a['project_id']!=b['project_id']: raise ValueError('只能比较同一项目的实验')
        warnings = []
        for field in ['dataset','split','evaluation_protocol']:
            if a['config'].get(field)!=b['config'].get(field): warnings.append(field + ' 发生变化，不能将指标差异归因于模型改进')
        if a['config'].get('seed')!=b['config'].get('seed'): warnings.append('随机种子不同；单次结果不能证明改进')
        if not a['metrics'] or not b['metrics']: warnings.append('至少一个实验缺少真实指标')
        if a['environment'].get('git_changes') or b['environment'].get('git_changes'): warnings.append('实验包含未提交改动；同时检查每个 Run 保存的原始 Diff')
        changes = {k:{'before':a['config'].get(k),'after':b['config'].get(k)} for k in a['config'].keys()|b['config'].keys() if a['config'].get(k)!=b['config'].get(k)}
        metrics = {k:{'before':a['metrics'].get(k),'after':b['metrics'].get(k),'delta':b['metrics'][k]-a['metrics'][k] if k in a['metrics'] and k in b['metrics'] else None} for k in a['metrics'].keys()|b['metrics'].keys()}
        project = self.store.project(a['project_id'])
        raw = GitService(project['root_path']).diff(a['git_commit'],b['git_commit']) if a['git_commit'] and b['git_commit'] else ''
        revisions = [self.store.one('SELECT * FROM revisions WHERE id=?',(r,)) if r else None for r in [a['blueprint_revision'],b['blueprint_revision']]]
        return {'left':a,'right':b,'config_diff':changes,'metrics':metrics,'warnings':warnings,'comparable':not warnings,'git_diff':raw,
                'blueprints':revisions,'claims':self.store.all('SELECT DISTINCT c.* FROM components c JOIN evidence_links e ON e.claim_id=c.id WHERE e.experiment_id IN (?,?)',(left,right)),
                'recommendation':'需要用户结合评估协议、多种子统计和修改目的判断是否保留；系统不自动归因'}
