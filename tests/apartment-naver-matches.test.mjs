import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {synchronizeNaverMatches,recordNaverMatch,recordNaverMatchFailure,readNaverMatch,naverMatchScope,naverMatchStats,applyNaverMatchSeed,exportNaverMatchSeed} from '../server/apartment-naver-matches.mjs';

const favorite=makeApartmentFavorite({apartment:'테스트아파트',dong:'정자동',jibun:'1',road_address:'경기도 성남시 분당구 불정로 1',master_id:'hub:a'},{region_code:'41135',region_name:'경기도 성남시 분당구'});
const target={favorite:{...favorite,identity_coverage:{entity_ids:['source:a'],cohort_ids:['cohort:a'],root_ids:['hub:a']}},location:{anchors:[{latitude:37.36,longitude:127.12,role:'entrance',crs:'EPSG:4326',source:'official'}],roads:[{road_address:favorite.road_address,source:'official'}]}};
const catalog={entities:[{entity_id:'source:a',state:'partial',favorite:{identity_listing_members:[{cohort_id:'cohort:a',whole_cohort:false,building_dongs:['101']}]}}]};
function dbFixture(t,targets=[target]){const db=new DatabaseSync(':memory:');t.after(()=>db.close());synchronizeNaverMatches(db,targets,catalog);return db;}
function observation(t=target){return {complexNo:'111',observation:{complex_no:'111',name:favorite.apartment,road_address:favorite.road_address,parcel_address:favorite.region_name+' '+favorite.dong+' 1',latitude:37.3602,longitude:127.1201,coordinate_role:'provider_label',source_url:'https://new.land.naver.com/complexes/111',observed_at:'2026-11-08T01:00:00.000Z'}};}

test('persistent source→target→Naver links keep actual point, verification evidence and registry review separate',t=>{
 const db=dbFixture(t),value=observation();recordNaverMatch(db,target,value,{at:value.observation.observed_at});
 const row=readNaverMatch(db,target);assert.equal(row.state,'verified');assert.equal(row.observation.latitude,37.3602);assert.notEqual(row.observation.latitude,target.location.anchors[0].latitude);
 assert(JSON.parse(row.evidence_json).nearest_anchor_m>0);assert.equal(db.prepare('SELECT registry_state FROM apartment_naver_source_connections').get().registry_state,'partial');
 synchronizeNaverMatches(db,[target],catalog);assert.equal(readNaverMatch(db,target).first_matched_at,value.observation.observed_at);assert.equal(naverMatchStats(db).linkedSources,1);
});
test('trade counts, aliases, collection timestamps and sorting do not invalidate identity; official address changes require review',t=>{
 const db=dbFixture(t);recordNaverMatch(db,target,observation());
 const next={...target,favorite:{...target.favorite,name_aliases:['새로운 신고 이름'],identity_coverage:{...target.favorite.identity_coverage,entity_ids:['source:a','source:b']}},location:{...target.location,collectedAt:'tomorrow'}};
 assert.equal(naverMatchScope(next),naverMatchScope(target));synchronizeNaverMatches(db,[next],catalog);assert.equal(readNaverMatch(db,next).state,'verified');
 const changed={...next,favorite:{...next.favorite,road_address:'경기도 성남시 분당구 불정로 99'}};
 synchronizeNaverMatches(db,[changed],catalog);assert.equal(readNaverMatch(db,changed).state,'review');assert.equal(readNaverMatch(db,changed).reason,'scope_changed');
});
test('shared provider number is many-to-many, while inactive scopes and mismatches cannot remain confirmed',t=>{
 const second={...target,favorite:{...target.favorite,id:'cohort:b',identity_ref:{kind:'cohort',id:'cohort:b'}}};
 const db=dbFixture(t,[target,second]);for(const item of [target,second])recordNaverMatch(db,item,observation());
 assert.equal(naverMatchStats(db).providerComplexes,1);assert.equal(naverMatchStats(db).sourceConnections,2);
 recordNaverMatchFailure(db,second,'timeout');assert.equal(readNaverMatch(db,second).state,'verified');
 recordNaverMatchFailure(db,second,'address_mismatch');assert.equal(readNaverMatch(db,second).state,'review');
 assert.equal(naverMatchStats(db).partiallyLinkedSources,1);
 synchronizeNaverMatches(db,[target],catalog);assert.equal(db.prepare('SELECT count(*) n FROM apartment_naver_source_connections').get().n,1);
 assert.equal(db.prepare('SELECT active FROM apartment_naver_matches WHERE target_id=?').get(second.favorite.id).active,0);
});
test('legacy address proof lacking observed coordinates stays pending; contradictory provider parcel is rejected',t=>{
 const db=dbFixture(t),value=observation();delete value.observation.latitude;delete value.observation.longitude;delete value.observation.coordinate_role;
 recordNaverMatch(db,target,value);assert.equal(readNaverMatch(db,target).state,'pending');assert.equal(readNaverMatch(db,target).reason,'provider_coordinate_missing');
 const bad=observation();bad.observation.parcel_address=favorite.region_name+' '+favorite.dong+' 999';bad.observation.road_address='경기도 성남시 분당구 다른길 999';
 assert.throws(()=>recordNaverMatch(db,target,bad),error=>error.code==='address_mismatch');
});
test('a later response with no coordinates does not erase an existing verified provider point or its verification time',t=>{
 const db=dbFixture(t),value=observation();recordNaverMatch(db,target,value,{at:value.observation.observed_at});
 const noPoint=observation();delete noPoint.observation.latitude;delete noPoint.observation.longitude;delete noPoint.observation.coordinate_role;
 recordNaverMatch(db,target,noPoint,{at:'2026-11-09T01:00:00.000Z'});
 const row=readNaverMatch(db,target);assert.equal(row.state,'verified');assert.equal(row.observation.latitude,value.observation.latitude);
 assert.equal(row.last_verified_at,value.observation.observed_at);assert.equal(row.last_attempted_at,'2026-11-09T01:00:00.000Z');
});
test('initial verified links restore in a fresh working DB only when the official scope agrees and no decision already exists',t=>{
 const original=dbFixture(t),fresh=dbFixture(t),changed=dbFixture(t),held=dbFixture(t);
 recordNaverMatch(original,target,observation(),{at:'2026-11-08T01:00:00.000Z'});
 const seed=exportNaverMatchSeed(original);assert.equal(applyNaverMatchSeed(fresh,[target],seed),1);
 assert.equal(readNaverMatch(fresh,target).state,'verified');assert.equal(readNaverMatch(fresh,target).last_verified_at,'2026-11-08T01:00:00.000Z');
 assert.equal(applyNaverMatchSeed(fresh,[target],seed),0);
 const searched=dbFixture(t),negative={...seed,matches:[{target_id:target.favorite.id,scope_hash:naverMatchScope(target),state:'unmatched',attempted_at:'2026-11-08T01:00:00.000Z'}]};
 assert.equal(applyNaverMatchSeed(searched,[target],negative),1);assert.equal(readNaverMatch(searched,target).state,'unmatched');
 const moved={...target,favorite:{...target.favorite,road_address:'경기도 성남시 분당구 불정로 99'}};
 synchronizeNaverMatches(changed,[moved],catalog);assert.equal(applyNaverMatchSeed(changed,[moved],seed),0);
 recordNaverMatchFailure(held,target,'unmatched');assert.equal(applyNaverMatchSeed(held,[target],seed),0);assert.equal(readNaverMatch(held,target).state,'unmatched');
 assert.throws(()=>applyNaverMatchSeed(fresh,[target],{version:2,matches:[]}));
});
