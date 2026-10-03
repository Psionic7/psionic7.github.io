"""Create the public repository / enable main/docs Pages using local Git credentials.

No token is stored in files or printed. This is an operator CLI, not browser code.
"""
import argparse
import json
from pathlib import Path
import subprocess
from urllib.error import HTTPError
from urllib.request import Request, urlopen

OWNER = 'Psionic7'
NAME = 'psionic7.github.io'
ROOT = Path(__file__).resolve().parents[1]


def credential():
    result = subprocess.run(['git', '-c', 'safe.directory=' + ROOT.as_posix(), 'credential', 'fill'],
        input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, timeout=30)
    fields = dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    if result.returncode or not fields.get('password'):
        raise RuntimeError('GitHub Git 인증을 먼저 설정해 주세요.')
    return fields['password']


def api(token, path, method='GET', body=None, allow_missing=False):
    request = Request('https://api.github.com' + path,
        data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'Authorization':'Bearer '+token, 'Accept':'application/vnd.github+json',
                 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'home-records-pages',
                 'Content-Type':'application/json'})
    try:
        with urlopen(request,timeout=30) as response:
            content=response.read()
            return json.loads(content) if content else {}
    except HTTPError as exc:
        if exc.code == 404 and allow_missing:
            return None
        raise RuntimeError(f'GitHub API 요청 실패: HTTP {exc.code}, {method} {path}') from None


def run(action):
    token=credential()
    repository='/repos/'+OWNER+'/'+NAME
    if action == 'create':
        found=api(token,repository,allow_missing=True)
        if found:
            raise RuntimeError('저장소가 이미 존재합니다. 새 저장소 생성은 수행하지 않았습니다.')
        result=api(token,'/user/repos','POST',{'name':NAME,'private':False,'auto_init':False,
            'description':'집의 기록: React apartment transaction explorer. Local-only data collection, static GitHub Pages publishing.'})
        print(json.dumps({'url':result['html_url'],'private':result['private'],'default_branch':result['default_branch']}))
    elif action == 'enable':
        found=api(token,repository+'/pages',allow_missing=True)
        settings={'build_type':'legacy','source':{'branch':'main','path':'/docs'}}
        result=api(token,repository+'/pages','PUT' if found else 'POST',settings)
        print(json.dumps({'url':result.get('html_url','https://psionic7.github.io/'),
                          'source':result.get('source',settings['source']),'status':result.get('status')}))
    elif action == 'status':
        result=api(token,repository+'/pages')
        build=api(token,repository+'/pages/builds/latest',allow_missing=True)
        print(json.dumps({'url':result['html_url'],'status':result['status'],'source':result['source'],
                          'build_status':build.get('status') if build else None,
                          'error':build.get('error') if build else None}))
    else:
        result=api(token,repository)
        print(json.dumps({'url':result['html_url'],'private':result['private'],'default_branch':result['default_branch']}))


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['create','enable','status','info'])
    try:
        run(parser.parse_args().action)
    except RuntimeError as exc:
        parser.exit(1,str(exc)+'\n')
