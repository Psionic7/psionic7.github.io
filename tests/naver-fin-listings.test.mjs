import test from 'node:test';
import assert from 'node:assert/strict';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {parseComplexNo,validListingGroup,validListingObservation} from '../src/naver-listings.mjs';
import {finListingGroup,finRenderedComplex} from '../server/naver-fin-listings.mjs';

const target={favorite:makeApartmentFavorite({apartment:'검증단지',dong:'정자동',jibun:'121',road_address:'경기도 성남시 분당구 내정로 55'},{region_code:'41135',region_name:'경기도 성남시 분당구'})};
const complex={name:'검증단지',type:'A01',address:{city:'경기도',division:'성남시 분당구',sector:'정자동',jibun:'121',roadName:'내정로 55',legalDivisionNumber:'4113510300'},coordinates:{xCoordinate:127.112097,yCoordinate:37.364204}};
const stream=value=>'a:'+JSON.stringify({state:{status:'success',data:{isSuccess:true,result:value}},queryKey:['GET /complex',{params:{complexNumber:2645}}]})+'\n';
const script=value=>'<script>self.__next_f.push('+JSON.stringify([1,value])+')</script>';
const raw=(articleNumber,dealPrice=2850000000)=>({complexNumber:2645,articleNumber,articleName:'검증단지',dongName:'302',tradeType:'A1',realEstateType:'A01',spaceInfo:{supplySpace:153.81,exclusiveSpace:129.72},priceInfo:{dealPrice},articleDetail:{floorInfo:'16/19',direction:'SS',articleFeatureDescription:'검증'},verificationInfo:{articleConfirmDate:'2026-11-09'},brokerInfo:{brokerageName:'중개사'+articleNumber}});
function page(list,totalCount,hasNextPage,lastInfo,previous=[]){return {url:'https://fin.land.naver.com/front-api/v1/complex/article/list',status:200,request:{complexNumber:2645,tradeTypes:['A1'],lastInfo:previous},payload:{isSuccess:true,result:{seed:'fixed',list,totalCount,hasNextPage,lastInfo}}};}
function fixture(){const a=raw('11'),b=raw('12',2900000000);return {apiVersion:'fin-land-v1',complexNo:'2645',pageHtml:script(stream(complex)),responses:[page([{representativeArticleInfo:a,duplicatedArticleInfo:{articleInfoList:[a,b],realtorCount:2,directTradeCount:0}}],2,true,[1,'11']),page([{representativeArticleInfo:raw('21')}],2,false,[2,'21'],[1,'11'])]};}

test('current service preserves every broker price and provider relationship across all cursor pages',()=>{
 const group=finListingGroup(target,'2645',fixture());assert(validListingGroup(group));assert.equal(group.coverage,'complete');assert.equal(group.pageCount,2);
 assert.deepEqual(group.articles.map(a=>[a.id,a.priceMan,a.providerHouseId]),[['11',285000,'2645:11'],['12',290000,'2645:11'],['21',285000,'2645:21']]);
 assert.equal(group.articles[0].areaM2,129.72);assert.equal(group.articles[0].supplyAreaM2,153.81);assert.equal(group.articles[0].confirmedOn,'2026-11-09');assert.equal(group.observation.parcel_address,'경기도 성남시 분당구 정자동 121');
});
test('rendered complex JSON can span stream chunks and untrusted JavaScript is never executed',()=>{
 const value=stream(complex),html=script(value.slice(0,81))+script(value.slice(81))+'<script>throw Error("must not execute")</script>';
 assert.deepEqual(finRenderedComplex(html,'2645'),complex);assert.throws(()=>finRenderedComplex(html,'999'),e=>e.code==='incomplete');
});
test('missing pages, changed totals, cursor cycles and omitted broker advertisements never become complete',()=>{
 const cases=[p=>p.responses.pop(),p=>p.responses[1].payload.result.totalCount++,p=>p.responses[0].payload.result.lastInfo=[],p=>p.responses[0].payload.result.list[0].duplicatedArticleInfo.articleInfoList.pop()];
 for(const mutate of cases){const payload=fixture();mutate(payload);assert.throws(()=>finListingGroup(target,'2645',payload),e=>e.code==='incomplete');}
});
test('wrong complex, foreign origins, rental pollution and fractional currency are rejected',()=>{
 for(const mutate of [p=>p.responses[0].request.complexNumber=999,p=>p.responses[0].url='https://example.org/front-api/v1/complex/article/list',p=>p.responses[0].payload.result.list[0].representativeArticleInfo.tradeType='B1',p=>p.responses[0].payload.result.list[0].representativeArticleInfo.priceInfo.dealPrice++]){
  const payload=fixture();mutate(payload);assert.throws(()=>finListingGroup(target,'2645',payload),e=>e.code==='invalid_response');
 }
});
test('actual empty final page is required for zero ads, and data restrictions retain their own errors',()=>{
 const payload=fixture();payload.responses=[page([],0,false,[])];assert.equal(finListingGroup(target,'2645',payload).articles.length,0);
 payload.responses=[];assert.throws(()=>finListingGroup(target,'2645',payload),e=>e.code==='incomplete');
 for(const [status,code] of [[429,'rate_limited'],[403,'unauthorized'],[503,'unavailable']]){payload.responses=[{url:'https://fin.land.naver.com/front-api/v1/complex/article/list',status}];assert.throws(()=>finListingGroup(target,'2645',payload),e=>e.code===code);}
});
test('current and saved legacy links identify the same provider without accepting another host',()=>{
 const group=finListingGroup(target,'2645',fixture());assert.equal(group.sourceUrl,'https://fin.land.naver.com/complexes/2645');
 assert(validListingObservation({...group.observation,source_url:'https://new.land.naver.com/complexes/2645'},group));
 assert.equal(parseComplexNo('https://fin.land.naver.com/complexes/2645?tab=article'),'2645');assert.equal(parseComplexNo('https://fin.land.naver.com.evil.test/complexes/2645'),'');
});

test('current reconstruction classification is preserved and repeated child advertisements are rejected',()=>{
 const payload=fixture();payload.pageHtml=script(stream({...complex,type:'A04'}));
 for(const response of payload.responses)for(const item of response.payload.result.list)for(const raw of [item.representativeArticleInfo,...item.duplicatedArticleInfo?.articleInfoList||[]])raw.realEstateType='A04';
 assert(finListingGroup(target,'2645',payload).articles.every(article=>article.propertyType==='JGC'));
 const duplicate=fixture(),children=duplicate.responses[0].payload.result.list[0].duplicatedArticleInfo.articleInfoList;children[1]=children[0];
 assert.throws(()=>finListingGroup(target,'2645',duplicate),error=>error.code==='incomplete');
});
