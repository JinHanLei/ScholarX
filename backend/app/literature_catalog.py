"""Read the shared DBLP catalog over its API, keeping project writes local."""
import json
import os
import threading
from collections import OrderedDict
from urllib.parse import urlsplit

import requests
from flask import jsonify, request
from .literature_assist import existing_reference
from .local_store import now, uid


class LiteratureCatalog:
    def __init__(self, store, literature):
        self.store = store
        self.literature = literature
        self.candidates = OrderedDict()
        self.lock = threading.Lock()

    def api_url(self):
        value = os.getenv('EASYREF_CATALOG_API', '')
        path = self.store.root / 'literature-catalog.json'
        if not value and path.exists():
            try:
                value = json.loads(path.read_text('utf-8'))['api_url']
            except (OSError, ValueError, KeyError, TypeError):
                raise ValueError('文献数据库连接配置无效。') from None
        if not value:
            return None
        if not isinstance(value, str):
            raise ValueError('文献数据库地址无效。')
        url = urlsplit(value)
        if (url.scheme not in {'http', 'https'} or url.hostname not in {'localhost', '127.0.0.1', '::1'}
                or url.username or url.password or url.query or url.fragment or url.path.rstrip('/') != '/api'):
            raise ValueError('文献数据库须使用本机 EasyRef 服务的 /api 地址。')
        return value.rstrip('/')

    def search(self, args):
        params = {key: args[key] for key in ('q', 'rank', 'venue_id', 'venue_name', 'type', 'year', 'year_from',
                  'year_to', 'author', 'discipline', 'sort', 'offset', 'limit') if key in args}
        local = self.literature.search({**params, 'source': 'all'})
        selected_ids = set()
        local['selected_total'] = 0
        if args.get('project_id'):
            pid = args['project_id']
            self.store.project(pid)
            selected_ids = {row['paper_id'] for row in self.store.all(
                'SELECT paper_id FROM paper_library_entries WHERE project_id=? AND archived=0', (pid,))}
            if selected_ids:
                local['selected_total'] = self.literature.search({**params, 'source': 'all',
                    'project_id': pid, 'archived': '0', 'offset': 0, 'limit': 1})['total']
        for paper in local['papers']:
            paper['in_library'] = paper['id'] in selected_ids
        base = self.api_url()
        if not base:
            return local
        try:
            response = requests.get(base + '/papers', params={**params, 'source': 'ccf'}, timeout=(3, 30), allow_redirects=False)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data.get('papers'), list) or not isinstance(data.get('total'), int):
                raise ValueError()
        except (requests.RequestException, ValueError, TypeError, AttributeError):
            raise ValueError('无法查询 DBLP 文献数据库，请确认主库服务已启动后重试。') from None
        papers = []
        for row in data['papers']:
            paper = {key: row.get(key) for key in ('title', 'authors', 'year', 'doi', 'venue_name', 'venue_id',
                     'dblp_key', 'dblp_url', 'publication_type', 'bibtex', 'rank', 'venue_type')}
            if not isinstance(row.get('id'), str) or not isinstance(paper['title'], str) or not isinstance(paper['authors'], list):
                raise ValueError('文献数据库返回了无效记录。')
            paper.update(id='catalog:' + row['id'], catalog_id=row['id'], from_catalog=True)
            paper['publication_type'] = paper['publication_type'] or 'unknown'
            metadata = row.get('metadata') or {}
            paper['metadata'] = {key: metadata[key] for key in ('ee', 'source_url') if key in metadata}
            with self.lock:
                self.candidates[(base, row['id'])] = paper
                self.candidates.move_to_end((base, row['id']))
                while len(self.candidates) > 2000:
                    self.candidates.popitem(last=False)
            existing = None
            if selected_ids:
                if paper.get('dblp_key'):
                    existing = self.store.one('SELECT id FROM papers WHERE dblp_key=?', (paper['dblp_key'],))
                if not existing:
                    existing = existing_reference(self.store, {**paper, 'url': paper.get('dblp_url') or ''})
            papers.append({**paper, 'in_library': bool(existing and existing['id'] in selected_ids)})
        return {**local, 'catalog': {'papers': papers, 'total': data['total'], 'offset': local['offset'], 'limit': local['limit']}}

    def collect(self, pid, ident):
        self.store.project(pid)
        with self.lock:
            paper = self.candidates.get((self.api_url(), ident))
        if not paper:
            raise ValueError('这条数据库检索结果已过期，请重新检索后加入自选。')
        existing = existing_reference(self.store, {**paper, 'url': paper.get('dblp_url') or ''})
        local_id = existing['id'] if existing else self.literature.upsert({**paper, 'metadata': {
            **paper['metadata'], 'discovery': 'local_catalog', 'catalog_id': ident,
        }}, 'personal')
        self.store.execute('INSERT INTO paper_library_entries(id,paper_id,project_id,created_at) VALUES(?,?,?,?) '
                           'ON CONFLICT(paper_id,project_id) DO UPDATE SET archived=0', (uid(), local_id, pid, now()))
        return local_id


def register_catalog(api, store, literature):
    catalog = LiteratureCatalog(store, literature)

    @api.get('/literature/search')
    def search():
        return jsonify(catalog.search(request.args))

    @api.post('/projects/<pid>/literature/catalog/collect')
    def collect(pid):
        ident = request.get_json().get('catalog_id')
        if not isinstance(ident, str):
            raise ValueError('文献标识无效。')
        return jsonify(id=catalog.collect(pid, ident))
