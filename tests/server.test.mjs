import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import http from 'node:http';
import {connect,PUBLIC_SCHEMA,LOCAL_SCHEMA,regions,savedIds,saveFavorites,checkedBytes,initialize} from '../server/storage.mjs';
import {parsePage,normalize,collectMonth,monthsBetween,collectionTasks,fetchPage} from '../server/collector.mjs';
import {exportData} from '../server/export.mjs';
import {createAdminServer} from '../server/index.mjs';
const raw={aptNm:' 아파트 ',umdNm:'청운동',jibun:'001-2',dealAmount:' 100,000 ',excluUseAr:'84.5',dealYear:'2026',dealMonth:'01',dealDay:'09',sggCd:'11110',floor:'-1',buildYear:'2000',cdealType:'',newField:'',leading:'0001'};
const xml=(items,total=items.length)=>`<response><header><resultCode>000</resultCode></header><body><items>${items.map(item=>'<item>'+Object.entries(item).map(([k,v])=>`<${k}>${v}</${k}>`).join('')+'</item>').join('')}</items><totalCount>${total}</totalCount></body></response>`;
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'home-records-node-')),closers=[];t.after(()=>{closers.forEach(close=>close());const absolute=path.resolve(root);assert(absolute.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(absolute).startsWith('home-records-node-'));fs.rmSync(absolute,{recursive:true,force:true});});
  const files={db:path.join(root,'work.sqlite3'),favorites:path.join(root,'collection_regions.json'),env:path.join(root,'.env')};
  const db=connect(files.db);db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA);db.prepare('INSERT INTO regions VALUES (?,?,?,?,?,?,?)').run('dong_11110101','서울특별시 종로구 청운동','11110','서울특별시 종로구','["청운동"]',37.5,127);
  db.prepare('INSERT INTO regions VALUES (?,?,?,?,?,?,?)').run('dong_11110102','서울특별시 종로구 신교동','11110','서울특별시 종로구','["신교동"]',37.5,127);
  fs.writeFileSync(files.env,'MOLIT_SERVICE_KEY='+'fixturekey0123456789');
  const catalog=regions(db);db.close();return {root,files,catalog,closers};
}
test('XML preserves original text, empty fields and leading zeros; rejects DTD and authentication errors',()=>{
  assert.deepEqual(parsePage(xml([raw])).items,[raw]);
  assert.deepEqual(parsePage(xml([])),{total:0,items:[]});
  assert.throws(()=>parsePage('<!DOCTYPE a [<!ENTITY b "bad">]>'+xml([])));
  assert.throws(()=>parsePage(xml([]).replace('<resultCode>000','<resultCode>99')));
  assert.throws(()=>parsePage(xml([]).replace('<totalCount>0','<totalCount>-1')));
  assert.throws(()=>parsePage('<invalid>'));
});
test('validates dates, cancellation, safe integers and KST month ranges',()=>{
  const normalized=normalize(raw,'11110','202601');assert.equal(normalized[2],'2026-01-09');assert.equal(normalized[6],100000);assert.equal(normalized[8],-1);assert.deepEqual(JSON.parse(normalized[11]),raw);
  assert.equal(normalize({...raw,cdealDay:'2026.02.01'},'11110','202601')[10],1);
  for(const invalid of [{dealMonth:'02',dealDay:'30'},{dealAmount:'9007199254740993'},{sggCd:'41465'},{excluUseAr:'Infinity'},{floor:'1.2'}])assert.throws(()=>normalize({...raw,...invalid},'11110','202601'));
  assert.deepEqual(monthsBetween('202512','202601',new Date('2026-02-01Z')),['202512','202601']);
  assert.throws(()=>monthsBetween('202601','202613'));assert.throws(()=>monthsBetween('202701','202701',new Date('2026-10-03Z')));
  assert.throws(()=>monthsBetween('190001','193001',new Date('2026-10-03Z')));
  assert.deepEqual(monthsBetween('202610','202610',new Date('2026-09-30T16:00:00Z')),['202610']);
});
test('collection keeps duplicates and original fields; missing pages and invalid fields never replace a saved month',async t=>{
  const {files,catalog,closers}=fixture(t),db=connect(files.db);closers.push(()=>db.close());
  assert.equal(collectionTasks(catalog,['202601']).length,1);
  const fetcher=async()=>({...parsePage(xml([raw,raw])),xml:xml([raw,raw])});
  assert.equal(await collectMonth(db,'key','11110','202601','서울특별시 종로구',{fetcher,pause:0}),2);
  const before=db.prepare('SELECT * FROM trades').all();assert.equal(before.length,2);
  let page=0;
  await assert.rejects(collectMonth(db,'key','11110','202601','서울특별시 종로구',{pause:0,fetcher:async()=>({total:3,items:page++?[ ]:[raw],xml:xml([])})}));
  await assert.rejects(collectMonth(db,'key','11110','202601','서울특별시 종로구',{pause:0,fetcher:async()=>({total:1,items:[{...raw,dealDay:'40'}],xml:xml([])})}));
  assert.deepEqual(db.prepare('SELECT * FROM trades').all(),before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM collection_runs').get().n,1);
  const abort=new AbortController();abort.abort();await assert.rejects(collectMonth(db,'key','11110','202601','서울특별시 종로구',{signal:abort.signal,fetcher}));
});
test('response storage redacts raw and encoded keys before parsing',async()=>{
  const key='abcd%2Bfixture%2F0123456789',responseXml=xml([{...raw,newField:'abcd+fixture/0123456789'}]);
  const result=await fetchPage(key,'11110','202601',1,undefined,async url=>{assert.equal(new URL(url).searchParams.get('serviceKey'),'abcd+fixture/0123456789');return {ok:true,text:async()=>responseXml};});
  assert.equal(result.items[0].newField,'[REDACTED]');assert(!result.xml.includes('abcd+fixture'));
});
test('saved favorites permit an empty list and reject damaged files without overwriting',t=>{
  const {files,catalog}=fixture(t);assert.deepEqual(savedIds(files.favorites,catalog),[]);
  saveFavorites([catalog[0].region_id,catalog[0].region_id],files.favorites,catalog);assert.deepEqual(savedIds(files.favorites,catalog),[catalog[0].region_id]);
  saveFavorites([],files.favorites,catalog);assert.deepEqual(savedIds(files.favorites,catalog),[]);
  fs.writeFileSync(files.favorites,'broken');assert.throws(()=>saveFavorites([],files.favorites,catalog));assert.equal(fs.readFileSync(files.favorites,'utf8'),'broken');
});
test('an already initialized local project does not repopulate a missing selection from the old archive',async t=>{
  const {root,files,catalog}=fixture(t),legacy=path.join(root,'legacy');
  fs.mkdirSync(path.join(legacy,'data'),{recursive:true});
  saveFavorites([catalog[0].region_id],path.join(legacy,'data/collection_regions.json'),catalog);
  await initialize({...files,legacy});
  assert(!fs.existsSync(files.favorites));
  const db=connect(files.db);assert.deepEqual(savedIds(files.favorites,regions(db)),[]);db.close();
});
test('export only allows public tables and saved IDs; secret failures preserve previous manifest',async t=>{
  const {root,files,catalog}=fixture(t),db=connect(files.db);
  await collectMonth(db,'key','11110','202601','서울특별시 종로구',{pause:0,fetcher:async()=>({total:1,items:[raw],xml:xml([raw])})});db.close();
  saveFavorites([catalog[0].region_id],files.favorites,catalog);
  const target=path.join(root,'public'),manifest=exportData({source:files.db,target,favorites:files.favorites,secretsFile:files.env});
  assert.equal(manifest.count,1);assert.deepEqual(manifest.favorite_region_ids,[catalog[0].region_id]);
  const out=connect(path.join(target,'public.sqlite3'),true);assert.deepEqual(out.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name),['metadata','regions','trades']);out.close();
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target,manifest.districts['11110'].file)))[0].raw,raw);
  const old=fs.readFileSync(path.join(target,'manifest.json'));
  const work=connect(files.db);work.prepare('UPDATE trades SET raw_json=?').run(JSON.stringify({...raw,newField:'fixturekey0123456789'}));work.close();
  assert.throws(()=>exportData({source:files.db,target,favorites:files.favorites,secretsFile:files.env}));assert(fs.readFileSync(path.join(target,'manifest.json')).equals(old));
  assert.throws(()=>checkedBytes('fixturekey0123456789',['fixturekey0123456789']));
});
test('local API denies foreign origins, DNS rebinding, missing CSRF and private file access; saves only explicit updates',async t=>{
  const {root,files,catalog}=fixture(t);fs.mkdirSync(path.join(root,'ui'));fs.writeFileSync(path.join(root,'ui/index.html'),'<h1>Admin</h1>');
  const server=createAdminServer({files,staticRoot:path.join(root,'ui')});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,read=await fetch(base+'/api/state'),state=await read.json();
  assert(state.keyReady);assert(!JSON.stringify(state).includes('fixturekey'));assert(!fs.existsSync(files.favorites));
  assert.equal((await fetch(base+'/.env')).status,404);
  assert.equal((await fetch(base+'/api/state',{headers:{Origin:'https://evil.example'}})).status,403);
  const rebinding=await new Promise((resolve,reject)=>{const req=http.get(base+'/api/state',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(rebinding,403);
  assert.equal((await fetch(base+'/api/favorites',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[]})})).status,403);
  const saved=await fetch(base+'/api/favorites',{method:'POST',headers:{'Content-Type':'application/json','X-Admin-CSRF':state.csrf},body:JSON.stringify({ids:[catalog[0].region_id]})});assert.equal(saved.status,200);assert.deepEqual(savedIds(files.favorites,catalog),[catalog[0].region_id]);
  const document=await fetch(base+'/');
  assert.equal(document.status,200);
  assert.equal(document.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
});
test('local job deduplicates districts, rejects overlapping work and supports cancellation',async t=>{
  const {files,catalog}=fixture(t);saveFavorites(catalog.map(r=>r.region_id),files.favorites,catalog);
  let requested=0;const fetcher=async(_key,_code,_month,_page,signal)=>{requested++;await new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});};
  const server=createAdminServer({files,fetcher});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`,state=await (await fetch(base+'/api/state')).json();
  const post=(p,body)=>fetch(base+'/api/'+p,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-CSRF':state.csrf},body:JSON.stringify(body)});
  const started=await post('collect',{start:'202601',end:'202601'});assert.equal(started.status,202);assert.equal((await started.json()).job.total,1);
  assert.equal((await post('collect',{start:'202601',end:'202601'})).status,409);assert.equal((await post('favorites',{ids:[]})).status,409);
  assert.equal((await post('cancel',{})).status,200);
  let final;for(let i=0;i<20;i++){final=await(await fetch(base+'/api/state')).json();if(final.job.status!=='running')break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(final.job.status,'cancelled');assert.equal(requested,1);assert.equal(final.stats.count,0);
});
