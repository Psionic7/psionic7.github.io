import {BrowserListingError} from './naver-browser-collector.mjs';
import {normalizeArticle,verifyComplexEvidence} from './naver-listings.mjs';
import {complexUrl,validListingGroup} from '../src/naver-listings.mjs';
import {housingObservation} from './housing-location.mjs';

const fail=code=>{throw new BrowserListingError(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const id=value=>/^[1-9]\d{0,11}$/.test(String(value??''))?String(value):fail('invalid_response');
const man=value=>Number.isSafeInteger(value)&&value>=0&&value%10000===0?value/10000:fail('invalid_response');
const price=value=>value>=10000?`${Math.floor(value/10000)}억${value%10000?' '+(value%10000).toLocaleString('ko-KR'):''}`:String(value);
const directions={EE:'동향',WW:'서향',SS:'남향',NN:'북향',EN:'북동향',ES:'남동향',WN:'북서향',WS:'남서향'};
const propertyTypes={A01:'APT',A04:'JGC'};

// Read JSON data only. Never execute scripts embedded in a provider page.
export function finRenderedComplex(html,complexNo){
 if(typeof html!=='string'||html.length>8*1024*1024)fail('invalid_response');
 let found;
 const visit=value=>{
  if(!value||typeof value!=='object')return;
  if(value.queryKey?.[0]==='GET /complex'&&String(value.queryKey[1]?.params?.complexNumber)===complexNo&&value.state?.status==='success'&&value.state.data?.isSuccess===true){
   const result=value.state.data.result;
   if(found&&JSON.stringify(found)!==JSON.stringify(result))fail('incomplete');found=result;
  }
  for(const item of Object.values(value))visit(item);
 };
 let stream='';
 for(const match of html.matchAll(/self\.__next_f\.push\((\[1,[\s\S]*?\])\)<\/script>/g)){
  let part;try{part=JSON.parse(match[1])[1];}catch{fail('invalid_response');}
  if(typeof part!=='string')fail('invalid_response');stream+=part;
 }
  for(const line of stream.split('\n')){
   const entry=line.match(/^[0-9a-f]+:([\[{].*)$/);if(!entry)continue;
   let value;try{value=JSON.parse(entry[1]);}catch{continue;}visit(value);
  }
 if(!found)fail('incomplete');return found;
}

export function finComplexDetail(value,complexNo){
 if(!object(value)||!Object.hasOwn(propertyTypes,value.type)||typeof value.name!=='string'||!value.name.trim())fail('invalid_response');
 const address=value.address,coordinates=value.coordinates;
 if(!object(address)||!['city','division','sector','jibun','roadName'].every(key=>typeof address[key]==='string'&&address[key].trim())||!/^\d{10}$/.test(address.legalDivisionNumber||'')||!Number.isFinite(coordinates?.xCoordinate)||!Number.isFinite(coordinates?.yCoordinate))fail('invalid_response');
 return {complexNo,complexName:value.name,realEstateTypeCode:propertyTypes[value.type],cortarNo:address.legalDivisionNumber,cortarAddress:`${address.city} ${address.division} ${address.sector}`,detailAddress:address.jibun,roadAddress:`${address.city} ${address.division} ${address.roadName}`,longitude:coordinates.xCoordinate,latitude:coordinates.yCoordinate};
}

export function finArticle(raw,complexNo){
 if(!object(raw)||id(raw.complexNumber)!==complexNo||raw.tradeType!=='A1'||!Object.hasOwn(propertyTypes,raw.realEstateType))fail('invalid_response');
 const amount=man(raw.priceInfo?.dealPrice);
 return normalizeArticle({articleNo:id(raw.articleNumber),articleName:raw.articleName,realEstateTypeCode:propertyTypes[raw.realEstateType],tradeTypeCode:'A1',dealOrWarrantPrc:price(amount),area1:raw.spaceInfo?.supplySpace,area2:raw.spaceInfo?.exclusiveSpace,floorInfo:raw.articleDetail?.floorInfo,buildingName:raw.dongName,direction:directions[raw.articleDetail?.direction]||raw.articleDetail?.direction,articleConfirmYmd:raw.verificationInfo?.articleConfirmDate,articleFeatureDesc:raw.articleDetail?.articleFeatureDescription,realtorName:raw.brokerInfo?.brokerageName||raw.brokerInfo?.brokerName});
}

export function finListingGroup(target,complexNo,payload,{observedAt=new Date().toISOString()}={}){
 if(payload.apiVersion!=='fin-land-v1'||id(payload.complexNo)!==complexNo||!Array.isArray(payload.responses))fail('invalid_response');
 const detail=finComplexDetail(finRenderedComplex(payload.pageHtml,complexNo),complexNo);
 const pages=new Map();let signature,total,seed;
 for(const response of payload.responses){
  const url=new URL(response.url);
  if(url.origin!=='https://fin.land.naver.com'&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url.origin))fail('invalid_response');
  if(!url.pathname.startsWith('/front-api/v1/complex'))continue;
  if(response.status===429)fail('rate_limited');
  if([401,403].includes(response.status))fail('unauthorized');
  if(response.status!==200)fail('unavailable');
  if(url.pathname!=='/front-api/v1/complex/article/list')continue;
  const request=response.request,body=response.payload,result=body?.result;
  if(!object(request)||id(request.complexNumber)!==complexNo||JSON.stringify(request.tradeTypes)!=='["A1"]'||!Array.isArray(request.lastInfo)||body?.isSuccess!==true||!object(result)||!Array.isArray(result.list)||result.list.length>1000||typeof result.hasNextPage!=='boolean'||!Number.isSafeInteger(result.totalCount)||result.totalCount<0||result.totalCount>20000||!Array.isArray(result.lastInfo))fail('invalid_response');
  for(const key of ['dongNumbers','pyeongTypeNumbers'])if(request[key]?.length)fail('incomplete');
  const {lastInfo,seed:requestSeed,...filters}=request;
  const current=JSON.stringify(filters);
  if(signature!==undefined&&(current!==signature||total!==result.totalCount||seed!==result.seed))fail('incomplete');
  signature=current;total=result.totalCount;seed=result.seed;
  const cursor=JSON.stringify(lastInfo),previous=pages.get(cursor);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(result))fail('incomplete');
  pages.set(cursor,result);
 }
 const seenCursors=new Set(),representatives=new Set(),articles=new Map(),houses=new Map();
 let cursor='[]',pageCount=0,finished=false;
 while(pages.has(cursor)){
  if(seenCursors.has(cursor)||++pageCount>2000)fail('incomplete');seenCursors.add(cursor);
  const page=pages.get(cursor);
  if(page.hasNextPage&&!page.list.length)fail('incomplete');
  for(const entry of page.list){
   const representative=finArticle(entry.representativeArticleInfo,complexNo),representativeId=representative.id;
   if(representatives.has(representativeId))fail('incomplete');representatives.add(representativeId);
   const duplicate=entry.duplicatedArticleInfo;
   if(duplicate!==undefined&&(!object(duplicate)||!Array.isArray(duplicate.articleInfoList)||!Number.isInteger(duplicate.realtorCount)||!Number.isInteger(duplicate.directTradeCount)||duplicate.realtorCount<0||duplicate.directTradeCount<0||duplicate.articleInfoList.length!==duplicate.realtorCount+duplicate.directTradeCount))fail('incomplete');
   const children=duplicate?duplicate.articleInfoList.map(raw=>finArticle(raw,complexNo)):[];
   if(new Set(children.map(article=>article.id)).size!==children.length)fail('incomplete');
   if(duplicate&&!children.some(article=>article.id===representativeId))fail('incomplete');
   for(const article of [representative,...children]){
    if(houses.has(article.id)&&houses.get(article.id)!==representativeId)fail('incomplete');houses.set(article.id,representativeId);
    article.providerHouseId=`${complexNo}:${representativeId}`;
    if(articles.has(article.id)&&JSON.stringify(articles.get(article.id))!==JSON.stringify(article))fail('incomplete');articles.set(article.id,article);
   }
  }
  if(!page.hasNextPage){finished=true;break;}
  cursor=JSON.stringify(page.lastInfo);
 }
 if(!finished||seenCursors.size!==pages.size||representatives.size!==total)fail('incomplete');
 const values=[...articles.values()];
 const verification=verifyComplexEvidence({complexDetail:detail,article_building_dongs:values.map(article=>article.building)},target.favorite,complexNo,target.location);
 const sourceUrl=complexUrl(complexNo),group={favorite:target.favorite,complexNo,complexName:verification.complexName,tradeType:'A1',status:'ready',attemptedAt:observedAt,collectedAt:observedAt,errorCode:null,articles:values,collectionMethod:'browser',coverage:'complete',pageCount,sourceUrl,areaSource:'list',observation:housingObservation(detail,{sourceUrl,observedAt,verificationMethod:verification.method,buildingWitnesses:verification.buildingWitnesses})};
 if(!validListingGroup(group))fail('invalid_response');return group;
}
