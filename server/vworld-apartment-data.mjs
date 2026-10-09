import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {VWORLD_LAYERS,validParcelGeometry,vworldDomain} from './apartment-master-enrichment.mjs';

const ringWkt=ring=>'('+ring.map(p=>p.join(' ')).join(',')+')';
export function geometryWkt(geometry){
  if(!validParcelGeometry(geometry))throw new Error('V-World 공간 필터 경계를 확인할 수 없습니다.');
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  if(geometry.type==='Polygon')return'POLYGON('+polygons[0].map(ringWkt).join(',')+')';
  return'MULTIPOLYGON('+polygons.map(poly=>'('+poly.map(ringWkt).join(',')+')').join(',')+')';
}
function parsePage(payload){
  const r=payload?.response;
  if(r?.status==='NOT_FOUND')return{total:0,features:[]};
  if(r?.status!=='OK')throw new Error('V-World 공간정보 오류가 있어 기존 자료를 유지합니다.');
  const total=Number(r.record?.total),features=r.result?.featureCollection?.features;
  if(!Number.isSafeInteger(total)||total<0||!Array.isArray(features)||features.some(f=>f?.type!=='Feature'||!validParcelGeometry(f.geometry)||!f.properties||Object.values(f.properties).some(v=>v!==null&&!['string','number','boolean'].includes(typeof v))))throw new Error('V-World 공간정보 응답 형식이 올바르지 않습니다.');
  return{total,features};
}
async function request(key,domain,layer,wkt,page,signal,fetcher,{retries=5,retryDelay=1000}={}){
  const url=new URL('https://api.vworld.kr/req/data');
  url.search=new URLSearchParams({service:'data',version:'2.0',request:'GetFeature',data:layer,key,domain,format:'json',crs:'EPSG:4326',geometry:'true',attribute:'true',size:'1000',page:String(page),geomFilter:wkt}).toString();
  let response;
  for(let attempt=1;attempt<=retries;attempt++){
    try{response=await fetcher(url,{headers:{Connection:'close','Cache-Control':'no-cache'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}
    catch(error){signal?.throwIfAborted();if(attempt===retries){const code=error?.cause?.code||error?.code;throw new Error('V-World 공간정보 API 연결 실패 ('+(code||'일시 네트워크 오류')+'; '+attempt+'회 시도).');}await delay(retryDelay*2**(attempt-1),undefined,{signal});continue;}
    if([408,429,500,502,503,504].includes(response.status)&&attempt<retries){await delay(retryDelay*2**(attempt-1),undefined,{signal});continue;}
    break;
  }
  if(!response.ok){const error=new Error('V-World 공간정보 API 요청 실패 (HTTP '+response.status+').');error.status=response.status;throw error;}
  try{return await response.json();}catch{throw new Error('V-World 공간정보 응답 형식이 올바르지 않습니다.');}
}
function roundedQueryGeometry(geometry,precision){
  const factor=10**precision;
  const round=value=>Array.isArray(value)?value.map(round):typeof value==='number'?Math.round(value*factor)/factor:value;
  return{...geometry,coordinates:round(geometry.coordinates)};
}
export async function fetchVworldLayer(key,layer,geometry,{domain=vworldDomain(),signal,fetcher=fetch,pause=250,retries=5,retryDelay=1000}={}){
  if(![VWORLD_LAYERS.buildings,VWORLD_LAYERS.zoning].includes(layer))throw new Error('V-World 데이터 레이어를 확인하세요.');
  const options={retries,retryDelay};
  let filter=geometryWkt(geometry),usedCompactFilter=false;
  const requestPage=async page=>{try{return await request(key,domain,layer,filter,page,signal,fetcher,options);}catch(error){if(error.status!==414||usedCompactFilter)throw error;const compact=geometryWkt(roundedQueryGeometry(geometry,6));if(compact===filter)throw error;filter=compact;usedCompactFilter=true;return request(key,domain,layer,filter,page,signal,fetcher,options);}};
  const first=parsePage(await requestPage(1)),features=[...first.features];
  if(features.length>first.total)throw new Error('V-World 공간정보 전체 건수가 일치하지 않습니다.');
  const pages=Math.ceil(first.total/1000);
  if(pages>1000)throw new Error('V-World 공간정보 페이지 수가 안전 범위를 넘었습니다.');
  for(let page=2;page<=pages;page++){
    signal?.throwIfAborted();
    const next=parsePage(await requestPage(page));
    if(next.total!==first.total||!next.features.length||features.length+next.features.length>next.total)throw new Error('V-World 공간정보 페이지가 누락되거나 바뀌었습니다.');
    features.push(...next.features);
    if(pause)await delay(pause,undefined,{signal});
  }
  if(features.length!==first.total)throw new Error('V-World 공간정보 전체 페이지를 확인하지 못했습니다.');
  return[...new Map(features.map(f=>[JSON.stringify([f.geometry,f.properties]),f])).values()];
}

const digest=(layer,geometry,properties)=>createHash('sha256').update(JSON.stringify([layer,geometry,properties])).digest('hex');
export async function enrichVworldApartmentData(db,{key,domain,signal,fetcher=fetch,pause=500,refresh=false,onProgress,maxParcels=Infinity,retries=5,retryDelay=1000}={}){
  if(!key)throw new Error('VWORLD_API_KEY가 필요합니다.');
  const parcels=db.prepare("SELECT p.pnu,p.geometry_json,p.attributes_json,p.spatial_status,p.boundary_status FROM apartment_parcels p JOIN apartment_complexes c USING(apartment_id) WHERE c.active=1 GROUP BY p.pnu ORDER BY p.pnu").all();
  let completed=0,processed=0;
  const limit=Number.isSafeInteger(maxParcels)&&maxParcels>0?maxParcels:Infinity;
  for(const parcel of parcels){
    signal?.throwIfAborted();
    const apartmentIds=db.prepare('SELECT DISTINCT apartment_id FROM apartment_parcels WHERE pnu=?').all(parcel.pnu).map(row=>row.apartment_id);
    if(!parcel.geometry_json||parcel.boundary_status!=='exact'){
      db.prepare("UPDATE apartment_parcels SET spatial_status='unavailable' WHERE pnu=?").run(parcel.pnu);
      completed++;onProgress?.({kind:'vworld',completed,total:parcels.length});continue;
    }
    if(!refresh&&['complete','empty'].includes(parcel.spatial_status)){
      completed++;onProgress?.({kind:'vworld_cached',completed,total:parcels.length});continue;
    }
    if(processed>=limit)break;
    if(!parcel.attributes_json){const attrs=await loadCadastralAttributes(key,parcel.pnu,{domain,signal,fetcher});db.prepare('UPDATE apartment_parcels SET attributes_json=? WHERE pnu=?').run(JSON.stringify(attrs),parcel.pnu);}
    const geometry=JSON.parse(parcel.geometry_json),buildingFeatures=await fetchVworldLayer(key,VWORLD_LAYERS.buildings,geometry,{domain,signal,fetcher,pause,retries,retryDelay}),zoningFeatures=await fetchVworldLayer(key,VWORLD_LAYERS.zoning,geometry,{domain,signal,fetcher,pause,retries,retryDelay});
    const at=new Date().toISOString();db.exec('BEGIN');
    try{
      db.prepare('DELETE FROM apartment_footprint_links WHERE pnu=?').run(parcel.pnu);
      db.prepare('DELETE FROM apartment_zoning_links WHERE pnu=?').run(parcel.pnu);
      for(const feature of buildingFeatures){
        const id=digest(VWORLD_LAYERS.buildings,feature.geometry,feature.properties);
        db.prepare('INSERT OR IGNORE INTO apartment_building_footprints(footprint_id,geometry_json,properties_json,source,fetched_at) VALUES(?,?,?,?,?)').run(id,JSON.stringify(feature.geometry),JSON.stringify(feature.properties),'V-World GIS건물통합정보',at);
        for(const apartmentId of apartmentIds)db.prepare('INSERT OR IGNORE INTO apartment_footprint_links VALUES(?,?,?)').run(apartmentId,id,parcel.pnu);
      }
      for(const feature of zoningFeatures){
        const id=digest(VWORLD_LAYERS.zoning,feature.geometry,feature.properties);
        db.prepare('INSERT OR IGNORE INTO apartment_zoning_features(feature_id,geometry_json,properties_json,source,fetched_at) VALUES(?,?,?,?,?)').run(id,JSON.stringify(feature.geometry),JSON.stringify(feature.properties),'V-World 용도지역정보',at);
        for(const apartmentId of apartmentIds)db.prepare('INSERT OR IGNORE INTO apartment_zoning_links VALUES(?,?,?)').run(apartmentId,id,parcel.pnu);
      }
      db.prepare("UPDATE apartment_parcels SET spatial_status=?,spatial_fetched_at=? WHERE pnu=?").run(buildingFeatures.length||zoningFeatures.length?'complete':'empty',at,parcel.pnu);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    completed++;processed++;onProgress?.({kind:'vworld',completed,total:parcels.length});if(pause)await delay(pause,undefined,{signal});
  }
  const remaining=db.prepare("SELECT count(DISTINCT p.pnu) AS n FROM apartment_parcels p JOIN apartment_complexes c USING(apartment_id) WHERE c.active=1 AND p.geometry_json IS NOT NULL AND p.boundary_status='exact' AND (p.attributes_json IS NULL OR p.spatial_status NOT IN ('complete','empty'))").get().n;
  if(remaining)return{completed,total:parcels.length,processed,remaining,batchComplete:false};
  const regions=db.prepare("SELECT region_id,legal_code FROM apartment_inventory_regions WHERE status='scanned' ORDER BY region_id").all();
  for(const region of regions){signal?.throwIfAborted();const saved=!refresh?db.prepare('SELECT region_id FROM apartment_region_boundaries WHERE region_id=?').get(region.region_id):null;if(!saved){const result=await loadRegionBoundary(key,region,{domain,signal,fetcher}),feature=result.feature;if(!validParcelGeometry(feature.geometry))throw new Error('V-World 행정동 경계 형식이 올바르지 않습니다.');db.prepare('INSERT OR REPLACE INTO apartment_region_boundaries VALUES(?,?,?,?,?,?)').run(region.region_id,region.legal_code,JSON.stringify(feature.geometry),JSON.stringify(feature.properties),'V-World 법정동 경계',new Date().toISOString());}completed++;onProgress?.({kind:'region_boundary',completed,total:parcels.length+regions.length});if(pause)await delay(pause,undefined,{signal});}
  const districts=[...new Set(regions.map(region=>region.legal_code.slice(0,5)))].sort();
  for(const code of districts){signal?.throwIfAborted();const saved=!refresh?db.prepare('SELECT district_code FROM apartment_district_boundaries WHERE district_code=?').get(code):null;if(!saved){const feature=await loadDistrictBoundary(key,code,{domain,signal,fetcher});if(!validParcelGeometry(feature.geometry))throw new Error('V-World 시·군·구 경계 형식이 올바르지 않습니다.');db.prepare('INSERT OR REPLACE INTO apartment_district_boundaries VALUES(?,?,?,?,?)').run(code,JSON.stringify(feature.geometry),JSON.stringify(feature.properties),'V-World 시·군·구 경계',new Date().toISOString());}completed++;onProgress?.({kind:'district_boundary',completed,total:parcels.length+regions.length+districts.length});if(pause)await delay(pause,undefined,{signal});}
  return{completed,total:parcels.length+regions.length+districts.length,processed,remaining:0,batchComplete:true};
}
async function loadCadastralAttributes(key,pnu,{domain,signal,fetcher=fetch}={}){
  const url=new URL('https://api.vworld.kr/req/data');
  url.search=new URLSearchParams({service:'data',version:'2.0',request:'GetFeature',data:VWORLD_LAYERS.parcels,key,domain,format:'json',crs:'EPSG:4326',geometry:'true',attribute:'true',size:'10',page:'1',attrFilter:'pnu:=:'+pnu}).toString();
  let response;try{response=await fetcher(url,{headers:{Connection:'close','Cache-Control':'no-cache'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}catch{signal?.throwIfAborted();throw new Error('V-World 지적 속성 API 연결 실패');}
  if(!response.ok)throw new Error('V-World 지적 속성 API 요청 실패 (HTTP '+response.status+').');
  let payload;try{payload=await response.json();}catch{throw new Error('V-World 지적 속성 응답 형식이 올바르지 않습니다.');}
  const page=parsePage(payload),matches=page.features.filter(feature=>String(feature.properties.pnu)===pnu);
  if(page.total!==1||matches.length!==1)throw new Error('V-World 지적 PNU의 속성을 확인할 수 없습니다.');
  return matches[0].properties;
}
async function loadRegionBoundary(key,row,{domain,signal,fetcher=fetch}={}){
  const code=row.legal_code.slice(0,8),url=new URL('https://api.vworld.kr/req/data');
  url.search=new URLSearchParams({service:'data',version:'2.0',request:'GetFeature',data:VWORLD_LAYERS.administrativeDongs,key,domain,format:'json',crs:'EPSG:4326',geometry:'true',attribute:'true',size:'10',page:'1',attrFilter:'emd_cd:=:'+code}).toString();
  let response;
  try{response=await fetcher(url,{headers:{Connection:'close','Cache-Control':'no-cache'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}
  catch{signal?.throwIfAborted();throw new Error('V-World 법정동 경계 API 연결 실패');}
  if(!response.ok)throw new Error('V-World 법정동 경계 API 요청 실패 (HTTP '+response.status+').');
  let payload;try{payload=await response.json();}catch{throw new Error('V-World 법정동 경계 API 응답 형식이 올바르지 않습니다.');}
  const page=parsePage(payload),matches=page.features.filter(feature=>String(feature.properties.emd_cd)===code);
  if(page.total!==1||matches.length!==1)throw new Error('저장한 법정동 코드의 V-World 경계를 찾지 못했습니다.');
  return{code,feature:matches[0]};
}
async function loadDistrictBoundary(key,code,{domain,signal,fetcher=fetch}={}){
  const url=new URL('https://api.vworld.kr/req/data');
  url.search=new URLSearchParams({service:'data',version:'2.0',request:'GetFeature',data:VWORLD_LAYERS.administrativeDistricts,key,domain,format:'json',crs:'EPSG:4326',geometry:'true',attribute:'true',size:'10',page:'1',attrFilter:'sig_cd:=:'+code}).toString();
  let response;try{response=await fetcher(url,{headers:{Connection:'close','Cache-Control':'no-cache'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}catch{signal?.throwIfAborted();throw new Error('V-World 시·군·구 경계 API 연결 실패');}
  if(!response.ok)throw new Error('V-World 시·군·구 경계 API 요청 실패 (HTTP '+response.status+').');
  let payload;try{payload=await response.json();}catch{throw new Error('V-World 시·군·구 경계 API 응답 형식이 올바르지 않습니다.');}
  const page=parsePage(payload),matches=page.features.filter(feature=>String(feature.properties.sig_cd)===code);
  if(page.total!==1||matches.length!==1)throw new Error('수집 시·군·구의 V-World 경계를 찾지 못했습니다.');
  return matches[0];
}