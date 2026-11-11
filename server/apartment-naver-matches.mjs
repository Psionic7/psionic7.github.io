import {createHash} from 'node:crypto';
import {NAVER_LISTING_SCHEMA} from './naver-listing-schema.mjs';
import {verifyComplexEvidence} from './naver-listings.mjs';
import {housingLocationEvidence,housingObservation,housingPoint} from './housing-location.mjs';
import {normalizeRoadAddress,normalizeParcel} from '../src/address-identity.mjs';
import {complexUrl,validComplexNo,validListingObservation,validListingGroup} from '../src/naver-listings.mjs';
import {readInstalledBaseline} from './apartment-baseline-state.mjs';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const sorted=values=>values.map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
export function naverMatchScope(target) {
  const f=target.favorite;
  const location=target.location;
  const scope=location?{
    anchors:sorted((location.anchors||[]).map(({latitude,longitude,source,role,crs})=>({latitude,longitude,source,role,crs}))),
    roads:sorted((location.roads||[]).map(({road_address,source})=>({road:normalizeRoadAddress(road_address),source}))),
    parcels:sorted((location.parcels||[]).map(({jibun,relation,source})=>({parcel:normalizeParcel(jibun),relation,source}))),
    primary_parcels:sorted((location.primary_parcels||[]).map(({pnu,geometry,source})=>({pnu,geometry,source}))),
    exclusive_building_dongs:sorted(location.exclusive_building_dongs||[]),
  }:null;
  return createHash('sha256').update(JSON.stringify(stable({id:f.id,region:f.region_code,dong:f.dong,parcel:normalizeParcel(f.jibun),road:normalizeRoadAddress(f.road_address),location:scope}))).digest('hex');
}
export function readNaverMatch(db,target) {
  const row=db.prepare('SELECT * FROM apartment_naver_matches WHERE target_id=?').get(target.favorite.id);
  if(!row)return null;
  const observation=row.observation_json?JSON.parse(row.observation_json):null;
  const sharedCurrent=!observation?.shared_scope||target.location?.shared_provider?.complexNo===row.complex_no;
  return {...row,scopeCurrent:row.scope_hash===naverMatchScope(target)&&sharedCurrent,observation};
}

function sharedNaverTarget(db,target,representative,scope) {
  const {shared_provider,...location}=target.location||{};
  target={...target,location};
  const match=representative&&readNaverMatch(db,representative);
  if(!match||match.state!=='verified'||match.active!==1||!match.scopeCurrent||match.observation?.shared_scope)return target;
  if(target.favorite.id===representative.favorite.id||target.favorite.region_code!==representative.favorite.region_code||target.favorite.dong!==representative.favorite.dong)return target;
  if(scope.target_scope_hash!==naverMatchScope(target)||scope.representative_scope_hash!==naverMatchScope(representative))return target;
  if(!Array.isArray(scope.building_witnesses)||scope.building_witnesses.length>1000||scope.building_witnesses.some(dong=>typeof dong!=='string'||!dong||dong.length>100))return target;
  return {...target,location:{...target.location,shared_provider:{complexNo:match.complex_no,representative,scope}}};
}

export function attachNaverSharedScopes(db,targets) {
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='apartment_naver_matches'").get())return targets;
  const byId=new Map(targets.map(target=>[target.favorite.id,target]));
  return targets.map(target=>{
    const match=readNaverMatch(db,target),scope=match?.observation?.shared_scope;
    if(!scope||match.state!=='verified'||match.active!==1||match.scope_hash!==naverMatchScope(target))return target;
    const next=sharedNaverTarget(db,target,byId.get(scope.representative_target_id),scope);
    return next.location?.shared_provider?.complexNo===match.complex_no?next:target;
  });
}

export function verifyNaverSharedMatch(db,target,representative,value) {
  if(!validListingGroup(value)||value.status!=='ready'||value.coverage!=='complete'||value.favorite.id!==representative.favorite.id)throw Error('공유 단지 연결에는 대표 범위에서 수집한 전체 원본 매물이 필요합니다.');
  const scope={representative_target_id:representative.favorite.id,representative_scope_hash:naverMatchScope(representative),target_scope_hash:naverMatchScope(target),building_witnesses:[]};
  const scoped=sharedNaverTarget(db,target,representative,scope);
  if(!scoped.location?.shared_provider||scoped.location.shared_provider.complexNo!==value.complexNo)throw Error('현재 범위에서 확정된 대표 단지 연결이 필요합니다.');
  verifyNaverObservation(representative,value);
  const verified=verifyNaverObservation(scoped,value);
  if(!verified.observation.shared_scope?.building_witnesses.length)throw Object.assign(Error('공유 범위의 실제 등록 동 매물이 없습니다.'),{code:'address_mismatch'});
  return {...verified,target:scoped};
}

export function recordNaverSharedMatch(db,target,representative,value,{at=new Date().toISOString()}={}) {
  const {target:scoped}=verifyNaverSharedMatch(db,target,representative,value);
  return recordNaverMatch(db,scoped,value,{at});
}
export function synchronizeNaverMatches(db,targets,catalog) {
  if(readInstalledBaseline(db))throw Error('단지 연결 승인은 로컬 기준 DB에서 수행하세요.');
  db.exec(NAVER_LISTING_SCHEMA);
  const write=db.prepare(`INSERT INTO apartment_naver_matches(target_id,scope_hash,favorite_json,state,complex_no,reason,active) VALUES(?,?,?,'pending',?,'initial',1)
    ON CONFLICT(target_id) DO UPDATE SET active=1,favorite_json=excluded.favorite_json,
    state=CASE WHEN scope_hash<>excluded.scope_hash THEN 'review' ELSE state END,
    reason=CASE WHEN scope_hash<>excluded.scope_hash THEN 'scope_changed' ELSE reason END,scope_hash=excluded.scope_hash`);
  db.exec('SAVEPOINT naver_match_scopes');
  try{
    db.exec('UPDATE apartment_naver_matches SET active=0; UPDATE apartment_naver_sources SET active=0');
    const sourceWrite=db.prepare(`INSERT INTO apartment_naver_sources VALUES(?,?,?,?,1) ON CONFLICT(source_entity_id,target_id) DO UPDATE SET scope_json=excluded.scope_json,registry_state=excluded.registry_state,active=1`);
    for(const target of targets){
      const legacy=target.complexNo||db.prepare('SELECT complex_no FROM naver_listing_connections WHERE apartment_id=?').get(target.favorite.id)?.complex_no||null;
      write.run(target.favorite.id,naverMatchScope(target),JSON.stringify(target.favorite),legacy);
      const f=target.favorite,cohorts=new Set(f.identity_coverage?.cohort_ids||[]);
      for(const entity of catalog.entities||[]){
        const members=(entity.favorite?.identity_listing_members||[]).filter(member=>cohorts.has(member.cohort_id));
        if(f.id!==entity.entity_id&&!members.length&&!f.identity_coverage?.entity_ids.includes(entity.entity_id)&&!f.identity_related_sources?.includes(entity.entity_id))continue;
        sourceWrite.run(entity.entity_id,f.id,JSON.stringify({identity_ref:f.identity_ref||{kind:'root',id:f.id},members,reported_buildings:entity.favorite?.identity_reported_buildings||[]}),entity.state);
      }
    }
    db.exec('RELEASE naver_match_scopes');
  }catch(error){db.exec('ROLLBACK TO naver_match_scopes; RELEASE naver_match_scopes');throw error;}
  return naverMatchStats(db);
}
export function verifyNaverObservation(target,value) {
  const observation=value.observation;
  if(!validComplexNo(value.complexNo)||!validListingObservation(observation,value))throw Error('네이버 연결의 실제 관측 정보가 없습니다.');
  const prefix=target.favorite.region_name+' '+target.favorite.dong;
  if(!observation.parcel_address.startsWith(prefix+' '))throw Object.assign(Error('네이버 관측 행정구역 불일치'),{code:'address_mismatch'});
  const detail={complexNo:value.complexNo,complexName:observation.name,cortarAddress:prefix,detailAddress:observation.parcel_address.slice(prefix.length+1),roadAddress:observation.road_address,latitude:observation.latitude,longitude:observation.longitude,realEstateTypeCode:observation.real_estate_type};
  const verification=verifyComplexEvidence({complexDetail:detail,article_building_dongs:value.articles?.map(article=>article.building)||observation.building_witnesses||[]},target.favorite,value.complexNo,target.location);
  return {observation:{...housingObservation(detail,{sourceUrl:complexUrl(value.complexNo),observedAt:observation.observed_at,verificationMethod:verification.method,buildingWitnesses:verification.buildingWitnesses}),...(verification.sharedScope?{shared_scope:verification.sharedScope}:{})},evidence:housingLocationEvidence(target.location,detail)};
}
export function recordNaverMatch(db,target,value,{at=new Date().toISOString()}={}) {
  if(readInstalledBaseline(db))throw Error('단지 연결 승인은 로컬 기준 DB에서 수행하세요.');
  const {observation,evidence}=verifyNaverObservation(target,value),point=housingPoint(observation);
  const previous=readNaverMatch(db,target);
  if(!point&&previous?.state==='verified'&&previous.scopeCurrent&&previous.complex_no===value.complexNo){
    db.prepare('UPDATE apartment_naver_matches SET last_attempted_at=?,reason=? WHERE target_id=?').run(at,'provider_coordinate_missing',target.favorite.id);
    return readNaverMatch(db,target);
  }
  const state=point?'verified':'pending';
  db.prepare(`UPDATE apartment_naver_matches SET scope_hash=?,favorite_json=?,state=?,complex_no=?,observation_json=?,evidence_json=?,
    first_matched_at=COALESCE(first_matched_at,?),last_verified_at=?,last_attempted_at=?,reason=? WHERE target_id=?`).run(
    naverMatchScope(target),JSON.stringify(target.favorite),state,value.complexNo,JSON.stringify(observation),JSON.stringify(evidence),point?at:null,point?at:null,at,point?null:'provider_coordinate_missing',target.favorite.id);
  return readNaverMatch(db,target);
}
export function recordNaverMatchFailure(db,target,code,{at=new Date().toISOString()}={}) {
  if(readInstalledBaseline(db))throw Error('단지 연결 검토는 로컬 기준 DB에서 수행하세요.');
  if(!['address_mismatch','unmatched'].includes(code))return;
  db.prepare('UPDATE apartment_naver_matches SET state=?,last_attempted_at=?,reason=? WHERE target_id=?').run(code==='address_mismatch'?'review':'unmatched',at,code,target.favorite.id);
}
export function seedNaverMatches(db,targets,catalog,{groups=[],collection}={}) {
  synchronizeNaverMatches(db,targets,catalog);
  const byId=new Map(groups.map(group=>[group.favorite.id,group]));
  for(const target of targets){
    const saved=readNaverMatch(db,target),group=byId.get(target.favorite.id);
    if(saved.state==='verified'&&saved.scopeCurrent)continue;
    if(group?.collectedAt&&group.observation){
      try{recordNaverMatch(db,target,group,{at:group.observation.observed_at});continue;}
      catch(error){if(error.code!=='address_mismatch')throw error;recordNaverMatchFailure(db,target,error.code);continue;}
    }
    if(group?.complexNo&&validComplexNo(group.complexNo)&&saved.state==='pending')db.prepare('UPDATE apartment_naver_matches SET complex_no=?,reason=? WHERE target_id=?').run(group.complexNo,'legacy_requires_observation',target.favorite.id);
    const attempt=collection?.results.find(row=>row.favoriteId===target.favorite.id);
    if(attempt?.status==='unmatched')recordNaverMatchFailure(db,target,attempt.errorCode,{at:attempt.attemptedAt});
  }
  return naverMatchStats(db);
}
export function applyNaverMatchSeed(db,targets,seed) {
  if(!seed||seed.version!==1||!Array.isArray(seed.matches)||seed.matches.length>1000)throw Error('네이버 초기 연결 자료 형식을 확인하세요.');
  const byTarget=new Map(targets.map(target=>[target.favorite.id,target]));let imported=0;
  const ordered=[...seed.matches.filter(item=>!item.observation?.shared_scope),...seed.matches.filter(item=>item.observation?.shared_scope)];
  for(const item of ordered){
    const target=byTarget.get(item.target_id);if(!target)continue;
    const previous=readNaverMatch(db,target);
    if(!previous||previous.state!=='pending'||previous.last_attempted_at||item.scope_hash!==naverMatchScope(target))continue;
    if(typeof item.attempted_at!=='string'||!Number.isFinite(Date.parse(item.attempted_at)))throw Error('네이버 초기 연결 확인 시각을 확인하세요.');
    if(item.state==='unmatched')recordNaverMatchFailure(db,target,'unmatched',{at:item.attempted_at});
    else if(item.state==='verified'){
      const scope=item.observation?.shared_scope;
      const scoped=scope?sharedNaverTarget(db,target,byTarget.get(scope.representative_target_id),scope):target;
      if(scope&&!scoped.location?.shared_provider)continue;
      const result=recordNaverMatch(db,scoped,{complexNo:item.complex_no,observation:item.observation},{at:item.attempted_at});
      if(result.state!=='verified')throw Error('네이버 초기 연결에 실제 좌표가 없습니다.');
    }else throw Error('네이버 초기 연결 상태를 확인하세요.');
    imported++;
  }
  return imported;
}
export function exportNaverMatchSeed(db) {
  const rows=db.prepare("SELECT target_id,scope_hash,state,complex_no,observation_json,last_verified_at,last_attempted_at FROM apartment_naver_matches WHERE active=1 AND state IN ('verified','unmatched') ORDER BY target_id").all();
  return {version:1,matches:rows.map(row=>row.state==='verified'?{target_id:row.target_id,scope_hash:row.scope_hash,state:row.state,complex_no:row.complex_no,observation:JSON.parse(row.observation_json),attempted_at:row.last_verified_at}:{target_id:row.target_id,scope_hash:row.scope_hash,state:row.state,attempted_at:row.last_attempted_at})};
}
export function naverMatchStats(db) {
  const states=Object.fromEntries(db.prepare('SELECT state,count(*) n FROM apartment_naver_matches WHERE active=1 GROUP BY state').all().map(row=>[row.state,row.n]));
  const sourceEntities=db.prepare('SELECT count(DISTINCT source_entity_id) n FROM apartment_naver_source_connections').get().n,linkedSources=db.prepare("SELECT count(DISTINCT source_entity_id) n FROM apartment_naver_source_connections WHERE state='verified'").get().n;
  const partiallyLinkedSources=db.prepare("SELECT count(*) n FROM (SELECT source_entity_id FROM apartment_naver_source_connections GROUP BY source_entity_id HAVING sum(state='verified')>0 AND sum(state<>'verified')>0)").get().n;
  return {states,targets:Object.values(states).reduce((a,b)=>a+b,0),providerComplexes:db.prepare("SELECT count(DISTINCT complex_no) n FROM apartment_naver_matches WHERE active=1 AND state='verified'").get().n,sourceConnections:db.prepare('SELECT count(*) n FROM apartment_naver_source_connections').get().n,sourceEntities,linkedSources,partiallyLinkedSources,unlinkedSources:sourceEntities-linkedSources};
}
