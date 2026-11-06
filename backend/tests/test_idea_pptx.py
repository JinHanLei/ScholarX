"""Synthetic PPTX fixtures: no real experiments or user projects."""
import io
import json
import zipfile
from pathlib import Path
from uuid import uuid4

import pytest
from app.local_idea_pptx import inspect_pptx, pptx_path
from app.research_schema.exchange import export_project


def deck(text='FIRST SLIDE', order=('2', '1')):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('ppt/presentation.xml', '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>' + ''.join(f'<p:sldId id="{i+256}" r:id="r{x}"/>' for i, x in enumerate(order)) + '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>')
        z.writestr('ppt/_rels/presentation.xml.rels', '<Relationships>' + ''.join(f'<Relationship Id="r{x}" Target="slides/slide{x}.xml"/>' for x in order) + '</Relationships>')
        for x, label in [('2', text), ('1', 'SECOND SLIDE')]:
            z.writestr(f'ppt/slides/slide{x}.xml', f'<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>{label}</a:t></p:sld>')
    return output.getvalue()


def upload(client, url, idea, content, name='editable-model.pptx'):
    return client.post(url + '/pptx', data={'expected_revision': str(idea['revision']), 'document': json.dumps(idea['document']),
        'record_id': str(uuid4()), 'file': (io.BytesIO(content), name)})


def test_first_slide_follows_presentation_order_not_filename():
    figure = inspect_pptx(deck(), 'two-slides.pptx')
    assert figure['presentation']['text'] == 'FIRST SLIDE'
    assert figure['presentation']['slide'] == 1 and figure['presentation']['slide_count'] == 2
    assert figure['width'] / figure['height'] == pytest.approx(16 / 9)
    for content, name in [(b'not a zip', 'bad.pptx'), (deck(), 'old.ppt'), (deck(order=()), 'empty.pptx')]:
        with pytest.raises(ValueError): inspect_pptx(content, name)


def test_ppt_import_preserves_source_and_history_and_never_starts_execution(client, services, project, monkeypatch, tmp_path):
    service = services['ideas']; queued = []; monkeypatch.setattr(service, 'kick', queued.append)
    idea = service.create(project['id']); url = f"/api/projects/{project['id']}/ideas/{idea['idea_id']}"
    content = deck(); response = upload(client, url, idea, content)
    assert response.status_code == 200, response.json
    first = response.json['idea']; figure = first['document']['figure']
    sha = figure['presentation']['sha256']
    assert not response.json['published'] and not queued and not service.versions(project['id'])
    assert client.get(url + '/pptx/' + sha).data == content
    assert not first['figure_stale'] and len(service.records(project['id'], idea['idea_id'])) == 1
    published = client.post(url + '/versions', json={'expected_revision': 1, 'document': first['document']})
    assert published.status_code == 200, published.json
    assert len(queued) == 1  # Explicit publication only; an imported figure may have no legacy graph nodes.
    old_version = published.json['version']['id']
    current = published.json['idea']
    second = upload(client, url, current, deck('CHANGED MODEL')).json['idea']
    assert len(queued) == 1 and len(service.versions(project['id'])) == 1
    assert second['document']['figure']['presentation']['sha256'] != sha
    assert service.version(old_version)['document']['figure'] == figure
    assert client.get(url + '/pptx/' + sha).data == content
    # The actual editable files must travel with portable exports.
    destination = tmp_path / 'export.zip'; export_project(project['root_path'], destination)
    with zipfile.ZipFile(destination) as z:
        path = pptx_path(services['store'], project['id'], idea['idea_id'], sha)
        assert z.read(path.relative_to(Path(project['root_path'])).as_posix()) == content
    other = client.post('/api/projects', json={'name': 'Other test project'}).json['project']
    assert client.get(f"/api/projects/{other['id']}/ideas/{idea['idea_id']}/pptx/{sha}").status_code == 400


def test_failed_or_stale_upload_leaves_current_design_unchanged(client, services, project):
    service = services['ideas']; idea = service.create(project['id'])
    url = f"/api/projects/{project['id']}/ideas/{idea['idea_id']}"
    assert upload(client, url, idea, b'broken').status_code == 400
    first = upload(client, url, idea, deck()).json['idea']
    assert upload(client, url, idea, deck('SHOULD NOT REPLACE')).status_code == 400
    assert service.document(project['id'], idea['idea_id']) == first
    assert len(service.records(project['id'], idea['idea_id'])) == 1
    sha = first['document']['figure']['presentation']['sha256']
    pptx_path(services['store'], project['id'], idea['idea_id'], sha).write_bytes(b'external alteration')
    assert client.get(url + '/pptx/' + sha).status_code == 400
