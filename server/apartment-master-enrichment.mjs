import {setTimeout as delay} from 'node:timers/promises';
import {localEnv,paths} from './storage.mjs';
import {toWgs84} from './coordinates.mjs';
import {masterIssue} from './apartment-master.mjs';
export const VWORLD_LAYERS=Object.freeze({parcels:'LP_PA_CBND_BUBUN',buildings:'LT_C_BLDGINFO',administrativeDongs:'LT_C_ADEMD_INFO',administrativeDistricts:'LT_C_ADSIGG_INFO',zoning:'LT_C_UQ111'});
export const vworldKey=(file=paths.env)=>process.env.VWORLD_API_KEY||localEnv(file).VWORLD_API_KEY||'';
export const vworldDomain=(file=paths.env)=>process.env.VWORLD_DOMAIN||localEnv(file).VWORLD_DOMAIN||'https://psionic7.github.io';
function abortSignal(signal){return signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000);}
async function readJson(url,{signal,fetcher=fetch,label}={}){
 let response;try{response=await fetcher(url,{signal:abortSignal(signal)});}catch{signal?.throwIfAborted();throw new Error(label+' 연결 실패');}
 if(!response.ok)throw new Error(label+` 요청 실패 (HTTP ${response.status})`);try{return await response.json();}catch{throw new Error(label+' 응답 형식 오류');}
}
export function validParcelGeometry(geometry){
 if(!['Polygon','MultiPolygon'].includes(geometry?.type))return false;const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
 return Array.isArray(polygons)&&polygons.length>0&&polygons.every(poly=>Array.isArray(poly)&&poly.length>0&&poly.every(r=>Array.isArray(r)&&r.length>=4&&r.every(p=>Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>=122&&p[0]<=135&&p[1]>=28&&p[1]<=40)&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1]));
}
export function parseParcelFeature(payload,pnu){
 const r=payload?.response;if(r?.status==='NOT_FOUND')return null;if(r?.status!=='OK')throw new Error('브이월드 데이터 API 키·등록 URL·이용 권한을 확인하세요.');
 const features=r.result?.featureCollection?.features;if(!Array.isArray(features))throw new Error('브이월드 지적 도형 응답을 확인하세요.');
 const matched=features.filter(f=>String(f.properties?.pnu)===pnu);if(!matched.length&&Number(r.record?.total)===0)return null;
 if(matched.length!==1||features.length!==1||!validParcelGeometry(matched[0].geometry))throw new Error('지적 도형의 PNU 또는 경계를 확인할 수 없습니다.');return matched[0].geometry;
}
export function parseParcelResult(payload,pnu){return parseParcelFeature(payload,pnu);}
export async function fetchParcelGeometry(key,pnu,{domain=vworldDomain(),signal,fetcher}={}){
 if(!key||!/^\d{19}$/.test(pnu))throw new Error('브이월드 키와 공식 PNU를 확인하세요.');const u=new URL('https://api.vworld.kr/req/data');
 u.search=new URLSearchParams({service:'data',version:'2.0',request:'GetFeature',data:'LP_PA_CBND_BUBUN',key,domain,attrFilter:`pnu:=:${pnu}`,format:'json',crs:'EPSG:4326',size:'10',page:'1',geometry:'true',attribute:'true'}).toString();return parseParcelResult(await readJson(u,{signal,fetcher,label:'브이월드 지적 API'}),pnu);
}
export function parseMasterEntrances(payload,codes){
 const results=payload?.results,rows=results?.juso??(String(results?.common?.totalCount)==='0'?[]:null);if(String(results?.common?.errorCode)!=='0'||!Array.isArray(rows)||Number(results.common.totalCount)!==rows.length)throw new Error('주소 좌표 API 승인키·응답을 확인하세요.');
 if(rows.length>100)throw new Error('주소 좌표 API 출입구 건수가 올바르지 않습니다.');
 return rows.map(r=>{if(Object.entries(codes).some(([key,value])=>r[key]!=null&&String(r[key])!==value))throw new Error('주소 좌표 응답의 건물 코드가 일치하지 않습니다.');return toWgs84(r.entX,r.entY);});
}
export async function fetchMasterEntrances(key,codes,{signal,fetcher,pause=2000}={}){
 const u=new URL('https://business.juso.go.kr/addrlink/addrCoordApi.do');u.search=new URLSearchParams({confmKey:key,...codes,resultType:'json'}).toString();
 for(let n=0;n<4;n++){const payload=await readJson(u,{signal,fetcher,label:'주소 좌표 API'});if(String(payload?.results?.common?.errorCode)!=='E0007')return parseMasterEntrances(payload,codes);if(n===3)throw new Error('주소 좌표 API 요청 제한이 지속됩니다. 완료된 자료를 유지합니다.');await delay(pause*2**n,undefined,{signal});}
}
export async function enrichApartmentMaster(db,{coordinateKey,vworldKey:geoKey,domain,signal,coordinateFetcher=fetchMasterEntrances,parcelFetcher=fetchParcelGeometry,onProgress,pause=1000,refresh=false}={}){
 if(!coordinateKey||!geoKey)throw new Error('JUSO_COORDINATE_SEARCH_KEY와 VWORLD_API_KEY가 필요합니다.');
 const buildings=db.prepare('SELECT b.*,i.region_id FROM apartment_buildings b JOIN apartment_building_inventory i USING(building_id) JOIN apartment_complexes c USING(apartment_id) WHERE i.active=1 AND c.active=1 ORDER BY b.building_id').all(),parcels=db.prepare('SELECT DISTINCT p.pnu FROM apartment_parcels p JOIN apartment_complexes c USING(apartment_id) WHERE c.active=1 ORDER BY p.pnu').all();
 const groups=new Map();for(const b of buildings){const codes=JSON.parse(b.coordinate_codes_json||'null');if(!codes)continue;if(!groups.has(b.coordinate_codes_json))groups.set(b.coordinate_codes_json,[]);groups.get(b.coordinate_codes_json).push(b);}
 let completed=0,total=groups.size+parcels.length;const step=(kind,label)=>{completed++;onProgress?.({kind,label,completed,total});};
 const save=db.prepare('INSERT INTO apartment_entrances VALUES(?,?,?,?,?,?,?,?)');
 for(const [encoded,bs] of groups){signal?.throwIfAborted();const cached=!refresh?bs.find(b=>b.coordinate_status==='exact'):null;let entrances=cached?db.prepare('SELECT latitude,longitude,ent_x AS entX,ent_y AS entY FROM apartment_entrances WHERE building_id=? ORDER BY entrance_index').all(cached.building_id):null;
 if(!entrances?.length)entrances=await coordinateFetcher(coordinateKey,JSON.parse(encoded),{signal});const at=new Date().toISOString();db.exec('BEGIN');try{for(const b of bs){db.prepare('DELETE FROM apartment_entrances WHERE building_id=?').run(b.building_id);entrances.forEach((e,i)=>save.run(b.building_id,i,e.latitude,e.longitude,e.entX,e.entY,'주소정보누리집 좌표 API',at));db.prepare('UPDATE apartment_buildings SET coordinate_status=?,coordinate_fetched_at=? WHERE building_id=?').run(entrances.length?'exact':'unmatched',at,b.building_id);if(!entrances.length)masterIssue(db,{region_id:b.region_id,apartment_id:b.apartment_id,building_id:b.building_id,code:'location_unmatched',detail:'공식 도로명주소 코드에 대응하는 출입구 좌표가 없습니다.'});}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}step('coordinates',bs[0].road_address);if(pause&&!cached)await delay(pause,undefined,{signal});
 }
 for(const {pnu} of parcels){signal?.throwIfAborted();const prior=!refresh?db.prepare("SELECT geometry_json FROM apartment_parcels WHERE pnu=? AND boundary_status='exact' AND geometry_json IS NOT NULL LIMIT 1").get(pnu):null;const geometry=prior?JSON.parse(prior.geometry_json):await parcelFetcher(geoKey,pnu,{domain,signal});
 db.prepare('UPDATE apartment_parcels SET geometry_json=?,boundary_status=?,boundary_source=?,fetched_at=? WHERE pnu=?').run(geometry?JSON.stringify(geometry):null,geometry?'exact':'unmatched','V-World 연속지적도',new Date().toISOString(),pnu);if(!geometry)for(const p of db.prepare('SELECT p.apartment_id,i.region_id FROM apartment_parcels p JOIN apartment_complexes c USING(apartment_id) JOIN apartment_inventory_regions i ON i.legal_code=c.legal_code WHERE p.pnu=?').all(pnu))masterIssue(db,{...p,code:'boundary_unmatched',detail:`공식 필지 ${pnu}의 지적 도형이 미확인입니다.`});step('parcels',pnu);if(pause&&!prior)await delay(pause,undefined,{signal});
 }
 return{completed,total};
}
