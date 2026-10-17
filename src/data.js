const pending = new Map();
export async function fetchJson(path, fresh = false) {
  const response = await fetch(path, { cache: fresh ? 'no-store' : 'default' });
  if (!response.ok) throw new Error(`데이터를 불러오지 못했습니다 (${response.status}).`);
  return response.json();
}
function cachedJson(path){
  if(!pending.has(path))pending.set(path,fetchJson(path).catch(error=>{pending.delete(path);throw error;}));
  return pending.get(path);
}
export async function loadDistrict(manifest, code,request={}) {
  const district = manifest.districts[code];
  if (!district) return [];
  const prepared=typeof __BROWSER_DATA__==='undefined'?null:__BROWSER_DATA__?.[code];
  const browser=district.browser||(prepared?.source_sha256===district.sha256?prepared:null);
  if(browser){
    const index=await cachedJson('/query-data/'+browser.file);
    const catalog=index.catalog;
    if(request.catalogOnly)return {rows:[],catalog};
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
