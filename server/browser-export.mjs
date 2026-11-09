import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {atomicWrite,checkedBytes} from './storage.mjs';
import {housingBindingsMap} from '../src/housing-wire.mjs';
import {sourceIdentityId} from '../src/housing-identity.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fields=['id','region_code','dong','jibun','apartment','road_address','area_m2','price_man','floor','deal_date','deal_month','cancelled'];
export function browserPayloads(groups,secrets=[],{housing}={}) {
  const payloads=new Map(),districts={};
  const add=(prefix,value)=>{const bytes=checkedBytes(JSON.stringify(value),secrets),sha256=digest(bytes),file=`${prefix}-${sha256.slice(0,12)}.json`;payloads.set(file,bytes);return {file,sha256,bytes:bytes.length};};
  for(const [code,source] of groups){
    const months=new Map(),catalog=new Map(),latest=new Map();
    for(const row of source){
      if(!/^\d{5}$/.test(code)||!/^\d{6}$/.test(row.deal_month))throw new Error('Invalid browser data scope');
      const compact=Object.fromEntries(fields.map(key=>[key,row[key]]));
      compact.raw={cdealDay:row.raw?.cdealDay||''};
      if(row.identity)compact.identity={...row.identity};
      const key=JSON.stringify([row.dong,row.jibun,row.apartment]);
      const newer=previous=>!previous||previous.deal_date<row.deal_date||(previous.deal_date===row.deal_date&&previous.id<row.id);
      if(newer(catalog.get(key)))catalog.set(key,compact);
      if(row.cancelled===0&&newer(latest.get(key)))latest.set(key,compact);
      if(!months.has(row.deal_month))months.set(row.deal_month,[]);months.get(row.deal_month).push(compact);
    }
    const monthFiles={};
    for(const [month,rows] of [...months].sort(([a],[b])=>a.localeCompare(b)))monthFiles[month]=add(`month-${code}-${month}`,rows).file;
    districts[code]={...add(`catalog-${code}`,{version:1,catalog:[...catalog.values()],latest:[...latest.values()],months:monthFiles,...(housing?{housing_sha256:housing.sha256}:{})}),...(housing?{housing_sha256:housing.sha256}:{})};
  }
  return {payloads,districts};
}
export function writeBrowserPayloads(folder,payloads){
  fs.mkdirSync(folder,{recursive:true});
  for(const [file,bytes] of payloads){
    const destination=path.join(folder,file);
    if(fs.existsSync(destination)&&fs.readFileSync(destination).equals(bytes))continue;
    atomicWrite(destination,bytes);
  }
}
export function writeBrowserRegistry(folder,manifest,districts,secrets=[],extra={}){
  const sources=Object.fromEntries(Object.entries(districts).map(([code,meta])=>[code,{...meta,source_sha256:manifest.districts[code].sha256}]));
  atomicWrite(path.join(folder,'manifest.json'),checkedBytes(JSON.stringify({version:1,districts:sources,...(manifest.housing?{housing_sha256:manifest.housing.sha256}:{}),...extra}),secrets));
}

export function readHousingPayload(folder,manifest,secrets=[]) {
  if(!manifest.housing)return null;
  const meta=manifest.housing;
  if(!/^housing-[a-f0-9]{12}\.json$/.test(meta.file||'')||!/^[a-f0-9]{64}$/.test(meta.sha256||'')||!/^[a-f0-9]{64}$/.test(meta.source_fingerprint||'')||meta.row_count!==manifest.count||!Number.isSafeInteger(meta.bytes)||meta.bytes<=0)throw Error('주거 연결 manifest 오류');
  if(!meta.sources||Object.keys(meta.sources).sort().join('|')!==Object.keys(manifest.districts).sort().join('|')||Object.entries(manifest.districts).some(([code,value])=>meta.sources[code]!==value.sha256))throw Error('주거 연결 원본 버전 불일치');
  const bytes=checkedBytes(fs.readFileSync(path.join(folder,meta.file)),secrets);
  if(digest(bytes)!==meta.sha256||bytes.length!==meta.bytes||!meta.file.endsWith(meta.sha256.slice(0,12)+'.json'))throw Error('주거 연결 체크섬 불일치');
  const payload=JSON.parse(bytes);
  if(payload.source_fingerprint!==meta.source_fingerprint||payload.row_count!==meta.row_count)throw Error('주거 연결 원본 스냅샷 불일치');
  housingBindingsMap(payload);return payload;
}

const bindingFields=['entity_id','precision','root_id','cohort_id','building_id'];
export function assertHousingRows(rows,bindings) {
  for(const row of rows){const expected=bindings.get(row.id);if(!expected||expected.entity_id!==sourceIdentityId(row)||!row.identity||Object.keys(row.identity).length!==bindingFields.length||bindingFields.some(field=>row.identity[field]!==expected[field]))throw Error('주거 연결 조회 배정 누락·불일치');}
}
export function attachHousingRows(rows,bindings) {
  return rows.map(row=>{const identity=bindings.get(row.id);if(!identity||identity.entity_id!==sourceIdentityId(row))throw Error('주거 연결 원본 배정 누락·불일치');return {...row,identity};});
}
export function checkBrowserData(folder,manifest,secrets=[],{requireSearch=false}={}) {
  const registryFile=path.join(folder,'manifest.json');
  const registry=fs.existsSync(registryFile)?JSON.parse(checkedBytes(fs.readFileSync(registryFile),secrets)):null;
  const housing=readHousingPayload(path.join(path.dirname(folder),'data'),manifest,secrets),bindings=housing?housingBindingsMap(housing):null;
  const sourceIds=new Set();
  if((housing&&registry?.housing_sha256!==manifest.housing.sha256)||(!housing&&registry?.housing_sha256))throw Error('주거 연결 조회 버전 불일치');
  if(requireSearch&&!registry?.search)throw new Error('통합 검색 자료가 없습니다. 공개 빌드를 다시 실행하세요.');
  const allowed=new Set(registry?['manifest.json']:[]);
  if(registry?.search){
    const meta=registry.search;if(!/^search-[a-f0-9]{12}\.json$/.test(meta.file))throw new Error('통합 검색 경로 오류');
    if(housing&&meta.housing_sha256!==manifest.housing.sha256)throw Error('통합 검색 주거 연결 버전 불일치');
    const bytes=checkedBytes(fs.readFileSync(path.join(folder,meta.file)),secrets);
    if(digest(bytes)!==meta.sha256||bytes.length!==meta.bytes||!Array.isArray(JSON.parse(bytes))||Object.entries(manifest.districts).some(([code,d])=>meta.sources[code]!==d.sha256))throw new Error('통합 검색 자료 오류');
    allowed.add(meta.file);
  }
  for(const [code,district] of Object.entries(manifest.districts)){
    let rawIds;
    if(bindings){
      if(!new RegExp(`^trades-${code}-[a-f0-9]{12}\\.json$`).test(district.file||''))throw Error('주거 연결 원본 경로 오류');
      const rawBytes=checkedBytes(fs.readFileSync(path.join(path.dirname(folder),'data',district.file)),secrets);
      if(digest(rawBytes)!==district.sha256)throw Error('주거 연결 원본 체크섬 불일치');
      const rawRows=JSON.parse(rawBytes);rawIds=new Set(rawRows.map(row=>row.id));
      if(rawIds.size!==rawRows.length||rawRows.length!==district.count||rawRows.some(row=>row.region_code!==code))throw Error('주거 연결 원본 거래 ID 오류');
      attachHousingRows(rawRows,bindings);
      for(const id of rawIds){if(sourceIds.has(id))throw Error('주거 연결 원본 거래 ID 중복');sourceIds.add(id);}
    }
    const meta=district.browser||registry?.districts?.[code];
    if(!meta)continue;
    if(meta.source_sha256&&meta.source_sha256!==district.sha256)throw new Error('조회 자료를 다시 준비해 주세요.');
    if(!new RegExp(`^catalog-${code}-[a-f0-9]{12}\\.json$`).test(meta.file))throw new Error('조회 목록 경로 오류');
    const bytes=checkedBytes(fs.readFileSync(path.join(folder,meta.file)),secrets);
    if(digest(bytes)!==meta.sha256||bytes.length!==meta.bytes)throw new Error('조회 목록 체크섬 오류');
    const index=JSON.parse(bytes);allowed.add(meta.file);let count=0;const monthIds=new Set();
    if(housing&&(meta.housing_sha256!==manifest.housing.sha256||index.housing_sha256!==manifest.housing.sha256))throw Error('주거 연결 조회 목록 버전 불일치');
    if(index.version!==1||!Array.isArray(index.catalog)||!Array.isArray(index.latest))throw new Error('조회 목록 형식 오류');
    if(bindings){assertHousingRows(index.catalog,bindings);assertHousingRows(index.latest,bindings);}
    for(const [month,file] of Object.entries(index.months)){
      if(!new RegExp(`^month-${code}-${month}-[a-f0-9]{12}\\.json$`).test(file)||!/^\d{6}$/.test(month))throw new Error('월별 조회 경로 오류');
      const data=checkedBytes(fs.readFileSync(path.join(folder,file)),secrets),rows=JSON.parse(data);allowed.add(file);
      if(!file.endsWith(digest(data).slice(0,12)+'.json')||rows.some(row=>row.region_code!==code||row.deal_month!==month))throw new Error('월별 조회 자료 오류');
      if(bindings){assertHousingRows(rows,bindings);for(const row of rows){if(monthIds.has(row.id)||!rawIds.has(row.id))throw Error('주거 연결 월별 거래 누락·중복');monthIds.add(row.id);}}
      count+=rows.length;
    }
    if(count!==district.count)throw new Error('월별 조회 건수 오류');
    if(bindings&&monthIds.size!==rawIds.size)throw Error('주거 연결 월별 거래 누락·중복');
  }
  if(bindings&&sourceIds.size!==bindings.size)throw Error('주거 연결 원본 거래 범위 불일치');
  if(fs.existsSync(folder)&&fs.readdirSync(folder).some(file=>!allowed.has(file)))throw new Error('조회 데이터 폴더에 허용되지 않은 파일이 있습니다.');
}
export function cleanBrowserPayloads(folder,payloads){
  for(const file of fs.readdirSync(folder))if(/^(search|catalog-\d{5}|month-\d{5}-\d{6})-[a-f0-9]{12}\.json$/.test(file)&&!payloads.has(file))fs.unlinkSync(path.join(folder,file));
}
