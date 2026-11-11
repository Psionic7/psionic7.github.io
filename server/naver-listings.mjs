import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {normalizeRoadAddress,normalizeParcel} from '../src/address-identity.mjs';
import {listingSearchNames,listingRegisteredNameMatches,listingFavoritePhase,listingPhaseMatches} from './naver-listing-names.mjs';
import {setTimeout as sleep} from 'node:timers/promises';
import {validApartmentFavorites} from '../src/apartment-favorites.js';
import {housingLocationEvidence,housingRoadAddress} from './housing-location.mjs';
import {validRegionalListingReport} from '../src/naver-listing-report.mjs';
import {LISTING_ERRORS,TRADE_TYPES,LISTING_TRADE_TYPE,saleListingGroup,validComplexNo,validArticle,validListingGroup,validListingSnapshot,listingSnapshot,listingGroupForFavorite,listingBuildingDong,apartmentListingType} from '../src/naver-listings.mjs';

class ListingError extends Error {constructor(code){super(LISTING_ERRORS[code]);this.code=code;}}
const fail=code=>{throw new ListingError(code);};
const clean=(value,max=1000)=>typeof value==='string'?value.replace(/<[^>]*>/g,'').trim().slice(0,max):'';
const compact=value=>String(value||'').replace(/\s/g,'');
const lot=normalizeParcel;

export function priceMan(value) {
  if(typeof value!=='string'&&typeof value!=='number')fail('invalid_response');
  const input=String(value).replace(/[\s,]/g,'');
  const match=input.match(/^(?:(\d+)억)?(\d+)?(?:만원|만)?$/);
  if(!match||!match[1]&&!match[2])fail('invalid_response');
  const price=Number(match[1]||0)*10000+Number(match[2]||0);
  if(!Number.isSafeInteger(price)||price<0)fail('invalid_response');
  return price;
}

export function normalizeArticle(raw) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('invalid_response');
  if(raw.articleStatus!==undefined&&raw.articleStatus!=='R0')return null;
  if(!apartmentListingType(raw.realEstateTypeCode))fail('invalid_response');
  if(!Object.hasOwn(TRADE_TYPES,raw.tradeTypeCode))fail('invalid_response');
  const day=String(raw.articleConfirmYmd||'').replace(/[-.]/g,'');
  const article={id:String(raw.articleNo||''),name:clean(raw.articleName),tradeType:raw.tradeTypeCode,
    priceText:clean(raw.dealOrWarrantPrc,100),rentText:clean(raw.rentPrc===undefined?'':String(raw.rentPrc),100),
    priceMan:priceMan(raw.dealOrWarrantPrc),rentMan:raw.tradeTypeCode==='B2'?priceMan(raw.rentPrc):0,
    areaM2:Number(raw.area2),supplyAreaM2:raw.area1===undefined||raw.area1===''?null:Number(raw.area1),
    floor:clean(raw.floorInfo),building:clean(raw.buildingName),direction:clean(raw.direction),
    confirmedOn:day?`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}`:'',
    description:clean(raw.articleFeatureDesc),realtor:clean(raw.realtorName)};
  if(raw.realEstateTypeCode)article.propertyType=raw.realEstateTypeCode;
  if(Number.isInteger(raw.sameAddrCnt)&&raw.sameAddrCnt>0&&raw.sameAddrCnt<=20000){
    article.providerSameAddress={advertisementCount:raw.sameAddrCnt};
    for(const [source,field] of [['sameAddrMinPrc','minPrice'],['sameAddrMaxPrc','maxPrice']]){
      const value=clean(raw[source],100);
      if(value)try{article.providerSameAddress[field+'Man']=priceMan(value);article.providerSameAddress[field+'Text']=value;}catch{}
    }
  }
  if(!validArticle(article))fail('invalid_response');
  return article;
}

export function verifyComplexEvidence(payload,favorite,complexNo,location) {
  const detail=payload?.complexDetail;
  if(!detail||String(detail.complexNo)!==complexNo||!clean(detail.complexName))fail('invalid_response');
  if(!listingPhaseMatches(listingFavoritePhase(favorite),clean(detail.complexName)))fail('address_mismatch');
  if(!apartmentListingType(detail.realEstateTypeCode))fail('address_mismatch');
  const address=compact(detail.cortarAddress||detail.address),code=String(detail.cortarNo||'');
  const region=code?/^\d{10}$/.test(code)&&code.slice(0,5)===favorite.region_code:address.includes(compact(favorite.region_name));
  const expectedLot=lot(favorite.jibun);
  const parcel=region&&address.endsWith(compact(favorite.dong))&&expectedLot!==null&&lot(detail.detailAddress)===expectedLot;
  const road=normalizeRoadAddress(housingRoadAddress(detail));
  const named=listingSearchNames(favorite).some(name=>listingRegisteredNameMatches(name,clean(detail.complexName)));
  const evidence=housingLocationEvidence(location,detail);
  const roadConflict=favorite.identity_ref?.kind==='cohort'&&road&&location?.roads?.some(value=>value.source&&normalizeRoadAddress(value.road_address))&&!evidence.road_match;
  const exclusive=new Set(location?.exclusive_building_dongs||[]),buildingWitnesses=[...new Set((Array.isArray(payload.article_building_dongs)?payload.article_building_dongs:[]).map(listingBuildingDong).filter(dong=>exclusive.has(dong)))];
  const shared=location?.shared_provider;
  if(shared?.complexNo===complexNo&&region&&address.endsWith(compact(favorite.dong))&&evidence.anchor_corroborated){
    const representative=shared.representative;
    const representativeDongs=new Set(representative.location?.exclusive_building_dongs||[]);
    const witnesses=[...new Set([...buildingWitnesses,...shared.scope.building_witnesses.filter(dong=>exclusive.has(dong))])];
    if(witnesses.length&&exclusive.size&&representativeDongs.size&&![...exclusive].some(dong=>representativeDongs.has(dong))){
      verifyComplexEvidence(payload,representative.favorite,complexNo,representative.location);
      return {complexName:clean(detail.complexName),method:'verified_shared_provider_and_building_ads',buildingWitnesses:witnesses,sharedScope:{...shared.scope,building_witnesses:witnesses}};
    }
  }
  if(roadConflict&&!((parcel||region&&address.endsWith(compact(favorite.dong))&&evidence.primary_parcel_match)&&named&&buildingWitnesses.length)){
    const error=new ListingError('address_mismatch');
    error.needsBuildingEvidence=Boolean((parcel||region&&address.endsWith(compact(favorite.dong))&&evidence.primary_parcel_match)&&named&&exclusive.size);
    throw error;
  }
  let method;
  if(roadConflict)method='verified_primary_parcel_and_building_ads';
  else if(parcel)method='parcel';
  else if(region&&address.endsWith(compact(favorite.dong))&&evidence.primary_parcel_match)method='verified_primary_parcel';
  else if(region&&road&&(road===normalizeRoadAddress(favorite.road_address)||evidence.road_match)&&named)method='road_and_registered_name';
  else if(region&&address.endsWith(compact(favorite.dong))&&evidence.road_match&&evidence.point&&evidence.point_in_primary_polygon)method='verified_road_and_primary_polygon';
  else if(region&&address.endsWith(compact(favorite.dong))&&evidence.road_match&&evidence.point&&!evidence.has_primary_polygon&&evidence.anchor_corroborated)method='verified_road_and_official_anchor';
  else fail('address_mismatch');
  return {complexName:clean(detail.complexName),method,...(roadConflict?{buildingWitnesses}:{})};
}
export function verifyComplex(payload,favorite,complexNo,location) {
  return verifyComplexEvidence(payload,favorite,complexNo,location).complexName;
}

export function writeListingSnapshot(filename,snapshot) {
  if(!validListingSnapshot(snapshot))throw new Error('매물 스냅샷 검증 실패');
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const temporary=filename+'.'+randomUUID()+'.tmp';
  try{fs.writeFileSync(temporary,JSON.stringify(snapshot,null,2)+'\n',{encoding:'utf8',flag:'wx'});fs.renameSync(temporary,filename);}
  finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  // A regional report describes one observation; discard it when a later export supersedes it.
  for(const file of fs.readdirSync(path.dirname(filename))){
    const match=file.match(/^region-(\d{5})-report\.json$/);if(!match)continue;
    const reportFile=path.join(path.dirname(filename),file),report=JSON.parse(fs.readFileSync(reportFile,'utf8'));
    if(!validRegionalListingReport(report,snapshot,match[1]))fs.unlinkSync(reportFile);
  }
}

export function createListingCollector({stateFile,initialSnapshot,fetcher=fetch,authorization='',now=()=>Date.now(),pause=sleep,requestGap=1200,maxPages=200,timeoutMs=20000}={}) {
  let groups=[],blockedUntil=0,lastRequest=-Infinity,queue=Promise.resolve();
  const restore=snapshot=>{
    if(!validListingSnapshot(snapshot))throw new Error('저장된 네이버 매물 파일 검증 실패');
    const saved=new Map(groups.map(g=>[g.favorite.id,g]));
    for(const stored of snapshot.groups){const group=saleListingGroup(stored);if(!group)continue;const previous=saved.get(group.favorite.id);if(!previous||group.attemptedAt>=previous.attemptedAt)saved.set(group.favorite.id,group);}
    groups=[...saved.values()];
  };
  if(initialSnapshot)restore(initialSnapshot);
  if(stateFile&&fs.existsSync(stateFile)) {
    const stored=JSON.parse(fs.readFileSync(stateFile,'utf8'));
    restore(stored);
  }
  const snapshot=()=>listingSnapshot(groups,new Date(now()).toISOString());
  const read=(favorite,complexNo)=>listingGroupForFavorite(groups,favorite,complexNo);
  async function request(endpoint) {
    if(now()<blockedUntil)fail('rate_limited');
    const remaining=requestGap-(now()-lastRequest);
    if(remaining>0)await pause(remaining);
    lastRequest=now();
    let response;
    try{
      const headers={Accept:'application/json',Referer:'https://new.land.naver.com/'};
      if(authorization)headers.Authorization=authorization.startsWith('Bearer ')?authorization:'Bearer '+authorization;
      response=await fetcher('https://new.land.naver.com'+endpoint,{headers,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
    }catch{fail('unavailable');}
    if(response.status===429){blockedUntil=now()+Math.min(24*60*60,Math.max(900,Number(response.headers.get('retry-after'))||0))*1000;fail('rate_limited');}
    if(response.status===401||response.status===403)fail('unauthorized');
    if(!response.ok)fail('unavailable');
    if(!response.headers.get('content-type')?.includes('application/json'))fail('invalid_response');
    try{
      const body=await response.text();
      if(body.length>5*1024*1024)fail('invalid_response');
      const payload=JSON.parse(body);
      if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('invalid_response');
      return payload;
    }catch(error){if(error instanceof ListingError)throw error;fail('invalid_response');}
  }
  async function collect(favorite,complexNo,{force=false}={}) {
    if(!validApartmentFavorites([favorite])||!validComplexNo(complexNo))throw new Error('즐겨찾기와 네이버 단지 번호를 확인하세요.');
    const previous=read(favorite,complexNo),age=previous?now()-Date.parse(previous.attemptedAt):Infinity;
    if(previous&&age>=0&&age<(force?60000:300000))return previous;
    let group;
    try {
      const complexName=verifyComplex(await request(`/api/complexes/${complexNo}`),favorite,complexNo);
      const articles=[],seen=new Set();
      for(let page=1;page<=maxPages;page++) {
        const params=new URLSearchParams({realEstateType:'APT',tradeType:LISTING_TRADE_TYPE,tag:'::::::::',rentPriceMin:'0',rentPriceMax:'900000000',priceMin:'0',priceMax:'900000000',areaMin:'0',areaMax:'900000000',showArticle:'false',sameAddressGroup:'false',priceType:'RETAIL',directions:'',page:String(page),complexNo,buildingNos:'',areaNos:'',type:'list',order:'rank'});
        const payload=await request(`/api/articles/complex/${complexNo}?${params}`);
        if(!Array.isArray(payload.articleList)||typeof payload.isMoreData!=='boolean'||payload.articleList.length>1000||payload.isMoreData&&payload.articleList.length===0)fail('invalid_response');
        if(page>1&&payload.articleList.length===0)fail('incomplete');
        for(const raw of payload.articleList) {
          const id=String(raw?.articleNo||'');
          if(!validComplexNo(id)||seen.has(id))fail('incomplete');
          seen.add(id);
          if(seen.size>20000||raw.complexNo!==undefined&&String(raw.complexNo)!==complexNo)fail('incomplete');
          if(raw.tradeTypeCode!==LISTING_TRADE_TYPE)continue;
          const article=normalizeArticle(raw);if(article)articles.push(article);
        }
        if(!payload.isMoreData) {
          const collectedAt=new Date(now()).toISOString();
          group={favorite,complexNo,complexName,tradeType:LISTING_TRADE_TYPE,status:'ready',attemptedAt:collectedAt,collectedAt,errorCode:null,articles};
          break;
        }
      }
      if(!group)fail('incomplete');
    }catch(error) {
      if(!(error instanceof ListingError))throw error;
      group={favorite,complexNo,complexName:previous?.complexName||'',status:'failed',attemptedAt:new Date(now()).toISOString(),collectedAt:previous?.collectedAt||null,errorCode:error.code,articles:previous?.articles||[],...(previous?.collectionMethod==='browser'?{collectionMethod:'browser',coverage:previous.coverage,sourceUrl:previous.sourceUrl,...(previous.pageCount?{pageCount:previous.pageCount}:{})}:{})};
    }
    if(!validListingGroup(group))throw new Error('수집된 매물 검증 실패');
    const next=[...groups.filter(item=>item.favorite.id!==favorite.id),group];
    if(next.length>1000)throw new Error('네이버 매물 저장 한도를 초과했습니다.');
    if(stateFile)writeListingSnapshot(stateFile,listingSnapshot(next,new Date(now()).toISOString()));
    groups=next;
    return group;
  }
  return {snapshot,read,restore,collect:(...args)=>{
    const pending=queue.then(()=>collect(...args));queue=pending.catch(()=>{});return pending;
  }};
}
