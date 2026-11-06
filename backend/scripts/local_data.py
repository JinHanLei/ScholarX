"""Offline local backup/restore. Restore only to an empty destination; originals never changed."""
import argparse
import json
import shutil
import sqlite3
import sys
import zipfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.local_store import Store, encode, inside, uid


def export_data(data_dir,destination):
    store=Store(data_dir); destination=Path(destination).resolve()
    if destination.exists(): raise ValueError('导出目标已存在，不覆盖')
    backup=store.backup()
    manifest={'format':'easyref-local-backup','projects':store.all('SELECT * FROM projects'),'original_data_root':str(store.root)}
    for project in manifest['projects']:
        if (Path(project['root_path'])/'.git').is_file():
            raise ValueError('项目使用外部 Git worktree；请先独立克隆仓库再完整备份，避免遗漏外部 Git 历史')
    with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(backup,'data/easyref.sqlite3')
        archive.writestr('manifest.json',encode(manifest))
        for folder in ['pdfs','snapshots']:
            source=store.root/folder
            if source.exists():
                for path in source.rglob('*'):
                    if path.is_file() and not path.is_symlink(): archive.write(path,'data/'+path.relative_to(store.root).as_posix())
        for project in manifest['projects']:
            root=Path(project['root_path'])
            for path in root.rglob('*'):
                if path.resolve()==destination or (store.root.is_relative_to(root) and path.resolve().is_relative_to(store.root)): continue
                # Git history is included. Runtime dependencies/caches are not.
                if path.is_file() and not path.is_symlink() and not any(part in {'.venv','node_modules','__pycache__'} for part in path.relative_to(root).parts):
                    archive.write(path,'projects/'+project['id']+'/'+path.relative_to(root).as_posix())
    return destination


def restore_data(archive_path,destination):
    destination=Path(destination).resolve()
    if destination.exists() and any(destination.iterdir()): raise ValueError('恢复目录必须为空，原数据不会被覆盖')
    destination.mkdir(parents=True,exist_ok=True)
    # Validate every archive entry before any extraction, including .git (valid backup).
    with zipfile.ZipFile(archive_path) as archive:
        if sum(i.file_size for i in archive.infolist())>20_000_000_000: raise ValueError('备份超过 20 GB，请手动恢复')
        manifest=json.loads(archive.read('manifest.json'))
        if manifest.get('format')!='easyref-local-backup': raise ValueError('不是 EasyRef 完整备份')
        entries=[]
        for item in archive.infolist():
            if item.is_dir() or item.filename=='manifest.json': continue
            relative=item.filename.removeprefix('data/') if item.filename.startswith('data/') else item.filename
            target=(destination/relative).resolve()
            if not target.is_relative_to(destination) or target==destination or ((item.external_attr>>16)&0o170000)==0o120000: raise ValueError('备份包含不安全路径')
            entries.append((item,target))
        for item,target in entries:
            target.parent.mkdir(parents=True,exist_ok=True); target.write_bytes(archive.read(item))
    store=Store(destination)
    replacements={manifest['original_data_root']:str(destination)}
    replacements.update({p['root_path']:str(destination/'projects'/p['id']) for p in manifest['projects']})
    def remap(value):
        if isinstance(value,str):
            for old,new in sorted(replacements.items(),key=lambda x:len(x[0]),reverse=True): value=value.replace(old,new)
        elif isinstance(value,list): return [remap(v) for v in value]
        elif isinstance(value,dict): return {k:remap(v) for k,v in value.items()}
        return value
    with store.transaction() as db:
        # Immutable snapshots retain their original manifests and hashes; only storage paths
        # are remapped during offline restore, never historical content.
        db.execute('DROP TRIGGER immutable_submission_update')
        for table,columns in {'projects':['root_path'],'papers':['pdf_path'],'experiments':['cwd','log_path','metrics_path','command_json'],
                              'experiment_artifacts':['path'],'submission_attempts':['snapshot_path'],'import_jobs':['source_path']}.items():
            for row in db.execute('SELECT * FROM '+table).fetchall():
                values=[]
                for column in columns:
                    value=row[column]
                    values.append(encode(remap(json.loads(value))) if column.endswith('_json') else remap(value))
                db.execute('UPDATE '+table+' SET '+','.join(c+'=?' for c in columns)+' WHERE id=?',(*values,row['id']))
        db.execute("CREATE TRIGGER immutable_submission_update BEFORE UPDATE ON submission_attempts BEGIN SELECT RAISE(ABORT,'Submission snapshots are immutable'); END")
        if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok' or db.execute('PRAGMA foreign_key_check').fetchall(): raise ValueError('恢复后的数据库完整性检查失败')
    return destination


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('action',choices=['export','restore']); parser.add_argument('source'); parser.add_argument('destination'); args=parser.parse_args()
    print(export_data(args.source,args.destination) if args.action=='export' else restore_data(args.source,args.destination))
