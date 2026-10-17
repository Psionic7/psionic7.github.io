import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {atomicWrite,checkedBytes} from './storage.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fields=['id','region_code','dong','jibun','apartment','road_address','area_m2','price_man','floor','deal_date','deal_month','cancelled'];
export function browserPayloads(groups,secrets=[]) {
  const payloads=new Map(),districts={};
  const add=(prefix,value)=>{const bytes=checkedBytes(JSON.stringify(value),secrets),sha256=digest(bytes),file=`${prefix}-${sha256.slice(0,12)}.json`;payloads.set(file,bytes);return {file,sha256,bytes:bytes.length};};
  for(const [code,source] of groups){
    const months=new Map(),catalog=new Map(),latest=new Map();
    for(const row of source){
      if(!/^\d{5}$/.test(code)||!/^\d{6}$/.test(row.deal_month))throw new Error('Invalid browser data scope');
      const compact=Object.fromEntries(fields.map(key=>[key,row[key]]));
      compact.raw={cdealDay:row.raw?.cdealDay||''};
      const key=JSON.stringify([row.dong,row.jibun,row.apartment]);
      if(!catalog.has(key)||catalog.get(key).deal_date<row.deal_date)catalog.set(key,compact);
      if(row.cancelled===0&&(!latest.has(key)||latest.get(key).deal_date<row.deal_date))latest.set(key,compact);
      if(!months.has(row.deal_month))months.set(row.deal_month,[]);months.get(row.deal_month).push(compact);
    }
    const monthFiles={};
    for(const [month,rows] of [...months].sort(([a],[b])=>a.localeCompare(b)))monthFiles[month]=add(`month-${code}-${month}`,rows).file;
    districts[code]=add(`catalog-${code}`,{version:1,catalog:[...catalog.values()],latest:[...latest.values()],months:monthFiles});
  }
  return {payloads,districts};
}
export function writeBrowserPayloads(folder,payloads){
  fs.mkdirSync(folder,{recursive:true});
  for(const [file,bytes] of payloads)atomicWrite(path.join(folder,file),bytes);
}
export function writeBrowserRegistry(folder,manifest,districts,secrets=[]){
  const sources=Object.fromEntries(Object.entries(districts).map(([code,meta])=>[code,{...meta,source_sha256:manifest.districts[code].sha256}]));
  atomicWrite(path.join(folder,'manifest.json'),checkedBytes(JSON.stringify({version:1,districts:sources}),secrets));
}
export function checkBrowserData(folder,manifest,secrets=[]) {
  const registryFile=path.join(folder,'manifest.json');
  const registry=fs.existsSync(registryFile)?JSON.parse(checkedBytes(fs.readFileSync(registryFile),secrets)):null;
  const allowed=new Set(registry?['manifest.json']:[]);
  for(const [code,district] of Object.entries(manifest.districts)){
    const meta=district.browser||registry?.districts?.[code];
    if(!meta)continue;
    if(meta.source_sha256&&meta.source_sha256!==district.sha256)throw new Error('조회 자료를 다시 준비해 주세요.');
    if(!new RegExp(`^catalog-${code}-[a-f0-9]{12}\\.json$`).test(meta.file))throw new Error('조회 목록 경로 오류');
    const bytes=checkedBytes(fs.readFileSync(path.join(folder,meta.file)),secrets);
    if(digest(bytes)!==meta.sha256||bytes.length!==meta.bytes)throw new Error('조회 목록 체크섬 오류');
    const index=JSON.parse(bytes);allowed.add(meta.file);let count=0;
    if(index.version!==1||!Array.isArray(index.catalog)||!Array.isArray(index.latest))throw new Error('조회 목록 형식 오류');
    for(const [month,file] of Object.entries(index.months)){
      if(!new RegExp(`^month-${code}-${month}-[a-f0-9]{12}\\.json$`).test(file)||!/^\d{6}$/.test(month))throw new Error('월별 조회 경로 오류');
      const data=checkedBytes(fs.readFileSync(path.join(folder,file)),secrets),rows=JSON.parse(data);allowed.add(file);
      if(!file.endsWith(digest(data).slice(0,12)+'.json')||rows.some(row=>row.region_code!==code||row.deal_month!==month))throw new Error('월별 조회 자료 오류');
      count+=rows.length;
    }
    if(count!==district.count)throw new Error('월별 조회 건수 오류');
  }
  if(fs.existsSync(folder)&&fs.readdirSync(folder).some(file=>!allowed.has(file)))throw new Error('조회 데이터 폴더에 허용되지 않은 파일이 있습니다.');
}
export function cleanBrowserPayloads(folder,payloads){
  for(const file of fs.readdirSync(folder))if(/^(catalog-\d{5}|month-\d{5}-\d{6})-[a-f0-9]{12}\.json$/.test(file)&&!payloads.has(file))fs.unlinkSync(path.join(folder,file));
}
