import {createJsonCache} from './json-cache.mjs';
import {validRecentCount,weeklyResultRows} from './weekly/query.mjs';
const sizes=new WeakMap();
export const jsonCharacterSize=value=>sizes.get(value)||0;
export async function fetchJson(path, fresh = false) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(path,{cache:fresh?'no-store':'default',signal:controller.signal});
    if(!response.ok)throw new Error('데이터를 불러오지 못했습니다 ('+response.status+').');
    if(typeof response.text!=='function')return await response.json();
    const text=await response.text(),value=JSON.parse(text);if(value&&typeof value==='object')sizes.set(value,text.length);return value;
  }catch(error){if(controller.signal.aborted)throw new Error('응답이 지연되고 있습니다. 잠시 후 다시 불러와 주세요.');throw error;}finally{clearTimeout(timer);}
}
export const cachedJson=createJsonCache(fetchJson,{sizeOf:jsonCharacterSize});
export async function loadDistrict(manifest, code,request={}) {
  const district = manifest.districts[code];
  if (!district) return [];
  const prepared=typeof __BROWSER_DATA__==='undefined'?null:__BROWSER_DATA__?.[code];
  const browser=district.browser||(prepared?.source_sha256===district.sha256?prepared:null);
  if(browser){
    const index=await cachedJson('/query-data/'+browser.file);
    const catalog=index.catalog;
    if(request.catalogOnly)return {rows:[],catalog};
    if(request.recentCount!==''&&validRecentCount(request.recentCount)&&request.recentRegions?.length){
      // Read complete months newest first. Every selected card must have enough
      // matching rows before stopping, including its area and cancellation rules.
      const months=Object.entries(index.months).sort(([a],[b])=>b.localeCompare(a));
      const regions=request.recentRegions.filter(region=>region.region_code===code);
      const rows=[],range={start:'0000-01-01',end:request.end||'9999-12-31'};
      for(const [,file] of months){
        rows.push(...await cachedJson('/query-data/'+file));
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
    for(const batch of batches){const values=await Promise.all(batch.map(([,file])=>cachedJson('/query-data/'+file)));values.forEach(value=>rows.push(...value));}
    if(request.includeLatest){const ids=new Set(rows.map(row=>row.id));for(const row of index.latest)if(!ids.has(row.id)){rows.push(row);ids.add(row.id);}}
    return {rows,catalog};
  }
  const path = `/data/${district.file}`;
  return cachedJson(path);
}
loadDistrict.supportsRanges=true;
