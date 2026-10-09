import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {setTimeout as delay} from 'node:timers/promises';
import {localEnv,paths,serviceKey} from './storage.mjs';
export const REGISTRY_URL='https://apis.data.go.kr/1613000/BldRgstHubService/';
export const REGISTRY_DATASETS=['getBrTitleInfo','getBrBasisOulnInfo','getBrRecapTitleInfo','getBrAtchJibunInfo','getBrFlrOulnInfo'];
export const registryKey=(filename=paths.env)=>process.env.BUILDING_REGISTER_SERVICE_KEY||localEnv(filename).BUILDING_REGISTER_SERVICE_KEY||serviceKey(filename);
const parser=new XMLParser({parseTagValue:false,parseAttributeValue:false,trimValues:false,ignoreAttributes:true,isArray:(_tag,p)=>p==='response.body.items.item'});
export function parseRegistryPage(text){
 let doc;try{if(text.trim().startsWith('{'))doc=JSON.parse(text.trim(),(_key,value,context)=>typeof value==='number'&&context?.source?context.source:value);else{if(/<!\s*(DOCTYPE|ENTITY)/i.test(text)||XMLValidator.validate(text)!==true)throw new Error();doc=parser.parse(text);}}catch{throw new Error('건축물대장 응답 형식을 확인하세요.');}
 const r=doc?.response;if(!r)throw new Error('건축물대장 응답 형식을 확인하세요.');if(!['0','00','000'].includes(String(r?.header?.resultCode).trim()))throw new Error('건축물대장 API 오류 ('+String(r?.header?.resultCode).trim()+'). 활용 승인·인증키·호출 한도를 확인하세요.');
 const n=Number(r.body?.totalCount);if(!Number.isSafeInteger(n)||n<0)throw new Error('건축물대장 전체 건수가 올바르지 않습니다.');
 const raw=r.body?.items?.item,items=raw==null||raw===''?[]:Array.isArray(raw)?raw:[raw];
 if(items.some(p=>!p||typeof p!=='object'||Array.isArray(p)||Object.values(p).some(v=>v!==null&&!['string','number'].includes(typeof v))))throw new Error('건축물대장 필드 형식이 올바르지 않습니다.');
 return {total:n,items:items.map(p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,String(v??'').trim()])))};
}
export async function fetchRegistryPage(key,legalCode,dataset,page,{signal,fetcher=fetch,onDiagnostic,retryDelay=2000}={}){
 if(!REGISTRY_DATASETS.includes(dataset)||!/^\d{10}$/.test(legalCode)||!key)throw new Error('건축물대장 키·법정동 코드를 확인하세요.');
 let decoded=key;try{decoded=decodeURIComponent(key);}catch{}const url=new URL(dataset,REGISTRY_URL);
 // No parcel/date filters: enumerate the whole legal region independently of transaction history.
 const params={serviceKey:decoded,sigunguCd:legalCode.slice(0,5),bjdongCd:legalCode.slice(5),numOfRows:'100',pageNo:String(page)};
 url.search=new URLSearchParams({serviceKey:decoded,sigunguCd:legalCode.slice(0,5),bjdongCd:legalCode.slice(5),numOfRows:'100',pageNo:String(page),_type:'xml'}).toString();
 for(let attempt=0;attempt<8;attempt++){
 url.search=new URLSearchParams({...params,_type:attempt%2?'json':'xml',...(attempt?{_retry:String(Date.now())+'-'+attempt}:{})}).toString();
 signal?.throwIfAborted();let response;
 try{response=await fetcher(url,{headers:{Connection:'close','Cache-Control':'no-cache'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});}catch{signal?.throwIfAborted();if(attempt===7)throw new Error('건축물대장 API 연결 실패');await delay(Math.min(16000,retryDelay*2**attempt),undefined,{signal});continue;}
 if(!response.ok){if([429,500,502,503,504].includes(response.status)&&attempt<7){await delay(Math.min(16000,retryDelay*2**attempt),undefined,{signal});continue;}throw new Error(`건축물대장 요청 실패 (HTTP ${response.status}). 해당 서비스 활용 승인과 인증키를 확인하세요.`);}
 let raw;try{raw=await response.text();}catch{signal?.throwIfAborted();if(attempt===5)throw new Error('건축물대장 응답을 읽지 못했습니다.');await delay(Math.min(16000,retryDelay*2**attempt),undefined,{signal});continue;}
 for(const value of new Set([key,decoded,encodeURIComponent(decoded)]))if(value)raw=raw.replaceAll(value,'[REDACTED]');
 try{return parseRegistryPage(raw);}catch(error){onDiagnostic?.({dataset,page,attempt,error:error.message,body:raw});if((/응답 형식|API 오류 \((01|04|05|23)\)/.test(error.message))&&attempt<5){await delay(Math.min(16000,retryDelay*2**attempt),undefined,{signal});continue;}throw error;}
 }
}
export async function readRegistryRegion(key,legalCode,{signal,fetcher=fetchRegistryPage,onProgress,pause=200,concurrency=2}={}){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw new Error('건축물대장 동시 조회 수가 올바르지 않습니다.');
 const result={};for(const dataset of REGISTRY_DATASETS){const pages=[],items=[],seenPages=new Set();let total=null;
 const add=(current,page)=>{if(total!==null&&total!==current.total)throw new Error('건축물대장 전체 건수가 수집 중 변경됐습니다. 기존 목록을 유지합니다.');total=current.total;const signature=JSON.stringify(current.items);if(current.items.length&&seenPages.has(signature))throw new Error('건축물대장 페이지가 반복돼 전체 수집을 확인할 수 없습니다.');seenPages.add(signature);items.push(...current.items);pages.push({page,total,items:current.items});if(items.length>total||!current.items.length&&total>0)throw new Error('건축물대장 페이지 누락 또는 전체 건수 불일치');onProgress?.({dataset,page,completed:items.length,total});};
 const first=await fetcher(key,legalCode,dataset,1,{signal});add(first,1);const pageSize=first.items.length,count=pageSize?Math.ceil(total/pageSize):1;if(count>10000)throw new Error('건축물대장 전체 페이지 수가 안전 범위를 초과했습니다.');
 for(let page=2;page<=count;page+=concurrency){signal?.throwIfAborted();const numbers=Array.from({length:Math.min(concurrency,count-page+1)},(_,n)=>page+n),settled=await Promise.allSettled(numbers.map(n=>fetcher(key,legalCode,dataset,n,{signal})));const failure=settled.find(p=>p.status==='rejected');if(failure)throw failure.reason;const batch=settled.map(p=>p.value);batch.forEach((p,i)=>add(p,numbers[i]));if(pause&&batch.some(p=>!p.cached))await delay(pause,undefined,{signal});}
 if(items.length!==total)throw new Error('건축물대장 페이지 누락 또는 전체 건수 불일치');
 if(dataset==='getBrTitleInfo'&&(items.some(p=>!p.mgmBldrgstPk||p.sigunguCd+p.bjdongCd!==legalCode)||new Set(items.map(p=>p.mgmBldrgstPk)).size!==items.length))throw new Error('건축물 식별자 중복 또는 조회 지역 불일치. 기존 목록을 유지합니다.');
 result[dataset]={total,items,pages};}return result;
}

export const text=value=>String(value??'').trim();
export const numeric=value=>{const s=text(value),n=Number(s);return s&&Number.isFinite(n)&&n>=0?n:null;};
export function approvalDate(value){const s=text(value);if(!/^\d{8}$/.test(s))return null;const d=new Date(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6)}`);return Number.isFinite(+d)&&d.toISOString().slice(0,10).replaceAll('-','')===s&&s.slice(0,4)>='1800'?d.toISOString().slice(0,10):null;}
export function parcel(row,prefix=''){
 const code=text(row[prefix?prefix+'SigunguCd':'sigunguCd'])+text(row[prefix?prefix+'BjdongCd':'bjdongCd']),kind=text(row[prefix?prefix+'PlatGbCd':'platGbCd']),main=text(row[prefix?prefix+'Bun':'bun']),sub=text(row[prefix?prefix+'Ji':'ji']);
 if(!/^\d{10}$/.test(code)||!['0','1'].includes(kind)||!/^\d{1,4}$/.test(main)||!/^\d{1,4}$/.test(sub)||+main<1)return null;
 const jibun=(kind==='1'?'산 ':'')+Number(main)+(Number(sub)?'-'+Number(sub):'');return{pnu:code+(kind==='1'?'2':'1')+main.padStart(4,'0')+sub.padStart(4,'0'),legal_code:code,jibun};
}
export function registryCoordinateCodes(row){
 // naBjdongCd is the road-address sector code, not Juso's legal-region admCd.
 const admCd=text(row.sigunguCd)+text(row.bjdongCd);
 const c={admCd,rnMgtSn:text(row.naRoadCd),udrtYn:text(row.naUgrndCd),buldMnnm:String(Number(row.naMainBun)),buldSlno:String(Number(row.naSubBun))};
 return /^\d{10}$/.test(c.admCd)&&/^\d{12}$/.test(c.rnMgtSn)&&/^[01]$/.test(c.udrtYn)&&/^\d{1,5}$/.test(c.buldMnnm)&&+c.buldMnnm>0&&/^\d{1,5}$/.test(c.buldSlno)?c:null;
}
export const isResidentialClassification = value => ['apartment', 'senior_housing'].includes(value);
export function buildingClassification(row,floors=[]){
 if(text(row.mainAtchGbCd)==='1')return 'other'; // Ancillary guardhouses/garages remain linked buildings, not apartment dwellings.
 const rows=[row,...floors],uses=rows.map(p=>[p.mainPurpsCdNm,p.etcPurps].map(text).join(' '));
 if(uses.some(s=>/노인복지주택/.test(s)))return 'senior_housing';
 if(rows.some(p=>text(p.mainPurpsCd)==='02001')||uses.some(s=>/아파트/.test(s)))return 'apartment';
 if(uses.some(s=>/공동주택/.test(s))&&!uses.some(s=>/연립|다세대|기숙사/.test(s)))return 'review';
 return 'other';
}
