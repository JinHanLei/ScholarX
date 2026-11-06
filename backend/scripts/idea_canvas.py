"""Control the live Idea canvas from the user's Codex chat (no embedded chat required)."""
import argparse
import json
import os
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from urllib.parse import urlparse


def main(argv=None):
    if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-base', default=os.getenv('EASYREF_API_BASE', 'http://127.0.0.1:5000/api'))
    sub = parser.add_subparsers(dest='action', required=True)
    sub.add_parser('context')
    for name in ('get', 'create', 'save', 'versions'):
        command = sub.add_parser(name)
        command.add_argument('--project', required=True)
        if name in {'get', 'save'}: command.add_argument('--idea', required=True)
        if name == 'create': command.add_argument('--name', required=True)
        if name == 'save':
            command.add_argument('--file', required=True)
            command.add_argument('--expected-revision', type=int, required=True)
            command.add_argument('--reason', required=True)
    args = parser.parse_args(argv)
    parsed = urlparse(args.api_base)
    if parsed.scheme != 'http' or parsed.hostname not in {'localhost', '127.0.0.1', '::1'} or parsed.username or parsed.password:
        parser.error('Only a local EasyRef API is supported')
    method, data = 'GET', None
    if args.action == 'context': route = '/idea-context'
    elif args.action == 'versions': route = f'/projects/{args.project}/idea-versions'
    elif args.action == 'create':
        route = f'/projects/{args.project}/ideas'; method = 'POST'; data = {'name': args.name}
    else:
        route = f'/projects/{args.project}/ideas/{args.idea}'
        if args.action == 'save':
            method = 'PUT'
            data = {'document': json.loads(Path(args.file).read_text('utf-8-sig')), 'expected_revision': args.expected_revision, 'purpose': args.reason}
    try:
        request = Request(args.api_base.rstrip('/') + route, data=json.dumps(data).encode('utf8') if data is not None else None, method=method, headers={'Content-Type': 'application/json'})
        with urlopen(request, timeout=30) as response: result = json.load(response)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except HTTPError as exc:
        print(exc.read().decode('utf8'), file=sys.stderr); return 1


if __name__ == '__main__': raise SystemExit(main())
