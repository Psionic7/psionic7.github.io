import {createHash} from 'node:crypto';
import {normalizedTradeFields,tradeComparisonDigest} from './trade-integrity.mjs';

const schema=`
CREATE TABLE IF NOT EXISTS molit_trade_id_ledger(id INTEGER PRIMARY KEY AUTOINCREMENT);
CREATE TABLE IF NOT EXISTS molit_trade_revisions(
 trade_id INTEGER NOT NULL,raw_sha256 TEXT NOT NULL,region_code TEXT NOT NULL,deal_month TEXT NOT NULL,
 normalized_json TEXT NOT NULL,raw_json TEXT NOT NULL,provider_apartment_id TEXT,
 PRIMARY KEY(trade_id,raw_sha256));
CREATE TABLE IF NOT EXISTS molit_trade_runs(
 run_id INTEGER PRIMARY KEY,service TEXT NOT NULL,region_code TEXT NOT NULL,deal_month TEXT NOT NULL,
 observed_at TEXT NOT NULL,api_count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS molit_trade_run_rows(
 run_id INTEGER NOT NULL REFERENCES molit_trade_runs(run_id) ON DELETE CASCADE,
 item_no INTEGER NOT NULL,trade_id INTEGER NOT NULL REFERENCES molit_trade_id_ledger(id),raw_sha256 TEXT NOT NULL,
 PRIMARY KEY(run_id,item_no),UNIQUE(run_id,trade_id),
 FOREIGN KEY(trade_id,raw_sha256) REFERENCES molit_trade_revisions(trade_id,raw_sha256));
CREATE TABLE IF NOT EXISTS molit_trade_heads(
 region_code TEXT NOT NULL,deal_month TEXT NOT NULL,run_id INTEGER NOT NULL REFERENCES molit_trade_runs(run_id),
 PRIMARY KEY(region_code,deal_month));
CREATE TABLE IF NOT EXISTS molit_apartments(
 provider_apartment_id TEXT PRIMARY KEY,region_code TEXT NOT NULL,name TEXT NOT NULL,dong TEXT NOT NULL,jibun TEXT NOT NULL,
 observed_at TEXT NOT NULL,run_id INTEGER NOT NULL REFERENCES molit_trade_runs(run_id),trade_id INTEGER NOT NULL,raw_sha256 TEXT NOT NULL,
 FOREIGN KEY(trade_id,raw_sha256) REFERENCES molit_trade_revisions(trade_id,raw_sha256));
CREATE VIEW IF NOT EXISTS molit_trade_identities AS
 SELECT t.id AS trade_id,'molit' AS provider,v.provider_apartment_id,h.run_id
 FROM molit_trade_heads h JOIN molit_trade_run_rows r ON r.run_id=h.run_id
 JOIN molit_trade_revisions v ON v.trade_id=r.trade_id AND v.raw_sha256=r.raw_sha256
 JOIN trades t ON t.id=r.trade_id AND t.region_code=h.region_code AND t.deal_month=h.deal_month
 WHERE v.provider_apartment_id IS NOT NULL;
`;

const hash=value=>createHash('sha256').update(value).digest('hex');
const raw=row=>JSON.parse(row.raw_json);
const providerId=row=>raw(row).aptSeq?.trim()||null;
const compatible=(previous,next)=>!providerId(previous)||!providerId(next)||providerId(previous)===providerId(next);
const hasTable=(db,name)=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
const tables=['molit_trade_id_ledger','molit_trade_revisions','molit_trade_runs','molit_trade_run_rows','molit_trade_heads','molit_apartments'];

export function verifyMolitStorage(db) {
  if(!db.prepare("SELECT value FROM metadata WHERE key='molit_trade_storage_version'").get()){
    if(tables.some(table=>hasTable(db,table)))throw Error('데이터 검증 실패: 실거래 저장 구조의 버전 표식 누락');
    return;
  }
  if(tables.some(table=>!hasTable(db,table)))throw Error('데이터 검증 실패: 실거래 ID 원장 또는 원문 이력 누락');
  const highest=db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM molit_trade_id_ledger').get().id;
  const saved=Number(db.prepare("SELECT value FROM metadata WHERE key='molit_trade_id_high_water'").get()?.value);
  const current=db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM trades').get().id;
  if(!Number.isSafeInteger(saved)||saved!==highest||current>highest)throw Error('데이터 검증 실패: 실거래 ID 원장의 최고 발급값 불일치');
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name='molit_trade_identities'").get())throw Error('데이터 검증 실패: 공식 실거래 ID 조회 뷰 누락');
  const missingLedger=db.prepare(`SELECT 1 FROM trades t LEFT JOIN molit_trade_id_ledger l ON l.id=t.id WHERE l.id IS NULL
    UNION ALL SELECT 1 FROM molit_trade_revisions v LEFT JOIN molit_trade_id_ledger l ON l.id=v.trade_id WHERE l.id IS NULL LIMIT 1`).get();
  if(missingLedger)throw Error('데이터 검증 실패: 실거래 ID 원장 행 누락');
  const invalid=db.prepare(`SELECT 1 FROM molit_trade_heads h LEFT JOIN collection_runs r ON r.id=h.run_id
    WHERE r.id IS NULL OR r.region_code<>h.region_code OR r.deal_month<>h.deal_month
    OR h.run_id<>(SELECT MAX(id) FROM collection_runs WHERE region_code=h.region_code AND deal_month=h.deal_month)
    UNION ALL SELECT 1 FROM molit_trade_runs r JOIN collection_runs c ON c.id=r.run_id
    WHERE c.id=(SELECT MAX(id) FROM collection_runs WHERE region_code=c.region_code AND deal_month=c.deal_month)
    AND NOT EXISTS(SELECT 1 FROM molit_trade_heads h WHERE h.run_id=r.run_id) LIMIT 1`).get();
  if(invalid)throw Error('데이터 검증 실패: 현재 실거래 원천 실행의 연결 불일치');
  const missingMonth=db.prepare(`SELECT 1 FROM metadata m LEFT JOIN molit_trade_heads h ON m.key='molit_trade_month:'||h.region_code||':'||h.deal_month
    WHERE m.key LIKE 'molit_trade_month:%' AND (h.run_id IS NULL OR CAST(m.value AS INTEGER)<>h.run_id)
    UNION ALL SELECT 1 FROM molit_trade_heads h WHERE NOT EXISTS(SELECT 1 FROM metadata m WHERE m.key='molit_trade_month:'||h.region_code||':'||h.deal_month AND m.value=CAST(h.run_id AS TEXT)) LIMIT 1`).get();
  if(missingMonth)throw Error('데이터 검증 실패: 이관된 실거래 월의 원천 연결 누락');
  const catalogError=db.prepare(`SELECT 1 FROM molit_apartments a LEFT JOIN molit_trade_revisions v ON v.trade_id=a.trade_id AND v.raw_sha256=a.raw_sha256
    LEFT JOIN molit_trade_runs r ON r.run_id=a.run_id
    WHERE v.trade_id IS NULL OR a.provider_apartment_id IS NOT v.provider_apartment_id OR a.region_code<>v.region_code
    OR a.name<>json_extract(v.normalized_json,'$.apartment') OR a.dong<>json_extract(v.normalized_json,'$.dong')
    OR a.jibun<>json_extract(v.normalized_json,'$.jibun') OR r.run_id IS NULL OR a.observed_at<>r.observed_at
    OR NOT EXISTS(SELECT 1 FROM molit_trade_run_rows m WHERE m.run_id=a.run_id AND m.trade_id=a.trade_id AND m.raw_sha256=a.raw_sha256)
    UNION ALL SELECT 1 FROM molit_trade_revisions v LEFT JOIN molit_apartments a USING(provider_apartment_id)
    WHERE v.provider_apartment_id IS NOT NULL AND a.provider_apartment_id IS NULL LIMIT 1`).get();
  if(catalogError)throw Error('데이터 검증 실패: 공식 실거래 단지 카탈로그와 원문 이력 불일치');
}

function ensureStorage(db) {
  const initialized=db.prepare("SELECT value FROM metadata WHERE key='molit_trade_storage_version'").get();
  if(!initialized&&tables.some(table=>hasTable(db,table)))throw Error('실거래 저장 구조의 버전 표식이 누락됐습니다. 원본 DB를 확인하세요.');
  if(initialized&&tables.some(table=>!hasTable(db,table)))throw Error('실거래 ID 원장 또는 원문 이력이 누락됐습니다. 로컬 기준 DB를 확인하세요.');
  db.exec(schema);
  if(!initialized){
    db.exec('INSERT OR IGNORE INTO molit_trade_id_ledger(id) SELECT id FROM trades');
    db.prepare('INSERT INTO metadata VALUES(?,?)').run('molit_trade_storage_version','1');
    const highest=db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM molit_trade_id_ledger').get().id;
    db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('molit_trade_id_high_water',String(highest));
  }
  const highest=db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM molit_trade_id_ledger').get().id;
  const saved=Number(db.prepare("SELECT value FROM metadata WHERE key='molit_trade_id_high_water'").get()?.value);
  const current=db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM trades').get().id;
  if(!Number.isSafeInteger(saved)||saved!==highest||current>highest)throw Error('실거래 ID 원장의 최고 발급값이 다릅니다. 기존 ID를 복원하세요.');
}

function buckets(rows,includeEnrichment) {
  const result=new Map();
  for(const row of rows){
    const key=tradeComparisonDigest(row,{includeEnrichment});
    if(!result.has(key))result.set(key,[]);
    result.get(key).push(row);
  }
  return result;
}

export function reconcileMolitTradeRows(previous,rows) {
  if(previous.some(providerId)&&rows.some(row=>!providerId(row)))throw Error('공식 단지 ID가 있는 월은 상세 API 원문으로 갱신하세요.');
  const remaining=new Map(previous.map(row=>[row.id,row]));
  const exact=buckets(previous,true),result=rows.map(row=>({...row,id:null}));
  for(const [key,incoming] of buckets(result,true)){
    const choices=exact.get(key)||[];
    for(const row of incoming){
      if(!providerId(row))continue;
      const known=choices.find(candidate=>remaining.has(candidate.id)&&providerId(candidate)===providerId(row));
      if(known){row.id=known.id;remaining.delete(known.id);}
    }
    const pending=incoming.filter(row=>row.id===null);
    if(new Set(pending.map(providerId)).size>1)continue;
    for(const row of pending){
      const chosen=choices.find(candidate=>remaining.has(candidate.id)&&!providerId(candidate));
      if(chosen){row.id=chosen.id;remaining.delete(chosen.id);}
    }
  }
  const oldGroups=buckets([...remaining.values()],false),newGroups=buckets(result.filter(row=>row.id===null),false);
  for(const [key,incoming] of newGroups){
    const old=oldGroups.get(key);
    if(old?.length!==1||incoming.length!==1||!compatible(old[0],incoming[0]))continue;
    const before=raw(old[0]),after=raw(incoming[0]);
    if(['aptDong','rgstDate'].some(field=>before[field]?.trim()&&before[field].trim()!==after[field]?.trim()))continue;
    incoming[0].id=old[0].id;remaining.delete(old[0].id);
  }
  return {rows:result,retiredIds:[...remaining.keys()]};
}

function saveRunRows(db,rows,runId,service) {
  const run=db.prepare('SELECT * FROM collection_runs WHERE id=?').get(runId);
  db.prepare('INSERT INTO molit_trade_runs VALUES(?,?,?,?,?,?)').run(runId,service,run.region_code,run.deal_month,run.fetched_at,run.api_count);
  const version=db.prepare('INSERT OR IGNORE INTO molit_trade_revisions VALUES(?,?,?,?,?,?,?)');
  const member=db.prepare('INSERT INTO molit_trade_run_rows VALUES(?,?,?,?)');
  for(const [index,row] of rows.entries()){
    const digest=hash(row.raw_json),normalized=Object.fromEntries(normalizedTradeFields.map(field=>[field,row[field]]));
    version.run(row.id,digest,row.region_code,row.deal_month,JSON.stringify(normalized),row.raw_json,providerId(row));
    member.run(runId,index+1,row.id,digest);
  }
}

export function storeMolitTradeSnapshot(db,rows,{code,month,runId,previousRunId,service,observedAt}) {
  ensureStorage(db);
  const previous=db.prepare('SELECT * FROM trades WHERE region_code=? AND deal_month=? ORDER BY id').all(code,month);
  if(previousRunId&&!db.prepare('SELECT 1 FROM molit_trade_runs WHERE run_id=?').get(previousRunId))saveRunRows(db,previous,previousRunId,'legacy');
  const plan=reconcileMolitTradeRows(previous,rows);
  const allocate=db.prepare('INSERT INTO molit_trade_id_ledger DEFAULT VALUES');
  const insert=db.prepare('INSERT INTO trades(id,'+normalizedTradeFields.join(',')+',raw_json) VALUES('+Array(normalizedTradeFields.length+2).fill('?').join(',')+')');
  const update=db.prepare('UPDATE trades SET '+[...normalizedTradeFields,'raw_json'].map(field=>field+'=?').join(',')+' WHERE id=?');
  const oldById=new Map(previous.map(row=>[row.id,row]));
  for(const row of plan.rows){
    const values=[...normalizedTradeFields.map(field=>row[field]),row.raw_json];
    if(row.id===null){row.id=Number(allocate.run().lastInsertRowid);insert.run(row.id,...values);}
    else if(oldById.get(row.id).raw_json!==row.raw_json||normalizedTradeFields.some(field=>oldById.get(row.id)[field]!==row[field]))update.run(...values,row.id);
  }
  const retire=db.prepare('DELETE FROM trades WHERE id=?');
  for(const id of plan.retiredIds)retire.run(id);
  saveRunRows(db,plan.rows,runId,service);
  db.prepare('INSERT INTO molit_trade_heads VALUES(?,?,?) ON CONFLICT(region_code,deal_month) DO UPDATE SET run_id=excluded.run_id').run(code,month,runId);
  db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('molit_trade_month:'+code+':'+month,String(runId));
  const apartment=db.prepare(`INSERT INTO molit_apartments VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(provider_apartment_id) DO UPDATE SET
    region_code=excluded.region_code,name=excluded.name,dong=excluded.dong,jibun=excluded.jibun,
    observed_at=excluded.observed_at,run_id=excluded.run_id,trade_id=excluded.trade_id,raw_sha256=excluded.raw_sha256 WHERE excluded.observed_at>=molit_apartments.observed_at`);
  for(const row of plan.rows)if(providerId(row))apartment.run(providerId(row),code,row.apartment,row.dong,row.jibun,observedAt,runId,row.id,hash(row.raw_json));
  const highest=db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM molit_trade_id_ledger').get().id;
  db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('molit_trade_id_high_water',String(highest));
  return plan;
}

export function readMolitRunRows(db,runId) {
  if(!hasTable(db,'molit_trade_runs')||!db.prepare('SELECT 1 FROM molit_trade_runs WHERE run_id=?').get(runId))return null;
  return db.prepare(`SELECT r.trade_id AS id,v.raw_sha256,v.normalized_json,v.raw_json,v.provider_apartment_id
    FROM molit_trade_run_rows r JOIN molit_trade_revisions v USING(trade_id,raw_sha256)
    WHERE r.run_id=? ORDER BY r.item_no`).all(runId).map(row=>{
      if(hash(row.raw_json)!==row.raw_sha256||providerId(row)!==row.provider_apartment_id)throw Error('데이터 검증 실패: 실거래 원문 버전 또는 공식 단지 ID 불일치');
      return {...JSON.parse(row.normalized_json),id:row.id,raw_json:row.raw_json};
    });
}
