import {createJsonCache} from './json-cache.mjs';
import {validRecentCount,weeklyResultRows} from './weekly/query.mjs';
import {housingBindingsMap} from './housing-wire.mjs';
import {bindingMatchesSource} from './housing-identity.mjs';
const sizes=new WeakMap();
export const jsonCharacterSize=value=>sizes.get(value)||0;
export async function fetchJson(path, fresh = false, integrity = null) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(path,{cache:fresh?'no-store':'default',signal:controller.signal});
    if(!response.ok)throw new Error('데이터를 불러오지 못했습니다 ('+response.status+').');
    if(typeof response.text!=='function'&&!integrity)return await response.json();
    const text=typeof response.text==='function'?await response.text():JSON.stringify(await response.json());
    if(integrity){
      const bytes=new TextEncoder().encode(text);
      if(integrity.bytes!==undefined&&bytes.byteLength!==integrity.bytes)throw Error('조회 자료 체크섬·크기 불일치');
      const digest=await crypto.subtle.digest('SHA-256',bytes),actual=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      if(actual!==integrity.sha256)throw Error('조회 자료 체크섬 불일치');
    }
    const value=JSON.parse(text);if(value&&typeof value==='object')sizes.set(value,text.length);return value;
  }catch(error){if(controller.signal.aborted)throw new Error('응답이 지연되고 있습니다. 잠시 후 다시 불러와 주세요.');throw error;}finally{clearTimeout(timer);}
}
export const cachedJson=createJsonCache(fetchJson,{sizeOf:jsonCharacterSize});
const verifiedHashes=new WeakMap();
export async function verifiedJson(file,sha256){
  const value=await cachedJson(file);
  if(!/^[a-f0-9]{64}$/.test(sha256||''))throw Error('조회 자료 체크섬 형식 오류');
  if(verifiedHashes.get(value)!==sha256){
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
    const actual=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    if(actual!==sha256)throw Error('조회 자료 체크섬 불일치');verifiedHashes.set(value,sha256);
  }
  return value;
}
function validateCompactIdentity(rows){
  for(const row of rows){const item=row.identity;if(!bindingMatchesSource(row,item)||Object.keys(item).length!==(item.provider_apartment_id?6:5)||!['building','cohort','complex','unresolved'].includes(item.precision)||!['root_id','cohort_id','building_id'].every(key=>item[key]===null||typeof item[key]==='string')||(['building','cohort'].includes(item.precision)?!item.root_id||!item.cohort_id||item.precision==='building'&&!item.building_id:item.root_id!==null||item.cohort_id!==null||item.building_id!==null))throw Error('주거 연결 조회 배정 누락·불일치');}
  return rows;
}
export async function loadDistrict(manifest, code,request={}) {
  const district = manifest.districts[code];
  if (!district) return [];
  const prepared=typeof __BROWSER_DATA__==='undefined'?null:__BROWSER_DATA__?.[code];
  const informationGeneration=manifest.apartment_information?.generation;
  const browser=district.browser||(prepared?.source_sha256===district.sha256&&(!informationGeneration||prepared.apartment_information_generation===informationGeneration)?prepared:null);
  const housing=manifest.housing;
  if(housing&&(!housing.sources||housing.sources[code]!==district.sha256))throw Error('주거 연결 원본 버전 불일치');
  if(browser){
    if(informationGeneration&&browser.apartment_information_generation&&browser.apartment_information_generation!==informationGeneration)throw Error('공통 아파트 정보와 조회 목록 생성 버전 불일치');
    if(housing&&browser.housing_sha256!==housing.sha256)throw Error('주거 연결 조회 버전 불일치');
    const index=await (housing?verifiedJson('/query-data/'+browser.file,browser.sha256):cachedJson('/query-data/'+browser.file));
    if(informationGeneration&&index.apartment_information_generation&&index.apartment_information_generation!==informationGeneration)throw Error('공통 아파트 정보와 조회 목록 생성 버전 불일치');
    if(housing){if(index.housing_sha256!==housing.sha256)throw Error('주거 연결 조회 목록 버전 불일치');validateCompactIdentity(index.catalog);validateCompactIdentity(index.latest);}
    const monthRows=async file=>{
      if(!housing)return cachedJson('/query-data/'+file);
      const suffix=file.match(/^month-\d{5}-\d{6}-([a-f0-9]{12})\.json$/);if(!suffix)throw Error('월별 조회 경로 오류');
      const value=await cachedJson('/query-data/'+file),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))),hash=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
      if(!hash.startsWith(suffix[1]))throw Error('월별 조회 체크섬 불일치');return validateCompactIdentity(value);
    };
    const catalog=index.catalog;
    if(request.catalogOnly)return {rows:[],catalog};
    if(request.recentCount!==''&&validRecentCount(request.recentCount)&&request.recentRegions?.length){
      // Read complete months newest first. Every selected card must have enough
      // matching rows before stopping, including its area and cancellation rules.
      const months=Object.entries(index.months).sort(([a],[b])=>b.localeCompare(a));
      const regions=request.recentRegions.filter(region=>region.region_code===code);
      const rows=[],range={start:'0000-01-01',end:request.end||'9999-12-31'};
      for(const [,file] of months){
        rows.push(...await monthRows(file));
        if(regions.every(region=>weeklyResultRows(rows,region,range,request).length>=request.recentCount))break;
      }
      return {rows,catalog};
    }
    const start=request.start?.slice(0,7).replace('-',''),end=request.end?.slice(0,7).replace('-','');
    const months=Object.entries(index.months).filter(([month])=>(!start||month>=start)&&(!end||month<=end));
    // Limit simultaneous requests when a user deliberately selects many years.
    const batches=[];
    for(let i=0;i<months.length;i+=6)batches.push(months.slice(i,i+6));
    const rows=[];
    for(const batch of batches){const values=await Promise.all(batch.map(([,file])=>monthRows(file)));values.forEach(value=>rows.push(...value));}
    if(request.includeLatest){const ids=new Set(rows.map(row=>row.id));for(const row of index.latest)if(!ids.has(row.id)){rows.push(row);ids.add(row.id);}}
    return {rows,catalog};
  }
  const path = `/data/${district.file}`;
  if(!housing)return cachedJson(path);
  if(!/^housing-[a-f0-9]{12}\.json$/.test(housing.file||''))throw Error('주거 연결 파일 경로 오류');
  const [rows,payload]=await Promise.all([verifiedJson(path,district.sha256),verifiedJson('/data/'+housing.file,housing.sha256)]);
  if(payload.source_fingerprint!==housing.source_fingerprint||payload.row_count!==manifest.count)throw Error('주거 연결 원본 스냅샷 불일치');
  const bindings=housingBindingsMap(payload);
  return rows.map(row=>{const identity=bindings.get(row.id);if(!bindingMatchesSource(row,identity))throw Error('주거 연결 원본 배정 누락·불일치');return {...row,identity};});
}
loadDistrict.supportsRanges=true;
