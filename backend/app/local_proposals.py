"""Explicit, hash-checked adoption of Codex/file edits into versioned components."""
import difflib
import json
from pathlib import Path
from .local_store import inside, file_hash, atomic_write, encode, uid


class Proposals:
    def __init__(self,store): self.store=store

    def read(self,pid,relative):
        project=self.store.project(pid); root=Path(project['root_path'])
        path=inside(root,relative,True); rel=path.relative_to(root)
        if not ((rel.parts[:2]==('.easyref','proposals') and len(rel.parts)==3) or (rel.parts[0]=='research' and len(rel.parts)==3)) or path.suffix!='.json':
            raise ValueError('请选择组件建议 JSON 文件')
        if path.stat().st_size>2_000_000: raise ValueError('建议文件超过 2 MB')
        proposal=json.loads(path.read_text('utf-8-sig'))
        ident=proposal.get('component_id') or proposal.get('id')
        old=self.store.component(ident,pid) if ident else None
        if old and old['kind']=='paragraph': raise ValueError('正文以 .tex 为准，请在 Paper 中审阅和编辑')
        kind=old['kind'] if old else proposal.get('kind')
        if kind not in {'idea','blueprint','module','claim','figure','table','section','venue_profile','task'}: raise ValueError('不支持的建议组件类型')
        if not isinstance(proposal.get('data'),dict): raise ValueError('建议需要结构化 data 对象')
        name=proposal.get('name') or (old or {}).get('name')
        if not isinstance(name,str) or not name.strip(): raise ValueError('建议需要组件名称')
        expected=proposal.get('expected_revision') or proposal.get('revision_id')
        if old and expected!=old['revision_id']: raise ValueError('建议基于旧修订，请让 Codex 根据当前版本重新生成')
        before={'name':old['name'],'data':old['data']} if old else {}
        after={'name':name,'data':proposal['data']}
        diff=''.join(difflib.unified_diff(json.dumps(before,ensure_ascii=False,indent=2).splitlines(True),json.dumps(after,ensure_ascii=False,indent=2).splitlines(True),fromfile='current',tofile='proposal'))
        return {'path':rel.as_posix(),'sha256':file_hash(path),'kind':kind,'component_id':ident,'expected_revision':expected,'name':name,'data':proposal['data'],'purpose':proposal.get('purpose','Adopt reviewed local proposal'),'diff':diff}

    def list(self,pid):
        root=Path(self.store.project(pid)['root_path']); result=[]
        paths=list((root/'.easyref'/'proposals').glob('*.json'))+list((root/'research').glob('*/*.json'))
        for path in paths:
            try:
                proposal=self.read(pid,path.relative_to(root))
                if proposal['diff']: result.append(proposal)
            except (ValueError,KeyError,TypeError) as exc:
                # Paragraph exports are managed by the LaTeX synchronizer.
                if path.parent.name=='paragraph': continue
                result.append({'path':path.relative_to(root).as_posix(),'error':str(exc)})
        return result

    def apply(self,pid,relative,sha256):
        proposal=self.read(pid,relative)
        if proposal['sha256']!=sha256: raise ValueError('建议在预览后已改变，请重新查看差异')
        root=Path(self.store.project(pid)['root_path']); path=inside(root,proposal['path'],True)
        # Keep the exact reviewed content as an audit artifact before updating exports.
        archive=root/'.easyref'/'accepted-proposals'/(uid()+'.json')
        atomic_write(archive,path.read_text('utf8'))
        result=self.store.save_component(pid,proposal['kind'],proposal['name'],proposal['data'],proposal['component_id'],proposal['expected_revision'],proposal['purpose'],accept_external=True)
        if path.parent==root/'.easyref'/'proposals': path.unlink()
        return result
