"""Build a portable EasyRef skill containing the complete local UI and backend."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
PREFIXES = ('backend/app/', 'backend/registry/', 'backend/skills/', 'backend/tracking/', 'docs/')
FILES = {'backend/run_local.py', 'backend/requirements-local.txt', 'backend/scripts/idea_canvas.py'}
EXCLUDED = {'.env', '.git', '.easyref', '.venv', 'node_modules', '__pycache__', 'logs'}


def package_files():
    tracked = subprocess.check_output(['git', 'ls-files', '-z'], cwd=ROOT).decode('utf-8').split('\0')
    for name in tracked:
        if name and (name.startswith(PREFIXES) or name in FILES):
            path = ROOT / name
            if not path.is_file() or path.is_symlink() or any(p in EXCLUDED for p in path.parts):
                raise ValueError(f'Unexpected runtime path: {name}')
            yield path, Path('app') / name
    for source, destination in ((ROOT / 'skills/easyref', Path('.')),
                                (ROOT / 'frontend/dist', Path('app/frontend/dist'))):
        for path in sorted(source.rglob('*')):
            if path.is_symlink():
                raise ValueError(f'Symlinks are not packaged: {path}')
            if path.is_file() and not any(part in EXCLUDED for part in path.relative_to(source).parts):
                if path.suffix not in {'.pyc', '.pyo'}:
                    yield path, destination / path.relative_to(source)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'releases')
    parser.add_argument('--install', action='store_true')
    args = parser.parse_args()
    destination = Path(os.getenv('CODEX_HOME') or Path.home() / '.codex') / 'skills/easyref'
    if args.install and destination.exists():
        parser.error(f'Existing skill left untouched: {destination}. Stop it and back it up before upgrading.')
    # Never ship a build compiled in legacy or remote-API mode.
    env = {**os.environ, 'VITE_EASYREF_LEGACY': 'false', 'VITE_API_URL': '/api'}
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not npm:
        parser.error('Node/npm required to build a release (not to run it)')
    subprocess.run([npm, '--prefix', 'frontend', 'run', 'build'], cwd=ROOT, env=env, check=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip())
    with tempfile.TemporaryDirectory(prefix='easyref-package-') as temporary:
        stage = Path(temporary) / 'easyref'
        stage.mkdir()
        manifest = {'name': 'easyref', 'source_commit': commit, 'source_dirty': dirty, 'files': {}}
        for source, relative in package_files():
            target = stage / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            manifest['files'][relative.as_posix()] = hashlib.sha256(target.read_bytes()).hexdigest()
        for required in ('SKILL.md', 'app/backend/run_local.py', 'app/frontend/dist/index.html',
                         'app/backend/registry/ccf-2026.json', 'scripts/launch.py'):
            if required not in manifest['files']:
                raise ValueError(f'Missing release file: {required}')
        (stage / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        archive = output / f'easyref-skill-{commit[:8]}.zip'
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as zipped:
            for path in sorted(stage.rglob('*')):
                if path.is_file():
                    zipped.write(path, 'easyref/' + path.relative_to(stage).as_posix())
        if args.install:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(stage, destination)
        print(json.dumps({'archive': str(archive), 'installed': str(destination) if args.install else None,
                          'files': len(manifest['files']), 'source_commit': commit, 'source_dirty': dirty}, ensure_ascii=False))


if __name__ == '__main__':
    main()
