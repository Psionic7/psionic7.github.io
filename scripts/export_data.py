"""Export an allowlisted public SQLite snapshot into static, browser-readable files.

No API access, credentials, collector history, or saved collection targets are exported.
Run after generating public.sqlite3 with the private, loopback-only collector.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from contextlib import closing
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
TRADE_COLUMNS = ('id', 'region_code', 'deal_month', 'deal_date', 'apartment', 'dong',
                 'jibun', 'price_man', 'area_m2', 'floor', 'build_year', 'cancelled', 'raw_json')
REGION_COLUMNS = ('region_id', 'label', 'region_code', 'region_name', 'dongs_json', 'latitude', 'longitude')
SCHEMA = '''
CREATE TABLE trades (id INTEGER PRIMARY KEY, region_code TEXT NOT NULL, deal_month TEXT NOT NULL,
deal_date TEXT NOT NULL, apartment TEXT NOT NULL, dong TEXT NOT NULL, jibun TEXT NOT NULL,
price_man INTEGER NOT NULL, area_m2 REAL NOT NULL, floor INTEGER, build_year INTEGER,
cancelled INTEGER NOT NULL, raw_json TEXT NOT NULL);
CREATE INDEX trades_region_month ON trades(region_code, deal_month);
CREATE TABLE regions (region_id TEXT PRIMARY KEY, label TEXT NOT NULL UNIQUE, region_code TEXT NOT NULL,
region_name TEXT NOT NULL, dongs_json TEXT NOT NULL, latitude REAL, longitude REAL);
CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
'''


def secret_values(path=None):
    values = []
    for name, value in os.environ.items():
        if re.search(r'(SERVICE_KEY|API_KEY|TOKEN|SECRET|PASSWORD)$', name) and len(value) >= 12:
            values.append(value.encode())
    if path and Path(path).exists():
        for line in Path(path).read_text(encoding='utf-8-sig').splitlines():
            if line.strip() and not line.lstrip().startswith('#') and '=' in line:
                value = line.split('=', 1)[1].strip().strip('\"\'')
                if len(value) >= 12:
                    values.append(value.encode())
    return values


def checked_bytes(value, secrets):
    if any(secret in value for secret in secrets):
        raise ValueError('공개 파일에 비밀 값이 포함되어 내보내기를 중단했습니다.')
    if re.search(rb'(?i)(?:serviceKey|MOLIT_SERVICE_KEY)\s*[=:]\s*[\"\']?[a-z0-9%]{16,}', value):
        raise ValueError('공개 파일에 API 인증 값이 포함되어 있습니다.')
    return value


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def atomic_write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix='.export-', dir=path.parent)
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if Path(temporary).exists():
            Path(temporary).unlink()


def export(source, target=ROOT / 'public' / 'data', secrets_file=None):
    source, target = Path(source).resolve(), Path(target).resolve()
    if not source.is_file():
        raise ValueError('공개 SQLite 파일을 먼저 생성해 주세요.')
    if source == target / 'public.sqlite3':
        raise ValueError('원본 파일과 내보내기 경로가 같습니다.')
    secrets = secret_values(secrets_file)
    connection = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute('BEGIN')
        if connection.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('SQLite 무결성 확인에 실패했습니다.')
        # Explicit columns and new database: never copy private tables or metadata.
        trades = [dict(row) for row in connection.execute(
            'SELECT ' + ','.join(TRADE_COLUMNS) + ' FROM trades ORDER BY deal_date DESC,id DESC')]
        regions = [dict(row) for row in connection.execute(
            'SELECT ' + ','.join(REGION_COLUMNS) + ' FROM regions ORDER BY rowid')]
        published = connection.execute("SELECT value FROM metadata WHERE key='published_at'").fetchone()
    finally:
        connection.close()
    published_at = published[0] if published else datetime.now(timezone.utc).isoformat()
    grouped = {}
    for row in trades:
        if not re.fullmatch(r'\d{5}', row['region_code']):
            raise ValueError('올바르지 않은 시군구 코드입니다.')
        raw = json.loads(row['raw_json'])
        if not isinstance(raw, dict) or any(not isinstance(v, str) for v in raw.values()):
            raise ValueError('API 원천 필드는 문자열이어야 합니다.')
        grouped.setdefault(row['region_code'], []).append({
            **{key: row[key] for key in TRADE_COLUMNS if key != 'raw_json'}, 'raw': raw})
    catalog = [{**{k: v for k, v in row.items() if k != 'dongs_json'},
                'dongs': json.loads(row['dongs_json'])} for row in regions]
    payloads, districts = {}, {}
    for code, rows in sorted(grouped.items()):
        content = checked_bytes(json_bytes(rows), secrets)
        digest = hashlib.sha256(content).hexdigest()
        filename = f'trades-{code}-{digest[:12]}.json'
        payloads[filename] = content
        months = sorted({row['deal_month'] for row in rows})
        districts[code] = {'file': filename, 'count': len(rows), 'months': months,
                           'sha256': digest, 'dongs': sorted({row['dong'] for row in rows})}
    manifest = {'version': 1, 'published_at': published_at,
                'exported_at': datetime.now(timezone.utc).isoformat(), 'count': len(trades),
                'regions': catalog, 'districts': districts,
                'months': sorted({row['deal_month'] for row in trades}),
                'source': '국토교통부 아파트 매매 실거래가', 'boundary_catalog_date': '2023-07-29'}
    manifest_content = checked_bytes(json_bytes(manifest), secrets)
    target.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix='.snapshot-', suffix='.sqlite3', dir=target)
    os.close(handle)
    try:
        with closing(sqlite3.connect(temporary)) as public:
            public.executescript(SCHEMA)
            public.executemany('INSERT INTO trades VALUES (' + ','.join('?' for _ in TRADE_COLUMNS) + ')',
                               [tuple(row[k] for k in TRADE_COLUMNS) for row in trades])
            public.executemany('INSERT INTO regions VALUES (?,?,?,?,?,?,?)',
                               [tuple(row[k] for k in REGION_COLUMNS) for row in regions])
            public.execute('INSERT INTO metadata VALUES (?,?)', ('published_at', published_at))
            public.commit()
            if public.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('공개 DB 무결성 확인에 실패했습니다.')
        database = checked_bytes(Path(temporary).read_bytes(), secrets)
        if len(database) > 95 * 1024 * 1024:
            raise ValueError('DB가 95 MB를 넘었습니다. 공개 범위 또는 파일 분할을 조정해 주세요.')
        for filename, content in payloads.items():
            atomic_write(target / filename, content)
        atomic_write(target / 'public.sqlite3', database)
        # Publish the manifest last; hashed shards prevent mixing old and new rows.
        atomic_write(target / 'manifest.json', manifest_content)
    finally:
        Path(temporary).unlink(missing_ok=True)
    # Only remove our generated shards within the explicitly supplied export directory.
    for path in target.glob('trades-*.json'):
        if re.fullmatch(r'trades-\d{5}-[a-f0-9]{12}\.json', path.name) and path.name not in payloads:
            path.unlink()
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--target', type=Path, default=ROOT / 'public' / 'data')
    parser.add_argument('--secrets-file', type=Path)
    args = parser.parse_args()
    try:
        result = export(args.source, args.target, args.secrets_file)
        print(f"공개 데이터 내보내기 완료: {result['count']:,}건, {len(result['districts'])}개 API 지역")
    except (ValueError, OSError, sqlite3.Error) as exc:
        parser.exit(1, f'내보내기 실패: {exc}\n')
