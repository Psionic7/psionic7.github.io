import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {browserCaptureGroup,saveBrowserCapture} from '../server/naver-browser-capture.mjs';
import {createListingCollector} from '../server/naver-listings.mjs';
import {listingMiddleware} from '../server/naver-listings-api.mjs';
import {validListingGroup} from '../src/naver-listings.mjs';

const favorite=makeApartmentFavorite({apartment:'테스트단지',dong:'풍덕천동',jibun:'1112'},{region_code:'41465',region_name:'경기도 용인시 수지구'});
const observedAt='2026-11-06T00:00:00.000Z';
const capture=()=>({version:1,favorite,sourceUrl:'https://new.land.naver.com/complexes/12345',observedAt,complexDetail:{complexNo:'12345',complexName:'테스트단지',cortarAddress:'경기도 용인시 수지구 풍덕천동',detailAddress:'1112'},articles:[{articleNo:'26000000001',articleName:'테스트단지',tradeTypeCode:'A1',dealOrWarrantPrc:'13억 5,000',area2:84.9,area1:112.3,floorInfo:'10/20',buildingName:'101동',direction:'남향',articleConfirmYmd:'20261105'}]});
const now=Date.parse(observedAt)+1000;
function fixture(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'naver-browser-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));return path.join(folder,'snapshot.json');}

test('browser observations retain origin, observation time and partial coverage',()=>{
  const group=browserCaptureGroup(capture(),{now});assert(validListingGroup(group));assert.equal(group.collectionMethod,'browser');assert.equal(group.coverage,'partial');assert.equal(group.collectedAt,observedAt);assert.equal(group.articles[0].priceMan,135000);
});

test('missing ads, future observations, wrong addresses and forged Naver URLs cannot be imported',()=>{
  for(const change of [{articles:[]},{sourceUrl:'https://evil.test/complexes/12345'},{sourceUrl:'12345'},{observedAt:'2099-01-01T00:00:00.000Z'},{complexDetail:{...capture().complexDetail,detailAddress:'2222'}},{articles:[...capture().articles,...capture().articles]}])assert.throws(()=>browserCaptureGroup({...capture(),...change},{now}));
});

test('invalid captures preserve existing output and valid captures strip extra fields',t=>{
  const filename=fixture(t),input=capture();input.cookies='must-not-be-saved';input.articles[0].unrelatedToken='must-not-be-saved';saveBrowserCapture(input,filename,{now});
  const before=fs.readFileSync(filename,'utf8');assert(!before.includes('must-not-be-saved'));assert.throws(()=>saveBrowserCapture({...capture(),articles:[]},filename,{now}));assert.equal(fs.readFileSync(filename,'utf8'),before);
  assert.throws(()=>saveBrowserCapture({...capture(),observedAt:'2026-01-01T00:00:00.000Z'},filename,{now}),/과거/);
});

test('failed API refresh of browser observations preserves the partial-coverage label',async()=>{
  const group=browserCaptureGroup(capture(),{now}),collector=createListingCollector({now:()=>now+301000,initialSnapshot:{version:1,source:'naver-land',generatedAt:observedAt,groups:[group]},fetcher:async()=>new Response('{}',{status:429})});
  const failed=await collector.collect(favorite,'12345');assert.equal(failed.status,'failed');assert.equal(failed.collectionMethod,'browser');assert.equal(failed.coverage,'partial');assert.deepEqual(failed.articles,group.articles);
});

test('running local API reads newly captured browser data without restarting the server',async t=>{
  const filename=fixture(t),collector=createListingCollector(),middleware=listingMiddleware({collector,snapshotFile:filename});
  const server=http.createServer((req,res)=>{middleware(req,res,()=>res.end());});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const read=async()=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/naver-listings/read`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,favorites:[favorite],connections:[]})});assert.equal(response.status,200);return response.json();};
  assert.equal((await read()).groups.length,0);saveBrowserCapture(capture(),filename,{now});const snapshot=await read();assert.equal(snapshot.groups[0].articles.length,1);assert.equal(snapshot.groups[0].coverage,'partial');
});
