"""Generate checked-in JSON Schemas from the single protocol vocabulary."""
import json
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.research_schema.model import TYPES, STATES, RELATIONS

def build():
    text={'type':'string'}; strings={'type':'array','items':text,'uniqueItems':True}
    ident={'type':'string','minLength':1,'pattern':'^[A-Za-z0-9][A-Za-z0-9._:-]*$'}; refs={'type':'array','items':ident,'uniqueItems':True}
    path={'type':'string','minLength':1,'pattern':r'^(?!/)(?!.*(?:^|/)\.\.(?:/|$))(?!.*[\\:\x00-\x1f]).+$'}
    provenance={'type':'object','required':['kind','actor','sources'],'properties':{'kind':{'enum':['fact','inference','hypothesis']},'actor':text,'sources':strings},'additionalProperties':True}
    check={'type':'object','required':['passed','reviewer','evidence'],'properties':{'passed':{'type':'boolean'},'reviewer':{'type':'string','minLength':1},'evidence':refs},'additionalProperties':True}
    common={'id':ident,'project_id':ident,'type':{'enum':TYPES},'title':text,'created_at':{'type':'string','format':'date-time'},'updated_at':{'type':'string','format':'date-time'},'revision':ident,'status':{'enum':STATES},'validation_status':{'enum':['unknown','unverified','needs_confirmation','verified','rejected','stale']},'approval_status':{'enum':['not_required','required','pending','approved','rejected']},'location':path,'provenance':provenance,'related_objects':refs,'data':{'type':'object'},'extensions':{'type':'object'}}
    payloads={
        'ResearchProject':{'objective':text,'environment_requirements':strings},
        'LiteratureReference':{'title':text}, 'Idea':{'statement':text}, 'ResearchQuestion':{'question':text},
        'Hypothesis':{'statement':text,'test_criteria':strings},
        'ModelBlueprint':{'design_goal':text,'modules':refs,'edges':{'type':'array','items':{'type':'object'}},'code_refs':strings,'history':strings,'decisions':refs},
        'ModelModule':{'purpose':text,'code_refs':strings},
        'Experiment':{'objective':text,'config':{'type':'object'}},
        'ExperimentRun':{'execution_status':{'enum':['not_started','queued','running','interrupted','succeeded','failed','cancelled','unknown']},'config':{'type':'object'},'metrics':{'type':'object'},'outputs':strings},
        'ResearchClaim':{'statement':text,'evidence':refs},
        'Evidence':{'source_id':ident,'locator':{'type':'string','minLength':1},'sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'}},
        'Paper':{'source_path':path,'sections':refs},'PaperSection':{'heading':text,'paragraphs':refs},
        'PaperParagraph':{'source_path':path,'anchor':text,'claims':refs},
        'ParagraphOutline':{'paragraph_id':ident,'purpose':text,'main_claim':text,'evidence':refs,'locked':{'type':'boolean'},'pinned':{'type':'boolean'}},
        'Figure':{'caption':text},'Table':{'caption':text},'Review':{'scope':refs},
        'ReviewIssue':{'problem':text,'verification':text,'resolution_status':{'enum':['open','in_progress','resolved','dismissed','needs_review']}},
        'Decision':{'rationale':text,'outcome':text},
        'Task':{'objective':text,'stage':text,'dependencies':refs,'required_inputs':strings,'expected_outputs':strings,'assigned_skill':{'type':['string','null']},'execution_context':{'type':'object'},'blocking_reasons':strings,'last_completed_step':{'type':['string','null']},'next_action':text,'approval_requirement':{'enum':['required','not_required']},'checkpoint':{'type':'object','required':['completed_steps','written_files','successful_commands','processes','reusable_outputs','git_changes','preflight_checks'],'properties':{k:strings for k in ['completed_steps','written_files','successful_commands','processes','reusable_outputs','preflight_checks']}},'verification':{'type':'array','items':check}},
        'SkillRun':{'skill_name':text,'inputs':refs,'outputs':refs},'AgentSession':{'executor':text},
        'SubmissionAttempt':{'venue':text,'branch':text,'git_commit':text,'snapshot_path':path,'sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'},'submission_status':{'enum':['prepared','submitted','accepted','rejected','withdrawn']}},
        'VenueProfile':{'name':text},'Artifact':{'path':path,'media_type':text},
    }
    definitions={}
    for kind,props in payloads.items():
        definitions[kind]={'type':'object','required':[k for k in common if k!='extensions'],'properties':{**common,'type':{'const':kind},'data':{'type':'object','required':list(props),'properties':props,'additionalProperties':True}},'additionalProperties':True}
    edge={'type':'object','required':['id','type','source','target','provenance','evidence'],'properties':{'id':ident,'type':{'enum':list(RELATIONS)},'source':ident,'target':ident,'provenance':provenance,'evidence':refs,'automatic':{'type':'boolean'}},'additionalProperties':True}
    document={'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'urn:easyref:schema:research:1.0.0','type':'object','required':['schema_version','project_id','objects','relationships','files','external_resources','extensions'],'properties':{'schema_version':{'const':'1.0.0'},'project_id':ident,'objects':{'type':'array','items':{'oneOf':[{'$ref':'#/$defs/'+k} for k in TYPES]}},'relationships':{'type':'array','items':edge},'files':{'type':'array','items':{'type':'object','required':['path','sha256','size'],'properties':{'path':path,'sha256':{'type':'string','pattern':'^[a-f0-9]{64}$'},'size':{'type':'integer','minimum':0}},'additionalProperties':True}},'external_resources':{'type':'array','items':{'type':'object','required':['path','reason'],'properties':{'path':text,'reason':text,'affected_tasks':refs}}},'extensions':{'type':'object'}},'$defs':definitions,'additionalProperties':True}
    dest=Path(__file__).resolve().parents[1]/'app/research_schema/schemas'; dest.mkdir(parents=True,exist_ok=True)
    def write(name,value): (dest/(name+'.schema.json')).write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    write('research',document)
    for kind in TYPES: write(kind,{'$schema':document['$schema'],'$id':'urn:easyref:schema:'+kind+':1.0.0',**definitions[kind]})
    lists=['active_tasks','completed_tasks','pending_tasks','blocked_tasks','current_experiments','open_review_issues','important_decisions']
    handoff={'schema_version':{'const':'1.0.0'},'project_id':ident,'active_branch':text,'current_stage':text,'last_checkpoint':text,'current_blueprint':{'type':['string','null']},'current_paper':{'type':['string','null']},'environment_requirements':strings,'missing_dependencies':strings,'suggested_next_actions':strings,'required_approvals':strings,'updated_at':{'type':'string','format':'date-time'},**{k:refs for k in lists}}
    write('handoff',{'$schema':document['$schema'],'type':'object','required':list(handoff),'properties':handoff,'additionalProperties':True})
    write('event',{'$schema':document['$schema'],'type':'object','required':['event_id','timestamp','project_id','actor','activity','target_objects','input_refs','output_refs','status','related_task','provenance','previous_hash','sha256'],'properties':{'event_id':ident,'project_id':ident,'timestamp':{'type':'string','format':'date-time'},'actor':text,'activity':text,'target_objects':refs,'input_refs':strings,'output_refs':strings,'status':{'enum':STATES},'related_task':{'type':['string','null']},'provenance':provenance,'previous_hash':text,'sha256':text},'additionalProperties':True})

if __name__=='__main__': build()
