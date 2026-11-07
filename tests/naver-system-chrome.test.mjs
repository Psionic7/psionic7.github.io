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
  child.stdin=new Writable({write(chunk,encoding,done){const request=JSON.parse(String(chunk));if(request.close)child.emit('exit',0);else {child.request=request;const value=reply(request);if(value!==undefined)queueMicrotask(()=>child.stdout.write(JSON.stringify(value)+'\n'));}done();}});
  setImmediate(()=>child.stdout.write('{"ready":true}\n'));return child;
}
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
    assert.equal(group.coverage,'complete');assert.equal(group.tradeType,'A1');assert.equal(requests.length,2);
    assert.equal(requests[0].discover,true);assert.deepEqual(requests[0].names,[favorite.apartment]);
    assert.equal(requests[1].complexNo,'10959');
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
    let navigations=0;
    const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>worker(request=>{
      if(request.discover)return {candidates:[{complexNo:'10959',name:mode==='name'?'다른아파트':favorite.apartment},...(mode==='ambiguous'?[{complexNo:'10960',name:favorite.apartment}]:[])]};
      navigations++;
      return {complexNo:request.complexNo,responses:responses.map((r,i)=>({...r,url:r.url.replaceAll('10959',request.complexNo),...(i===0?{payload:{complexDetail:{...detail.complexDetail,complexNo:request.complexNo,detailAddress:mode==='parcel'?'99':'1191'}}}:{})}))};
    })});
    try{await assert.rejects(source.collect({favorite,query:'풍덕천동 수지테스트'}),e=>e.code==='unmatched');assert.equal(navigations,mode==='name'?0:mode==='ambiguous'?2:1);}finally{await source.close();}
  }
});

test('cancelling an automatic search kills its worker without saving a connection',async()=>{
  const controller=new AbortController(),child=worker(()=>undefined);
  const source=await createDailyListingSource({python:'test-python',spawnWorker:()=>child});
  try{const pending=source.collect({favorite,query:'test'},{signal:controller.signal});controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(child.killed,true);}finally{await source.close();}
});
