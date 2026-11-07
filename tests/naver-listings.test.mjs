import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {secretValues,checkedBytes} from '../server/storage.mjs';
import {createListingCollector,normalizeArticle,priceMan,writeListingSnapshot,verifyComplex} from '../server/naver-listings.mjs';
import {listingMiddleware} from '../server/naver-listings-api.mjs';
import {saleListingGroup,parseComplexNo,validListingSnapshot,listingSnapshot,listingIsStale,selectArticles,validTargets} from '../src/naver-listings.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';

const favorite=makeApartmentFavorite({apartment:'관심아파트',dong:'풍덕천동',jibun:'1112'}, {region_code:'41465',region_name:'경기도 용인시 수지구'});
const detail={complexDetail:{complexNo:'12345',complexName:'관심아파트',cortarNo:'4146510100',cortarAddress:'경기도 용인시 수지구 풍덕천동',detailAddress:'1112'}};
const raw=(id='26000000001',extra={})=>({articleNo:id,articleName:'관심아파트',realEstateTypeCode:'APT',articleStatus:'R0',tradeTypeCode:'A1',dealOrWarrantPrc:'13억 5,000',area1:112.3,area2:84.9,floorInfo:'10/20',buildingName:'101동',direction:'남향',articleConfirmYmd:'20261105',articleFeatureDesc:'채광 좋은 집',realtorName:'공인중개사',...extra});
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
const targets=(f=favorite)=>({version:1,favorites:[f],connections:[{favoriteId:f.id,complexNo:'12345'}]});
function fixture(t,options={}) {
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'naver-listings-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  let tick=Date.parse('2026-11-06T00:00:00.000Z'),pages=[{articleList:[raw()],isMoreData:false}],calls=[];
  const fetcher=async(url,init)=>{calls.push({url,init});return new URL(url).pathname.startsWith('/api/complexes/')?json(detail):json(pages[Number(new URL(url).searchParams.get('page'))-1]);};
  const settings={stateFile:path.join(folder,'cache.json'),fetcher,now:()=>tick,requestGap:0,...options};
  return {folder,settings,calls,collector:createListingCollector(settings),advance:ms=>{tick+=ms;},pages:value=>{pages=value;}};
}

test('complex links and saved targets accept only Naver numeric IDs and known favorites',()=>{
  assert.equal(parseComplexNo(' https://new.land.naver.com/complexes/12345?a=1 '),'12345');
  for(const bad of ['https://evil.test/complexes/12345','https://new.land.naver.com@evil.test/complexes/12345','https://new.land.naver.com:8443/complexes/12345','javascript:123','001','0','12345abc'])assert.equal(parseComplexNo(bad),'');
  assert(validTargets(targets()));assert(!validTargets({...targets(),connections:[...targets().connections,...targets().connections]}));
  assert(!validTargets({...targets(),connections:[{favoriteId:'unrelated',complexNo:'12345'}]}));
});

test('price and article normalization preserve deposit, rent and exclusive/supply areas',()=>{
  assert.equal(priceMan('13억 5,000'),135000);assert.equal(priceMan('3억'),30000);assert.equal(priceMan('8,000'),8000);
  for(const value of ['가격문의','1.2억','-10','Infinity',null])assert.throws(()=>priceMan(value));
  const article=normalizeArticle(raw('26000000002',{tradeTypeCode:'B2',dealOrWarrantPrc:'1억',rentPrc:'120'}));
  assert.equal(article.priceMan,10000);assert.equal(article.rentMan,120);assert.equal(article.areaM2,84.9);assert.equal(article.supplyAreaM2,112.3);
  assert.equal(normalizeArticle(raw('26000000003',{articleStatus:'R1'})),null);
  for(const extra of [{area2:'NaN'},{articleConfirmYmd:'20260230'},{articleConfirmYmd:'20269999'},{tradeTypeCode:'X'},{realEstateTypeCode:'OPST'}])assert.throws(()=>normalizeArticle(raw(undefined,extra)));
});

test('collects every page, excludes ended ads, persists sanitized results and restores cache',async t=>{
  const f=fixture(t,{authorization:'private-test-token'});
  f.pages([{articleList:[raw(),raw('26000000002',{articleStatus:'R1'})],isMoreData:true},{articleList:[raw('26000000003',{tradeTypeCode:'B1',dealOrWarrantPrc:'8억'})],isMoreData:false}]);
  const group=await f.collector.collect(favorite,'12345');
  assert.equal(group.status,'ready');assert.equal(group.articles.length,1);assert.equal(group.tradeType,'A1');assert.equal(f.calls.length,3);assert.equal(new URL(f.calls[1].url).searchParams.get('tradeType'),'A1');
  assert(f.calls.every(c=>new URL(c.url).hostname==='new.land.naver.com'&&c.init.headers.Authorization==='Bearer private-test-token'));
  assert.equal(new URL(f.calls[1].url).searchParams.get('sameAddressGroup'),'false');
  const stored=fs.readFileSync(f.settings.stateFile,'utf8');assert(!stored.includes('private-test-token'));assert(!stored.includes('articleList'));assert(validListingSnapshot(JSON.parse(stored)));
  const restored=createListingCollector(f.settings);assert.deepEqual(restored.read(favorite,'12345'),group);await restored.collect(favorite,'12345');assert.equal(f.calls.length,3);
});

test('verified empty list is a successful zero; missing response fields are failures',async t=>{
  const f=fixture(t);f.pages([{articleList:[],isMoreData:false}]);
  assert.equal((await f.collector.collect(favorite,'12345')).status,'ready');
  f.advance(301000);f.pages([{articleList:[]}]);
  const failed=await f.collector.collect(favorite,'12345');assert.equal(failed.status,'failed');assert(failed.collectedAt);assert.equal(failed.errorCode,'invalid_response');
});

test('repeated pages, malformed ads and failed later pages preserve the whole last success',async t=>{
  const f=fixture(t),before=await f.collector.collect(favorite,'12345');
  for(const pages of [[{articleList:[raw()],isMoreData:true},{articleList:[raw()],isMoreData:false}],[{articleList:[raw(undefined,{area2:'bad'})],isMoreData:false}],[{articleList:[raw()],isMoreData:true},{}],[{articleList:[raw()],isMoreData:true},{articleList:[],isMoreData:false}]]) {
    f.advance(301000);f.pages(pages);const result=await f.collector.collect(favorite,'12345');
    assert.equal(result.status,'failed');assert.deepEqual(result.articles,before.articles);assert.equal(result.collectedAt,before.collectedAt);
  }
});

test('a page bound prevents partial publication',async t=>{
  const f=fixture(t,{maxPages:1});f.pages([{articleList:[raw()],isMoreData:true}]);
  const group=await f.collector.collect(favorite,'12345');assert.equal(group.errorCode,'incomplete');assert.equal(group.collectedAt,null);assert.deepEqual(group.articles,[]);
});

test('same-name apartment at another lot or district is never collected',async t=>{
  for(const changed of [{jibun:'1113'},{region_code:'11110',region_name:'서울특별시 종로구'}]) {
    const f=fixture(t),other=makeApartmentFavorite({...favorite,...changed},{...favorite,...changed});
    const result=await f.collector.collect(other,'12345');assert.equal(result.errorCode,'address_mismatch');assert.equal(f.calls.length,1);
  }
});

test('parcel comparison preserves mountain parcels and normalizes only numeric leading zeros and zero sub-lots',()=>{
  assert.equal(verifyComplex(detail,{...favorite,jibun:'01112-0000'},'12345'),'관심아파트');
  for(const jibun of ['산1112','1112-1','미상'])assert.throws(()=>verifyComplex(detail,{...favorite,jibun},'12345'),/주소/);
  assert.throws(()=>verifyComplex({complexDetail:{...detail.complexDetail,detailAddress:'미상'}},{...favorite,jibun:'미상'},'12345'),/주소/);
});

test('a new connection does not inherit previous-complex results',async t=>{
  const f=fixture(t);await f.collector.collect(favorite,'12345');
  const failed=await f.collector.collect(favorite,'99999');assert.equal(failed.status,'failed');assert.equal(failed.collectedAt,null);assert.deepEqual(failed.articles,[]);
});

test('429 honors a cooldown and auth, HTML, null, transport failures cannot become zero results',async t=>{
  for(const [response,code] of [[()=>json({},429),'rate_limited'],[()=>json({},401),'unauthorized'],[()=>json({},403),'unauthorized'],[()=>new Response('<html>blocked</html>'),'invalid_response'],[()=>json(null),'invalid_response'],[()=>{throw new Error('private-token');},'unavailable']]) {
    let calls=0;const f=fixture(t,{fetcher:async()=>{calls++;return response();}});
    const first=await f.collector.collect(favorite,'12345');assert.equal(first.errorCode,code);assert.equal(first.collectedAt,null);
    if(code==='rate_limited'){f.advance(301000);await f.collector.collect(favorite,'12345');assert.equal(calls,1);}
    assert(!JSON.stringify(first).includes('private-token'));
  }
});

test('serialized concurrent collection shares the cache and requests have a minimum gap',async t=>{
  const gaps=[],f=fixture(t,{requestGap:1200,pause:async ms=>{gaps.push(ms);f.advance(ms);}});
  const results=await Promise.all([f.collector.collect(favorite,'12345'),f.collector.collect(favorite,'12345')]);
  assert.deepEqual(results[0],results[1]);assert.equal(f.calls.length,2);assert.deepEqual(gaps,[1200]);
});

test('invalid stored snapshots fail explicitly and invalid writes preserve old file',async t=>{
  const f=fixture(t);await f.collector.collect(favorite,'12345');const before=fs.readFileSync(f.settings.stateFile,'utf8');
  assert.throws(()=>writeListingSnapshot(f.settings.stateFile,{groups:[]}));assert.equal(fs.readFileSync(f.settings.stateFile,'utf8'),before);
  fs.writeFileSync(f.settings.stateFile,'{}');assert.throws(()=>createListingCollector(f.settings),/검증 실패/);
});

test('a previous published snapshot survives a failed refresh even when no local cache exists',async t=>{
  const f=fixture(t),group=await f.collector.collect(favorite,'12345');
  const fresh=createListingCollector({initialSnapshot:listingSnapshot([group]),fetcher:async()=>json({},429),now:()=>Date.parse(group.attemptedAt)+301000,requestGap:0});
  const failed=await fresh.collect(favorite,'12345');assert.equal(failed.errorCode,'rate_limited');assert.deepEqual(failed.articles,group.articles);assert.equal(failed.collectedAt,group.collectedAt);
});

test('snapshot filtering and freshness distinguish a failed attempt and an old success',async t=>{
  const f=fixture(t),group=await f.collector.collect(favorite,'12345');
  assert.equal(listingIsStale(group,Date.parse(group.collectedAt)+1000),false);assert.equal(listingIsStale(group,Date.parse(group.collectedAt)+86400001),true);
  const rent=normalizeArticle(raw('26000000002',{tradeTypeCode:'B2',dealOrWarrantPrc:'2억',rentPrc:'100',area2:59}));
  assert.deepEqual(selectArticles([...group.articles,rent],{tradeType:'B2',maxArea:'60'}),[rent]);assert.equal(selectArticles([...group.articles,rent])[0].id,rent.id);
  assert(!validListingSnapshot({...listingSnapshot([group]),groups:[group,group]}));
});

test('legacy cache and partial samples expose only sales without inventing an empty complete result or a new observation',async t=>{
  const f=fixture(t),sale=await f.collector.collect(favorite,'12345');
  const rent=normalizeArticle(raw('26000000002',{tradeTypeCode:'B1',dealOrWarrantPrc:'8억'}));
  const mixed={...sale,tradeType:undefined,articles:[...sale.articles,rent]};
  const restored=createListingCollector({initialSnapshot:listingSnapshot([mixed])}).read(favorite,'12345');
  assert.deepEqual(restored.articles,sale.articles);assert.equal(restored.collectedAt,sale.collectedAt);assert.equal(restored.tradeType,'A1');
  assert.equal(saleListingGroup({...mixed,collectionMethod:'browser',coverage:'partial',sourceUrl:'https://new.land.naver.com/complexes/12345',articles:[rent]}),null);
  assert.equal(validListingSnapshot(listingSnapshot([{...mixed,tradeType:'A1'}])),false);
});

test('new snapshots remove superseded regional reports so a later daily export can still publish',async t=>{
  const f=fixture(t),snapshot=JSON.parse(fs.readFileSync(new URL('../public/listings/snapshot.json',import.meta.url),'utf8'));
  const reportFile=path.join(f.folder,'region-41465-report.json');
  fs.copyFileSync(new URL('../public/listings/region-41465-report.json',import.meta.url),reportFile);
  writeListingSnapshot(f.settings.stateFile,snapshot);assert.equal(fs.existsSync(reportFile),true);
  const group=snapshot.groups.find(g=>g.favorite.region_code==='41465'&&g.articles.length);group.articles.pop();
  writeListingSnapshot(f.settings.stateFile,snapshot);assert.equal(fs.existsSync(reportFile),false);
});

test('local API rejects foreign origins, forged hosts, methods and invalid favorites; returns real collector results',async t=>{
  const f=fixture(t),middleware=listingMiddleware({collector:f.collector});
  const server=http.createServer((req,res)=>{middleware(req,res,()=>{res.writeHead(404);res.end();});});
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(endpoint,input,headers={})=>fetch(base+'/api/naver-listings/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
  assert.equal((await fetch(base+'/api/naver-listings/status')).status,200);
  assert.equal((await post('collect',targets(),{Origin:'https://evil.test'})).status,403);
  const forgedHost=await new Promise((resolve,reject)=>{const req=http.request(base+'/api/naver-listings/status',{headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(forgedHost,403);
  assert.equal((await fetch(base+'/api/naver-listings/collect')).status,405);
  assert.equal((await post('collect',targets(),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await post('collect',{...targets(),favorites:[{...favorite,id:'forged'}]})).status,400);
  assert.equal((await post('collect',{...targets(),connections:[]})).status,400);
  assert.equal(f.calls.length,0);
  const response=await post('collect',targets(),{Origin:base});assert.equal(response.status,200);const result=await response.json();assert(validListingSnapshot(result));assert.equal(result.groups[0].articles.length,1);
  assert.deepEqual((await (await post('read',targets())).json()).groups,result.groups);
});

test('CLI rejects invalid targets and overwrites before collecting, and reports unconnected favorites as failure',t=>{
  const f=fixture(t),input=path.join(f.folder,'targets.json'),output=path.join(f.folder,'snapshot.json');
  const script=fileURLToPath(new URL('../scripts/collect-naver-listings.mjs',import.meta.url));
  const run=(...args)=>spawnSync(process.execPath,[script,...args],{encoding:'utf8',windowsHide:true});
  fs.writeFileSync(input,'{}');assert.equal(run('--targets',input,'--output',output).status,1);assert(!fs.existsSync(output));
  fs.writeFileSync(input,JSON.stringify({...targets(),connections:[]}));const before=fs.readFileSync(input,'utf8');
  const overwrite=run('--targets',input,'--output',input);assert.equal(overwrite.status,1);assert.match(overwrite.stderr,/덮어쓸 수 없습니다/);assert.equal(fs.readFileSync(input,'utf8'),before);
  const missing=run('--targets',input,'--output',output);assert.equal(missing.status,1);assert.match(missing.stderr,/연결 없음/);assert(validListingSnapshot(JSON.parse(fs.readFileSync(output,'utf8'))));
  assert.equal(run('--help').status,0);
});

test('public-file verification recognizes Naver authorization as a secret',t=>{
  const f=fixture(t),env=path.join(f.folder,'.env');fs.writeFileSync(env,'NAVER_LAND_AUTHORIZATION=private-authorization-fixture');
  const secrets=secretValues(env);assert(secrets.includes('private-authorization-fixture'));assert.throws(()=>checkedBytes('private-authorization-fixture',secrets),/인증 값/);
});
