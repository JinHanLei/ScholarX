import difflib
import json
import re
import shutil
import subprocess
import threading
import zipfile
from pathlib import Path
from .local_store import atomic_write, digest, encode, inside, now, uid

ANCHOR = re.compile(r'^% easyref:paragraph:([a-zA-Z0-9-]+)\s*$',re.M)


def sections(source):
    return [{'level':m[1],'title':m[2],'offset':m.start()} for m in re.finditer(r'\\(section|subsection|subsubsection)\*?\{([^}]+)\}',source)]


def anchor_source(source):
    """Initial source import only. Thereafter identity comes exclusively from comments."""
    if ANCHOR.search(source): return source
    begin = re.search(r'\\begin\{document\}',source)
    end = re.search(r'\\end\{document\}',source)
    start = begin.end() if begin else 0
    stop = end.start() if end else len(source)
    body = source[start:stop]
    # Avoid splitting inside environments, including math, figures and verbatim.
    blocks, current, depth = [], [], 0
    for line in body.splitlines(keepends=True):
        if not line.strip() and depth == 0 and current and ''.join(current).strip():
            blocks.append(''.join(current)); current=[]
        current.append(line)
        clean = line.split('%',1)[0]
        depth += len(re.findall(r'\\begin\{',clean))-len(re.findall(r'\\end\{',clean))
        depth = max(0,depth)
    if current: blocks.append(''.join(current))
    anchored = ''.join('\n% easyref:paragraph:'+uid()+'\n'+block.strip('\n')+'\n' if block.strip() else block for block in blocks)
    return source[:start]+anchored+source[stop:]


def parse_paragraphs(source):
    marks = list(ANCHOR.finditer(source))
    toc = sections(source)
    output, seen = [], set()
    for index, mark in enumerate(marks):
        ident = mark[1]
        if ident in seen: raise ValueError('Paragraph ID 重复，请使用拆分/复制操作生成新 ID')
        seen.add(ident)
        stop = marks[index+1].start() if index+1<len(marks) else len(source)
        closing = source.find('\\end{document}',mark.end(),stop)
        if closing>=0: stop=closing
        content = source[mark.end():stop].strip('\r\n')
        section = next((s['title'] for s in reversed(toc) if s['offset']<stop),'')
        output.append({'id':ident,'content':content,'start':mark.end(),'end':stop,'section':section,'line':source.count('\n',0,mark.start())+1})
    return output


class PaperService:
    def __init__(self, store):
        self.store=store
        self.lock=threading.RLock()

    def target(self, project_id, path):
        project=self.store.project(project_id)
        if Path(path).suffix.lower()!='.tex': raise ValueError('请选择 .tex 文件')
        return inside(project['root_path'],path),project

    def files(self, project_id):
        project=self.store.project(project_id); root=Path(project['root_path'])
        # Managed projects themselves live under .easyref/projects; only exclude
        # private directories *inside* the selected project, not its ancestors.
        files=[]
        for p in root.rglob('*.tex'):
            relative=p.relative_to(root)
            if any(part in {'.git','.easyref','.venv','node_modules'} for part in relative.parts): continue
            if p.is_symlink() or not p.resolve().is_relative_to(root.resolve()): continue
            files.append(relative.as_posix())
            if len(files)>=500: break
        return sorted(files)

    def import_source(self, project_id, filename, content):
        path='paper/'+Path(filename).name
        target,_=self.target(project_id,path)
        if target.exists(): raise ValueError('同名论文已存在，请重命名文件后导入')
        source=anchor_source(content)
        return self.save(project_id,path,source,None,initial=True)

    def import_zip(self,project_id,uploaded):
        project=self.store.project(project_id)
        folder=Path(project['root_path'])/'paper'/('import-'+uid()[:8])
        with zipfile.ZipFile(uploaded) as archive:
            if sum(x.file_size for x in archive.infolist())>100_000_000 or len(archive.infolist())>2000: raise ValueError('LaTeX 工程过大')
            validated=[]
            for item in archive.infolist():
                if item.is_dir(): continue
                if (item.external_attr>>16)&0o170000 == 0o120000: raise ValueError('不接受压缩包中的符号链接')
                target=inside(folder,item.filename)
                if target.suffix.lower() not in {'.tex','.bib','.sty','.cls','.bst','.png','.jpg','.jpeg','.pdf','.eps','.svg','.txt','.md'}:
                    continue
                validated.append((item,target))
            for item,target in validated:
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(archive.read(item))
        return {'files':self.files(project_id),'import_directory':str(folder.relative_to(Path(project['root_path'])))}

    def read(self,project_id,path):
        target,_=self.target(project_id,path)
        if not target.exists(): raise ValueError('LaTeX 文件不存在')
        source=target.read_text('utf-8-sig')
        if not ANCHOR.search(source):
            return {'path':path,'source':source,'sha256':digest(source),'paragraphs':[],'sections':sections(source),'needs_anchor_import':True}
        self.sync(project_id,path,source)
        paragraphs=parse_paragraphs(source)
        for p in paragraphs:
            p['outline']=self.store.one('SELECT * FROM paragraph_outlines WHERE paragraph_id=?',(p['id'],))
            p['component']=self.store.component(p['id'],project_id)
        return {'path':path,'source':source,'sha256':digest(source),'paragraphs':paragraphs,'sections':sections(source),'needs_anchor_import':False}

    def sync(self,project_id,path,source):
        for p in parse_paragraphs(source):
            old=self.store.one('SELECT * FROM components WHERE id=?',(p['id'],))
            if old and (old['project_id']!=project_id or old['data'].get('path')!=path):
                raise ValueError('Paragraph ID 已属于其他文件；复制组件时必须生成新 ID')
            data={'path':path,'content':p['content'],'section':p['section']}
            if not old or old['data']!=data:
                self.store.save_component(project_id,'paragraph',p['section'] or p['id'][:8],data,p['id'],old['revision_id'] if old else None,'LaTeX source sync')
                if old: self.store.execute('UPDATE paragraph_outlines SET needs_review=1 WHERE paragraph_id=?',(p['id'],))
            self.store.execute('INSERT OR IGNORE INTO paragraph_outlines(paragraph_id,section,updated_at) VALUES(?,?,?)',(p['id'],p['section'],now()))

    def save(self,project_id,path,source,expected_hash,initial=False):
        with self.lock:
            target,_=self.target(project_id,path)
            old=target.read_text('utf-8-sig') if target.exists() else ''
            if target.exists() and digest(old)!=expected_hash: raise ValueError('源文件已变化，请刷新并合并修改')
            previous={p['id'] for p in parse_paragraphs(old)}
            current={p['id'] for p in parse_paragraphs(source)}
            missing=previous-current
            if missing and not initial: raise ValueError('结构变更影响 Paragraph ID: '+', '.join(sorted(missing))+'。请使用拆分/合并操作保留演化关系')
            # Validate cross-file IDs before changing the source.
            for ident in current:
                row=self.store.one('SELECT * FROM components WHERE id=?',(ident,))
                if row and (row['project_id']!=project_id or row['data'].get('path')!=path): raise ValueError('段落 ID 与其他组件冲突')
            if old:
                self.store.execute('INSERT INTO paper_versions VALUES(?,?,?,?,?,?)',(uid(),project_id,path,old,digest(old),now()))
            atomic_write(target,source)
            try: self.sync(project_id,path,source)
            except Exception:
                atomic_write(target,old)
                raise
            return self.read(project_id,path)

    def edit_paragraph(self,project_id,ident,content,expected_hash):
        component=self.store.component(ident,project_id)
        path=component['data']['path']; target,_=self.target(project_id,path)
        source=target.read_text('utf-8-sig')
        item=next((p for p in parse_paragraphs(source) if p['id']==ident),None)
        if not item: raise ValueError('源文件中未找到段落锚点')
        if ANCHOR.search(content): raise ValueError('段落正文不能嵌入其他段落锚点')
        updated=source[:item['start']]+'\n'+content.strip()+'\n\n'+source[item['end']:]
        return self.save(project_id,path,updated,expected_hash)

    def outline(self,project_id,ident,payload):
        self.store.component(ident,project_id)
        old=self.store.one('SELECT * FROM paragraph_outlines WHERE paragraph_id=?',(ident,),True)
        if old['locked'] and not payload.get('unlock_confirmed'): raise ValueError('大纲已锁定；请先明确解锁')
        for claim_id in payload.get('evidence',[]):
            c=self.store.component(claim_id,project_id)
            if c['kind']!='claim': raise ValueError('大纲证据应关联 Claim ID')
        for paper_id in payload.get('references',[]):
            self.store.one('SELECT id FROM papers WHERE id=?',(paper_id,),True)
        for experiment_id in payload.get('experiments',[]):
            self.store.one('SELECT id FROM experiments WHERE id=? AND project_id=?',(experiment_id,project_id),True)
        with self.store.transaction() as conn:
            conn.execute('INSERT INTO outline_versions VALUES(?,?,?,?)',(uid(),ident,encode(old),now()))
            conn.execute('''UPDATE paragraph_outlines SET section=?,purpose=?,main_claim=?,evidence_json=?,connection=?,references_json=?,experiments_json=?,locked=?,pinned=?,needs_review=?,updated_at=? WHERE paragraph_id=?''',
                         (payload.get('section',old['section']),payload.get('purpose',''),payload.get('main_claim',''),encode(payload.get('evidence',[])),payload.get('connection',''),encode(payload.get('references',[])),encode(payload.get('experiments',[])),int(bool(payload.get('locked'))),int(bool(payload.get('pinned'))),int(bool(payload.get('needs_review'))),now(),ident))
            conn.execute("DELETE FROM component_links WHERE source_id=? AND relation='supports'",(ident,))
            for claim_id in payload.get('evidence',[]): conn.execute('INSERT INTO component_links VALUES(?,?,?)',(ident,claim_id,'supports'))
        return self.store.one('SELECT * FROM paragraph_outlines WHERE paragraph_id=?',(ident,))

    def evolve(self,project_id,path,parent_ids,contents,operation,expected_hash):
        if operation not in {'split','merge','copy'} or not contents or not parent_ids: raise ValueError('需要拆分、合并或复制的段落及新正文')
        target,_=self.target(project_id,path); source=target.read_text('utf-8-sig')
        paragraphs=parse_paragraphs(source)
        indexes=[i for i,p in enumerate(paragraphs) if p['id'] in parent_ids]
        if len(indexes)!=len(parent_ids) or indexes!=list(range(min(indexes),max(indexes)+1)): raise ValueError('请选择相邻的有效段落')
        children=[uid() for _ in contents]
        replacement=''.join('% easyref:paragraph:'+ident+'\n'+text.strip()+'\n\n' for ident,text in zip(children,contents))
        start=source.rfind('% easyref:paragraph:',0,paragraphs[min(indexes)]['start'])
        end=paragraphs[max(indexes)]['end']
        updated=source[:end]+replacement+source[end:] if operation=='copy' else source[:start]+replacement+source[end:]
        result=self.save(project_id,path,updated,expected_hash,initial=True)
        with self.store.transaction() as conn:
            for parent in parent_ids:
                for child in children: conn.execute('INSERT INTO paragraph_evolution VALUES(?,?,?,?,?)',(uid(),parent,child,operation,now()))
                if operation!='copy': conn.execute("UPDATE components SET status='retired' WHERE id=?",(parent,))
        return result

    def diff(self,project_id,version_id,path):
        old=self.store.one('SELECT * FROM paper_versions WHERE id=? AND project_id=? AND path=?',(version_id,project_id,path),True)
        target,_=self.target(project_id,path)
        return ''.join(difflib.unified_diff(old['source_text'].splitlines(True),target.read_text('utf8').splitlines(True),fromfile=version_id,tofile='working copy'))

    def compile(self,project_id,path):
        target,project=self.target(project_id,path)
        output=Path(project['root_path'])/'.easyref'/'latex'/digest(path)[:12]
        output.mkdir(parents=True,exist_ok=True)
        from .local_latex import detect_engine,compile_command
        engine=detect_engine()
        if not engine['available']: return {'status':'unavailable','error':engine['error'],'engine':engine,'pdf':None}
        args=compile_command(engine,target,output)
        pdf=output/(target.stem+'.pdf')
        pdf.unlink(missing_ok=True)
        try:
            result=subprocess.run(args,cwd=target.parent,capture_output=True,text=True,encoding='utf8',errors='replace',timeout=120,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        except subprocess.TimeoutExpired:
            return {'status':'failed','error':'LaTeX 编译超过 120 秒，已终止','pdf':None}
        log=(result.stdout+result.stderr)[-24000:]
        (output/'compile.log').write_text(log,encoding='utf8')
        return {'status':'completed' if result.returncode==0 and pdf.exists() else 'failed','log':log,'engine':engine,
                'pdf':str(pdf.relative_to(Path(project['root_path']))) if result.returncode==0 and pdf.exists() else None,
                'synctex_available':(output/(target.stem+'.synctex.gz')).exists(),'paragraph_pdf_mapping':'unavailable: source anchors are authoritative'}
