"""The vocabulary and executable constraints shared by every workspace."""
import copy
import json
from pathlib import Path
from uuid import uuid4
from datetime import datetime, timezone
from jsonschema import Draft202012Validator, FormatChecker

VERSION = '1.0.0'
TYPES = 'ResearchProject LiteratureReference Idea ResearchQuestion Hypothesis ModelBlueprint ModelModule Experiment ExperimentRun ResearchClaim Evidence Paper PaperSection PaperParagraph ParagraphOutline Figure Table Review ReviewIssue Decision Task SkillRun AgentSession SubmissionAttempt VenueProfile Artifact'.split()
STATES = 'pending in_progress blocked interrupted completed failed cancelled'.split()
ACTIVITIES = {'ExperimentRun', 'SkillRun', 'AgentSession'}
ENTITIES = set(TYPES) - ACTIVITIES
# source types, target types, evidence required, automatic creation allowed, PROV mapping
RELATIONS = {
    'derived_from': (ENTITIES, ENTITIES, False, True, 'wasDerivedFrom'),
    'depends_on': (set(TYPES), set(TYPES), False, True, None),
    'uses': (ACTIVITIES, ENTITIES, False, True, 'used'),
    'implemented_by': ({'Hypothesis','ModelBlueprint','ModelModule'}, {'ModelBlueprint','ModelModule','Artifact'}, False, True, None),
    'evaluates': ({'Experiment','ExperimentRun'}, {'Hypothesis','ModelBlueprint','ModelModule','ResearchClaim'}, False, True, None),
    'produces': (ACTIVITIES, ENTITIES, False, True, 'generated'),
    'supports': ({'Evidence','ExperimentRun','LiteratureReference'}, {'ResearchClaim','Hypothesis'}, True, False, None),
    'contradicts': ({'Evidence','ExperimentRun','LiteratureReference'}, {'ResearchClaim','Hypothesis'}, True, False, None),
    'describes': ({'Paper','PaperSection','PaperParagraph','ParagraphOutline','Figure','Table','Idea'}, ENTITIES, False, True, None),
    'cites': (ENTITIES, {'LiteratureReference'}, False, True, None),
    'addresses': ({'Task','Decision','ExperimentRun','PaperParagraph'}, {'ReviewIssue','ResearchQuestion','Hypothesis'}, False, True, None),
    'blocks': (set(TYPES), {'Task','ExperimentRun'}, False, True, None),
    'supersedes': (ENTITIES, ENTITIES, False, False, None),
    'belongs_to': (set(TYPES), {'ResearchProject','ModelBlueprint','Paper','PaperSection','Review','Experiment'}, False, True, None),
    'generated_by': (ENTITIES, ACTIVITIES, False, True, 'wasGeneratedBy'),
    'submitted_as': ({'Paper','ResearchProject'}, {'SubmissionAttempt'}, False, False, None),
}
TRANSITIONS = {
    'pending': {'in_progress','blocked','cancelled'},
    'in_progress': {'blocked','interrupted','completed','failed','cancelled'},
    'blocked': {'pending','in_progress','cancelled'},
    'interrupted': {'in_progress','blocked','cancelled'},
    'failed': {'pending','cancelled'}, 'completed': set(), 'cancelled': {'pending'},
}

def now(): return datetime.now(timezone.utc).isoformat()
def uid(): return str(uuid4())
def canonical(value): return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False, separators=(',', ':'))

def new_object(kind, project_id, title, data=None, ident=None):
    stamp = now()
    return dict(id=ident or uid(), type=kind, project_id=project_id, title=title,
                created_at=stamp, updated_at=stamp, revision=uid(), status='pending',
                validation_status='unverified', approval_status='not_required',
                location='research.yaml', provenance={'kind':'hypothesis','actor':'user','sources':[]},
                related_objects=[], data=data or {})

def task_data(objective='unknown'):
    return dict(objective=objective, stage='unknown', dependencies=[], required_inputs=[], expected_outputs=[],
                assigned_skill=None, execution_context={}, blocking_reasons=[], last_completed_step=None,
                next_action='Check inputs and existing outputs before executing', approval_requirement='required',
                checkpoint={'completed_steps':[], 'written_files':[], 'successful_commands':[], 'processes':[],
                            'reusable_outputs':[], 'git_changes':'unknown', 'preflight_checks':[]}, verification=[])

def new_project(title, ident=None):
    pid = ident or uid()
    project = new_object('ResearchProject',pid,title,{'objective':'unknown','environment_requirements':[]},pid)
    return dict(schema_version=VERSION, project_id=pid, objects=[project], relationships=[],
                files=[], external_resources=[], extensions={})

def schema(name='research'):
    return json.loads((Path(__file__).parent/'schemas'/(name+'.schema.json')).read_text('utf-8'))

def migrate(document):
    result = copy.deepcopy(document)
    version = result.get('schema_version')
    if version == '0.9.0':
        for obj in result.get('objects',[]):
            if 'revision_id' in obj: obj['revision'] = obj.pop('revision_id')
            obj.setdefault('approval_status','not_required')
        result['schema_version'] = VERSION
        result.setdefault('extensions',{})['migration'] = {'from':'0.9.0','to':VERSION}
    elif version != VERSION:
        raise ValueError('Unsupported schema_version: '+str(version))
    return result

def validate(document):
    errors = [f"{'/'.join(map(str,e.absolute_path))}: {e.message}" for e in Draft202012Validator(schema(),format_checker=FormatChecker()).iter_errors(document)]
    if errors: raise ValueError('\n'.join(errors[:30]))
    canonical(document)  # Reject NaN/Infinity and non-JSON values accepted by some YAML parsers.
    objects = {o['id']:o for o in document['objects']}
    if len(objects) != len(document['objects']): raise ValueError('Duplicate object ID')
    paths=[f['path'].casefold() for f in document['files']]
    if len(paths)!=len(set(paths)): raise ValueError('Duplicate or case-colliding file path')
    pid = document['project_id']
    if pid not in objects or objects[pid]['type'] != 'ResearchProject': raise ValueError('Missing ResearchProject')
    def refs(values, kinds=None):
        for ref in values:
            if ref not in objects: raise ValueError('Unresolved reference: '+ref)
            if kinds and objects[ref]['type'] not in kinds: raise ValueError('Reference type mismatch: '+ref)
    seen = set()
    for edge in document['relationships']:
        if edge['id'] in seen: raise ValueError('Duplicate relationship ID')
        seen.add(edge['id']); refs([edge['source'],edge['target']]); refs(edge['evidence'],{'Evidence'})
        source, target, required, auto, _ = RELATIONS[edge['type']]
        if objects[edge['source']]['type'] not in source or objects[edge['target']]['type'] not in target:
            raise ValueError('Invalid relationship endpoints: '+edge['type'])
        if required and not edge['evidence']: raise ValueError('Relationship requires evidence')
        if edge.get('automatic') and not auto: raise ValueError('Relationship requires review')
    for obj in objects.values():
        if obj['project_id'] != pid: raise ValueError('Cross-project references require a future federation profile')
        refs(obj['related_objects'])
        data = obj['data']
        if obj['type']=='ModelBlueprint':
            for edge in data['edges']:
                if edge.get('source') not in data['modules'] or edge.get('target') not in data['modules']: raise ValueError('Blueprint edge must reference stable Module IDs')
        for key, kinds in {'dependencies':{'Task'},'modules':{'ModelModule'},'paragraphs':{'PaperParagraph'},
                           'claims':{'ResearchClaim'},'evidence':{'Evidence'},'sections':{'PaperSection'}}.items():
            if key in data and isinstance(data[key],list) and all(isinstance(x,str) for x in data[key]): refs(data[key],kinds)
        if obj['type']=='ParagraphOutline': refs([data['paragraph_id']],{'PaperParagraph'})
        if obj['type']=='Evidence': refs([data['source_id']])
        if isinstance(data.get('verification'),list):
            for check in data['verification']: refs(check.get('evidence',[]),{'Evidence'})
        if obj['validation_status']=='verified':
            checks = data.get('verification',[])
            if not checks or any(not c.get('passed') or not c.get('reviewer') or not c.get('evidence') for c in checks):
                raise ValueError('Verified objects require explicit evidence checks')
            for c in checks:
                refs(c['evidence'],{'Evidence'})
                for eid in c['evidence']:
                    evidence=objects[eid]['data']; source=objects.get(evidence['source_id'])
                    from .storage import hash_value
                    fingerprints={f['sha256'] for f in document['files'] if f['path']==evidence['locator']}
                    if source: fingerprints.add(hash_value(source['data']))
                    if evidence['sha256'] not in fingerprints: raise ValueError('Verified claim has stale or untraceable evidence')
        if obj['type']=='Task' and obj['status']=='completed' and (not data['verification'] or not all(c['passed'] and c['evidence'] for c in data['verification'])):
            raise ValueError('Completed Task lacks verification')
    # Cyclic task dependencies cannot yield a valid continuation plan.
    visiting, visited = set(), set()
    def visit(ident):
        if ident in visiting: raise ValueError('Cyclic task dependencies')
        if ident in visited: return
        visiting.add(ident)
        for dep in objects[ident]['data'].get('dependencies',[]): visit(dep)
        visiting.remove(ident); visited.add(ident)
    for obj in objects.values():
        if obj['type']=='Task': visit(obj['id'])
    return document
