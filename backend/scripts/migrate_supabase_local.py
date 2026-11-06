"""Optional, read-only Supabase REST import. Never writes to or deletes the old server.
Supply SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the process environment.
Legacy paper metadata is imported into PERSONAL references, not the verified CCF index.
"""
import argparse
import os
import sys
from pathlib import Path
import requests
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.local_store import Store
from app.local_literature import Literature


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--data-dir',required=True); parser.add_argument('--limit',type=int,default=1000); args=parser.parse_args()
    url=os.getenv('SUPABASE_URL','').rstrip('/'); key=os.getenv('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key: raise SystemExit('请通过环境变量提供旧 Supabase URL 和只读访问凭据；本工具不会打印凭据')
    literature=Literature(Store(args.data_dir)); count=0
    with requests.Session() as session:
        session.headers.update({'apikey':key,'Authorization':'Bearer '+key})
        for offset in range(0,args.limit,500):
            response=session.get(url+'/rest/v1/papers',params={'select':'*','order':'id','offset':offset,'limit':min(500,args.limit-offset)},timeout=30)
            if response.status_code!=200: raise SystemExit('旧数据读取失败，HTTP '+str(response.status_code)+'；原数据未修改')
            rows=response.json()
            for row in rows:
                authors=row.get('authors') or []
                if isinstance(authors,str): authors=[authors]
                literature.upsert({'title':row.get('title',''),'authors':authors,'year':row.get('year'),
                                   'doi':row.get('doi'),'dblp_key':row.get('dblp_key'),'metadata':{'legacy_id':row.get('id'),'migration_source':'supabase_read_only'}},source='personal')
                count+=1
            print('Imported personal references:',count,flush=True)
            if len(rows)<500: break
    print('Done. Original Supabase data was not modified. PDF/storage and library relationships require a separate export.')


if __name__=='__main__': main()
