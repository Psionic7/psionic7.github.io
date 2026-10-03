"""Fail publication if private artifacts, credentials, or an inconsistent snapshot appear."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
from export_data import secret_values, checked_bytes

ROOT = Path(__file__).resolve().parents[1]


def check(root=ROOT, secrets_file=None):
    root = Path(root).resolve()
    secrets = secret_values(secrets_file)
    if (root / '.git').exists():
        git = ['git', '-c', 'safe.directory=' + root.as_posix(), '-C', str(root)]
        index = subprocess.run(git + ['ls-files', '-z'], capture_output=True, check=True).stdout
        for encoded in index.split(b'\0'):
            if not encoded:
                continue
            name = encoded.decode('utf-8')
            path = Path(name)
            if path.name.startswith('.env') or path.name in {'collection_regions.json', 'my_real_estate.sqlite3', 'secrets.toml'}:
                raise ValueError('Git 인덱스에 비공개 파일이 있습니다.')
            checked_bytes(subprocess.run(git + ['show', ':' + name], capture_output=True, check=True).stdout, secrets)
    count = 0
    for path in root.rglob('*'):
        relative = path.relative_to(root)
        if any(part in {'node_modules', '.git', '.vite', '__pycache__', 'coverage'} for part in relative.parts):
            continue
        if not path.is_file():
            continue
        if path.name.startswith('.env') or path.name in {'collection_regions.json', 'my_real_estate.sqlite3', 'secrets.toml'}:
            raise ValueError(f'비공개 파일 발견: {relative}')
        checked_bytes(path.read_bytes(), secrets)
        if path.stat().st_size > 95 * 1024 * 1024:
            raise ValueError(f'GitHub 파일 크기 제한 초과: {relative}')
        count += 1
    for folder in (root / 'public' / 'data', root / 'docs' / 'data'):
        if not folder.exists():
            continue
        manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
        favorites = manifest.get('favorite_region_ids', [])
        known_ids = {region['region_id'] for region in manifest['regions']}
        if (not isinstance(favorites, list) or any(not isinstance(value, str) or value not in known_ids for value in favorites)
                or len(set(favorites)) != len(favorites) or {'suji', 'gwanggyo', 'bundang'} & set(favorites)):
            raise ValueError('공개 즐겨찾기 목록이 올바르지 않습니다.')
        allowed = {'manifest.json', 'public.sqlite3'} | {item['file'] for item in manifest['districts'].values()}
        if any(path.name not in allowed for path in folder.iterdir()):
            raise ValueError('공개 데이터 폴더에 허용되지 않은 파일이 있습니다.')
        total = 0
        for code, district in manifest['districts'].items():
            if not re.fullmatch(r'trades-\d{5}-[a-f0-9]{12}\.json', district['file']):
                raise ValueError('잘못된 데이터 파일 경로')
            content = (folder / district['file']).read_bytes()
            if hashlib.sha256(content).hexdigest() != district['sha256']:
                raise ValueError('데이터 파일 체크섬 불일치')
            rows = json.loads(content)
            if len(rows) != district['count'] or any(row['region_code'] != code for row in rows):
                raise ValueError('지역별 데이터 건수 불일치')
            total += len(rows)
        with sqlite3.connect((folder / 'public.sqlite3').as_uri() + '?mode=ro', uri=True) as conn:
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if tables != {'trades', 'regions', 'metadata'}:
                raise ValueError('공개 DB에 허용되지 않은 테이블이 있습니다.')
            if total != manifest['count'] or total != conn.execute('SELECT count(*) FROM trades').fetchone()[0]:
                raise ValueError('JSON / SQLite 건수 불일치')
            if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('공개 DB 무결성 실패')
    if (root / 'docs' / 'index.html').exists():
        if not (root / 'docs' / '.nojekyll').exists():
            raise ValueError('Pages .nojekyll 파일이 없습니다.')
        if (root / 'public' / 'data' / 'manifest.json').read_bytes() != (root / 'docs' / 'data' / 'manifest.json').read_bytes():
            raise ValueError('데이터를 내보낸 뒤 정적 빌드를 다시 실행해 주세요.')
    return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--secrets-file', type=Path)
    args = parser.parse_args()
    try:
        print(f'공개 파일 검증 완료: {check(secrets_file=args.secrets_file)}개 파일')
    except (ValueError, OSError, sqlite3.Error) as exc:
        print(f'공개 파일 검증 실패: {exc}', file=sys.stderr)
        sys.exit(1)
