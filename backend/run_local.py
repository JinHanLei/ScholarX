"""Single-process local server. No Docker, Supabase or API key required."""
import argparse
import os
from app import create_app

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--port',type=int,default=5000)
    parser.add_argument('--data-dir')
    args=parser.parse_args()
    os.environ.setdefault('EASYREF_API_BASE',f'http://127.0.0.1:{args.port}/api')
    app=create_app({'DATA_DIR':args.data_dir})
    app.run(host='127.0.0.1',port=args.port,threaded=True,use_reloader=False)
