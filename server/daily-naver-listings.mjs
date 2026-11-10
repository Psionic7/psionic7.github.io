import {makeApartmentFavorite,validApartmentFavorites,sameApartmentFavorite} from '../src/apartment-favorites.js';
import fs from 'node:fs';
import {LISTING_ERRORS,LISTING_TRADE_TYPE,saleListingGroup,kstListingDay,listingSnapshot,validListingCollection,validListingGroup,validListingSnapshot,listingGroupForFavorite} from '../src/naver-listings.mjs';
import {NAVER_LISTING_SCHEMA} from './naver-listing-schema.mjs';
import {createDailyListingSource} from './naver-listing-source.mjs';
import {listingQueryName} from './naver-listing-names.mjs';
import {normalizeRoadAddress} from '../src/address-identity.mjs';
import {listingBuildingMembers} from '../src/housing-identity.mjs';
import {apartmentInformation,publicApartmentInformation,resolveApartmentIdentity,synchronizeApartmentIdentity,synchronizeHousingIdentity,housingIdentityCatalog} from './apartment-identity.mjs';
import {synchronizeNaverMatches,readNaverMatch,recordNaverMatch,recordNaverMatchFailure,applyNaverMatchSeed} from './apartment-naver-matches.mjs';

const hasTable=(db,name)=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
const UNMATCHED_RETRY_MS=7*24*60*60*1000;
const missingInventory=message=>{const error=new Error(message);error.code='inventory_unavailable';throw error;};
function listingScopes(db,config) {
  if(!hasTable(db,'apartment_complexes')||!hasTable(db,'apartment_inventory_regions'))missingInventory('매물 수집 대상 아파트 대장이 없습니다.');
  const regionRows=db.prepare('SELECT * FROM regions').all(),byId=new Map(regionRows.map(r=>[r.region_id,r]));
  const scopes=config.region_ids.map(id=>{
    const region=byId.get(id),inventory=db.prepare('SELECT * FROM apartment_inventory_regions WHERE region_id=?').get(id);
    if(!region||!inventory||inventory.status!=='scanned')missingInventory('매물 수집 대상 지역의 전체 아파트 목록을 먼저 확인하세요.');
    return {...region,legal_code:id.slice(5)+'00'};
  });
  return scopes;
}
export function dailyListingTargets(db,config) {
  const scopes=listingScopes(db,config),byCode=new Map(scopes.map(r=>[r.legal_code,r]));
  const rows=db.prepare('SELECT * FROM apartment_complexes WHERE active=1 ORDER BY legal_code,apartment_id').all().filter(row=>byCode.has(row.legal_code));
  if(!rows.length)missingInventory('매물 수집 대상 아파트 목록이 비어 있습니다.');
  if(rows.length>1000)throw new Error('매물 수집 대상 아파트가 저장 한도 1,000개를 초과했습니다.');
  const nameCounts=new Map();for(const row of rows){const key=row.legal_code+'|'+row.name;nameCounts.set(key,(nameCounts.get(key)||0)+1);}
  const information=new Map(apartmentInformation(db).map(row=>[row.apartment_id,row]));
  const legacy=rows.map(row=>{
    const info=information.get(row.apartment_id);
    const scope=byCode.get(row.legal_code),apartment=info?.canonical_name||row.name?.trim()||`이름 미확인 아파트 (${row.dong} ${row.jibun||'지번 미확인'})`;
    const trade_keys=info?.trade_keys||(hasTable(db,'apartment_trade_links')?db.prepare("SELECT dong,jibun,trade_name AS apartment FROM apartment_trade_links WHERE apartment_id=? AND status='matched'").all(row.apartment_id).map(r=>JSON.stringify([r.dong,r.jibun,r.apartment])):[]);
    const favorite={...makeApartmentFavorite({...row,apartment,master_id:row.apartment_id,trade_keys:[...new Set(trade_keys)]},{region_code:row.region_code,region_name:scope.region_name}),...(info?{name_aliases:info.name_aliases,postal_code:info.postal_code}:{} )};
    if(!validApartmentFavorites([favorite]))throw new Error('매물 수집 대상 아파트 식별자를 확인하세요.');
    const tradeNames=trade_keys.map(key=>JSON.parse(key)[2]).sort((a,b)=>b.length-a.length);
    const queryName=info?.naver_name||listingQueryName(favorite,info?.canonical_name||(row.name?.trim()&&nameCounts.get(row.legal_code+'|'+row.name)===1?row.name.trim():tradeNames[0]||row.name?.trim()));
    return {favorite,regionId:scope.region_id,...(info?.naver_complex_no?{complexNo:info.naver_complex_no}:{}),query:queryName?`${row.dong} ${queryName}`:`${scope.region_name} ${row.dong} ${row.jibun}`};
  });
  const catalog=housingIdentityCatalog(db),rootById=new Map(catalog.roots.map(root=>[root.root_id,root]));
  const targetById=new Map(legacy.map(target=>[target.favorite.id,target])),targets=[];
  for(const rootTarget of legacy){
    const root=rootById.get(rootTarget.favorite.id),allCohorts=catalog.cohorts.filter(cohort=>cohort.root_id===rootTarget.favorite.id);
    const cohorts=allCohorts.filter(cohort=>cohort.legal_types.some(type=>['아파트','노인복지주택'].includes(type))||cohort.entity_ids.length||cohort.partial_entity_ids.length);
    if(!allCohorts.length){targets.push(rootTarget);continue;}
    if(!cohorts.length)continue;
    for(const cohort of cohorts){
      const single=allCohorts.length===1;
      const favorite={...(single?{...rootTarget.favorite,road_address:cohort.favorite.road_address,identity_ref:{kind:'root',id:root.root_id},identity_coverage:{entity_ids:root.entity_ids,cohort_ids:root.cohort_ids,root_ids:[root.root_id]},identity_related_sources:root.partial_entity_ids}:cohort.favorite),identity_listing_members:listingBuildingMembers([cohort])};
      const info=information.get(cohort.master_id),name=single?info?.naver_name||listingQueryName(favorite):listingQueryName(favorite);
      const location={...cohort.location,exclusive_building_dongs:cohort.building_dongs.filter(dong=>!allCohorts.some(other=>other.cohort_id!==cohort.cohort_id&&other.building_dongs.includes(dong)))};
      targets.push({favorite,regionId:rootTarget.regionId,location,legalTypes:cohort.legal_types,query:name?`${favorite.dong} ${name}`:rootTarget.query,...(single&&rootTarget.complexNo?{complexNo:rootTarget.complexNo}:{})});
    }
  }
  for(const cohort of catalog.cohorts){
    if(cohort.master_id||targetById.has(cohort.root_id)||!cohort.entity_ids.length&&!cohort.partial_entity_ids.length)continue;
    const favorite={...cohort.favorite,reported_type:'APT',legal_types:cohort.legal_types},scope=scopes.find(scope=>{const dongs=JSON.parse(scope.dongs_json);return scope.region_code===favorite.region_code&&(!dongs.length||dongs.includes(favorite.dong));});
    if(!scope)continue;
    targets.push({favorite,regionId:scope.region_id,location:cohort.location,legalTypes:cohort.legal_types,query:`${favorite.dong} ${listingQueryName(favorite)||favorite.apartment}`});
  }
  for(const entity of catalog.entities.filter(entity=>entity.state==='insufficient'&&!entity.cohort_ids.length)){
    const favorite={...entity.favorite,reported_type:'APT'},scope=scopes.find(scope=>scope.region_code===favorite.region_code&&JSON.parse(scope.dongs_json).includes(favorite.dong));
    if(!scope||!catalog.cohorts.length)continue;
    const hint=resolveApartmentIdentity(db,favorite,[...information.values()]),units=hint.status==='matched'?catalog.cohorts.filter(cohort=>cohort.root_id===hint.apartment_id):[];
    const location=units.length?Object.fromEntries(['anchors','primary_parcels','roads','parcels'].map(field=>[field,units.flatMap(unit=>unit.location[field]||[])])):undefined;
    const complexNo=hint.status==='matched'?information.get(hint.apartment_id)?.naver_complex_no:null;
    targets.push({favorite,regionId:scope.region_id,...(location?{location}:{}),...(complexNo?{complexNo}:{}),query:`${favorite.dong} ${favorite.apartment}`});
  }
  if(targets.length>1000)throw new Error('매물 수집 대상 아파트가 저장 한도 1,000개를 초과했습니다.');
  if(!validApartmentFavorites(targets.map(target=>target.favorite)))throw new Error('매물 수집 대상 아파트 식별자를 확인하세요.');
  return targets;
}

function summarize(report) {
  const count=status=>report.results.filter(r=>r.status===status).length;
  const counts={targetCount:report.results.length,successCount:count('ready'),failureCount:count('failed'),unmatchedCount:count('unmatched'),notAttemptedCount:count('not_attempted')};
  return {...report,...counts};
}
function saveReport(db,report) {
  if(!validListingCollection(report))throw new Error('매물 일일 수집 상태 검증 실패');
  db.prepare('INSERT OR REPLACE INTO naver_listing_days VALUES(?,?,?)').run(report.dayKst,JSON.stringify(report.regionIds),JSON.stringify(report));
}
export function readListingCollection(db,day) {
  if(!hasTable(db,'naver_listing_days'))return null;
  const row=day?db.prepare('SELECT report_json FROM naver_listing_days WHERE day_kst=?').get(day):db.prepare('SELECT report_json FROM naver_listing_days ORDER BY day_kst DESC LIMIT 1').get();
  if(!row)return null;
  const report=JSON.parse(row.report_json);if(!validListingCollection(report))throw new Error('저장된 매물 일일 수집 상태 검증 실패');
  return report;
}
export function listingExport(db,{initialSnapshot,now=new Date()}={}) {
  const groups=new Map();
  if(initialSnapshot){if(!validListingSnapshot(initialSnapshot))throw new Error('기존 매물 스냅샷 검증 실패');for(const group of initialSnapshot.groups)groups.set(group.favorite.id,group);}
  if(hasTable(db,'naver_listing_snapshots'))for(const row of db.prepare('SELECT group_json FROM naver_listing_snapshots ORDER BY apartment_id').all()){
    const group=JSON.parse(row.group_json);if(!validListingGroup(group))throw new Error('저장된 매물 스냅샷 검증 실패');
    for(const [id,old] of groups)if(id!==group.favorite.id&&sameApartmentFavorite(old.favorite,group.favorite)&&old.attemptedAt<=group.attemptedAt)groups.delete(id);
    const old=groups.get(group.favorite.id);if(!old||old.attemptedAt<=group.attemptedAt)groups.set(group.favorite.id,group);
  }
  const collection=readListingCollection(db)||initialSnapshot?.collection;
  const catalog=housingIdentityCatalog(db);
  const cohortById=new Map(catalog.cohorts.map(cohort=>[cohort.cohort_id,cohort]));
  for(const [id,group]of groups){const cohort=cohortById.get(group.favorite.identity_ref?.kind==='cohort'?group.favorite.id:null);if(cohort&&!cohort.legal_types.some(type=>['아파트','노인복지주택'].includes(type))&&!cohort.entity_ids.length&&!cohort.partial_entity_ids.length)groups.delete(id);}
  if(catalog.cohorts.length){
    const information=new Map(publicApartmentInformation(db).apartments.map(item=>[item.id,item]));
    for(const [id,group]of groups){const info=information.get(id);if(info)groups.set(id,{...group,favorite:makeApartmentFavorite(info,info)});}
  }
  const currentTargets=new Set(collection?.results.map(row=>row.favoriteId)||[]);
  for(const group of groups.values()){
    if(!currentTargets.has(group.favorite.id)||group.status!=='ready'||group.coverage!=='complete'||!group.observation)continue;
    const road=normalizeRoadAddress(group.observation.road_address);if(!road)continue;
    for(const [id,old]of groups)if(id!==group.favorite.id&&!currentTargets.has(id)&&old.complexNo===group.complexNo&&old.attemptedAt<=group.attemptedAt&&normalizeRoadAddress(old.favorite.road_address)===road)groups.delete(id);
  }
  const snapshot={...listingSnapshot([...groups.values()].map(saleListingGroup).filter(Boolean),new Date(now).toISOString()),...(collection?{collection}:{})};
  if(!validListingSnapshot(snapshot))throw new Error('공개 매물 스냅샷 검증 실패');return snapshot;
}

export async function collectDailyListings(db,config,{browserSource=process.env.NAVER_LISTING_SOURCE||'system-chrome',sourceFactory=()=>createDailyListingSource({initialSnapshot,source:browserSource}),now=()=>Date.now(),force=false,retryUnresolved=false,maxDurationMs=3*60*60*1000,onProgress=()=>{},initialSnapshot,signal}={}) {
  signal?.throwIfAborted();
  if(!['system-chrome','playwright'].includes(browserSource))throw Error('매물 브라우저 소스를 확인하세요.');
  db.exec(NAVER_LISTING_SCHEMA);
  synchronizeApartmentIdentity(db,{snapshot:initialSnapshot});
  const started=now(),dayKst=kstListingDay(started),regionIds=[...config.region_ids].sort();let targets;
  try{
    const scopes=listingScopes(db,config);
    synchronizeHousingIdentity(db,{scopes});
    targets=dailyListingTargets(db,config);
  }catch(error){
    if(error.code!=='inventory_unavailable')throw error;
    const report=summarize({dayKst,tradeType:LISTING_TRADE_TYPE,browserSource,status:'failed',startedAt:new Date(started).toISOString(),finishedAt:new Date(now()).toISOString(),regionIds,results:[],errorCode:'inventory_unavailable'});
    saveReport(db,report);onProgress(LISTING_ERRORS.inventory_unavailable);return report;
  }
  synchronizeNaverMatches(db,targets,housingIdentityCatalog(db));
  const seedFile=new URL('../automation/naver-verified-matches.json',import.meta.url);
  if(fs.existsSync(seedFile))applyNaverMatchSeed(db,targets,JSON.parse(fs.readFileSync(seedFile,'utf8')));
  const saved=force?null:readListingCollection(db,dayKst);
  const previous=saved?.tradeType===LISTING_TRADE_TYPE&&saved.browserSource===browserSource?saved:null;
  const byPrevious=new Map((previous?.results||[]).filter(r=>r.attemptedAt!==null&&(!retryUnresolved||r.status==='ready'||['blocked','rate_limited','unauthorized','site_unavailable'].includes(r.errorCode))).map(r=>[r.favoriteId,r]));
  let report=summarize({dayKst,tradeType:LISTING_TRADE_TYPE,browserSource,status:'running',startedAt:previous?.startedAt||new Date(started).toISOString(),finishedAt:null,regionIds,results:targets.map(({favorite})=>({...byPrevious.get(favorite.id),favorite,favoriteId:favorite.id,...(byPrevious.has(favorite.id)?{}:{status:'not_attempted',errorCode:null,attemptedAt:null})}))});
  if(report.results.every(r=>r.attemptedAt!==null)&&previous){
    const finished={...report,finishedAt:previous.finishedAt||new Date(now()).toISOString(),status:report.successCount===report.targetCount?'complete':report.successCount?'partial':'failed'};
    saveReport(db,finished);return {...finished,alreadyCollected:true};
  }
  saveReport(db,report);
  let source,stoppedCode=previous?.results.find(row=>['blocked','rate_limited','unauthorized','site_unavailable'].includes(row.errorCode))?.errorCode||null;
  try {
    for(let index=0;index<targets.length;index++) {
      signal?.throwIfAborted();
      const target=targets[index];if(report.results[index].attemptedAt!==null)continue;
      if(now()-started>=maxDurationMs)stoppedCode='budget_exceeded';
      if(stoppedCode){report.results[index]={favoriteId:target.favorite.id,favorite:target.favorite,status:'not_attempted',errorCode:stoppedCode,attemptedAt:null};continue;}
      const attemptedAt=new Date(now()).toISOString();
      const match=readNaverMatch(db,target);
      let connection=match?.state==='verified'?match.complex_no:match?.complex_no||target.complexNo;
      const unmatchedAge=match?.last_attempted_at?now()-Date.parse(match.last_attempted_at):Infinity;
      if(match?.state==='unmatched'&&!force&&!retryUnresolved&&unmatchedAge>=0&&unmatchedAge<UNMATCHED_RETRY_MS){
        report.results[index]={favoriteId:target.favorite.id,favorite:target.favorite,status:'unmatched',errorCode:'unmatched',attemptedAt};
        report=summarize(report);saveReport(db,report);
        onProgress(`${target.favorite.apartment}: 저장된 단지 연결 미확정 · 재검색 생략`);continue;
      }
      try {
        source??=await sourceFactory();
        if(source.resolve&&match?.state!=='verified'){
          const resolved=await source.resolve(target,{complexNo:connection,signal});
          recordNaverMatch(db,target,resolved,{at:attemptedAt});
          connection=resolved.complexNo;
        }
        const group=await source.collect(target,{complexNo:connection,signal});
        signal?.throwIfAborted();
        if(!validListingGroup(group)||group.tradeType!==LISTING_TRADE_TYPE||group.status!=='ready'||group.favorite.id!==target.favorite.id||group.collectionMethod!=='browser'||group.coverage!=='complete')throw new Error('매매 매물 브라우저 전체 수집 결과 검증 실패');
        db.exec('BEGIN IMMEDIATE');
        try{
          if(group.observation)recordNaverMatch(db,target,group,{at:attemptedAt});
          db.prepare('INSERT OR REPLACE INTO naver_listing_connections VALUES(?,?,?)').run(target.favorite.id,group.complexNo,group.collectedAt);
          db.prepare('INSERT OR REPLACE INTO naver_listing_snapshots VALUES(?,?,?)').run(target.favorite.id,group.collectedAt,JSON.stringify(group));
          if(target.favorite.identity_ref?.kind!=='cohort')synchronizeApartmentIdentity(db,{snapshot:listingSnapshot([group]),apartmentIds:[target.favorite.id]});
          db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        report.results[index]={favoriteId:target.favorite.id,favorite:target.favorite,status:'ready',errorCode:null,attemptedAt};
        onProgress(`${target.favorite.apartment}: 매매 매물 광고 ${group.articles.length}건`);
      }catch(error) {
        if(!Object.hasOwn(LISTING_ERRORS,error.code))throw error;
        const code=error.code;
        recordNaverMatchFailure(db,target,code,{at:attemptedAt});
        if(code==='address_mismatch'||code==='unmatched'){
          db.prepare('DELETE FROM naver_listing_connections WHERE apartment_id=?').run(target.favorite.id);
          db.prepare('UPDATE apartment_identity SET naver_complex_no=NULL,naver_name=NULL,updated_at=? WHERE apartment_id=?').run(attemptedAt,target.favorite.id);
        }
        report.results[index]={favoriteId:target.favorite.id,favorite:target.favorite,status:code==='unmatched'||code==='address_mismatch'?'unmatched':'failed',errorCode:code,attemptedAt};
        const previousRow=db.prepare('SELECT group_json FROM naver_listing_snapshots WHERE apartment_id=?').get(target.favorite.id);
        const stored=previousRow?JSON.parse(previousRow.group_json):initialSnapshot?listingGroupForFavorite(initialSnapshot.groups,target.favorite):null;
        const old=stored?saleListingGroup(stored):null;
        if(old?.collectedAt){
          const group={...old,favorite:target.favorite,status:'failed',attemptedAt,errorCode:code};
          if(!validListingGroup(group))throw new Error('실패 후 이전 매물 보존 검증 실패');
          db.prepare('INSERT OR REPLACE INTO naver_listing_snapshots VALUES(?,?,?)').run(target.favorite.id,group.collectedAt,JSON.stringify(group));
        }
        onProgress(`${target.favorite.apartment}: ${LISTING_ERRORS[code]}`);
        if(['rate_limited','unauthorized','blocked','browser_unavailable','site_unavailable'].includes(code))stoppedCode=code;
      }
      report=summarize(report);saveReport(db,report);
    }
  }finally{await source?.close();}
  report=summarize({...report,finishedAt:new Date(now()).toISOString()});
  report.status=report.successCount===report.targetCount?'complete':report.successCount?'partial':'failed';
  synchronizeHousingIdentity(db,{scopes:listingScopes(db,config)});
  saveReport(db,report);return report;
}
