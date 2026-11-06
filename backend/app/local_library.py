"""Collection actions, local attachments, and bounded Codex literature helpers."""
import ipaddress
import json
import os
import socket
import subprocess
import sys
import threading
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from flask import Blueprint, jsonify, request
from .local_store import atomic_write, digest, encode, now

MAX_PDF = 100 * 1024 * 1024


def save_pdf(store, ident, data):
    store.one('SELECT id FROM papers WHERE id=?',(ident,),True)
    if len(data)>MAX_PDF: raise ValueError('PDF 不能超过 100 MB')
    if not data.startswith(b'%PDF-'): raise ValueError('内容不是 PDF，请提供 PDF 直链或上传文件')
    checksum=digest(data)
    path=store.root/'pdfs'/(checksum+'.pdf'); path.parent.mkdir(exist_ok=True)
    if not path.exists():
        temporary=path.with_suffix('.'+os.urandom(8).hex()+'.tmp')
        try: temporary.write_bytes(data); os.replace(temporary,path)
        finally: temporary.unlink(missing_ok=True)
    store.execute('UPDATE papers SET pdf_path=?,pdf_hash=? WHERE id=?',(str(path),checksum,ident))
    return {'path':'/api/papers/'+ident+'/pdf','pdf_path':str(path),'sha256':checksum}


def download_pdf(url):
    for _ in range(6):
        parsed=urlparse(url)
        if parsed.scheme not in {'http','https'} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError('请输入公开的 HTTP(S) PDF 直链')
        addresses=socket.getaddrinfo(parsed.hostname,parsed.port or (443 if parsed.scheme=='https' else 80),type=socket.SOCK_STREAM)
        if not addresses or any(not ipaddress.ip_address(item[4][0]).is_global for item in addresses):
            raise ValueError('PDF 链接不能指向本机或内网地址；本地文件请上传')
        with requests.get(url,stream=True,timeout=(10,45),allow_redirects=False,headers={'User-Agent':'EasyRef/1.0'}) as response:
            if response.is_redirect:
                url=urljoin(url,response.headers['Location']); continue
            response.raise_for_status()
            if int(response.headers.get('Content-Length',0))>MAX_PDF: raise ValueError('PDF 不能超过 100 MB')
            data=bytearray()
            for chunk in response.iter_content(65536):
                data.extend(chunk)
                if len(data)>MAX_PDF: raise ValueError('PDF 不能超过 100 MB')
                if len(data)>=5 and not data.startswith(b'%PDF-'): raise ValueError('链接返回了网页，请使用 PDF 直链或上传文件')
            return bytes(data)
    raise ValueError('PDF 链接重定向次数过多')


class DblpUpdate:
    def __init__(self,store,literature):
        self.store=store; self.literature=literature; self.lock=threading.Lock(); self.worker=None
        self.path=store.root/'dblp-update.json'
        self.state=json.loads(self.path.read_text('utf8')) if self.path.exists() else {'status':'idle'}
        if self.state.get('status') in {'downloading','importing'}: self.set(status='interrupted')

    def set(self,**values):
        self.state.update(values,updated_at=now()); atomic_write(self.path,encode(self.state))

    def status(self):
        value=dict(self.state)
        if value.get('job_id'):
            job=self.store.one('SELECT * FROM import_jobs WHERE id=?',(value['job_id'],))
            value['job']=job
            if job: value['status']='importing' if job['status'] in {'running','pending'} else job['status']
        return value

    def start(self):
        with self.lock:
            if self.worker and self.worker.is_alive(): return self.status()
            if self.store.one("SELECT id FROM import_jobs WHERE status IN ('running','pending')"):
                raise ValueError('已有 DBLP 导入正在运行，请等待完成或暂停后再更新')
            self.state={'status':'downloading','started_at':now()}; self.set()
            self.worker=threading.Thread(target=self.run,daemon=True); self.worker.start()
            return self.status()

    def run(self):
        root=Path(__file__).resolve().parents[2]
        log_path=self.store.root/'dblp-update.log'
        try:
            with log_path.open('w',encoding='utf8') as log:
                result=subprocess.run([sys.executable,'-u',str(root/'backend/scripts/download_dblp.py')],cwd=root,stdout=log,stderr=subprocess.STDOUT,
                                      env={**os.environ,'PYTHONIOENCODING':'utf-8'},creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
            if result.returncode not in {0,2}: raise ValueError('DBLP 下载失败，请查看更新日志后重试')
            source=root/'dblp/dblp.xml'
            previous=self.store.one("SELECT * FROM import_jobs WHERE source_path=? AND status='completed' ORDER BY updated_at DESC LIMIT 1",(str(source),))
            if result.returncode==2 and previous and previous['fingerprint']==self.literature.fingerprint(source):
                self.set(status='completed',message='DBLP 官方快照未变化，本地索引已是最新'); return
            job=self.literature.start_import(str(source))
            self.set(status='importing',job_id=job['id'],message='快照已就绪，正在更新本地文献索引')
        except Exception as exc: self.set(status='failed',error=str(exc))


def register_library_api(app,store,literature,codex):
    api=Blueprint('library',__name__)
    updater=DblpUpdate(store,literature)
    app.extensions['easyref']['dblp_update']=updater

    @api.route('/dblp/update',methods=['GET','POST'])
    def update():
        return jsonify(update=updater.start() if request.method=='POST' else updater.status())

    @api.get('/dblp/update/log')
    def update_log():
        path=store.root/'dblp-update.log'
        if not path.exists(): return jsonify(log='')
        with path.open('rb') as stream:
            stream.seek(max(0,path.stat().st_size-12000)); text=stream.read().decode('utf8',errors='replace')
        return jsonify(log=text)

    @api.patch('/projects/<pid>/library/<ident>')
    def library_entry(pid,ident):
        store.project(pid); data=request.get_json()
        entry=store.one('SELECT * FROM paper_library_entries WHERE project_id=? AND paper_id=?',(pid,ident),True)
        for key in ('pinned','archived'):
            if key in data and not isinstance(data[key],bool): raise ValueError('置顶与归档状态必须为布尔值')
        store.execute('UPDATE paper_library_entries SET pinned=?,archived=? WHERE id=?',
                      (int(data.get('pinned',entry['pinned'])),int(data.get('archived',entry['archived'])),entry['id']))
        return jsonify(ok=True)

    @api.post('/papers/<ident>/pdf-link')
    def pdf_link(ident):
        store.one('SELECT id FROM papers WHERE id=?',(ident,),True)
        url=request.get_json().get('url','').strip()
        return jsonify(save_pdf(store,ident,download_pdf(url)))

    from .literature_assist import register_assist
    register_assist(api,store,literature,codex)
    from .literature_translation import register_translation
    register_translation(api,store)

    app.register_blueprint(api,url_prefix='/api')
