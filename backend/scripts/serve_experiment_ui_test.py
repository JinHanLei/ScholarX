"""Isolated browser-test server. All fixtures are synthetic and temporary."""
import argparse
import sys
import tempfile
from pathlib import Path

backend = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(backend), str(backend / 'tests')]
from app import create_app
from experiment_result_fixture import seed_report_project
from experiment_tracking_fixture import seed_tracking_project


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=5019)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='easyref-experiment-ui-') as directory:
        app = create_app({'TESTING': True, 'DATA_DIR': Path(directory), 'IDEA_AUTOSTART': False})

        @app.post('/api/testing/experiment-results-fixture')
        def fixture():
            return seed_report_project(app)

        @app.post('/api/testing/experiment-tracking-fixture')
        def tracking_fixture():
            return seed_tracking_project(app)

        try:
            app.run(host='127.0.0.1', port=args.port, threaded=True, use_reloader=False)
        finally:
            app.extensions['easyref']['experiments'].close()
            app.extensions['easyref']['codex'].close()
