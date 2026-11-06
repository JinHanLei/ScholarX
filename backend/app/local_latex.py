"""Discover runnable local TeX engines, including Codex's bundled Tectonic."""
import os
import re
import shutil
import subprocess
import time
from pathlib import Path

_cache={}


def candidates():
    for variable in ['EASYREF_LATEX_BIN','CODEX_TECTONIC_PATH']:
        value=os.getenv(variable)
        if value: yield variable,Path(value).expanduser()
    for name in ['pdflatex','xelatex','lualatex','tectonic']:
        value=shutil.which(name)
        if value: yield 'PATH',Path(value)
    if os.name=='nt':
        home=Path.home()
        for root in [Path('C:/texlive'),Path('D:/texlive')]:
            for name in ['pdflatex.exe','xelatex.exe']:
                for path in root.glob('*/bin/windows/'+name): yield 'TeX Live',path
        for root in [Path(os.getenv('LOCALAPPDATA',str(home/'AppData'/'Local')))/'Programs'/'MiKTeX',Path(os.getenv('ProgramFiles','C:/Program Files'))/'MiKTeX']:
            for name in ['pdflatex.exe','xelatex.exe']:
                path=root/'miktex'/'bin'/'x64'/name
                if path.is_file(): yield 'MiKTeX',path
        apps=Path(os.getenv('ProgramFiles','C:/Program Files'))/'WindowsApps'
        packages=sorted(apps.glob('OpenAI.Codex_*'),key=lambda p:tuple(int(n) for n in re.findall(r'\d+',p.name.split('_')[1])),reverse=True)
        for package in packages:
            for suffix in ['app/resources/tectonic/tectonic.exe','app/resources/plugins/openai-bundled/plugins/latex/bin/tectonic.exe']:
                path=package/suffix
                if path.is_file(): yield 'Codex app bundle',path
        codex_root=Path(os.getenv('CODEX_HOME',str(home/'.codex')))
        for pattern in ['plugins/cache/*/latex/*/bin/tectonic.exe','.tmp/bundled-marketplaces/*/plugins/latex/bin/tectonic.exe']:
            for path in codex_root.glob(pattern): yield 'Codex local bundle cache',path


def detect_engine(refresh=False):
    key=tuple(os.getenv(k,'') for k in ['EASYREF_LATEX_BIN','CODEX_TECTONIC_PATH','CODEX_HOME','PATH'])
    cached=_cache.get(key)
    if cached and not refresh and time.monotonic()-cached[0]<60: return cached[1]
    checked=[]; seen=set()
    for source,path in candidates():
        path=path.resolve()
        if str(path) in seen: continue
        seen.add(str(path))
        if path.stem.lower() not in {'pdflatex','xelatex','lualatex','tectonic'}:
            checked.append({'path':str(path),'source':source,'error':'不支持的 TeX 引擎名称'}); continue
        try:
            probe=subprocess.run([str(path),'--version'],capture_output=True,text=True,encoding='utf8',errors='replace',timeout=5,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            if probe.returncode: raise ValueError('Version probe exit '+str(probe.returncode))
            result={'available':True,'engine':path.stem.lower(),'path':str(path),'source':source,'version':(probe.stdout or probe.stderr).splitlines()[0],'checked':checked}
            _cache[key]=(time.monotonic(),result)
            return result
        except (OSError,ValueError,subprocess.TimeoutExpired) as exc:
            checked.append({'path':str(path),'source':source,'error':str(exc)})
    result={'available':False,'checked':checked,'error':'没有找到当前进程可执行的 TeX 引擎。可设置 EASYREF_LATEX_BIN 指向 pdflatex、xelatex、lualatex 或 tectonic。发现但无法启动的路径见检测详情。'}
    _cache[key]=(time.monotonic(),result)
    return result


def compile_command(engine,target,output):
    if engine['engine']=='tectonic':
        return [engine['path'],'--untrusted','--keep-logs','--keep-intermediates','--synctex','--outdir',str(output),str(target)]
    return [engine['path'],'-no-shell-escape','-interaction=nonstopmode','-halt-on-error','-synctex=1','-output-directory='+str(output),target.name]
