import proj4 from 'proj4';
import {localEnv,paths} from './storage.mjs';

const COORDINATE_URL='https://business.juso.go.kr/addrlink/addrCoordApi.do';
// Juso entX is easting and entY is northing (not the EPSG formal axis order).
const UTM_K='+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
const norm=value=>String(value||'').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g,' ').trim();
export function coordinateKey(filename=paths.env) {
  const env=localEnv(filename);
  return process.env.JUSO_COORDINATE_SEARCH_KEY || process.env.JUSO_COORDINATE_API_KEY || env.JUSO_COORDINATE_SEARCH_KEY || env.JUSO_COORDINATE_API_KEY || '';
}
export function addressCodes(item) {
  let payload;try{payload=JSON.parse(item.response_json);}catch{return null;}
  const results=payload?.results;
  if(String(results?.common?.errorCode)!=='0'||!Array.isArray(results?.juso)||Number(results.common.totalCount)>100)return null;
  const query=norm(item.query);
  const matches=results.juso.filter(r=>norm(r.jibunAddr)===query||norm(r.jibunAddr).startsWith(query+' '));
  if(matches.length!==1||matches[0].roadAddr?.trim()!==item.road_address)return null;
  const row=matches[0],codes={};
  for(const [key,pattern] of [['admCd',/^\d{10}$/],['rnMgtSn',/^\d{12}$/],['udrtYn',/^[01]$/],['buldMnnm',/^\d{1,5}$/],['buldSlno',/^\d{1,5}$/]]) {
    const value=String(row[key]??'');if(!pattern.test(value))return null;codes[key]=value;
  }
  return codes;
}
export function toWgs84(entX,entY) {
  if(!String(entX??'').trim()||!String(entY??'').trim())throw new Error('공식 좌표 API의 좌표 값이 올바르지 않습니다.');
  const x=Number(entX),y=Number(entY);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<500000||x>1700000||y<900000||y>2300000)throw new Error('공식 좌표 API의 좌표 값이 올바르지 않습니다.');
  const [longitude,latitude]=proj4(UTM_K,'EPSG:4326',[x,y]);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude<28||latitude>40||longitude<122||longitude>135)throw new Error('공식 좌표 API의 좌표 값이 올바르지 않습니다.');
  return {latitude,longitude,entX:x,entY:y};
}
export function parseCoordinateResult(payload,codes) {
  const results=payload?.results,common=results?.common;
  const rows=results?.juso??(String(common?.totalCount)==='0'?[]:null);
  if(!common||String(common.errorCode)!=='0'||!Array.isArray(rows))throw new Error('공식 좌표 API 응답을 확인하세요. 좌표제공 승인키와 이용 상태를 점검해 주세요.');
  const total=Number(common.totalCount??rows.length);
  if(!Number.isInteger(total)||total<0||total!==rows.length)throw new Error('공식 좌표 API 응답 건수가 올바르지 않습니다.');
  if(!rows.length)return {status:'unmatched'};
  // Multiple entrances/buildings are not silently reduced to an arbitrary apartment position.
  if(rows.length!==1)return {status:'ambiguous'};
  const row=rows[0];
  if(!row||Object.keys(codes).some(k=>row[k]!=null&&String(row[k])!==codes[k]))return {status:'invalid'};
  try{return {status:'exact',...toWgs84(row.entX,row.entY),buildingId:String(row.bdMgtSn||'')};}
  catch{return {status:'invalid'};}
}
const pendingSql=`FROM address_lookups a JOIN road_addresses r USING(region_code,dong,jibun)
  LEFT JOIN coordinate_lookups c USING(region_code,dong,jibun)
  WHERE a.status='exact' AND a.road_address=r.road_address
  AND EXISTS(SELECT 1 FROM trades t WHERE t.region_code=a.region_code AND t.dong=a.dong AND t.jibun=a.jibun)
  AND (c.region_code IS NULL OR c.address_fetched_at<>a.fetched_at OR ?)`;
export function pendingCoordinates(db,limit=100,{refresh=false}={}) {
  if(!Number.isInteger(limit)||limit<1||limit>10000)throw new Error('좌표 조회 건수를 확인하세요.');
  return db.prepare(`SELECT a.* ${pendingSql} ORDER BY a.region_code,a.dong,a.jibun LIMIT ?`).all(Number(refresh),limit);
}
const confirmedSql=`FROM parcel_coordinates c JOIN address_lookups a USING(region_code,dong,jibun)
  JOIN road_addresses r USING(region_code,dong,jibun)
  WHERE a.status='exact' AND c.address_fetched_at=a.fetched_at AND c.road_address=r.road_address`;
export function coordinateStats(db) {
  return {coordinates:db.prepare(`SELECT count(*) AS n ${confirmedSql}`).get().n,
    pendingCoordinates:db.prepare(`SELECT count(*) AS n ${pendingSql}`).get(0).n,
    coordinateUnresolved:db.prepare(`SELECT count(*) AS n FROM coordinate_lookups c JOIN address_lookups a USING(region_code,dong,jibun) WHERE c.status<>'exact' AND c.address_fetched_at=a.fetched_at`).get().n,
    coordinateRevision:[db.prepare('SELECT max(fetched_at) AS d FROM parcel_coordinates').get().d,db.prepare('SELECT max(fetched_at) AS d FROM address_lookups').get().d].join('|')};
}
export function coordinatePoints(db) {
  return db.prepare(`SELECT c.region_code,c.dong,c.jibun,c.road_address,c.latitude,c.longitude,c.source,c.fetched_at,t.apartment
    ${confirmedSql.replace('WHERE',`JOIN (SELECT DISTINCT region_code,dong,jibun,apartment FROM trades) t USING(region_code,dong,jibun) WHERE`)}
    ORDER BY c.region_code,c.dong,c.jibun,t.apartment`).all();
}
function delay(ms,signal){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const abort=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
    signal?.addEventListener('abort',abort,{once:true});
  });
}
export async function collectCoordinates(db,key,{limit=100,refresh=false,signal,fetcher=fetch,pause=1000,retryDelay=2000,onProgress}={}) {
  if(!key?.trim())throw new Error('JUSO_COORDINATE_SEARCH_KEY를 설정하세요.');
  const pending=pendingCoordinates(db,limit,{refresh});
  const save=db.prepare(`INSERT INTO parcel_coordinates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(region_code,dong,jibun) DO UPDATE SET road_address=excluded.road_address,address_fetched_at=excluded.address_fetched_at,
    address_signature=excluded.address_signature,building_id=excluded.building_id,latitude=excluded.latitude,longitude=excluded.longitude,
    ent_x=excluded.ent_x,ent_y=excluded.ent_y,source=excluded.source,source_crs=excluded.source_crs,fetched_at=excluded.fetched_at`);
  const lookup=db.prepare(`INSERT INTO coordinate_lookups VALUES(?,?,?,?,?,?) ON CONFLICT(region_code,dong,jibun)
    DO UPDATE SET address_fetched_at=excluded.address_fetched_at,status=excluded.status,fetched_at=excluded.fetched_at`);
  const remove=db.prepare('DELETE FROM parcel_coordinates WHERE region_code=? AND dong=? AND jibun=?');
  const counts={total:pending.length,completed:0,exact:0,unresolved:0};
  for(const item of pending) {
    signal?.throwIfAborted();
    const codes=addressCodes(item);let result={status:'missing_codes'};
    if(codes) {
      const url=new URL(COORDINATE_URL);url.search=new URLSearchParams({confmKey:key.trim(),...codes,resultType:'json'}).toString();
      let payload;
      for(let attempt=0;attempt<4;attempt++) {
        try {
          const response=await fetcher(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
          if(!response.ok)throw new Error();payload=await response.json();
        }catch(error){if(signal?.aborted)throw error;throw new Error('공식 좌표 API 연결 또는 응답에 실패했습니다.');}
        if(String(payload?.results?.common?.errorCode)!=='E0007')break;
        if(attempt===3)throw new Error('공식 좌표 API 요청 제한이 지속됩니다. 잠시 후 미조회 좌표 수집을 다시 실행하세요.');
        await delay(retryDelay*2**attempt,signal);
      }
      result=parseCoordinateResult(payload,codes);
    }
    signal?.throwIfAborted();
    const at=new Date().toISOString();
    db.exec('BEGIN');
    try {
      lookup.run(item.region_code,item.dong,item.jibun,item.fetched_at,result.status,at);
      if(result.status==='exact')save.run(item.region_code,item.dong,item.jibun,item.road_address,item.fetched_at,JSON.stringify(codes),result.buildingId,
        result.latitude,result.longitude,result.entX,result.entY,'juso','EPSG:5179',at);
      else remove.run(item.region_code,item.dong,item.jibun);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    counts.completed++;if(result.status==='exact')counts.exact++;else counts.unresolved++;
    onProgress?.({...counts},item);
    if(pause&&counts.completed<pending.length)await delay(pause,signal);
  }
  return counts;
}
