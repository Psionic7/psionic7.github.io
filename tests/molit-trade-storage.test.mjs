import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PUBLIC_SCHEMA,LOCAL_SCHEMA} from '../server/storage.mjs';
import {collectMonth,normalize,parsePage,verifyCollectedMonth,verifyCollectionHistory} from '../server/collector.mjs';
import {normalizedTradeFields} from '../server/trade-integrity.mjs';
import {reconcileMolitTradeRows,readMolitRunRows} from '../server/molit-trade-storage.mjs';
import {compareDetailedTrades} from '../scripts/compare-molit-detailed.mjs';

const basic={aptNm:'검증단지',umdNm:'검증동',jibun:'1',dealAmount:'100,000',excluUseAr:'84',dealYear:'2026',dealMonth:'1',dealDay:'9',sggCd:'11110',floor:'3',buildYear:'2000',aptDong:' ',rgstDate:' ',cdealType:' ',cdealDay:' '};
const detailed={...basic,aptSeq:'11110-000007'};
const xml=items=>`<response><header><resultCode>000</resultCode></header><body><items>${items.map(item=>'<item>'+Object.entries(item).map(([key,value])=>`<${key}>${value}</${key}>`).join('')+'</item>').join('')}</items><totalCount>${items.length}</totalCount></body></response>`;
const row=(item,id)=>{
 const values=normalize(item,'11110','202601');
 return {...Object.fromEntries([...normalizedTradeFields,'raw_json'].map((field,index)=>[field,values[index]])),id};
};
function fixture(t){
 const db=new DatabaseSync(':memory:');db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA);t.after(()=>db.close());return db;
}
const collect=(db,items,extra={})=>collectMonth(db,'fixture-key','11110','202601','검증구',{pause:0,fetcher:async()=>({...parsePage(xml(items)),xml:xml(items),service:items.some(item=>item.aptSeq)?'detailed':'basic'}),...extra});
const latest=db=>db.prepare('SELECT MAX(id) AS id FROM collection_runs').get().id;

test('the normal monthly entry point requests the detailed endpoint and refuses missing official IDs',async t=>{
 const db=fixture(t),urls=[];
 t.mock.method(globalThis,'fetch',async url=>{urls.push(url);return new Response(xml([detailed]));});
 await collectMonth(db,'fixture-key','11110','202601','검증구',{pause:0});
 assert(urls[0].includes('/RTMSDataSvcAptTradeDev/'));assert.equal(urls.length,1);
 assert.equal(db.prepare('SELECT provider_apartment_id FROM molit_trade_identities').get().provider_apartment_id,'11110-000007');
 t.mock.method(globalThis,'fetch',async()=>new Response(xml([basic])));
 await assert.rejects(collectMonth(db,'fixture-key','11110','202601','검증구',{pause:0}),/공식 단지 ID/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM collection_runs').get().n,1);
});

test('basic-to-detailed enrichment preserves IDs and original runs, including duplicate counts and order changes',async t=>{
 const db=fixture(t);
 await collect(db,[basic,basic,{...basic,floor:'4'}]);
 const oldRun=latest(db),before=db.prepare('SELECT * FROM trades ORDER BY id').all();
 await collect(db,[{...detailed,floor:'4',aptDong:'101',rgstDate:'26.02.01'},detailed,detailed]);
 assert.deepEqual(db.prepare('SELECT id FROM trades ORDER BY id').all().map(row=>row.id),before.map(row=>row.id));
 assert.equal(verifyCollectedMonth(db,oldRun).rows,3);assert.equal(verifyCollectionHistory(db).rows,3);
 assert.equal(JSON.parse(readMolitRunRows(db,oldRun)[0].raw_json).aptSeq,undefined);
 const current=db.prepare('SELECT * FROM trades ORDER BY id').all();
 await collect(db,[detailed,{...detailed,floor:'4',aptDong:'101',rgstDate:'26.02.01'},detailed]);
 assert.deepEqual(db.prepare('SELECT * FROM trades ORDER BY id').all(),current);
 assert.equal(db.prepare('SELECT count(*) AS n FROM molit_trade_revisions').get().n,6);
});

test('ambiguous official IDs cannot be assigned to old duplicate rows by response order',()=>{
 const old=[row(basic,1),row(basic,2)],items=[detailed,{...detailed,aptSeq:'11110-000008'}];
 for(const ordered of [items,[...items].reverse()]){
  const plan=reconcileMolitTradeRows(old,ordered.map(item=>row(item,null)));
  assert.deepEqual(plan.rows.map(row=>row.id),[null,null]);assert.deepEqual(plan.retiredIds,[1,2]);
 }
 const known=[row(detailed,1),row({...detailed,aptSeq:'11110-000008'},2)];
 assert.deepEqual(reconcileMolitTradeRows(known,[known[1],known[0]]).rows.map(row=>row.id),[2,1]);
 const comparison=compareDetailedTrades([row(detailed,1)],[{...detailed,aptSeq:'11110-000008'}],'11110','202601');
 assert.equal(comparison.candidateTradeRows,0);assert.equal(comparison.unresolved[0].reason,'conflicting_existing_apt_seq');
});

test('retired IDs and old source metadata survive duplicate changes and the existing XML retention policy',async t=>{
 const db=fixture(t);
 await collect(db,[detailed,detailed]);const first=latest(db),firstIds=db.prepare('SELECT id FROM trades ORDER BY id').all().map(row=>row.id);
 await collect(db,[detailed]);await collect(db,[detailed]);await collect(db,[detailed]);
 db.exec(`DELETE FROM api_pages WHERE run_id=${first}; DELETE FROM collection_runs WHERE id=${first};`);
 assert.equal(readMolitRunRows(db,first).length,2);
 assert.equal(db.prepare('SELECT service FROM molit_trade_runs WHERE run_id=?').get(first).service,'detailed');
 assert(db.prepare('SELECT observed_at FROM molit_trade_runs WHERE run_id=?').get(first).observed_at);
 await collect(db,[detailed,detailed]);
 const ids=db.prepare('SELECT id FROM trades ORDER BY id').all().map(row=>row.id);
 assert.equal(ids[0],firstIds[0]);assert(ids[1]>firstIds[1]);assert.equal(verifyCollectionHistory(db).rows,2);
});

test('update corruption rolls back the current row, revisions, catalog and allocator together',async t=>{
 const db=fixture(t);await collect(db,[basic]);const before=db.prepare('SELECT * FROM trades').all(),run=latest(db),high=db.prepare('SELECT max(id) AS id FROM molit_trade_id_ledger').get().id;
 db.exec('CREATE TRIGGER corrupt AFTER UPDATE ON trades BEGIN UPDATE trades SET cancelled=1 WHERE id=NEW.id; END');
 await assert.rejects(collect(db,[{...detailed,aptDong:'101'}]),/데이터 검증 실패/);
 assert.deepEqual(db.prepare('SELECT * FROM trades').all(),before);assert.equal(latest(db),run);
 assert.equal(db.prepare('SELECT count(*) AS n FROM molit_apartments').get().n,0);
 assert.equal(db.prepare('SELECT max(id) AS id FROM molit_trade_id_ledger').get().id,high);
});

test('a delayed response cannot overwrite a month committed by another concurrent collection',async t=>{
 const db=fixture(t);await collect(db,[detailed]);
 let release;
 const response=new Promise(resolve=>{release=resolve;});
 const slow=collect(db,[detailed],{fetcher:async()=>{await response;return {...parsePage(xml([detailed])),xml:xml([detailed]),service:'detailed'};}});
 await collect(db,[{...detailed,dealAmount:'110,000'}]);release();
 await assert.rejects(slow,/다른 실행/);
 assert.equal(db.prepare('SELECT price_man FROM trades').get().price_man,110000);assert.equal(verifyCollectionHistory(db).rows,1);
});

test('known official data cannot be downgraded to basic data and contradictory observations receive new IDs',async t=>{
 const db=fixture(t);await collect(db,[detailed]);const original=db.prepare('SELECT id FROM trades').get().id;
 await assert.rejects(collect(db,[basic]),/상세 API 원문/);
 await collect(db,[{...detailed,cdealType:'O',cdealDay:'26.02.01'}]);
 assert(db.prepare('SELECT id FROM trades').get().id>original);assert.equal(readMolitRunRows(db,1)[0].id,original);
});

test('missing month bridges, missing ledger rows and altered provider catalogs fail validation',async t=>{
 const db=fixture(t);await collect(db,[detailed,{...detailed,floor:'4'}]);
 const checks=[
  ['DELETE FROM molit_trade_heads; DELETE FROM molit_trade_runs','원천 연결'],
  ['DELETE FROM molit_trade_id_ledger WHERE id=1','원장 행'],
  ["UPDATE molit_apartments SET provider_apartment_id='wrong'",'카탈로그'],
  ['DROP VIEW molit_trade_identities','조회 뷰'],
  ["DELETE FROM metadata WHERE key='molit_trade_storage_version'",'버전 표식'],
 ];
 db.exec('PRAGMA foreign_keys=OFF');
 for(const [sql,message] of checks){
  db.exec('SAVEPOINT damaged');db.exec(sql);
  assert.throws(()=>verifyCollectionHistory(db),new RegExp(message));db.exec('ROLLBACK TO damaged; RELEASE damaged');
 }
});

test('a provider catalog cannot cite a basic revision that contains no official apartment ID',async t=>{
 const db=fixture(t);await collect(db,[basic]);const oldRun=latest(db);
 await collect(db,[detailed]);
 db.prepare(`UPDATE molit_apartments SET run_id=?,observed_at=(SELECT observed_at FROM molit_trade_runs WHERE run_id=?),
   raw_sha256=(SELECT raw_sha256 FROM molit_trade_run_rows WHERE run_id=?)`).run(oldRun,oldRun,oldRun);
 assert.throws(()=>verifyCollectionHistory(db),/카탈로그/);
});
