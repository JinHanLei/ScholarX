"""Launch the bundled EasyRef UI with separate dependencies and persistent data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.request


def status(url):
    try:
        with urllib.request.urlopen(url + '/api/status', timeout=2) as response:
            result = json.load(response)
        return result if result.get('name') == 'EasyRef' else None
    except (OSError, ValueError):
        return None


def lock_data(path):
    handle = path.open('a+b')
    handle.seek(0)
    if os.name == 'nt':
        import msvcrt
        if not handle.read(1):
            handle.write(b'0'); handle.flush()
        handle.seek(0)
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return handle


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=5020)
    parser.add_argument('--data-dir', type=Path)
    parser.add_argument('--runtime-dir', type=Path)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--serve', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('port must be between 1024 and 65535')
    package = Path(__file__).resolve().parents[1]
    app = package / 'app'
    if not (app / 'frontend/dist/index.html').is_file():
        parser.error('Missing packaged runtime. Run scripts/package_skill.py in the source repository first.')
    if sys.version_info < (3, 11):
        parser.error('Python 3.11 or newer is required')
    base = Path(os.getenv('LOCALAPPDATA') or Path.home() / '.local/share') / 'EasyRef'
    version = hashlib.sha256((package / 'manifest.json').read_bytes()).hexdigest()[:16]
    runtime = (args.runtime_dir or base / 'runtime' / version).resolve()
    data = (args.data_dir or base / 'data').resolve()
    python = runtime / '.venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
    url = f'http://127.0.0.1:{args.port}'
    state_path = data / '.easyref-service.json'
    log = data / 'service.log'

    if args.serve:
        # The wrapper owns the data lock until its server child exits.
        with lock_data(data / '.easyref-service.lock'):
            env = {**os.environ, 'EASYREF_STORAGE': 'local', 'EASYREF_DATA_DIR': str(data),
                   'EASYREF_API_BASE': url + '/api'}
            server = subprocess.Popen([str(python), str(app / 'backend/run_local.py'),
                                       '--port', str(args.port), '--data-dir', str(data)],
                                      cwd=app, env=env)
            state_path.write_text(json.dumps({'url': url, 'pid': server.pid, 'data_dir': str(data),
                                             'log': str(log), 'package': str(package), 'version': version}), encoding='utf-8')
            return server.wait()

    # Never replace a running service, even when a different port was requested.
    if not args.prepare and state_path.is_file():
        previous = json.loads(state_path.read_text(encoding='utf-8'))
        current = status(previous['url'])
        if current and Path(current['data_dir']).resolve() == data:
            if previous.get('version') != version:
                parser.error('A different package version is using this data. Stop that service before upgrading.')
            print(json.dumps({**previous, 'reused': True}, ensure_ascii=False))
            return 0
    if not args.prepare:
        with socket.socket() as probe:
            try:
                probe.bind(('127.0.0.1', args.port))
            except OSError:
                parser.error(f'Port {args.port} is occupied. Existing services were left running.')
    if not shutil.which('git'):
        parser.error('Git is required on PATH')
    runtime.mkdir(parents=True, exist_ok=True)
    requirements = app / 'backend/requirements-local.txt'
    fingerprint = hashlib.sha256(requirements.read_bytes()).hexdigest()
    marker = runtime / 'requirements.sha256'
    if not python.is_file():
        subprocess.run([sys.executable, '-m', 'venv', str(runtime / '.venv')], check=True)
    if not marker.is_file() or marker.read_text() != fingerprint:
        subprocess.run([str(python), '-m', 'pip', 'install', '-r', str(requirements)], check=True)
        marker.write_text(fingerprint)
    if args.prepare:
        print(json.dumps({'prepared': True, 'python': str(python), 'runtime_dir': str(runtime)}))
        return 0
    data.mkdir(parents=True, exist_ok=True)
    # Check the lock before forking too; a racing launcher is rejected by the child.
    with lock_data(data / '.easyref-service.lock'):
        pass
    command = [str(python), str(Path(__file__).resolve()), '--serve', '--port', str(args.port),
               '--data-dir', str(data), '--runtime-dir', str(runtime)]
    with log.open('ab') as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                                   start_new_session=os.name != 'nt')
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Service exited ({process.returncode}); inspect {log}')
        current = status(url)
        if current and Path(current['data_dir']).resolve() == data:
            print(state_path.read_text(encoding='utf-8'))
            return 0
        time.sleep(.5)
    raise RuntimeError(f'Service not ready after 45 seconds; inspect {log}. No other service was stopped.')


if __name__ == '__main__':
    raise SystemExit(main())
