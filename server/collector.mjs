import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash} from 'node:crypto';
import {assertTradeRows,normalizedTradeFields} from './trade-integrity.mjs';
import {storeMolitTradeSnapshot,readMolitRunRows,verifyMolitStorage} from './molit-trade-storage.mjs';
export const ENDPOINT='https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade';
export const MOLIT_ENDPOINTS=Object.freeze({basic:ENDPOINT,detailed:'https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev'});
export function currentMonth(now=new Date()) {return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit'}).format(now).replace(/[^0-9]/g,'');}
export function monthsBetween(start,end,now=new Date()) {
  if([start,end].some(m=>typeof m!=='string'||!/^\d{6}$/.test(m)||+m.slice(0,4)<1900||+m.slice(4)<1||+m.slice(4)>12)) throw new Error('계약월은 YYYYMM 형식으로 입력하세요.');
  if(start>end||end>currentMonth(now)) throw new Error('월 범위가 잘못되었거나 미래 계약월입니다.');
  const a=+start.slice(0,4)*12 + +start.slice(4)-1,b=+end.slice(0,4)*12 + +end.slice(4)-1;
  if(b-a>=360) throw new Error('한 번에 최대 360개월까지 수집할 수 있습니다.');
  return Array.from({length:b-a+1},(_,i)=>String(Math.floor((a+i)/12)).padStart(4,'0')+String((a+i)%12+1).padStart(2,'0'));
}
const parser=new XMLParser({parseTagValue:false,parseAttributeValue:false,trimValues:false,ignoreAttributes:true,isArray:(_tag,jpath)=>jpath==='response.body.items.item'});
function providerFailure(doc,httpStatus){
  const code=String(doc?.OpenAPI_ServiceResponse?.cmmMsgHeader?.returnReasonCode??doc?.response?.header?.resultCode??'').trim();
  if(code!=='30')return null;
  const error=new Error('공공 API 인증 실패 (30): 이 서비스에 등록되지 않은 서비스키입니다. 해당 API의 활용 신청·승인 상태와 인증키를 확인하세요.');
  error.code='service_key_not_registered';error.providerCode='30';if(httpStatus)error.httpStatus=httpStatus;
  return error;
}
function httpFailure(xml,status){
  if(xml.length<=65536&&!/<!\s*(DOCTYPE|ENTITY)/i.test(xml)&&XMLValidator.validate(xml)===true){
    const known=providerFailure(parser.parse(xml),status);if(known)return known;
  }
  return Object.assign(new Error(`공공 API 요청 실패 (HTTP ${status})`),{code:'http_error',httpStatus:status});
}
export function parsePage(xml) {
  if(/<!\s*(DOCTYPE|ENTITY)/i.test(xml)||XMLValidator.validate(xml)!==true) throw new Error('API 응답이 유효한 XML이 아닙니다.');
  const parsed=parser.parse(xml),known=providerFailure(parsed);if(known)throw known;
  const doc=parsed?.response;
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
export async function fetchMolitPage({service='basic',key,code,month,page=1,numOfRows=1000,signal,fetcher=fetch}={}) {
  monthsBetween(month,month);
  if(!Object.hasOwn(MOLIT_ENDPOINTS,service)||typeof key!=='string'||!key||!/^\d{5}$/.test(code)||!Number.isInteger(page)||page<1||page>1000||!Number.isInteger(numOfRows)||numOfRows<1||numOfRows>1000)throw new Error('공공 API 서비스·키·지역·페이지 설정을 확인하세요.');
  let decoded;try{decoded=decodeURIComponent(key);}catch{decoded=key;}
  const url=MOLIT_ENDPOINTS[service]+'?'+new URLSearchParams({serviceKey:decoded,LAWD_CD:code,DEAL_YMD:month,pageNo:String(page),numOfRows:String(numOfRows)});
  for(let attempt=0;attempt<3;attempt++) {
    signal?.throwIfAborted();
    let response;
    try {response=await fetcher(url,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}
    catch(error) {signal?.throwIfAborted();if(attempt===2) {const code=error.cause?.code||error.code;throw new Error(`공공 API 연결 실패${/^[A-Z_0-9]{1,80}$/.test(code||'')?' ('+code+')':''}. 네트워크를 확인하세요.`);}await delay(700*(attempt+1),undefined,{signal});continue;}
    if(!response.ok&&[429,500,502,503,504].includes(response.status)&&attempt<2){await delay(700*(attempt+1),undefined,{signal});continue;}
    let xml;
    try {xml=await response.text();}
    catch {signal?.throwIfAborted();if(!response.ok)throw httpFailure('',response.status);if(attempt===2)throw new Error('공공 API 응답을 읽지 못했습니다. 다시 수집하세요.');await delay(700*(attempt+1),undefined,{signal});continue;}
    for(const secret of new Set([key,decoded,encodeURIComponent(decoded)])) if(secret)xml=xml.replaceAll(secret,'[REDACTED]');
    if(!response.ok)throw httpFailure(xml,response.status);
    try{
      const parsed=parsePage(xml);
      return {...parsed,xml,httpStatus:response.status,service};
    }
    catch(error){if(error.providerCode)error.httpStatus=response.status;throw error;}
  }
}
export async function fetchPage(key,code,month,page,signal,fetcher=fetch) {
  return fetchMolitPage({key,code,month,page,signal,fetcher});
}
export async function fetchMolitMonth(key,code,month,{signal,fetcher,service='basic',pause=150}={}) {
  monthsBetween(month,month);
  if(!/^\d{5}$/.test(code)||!key)throw new Error('API 키와 지역 정보를 확인하세요.');
  const readPage=fetcher||((key,code,month,page,signal)=>fetchMolitPage({key,code,month,page,signal,service}));
  let expected=null,observedService;const items=[],pages=[],pageHashes=new Set();
  for(let page=1;page<=1000;page++) {
    signal?.throwIfAborted();
    const result=await readPage(key,code,month,page,signal);
    if(observedService&&result.service&&observedService!==result.service)throw new Error('수집 중 API 서비스가 달라졌습니다.');
    observedService??=result.service;
    const pageHash=createHash('sha256').update(JSON.stringify(result.items)).digest('hex');
    if(result.items.length&&pageHashes.has(pageHash))throw new Error('수집 중 API 페이지가 반복되었습니다. 기존 월별 데이터는 유지됩니다.');
    pageHashes.add(pageHash);
    if(expected!==null&&expected!==result.total) throw new Error('수집 중 총 건수가 달라졌습니다. 다시 수집하세요.');
    expected=result.total;items.push(...result.items);pages.push([page,Buffer.from(result.xml)]);
    if(items.length===expected)break;
    if(!result.items.length||items.length>expected||page===1000)throw new Error('API 페이지가 누락되었거나 총 건수가 맞지 않습니다.');
    if(pause)await delay(pause,undefined,{signal});
  }
  return {items,pages,total:expected,service:observedService||'custom'};
}
export async function collectMonth(db,key,code,month,name,options={}) {
  if(!name.trim())throw new Error('지역 이름을 확인하세요.');
  const latest=()=>db.prepare('SELECT max(id) AS id FROM collection_runs WHERE region_code=? AND deal_month=?').get(code,month).id;
  const previousRunId=latest();
  const {items,pages,total:expected,service}=await fetchMolitMonth(key,code,month,{service:'detailed',...options});
  if(service==='detailed'&&items.some(item=>!item.aptSeq?.trim()))throw new Error('상세 API 응답의 공식 단지 ID가 누락됐습니다.');
  const {signal}=options;
  const rows=items.map(item=>{
    const values=normalize(item,code,month);
    return Object.fromEntries([...normalizedTradeFields,'raw_json'].map((field,index)=>[field,values[index]]));
  });signal?.throwIfAborted();
  db.exec('BEGIN IMMEDIATE');
  try {
    if(latest()!==previousRunId)throw new Error('수집 중 같은 월이 다른 실행에서 갱신됐습니다. 다시 수집하세요.');
    const previous=db.prepare('SELECT count(*) AS n FROM trades WHERE region_code=? AND deal_month=?').get(code,month).n;
    if((previous>0&&rows.length===0)||(previous>=100&&rows.length<previous/2))throw new Error(`데이터 검증 실패: 원천 건수 급감 ${code}/${month} (${previous} → ${rows.length}). 기존 월별 데이터는 유지됩니다.`);
    const observedAt=new Date().toISOString();
    const hasHistory=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='molit_trade_runs'").get();
    const previousId=db.prepare('SELECT COALESCE(MAX(id),0) AS id FROM collection_runs').get().id;
    const historyId=hasHistory?db.prepare('SELECT COALESCE(MAX(run_id),0) AS id FROM molit_trade_runs').get().id:0;
    const run=db.prepare('INSERT INTO collection_runs(id,region_code,region_name,deal_month,fetched_at,api_count,stored_count) VALUES (?,?,?,?,?,?,?)').run(Math.max(previousId,historyId)+1,code,name,month,observedAt,expected,rows.length);
    const insertPage=db.prepare('INSERT INTO api_pages VALUES (?,?,?)');
    pages.forEach(([page,xml])=>insertPage.run(run.lastInsertRowid,page,xml));
    storeMolitTradeSnapshot(db,rows,{code,month,runId:Number(run.lastInsertRowid),previousRunId,service,observedAt});
    verifyCollectedMonth(db,Number(run.lastInsertRowid));
    db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?)').run('published_at',new Date().toISOString());
    verifyMolitStorage(db);
    db.exec('COMMIT');
  } catch(e) {db.exec('ROLLBACK');throw e;}
  return rows.length;
}
export function verifyCollectedMonth(db,runId) {
  const run=db.prepare('SELECT * FROM collection_runs WHERE id=?').get(runId);
  if(!run)throw new Error('데이터 검증 실패: 수집 이력이 없습니다.');
  const scope=`원천 → DB ${run.region_code}/${run.deal_month}`;
  const pages=db.prepare('SELECT page_no,response_xml FROM api_pages WHERE run_id=? ORDER BY page_no').all(runId),rows=[],hashes=new Set();
  if(!pages.length)throw new Error(`데이터 검증 실패: ${scope} 원천 페이지 없음`);
  if(run.api_count===0&&pages.length!==1)throw new Error(`데이터 검증 실패: ${scope} 빈 원천 페이지 중복`);
  for(const [index,page] of pages.entries()){
    if(page.page_no!==index+1)throw new Error(`데이터 검증 실패: ${scope} 페이지 순서 누락`);
    const parsed=parsePage(Buffer.from(page.response_xml).toString());
    if(parsed.total!==run.api_count||(!parsed.items.length&&run.api_count!==0))throw new Error(`데이터 검증 실패: ${scope} 원천 총건수 불일치`);
    const digest=createHash('sha256').update(JSON.stringify(parsed.items)).digest('hex');
    if(parsed.items.length&&hashes.has(digest))throw new Error(`데이터 검증 실패: ${scope} 원천 페이지 반복`);
    hashes.add(digest);
    for(const item of parsed.items){const values=normalize(item,run.region_code,run.deal_month);rows.push({...Object.fromEntries(normalizedTradeFields.map((key,i)=>[key,values[i]])),raw:item});}
  }
  const archived=readMolitRunRows(db,runId);
  if(archived)assertTradeRows(rows,archived,{scope:scope+' 원문 이력',includeId:false});
  const current=!archived||db.prepare('SELECT run_id FROM molit_trade_heads WHERE region_code=? AND deal_month=?').get(run.region_code,run.deal_month)?.run_id===runId;
  const count=current?assertTradeRows(rows,db.prepare('SELECT * FROM trades WHERE region_code=? AND deal_month=?').iterate(run.region_code,run.deal_month),{scope,includeId:false}):archived.length;
  if(current&&archived)assertTradeRows(archived,db.prepare('SELECT * FROM trades WHERE region_code=? AND deal_month=?').iterate(run.region_code,run.deal_month),{scope:scope+' 거래 ID'});
  if(count!==run.api_count||count!==run.stored_count)throw new Error(`데이터 검증 실패: ${scope} 수집 이력 건수 불일치`);
  return {rows:count,pages:pages.length};
}

export function verifyCollectionHistory(db) {
  if(!db.prepare("SELECT name FROM sqlite_master WHERE name='collection_runs'").get())return {months:0,rows:0,pages:0};
  verifyMolitStorage(db);
  const result={months:0,rows:0,pages:0};
  for(const {id} of db.prepare('SELECT max(id) AS id FROM collection_runs GROUP BY region_code,deal_month').all()){
    const checked=verifyCollectedMonth(db,id);result.months++;result.rows+=checked.rows;result.pages+=checked.pages;
  }
  return result;
}
export function collectionTasks(selected,months) {return [...new Map(selected.flatMap(r=>months.map(month=>[`${r.region_code}/${month}`,{code:r.region_code,name:r.region_name,month}]))).values()];}
