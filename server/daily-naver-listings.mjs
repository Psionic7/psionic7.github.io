import {makeApartmentFavorite,validApartmentFavorites,sameApartmentFavorite} from '../src/apartment-favorites.js';
import {LISTING_ERRORS,LISTING_TRADE_TYPE,saleListingGroup,kstListingDay,listingSnapshot,validListingCollection,validListingGroup,validListingSnapshot,listingGroupForFavorite} from '../src/naver-listings.mjs';
import {NAVER_LISTING_SCHEMA} from './naver-listing-schema.mjs';
import {createBrowserListingSource} from './naver-browser-collector.mjs';

const hasTable=(db,name)=>Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
const missingInventory=message=>{const error=new Error(message);error.code='inventory_unavailable';throw error;};
export function dailyListingTargets(db,config) {
  if(!hasTable(db,'apartment_complexes')||!hasTable(db,'apartment_inventory_regions'))missingInventory('매물 수집 대상 아파트 대장이 없습니다.');
  const regionRows=db.prepare('SELECT * FROM regions').all(),byId=new Map(regionRows.map(r=>[r.region_id,r]));
  const scopes=config.region_ids.map(id=>{
    const region=byId.get(id),inventory=db.prepare('SELECT * FROM apartment_inventory_regions WHERE region_id=?').get(id);
    if(!region||!inventory||inventory.status!=='scanned')missingInventory('매물 수집 대상 지역의 전체 아파트 목록을 먼저 확인하세요.');
    return {...region,legal_code:id.slice(5)+'00'};
  });
  const byCode=new Map(scopes.map(r=>[r.legal_code,r]));
  const rows=db.prepare('SELECT * FROM apartment_complexes WHERE active=1 ORDER BY legal_code,apartment_id').all().filter(row=>byCode.has(row.legal_code));
  if(!rows.length)missingInventory('매물 수집 대상 아파트 목록이 비어 있습니다.');
  if(rows.length>1000)throw new Error('매물 수집 대상 아파트가 저장 한도 1,000개를 초과했습니다.');
  const nameCounts=new Map();for(const row of rows){const key=row.legal_code+'|'+row.name;nameCounts.set(key,(nameCounts.get(key)||0)+1);}
  return rows.map(row=>{
    const scope=byCode.get(row.legal_code),apartment=row.name?.trim()||`이름 미확인 아파트 (${row.dong} ${row.jibun||'지번 미확인'})`;
    const trade_keys=hasTable(db,'apartment_trade_links')?db.prepare("SELECT dong,jibun,trade_name AS apartment FROM apartment_trade_links WHERE apartment_id=? AND status='matched'").all(row.apartment_id).map(r=>JSON.stringify([r.dong,r.jibun,r.apartment])):[];
    const favorite=makeApartmentFavorite({...row,apartment,master_id:row.apartment_id,trade_keys:[...new Set(trade_keys)]},{region_code:row.region_code,region_name:scope.region_name});
    if(!validApartmentFavorites([favorite]))throw new Error('매물 수집 대상 아파트 식별자를 확인하세요.');
    const tradeNames=trade_keys.map(key=>JSON.parse(key)[2]).sort((a,b)=>b.length-a.length);
    const queryName=row.name?.trim()&&nameCounts.get(row.legal_code+'|'+row.name)===1?row.name.trim():tradeNames[0]||row.name?.trim();
    return {favorite,regionId:scope.region_id,query:queryName?`${row.dong} ${queryName}`:`${scope.region_name} ${row.dong} ${row.jibun}`};
  });
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
  const collection=readListingCollection(db)||initialSnapshot?.collection,snapshot={...listingSnapshot([...groups.values()].map(saleListingGroup).filter(Boolean),new Date(now).toISOString()),...(collection?{collection}:{})};
  if(!validListingSnapshot(snapshot))throw new Error('공개 매물 스냅샷 검증 실패');return snapshot;
}

export async function collectDailyListings(db,config,{sourceFactory=()=>createBrowserListingSource(),now=()=>Date.now(),force=false,maxDurationMs=3*60*60*1000,onProgress=()=>{},initialSnapshot,signal}={}) {
  signal?.throwIfAborted();
  db.exec(NAVER_LISTING_SCHEMA);
  const started=now(),dayKst=kstListingDay(started),regionIds=[...config.region_ids].sort();let targets;
  try{targets=dailyListingTargets(db,config);}catch(error){
    if(error.code!=='inventory_unavailable')throw error;
    const report=summarize({dayKst,tradeType:LISTING_TRADE_TYPE,status:'failed',startedAt:new Date(started).toISOString(),finishedAt:new Date(now()).toISOString(),regionIds,results:[],errorCode:'inventory_unavailable'});
    saveReport(db,report);onProgress(LISTING_ERRORS.inventory_unavailable);return report;
  }
  const saved=force?null:readListingCollection(db,dayKst);
  const previous=saved?.tradeType===LISTING_TRADE_TYPE?saved:null;
  const byPrevious=new Map((previous?.results||[]).filter(r=>r.attemptedAt!==null).map(r=>[r.favoriteId,r]));
  let report=summarize({dayKst,tradeType:LISTING_TRADE_TYPE,status:'running',startedAt:previous?.startedAt||new Date(started).toISOString(),finishedAt:null,regionIds,results:targets.map(({favorite})=>({...byPrevious.get(favorite.id),favorite,favoriteId:favorite.id,...(byPrevious.has(favorite.id)?{}:{status:'not_attempted',errorCode:null,attemptedAt:null})}))});
  if(report.results.every(r=>r.attemptedAt!==null)&&previous){
    const finished={...report,finishedAt:previous.finishedAt||new Date(now()).toISOString(),status:report.successCount===report.targetCount?'complete':report.successCount?'partial':'failed'};
    saveReport(db,finished);return {...finished,alreadyCollected:true};
  }
  saveReport(db,report);
  let source,stoppedCode=null;
  try {
    for(let index=0;index<targets.length;index++) {
      signal?.throwIfAborted();
      const target=targets[index];if(report.results[index].attemptedAt!==null)continue;
      if(now()-started>=maxDurationMs)stoppedCode='budget_exceeded';
      if(stoppedCode){report.results[index]={favoriteId:target.favorite.id,favorite:target.favorite,status:'not_attempted',errorCode:stoppedCode,attemptedAt:null};continue;}
      const attemptedAt=new Date(now()).toISOString();
      const connection=db.prepare('SELECT complex_no FROM naver_listing_connections WHERE apartment_id=?').get(target.favorite.id)?.complex_no;
      try {
        source??=await sourceFactory();
        const group=await source.collect(target,{complexNo:connection,signal});
        signal?.throwIfAborted();
        if(!validListingGroup(group)||group.tradeType!==LISTING_TRADE_TYPE||group.status!=='ready'||group.favorite.id!==target.favorite.id||group.collectionMethod!=='browser'||group.coverage!=='complete')throw new Error('매매 매물 브라우저 전체 수집 결과 검증 실패');
        db.exec('BEGIN IMMEDIATE');
        try{
          db.prepare('INSERT OR REPLACE INTO naver_listing_connections VALUES(?,?,?)').run(target.favorite.id,group.complexNo,group.collectedAt);
          db.prepare('INSERT OR REPLACE INTO naver_listing_snapshots VALUES(?,?,?)').run(target.favorite.id,group.collectedAt,JSON.stringify(group));
          db.exec('COMMIT');
        }catch(error){db.exec('ROLLBACK');throw error;}
        report.results[index]={favoriteId:target.favorite.id,favorite:target.favorite,status:'ready',errorCode:null,attemptedAt};
        onProgress(`${target.favorite.apartment}: 매매 매물 광고 ${group.articles.length}건`);
      }catch(error) {
        if(!Object.hasOwn(LISTING_ERRORS,error.code))throw error;
        const code=error.code;
        if(code==='address_mismatch'||code==='unmatched')db.prepare('DELETE FROM naver_listing_connections WHERE apartment_id=?').run(target.favorite.id);
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
  saveReport(db,report);return report;
}
