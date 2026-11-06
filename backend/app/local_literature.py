import gzip
import json
import re
import sqlite3
import threading
from pathlib import Path
from urllib.parse import urlparse
import requests
from lxml import etree
from .local_store import digest, encode, now, uid, row_decode


class Literature:
    def __init__(self, store):
        self.store = store
        self.workers = {}
        self.lock = threading.Lock()
        self.seed_registry()
        self.store.execute("UPDATE import_jobs SET status='paused' WHERE status='running'")

    def seed_registry(self):
        path = Path(__file__).resolve().parents[1] / 'registry' / 'ccf-2026.json'
        registry = json.loads(path.read_text('utf-8'))
        self.registry_info = {k: v for k, v in registry.items() if k != 'venues'}
        with self.store.transaction() as conn:
            for item in registry['venues']:
                conn.execute('INSERT OR IGNORE INTO venues VALUES(?,?,?,?,?,?,?,?,?)',
                             (item['id'], item['name'], item['abbreviation'], item['rank'], item['discipline'], item['type'], registry['edition'], registry['source_url'], registry['verified_at']))
                for alias in item['aliases']:
                    conn.execute('INSERT OR IGNORE INTO venue_aliases VALUES(?,?)', (item['id'], alias))
                if item['dblp_stream']:
                    old = conn.execute('SELECT venue_id FROM venue_dblp_mappings WHERE stream=?', (item['dblp_stream'],)).fetchone()
                    if old and old[0] != item['id']:
                        canonical = conn.execute('SELECT * FROM venues WHERE id=?',(old[0],)).fetchone()
                        if canonical['name'] != item['name'] or canonical['rank'] != item['rank']:
                            raise ValueError('CCF registry contains an ambiguous stream: ' + item['dblp_stream'])
                        continue
                    conn.execute('INSERT OR IGNORE INTO venue_dblp_mappings VALUES(?,?,?,?,?)',
                                 ('map-' + item['id'], item['id'], item['dblp_stream'], item['mapping_source'], registry['verified_at']))
        self.streams = {v['stream']: v for v in self.store.all('SELECT m.stream,v.* FROM venue_dblp_mappings m JOIN venues v ON v.id=m.venue_id')}

    def classify(self, paper):
        key = paper.get('dblp_key', '')
        stream = '/'.join(key.split('/')[:2])
        explicit = paper.get('streams',[])
        if isinstance(explicit,str): explicit=[explicit]
        venue = next((self.streams[s.removeprefix('streams/')] for s in explicit if s.removeprefix('streams/') in self.streams),None) or self.streams.get(stream)
        if not venue:
            return None
        label = (paper.get('venue_name', '') + ' ' + paper.get('crossref', '')).lower()
        # Match only explicit negative metadata. Unknown remains unknown.
        if re.search(r'\b(companion|findings|demonstrations?|demos?|adjunct|extended abstracts?|short papers?|posters?)\b', label) or re.search(r'(?:workshop|companion|findings)', key.lower()):
            return None
        if re.search(r'\bworkshops?\b',label) and 'workshop' not in venue['name'].lower():
            return None
        paper['venue_id'] = venue['id']
        paper['venue_name'] = paper.get('venue_name') or venue['name']
        paper['publication_type'] = 'journal_article' if venue['type'] == 'Journal' and paper.get('record_type') == 'article' else 'unknown'
        return paper

    def upsert(self, paper, source='ccf', conn=None):
        if source == 'ccf':
            paper = self.classify(dict(paper))
            if not paper:
                return None
        elif source != 'personal':
            raise ValueError('不支持的文献来源')
        if not paper.get('title', '').strip():
            raise ValueError('文献标题为空')
        if conn is None:
            with self.store.transaction() as tx:
                return self.upsert(paper, source, tx)
        doi = paper.get('doi') or None
        if doi:
            doi = re.sub(r'^https?://(?:dx\.)?doi\.org/', '', doi).strip().lower()
            if not re.fullmatch(r'10\.\d{4,9}/\S+', doi):
                raise ValueError('无效的 DOI')
        key = paper.get('dblp_key') or None
        # Separate lookups preserve both unique indexes. An OR with the partial
        # DOI index caused a full papers scan for every record during bulk import.
        existing = conn.execute('SELECT id,source FROM papers WHERE dblp_key=?', (key,)).fetchone() if key else None
        if not existing and doi:
            existing = conn.execute("SELECT id,source FROM papers WHERE doi=? AND doi IS NOT NULL AND doi!=''", (doi,)).fetchone()
        ident = existing['id'] if existing else ('dblp-' + digest(key)[:28] if key else uid())
        # Personal references do not downgrade an already indexed DBLP record.
        if existing and existing['source'] == 'ccf' and source == 'personal':
            return ident
        conn.execute('''INSERT INTO papers(id,dblp_key,title,authors_json,year,doi,dblp_url,venue_id,venue_name,publication_type,source,bibtex,metadata_json,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
            title=excluded.title,authors_json=excluded.authors_json,year=excluded.year,doi=COALESCE(excluded.doi,papers.doi),
            dblp_key=COALESCE(excluded.dblp_key,papers.dblp_key),dblp_url=COALESCE(excluded.dblp_url,papers.dblp_url),
            venue_id=excluded.venue_id,venue_name=excluded.venue_name,publication_type=excluded.publication_type,
            source=excluded.source,bibtex=COALESCE(excluded.bibtex,papers.bibtex),metadata_json=excluded.metadata_json,updated_at=excluded.updated_at''',
            (ident, key, paper['title'], encode(paper.get('authors', [])), paper.get('year'), doi,
             paper.get('dblp_url') or paper.get('url') or ('https://dblp.org/rec/' + key if key else None), paper.get('venue_id'), paper.get('venue_name'),
             paper.get('publication_type', 'unknown'), source, paper.get('bibtex'), encode(paper.get('metadata', {})), now()))
        return ident

    def search(self, args):
        where, params = ['1=1'], []
        if args.get('source', 'ccf') != 'all':
            where.append('p.source=?'); params.append(args.get('source', 'ccf'))
        join = 'LEFT JOIN venues v ON v.id=p.venue_id'
        fields = 'p.*,v.rank,v.discipline,v.type AS venue_type'
        q = args.get('q', '').strip()
        if q:
            tokens = re.findall(r'\w+', q, flags=re.UNICODE)
            if not tokens:
                raise ValueError('请输入可检索的文字')
            where.append('p.rowid IN (SELECT rowid FROM papers_fts WHERE papers_fts MATCH ?)')
            params.append(' AND '.join('"' + t.replace('"', '""') + '"*' for t in tokens[:20]))
        for field, column in [('rank','v.rank'),('venue_id','v.id'),('type','v.type'),('year','p.year')]:
            if args.get(field):
                where.append(column + '=?'); params.append(args[field])
        for key, operator in [('year_from','>='),('year_to','<=')]:
            if args.get(key): where.append('p.year'+operator+'?'); params.append(int(args[key]))
        if args.get('discipline'):
            where.append('EXISTS(SELECT 1 FROM venues alt WHERE alt.name=v.name AND alt.discipline=?)')
            params.append(args['discipline'])
        if args.get('author'):
            where.append('p.authors_json LIKE ?'); params.append('%' + args['author'] + '%')
        if args.get('venue_name'):
            where.append('p.venue_name LIKE ?'); params.append('%' + args['venue_name'] + '%')
        if args.get('project_id'):
            join += ' JOIN paper_library_entries l ON l.paper_id=p.id'
            fields += ',l.pinned,l.archived,l.created_at AS collected_at'
            where.append('l.project_id=? AND l.archived=?')
            params.extend([args['project_id'],1 if str(args.get('archived','0'))=='1' else 0])
        limit = min(100, max(1, int(args.get('limit', 30))))
        offset = max(0, int(args.get('offset', 0)))
        order = {'year':'p.year DESC,p.title', 'title':'p.title', 'oldest':'p.year,p.title','rank':"CASE v.rank WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,p.year DESC,p.title"}.get(args.get('sort'), 'p.year DESC,p.title')
        if args.get('project_id'):
            if args.get('sort')=='added': order='l.created_at DESC,p.title'
            order='l.pinned DESC,'+order
        if args.get('sort_by'):
            columns = {'title': 'p.title COLLATE NOCASE', 'year': 'p.year', 'rank': 'v.rank', 'pdf': "(CASE WHEN COALESCE(p.pdf_path,'')='' THEN 0 ELSE 1 END)"}
            orders, seen = [], set()
            for rule in args['sort_by'].split(','):
                parts = rule.split(':')
                if len(parts) != 2 or parts[0] not in columns or parts[1] not in {'asc', 'desc'} or parts[0] in seen:
                    raise ValueError('无效的文献排序条件')
                field, direction = parts; seen.add(field)
                if field in {'year', 'rank'}: orders.append(columns[field]+' IS NULL ASC')
                orders.append(columns[field]+' '+direction.upper())
            order = ('l.pinned DESC,' if args.get('project_id') else '') + ','.join(orders) + ',p.id'
        clause = ' FROM papers p ' + join + ' WHERE ' + ' AND '.join(where)
        total = self.store.one('SELECT COUNT(*) AS n' + clause, params)['n']
        rows = self.store.all('SELECT '+fields + clause + ' ORDER BY ' + order + ' LIMIT ? OFFSET ?', [*params, limit, offset])
        return {'papers': rows, 'total': total, 'offset': offset, 'limit': limit}

    def online(self, query):
        if not query.strip():
            raise ValueError('请输入 DBLP 查询')
        response = requests.get('https://dblp.org/search/publ/api', params={'q': query, 'format':'json', 'h':100}, timeout=30)
        response.raise_for_status()
        try: payload=response.json()
        except ValueError: raise ValueError('DBLP 在线服务未返回 JSON（可能是网络网关或访问校验页面）。请稍后重试，或使用本地官方 XML 导入。')
        hits = payload.get('result', {}).get('hits', {}).get('hit', [])
        if isinstance(hits, dict): hits = [hits]
        saved = []
        for hit in hits:
            info = hit.get('info', {})
            authors = info.get('authors', {}).get('author', [])
            if not isinstance(authors, list): authors = [authors]
            authors = [a.get('text', '') if isinstance(a, dict) else a for a in authors]
            key = urlparse(info.get('url', '')).path.removeprefix('/rec/').removesuffix('.html')
            ident = self.upsert({'dblp_key':key, 'title':info.get('title',''), 'authors':authors,
                                  'year':int(info['year']) if str(info.get('year','')).isdigit() else None,
                                  'doi':info.get('doi'), 'venue_name':info.get('venue',''),
                                  'streams':info.get('stream',[]),
                                  'metadata':{'dblp_type':info.get('type'),'pages':info.get('pages'),'ee':info.get('ee')},
                                  'record_type':'article' if info.get('type') == 'Journal Articles' else 'inproceedings'})
            if ident: saved.append(ident)
        return {'received':len(hits), 'cached':len(saved), 'ids':saved}

    @staticmethod
    def fingerprint(path):
        stat = path.stat()
        with path.open('rb') as stream:
            first = stream.read(65536)
            stream.seek(max(0, stat.st_size - 65536))
            last = stream.read(65536)
        return digest(encode([str(path), stat.st_size, stat.st_mtime_ns, digest(first), digest(last)]))

    def start_import(self, source_path=None, job_id=None):
        with self.lock:
            if job_id:
                job = self.store.one('SELECT * FROM import_jobs WHERE id=?', (job_id,), True)
                path = Path(job['source_path'])
                if job_id in self.workers and self.workers[job_id][0].is_alive():
                    raise ValueError('导入已经在运行')
                if self.fingerprint(path) != job['fingerprint']:
                    raise ValueError('快照文件已改变，请创建新的增量导入任务')
            else:
                path = Path(source_path).resolve()
                if not path.is_file() or not (path.name.endswith('.xml') or path.name.endswith('.xml.gz')):
                    raise ValueError('请选择已下载的 .xml 或 .xml.gz DBLP 官方快照')
                job_id = uid()
                self.store.execute('INSERT INTO import_jobs(id,source_path,fingerprint,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',
                                   (job_id,str(path),self.fingerprint(path),'pending',now(),now()))
            event = threading.Event()
            worker = threading.Thread(target=self.import_xml, args=(job_id,event), daemon=True)
            self.workers[job_id] = (worker,event)
            worker.start()
            return self.store.one('SELECT * FROM import_jobs WHERE id=?', (job_id,), True)

    def cancel(self, job_id):
        with self.lock:
            if job_id in self.workers: self.workers[job_id][1].set()

    def import_xml(self, job_id, cancel=None):
        cancel = cancel or threading.Event()
        job = self.store.one('SELECT * FROM import_jobs WHERE id=?', (job_id,), True)
        path = Path(job['source_path'])
        counts = [job['processed'], job['imported'], job['skipped']]
        errors, batch = job['errors'], []
        self.store.execute("UPDATE import_jobs SET status='running' WHERE id=?", (job_id,))
        # Keep one worker connection alive so each batch does not close the last
        # WAL connection, discard the page cache and checkpoint the entire file.
        connection=sqlite3.connect(self.store.path,timeout=30)
        connection.row_factory=sqlite3.Row
        connection.execute('PRAGMA foreign_keys=ON')
        connection.execute('PRAGMA busy_timeout=30000')
        connection.execute('PRAGMA cache_size=-32768')

        class LocalDtdOnly(etree.Resolver):
            def resolve(self, url, public_id, context):
                target = Path(url)
                if target.name == 'dblp.dtd' and (path.parent / 'dblp.dtd').exists():
                    return self.resolve_filename(str(path.parent / 'dblp.dtd'), context)
                raise ValueError('仅允许快照同目录的 dblp.dtd；拒绝外部 XML 资源')

        def flush(status):
            nonlocal batch, errors
            with connection as conn:
                for item in batch:
                    try:
                        if self.upsert(item, conn=conn): counts[1] += 1
                        else: counts[2] += 1
                    except Exception as exc:
                        counts[2] += 1
                        entry={'record':item.get('dblp_key'), 'error':str(exc)}
                        errors.append(entry)
                        logs=self.store.root/'import-logs'; logs.mkdir(exist_ok=True)
                        with (logs/(job_id+'.jsonl')).open('a',encoding='utf8') as log: log.write(encode(entry)+'\n')
                        errors=errors[-100:]
                conn.execute('UPDATE import_jobs SET status=?,processed=?,imported=?,skipped=?,errors_json=?,updated_at=? WHERE id=?',
                             (status,*counts,encode(errors[-100:]),now(),job_id))
            batch = []

        try:
            opener = gzip.open if path.suffix == '.gz' else open
            with opener(path, 'rb') as stream:
                context = etree.iterparse(stream, events=('end',), load_dtd=True, resolve_entities=True, no_network=True, huge_tree=False)
                context.resolvers.add(LocalDtdOnly())
                index = 0
                for _, element in context:
                    parent = element.getparent()
                    if parent is None or parent.tag != 'dblp': continue
                    index += 1
                    if index > job['processed']:
                        counts[0] = index
                        if element.tag in {'article','inproceedings'}:
                            def val(tag):
                                node = element.find(tag)
                                return ''.join(node.itertext()).strip() if node is not None else ''
                            ee = [x.text or '' for x in element.findall('ee')]
                            batch.append({'dblp_key':element.get('key',''), 'record_type':element.tag, 'title':val('title'),
                                          'authors':[''.join(x.itertext()) for x in element.findall('author')],
                                          'year':int(val('year')) if val('year').isdigit() else None,
                                          'doi':next((e for e in ee if 'doi.org/' in e), None),
                                          'venue_name':val('booktitle') or val('journal'), 'crossref':val('crossref'),
                                          'streams':[x.text or '' for x in element.findall('stream')],
                                          'metadata':{'record_type':element.tag,'crossref':val('crossref'),'pages':val('pages'),'electronic_editions':ee}})
                        else: counts[2] += 1
                    element.clear()
                    while element.getprevious() is not None: del parent[0]
                    if cancel.is_set(): flush('paused'); return
                    if index > job['processed'] and index % 3000 == 0: flush('running')
                flush('completed')
        except Exception as exc:
            errors.append({'error':str(exc), 'processed':counts[0]})
            flush('failed')
        finally:
            connection.close()

    def bibtex(self, paper_id):
        p = self.store.one('SELECT * FROM papers WHERE id=?', (paper_id,), True)
        if p.get('bibtex'): return p['bibtex']
        def escape(value):
            return str(value).replace('\\','\\textbackslash{}').replace('{','\\{').replace('}','\\}').replace('&','\\&').replace('%','\\%').replace('_','\\_')
        fields = {'title':p['title'], 'author':' and '.join(p['authors']), 'year':p['year'], 'doi':p['doi'], 'url':p['dblp_url']}
        if p['venue_name']: fields['journal' if p['publication_type']=='journal_article' else 'booktitle'] = p['venue_name']
        kind = 'article' if p['publication_type']=='journal_article' else ('inproceedings' if p['dblp_key'] else 'misc')
        return '@' + kind + '{' + p['id'] + ',\n' + ',\n'.join('  '+k+' = {'+escape(v)+'}' for k,v in fields.items() if v) + '\n}\n'
