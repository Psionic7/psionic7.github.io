import {validApartmentFavorites,sameApartmentFavorite} from './apartment-favorites.js';
import {identityRef} from './housing-identity.mjs';

export const LISTING_SOURCE='naver-land';
export const TRADE_TYPES={A1:'매매',B1:'전세',B2:'월세'};
export const LISTING_TRADE_TYPE='A1';
export const apartmentListingType=code=>code===undefined||code==='APT'||code==='JGC';
export const listingBuildingDong=value=>String(value||'').trim().replace(/^제\s*/,'').replace(/\s*동$/,'').replace(/^0+(?=\d)/,'').toLowerCase();
// Older snapshots may contain rentals; an empty partial page is never proof of zero sale ads.
export function saleListingGroup(group) {
  const articles=group.articles.filter(article=>article.tradeType===LISTING_TRADE_TYPE);
  return group.coverage==='partial'&&!articles.length?null:{...group,tradeType:LISTING_TRADE_TYPE,articles};
}
export const LISTING_ERRORS={
  rate_limited:'네이버 요청 제한으로 수집을 중단했습니다. 잠시 후 다시 시도하세요.',
  unauthorized:'네이버에서 접근을 허용하지 않았습니다. 수집 서버의 인증 설정을 확인하세요.',
  unavailable:'네이버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.',
  invalid_response:'네이버 응답 형식을 확인할 수 없어 수집하지 않았습니다.',
  address_mismatch:'네이버 단지 주소가 즐겨찾기 주소와 일치하지 않습니다. 단지 번호를 확인하세요.',
  incomplete:'전체 매물 페이지를 확인하지 못해 이전 수집 결과를 유지합니다.',
  unmatched:'주소가 일치하는 네이버 단지를 확인하지 못했습니다.',
  browser_unavailable:'매물 수집 브라우저를 실행하지 못했습니다.',
  blocked:'네이버에서 접근 제한 또는 보안 확인 화면을 표시해 수집을 중단했습니다.',
  timeout:'매물 수집 제한 시간 안에 전체 목록을 확인하지 못했습니다.',
  budget_exceeded:'이번 실행의 매물 수집 시간이 끝나 남은 단지는 수집하지 않았습니다.',
  inventory_unavailable:'수집 지역의 전체 아파트 목록을 확인하지 못했습니다. 단지 대장 수집 상태를 확인하세요.',
  site_unavailable:'네이버 웹 수집 화면에 접속하지 못해 이번 매물 수집을 중단했습니다.',
};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max=1000)=>typeof value==='string'&&value.length<=max;
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=100000;
const date=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export const validComplexNo=value=>typeof value==='string'&&/^[1-9]\d{0,11}$/.test(value);

export function parseComplexNo(value) {
  if(typeof value!=='string')return '';
  const input=value.trim();
  if(validComplexNo(input))return input;
  try {
    const url=new URL(input);
    if(url.protocol!=='https:'||!['new.land.naver.com','fin.land.naver.com'].includes(url.hostname)||url.port||url.username||url.password)return '';
    const id=url.pathname.match(/^\/complexes\/([1-9]\d{0,11})\/?$/)?.[1];
    return id||'';
  }catch{return '';}
}
export const complexUrl=id=>`https://fin.land.naver.com/complexes/${id}`;
export const articleUrl=id=>`https://fin.land.naver.com/articles/${id}`;
export const listingSearchUrl=favorite=>`https://m.land.naver.com/search/result/${encodeURIComponent(`${favorite.region_name} ${favorite.dong} ${favorite.apartment}`)}`;
export function validConnections(value) {
  return Array.isArray(value)&&value.length<=1000&&new Set(value.map(item=>item?.favoriteId)).size===value.length&&value.every(item=>object(item)&&text(item.favoriteId,2000)&&item.favoriteId.length>0&&validComplexNo(item.complexNo));
}
export function validTargets(value) {
  return object(value)&&value.version===1&&validApartmentFavorites(value.favorites)&&validConnections(value.connections)&&value.connections.every(item=>value.favorites.some(f=>f.id===item.favoriteId));
}
export function validArticle(value) {
  if(value?.providerHouseId!==undefined&&(typeof value.providerHouseId!=='string'||!/^[1-9]\d{0,11}:[1-9]\d{0,11}$/.test(value.providerHouseId)))return false;
  if(!apartmentListingType(value?.propertyType))return false;
  if(value?.providerSameAddress!==undefined){
    const group=value.providerSameAddress;
    if(!object(group)||!Number.isInteger(group.advertisementCount)||group.advertisementCount<1||group.advertisementCount>20000)return false;
    for(const field of ['minPrice','maxPrice'])if(group[field+'Man']!==undefined&&(!Number.isSafeInteger(group[field+'Man'])||group[field+'Man']<0||!text(group[field+'Text'],100)||!group[field+'Text']))return false;
  }
  return object(value)&&validComplexNo(value.id)&&Object.hasOwn(TRADE_TYPES,value.tradeType)&&text(value.name)&&text(value.priceText,100)&&value.priceText.length>0&&text(value.rentText,100)&&Number.isSafeInteger(value.priceMan)&&value.priceMan>=0&&Number.isSafeInteger(value.rentMan)&&value.rentMan>=0&&number(value.areaM2)&&(value.supplyAreaM2===null||number(value.supplyAreaM2))&&['floor','building','direction','description','realtor'].every(key=>text(value[key]))&&text(value.confirmedOn,10)&&(!value.confirmedOn||date(value.confirmedOn));
}
export function validListingGroup(group) {
  if(group?.observation!==undefined&&!validListingObservation(group.observation,group))return false;
  if(group?.tradeType!==undefined&&(group.tradeType!==LISTING_TRADE_TYPE||!Array.isArray(group.articles)||group.articles.some(a=>a?.tradeType!==LISTING_TRADE_TYPE)))return false;
  return object(group)&&validApartmentFavorites([group.favorite])&&validComplexNo(group.complexNo)&&text(group.complexName)&&timestamp(group.attemptedAt)&&['ready','failed'].includes(group.status)&&Array.isArray(group.articles)&&group.articles.length<=20000&&new Set(group.articles.map(a=>a?.id)).size===group.articles.length&&group.articles.every(validArticle)&&(group.collectedAt===null?group.articles.length===0&&group.status==='failed':timestamp(group.collectedAt)&&group.collectedAt<=group.attemptedAt)&&(group.status==='ready'?group.collectedAt!==null&&group.errorCode===null:Object.hasOwn(LISTING_ERRORS,group.errorCode))&&(group.collectionMethod===undefined?group.coverage===undefined:group.collectionMethod==='browser'&&(group.coverage==='partial'?group.articles.length>0:group.coverage==='complete'&&Number.isInteger(group.pageCount)&&group.pageCount>0&&group.pageCount<=2000)&&typeof group.sourceUrl==='string'&&group.sourceUrl.startsWith('https://')&&parseComplexNo(group.sourceUrl)===group.complexNo);
}
export function validListingObservation(value,group) {
  if(!object(value)||value.complex_no!==group.complexNo||!text(value.name)||!value.name||!text(value.road_address)||!text(value.parcel_address)||!timestamp(value.observed_at)||![complexUrl(group.complexNo),`https://new.land.naver.com/complexes/${group.complexNo}`].includes(value.source_url))return false;
  if(value.verification_method!==undefined&&!text(value.verification_method,100))return false;
  if(value.real_estate_type!==undefined&&!text(value.real_estate_type,40))return false;
  if(value.building_witnesses!==undefined&&(!Array.isArray(value.building_witnesses)||value.building_witnesses.length>1000||value.building_witnesses.some(dong=>!text(dong,100)||!dong)))return false;
  const hasPoint=value.latitude!==undefined||value.longitude!==undefined||value.coordinate_role!==undefined;
  return !hasPoint||Number.isFinite(value.latitude)&&value.latitude>=28&&value.latitude<=40&&Number.isFinite(value.longitude)&&value.longitude>=122&&value.longitude<=135&&value.coordinate_role==='provider_label';
}
export const kstListingDay=(value=new Date())=>new Date(new Date(value).getTime()+9*60*60*1000).toISOString().slice(0,10);
export function validListingCollection(value) {
  if(value?.tradeType!==undefined&&value.tradeType!==LISTING_TRADE_TYPE)return false;
  if(value?.browserSource!==undefined&&!['system-chrome','playwright'].includes(value.browserSource))return false;
  if(!object(value)||!date(value.dayKst)||!timestamp(value.startedAt)||!(value.finishedAt===null||timestamp(value.finishedAt))||!['running','complete','partial','failed'].includes(value.status)||!Array.isArray(value.regionIds)||value.regionIds.length>5000||value.regionIds.some(id=>typeof id!=='string'||!/^dong_\d{8}$/.test(id)&&!/^custom_\d{5}_[a-f0-9]{12}$/.test(id))||new Set(value.regionIds).size!==value.regionIds.length||!Array.isArray(value.results)||value.results.length>1000)return false;
  if(!['targetCount','successCount','failureCount','unmatchedCount','notAttemptedCount'].every(key=>Number.isInteger(value[key])&&value[key]>=0&&value[key]<=1000)||value.targetCount!==value.results.length||value.successCount+value.failureCount+value.unmatchedCount+value.notAttemptedCount!==value.targetCount)return false;
  if(new Set(value.results.map(r=>r?.favoriteId)).size!==value.results.length||!value.results.every(r=>object(r)&&text(r.favoriteId,2000)&&r.favoriteId&&(r.favorite===undefined||validApartmentFavorites([r.favorite])&&r.favorite.id===r.favoriteId)&&['ready','failed','unmatched','not_attempted'].includes(r.status)&&(r.errorCode===null||Object.hasOwn(LISTING_ERRORS,r.errorCode))&&(r.status==='not_attempted'?r.attemptedAt===null:timestamp(r.attemptedAt))&&(r.status==='ready'?r.errorCode===null:r.status==='failed'||r.status==='unmatched'?Object.hasOwn(LISTING_ERRORS,r.errorCode):true)))return false;
  const counts=status=>value.results.filter(r=>r.status===status).length;
  return counts('ready')===value.successCount&&counts('failed')===value.failureCount&&counts('unmatched')===value.unmatchedCount&&counts('not_attempted')===value.notAttemptedCount&&(value.status==='running'?value.finishedAt===null:value.finishedAt!==null)&&(value.status!=='complete'||value.targetCount>0&&value.successCount===value.targetCount)&&(value.status!=='partial'||value.successCount>0&&value.successCount<value.targetCount)&&(value.status!=='failed'||value.successCount===0)&&(!value.errorCode||Object.hasOwn(LISTING_ERRORS,value.errorCode));
}
export function validListingSnapshot(value) {
  return object(value)&&value.version===1&&value.source===LISTING_SOURCE&&timestamp(value.generatedAt)&&Array.isArray(value.groups)&&value.groups.length<=1000&&new Set(value.groups.map(g=>g?.favorite?.id)).size===value.groups.length&&value.groups.every(validListingGroup)&&(value.collection===undefined||validListingCollection(value.collection));
}
export const listingSnapshot=(groups,now=new Date().toISOString())=>({version:1,source:LISTING_SOURCE,generatedAt:now,groups});
export function listingGroupsForFavorite(groups,favorite,complexNo) {
  const selected=identityRef(favorite);
  const unitsByComplex=new Map(),allUnits=new Map();
  for(const group of groups){
    if(group.favorite.region_code!==favorite.region_code||!group.collectedAt)continue;
    const observed=identityRef(group.favorite),cohortIds=group.favorite.identity_coverage?.cohort_ids||[];
    if(observed?.kind!=='cohort'&&!(observed?.kind==='root'&&cohortIds.length===1))continue;
    const units=unitsByComplex.get(group.complexNo)||new Map();
    for(const member of group.favorite.identity_listing_members||[])if(member.building_dongs?.length){units.set(member.cohort_id,member);allUnits.set(member.cohort_id,member);}
    unitsByComplex.set(group.complexNo,units);
  }
  return groups.filter(group=>{
    if(complexNo&&group.complexNo!==complexNo||group.favorite.region_code!==favorite.region_code)return false;
    if(sameApartmentFavorite(group.favorite,favorite))return true;
    const observed=identityRef(group.favorite),coverage=group.favorite.identity_coverage;
    if(!selected||!observed||!coverage)return false;
    if(selected.kind==='root')return observed.kind==='cohort'&&coverage.root_ids.includes(selected.id);
    if(selected.kind==='cohort')return observed.kind==='root'&&coverage.cohort_ids.length===1&&coverage.cohort_ids[0]===selected.id;
    const cohortId=observed.kind==='cohort'?observed.id:observed.kind==='root'&&coverage.cohort_ids.length===1?coverage.cohort_ids[0]:null;
    if(selected.kind!=='source')return false;
    if(observed.kind==='root'&&coverage.cohort_ids.length>1){const contained=new Set(favorite.identity_coverage?.cohort_ids||favorite.identity_listing_members?.map(member=>member.cohort_id)||[]);return coverage.cohort_ids.every(id=>contained.has(id));}
    return coverage.entity_ids.includes(selected.id)||cohortId&&favorite.identity_listing_members?.some(member=>member.cohort_id===cohortId);
  }).map(group=>{
    const observed=identityRef(group.favorite),cohortId=observed?.kind==='cohort'?observed.id:observed?.kind==='root'&&group.favorite.identity_coverage?.cohort_ids.length===1?group.favorite.identity_coverage.cohort_ids[0]:null;
    const units=[...(unitsByComplex.get(group.complexNo)?.values()||[])];
    const sets=[...new Map(units.map(unit=>[[...unit.building_dongs].sort().join('|'),new Set(unit.building_dongs)])).values()];
    const partitioned=sets.length>1&&sets.every((values,i)=>sets.every((other,j)=>i===j||![...values].some(value=>other.has(value))));
    let members;
    if(selected?.kind==='source'){
      members=partitioned?favorite.identity_listing_members?.map(member=>member.building_dongs===null?allUnits.get(member.cohort_id)||member:member):favorite.identity_listing_members?.filter(member=>member.cohort_id===cohortId&&member.building_dongs!==null&&member.whole_cohort!==true);
      if(!partitioned&&!members?.length)return group;
    }
    else{if(!partitioned)return group;members=favorite.identity_listing_members;}
    if(members?.some(member=>member.building_dongs===null))return {...group,scopeUncertain:true};
    const allowed=new Set([...(members||[]).flatMap(member=>member.building_dongs),...(selected?.kind==='source'?favorite.identity_reported_buildings||[]:[])]);
    if(!allowed.size)return group;
    const articles=group.articles.filter(article=>allowed.has(listingBuildingDong(article.building)));
    if(articles.length===group.articles.length)return group;
    return {...group,articles,buildingScopeRestricted:true,unclassifiedArticleCount:group.articles.filter(article=>!listingBuildingDong(article.building)).length};
  });
}
export function listingGroupForFavorite(groups,favorite,complexNo) {
  const candidates=listingGroupsForFavorite(groups,favorite,complexNo);
  const byComplex=new Map();
  for(const group of candidates){const old=byComplex.get(group.complexNo);if(!old||(group.collectedAt||'')>(old.collectedAt||'')||group.collectedAt===old.collectedAt&&group.attemptedAt>old.attemptedAt)byComplex.set(group.complexNo,group);}
  const components=[...byComplex.values()];
  if(components.length<2)return components[0]||null;
  const articles=new Map();for(const group of components)for(const article of group.articles)if(!articles.has(article.id))articles.set(article.id,article);
  const failures=components.filter(group=>group.status==='failed'),collected=components.map(group=>group.collectedAt).filter(Boolean).sort();
  return {...components[0],favorite,complexName:favorite.apartment,articles:[...articles.values()],attemptedAt:components.map(group=>group.attemptedAt).sort().at(-1),collectedAt:collected[0]||null,status:failures.length?'failed':'ready',errorCode:failures[0]?.errorCode||null,coverage:components.every(group=>group.coverage==='complete')?'complete':'partial',componentCount:components.length,scopeUncertain:components.some(group=>group.scopeUncertain),buildingScopeRestricted:components.some(group=>group.buildingScopeRestricted),unclassifiedArticleCount:components.reduce((sum,group)=>sum+(group.unclassifiedArticleCount||0),0)};
}
export const listingIsStale=(group,now=Date.now())=>!group?.collectedAt||now-Date.parse(group.collectedAt)>24*60*60*1000||Date.parse(group.collectedAt)>now+60000;
export function selectArticles(articles,{tradeType='',minArea='',maxArea='',sort='priceAsc'}={}) {
  return articles.filter(a=>(!tradeType||a.tradeType===tradeType)&&(minArea===''||a.areaM2>=Number(minArea))&&(maxArea===''||a.areaM2<=Number(maxArea))).sort((a,b)=>sort==='latest'?b.confirmedOn.localeCompare(a.confirmedOn)||b.id.localeCompare(a.id):sort==='areaAsc'?a.areaM2-b.areaM2:(sort==='priceDesc'?-1:1)*(a.priceMan-b.priceMan||a.rentMan-b.rentMan)||a.id.localeCompare(b.id));
}
