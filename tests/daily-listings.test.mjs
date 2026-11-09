import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PUBLIC_SCHEMA,LOCAL_SCHEMA} from '../server/storage.mjs';
import {APARTMENT_MASTER_SCHEMA} from '../server/apartment-master-schema.mjs';
import {dailyListingTargets,collectDailyListings,listingExport,readListingCollection} from '../server/daily-naver-listings.mjs';
import {BrowserListingError} from '../server/naver-browser-collector.mjs';
import {validListingSnapshot,kstListingDay,listingGroupForFavorite} from '../src/naver-listings.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {collectConfigured,prepareListingExport} from '../scripts/automation.mjs';
import {linkMasterTrades} from '../server/apartment-master.mjs';
import {encryptState,decryptState} from '../server/cloud-state.mjs';
import {synchronizeHousingIdentity,housingTradeBindings} from '../server/apartment-identity.mjs';
import {readNaverMatch} from '../server/apartment-naver-matches.mjs';

const config={version:1,time_kst:'01:00',recent_months:1,address_limit:1000,region_ids:['dong_41135103']};
test('deployment refreshes invalidated housing identity after legacy links and before reading listing groups',t=>{
 const db=fixture(t);synchronizeHousingIdentity(db);
 linkMasterTrades(db);assert.throws(()=>listingExport(db),/만료/);
 const snapshot=prepareListingExport(db);assert(validListingSnapshot(snapshot));assert(validListingSnapshot(prepareListingExport(db)));
});
test('daily collection resolves once, saves match before stock timeout, and next day goes directly to stored Naver ID',async t=>{
 const db=fixture(t);let tick=Date.parse('2026-11-08T00:00:00Z'),resolves=0,collects=0;
 const factory=async()=>({close:async()=>{},resolve:async target=>{
  resolves++;const complexNo=target.favorite.jibun==='1'?'111':'222';
  return {complexNo,observation:{complex_no:complexNo,name:target.favorite.apartment,road_address:target.favorite.road_address||'',parcel_address:target.favorite.region_name+' '+target.favorite.dong+' '+target.favorite.jibun,latitude:37.36,longitude:127.12,coordinate_role:'provider_label',source_url:`https://new.land.naver.com/complexes/${complexNo}`,observed_at:new Date(tick).toISOString()}};
 },collect:async(target,{complexNo})=>{collects++;assert.equal(complexNo,target.favorite.jibun==='1'?'111':'222');throw new BrowserListingError('timeout');}});
 await collectDailyListings(db,config,{now:()=>tick,sourceFactory:factory});assert.equal(resolves,2);
 const target=dailyListingTargets(db,config)[0];assert.equal(readNaverMatch(db,target).state,'verified');
 tick+=86400000;await collectDailyListings(db,config,{now:()=>tick,sourceFactory:factory});assert.equal(resolves,2);assert.equal(collects,4);
});
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA+APARTMENT_MASTER_SCHEMA);
  for(const [id,code,name,dong] of [['dong_41135103','41135','경기도 성남시 분당구','정자동'],['dong_41465101','41465','경기도 용인시 수지구','풍덕천동']]){
    db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?,?)').run(id,dong,code,name,JSON.stringify([dong]),null,null);
    db.prepare('INSERT INTO apartment_inventory_regions(region_id,legal_code,dong,status) VALUES(?,?,?,?)').run(id,id.slice(5)+'00',dong,'scanned');
  }
  const insert=db.prepare('INSERT INTO apartment_complexes(apartment_id,registry_root_id,region_code,legal_code,dong,name,jibun,road_address,active,fetched_at,inventory_run_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  insert.run('hub:a','a','41135','4113510300','정자동','아파트A','1','경기도 성남시 분당구 불정로 1',1,'2026-01-01Z',1);
  insert.run('hub:b','b','41135','4113510300','정자동',null,'2','',1,'2026-01-01Z',1);
  insert.run('hub:inactive','inactive','41135','4113510300','정자동','폐쇄단지','3','',0,'2026-01-01Z',1);
  insert.run('hub:other','other','41465','4146510100','풍덕천동','다른지역','4','',1,'2026-01-01Z',1);
  return db;
}
function source({onCollect=()=>{},now=()=>Date.parse('2026-11-06T00:00:00.000Z')}={}){
  return {close:async()=>{},collect:async(target,connection)=>{
    onCollect(target,connection);const at=new Date(now()).toISOString();
    return {favorite:target.favorite,complexNo:target.favorite.jibun==='1'?'111':'222',complexName:target.favorite.apartment,tradeType:'A1',status:'ready',attemptedAt:at,collectedAt:at,errorCode:null,articles:[],collectionMethod:'browser',coverage:'complete',pageCount:1,sourceUrl:`https://new.land.naver.com/complexes/${target.favorite.jibun==='1'?'111':'222'}`};
  }};
}

test('regional targets include unnamed and untraded apartments without personal favorites and exclude inactive/out-of-region rows',t=>{
  const db=fixture(t),targets=dailyListingTargets(db,config);assert.deepEqual(targets.map(t=>t.favorite.id),['hub:a','hub:b']);assert.match(targets[1].favorite.apartment,/이름 미확인/);assert.match(targets[1].query,/정자동 2/);
  db.prepare("UPDATE apartment_inventory_regions SET status='pending' WHERE region_id=?").run(config.region_ids[0]);assert.throws(()=>dailyListingTargets(db,config),/전체 아파트 목록/);
});

test('KST day and same-day attempts persist in DB; next Korean day recollects all targets',async t=>{
  const db=fixture(t),calls=[];let tick=Date.parse('2026-11-05T15:00:00.000Z');
  const options={now:()=>tick,sourceFactory:async()=>source({now:()=>tick,onCollect:target=>calls.push(target.favorite.id)})};
  assert.equal(kstListingDay('2026-11-05T14:59:59Z'),'2026-11-05');assert.equal(kstListingDay(tick),'2026-11-06');
  const first=await collectDailyListings(db,config,options);assert.equal(first.status,'complete');assert.equal(first.tradeType,'A1');assert.equal(first.successCount,2);
  assert.equal((await collectDailyListings(db,config,options)).alreadyCollected,true);assert.equal(calls.length,2);
  tick+=86400000;await collectDailyListings(db,config,options);assert.equal(calls.length,4);assert.equal(readListingCollection(db).dayKst,'2026-11-07');
});

test('a legacy mixed-type attempt does not skip the new sale-only collection on the same Korean day',async t=>{
  const db=fixture(t),options={now:()=>Date.parse('2026-11-06T00:00:00.000Z'),sourceFactory:async()=>source()};
  const old=await collectDailyListings(db,config,options);delete old.tradeType;
  db.prepare('UPDATE naver_listing_days SET report_json=?').run(JSON.stringify(old));
  const calls=[];
  const sale=await collectDailyListings(db,config,{...options,sourceFactory:async()=>source({onCollect:target=>calls.push(target.favorite.id)})});
  assert.equal(sale.tradeType,'A1');assert.equal(sale.alreadyCollected,undefined);assert.equal(calls.length,2);
  const resumed=await collectDailyListings(db,config,{...options,sourceFactory:async()=>{throw Error('must not repeat');}});
  assert.equal(resumed.alreadyCollected,true);
});

test('switching a failed old browser source to system Chrome retries the same day and then resumes without duplicates',async t=>{
  const db=fixture(t),options={now:()=>Date.parse('2026-11-06T00:00:00.000Z'),browserSource:'playwright',sourceFactory:async()=>({close:async()=>{},collect:async()=>{throw new BrowserListingError('site_unavailable');}})};
  const old=await collectDailyListings(db,config,options);assert.equal(old.status,'failed');
  const calls=[];
  const next={...options,browserSource:'system-chrome',sourceFactory:async()=>source({onCollect:target=>calls.push(target.favorite.id)})};
  const report=await collectDailyListings(db,config,next);assert.equal(report.status,'complete');assert.equal(report.browserSource,'system-chrome');assert.equal(calls.length,2);
  assert.equal((await collectDailyListings(db,config,next)).alreadyCollected,true);assert.equal(calls.length,2);
});

test('daily persistence refuses a rental mixed into a source claiming sale-only coverage',async t=>{
  const db=fixture(t),browser=source(),collect=browser.collect;
  browser.collect=async(...args)=>({...await collect(...args),articles:[{id:'123',tradeType:'B1'}]});
  await assert.rejects(collectDailyListings(db,config,{sourceFactory:async()=>browser}),/매매 매물 브라우저/);
  assert.equal(listingExport(db).groups.length,0);assert.equal(readListingCollection(db).successCount,0);
});

test('known per-apartment failures do not stop other apartments; previous successful snapshots survive with failure timestamps',async t=>{
  const db=fixture(t);let tick=Date.parse('2026-11-06T00:00:00.000Z');
  await collectDailyListings(db,config,{now:()=>tick,sourceFactory:async()=>source({now:()=>tick})});
  const before=listingExport(db).groups;tick+=86400000;
  const browser=source({now:()=>tick});const collect=browser.collect;browser.collect=async(target,connection)=>{if(target.favorite.id==='hub:a')throw new BrowserListingError('timeout');return collect(target,connection);};
  const report=await collectDailyListings(db,config,{now:()=>tick,sourceFactory:async()=>browser});assert.equal(report.status,'partial');assert.equal(report.successCount,1);assert.equal(report.failureCount,1);
  const snapshot=listingExport(db);assert(validListingSnapshot(snapshot));const previous=snapshot.groups.find(g=>g.favorite.id==='hub:a');assert.equal(previous.status,'failed');assert.equal(previous.collectedAt,before[0].collectedAt);assert.equal(previous.errorCode,'timeout');
});

test('retrying unresolved targets keeps successful observations and does not retry explicit access restrictions',async t=>{
 const db=fixture(t),options={now:()=>Date.parse('2026-11-08T00:00:00.000Z')},first=source();
 const collect=first.collect;first.collect=async target=>{if(target.favorite.id==='hub:b')throw new BrowserListingError('unmatched');return collect(target);};
 const before=await collectDailyListings(db,config,{...options,sourceFactory:async()=>first});assert.equal(before.successCount,1);
 const calls=[];const after=await collectDailyListings(db,config,{...options,retryUnresolved:true,sourceFactory:async()=>source({onCollect:target=>calls.push(target.favorite.id)})});
 assert.deepEqual(calls,['hub:b']);assert.equal(after.status,'complete');assert.equal(after.results[0].attemptedAt,before.results[0].attemptedAt);
 const blocked=await collectDailyListings(db,config,{...options,force:true,sourceFactory:async()=>({close:async()=>{},collect:async()=>{throw new BrowserListingError('blocked');}})});
 let attempted=false;const resumed=await collectDailyListings(db,config,{...options,retryUnresolved:true,sourceFactory:async()=>({close:async()=>{},collect:async()=>{attempted=true;throw new BrowserListingError('blocked');}})});
 assert.equal(resumed.failureCount,blocked.failureCount);assert.equal(attempted,false);
 const ordinaryResume=await collectDailyListings(db,config,{...options,sourceFactory:async()=>{attempted=true;throw Error('blocked day must not restart');}});
 assert.equal(ordinaryResume.failureCount,blocked.failureCount);assert.equal(attempted,false);
});

test('request limits stop remaining targets, remain distinct from zero ads, and force explicitly retries a completed day',async t=>{
  const db=fixture(t);let calls=0;
  const options={now:()=>Date.parse('2026-11-06T00:00:00.000Z'),sourceFactory:async()=>({close:async()=>{},collect:async()=>{calls++;throw new BrowserListingError('rate_limited');}})};
  const report=await collectDailyListings(db,config,options);assert.equal(calls,1);assert.equal(report.failureCount,1);assert.equal(report.notAttemptedCount,1);assert.equal(listingExport(db).groups.length,0);
  const held=await collectDailyListings(db,config,{...options,sourceFactory:async()=>{calls++;return source();}});assert.equal(held.successCount,0);assert.equal(held.failureCount,1);assert.equal(held.notAttemptedCount,1);assert.equal(calls,1);
  const retry=await collectDailyListings(db,config,{...options,force:true,sourceFactory:async()=>source()});assert.equal(retry.status,'complete');
});

test('a missing inventory and a time budget are explicit incomplete runs without launching a browser',async t=>{
  const db=fixture(t);let calls=0;
  const report=await collectDailyListings(db,config,{maxDurationMs:0,sourceFactory:async()=>{calls++;}});assert.equal(report.notAttemptedCount,2);assert.equal(calls,0);
  db.prepare('DELETE FROM apartment_inventory_regions').run();const missing=await collectDailyListings(db,config,{sourceFactory:async()=>{calls++;}});assert.equal(missing.errorCode,'inventory_unavailable');assert.equal(missing.status,'failed');assert.equal(calls,0);
  const custom=await collectDailyListings(db,{region_ids:['custom_41465_abcd1234abcd']},{sourceFactory:async()=>{calls++;}});assert.equal(custom.errorCode,'inventory_unavailable');assert.equal(custom.regionIds[0],'custom_41465_abcd1234abcd');assert.equal(calls,0);
});

test('legacy trade aliases alone do not prove listing coverage of a source complex',t=>{
  const db=fixture(t);db.prepare('INSERT INTO apartment_trade_links VALUES(?,?,?,?,?,?,?,?,?)').run('41135','정자동','1','이전신고명','hub:a','matched','address','[]','2026-11-06Z');
  const favorite=dailyListingTargets(db,config)[0].favorite,legacy=makeApartmentFavorite({...favorite,apartment:'이전신고명',master_id:undefined},favorite);
  const group={favorite,complexNo:'111'};assert.equal(listingGroupForFavorite([group],legacy),null);
  group.favorite={...favorite,identity_ref:{kind:'root',id:favorite.id},identity_coverage:{entity_ids:[legacy.id],root_ids:[favorite.id],cohort_ids:[]}};
  assert.equal(listingGroupForFavorite([group],legacy),group);assert.equal(listingGroupForFavorite([group],{...legacy,region_code:'11110'}),null);
});

test('daily targets split shared registry roots by official road and pass location outside favorites',t=>{
 const db=fixture(t);
 for(const [id,dong,number] of [['phase2','201','179'],['phase6','601','195']]){
  const title={mgmBldrgstPk:id,sigunguCd:'41135',bjdongCd:'10300',platGbCd:'0',bun:'0001',ji:'0000',bldNm:'아파트A',dongNm:dong,mainAtchGbCd:'0',mainPurpsCdNm:'공동주택',etcPurps:'아파트',newPlatPlc:'경기도 성남시 분당구 불정로 '+number,useAprDay:'19950101',naRoadCd:'411353012345',naUgrndCd:'0',naMainBun:number,naSubBun:'0'};
  db.prepare('INSERT INTO apartment_building_inventory VALUES(?,?,?,?,?,?,1,1)').run(id,'dong_41135103','4113510300','a','apartment',JSON.stringify({title,root_id:'a',scope:{region_code:'41135',region_name:'경기도 성남시 분당구',dong:'정자동'}}));
 }
 synchronizeHousingIdentity(db,{scopes:[{region_code:'41135',dongs:['정자동']}]});
 db.prepare('UPDATE apartment_identity SET naver_complex_no=?,naver_name=? WHERE apartment_id=?').run('999','잘못된 대표단지','hub:a');
 synchronizeHousingIdentity(db,{scopes:[{region_code:'41135',dongs:['정자동']}]});
 const targets=dailyListingTargets(db,config),split=targets.filter(target=>target.favorite.master_id==='hub:a');
 assert.equal(split.length,2);assert(split.every(target=>target.favorite.identity_ref.kind==='cohort'&&target.favorite.id.startsWith('cohort:hub:a:')));
 assert.deepEqual(new Set(split.map(target=>target.favorite.road_address)),new Set(['경기도 성남시 분당구 불정로 179','경기도 성남시 분당구 불정로 195']));
 assert(split.every(target=>target.location.roads.length===1&&!Object.hasOwn(target.favorite,'location')&&!target.complexNo));
 assert(targets.some(target=>target.favorite.id==='hub:b'));
});
test('a known office-only sibling cohort without reported APT membership is not a sale apartment target',t=>{
 const db=fixture(t);
 for(const [id,dong,number,type] of [['apartment','101','1','아파트'],['office','201','2','오피스텔']]){
  const title={mgmBldrgstPk:id,sigunguCd:'41135',bjdongCd:'10300',platGbCd:'0',bun:'0001',ji:'0000',bldNm:'아파트A',dongNm:dong,mainAtchGbCd:'0',mainPurpsCdNm:type==='아파트'?'공동주택':'업무시설',etcPurps:type,newPlatPlc:'경기도 성남시 분당구 불정로 '+number,useAprDay:'19950101'};
  db.prepare('INSERT INTO apartment_building_inventory VALUES(?,?,?,?,?,?,1,1)').run(id,'dong_41135103','4113510300','a',type==='아파트'?'apartment':'other',JSON.stringify({title,root_id:'a',scope:{region_code:'41135',region_name:'경기도 성남시 분당구',dong:'정자동'}}));
 }
 synchronizeHousingIdentity(db,{scopes:[{region_code:'41135',dongs:['정자동']}]});
 const scopes=dailyListingTargets(db,config).filter(target=>target.favorite.master_id==='hub:a');
 assert.equal(scopes.length,1);assert.equal(scopes[0].favorite.identity_ref.kind,'cohort');assert.equal(scopes[0].favorite.road_address,'경기도 성남시 분당구 불정로 1');
});
test('unmatched scopes are retried weekly or explicitly, rather than searched every day',async t=>{
 const db=fixture(t);let tick=Date.parse('2026-11-08T00:00:00Z'),calls=0;
 const factory=async()=>({close:async()=>{},collect:async()=>{calls++;throw new BrowserListingError('unmatched');}});
 await collectDailyListings(db,config,{now:()=>tick,sourceFactory:factory});assert.equal(calls,2);
 tick+=86400000;const next=await collectDailyListings(db,config,{now:()=>tick,sourceFactory:factory});assert.equal(next.unmatchedCount,2);assert.equal(calls,2);
 tick+=7*86400000;await collectDailyListings(db,config,{now:()=>tick,sourceFactory:factory});assert.equal(calls,4);
 await collectDailyListings(db,config,{now:()=>tick,sourceFactory:factory,retryUnresolved:true});assert.equal(calls,6);
});

test('verified source APT inventory-only residential cohorts remain typed without activating apartment masters',t=>{
 const db=fixture(t),title={mgmBldrgstPk:'office',sigunguCd:'41135',bjdongCd:'10300',platGbCd:'0',bun:'0009',ji:'0000',bldNm:'에버하임',dongNm:'에버하임',mainAtchGbCd:'0',mainPurpsCdNm:'업무시설',etcPurps:'오피스텔, 다세대주택',newPlatPlc:'경기도 성남시 분당구 시험로 9',useAprDay:'20150101'};
 db.prepare('INSERT INTO apartment_building_inventory VALUES(?,?,?,?,?,?,1,1)').run('office','dong_41135103','4113510300','office','other',JSON.stringify({title,root_id:'office',scope:{region_code:'41135',region_name:'경기도 성남시 분당구',dong:'정자동'}}));
 db.prepare('INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(1,'41135','202610','2026-10-01','에버하임','정자동','9',10000,84,3,2015,0,JSON.stringify({aptDong:'에버하임'}));
 synchronizeHousingIdentity(db,{scopes:[{region_code:'41135',dongs:['정자동']}]});
 const target=dailyListingTargets(db,config).find(target=>target.favorite.apartment==='에버하임');
 assert(target);assert.equal(target.favorite.identity_ref.kind,'cohort');assert.equal(target.favorite.reported_type,'APT');assert(target.legalTypes.includes('오피스텔'));assert(!target.legalTypes.includes('아파트'));assert.equal(target.favorite.master_id,undefined);assert.equal(db.prepare("SELECT count(*) n FROM apartment_complexes WHERE apartment_id='hub:office'").get().n,0);
});
test('a reported source can verify its market listings while a conflicting registry building stays unresolved',t=>{
 const db=fixture(t),title={mgmBldrgstPk:'building101',sigunguCd:'41135',bjdongCd:'10300',platGbCd:'0',bun:'0001',ji:'0000',bldNm:'아파트A',dongNm:'101',mainAtchGbCd:'0',mainPurpsCdNm:'공동주택',etcPurps:'아파트',newPlatPlc:'경기도 성남시 분당구 불정로 1',useAprDay:'19950101'};
 db.prepare('INSERT INTO apartment_building_inventory VALUES(?,?,?,?,?,?,1,1)').run('building101','dong_41135103','4113510300','a','apartment',JSON.stringify({title,root_id:'a',scope:{region_code:'41135',region_name:'경기도 성남시 분당구',dong:'정자동'}}));
 db.prepare('INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(1,'41135','202610','2026-10-01','아파트A','정자동','1',10000,84,3,1995,0,JSON.stringify({aptDong:'102'}));
 synchronizeHousingIdentity(db,{scopes:[{region_code:'41135',dongs:['정자동']} ]});
 db.prepare('UPDATE apartment_identity SET naver_complex_no=? WHERE apartment_id=?').run('111','hub:a');
 synchronizeHousingIdentity(db,{scopes:[{region_code:'41135',dongs:['정자동']} ]});
 const target=dailyListingTargets(db,config).find(target=>target.favorite.identity_ref?.kind==='source');
 assert(target);assert.equal(target.favorite.master_id,undefined);assert.equal(target.favorite.id,JSON.stringify(['41135','정자동','1','아파트A']));assert.equal(target.complexNo,'111');assert.equal(target.location.roads[0].road_address,title.newPlatPlc);
 assert.equal(housingTradeBindings(db).get(1).precision,'unresolved');
});

test('trade automation runs addresses then listings using saved regions; listing network failure does not discard completed trades',async t=>{
  const db=fixture(t),order=[];
  const result=await collectConfigured(db,config,{tradeKey:'trade',jusoKey:'address',now:new Date('2026-11-06T00:00:00Z'),onProgress:()=>{},collector:async()=>{order.push('trade');return 3;},addressCollector:async()=>{order.push('address');return {completed:1};},listingCollector:async(_db,settings)=>{order.push('listings');assert.deepEqual(settings.region_ids,config.region_ids);return {status:'failed'};}});
  assert.deepEqual(order,['trade','address','listings']);assert.equal(result.rows,3);assert.equal(result.listings.status,'failed');assert(db.prepare("SELECT value FROM metadata WHERE key='last_refresh'").get());
});

test('the shared trade job collects sale listings once per Korean day and its saved time matches the daily workflow',async t=>{
  const db=fixture(t),calls=[],options={tradeKey:'trade',jusoKey:'address',now:new Date('2026-11-06T00:00:00Z'),onProgress:()=>{},collector:async()=>1,addressCollector:async()=>({completed:0}),listingOptions:{sourceFactory:async()=>source({onCollect:target=>calls.push(target.favorite.id)})}};
  const first=await collectConfigured(db,config,options);assert.equal(first.listings.tradeType,'A1');assert.equal(first.listings.status,'complete');
  const again=await collectConfigured(db,config,options);assert.equal(again.listings.alreadyCollected,true);assert.deepEqual(calls,['hub:a','hub:b']);
  const saved=JSON.parse(fs.readFileSync(new URL('../automation/config.json',import.meta.url),'utf8'));
  const workflow=fs.readFileSync(new URL('../.github/workflows/refresh-data.yml',import.meta.url),'utf8');
  const [hour,minute]=saved.time_kst.split(':').map(Number);
  assert.equal(workflow.match(/- cron: '([^']+)' # collection-schedule/)[1],`${minute} ${(hour+15)%24} * * *`);
  assert.match(workflow,/node --dns-result-order=ipv4first scripts\/automation.mjs collect/);
});

test('new apartments added in the same day are attempted while existing targets remain untouched',async t=>{
  const db=fixture(t),calls=[],options={now:()=>Date.parse('2026-11-06T00:00:00.000Z'),sourceFactory:async()=>source({onCollect:target=>calls.push(target.favorite.id)})};
  await collectDailyListings(db,config,options);db.prepare("UPDATE apartment_complexes SET active=1 WHERE apartment_id='hub:inactive'").run();
  const report=await collectDailyListings(db,config,options);assert.equal(report.targetCount,3);assert.deepEqual(calls,['hub:a','hub:b','hub:inactive']);
});

test('removing a target and resuming after the final checkpoint finalize correct counts without recollecting',async t=>{
  const db=fixture(t),options={now:()=>Date.parse('2026-11-06T00:00:00.000Z'),sourceFactory:async()=>source()};
  await collectDailyListings(db,config,options);db.prepare("UPDATE apartment_complexes SET active=0 WHERE apartment_id='hub:b'").run();
  const report=readListingCollection(db);report.status='running';report.finishedAt=null;db.prepare('UPDATE naver_listing_days SET report_json=?').run(JSON.stringify(report));
  const resumed=await collectDailyListings(db,config,{...options,sourceFactory:async()=>{throw new Error('must not relaunch');}});assert.equal(resumed.targetCount,1);assert.equal(resumed.status,'complete');assert(resumed.finishedAt);assert.equal(resumed.alreadyCollected,true);
});

test('cancellation does not save a result returned after cancellation or silently finish the day',async t=>{
  const db=fixture(t),controller=new AbortController(),browser=source();const collect=browser.collect;
  browser.collect=async(...args)=>{const group=await collect(...args);controller.abort();return group;};
  await assert.rejects(collectDailyListings(db,config,{signal:controller.signal,sourceFactory:async()=>browser}),error=>error.name==='AbortError');
  assert.equal(listingExport(db).groups.length,0);assert.equal(readListingCollection(db).status,'running');
});

test('ambiguous generic official names use verified trade aliases for search',t=>{
  const db=fixture(t);db.prepare("UPDATE apartment_complexes SET name='정든마을' WHERE apartment_id IN ('hub:a','hub:b')").run();
  db.prepare('INSERT INTO apartment_trade_links VALUES(?,?,?,?,?,?,?,?,?)').run('41135','정자동','1','정든마을(2단지)(동아)','hub:a','matched','address','[]','2026-11-06Z');
  assert.equal(dailyListingTargets(db,config)[0].query,'정자동 정든마을2단지');
});

test('a generic official name uses the numbered phase from its verified trade alias in the search query',t=>{
  const db=fixture(t);db.prepare("UPDATE apartment_complexes SET name='삼성아파트' WHERE apartment_id='hub:a'").run();
  db.prepare('INSERT INTO apartment_trade_links VALUES(?,?,?,?,?,?,?,?,?)').run('41135','정자동','1','삼성1','hub:a','matched','address','[]','2026-11-06Z');
  assert.equal(dailyListingTargets(db,config)[0].query,'정자동 삼성1차');
});

test('encrypted working DB restore retains daily attempts, connections and snapshots',async t=>{
  const db=fixture(t),options={now:()=>Date.parse('2026-11-06T00:00:00.000Z'),sourceFactory:async()=>source()};await collectDailyListings(db,config,options);
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'daily-listing-state-'));t.after(()=>{const absolute=path.resolve(folder);assert(absolute.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(absolute).startsWith('daily-listing-state-'));fs.rmSync(absolute,{recursive:true,force:true});});
  const original=path.join(folder,'original.sqlite3'),restored=path.join(folder,'restored.sqlite3');await backup(db,original);
  fs.writeFileSync(restored,decryptState(encryptState(fs.readFileSync(original),'b2'.repeat(32)),'b2'.repeat(32)));
  const reopened=new DatabaseSync(restored);try{
    assert.equal(reopened.prepare('SELECT count(*) AS n FROM naver_listing_connections').get().n,2);
    assert.equal(listingExport(reopened).groups.length,2);
    const result=await collectDailyListings(reopened,config,{...options,sourceFactory:async()=>{throw new Error('already collected');}});assert.equal(result.alreadyCollected,true);
  }finally{reopened.close();}
});
