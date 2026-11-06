"""Immutable semantic snapshots and explicit component evolution."""
import copy
import json
from .model import new_object, now, uid
from .storage import ResearchProject, safe_path, sha, atomic, hash_value, git_state

def submission_snapshot(root,venue,branch,status='prepared',parent=None):
    project=ResearchProject(root); doc=project.read(); expected=hash_value(doc)
    git=git_state(root)
    if not git['commit']: raise ValueError('Commit the research files before capturing a submission')
    ident=uid(); path='submissions/'+ident+'.json'
    content={'project_id':doc['project_id'],'git_commit':git['commit'],'branch':branch,'objects':copy.deepcopy(doc['objects']),'relationships':copy.deepcopy(doc['relationships']),'files':copy.deepcopy(doc['files'])}
    atomic(safe_path(root,path),json.dumps(content,ensure_ascii=False,indent=2))
    obj=new_object('SubmissionAttempt',doc['project_id'],venue,{'venue':venue,'branch':branch,'git_commit':git['commit'],'snapshot_path':path,'sha256':sha(safe_path(root,path)),'submission_status':status,'parent':parent},ident)
    doc['objects'].append(obj); doc['files'].append({'path':path,'sha256':obj['data']['sha256'],'size':safe_path(root,path).stat().st_size})
    project.save(doc,'submission.snapshot',expected=expected); return obj

def compare_snapshots(root,left,right):
    doc=ResearchProject(root).read(); lookup={o['id']:o for o in doc['objects']}
    def read(ident):
        obj=lookup[ident]
        if obj['type']!='SubmissionAttempt': raise ValueError('Select submission snapshots')
        path=safe_path(root,obj['data']['snapshot_path'])
        if sha(path)!=obj['data']['sha256']: raise ValueError('Submission snapshot hash mismatch')
        data=json.loads(path.read_text('utf-8'))
        return {o['id']:o for o in data['objects']}
    a,b=read(left),read(right)
    return {'added':sorted(b.keys()-a.keys()),'removed':sorted(a.keys()-b.keys()),'changed':[{'id':i,'type':b[i]['type'],'before':a[i],'after':b[i]} for i in a.keys()&b.keys() if a[i]!=b[i]],'unchanged':sorted(i for i in a.keys()&b.keys() if a[i]==b[i])}

def evolve_component(root,ident,data,copy_component=False):
    project=ResearchProject(root); doc=project.read(); expected=hash_value(doc)
    original=next(o for o in doc['objects'] if o['id']==ident)
    if original['type'] in {'ResearchProject','SubmissionAttempt'}: raise ValueError('Cannot replace an immutable snapshot or project identity')
    updated=copy.deepcopy(original); updated.update(data=data,revision=uid(),updated_at=now(),validation_status='unverified')
    if copy_component:
        updated['id']=uid(); doc['objects'].append(updated)
        doc['relationships'].append({'id':uid(),'type':'derived_from','source':updated['id'],'target':ident,'evidence':[],'provenance':{'kind':'fact','actor':'user','sources':[original['revision']]}})
    else: doc['objects'][doc['objects'].index(original)]=updated
    project.save(doc,'component.copy' if copy_component else 'component.revise',expected=expected); return updated

def merge_component(base,left,right):
    """Field-level three-way merge. Conflicts are returned, never auto-resolved."""
    merged={}; conflicts=[]; absent=object()
    for key in base.keys()|left.keys()|right.keys():
        a,b,c=base.get(key,absent),left.get(key,absent),right.get(key,absent)
        if b==c: value=b
        elif b==a: value=c
        elif c==a: value=b
        else: conflicts.append(key); continue
        if value is not absent: merged[key]=value
    return {'merged':merged,'conflicts':conflicts,'can_apply':not conflicts}
