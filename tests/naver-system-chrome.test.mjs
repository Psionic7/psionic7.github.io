import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createSystemChromeListingSource} from '../server/naver-system-chrome.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {listingSnapshot} from '../src/naver-listings.mjs';
import {createDailyListingSource} from '../server/naver-listing-source.mjs';

const favorite=makeApartmentFavorite({apartment:'수지테스트',dong:'풍덕천동',jibun:'1191'},{region_code:'41465',region_name:'경기도 용인시 수지구'});
const detail={complexDetail:{complexNo:'10959',complexName:'수지테스트',cortarAddress:'경기도 용인시 수지구 풍덕천동',detailAddress:'1191'}};
const article={articleNo:'2660123456',articleName:'수지테스트',realEstateTypeCode:'APT',tradeTypeCode:'A1',dealOrWarrantPrc:'13억',area1:112.56,area2:84.97};
const responses=[{url:'https://new.land.naver.com/api/complexes/10959',status:200,payload:detail},{url:'https://new.land.naver.com/api/articles/complex/10959?sameAddressGroup=false&realEstateType=APT&tradeType=A1&page=1',status:200,payload:{articleList:[article],isMoreData:false}}];
function worker(reply){
  const child=new EventEmitter();child.stdout=new PassThrough();child.kill=()=>{child.killed=true;child.emit('exit',1);};
  child.stdin=new Writable({write(chunk,encoding,done){const request=JSON.parse(String(chunk));if(request.close)child.emit('exit',0);else {child.request=request;let value=reply(request);if(request.inspect&&value?.responses)value={complexNo:value.complexNo,complexDetail:value.responses.find(r=>r.payload?.complexDetail)?.payload.complexDetail};if(value!==undefined)queueMicrotask(()=>child.stdout.write(JSON.stringify(value)+'\n'));}done();}});
  setImmediate(()=>child.stdout.write('{"ready":true}\n'));return child;
}
test('metadata-only resolution verifies actual coordinates without collecting stock pages and known ID bypasses discovery',async()=>{
 const requests=[],actual={...detail.complexDetail,latitude:37.33,longitude:127.09};
 const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>worker(request=>{requests.push(request);return {complexNo:'10959',complexDetail:actual};})});
 try{
  const result=await source.resolve({favorite,query:'풍덕천동 수지테스트'},{complexNo:'10959'});
  assert.equal(result.observation.latitude,37.33);assert.equal(result.observation.coordinate_role,'provider_label');assert.equal(result.articles,undefined);
  assert.equal(requests.length,1);assert.equal(requests[0].inspect,true);assert.equal(requests[0].discover,undefined);
 }finally{await source.close();}
});
test('metadata resolution falls back to actual complete advertisements when a shared provider needs an exclusive building witness',async()=>{
 const requests=[],road='경기도 용인시 수지구 테스트로 1';
 const expected={...favorite,id:'cohort:hub:test:phase',identity_ref:{kind:'cohort',id:'cohort:hub:test:phase'},road_address:road};
 const observed={...detail.complexDetail,roadAddress:'경기도 용인시 수지구 테스트로 2',latitude:37.33,longitude:127.09};
 const pages=[{...responses[0],payload:{complexDetail:observed}},{...responses[1],payload:{articleList:[{...article,buildingName:'510동'}],isMoreData:false}}];
 const source=await createDailyListingSource({python:'test-python',discover:false,spawnWorker:()=>worker(request=>{requests.push(request);return request.inspect?{complexNo:'10959',complexDetail:observed}:{complexNo:'10959',responses:pages};})});
 try{
  const result=await source.resolve({favorite:expected,location:{roads:[{road_address:road,source:'official'}],exclusive_building_dongs:['510']}},{complexNo:'10959'});
  assert.equal(result.observation.verification_method,'verified_primary_parcel_and_building_ads');assert.deepEqual(result.observation.building_witnesses,['510']);
  assert.equal(requests.length,2);assert.equal(requests[0].inspect,true);assert.equal(requests[1].inspect,undefined);
 }finally{await source.close();}
});
test('system Chrome responses produce a sanitized complete snapshot with address and every page validated',async()=>{
  const child=worker(()=>({complexNo:'10959',responses}));
  const source=await createSystemChromeListingSource({python:'test-python',connections:[{id:favorite.id,complexNo:'10959'}],spawnWorker:()=>child});
  try{const group=await source.collect({favorite,query:'풍덕천동 수지테스트'});assert.equal(group.articles.length,1);assert.equal(group.coverage,'complete');assert.equal(group.pageCount,1);assert.equal(group.articles[0].priceMan,130000);assert.equal(child.request.complexNo,'10959');}
  finally{await source.close();}
});
test('partial pages, foreign origins, mismatched lots and auth walls never become successful empty snapshots',async()=>{
  const cases=[
    [{complexNo:'10959',responses:responses.map((r,i)=>i===1?{...r,payload:{articleList:[article],isMoreData:true}}:r)},'incomplete'],
    [{complexNo:'10959',responses:[{...responses[0],url:'https://example.org/api/complexes/10959'}]},'invalid_response'],
    [{complexNo:'10959',responses:[{...responses[0],payload:{complexDetail:{...detail.complexDetail,detailAddress:'99'}}},responses[1]]},'address_mismatch'],
    [{errorCode:'unauthorized'},'unauthorized']
  ];
  for(const [response,code] of cases){const source=await createSystemChromeListingSource({python:'test-python',connections:[{id:favorite.id,complexNo:'10959'}],spawnWorker:()=>worker(()=>response)});try{await assert.rejects(source.collect({favorite,query:'test'}),e=>e.code===code);}finally{await source.close();}}
});
test('a hung or crashed browser stops the worker and reports failure',async()=>{
  const child=worker(()=>undefined),source=await createSystemChromeListingSource({python:'test-python',connections:[{id:favorite.id,complexNo:'10959'}],spawnWorker:()=>child,timeoutMs:100});
  try{await assert.rejects(source.collect({favorite,query:'test'}),e=>e.code==='timeout');assert.equal(child.killed,true);}finally{await source.close();}
});
test('current Naver address field and server-rendered address proof both preserve parcel verification',async()=>{
  const {cortarAddress,...rest}=detail.complexDetail;
  const current={...rest,address:cortarAddress,cortarNo:'4146510100'};
  for(const payload of [{complexNo:'10959',responses:[{...responses[0],payload:{complexDetail:current}},responses[1]]},{complexNo:'10959',complexDetail:detail.complexDetail,responses:[{...responses[0],payload:{initial:true}},responses[1]]}]){
    const source=await createSystemChromeListingSource({python:'test-python',connections:[{id:favorite.id,complexNo:'10959'}],spawnWorker:()=>worker(()=>payload)});
    try{assert.equal((await source.collect({favorite,query:'test'})).articles.length,1);}finally{await source.close();}
  }
});
test('missing or ambiguous browser search connections remain unmatched without requesting a page',async()=>{
  const child=worker(()=>{throw Error('should not navigate');});
  const source=await createSystemChromeListingSource({python:'test-python',spawnWorker:()=>child});
  try{await assert.rejects(source.collect({favorite,query:'test'}),e=>e.code==='unmatched');assert.equal(child.request,undefined);}finally{await source.close();}
});
test('explicit first-page mode retains partial coverage and never presents an empty filtered page as zero listings',async()=>{
  for(const [raw,expected] of [[article,'partial'],[{...article,realEstateTypeCode:'ABYG'},'incomplete'],[{...article,tradeTypeCode:'B1'},'incomplete'],[{...article,tradeTypeCode:'B2'},'incomplete']]){
    const payload={complexNo:'10959',complexDetail:detail.complexDetail,responses:[{...responses[1],payload:{articleList:[raw],isMoreData:true}}]};
    const source=await createSystemChromeListingSource({python:'test-python',connections:[{id:favorite.id,complexNo:'10959'}],firstPageOnly:true,spawnWorker:()=>worker(()=>payload)});
    try{if(expected==='partial'){const group=await source.collect({favorite});assert.equal(group.coverage,'partial');assert.equal(group.articles.length,1);assert.equal(group.pageCount,undefined);}else await assert.rejects(source.collect({favorite}),e=>e.code==='incomplete');}finally{await source.close();}
  }
});
test('duplicate registrations reuse observation time while still checking every requested parcel',async()=>{
  let requests=0;
  const child=worker(()=>{requests++;return {complexNo:'10959',responses};});
  const source=await createSystemChromeListingSource({python:'test-python',connections:[{id:favorite.id,complexNo:'10959'}],spawnWorker:()=>child});
  try{const first=await source.collect({favorite});const second=await source.collect({favorite});assert.equal(requests,1);assert.equal(first.collectedAt,second.collectedAt);const wrong=makeApartmentFavorite({apartment:'다른단지',dong:'풍덕천동',jibun:'99'},{region_code:'41465',region_name:'경기도 용인시 수지구'});await assert.rejects(source.collect({favorite:wrong},{complexNo:'10959'}),e=>e.code==='address_mismatch');assert.equal(requests,1);}finally{await source.close();}
});

test('unmapped targets search automatically and verify names and parcel before returning complete sale ads',async()=>{
  const requests=[];
  const child=worker(request=>{requests.push(request);return request.discover?{candidates:[{complexNo:'10959',name:favorite.apartment}]}:{complexNo:'10959',responses};});
  const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>child});
  try{
    const group=await source.collect({favorite,query:'풍덕천동 수지테스트'});
    assert.equal(group.coverage,'complete');assert.equal(group.tradeType,'A1');assert.equal(requests.length,3);
    assert.equal(requests[0].discover,true);assert.deepEqual(requests[0].names,[favorite.apartment]);
    assert.equal(requests[1].complexNo,'10959');assert.equal(requests[1].inspect,true);assert.equal(requests[2].inspect,undefined);
  }finally{await source.close();}
});

test('a failed canonical query tries a registered alias and keeps parcel checks',async()=>{
 const targetFavorite={...favorite,name_aliases:['수지테스트']},queries=[];
 const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>worker(request=>{
  if(request.discover){queries.push(request.query);return {candidates:queries.length===1?[]:[{complexNo:'10959',name:favorite.apartment}]};}
  return {complexNo:'10959',responses};
 })});
 try{
  const group=await source.collect({favorite:targetFavorite,query:'풍덕천동 대장에만 있는 긴 이름'});
  assert.equal(group.complexNo,'10959');assert.deepEqual(queries,['풍덕천동 대장에만 있는 긴 이름','풍덕천동 수지테스트']);
 }finally{await source.close();}
});

test('identical discovery is reused within one run while each master address is verified',async()=>{
 let searches=0;
 const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>worker(request=>request.discover?(searches++,{candidates:[{complexNo:'10959',name:favorite.apartment}]}):{complexNo:'10959',responses})});
 try{
  await source.collect({favorite,query:'풍덕천동 수지테스트'});
  await assert.rejects(source.collect({favorite:{...favorite,id:'other-master',jibun:'1192'},query:'풍덕천동 수지테스트'}),error=>error.code==='unmatched');
  assert.equal(searches,1);
 }finally{await source.close();}
});

test('daily source seeds verified snapshot connections but rechecks their address with a new browser observation',async()=>{
  const original=await createSystemChromeListingSource({python:'test-python',spawnWorker:()=>worker(()=>({complexNo:'10959',responses}))});
  let saved;try{saved=await original.collect({favorite},{complexNo:'10959'});}finally{await original.close();}
  const requests=[],child=worker(request=>{requests.push(request);return {complexNo:'10959',responses};});
  const source=await createDailyListingSource({python:'test-python',initialSnapshot:listingSnapshot([saved]),spawnWorker:()=>child});
  try{assert.equal((await source.collect({favorite,query:'test'})).articles.length,1);assert.equal(requests.length,1);assert.equal(requests[0].discover,undefined);assert.equal(requests[0].complexNo,'10959');}
  finally{await source.close();}
});

test('a short registered trade name discovers its numbered Naver phase and still verifies the exact parcel',async()=>{
  const registered=makeApartmentFavorite({...favorite,apartment:'삼성아파트',master_id:'hub:registered',trade_keys:[JSON.stringify([favorite.dong,favorite.jibun,'삼성1'])]},favorite);
  for(const wrongParcel of [false,true]){
    const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>worker(request=>{
      if(request.discover)return {candidates:request.names.includes('삼성1차')?[{complexNo:'10959',name:'삼성1차'}]:[]};
      return {complexNo:'10959',responses:responses.map((response,index)=>index===0?{...response,payload:{complexDetail:{...detail.complexDetail,complexName:'삼성1차',detailAddress:wrongParcel?'99':favorite.jibun}}}:response)};
    })});
    try{
      const collect=()=>source.collect({favorite:registered,query:'풍덕천동 삼성1'});
      if(wrongParcel)await assert.rejects(collect,e=>e.code==='unmatched');
      else {const group=await collect();assert.equal(group.complexName,'삼성1차');assert.equal(group.favorite.id,registered.id);assert.equal(group.coverage,'complete');assert.equal(group.articles.length,1);}
    }finally{await source.close();}
  }
});

test('wrong names, mismatched parcels and ambiguous same-address search results never become successful connections',async()=>{
  for(const mode of ['name','parcel','ambiguous']){
    let navigations=0,fullCollections=0;
    const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>worker(request=>{
      if(request.discover)return {candidates:[{complexNo:'10959',name:mode==='name'?'다른아파트':favorite.apartment},...(mode==='ambiguous'?[{complexNo:'10960',name:favorite.apartment}]:[])]};
      navigations++;
      if(!request.inspect)fullCollections++;
      return {complexNo:request.complexNo,responses:responses.map((r,i)=>({...r,url:r.url.replaceAll('10959',request.complexNo),...(i===0?{payload:{complexDetail:{...detail.complexDetail,complexNo:request.complexNo,detailAddress:mode==='parcel'?'99':'1191'}}}:{})}))};
    })});
    try{await assert.rejects(source.collect({favorite,query:'풍덕천동 수지테스트'}),e=>e.code==='unmatched');assert.equal(navigations,mode==='name'?0:mode==='ambiguous'?2:1);assert.equal(fullCollections,0);}finally{await source.close();}
  }
});

test('cancelling an automatic search kills its worker without saving a connection',async()=>{
  const controller=new AbortController(),child=worker(()=>undefined);
  const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>child});
  try{const pending=source.collect({favorite,query:'test'},{signal:controller.signal});controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(child.killed,true);}finally{await source.close();}
});

const mapPoint={latitude:37.33,longitude:127.09};
const mapLocation={anchors:[{latitude:37.3302,longitude:127.09,source:'Juso',role:'entrance',crs:'EPSG:4326'}],roads:[{road_address:'경기도 용인시 수지구 테스트로 1',source:'Juso'}],primary_parcels:[{pnu:'4146510100111910000',source:'V-World',geometry:{type:'Polygon',coordinates:[[[127.0895,37.3295],[127.0905,37.3295],[127.0905,37.3305],[127.0895,37.3305],[127.0895,37.3295]]]}}],parcels:[]};
function mapResponses(id,changes={}) {
 return responses.map((response,index)=>({...response,url:response.url.replaceAll('10959',id),...(index===0?{payload:{complexDetail:{...detail.complexDetail,complexNo:id,complexName:'완전히다른새이름',detailAddress:'1192',roadAddress:'경기도 용인시 수지구 테스트로 1',...mapPoint,...changes}}}:{})}));
}
test('actual map candidates bypass substring naming and preserve provider coordinates after independent address verification',async()=>{
 const requests=[];
 const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>worker(request=>{
  requests.push(request);
  if(request.discover)return {candidates:request.location?[{complexNo:'10959',name:'완전히다른새이름',...mapPoint},{complexNo:'10960',name:'이웃새이름',...mapPoint}]:[]};
  return {complexNo:request.complexNo,responses:mapResponses(request.complexNo,request.complexNo==='10960'?{roadAddress:'경기도 용인시 수지구 테스트로 2'}:{})};
 })});
 try{
  const group=await source.collect({favorite,query:'풍덕천동 수지테스트',location:mapLocation});
  assert.equal(group.complexName,'완전히다른새이름');assert.equal(group.observation.latitude,mapPoint.latitude);assert.notEqual(group.observation.latitude,mapLocation.anchors[0].latitude);
  assert.equal(group.observation.verification_method,'verified_road_and_primary_polygon');assert.equal(group.favorite.location,undefined);assert.equal(group.coverage,'complete');
  assert.deepEqual(requests.filter(request=>!request.discover&&!request.inspect).map(request=>request.complexNo),['10959']);
 }finally{await source.close();}
});
test('multiple same-position map candidates with supported addresses remain unresolved before full collection',async()=>{
 let full=0;
 const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>worker(request=>{
  if(request.discover)return {candidates:[{complexNo:'10959',name:'새이름1',...mapPoint},{complexNo:'10960',name:'새이름2',...mapPoint}]};
  if(!request.inspect)full++;
  return {complexNo:request.complexNo,responses:mapResponses(request.complexNo)};
 })});
 try{await assert.rejects(source.collect({favorite,query:'test',location:mapLocation}),error=>error.code==='unmatched');assert.equal(full,0);}finally{await source.close();}
});
test('a nearby label outside a parcel is inspected and may use actual legacy parcel proof',async()=>{
 let inspected=false;
 const outside={latitude:37.3307,longitude:127.09};
 const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>worker(request=>{
  if(request.discover)return {candidates:[{complexNo:'10959',name:'이름변경',...outside}]};
  if(request.inspect)inspected=true;
  return {complexNo:'10959',responses:mapResponses('10959',{...outside,detailAddress:favorite.jibun})};
 })});
 try{const group=await source.collect({favorite,query:'test',location:mapLocation});assert.equal(inspected,true);assert.equal(group.observation.verification_method,'parcel');}finally{await source.close();}
});
