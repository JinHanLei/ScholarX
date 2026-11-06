"""Git operations use argv, never shell strings or the user's staging area."""
import os
import re
import shutil
import subprocess
from pathlib import Path
from .local_store import atomic_write, inside, uid

TEXT_SUFFIXES = {'.py','.js','.jsx','.ts','.tsx','.json','.jsonl','.yaml','.yml','.toml','.md','.tex','.bib','.sty','.cls','.csv','.txt','.mmd','.r','.sh','.ps1','.ipynb','.svg'}


class GitService:
    def __init__(self, root):
        self.root = Path(root).resolve()

    def run(self, *args, env=None, check=True, binary=False):
        result = subprocess.run(['git', '-C', str(self.root), *args], capture_output=True,
                                text=not binary, encoding=None if binary else 'utf-8', errors=None if binary else 'replace',
                                timeout=60, env=env, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        if check and result.returncode:
            raise ValueError((result.stderr.decode('utf-8', 'replace') if binary else result.stderr).strip())
        return result.stdout if binary else result.stdout.strip()

    def initialize(self, allow_nested=False, preserve_files=False):
        if not shutil.which('git'):
            raise ValueError('未找到 Git，请安装后重试')
        if self.run('rev-parse', '--show-toplevel', check=False):
            # Do not silently enroll a subdirectory of another repository.
            top = Path(self.run('rev-parse', '--show-toplevel')).resolve()
            if top != self.root and not allow_nested:
                raise ValueError('请选择 Git 仓库根目录，不能导入其子目录')
            if top == self.root:
                return
        self.run('init', '-b', 'research/main')
        ignore = self.root / '.gitignore'
        rules = '\n# EasyRef local outputs\n.easyref/\n.env\n.env.*\n__pycache__/\n.venv/\nnode_modules/\n*.pt\n*.pth\n*.ckpt\n*.safetensors\n*.aux\n*.log\n*.synctex.gz\n*.pdf\n'
        if preserve_files:
            # Imported payload hashes must remain unchanged; Git's private exclude
            # file carries local cache rules without rewriting an imported .gitignore.
            exclude=self.root/'.git'/'info'/'exclude'
            atomic_write(exclude,(exclude.read_text('utf-8') if exclude.exists() else '')+rules)
        else:
            content=ignore.read_text('utf-8') if ignore.exists() else ''
            if '# EasyRef local outputs' not in content: atomic_write(ignore,content+rules)
        self.checkpoint('Initialize EasyRef research project')

    def status(self):
        self.run('update-index','--refresh',check=False)
        return {'branch': self.run('branch', '--show-current'), 'commit': self.run('rev-parse', '--verify', 'HEAD', check=False),
                'changes': self.run('status', '--porcelain'), 'branches': self.run('branch', '--format=%(refname:short)').splitlines()}

    def checkpoint(self, message):
        if not isinstance(message, str) or not message.strip():
            raise ValueError('请输入版本说明')
        old = self.run('rev-parse', '--verify', 'HEAD', check=False)
        if self.run('diff','--cached','--name-only'):
            raise ValueError('已有手动暂存的改动；请先自行提交或取消暂存，EasyRef 不会改变它们')
        index = self.root / '.git' / ('easyref-index-' + uid())
        # Worktrees have a .git file, so locate their actual metadata directory.
        if not (self.root / '.git').is_dir():
            index = Path(self.run('rev-parse', '--absolute-git-dir')) / ('easyref-index-' + uid())
        env = dict(os.environ, GIT_INDEX_FILE=str(index), GIT_AUTHOR_NAME='EasyRef', GIT_AUTHOR_EMAIL='local@easyref', GIT_COMMITTER_NAME='EasyRef', GIT_COMMITTER_EMAIL='local@easyref')
        try:
            self.run('read-tree', old if old else '--empty', env=env)
            candidates = self.run('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0')
            for name in dict.fromkeys(candidates):
                if not name:
                    continue
                path = inside(self.root, name)
                if path.exists() and (path.stat().st_size > 5_000_000 or (path.suffix.lower() not in TEXT_SUFFIXES and path.name != '.gitignore')):
                    continue
                self.run('add', '-A', '--', name, env=env)
            tree = self.run('write-tree', env=env)
            args = ['commit-tree', tree, '-m', message]
            if old:
                args += ['-p', old]
            commit = self.run(*args, env=env)
            self.run('update-ref', 'HEAD', commit, old or '0' * 40)
            # No staged changes existed; update the index to the explicit checkpoint.
            # The working files are untouched. Failed commits never change the real index.
            self.run('read-tree',commit)
            return commit
        finally:
            index.unlink(missing_ok=True)

    def resolve(self, ref):
        if not isinstance(ref, str) or ref.startswith('-') or not re.fullmatch(r'[A-Za-z0-9_./-]+', ref):
            raise ValueError('无效的 Git revision')
        return self.run('rev-parse', '--verify', ref + '^{commit}')

    def diff(self, before=None, after=None):
        if before and after:
            return self.run('diff', self.resolve(before), self.resolve(after), '--')
        head = self.status()['commit']
        return self.run('diff', head, '--') if head else self.run('diff', '--')

    def branch(self, name, ref='HEAD', switch=False):
        if not re.fullmatch(r'(research|submission|revision|codex)/[A-Za-z0-9][A-Za-z0-9._/-]*', name) or '..' in name:
            raise ValueError('分支名称应以 research/、submission/、revision/ 或 codex/ 开头')
        self.run('check-ref-format', '--branch', name)
        commit = self.resolve(ref)
        if switch and self.run('status', '--porcelain'):
            raise ValueError('工作目录或暂存区有修改，请先处理，避免丢失数据')
        if switch:
            self.run('switch', '-c', name, commit)
        else:
            self.run('branch', name, commit)
        return self.status()

    def switch(self, name):
        if self.run('status', '--porcelain'):
            raise ValueError('工作目录或暂存区有修改，不能切换分支')
        if name not in self.status()['branches']:
            raise ValueError('分支不存在')
        self.run('switch', name)
        return self.status()

    def restore_file(self, path, ref):
        target = inside(self.root, path)
        revision = self.resolve(ref)
        content = self.run('show', f'{revision}:{Path(path).as_posix()}', binary=True)
        if target.exists():
            backup = self.root / '.easyref' / 'restore-backups' / uid() / target.name
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(target, backup)
        target.parent.mkdir(parents=True, exist_ok=True)
        self.run('restore','--source='+revision,'--worktree','--',Path(path).as_posix())
        return {'path': path, 'commit': revision}
