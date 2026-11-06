import io
import json
import sqlite3
import zipfile
from pathlib import Path
import pytest
from app.local_store import Store, digest, encode, now
from app.local_git import GitService


def test_component_proposal_diff_hash_revision_and_external_edit_protection(client,services,project):
    pid=project['id']; store=services['store']
    idea=store.save_component(pid,'idea','Original',{'hypothesis':'Before'})
    root=Path(project['root_path']); proposal=root/'.easyref'/'proposals'/'idea.json'; proposal.parent.mkdir(parents=True)
    proposal.write_text(encode({'component_id':idea['id'],'expected_revision':idea['revision_id'],'data':{'hypothesis':'After'},'purpose':'Test proposal'}),encoding='utf8')
    preview=client.get(f'/api/projects/{pid}/proposals').json['proposals'][0]
    assert 'Before' in preview['diff'] and 'After' in preview['diff']
    assert store.component(idea['id'])['data']['hypothesis']=='Before'
    assert client.post(f'/api/projects/{pid}/proposals/apply',json={'path':preview['path'],'sha256':'stale'}).status_code==400
    adopted=client.post(f'/api/projects/{pid}/proposals/apply',json={'path':preview['path'],'sha256':preview['sha256']})
    assert adopted.status_code==200,adopted.json
    assert adopted.json['component']['data']['hypothesis']=='After'
    assert not proposal.exists()
    exported=root/'research'/'idea'/(idea['id']+'.json')
    data=json.loads(exported.read_text('utf8')); data['data']['hypothesis']='External edit'; exported.write_text(encode(data),encoding='utf8')
    with pytest.raises(ValueError,match='外部修改'): services['versions'].checkpoint(pid,'Must not discard edit')
    assert json.loads(exported.read_text('utf8'))['data']['hypothesis']=='External edit'
    preview=client.get(f'/api/projects/{pid}/proposals').json['proposals'][0]
    assert client.post(f'/api/projects/{pid}/proposals/apply',json={'path':preview['path'],'sha256':preview['sha256']}).status_code==200
    assert store.component(idea['id'])['data']['hypothesis']=='External edit'


def test_script_change_after_registration_requires_new_run(services,project):
    path=Path(project['root_path'])/'run.py'; path.write_text("print('before')")
    run=services['experiments'].register(project['id'],{'command':['python','run.py'],'config':{'dataset':'TEST','split':'TEST','seed':0,'hyperparameters':{},'evaluation_protocol':'TEST'}})
    path.write_text("print('after')")
    with pytest.raises(ValueError,match='脚本已改变'): services['experiments'].start(run['id'],True)
    assert services['experiments'].get(run['id'])['status']=='registered'


def test_submission_snapshot_pdf_requirement_and_branch_rollback(client,services,project,monkeypatch):
    pid=project['id']; services['versions'].checkpoint(pid,'Clean baseline')
    assert client.post(f'/api/projects/{pid}/submissions',json={'venue':'TEST','branch':'submission/no-pdf','submitted':True}).status_code==400
    git=GitService(project['root_path'])
    assert 'submission/no-pdf' not in git.status()['branches']
    execute=services['store'].execute
    def fail_insert(sql,args=()):
        if sql.startswith('INSERT INTO submission_attempts'): raise sqlite3.IntegrityError('Simulated disk transaction failure')
        return execute(sql,args)
    monkeypatch.setattr(services['store'],'execute',fail_insert)
    response=client.post(f'/api/projects/{pid}/submissions',json={'venue':'TEST','branch':'submission/rollback'})
    assert response.status_code==400
    assert 'submission/rollback' not in git.status()['branches']
    assert not list((services['store'].root/'snapshots').glob('*.zip'))


def test_project_export_does_not_include_other_project_data(client,services,project):
    store=services['store']; other=store.create_project('PRIVATE OTHER PROJECT')
    store.save_component(other['id'],'idea','PRIVATE IDEA',{'hypothesis':'OTHER PROJECT SECRET'})
    store.save_component(project['id'],'idea','Target idea',{'hypothesis':'PUBLIC TEST'})
    response=client.get(f"/api/projects/{project['id']}/export")
    assert response.status_code==200
    with zipfile.ZipFile(io.BytesIO(response.data)) as z:
        assert 'easyref.sqlite3' not in z.namelist()
        assert 'OTHER PROJECT SECRET' not in z.read('research.yaml').decode('utf8')
        assert 'PUBLIC TEST' in z.read('research.yaml').decode('utf8')


def test_upgrade_initial_schema_preserves_project_and_adds_outline_history(tmp_path):
    root=tmp_path/'old-db'; root.mkdir(); path=root/'easyref.sqlite3'
    sql=(Path(__file__).resolve().parents[1]/'app'/'migrations'/'001_local.sql').read_text('utf8')
    with sqlite3.connect(path) as db:
        db.executescript(sql)
        db.execute('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TEXT NOT NULL)')
        db.execute('INSERT INTO schema_migrations VALUES(?,?,?)',('001_local.sql',digest(sql),now()))
        db.execute('INSERT INTO projects VALUES(?,?,?,?,?,?)',('old','Existing project',str(root),'{}',now(),now()))
    store=Store(root)
    assert store.project('old')['name']=='Existing project'
    migrations=Path(__file__).resolve().parents[1]/'app'/'migrations'
    assert {row['version'] for row in store.all('SELECT * FROM schema_migrations')} == {path.name for path in migrations.glob('*.sql')}
    assert store.all('SELECT * FROM research_checkpoints')==[]
    assert store.all('SELECT * FROM outline_versions')==[]
    with store.transaction() as db:
        assert 'snapshot_kind' in [r['name'] for r in db.execute('PRAGMA table_info(submission_attempts)')]
        assert {'pinned','archived'} <= {r['name'] for r in db.execute('PRAGMA table_info(paper_library_entries)')}
