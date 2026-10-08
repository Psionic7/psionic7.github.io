import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {exportApartmentMap} from './export-apartment-map.mjs';
import {connect,PUBLIC_SCHEMA,TRADE_COLUMNS,REGION_COLUMNS,paths,ROOT,secretValues,checkedBytes,savedIds,atomicWrite} from './storage.mjs';
export const sha256=data=>createHash('sha256').update(data).digest('hex');
export function databasePayload(raw,secrets,compressAbove=95*1024*1024) {
  checkedBytes(raw,secrets,{maxBytes:Infinity});
  const compressed=raw.length>compressAbove;
  const bytes=checkedBytes(compressed?gzipSync(raw,{level:6}):raw,secrets);
  return {bytes,metadata:{file:compressed?'public.sqlite3.gz':'public.sqlite3',format:compressed?'sqlite3+gzip':'sqlite3',bytes:bytes.length,sha256:sha256(bytes),uncompressed_bytes:raw.length,uncompressed_sha256:sha256(raw)}};
}
export function exportData({source=paths.db,target=path.join(ROOT,'public/data'),favorites=paths.favorites,secretsFile=paths.env,compressAbove=95*1024*1024}={}) {
  source=path.resolve(source);target=path.resolve(target);
  if(!fs.existsSync(source)||source===path.join(target,'public.sqlite3')) throw new Error('원본 작업 DB와 내보내기 경로를 확인하세요.');
  const secrets=secretValues(secretsFile),db=connect(source,true);let trades,regionRows,roadRows,published;
  try {
    db.exec('BEGIN');
    if(Object.values(db.prepare('PRAGMA quick_check').get())[0]!=='ok')throw new Error('원본 DB 무결성 확인 실패');
    trades=db.prepare(`SELECT ${TRADE_COLUMNS.join(',')} FROM trades ORDER BY deal_date DESC,id DESC`).all();
    regionRows=db.prepare(`SELECT ${REGION_COLUMNS.join(',')} FROM regions ORDER BY rowid`).all();
    roadRows=db.prepare('SELECT region_code,dong,jibun,road_address FROM road_addresses ORDER BY region_code,dong,jibun').all();
    published=db.prepare("SELECT value FROM metadata WHERE key='published_at'").get()?.value || new Date().toISOString();
  } finally {db.close();}
  const catalog=regionRows.map(({dongs_json,...r})=>({...r,dongs:JSON.parse(dongs_json)}));
  const addresses=new Map(roadRows.map(row=>[JSON.stringify([row.region_code,row.dong,row.jibun]),row.road_address]));
  const groups=new Map();
  for(const row of trades) {
    if(!/^\d{5}$/.test(row.region_code))throw new Error('지역 코드가 올바르지 않습니다.');
    const {raw_json,...normal}=row,raw=JSON.parse(raw_json);
    if(!raw||Array.isArray(raw)||typeof raw!=='object'||Object.values(raw).some(v=>typeof v!=='string')) throw new Error('원천 필드는 문자열이어야 합니다.');
    if(!groups.has(row.region_code))groups.set(row.region_code,[]);
    groups.get(row.region_code).push({...normal,road_address:addresses.get(JSON.stringify([row.region_code,row.dong,row.jibun])) || '',raw});
  }
  const payloads=new Map(),districts={};
  for(const [code,rows] of [...groups].sort(([a],[b])=>a.localeCompare(b))) {
    const bytes=checkedBytes(JSON.stringify(rows),secrets),digest=sha256(bytes),file=`trades-${code}-${digest.slice(0,12)}.json`;
    payloads.set(file,bytes);
    districts[code]={file,count:rows.length,months:[...new Set(rows.map(r=>r.deal_month))].sort(),sha256:digest,dongs:[...new Set(rows.map(r=>r.dong))].sort()};
  }
  const manifest={version:2,published_at:published,exported_at:new Date().toISOString(),count:trades.length,regions:catalog,districts,favorite_region_ids:savedIds(favorites,catalog),months:[...new Set(trades.map(r=>r.deal_month))].sort(),source:'국토교통부 아파트 매매 실거래가',boundary_catalog_date:'2023-07-29'};
  fs.mkdirSync(target,{recursive:true});const temp=path.join(target,`.snapshot-${randomUUID()}.tmp`);
  try {
    const out=connect(temp);
    try {
      out.exec(PUBLIC_SCHEMA+'BEGIN');
      const insert=out.prepare(`INSERT INTO trades VALUES (${TRADE_COLUMNS.map(()=>'?').join(',')})`);
      trades.forEach(r=>insert.run(...TRADE_COLUMNS.map(k=>r[k])));
      const regionInsert=out.prepare('INSERT INTO regions VALUES (?,?,?,?,?,?,?)');
      regionRows.forEach(r=>regionInsert.run(...REGION_COLUMNS.map(k=>r[k])));
      const roadInsert=out.prepare('INSERT INTO road_addresses VALUES (?,?,?,?)');
      roadRows.forEach(r=>roadInsert.run(r.region_code,r.dong,r.jibun,r.road_address));
      out.prepare('INSERT INTO metadata VALUES (?,?)').run('published_at',published);
      out.exec('COMMIT');
      if(Object.values(out.prepare('PRAGMA integrity_check').get())[0]!=='ok')throw new Error('공개 DB 무결성 확인 실패');
    }finally{out.close();}
    const payload=databasePayload(fs.readFileSync(temp),secrets,compressAbove);
    manifest.database=payload.metadata;
    const manifestBytes=checkedBytes(JSON.stringify(manifest),secrets);
    for(const [name,bytes] of payloads)atomicWrite(path.join(target,name),bytes);
    atomicWrite(path.join(target,payload.metadata.file),payload.bytes);
    atomicWrite(path.join(target,'manifest.json'),manifestBytes);
    for(const name of fs.readdirSync(target))if(/^trades-\d{5}-[a-f0-9]{12}\.json$/.test(name)&&!payloads.has(name))fs.unlinkSync(path.join(target,name));
    const obsolete=path.join(target,payload.metadata.file==='public.sqlite3'?'public.sqlite3.gz':'public.sqlite3');
    if(fs.existsSync(obsolete))fs.unlinkSync(obsolete);
  } finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
  exportApartmentMap({source,target:path.join(path.dirname(target),'apartment-map'),favorites,secretsFile});
  return manifest;
}
