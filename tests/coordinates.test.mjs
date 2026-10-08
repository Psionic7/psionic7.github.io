import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {connect,PUBLIC_SCHEMA,LOCAL_SCHEMA,secretValues} from '../server/storage.mjs';
import {coordinateKey,addressCodes,toWgs84,parseCoordinateResult,pendingCoordinates,collectCoordinates,coordinateStats,coordinatePoints} from '../server/coordinates.mjs';
import {createAdminServer} from '../server/index.mjs';

const codes={admCd:'1111010100',rnMgtSn:'111103100001',udrtYn:'0',buldMnnm:'1',buldSlno:'0'};
const query='서울특별시 종로구 청운동 1',road='서울특별시 종로구 자하문로 1';
const payload=(rows=[{...codes,entX:'1000000',entY:'2000000',bdMgtSn:'building'}])=>({results:{common:{errorCode:'0',totalCount:String(rows.length)},juso:rows}});
const address={query,road_address:road,response_json:JSON.stringify({results:{common:{errorCode:'0',totalCount:'1'},juso:[{...codes,jibunAddr:query,roadAddr:road}]}})};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'home-coordinates-'));
  const files={db:path.join(root,'work.sqlite3'),favorites:path.join(root,'favorites.json'),env:path.join(root,'.env')};
  fs.writeFileSync(files.env,'JUSO_COORDINATE_API_KEY=coordinatefixturekey123456');
  const db=connect(files.db);db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA);
  db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?,?)').run('dong_11110101',query,'11110','서울특별시 종로구','["청운동"]',37.5,127);
  for(let i=0;i<2;i++)db.prepare('INSERT INTO trades(region_code,deal_month,deal_date,apartment,dong,jibun,price_man,area_m2,cancelled,raw_json) VALUES(?,?,?,?,?,?,?,?,?,?)').run('11110','202601','2026-01-09','동일 아파트','청운동','1',100000,84,0,'{}');
  db.prepare('INSERT INTO address_lookups VALUES(?,?,?,?,?,?,?,?)').run('11110','청운동','1',query,'exact',road,address.response_json,'address-v1');
  db.prepare('INSERT INTO road_addresses VALUES(?,?,?,?)').run('11110','청운동','1',road);
  t.after(()=>{db.close();const resolved=path.resolve(root);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('home-coordinates-'));fs.rmSync(resolved,{recursive:true,force:true});});
  return {db,files};
}
const fetcher=async()=>({ok:true,json:async()=>payload()});

test('UTM-K origin and official Daegu entrance sample convert with correct axis order',()=>{
  const origin=toWgs84('1000000','2000000');assert(Math.abs(origin.latitude-38)<1e-7);assert(Math.abs(origin.longitude-127.5)<1e-7);
  // Official sample: Ta e jeon Daebaek Mansion in Daegu, not a Seoul region centroid.
  const daegu=toWgs84('1093820.077003831','1771096.85779839');assert(daegu.latitude>35.9&&daegu.latitude<36);assert(daegu.longitude>128.5&&daegu.longitude<128.6);
  for(const [x,y] of [[0,0],['',''],[Infinity,2000000],[37.5,127],['junk',2000000],[2000000,1000000]])assert.throws(()=>toWgs84(x,y));
});
test('only a unique exact cached address supplies building codes',()=>{
  assert.deepEqual(addressCodes(address),codes);
  const parsed=JSON.parse(address.response_json);parsed.results.juso.push({...parsed.results.juso[0]});assert.equal(addressCodes({...address,response_json:JSON.stringify(parsed)}),null);
  assert.equal(addressCodes({...address,road_address:'다른 주소'}),null);assert.equal(addressCodes({...address,response_json:'broken'}),null);
  const missing=JSON.parse(address.response_json);delete missing.results.juso[0].admCd;assert.equal(addressCodes({...address,response_json:JSON.stringify(missing)}),null);
});
test('coordinate response rejects incorrect buildings, ambiguous entrances and malformed API results',()=>{
  assert.equal(parseCoordinateResult(payload(),codes).status,'exact');assert.equal(parseCoordinateResult(payload([]),codes).status,'unmatched');
  assert.equal(parseCoordinateResult({results:{common:{errorCode:'0',totalCount:'0'},juso:null}},codes).status,'unmatched');
  assert.throws(()=>parseCoordinateResult({results:{common:{errorCode:'0',totalCount:'1'},juso:null}},codes));
  assert.equal(parseCoordinateResult(payload([{},{}]),codes).status,'ambiguous');
  assert.equal(parseCoordinateResult(payload([{...codes,admCd:'2222210100',entX:1000000,entY:2000000}]),codes).status,'invalid');
  assert.equal(parseCoordinateResult(payload([{entX:'',entY:2000000}]),codes).status,'invalid');
  assert.throws(()=>parseCoordinateResult({results:{common:{errorCode:'E0001',errorMessage:'secret'}}},codes),e=>!e.message.includes('secret'));
  const mismatch=payload();mismatch.results.common.totalCount='2';assert.throws(()=>parseCoordinateResult(mismatch,codes));
});
test('deduplicates trades by parcel, caches coordinates and returns one apartment marker',async t=>{
  const {db}=fixture(t);let calls=0;
  const result=await collectCoordinates(db,'coordinatefixturekey123456',{pause:0,fetcher:async url=>{calls++;assert.equal(url.hostname,'business.juso.go.kr');for(const [k,v] of Object.entries(codes))assert.equal(url.searchParams.get(k),v);assert.equal(url.searchParams.get('resultType'),'json');return fetcher();}});
  assert.equal(result.exact,1);assert.equal(calls,1);assert.equal(coordinatePoints(db).length,1);assert.equal(coordinateStats(db).coordinates,1);assert.equal(pendingCoordinates(db).length,0);
  assert.equal((await collectCoordinates(db,'key',{pause:0,fetcher})).total,0);
  assert.equal((await collectCoordinates(db,'key',{refresh:true,pause:0,fetcher})).exact,1);
  assert(!JSON.stringify(db.prepare('SELECT * FROM parcel_coordinates').all()).includes('coordinatefixturekey'));
  assert.equal(db.prepare('SELECT source_crs FROM parcel_coordinates').get().source_crs,'EPSG:5179');
});
test('address refresh invalidates stale markers and places changed addresses back in the queue',async t=>{
  const {db}=fixture(t);await collectCoordinates(db,'key',{pause:0,fetcher});
  db.prepare('UPDATE address_lookups SET fetched_at=?').run('address-v2');assert.equal(coordinatePoints(db).length,0);assert.equal(pendingCoordinates(db).length,1);
  await collectCoordinates(db,'key',{pause:0,fetcher});assert.equal(coordinatePoints(db).length,1);
  db.prepare("UPDATE address_lookups SET status='ambiguous'").run();assert.equal(coordinatePoints(db).length,0);assert.equal(pendingCoordinates(db).length,0);
});
test('transient and authorization failures preserve verified coordinates and redact request secrets',async t=>{
  const {db}=fixture(t);await collectCoordinates(db,'key',{pause:0,fetcher});const before=db.prepare('SELECT * FROM parcel_coordinates').all();
  await assert.rejects(collectCoordinates(db,'secret123',{refresh:true,pause:0,fetcher:async url=>{throw new Error(String(url));}}),e=>!e.message.includes('secret123'));
  await assert.rejects(collectCoordinates(db,'secret123',{refresh:true,pause:0,fetcher:async()=>({ok:true,json:async()=>({results:{common:{errorCode:'E0001',errorMessage:'secret123'}}})})}),e=>!e.message.includes('secret123'));
  assert.deepEqual(db.prepare('SELECT * FROM parcel_coordinates').all(),before);
});
test('missing building codes and multiple entrances are recorded without fabricated coordinates',async t=>{
  const {db}=fixture(t);db.prepare('UPDATE address_lookups SET response_json=?').run('{}');let calls=0;
  const result=await collectCoordinates(db,'key',{pause:0,fetcher:async()=>{calls++;return fetcher();}});assert.equal(calls,0);assert.equal(result.unresolved,1);assert.equal(coordinateStats(db).coordinateUnresolved,1);assert.equal(coordinatePoints(db).length,0);
  db.prepare('UPDATE address_lookups SET response_json=?').run(address.response_json);
  await collectCoordinates(db,'key',{refresh:true,pause:0,fetcher:async()=>({ok:true,json:async()=>payload([{},{}])})});
  assert.equal(db.prepare('SELECT status FROM coordinate_lookups').get().status,'ambiguous');assert.equal(coordinatePoints(db).length,0);
});
test('cancellation keeps completed parcels and leaves the next parcel pending',async t=>{
  const {db}=fixture(t);
  db.exec("INSERT INTO trades SELECT 3,region_code,deal_month,deal_date,apartment,dong,'2',price_man,area_m2,floor,build_year,cancelled,raw_json FROM trades LIMIT 1");
  db.exec("INSERT INTO address_lookups SELECT region_code,dong,'2',query,status,road_address,response_json,fetched_at FROM address_lookups; INSERT INTO road_addresses SELECT region_code,dong,'2',road_address FROM road_addresses;");
  const controller=new AbortController();await assert.rejects(collectCoordinates(db,'key',{pause:0,signal:controller.signal,fetcher,onProgress:()=>controller.abort()}));
  assert.equal(coordinatePoints(db).length,1);assert.equal(pendingCoordinates(db).length,1);
});
test('local API enforces CSRF, validates limit, reloads keys and provides only confirmed coordinates',async t=>{
  const {db,files}=fixture(t);fs.writeFileSync(files.env,'');
  const server=createAdminServer({files,coordinateFetcher:fetcher});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,state=await(await fetch(base+'/api/state')).json();assert.equal(state.coordinateKeyReady,false);assert.equal(state.stats.pendingCoordinates,1);
  const post=(body,csrf=state.csrf)=>fetch(base+'/api/coordinates',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-CSRF':csrf},body:JSON.stringify(body)});
  assert.equal((await post({limit:1},'')).status,403);assert.equal((await post({limit:0})).status,400);assert.equal((await post({limit:1})).status,400);
  assert.equal((await fetch(base+'/api/coordinate-points',{headers:{Origin:'https://evil.example'}})).status,403);
  fs.writeFileSync(files.env,'JUSO_COORDINATE_SEARCH_KEY=coordinatefixturekey123456');assert(secretValues(files.env).includes('coordinatefixturekey123456'));assert.equal(coordinateKey(files.env),'coordinatefixturekey123456');
  assert.equal((await(await fetch(base+'/api/state')).json()).coordinateKeyReady,true);assert.equal((await post({limit:1})).status,202);
  let final;for(let i=0;i<30;i++){final=await(await fetch(base+'/api/state')).json();if(final.job.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(final.job.status,'completed');assert.equal(final.stats.coordinates,1);assert(!JSON.stringify(final).includes('coordinatefixturekey'));
  const points=await(await fetch(base+'/api/coordinate-points')).json();assert.equal(points.points.length,1);assert(!JSON.stringify(points).includes('address_signature'));assert.equal(db.prepare('SELECT count(*) AS n FROM trades').get().n,2);
});

test('coordinate key accepts SEARCH_KEY and the earlier API_KEY alias with environment precedence',t=>{
 const {files}=fixture(t);const names=['JUSO_COORDINATE_SEARCH_KEY','JUSO_COORDINATE_API_KEY'];const old=names.map(k=>process.env[k]);
 try{
  names.forEach(k=>delete process.env[k]);assert.equal(coordinateKey(files.env),'coordinatefixturekey123456');
  fs.writeFileSync(files.env,'JUSO_COORDINATE_SEARCH_KEY=searchfixturekey123456\nJUSO_COORDINATE_API_KEY=aliasfixturekey123456');
  assert.equal(coordinateKey(files.env),'searchfixturekey123456');assert(secretValues(files.env).includes('searchfixturekey123456'));
  process.env.JUSO_COORDINATE_API_KEY='environmentfixturekey123456';assert.equal(coordinateKey(files.env),'environmentfixturekey123456');
  process.env.JUSO_COORDINATE_SEARCH_KEY='preferredfixturekey123456';assert.equal(coordinateKey(files.env),'preferredfixturekey123456');
 }finally{names.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i]);}
});

test('E0007 throttling retries with backoff and saves only the successful response',async t=>{
 const {db}=fixture(t);let attempts=0;
 const result=await collectCoordinates(db,'key',{pause:0,retryDelay:1,fetcher:async()=>++attempts<3?{ok:true,json:async()=>({results:{common:{errorCode:'E0007'},juso:null}})}:fetcher()});
 assert.equal(attempts,3);assert.equal(result.exact,1);assert.equal(coordinatePoints(db).length,1);
});
test('persistent throttling stops after bounded retries without poisoning the pending queue',async t=>{
 const {db}=fixture(t);let attempts=0;
 await assert.rejects(collectCoordinates(db,'key',{pause:0,retryDelay:1,fetcher:async()=>{attempts++;return{ok:true,json:async()=>({results:{common:{errorCode:'E0007'},juso:null}})};}}),/요청 제한/);
 assert.equal(attempts,4);assert.equal(pendingCoordinates(db).length,1);assert.equal(coordinatePoints(db).length,0);
});

test('cancellation interrupts throttle backoff and preserves the pending parcel',async t=>{
 const {db}=fixture(t),controller=new AbortController();let calls=0;
 await assert.rejects(collectCoordinates(db,'key',{pause:0,retryDelay:2000,signal:controller.signal,fetcher:async()=>{calls++;setTimeout(()=>controller.abort(),10);return{ok:true,json:async()=>({results:{common:{errorCode:'E0007'},juso:null}})};}}));
 assert.equal(calls,1);assert.equal(pendingCoordinates(db).length,1);assert.equal(coordinatePoints(db).length,0);
});
