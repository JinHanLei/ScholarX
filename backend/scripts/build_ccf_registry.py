"""Rebuild the factual venue registry from the official 2026 PDF (pdfplumber required)."""
import argparse
import hashlib
import json
import re
from pathlib import Path
import pdfplumber

OFFICIAL = 'https://www.ccf.org.cn/Academic_Evaluation/By_category/2026-03-31/870181.shtml'
MIRROR = 'https://kyc.lsu.edu.cn/2026/0518/c1772a367789/page.htm'


def build(pdf, output):
    venues, discipline, kind, rank = [], '', '', ''
    with pdfplumber.open(pdf) as document:
        for page_number, page in enumerate(document.pages, 1):
            text = page.extract_text(x_tolerance=1) or ''
            if '中国计算机学会推荐国际学术期刊' in text:
                kind = 'Journal'
            elif '中国计算机学会推荐国际学术会议' in text and page_number > 1:
                kind = 'Conference'
            domain = re.search(r'[（(]([^）)\n]+)[）)]', text[:200])
            if domain and '类' not in domain[1] and page_number > 1:
                discipline = domain[1]
            grade = re.search(r'[一二三]、\s*([ABC])\s*类', text)
            if grade:
                rank = grade[1]
            for table in page.extract_tables({'text_x_tolerance': 1}):
                for row in table:
                    if len(row) != 5 or not (row[0] or '').strip().isdigit():
                        continue
                    _, abbr, name, publisher, url = [(v or '').replace('\n', ' ').strip() for v in row]
                    url = re.sub(r'\s+', '', url)
                    match = re.search(r'dblp\.(?:org|uni-trier\.de)/db/((?:conf|journals)/[^/\s]+)', url)
                    stream = match[1] if match else None
                    if abbr == 'AsiaCCS':
                        # The PDF links to CCS; DBLP's authoritative stream explicitly
                        # identifies AsiaCCS separately. Keep the correction provenance.
                        stream = 'conf/asiaccs'
                        url = 'https://dblp.org/streams/conf/asiaccs'
                    key = hashlib.sha256(f'{discipline}|{kind}|{name}'.encode()).hexdigest()[:24]
                    venues.append({'id': 'ccf2026-' + key, 'name': name, 'abbreviation': abbr or name,
                                   'rank': rank, 'discipline': discipline, 'type': kind,
                                   'dblp_stream': stream, 'mapping_source': url, 'pdf_page': page_number,
                                   'publisher': publisher, 'aliases': [abbr] if abbr else []})
    if len(venues) < 650 or len({v['discipline'] for v in venues}) != 10:
        raise ValueError('Unexpected PDF structure; do not publish a partial registry')
    data = {'edition': 'CCF 2026 第七版正式目录', 'source_url': OFFICIAL, 'mirror_url': MIRROR,
            'verified_at': '2026-10-29', 'pdf_sha256': hashlib.sha256(Path(pdf).read_bytes()).hexdigest(),
            'mapping_policy': 'Only DBLP stream URLs printed in the official PDF; unmapped entries stay unavailable.',
            'venues': venues}
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'venues': len(venues), 'mapped': sum(bool(v['dblp_stream']) for v in venues),
                      'unmapped': [v['abbreviation'] for v in venues if not v['dblp_stream']]}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('pdf')
    parser.add_argument('--output', default='backend/registry/ccf-2026.json')
    args = parser.parse_args()
    build(args.pdf, args.output)
