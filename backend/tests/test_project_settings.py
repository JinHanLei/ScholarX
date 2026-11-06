from pathlib import Path

import pytest


def test_project_dialog_settings_persist_without_changing_folder(client, project):
    settings = {
        'description': 'A paper about reliable retrieval.',
        'python_executable': r'D:\envs\paper\python.exe',
        'writing_rules': 'Support claims with evidence.',
        'restrict_to_project': True,
    }
    response = client.post('/api/projects', json={'name': '  New paper  ', 'settings': settings})
    assert response.status_code == 201
    created = response.json['project']
    assert created['name'] == 'New paper'
    assert created['settings'] == settings
    assert Path(created['root_path']).is_dir()
    assert created['root_path'] != project['root_path']

    updated = {**settings, 'description': 'Updated project introduction.'}
    assert client.patch(f"/api/projects/{created['id']}", json={'name': ' Renamed paper ', 'settings': updated}).status_code == 200
    saved = client.get(f"/api/projects/{created['id']}").json['project']
    assert saved['name'] == 'Renamed paper'
    assert saved['settings'] == updated
    assert saved['root_path'] == created['root_path']
    assert client.get(f"/api/projects/{project['id']}").json['project'] == project


@pytest.mark.parametrize('payload', [{'name': ' '}, {'name': None}, {'name': ['paper']}, {'name': 'paper', 'settings': []}])
def test_invalid_project_dialog_does_not_change_existing_data(client, project, payload):
    before = client.get('/api/projects').json
    assert client.post('/api/projects', json=payload).status_code == 400
    assert client.patch(f"/api/projects/{project['id']}", json=payload).status_code == 400
    assert client.get('/api/projects').json == before
