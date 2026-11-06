from pathlib import Path
from types import SimpleNamespace
from app import local_latex


def test_latex_detection_accepts_runnable_bundle_without_path(monkeypatch,tmp_path):
    inaccessible=tmp_path/'protected'/'tectonic.exe'; cached=tmp_path/'cached'/'tectonic.exe'
    monkeypatch.setattr(local_latex,'candidates',lambda: iter([('protected bundle',inaccessible),('local bundle',cached)]))
    def probe(argv,**kwargs):
        if argv[0]==str(inaccessible): raise PermissionError('App package executable unavailable to this process')
        return SimpleNamespace(returncode=0,stdout='Tectonic 0.16.9\n',stderr='')
    monkeypatch.setattr(local_latex.subprocess,'run',probe)
    local_latex._cache.clear()
    result=local_latex.detect_engine(True)
    assert result['available'] and result['path']==str(cached)
    assert result['checked'][0]['error']
    args=local_latex.compile_command(result,Path('main.tex'),Path('build'))
    assert '--untrusted' in args and '--synctex' in args and '-no-shell-escape' not in args
    local_latex._cache.clear()


def test_latex_missing_engine_is_explicit(monkeypatch):
    monkeypatch.setattr(local_latex,'candidates',lambda: iter([]))
    local_latex._cache.clear()
    result=local_latex.detect_engine(True)
    assert not result['available'] and 'EASYREF_LATEX_BIN' in result['error']
    local_latex._cache.clear()
