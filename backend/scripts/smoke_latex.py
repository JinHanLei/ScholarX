"""Real local-engine integration check, isolated from research data."""
import io
import json
import sys
import zipfile
from pathlib import Path
from pypdf import PdfReader
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app import create_app


def main():
    directory=Path(__file__).resolve().parents[1]/'data'/'latex-smoke'
    app=create_app({'TESTING':True,'DATA_DIR':directory}); client=app.test_client()
    project=client.post('/api/projects',json={'name':'LATEX INTEGRATION TEST - not research'}).json['project']
    content=io.BytesIO()
    with zipfile.ZipFile(content,'w') as archive:
        archive.writestr('main.tex',r'''\documentclass{article}
\usepackage{amsmath}
\begin{document}
\title{EasyRef Local Compilation Acceptance}
\author{TEST DATA}
\maketitle
\input{sections/intro}
See Section~\ref{sec:test}. This PDF is a software test, not a research result.
\end{document}
''')
        archive.writestr('sections/intro.tex',r'''\section{Verified local compilation}\label{sec:test}
This text comes from a second source file in the imported project.
\begin{equation} \sum_{i=1}^{3} i = 6. \end{equation}
''')
    content.seek(0)
    imported=client.post('/api/projects/'+project['id']+'/paper/import',data={'file':(content,'test-project.zip')},content_type='multipart/form-data')
    if imported.status_code!=201: raise RuntimeError(imported.json)
    document=imported.json
    result=client.post('/api/projects/'+project['id']+'/paper/compile',json={'path':document['import_directory']+'/main.tex'}).json
    report={'test_data':True,'project_id':project['id'],**result}
    if result.get('pdf'):
        pdf=Path(project['root_path'])/result['pdf']; reader=PdfReader(pdf)
        report.update(pdf_absolute=str(pdf),pages=len(reader.pages),text='\n'.join(page.extract_text() for page in reader.pages))
    output=directory.parent/'latex-smoke-result.json'; output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({k:v for k,v in report.items() if k not in {'log','text'}},ensure_ascii=False,indent=2))
    assert result['status']=='completed',result
    assert report['pages']>=1 and 'second source file' in report['text']
    assert result['synctex_available']
    print('LATEX_ACCEPTANCE_PASS')


if __name__=='__main__': main()
