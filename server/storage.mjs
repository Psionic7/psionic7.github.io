import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync, backup} from 'node:sqlite';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const paths = {db:path.join(ROOT,'local/my_real_estate.sqlite3'), favorites:path.join(ROOT,'local/collection_regions.json'), env:path.join(ROOT,'.env')};
export const TRADE_COLUMNS = ['id','region_code','deal_month','deal_date','apartment','dong','jibun','price_man','area_m2','floor','build_year','cancelled','raw_json'];
export const REGION_COLUMNS = ['region_id','label','region_code','region_name','dongs_json','latitude','longitude'];
export const PUBLIC_SCHEMA = `CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY,region_code TEXT NOT NULL,deal_month TEXT NOT NULL,deal_date TEXT NOT NULL,apartment TEXT NOT NULL,dong TEXT NOT NULL,jibun TEXT NOT NULL,price_man INTEGER NOT NULL,area_m2 REAL NOT NULL,floor INTEGER,build_year INTEGER,cancelled INTEGER NOT NULL,raw_json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS trades_region_month ON trades(region_code,deal_month);
CREATE TABLE IF NOT EXISTS regions (region_id TEXT PRIMARY KEY,label TEXT NOT NULL UNIQUE,region_code TEXT NOT NULL,region_name TEXT NOT NULL,dongs_json TEXT NOT NULL,latitude REAL,longitude REAL);
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL);`;
export const LOCAL_SCHEMA = `CREATE TABLE IF NOT EXISTS collection_runs (id INTEGER PRIMARY KEY,region_code TEXT NOT NULL,region_name TEXT NOT NULL,deal_month TEXT NOT NULL,fetched_at TEXT NOT NULL,api_count INTEGER NOT NULL,stored_count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS api_pages (run_id INTEGER NOT NULL,page_no INTEGER NOT NULL,response_xml BLOB NOT NULL,PRIMARY KEY(run_id,page_no),FOREIGN KEY(run_id) REFERENCES collection_runs(id));`;
export function atomicWrite(filename, data) {
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const temporary = path.join(path.dirname(filename),`.write-${randomUUID()}.tmp`);
  try { const fd=fs.openSync(temporary,'wx',0o600); try {fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);} fs.renameSync(temporary,filename); }
  finally {if(fs.existsSync(temporary)) fs.unlinkSync(temporary);}
}
export function readJson(filename) {return JSON.parse(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,''));}
export function localEnv(filename=paths.env) {return fs.existsSync(filename)?parseEnv(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,'')):{};}
export function serviceKey(filename=paths.env) {return process.env.MOLIT_SERVICE_KEY || localEnv(filename).MOLIT_SERVICE_KEY || '';}
export function secretValues(filename=paths.env) {
  const values=Object.entries({...localEnv(filename),...process.env}).filter(([k,v])=>/(SERVICE_KEY|API_KEY|TOKEN|SECRET|PASSWORD)$/i.test(k)&&v?.length>=12).map(([,v])=>v);
  return [...new Set(values.flatMap(v=>{let decoded=v;try{decoded=decodeURIComponent(v);}catch{}return [v,decoded,encodeURIComponent(decoded)];}))];
}
export function checkedBytes(value,secrets=secretValues(),{maxBytes=95*1024*1024}={}) {
  const buffer=Buffer.isBuffer(value)?value:Buffer.from(value);
  if(secrets.some(v=>buffer.includes(Buffer.from(v))) || /(?:serviceKey|MOLIT_SERVICE_KEY)\s*[=:]\s*["']?[a-z0-9%]{16,}/i.test(buffer.toString('utf8'))) throw new Error('공개 파일에 인증 값이 포함되어 작업을 중단했습니다.');
  if(buffer.length>maxBytes) throw new Error('공개 파일이 95 MB를 초과했습니다.');
  return buffer;
}
export function connect(filename=paths.db,readOnly=false) {return new DatabaseSync(filename,{readOnly,timeout:30000});}
export function regions(db) {return db.prepare('SELECT * FROM regions ORDER BY rowid').all().map(({dongs_json,...r})=>({...r,dongs:JSON.parse(dongs_json)}));}
export function savedIds(filename,catalog) {
  if(!fs.existsSync(filename)) return [];
  let doc;try{doc=readJson(filename);}catch{throw new Error('저장한 수집 지역 파일이 손상되었습니다. 원본 파일을 보존합니다.');}
  const byId=new Map(catalog.map(r=>[r.region_id,r]));
  if(doc.version!==1 || !Array.isArray(doc.regions) || doc.regions.some(r=>!r || !byId.has(r.region_id))) throw new Error('수집 지역 목록에 유효하지 않은 지역이 있습니다.');
  const ids=[];
  for(const item of doc.regions) {
    const r=byId.get(item.region_id);
    const expanded=['suji','gwanggyo','bundang'].includes(r.region_id)?catalog.filter(c=>c.region_id.startsWith('dong_')&&c.region_code===r.region_code&&(!r.dongs.length||c.dongs.some(d=>r.dongs.includes(d)))).map(c=>c.region_id):[r.region_id];
    for(const id of expanded) if(!ids.includes(id)) ids.push(id);
  }
  return ids;
}
export function saveFavorites(ids,filename,catalog) {
  // Read first: a broken saved file must never be silently replaced.
  savedIds(filename,catalog);
  const byId=new Map(catalog.filter(r=>!['suji','gwanggyo','bundang'].includes(r.region_id)).map(r=>[r.region_id,r]));
  if(!Array.isArray(ids)||ids.length>5000||ids.some(id=>typeof id!=='string'||!byId.has(id))) throw new Error('수집 지역 선택이 올바르지 않습니다.');
  const selected=[...new Set(ids)].map(id=>{const r=byId.get(id);return {region_id:id,label:r.label,region_code:r.region_code,region_name:r.region_name,dongs:r.dongs};});
  atomicWrite(filename,JSON.stringify({version:1,updated_at:new Date().toISOString(),regions:selected},null,2)+'\n');
  return selected.map(r=>r.region_id);
}
export async function initialize({db=paths.db,favorites=paths.favorites,env=paths.env,legacy=path.join(ROOT,'../my_real_estate')}={}) {
  const firstRun=!fs.existsSync(db);
  fs.mkdirSync(path.dirname(db),{recursive:true});
  if(!fs.existsSync(db)) {
    const old=path.join(legacy,'data/my_real_estate.sqlite3');
    if(fs.existsSync(old)) {const source=connect(old,true);const temp=db+'.migration.tmp';try{await backup(source,temp);fs.renameSync(temp,db);}finally{source.close();if(fs.existsSync(temp))fs.unlinkSync(temp);}}
  }
  if(firstRun) for(const [target,source] of [[favorites,path.join(legacy,'data/collection_regions.json')],[env,path.join(legacy,'.env')]]) if(!fs.existsSync(target)&&fs.existsSync(source)) atomicWrite(target,fs.readFileSync(source));
  const connection=connect(db);
  try {
    connection.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA);
    const boundary=readJson(path.join(ROOT,'admin/assets/dong_boundaries.geojson'));
    const insert=connection.prepare('INSERT OR IGNORE INTO regions VALUES (?,?,?,?,?,?,?)');
    connection.exec('BEGIN');
    try {
      for(const feature of boundary.features) {
        const p=feature.properties;
        const coords=feature.geometry.coordinates.flat(feature.geometry.type==='MultiPolygon'?2:1);
        const xs=coords.map(c=>c[0]),ys=coords.map(c=>c[1]);
        insert.run('dong_'+p.EMD_CD,p.FULL_NM,p.EMD_CD.slice(0,5),p.FULL_NM.slice(0,p.FULL_NM.lastIndexOf(' ')),JSON.stringify([p.EMD_KOR_NM]),(Math.min(...ys)+Math.max(...ys))/2,(Math.min(...xs)+Math.max(...xs))/2);
      }
      connection.exec('PRAGMA user_version=2; COMMIT');
    } catch(e) {connection.exec('ROLLBACK');throw e;}
    savedIds(favorites,regions(connection));
  } finally {connection.close();}
}
