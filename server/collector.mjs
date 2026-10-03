import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {setTimeout as delay} from 'node:timers/promises';
export const ENDPOINT='https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
export function currentMonth(now=new Date()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(now).replace(/[^0-9]/g,'');}
export function monthsBetween(start,end,now=new Date()) {
  if([start,end].some(m=>typeof m!=='string'||!/^\d{6}$/.test(m)||+m.slice(0,4)<1900||+m.slice(4)<1||+m.slice(4)>12)) throw new Error('계약월은 YYYYMM 형식으로 입력하세요.');
  if(start>end||end>currentMonth(now)) throw new Error('월 범위가 잘못되었거나 미래 계약월입니다.');
  const a=+start.slice(0,4)*12 + +start.slice(4)-1,b=+end.slice(0,4)*12 + +end.slice(4)-1;
  if(b-a>=360) throw new Error('한 번에 최대 360개월까지 수집할 수 있습니다.');
  return Array.from({length:b-a+1},(_,i)=>String(Math.floor((a+i)/12)).padStart(4,'0')+String((a+i)%12+1).padStart(2,'0'));
}
const parser=new XMLParser({parseTagValue:false,parseAttributeValue:false,trimValues:false,ignoreAttributes:true,isArray:(_tag,jpath)=>jpath==='response.body.items.item'});
export function parsePage(xml) {
  if(/<!\s*(DOCTYPE|ENTITY)/i.test(xml)||XMLValidator.validate(xml)!==true) throw new Error('API 응답이 유효한 XML이 아닙니다.');
  const doc=parser.parse(xml)?.response;
  if(!['0','00','000'].includes(doc?.header?.resultCode?.trim())) throw new Error('API 인증, 활용 승인 또는 호출 한도를 확인하세요.');
  const total=doc?.body?.totalCount;
  if(typeof total!=='string'||!/^\d+$/.test(total.trim())||!Number.isSafeInteger(+total)) throw new Error('API 총 건수가 올바르지 않습니다.');
  const items=doc?.body?.items?.item || [];
  if(!Array.isArray(items)||items.some(item=>!item||typeof item!=='object'||Object.values(item).some(v=>typeof v!=='string'))) throw new Error('API 거래 필드가 올바르지 않습니다.');
  return {total:+total,items};
}
export function normalize(item,code,month) {
  const integer=v=>{if(typeof v!=='string'||!/^[-+]?\d+$/.test(v.trim())||!Number.isSafeInteger(+v)) throw new Error();return +v;};
  try {
    const y=integer(item.dealYear),m=integer(item.dealMonth),d=integer(item.dealDay),date=new Date(Date.UTC(y,m-1,d));
    const price=integer(item.dealAmount.replace(/[,\s]/g,'')),area=Number(item.excluUseAr);
    if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d||date.toISOString().slice(0,7).replace('-','')!==month||price<=0||!Number.isFinite(area)||area<=0||area>=10000) throw new Error();
    if((item.sggCd?.trim()&&item.sggCd.trim()!==code)||!item.aptNm?.trim()||!item.umdNm?.trim()) throw new Error();
    return [code,month,date.toISOString().slice(0,10),item.aptNm.trim(),item.umdNm.trim(),item.jibun||'',price,area,item.floor?.trim()?integer(item.floor):null,item.buildYear?.trim()?integer(item.buildYear):null,Number(['O','Y','1'].includes(item.cdealType?.trim().toUpperCase())||Boolean(item.cdealDay?.trim())),JSON.stringify(item)];
  } catch {throw new Error('거래 필드 검증 실패. 기존 월별 데이터는 유지됩니다.');}
}
export async function fetchPage(key,code,month,page,signal,fetcher=fetch) {
  let decoded;try{decoded=decodeURIComponent(key);}catch{decoded=key;}
  const url=ENDPOINT+'?'+new URLSearchParams({serviceKey:decoded,LAWD_CD:code,DEAL_YMD:month,pageNo:String(page),numOfRows:'1000'});
  for(let attempt=0;attempt<3;attempt++) {
    signal?.throwIfAborted();
    let response;
    try {response=await fetcher(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}
    catch {signal?.throwIfAborted();if(attempt===2) throw new Error('공공 API 연결 실패. 네트워크를 확인하세요.');await delay(700*(attempt+1),undefined,{signal});continue;}
    if(!response.ok) {if([429,500,502,503,504].includes(response.status)&&attempt<2){await delay(700*(attempt+1),undefined,{signal});continue;}throw new Error(`공공 API 요청 실패 (HTTP ${response.status})`);}
    let xml;
    try {xml=await response.text();}
    catch {signal?.throwIfAborted();if(attempt===2)throw new Error('공공 API 응답을 읽지 못했습니다. 다시 수집하세요.');await delay(700*(attempt+1),undefined,{signal});continue;}
    for(const secret of new Set([key,decoded,encodeURIComponent(decoded)])) if(secret)xml=xml.replaceAll(secret,'[REDACTED]');
    return {...parsePage(xml),xml};
  }
}
export async function collectMonth(db,key,code,month,name,{signal,fetcher=fetchPage,pause=150}={}) {
  monthsBetween(month,month);
  if(!/^\d{5}$/.test(code)||!name.trim()||!key)throw new Error('API 키와 지역 정보를 확인하세요.');
  let expected=null;const items=[],pages=[];
  for(let page=1;page<=1000;page++) {
    signal?.throwIfAborted();
    const result=await fetcher(key,code,month,page,signal);
    if(expected!==null&&expected!==result.total) throw new Error('수집 중 총 건수가 달라졌습니다. 다시 수집하세요.');
    expected=result.total;items.push(...result.items);pages.push([page,Buffer.from(result.xml)]);
    if(items.length===expected)break;
    if(!result.items.length||items.length>expected||page===1000)throw new Error('API 페이지가 누락되었거나 총 건수가 맞지 않습니다.');
    if(pause)await delay(pause,undefined,{signal});
  }
  const rows=items.map(item=>normalize(item,code,month));signal?.throwIfAborted();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM trades WHERE region_code=? AND deal_month=?').run(code,month);
    const insert=db.prepare('INSERT INTO trades (region_code,deal_month,deal_date,apartment,dong,jibun,price_man,area_m2,floor,build_year,cancelled,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
    rows.forEach(row=>insert.run(...row));
    const run=db.prepare('INSERT INTO collection_runs(region_code,region_name,deal_month,fetched_at,api_count,stored_count) VALUES (?,?,?,?,?,?)').run(code,name,month,new Date().toISOString(),expected,rows.length);
    const insertPage=db.prepare('INSERT INTO api_pages VALUES (?,?,?)');
    pages.forEach(([page,xml])=>insertPage.run(run.lastInsertRowid,page,xml));
    db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run('published_at',new Date().toISOString());
    db.exec('COMMIT');
  } catch(e) {db.exec('ROLLBACK');throw e;}
  return rows.length;
}
export function collectionTasks(selected,months) {return [...new Map(selected.flatMap(r=>months.map(month=>[`${r.region_code}/${month}`,{code:r.region_code,name:r.region_name,month}]))).values()];}
