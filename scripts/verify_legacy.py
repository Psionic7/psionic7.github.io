"""Compare the shipped static data and JS statistics with the existing Python implementation."""
import argparse
import json
import math
from pathlib import Path
import sqlite3
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def assert_same(expected, actual, location='result'):
    if isinstance(expected, dict):
        assert expected.keys() == actual.keys(), location
        for key in expected:
            assert_same(expected[key], actual[key], location + '.' + str(key))
    elif isinstance(expected, list):
        assert len(expected) == len(actual), location
        for index, value in enumerate(expected):
            assert_same(value, actual[index], f'{location}[{index}]')
    elif isinstance(expected, float):
        assert actual is not None and math.isclose(expected, actual, rel_tol=1e-10, abs_tol=1e-8), location
    else:
        assert expected == actual, location


def verify(legacy_project):
    sys.path.insert(0, str(Path(legacy_project).resolve()))
    import pandas as pd
    from real_estate.analysis import apartment_summary, apply_raw_filters, monthly_summary, raw_frame, valid_trades
    folder = ROOT / 'public' / 'data'
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8'))
    rows = []
    for district in manifest['districts'].values():
        rows.extend(json.loads((folder / district['file']).read_text(encoding='utf-8')))
    conn = sqlite3.connect((folder / 'public.sqlite3').as_uri() + '?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    try:
        original = {row['id']: dict(row) for row in conn.execute('SELECT * FROM trades')}
    finally:
        conn.close()
    assert len(rows) == len(original) == manifest['count']
    for row in rows:
        expected = dict(original[row['id']])
        expected['raw'] = json.loads(expected.pop('raw_json'))
        assert expected == row, 'SQLite / JSON row mismatch'
    frame = pd.DataFrame(list(original.values()))
    cases = []
    for region in manifest['regions']:
        if region['region_id'] not in {'suji', 'gwanggyo', 'bundang'}:
            continue
        for min_area, max_area in [(0, 10000), (60, 85), (85, 135)]:
            cases.append({'region': region, 'start': manifest['months'][0], 'end': manifest['months'][-1],
                          'min': min_area, 'max': max_area, 'dongs': []})
        cases.append({'region': region, 'start': manifest['months'][-1], 'end': manifest['months'][-1],
                      'min': 0, 'max': 10000, 'dongs': []})
    script = '''
import fs from 'node:fs';
const d=await import(process.argv[1]);
const payload=JSON.parse(fs.readFileSync(0,'utf8'));
const output=payload.cases.map(c=>{
 const scoped=d.scopeRows(payload.rows,c.region,c.start,c.end);
 const valid=d.validRows(scoped,c.min,c.max,c.dongs);
 return {stats:d.stats(valid),monthly:d.monthly(valid,c.start,c.end).map(r=>({month:r.month,label:r.label,count:r.count,median:r.median,pyeong:r.pyeong})),
 apartments:d.apartmentSummary(valid).map(({key,...rest})=>rest).sort((a,b)=>JSON.stringify([a.dong,a.jibun,a.apartment]).localeCompare(JSON.stringify([b.dong,b.jibun,b.apartment]),'en'))};
});
process.stdout.write(JSON.stringify(output));
'''
    result = subprocess.run(['node', '--input-type=module', '-e', script, (ROOT / 'src' / 'domain.mjs').as_uri()],
                            input=json.dumps({'rows': rows, 'cases': cases}, ensure_ascii=False),
                            text=True, encoding='utf-8', capture_output=True, check=True, timeout=120)
    actual = json.loads(result.stdout)
    for index, case in enumerate(cases):
        scoped = frame.loc[frame.region_code.eq(case['region']['region_code']) & frame.deal_month.between(case['start'], case['end'])]
        if case['region']['dongs']:
            scoped = scoped.loc[scoped.dong.isin(case['region']['dongs'])]
        valid = valid_trades(scoped, case['min'], case['max'], case['dongs'])
        nullable = lambda value: None if pd.isna(value) else float(value)
        expected_stats = {'count': len(valid), 'median': nullable(valid.price_eok.median()),
                          'pyeong': nullable(valid.price_per_pyeong.median()),
                          'apartments': len(valid[['dong','jibun','apartment']].drop_duplicates())}
        assert_same(expected_stats, actual[index]['stats'], f'case {index} stats')
        month_data = monthly_summary(valid, case['start'], case['end'])
        expected_months = [{'month': row['계약월'].replace('.', ''), 'label': row['계약월'],
                            'count': int(row['거래건수']), 'median': nullable(row['중위가격(억원)']),
                            'pyeong': nullable(row['평당 중위가격(만원)'])} for _, row in month_data.iterrows()]
        assert_same(expected_months, actual[index]['monthly'], f'case {index} monthly')
        expected_apts = {tuple(row[key] for key in ('법정동','지번','아파트명')): {
            'apartment': row['아파트명'], 'dong': row['법정동'], 'jibun': row['지번'],
            'count': int(row['거래건수']), 'median': float(row['중위가격(억원)']),
            'min': float(row['최저가격(억원)']), 'max': float(row['최고가격(억원)']),
            'area': float(row['평균면적(㎡)']), 'latest': row['최근계약일'],
        } for _, row in apartment_summary(valid).iterrows()}
        actual_apts = {(row['dong'], row['jibun'], row['apartment']): row for row in actual[index]['apartments']}
        assert_same(expected_apts, actual_apts, f'case {index} apartments')
    filters = [('dealAmount','숫자 이상','100,000','gte'), ('floor','숫자 이하','10','lte'),
               ('cdealType','비어 있음','','empty'), ('aptDong','비어 있지 않음','','not_empty'),
               ('umdNm','포함','동','contains'), ('buyerGbn','일치','개인','equals'),
               ('aptNm','제외','래미안','excludes')]
    raw_script = '''import fs from 'node:fs';const d=await import(process.argv[1]);const p=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(JSON.stringify(p.filters.map(([field,op,value])=>d.filterRaw(p.rows,{[field]:{op,value}}).map(r=>r.id).sort((a,b)=>a-b))));'''
    raw_result = subprocess.run(['node','--input-type=module','-e',raw_script,(ROOT / 'src' / 'domain.mjs').as_uri()],
        input=json.dumps({'rows':rows,'filters':[[field,op,value] for field,_,value,op in filters]},ensure_ascii=False),
        text=True,encoding='utf-8',capture_output=True,check=True,timeout=60)
    raw_actual=json.loads(raw_result.stdout)
    raw=raw_frame(frame)
    for index,(field,operator,value,_) in enumerate(filters):
        filtered=apply_raw_filters(raw,[(field,operator,value)])
        expected=sorted(frame.loc[filtered.index,'id'].tolist())
        assert_same(expected,raw_actual[index],f'raw filter {index}')
    print(f'기존 Python / React 일치: {len(rows):,}개 원천 행, {len(cases)}개 통계·월별·단지 조건, {len(filters)}개 원천 필터')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--legacy-project',type=Path,required=True)
    verify(parser.parse_args().legacy_project)
