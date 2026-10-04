import {localEnv,paths} from './storage.mjs';

const SEARCH_URL = 'https://business.juso.go.kr/addrlink/addrLinkApi.do';

export function addressKey(filename=paths.env) {
  return process.env.JUSO_ADDRESS_SEARCH_KEY || localEnv(filename).JUSO_ADDRESS_SEARCH_KEY || '';
}

function normalized(value) {
  return String(value || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim();
}

export function parseAddressResult(query,payload) {
  const results=payload?.results,common=results?.common;
  if(!common || String(common.errorCode)!=='0' || !Array.isArray(results.juso || []))
    throw new Error('공식 주소 API 응답을 확인하세요. 승인키와 이용 상태를 점검해 주세요.');
  const matches=(results.juso || []).filter(item=>item && typeof item==='object' &&
    (normalized(item.jibunAddr)===query || normalized(item.jibunAddr).startsWith(query+' ')));
  const total=Number(common.totalCount || 0);
  if(matches.length===1 && total<=100 && typeof matches[0].roadAddr==='string' && matches[0].roadAddr.trim())
    return {status:'exact',roadAddress:matches[0].roadAddr.trim()};
  return {status:matches.length>1 || total>100?'ambiguous':'unmatched',roadAddress:''};
}

export function pendingAddresses(db,limit=100,{refresh=false}={}) {
  if(!Number.isInteger(limit) || limit<1 || limit>10000)throw new Error('주소 조회 건수를 확인하세요.');
  return db.prepare(`SELECT DISTINCT t.region_code,t.dong,t.jibun,
      (SELECT region_name FROM regions WHERE region_code=t.region_code ORDER BY rowid LIMIT 1) AS region_name
    FROM trades t LEFT JOIN address_lookups a
      ON a.region_code=t.region_code AND a.dong=t.dong AND a.jibun=t.jibun
    WHERE trim(t.jibun)!='' AND (a.region_code IS NULL OR ?)
    ORDER BY t.region_code,t.dong,t.jibun LIMIT ?`).all(Number(refresh),limit);
}

export async function collectAddresses(db,key,{limit=100,refresh=false,signal,fetcher=fetch,pause=100,onProgress}={}) {
  if(!key?.trim())throw new Error('JUSO_ADDRESS_SEARCH_KEY를 설정하세요.');
  const pending=pendingAddresses(db,limit,{refresh});
  const save=db.prepare(`INSERT INTO address_lookups(region_code,dong,jibun,query,status,road_address,response_json,fetched_at)
    VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(region_code,dong,jibun) DO UPDATE SET
    query=excluded.query,status=excluded.status,road_address=excluded.road_address,
    response_json=excluded.response_json,fetched_at=excluded.fetched_at`);
  const saveRoad=db.prepare(`INSERT INTO road_addresses VALUES (?,?,?,?) ON CONFLICT(region_code,dong,jibun)
    DO UPDATE SET road_address=excluded.road_address`);
  const removeRoad=db.prepare('DELETE FROM road_addresses WHERE region_code=? AND dong=? AND jibun=?');
  const counts={total:pending.length,completed:0,exact:0,unresolved:0};
  for(const item of pending) {
    signal?.throwIfAborted();
    if(!item.region_name)throw new Error('주소의 시군구명을 찾지 못했습니다.');
    const query=normalized(`${item.region_name} ${item.dong} ${item.jibun}`);
    const url=new URL(SEARCH_URL);
    url.search=new URLSearchParams({confmKey:key.trim(),currentPage:'1',countPerPage:'100',keyword:query,resultType:'json'}).toString();
    let payload;
    try {
      const response=await fetcher(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error();
      payload=await response.json();
    } catch(error) {
      if(signal?.aborted)throw error;
      throw new Error('공식 주소 API 연결 또는 응답에 실패했습니다.');
    }
    const result=parseAddressResult(query,payload);
    db.exec('BEGIN');
    try {
      save.run(item.region_code,item.dong,item.jibun,query,result.status,result.roadAddress,JSON.stringify(payload),new Date().toISOString());
      if(result.status==='exact')saveRoad.run(item.region_code,item.dong,item.jibun,result.roadAddress);
      else removeRoad.run(item.region_code,item.dong,item.jibun);
      db.exec('COMMIT');
    } catch(error) {db.exec('ROLLBACK');throw error;}
    counts.completed++;
    if(result.status==='exact')counts.exact++;else counts.unresolved++;
    onProgress?.(counts,item);
    if(pause && counts.completed<pending.length)await new Promise((resolve,reject)=>{
      const timer=setTimeout(resolve,pause);
      signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(signal.reason);},{once:true});
    });
  }
  return counts;
}
