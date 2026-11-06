import sys
from pathlib import Path
import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import create_app

@pytest.fixture
def app(tmp_path):
    app=create_app({'TESTING':True,'DATA_DIR':tmp_path/'data'})
    yield app
    app.extensions['easyref']['experiments'].close()
    app.extensions['easyref']['codex'].close()

@pytest.fixture
def client(app): return app.test_client()

@pytest.fixture
def services(app): return app.extensions['easyref']

@pytest.fixture
def project(client):
    result=client.post('/api/projects',json={'name':'Acceptance test research'})
    assert result.status_code==201,result.json
    return result.json['project']
