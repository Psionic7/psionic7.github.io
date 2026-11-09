import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {LISTING_ERRORS,LISTING_TRADE_TYPE,complexUrl,validListingGroup,apartmentListingType} from '../src/naver-listings.mjs';
import {normalizeArticle,verifyComplex,verifyComplexEvidence} from './naver-listings.mjs';
import {housingObservation} from './housing-location.mjs';

export class BrowserListingError extends Error {
  constructor(code){super(LISTING_ERRORS[code]);this.code=code;}
}
const fail=code=>{throw new BrowserListingError(code);};

export class BrowserListingPages {
  constructor({maxPages=2000}={}){this.complexes=new Map();this.maxPages=maxPages;this.error=null;}
  consume(url,status,payload) {
    const parsed=new URL(url),detail=parsed.pathname.match(/^\/api\/complexes\/([1-9]\d*)$/),articles=parsed.pathname.match(/^\/api\/articles\/complex\/([1-9]\d*)$/);
    if(!detail&&!articles)return;
    if(status===429)fail('rate_limited');
    if(status===401||status===403)fail('unauthorized');
    if(status<200||status>=300)fail('unavailable');
    if(!payload||typeof payload!=='object'||Array.isArray(payload))fail('invalid_response');
    const id=(detail||articles)[1];
    if(!this.complexes.has(id))this.complexes.set(id,{detail:null,pages:new Map(),signature:null});
    const state=this.complexes.get(id);
    if(detail){state.detail=payload;return;}
    if(parsed.searchParams.get('sameAddressGroup')!=='false'||parsed.searchParams.get('tradeType')!==LISTING_TRADE_TYPE||parsed.searchParams.get('realEstateType')!=='APT')return;
    const page=Number(parsed.searchParams.get('page')||1),signature=new URLSearchParams(parsed.searchParams);signature.delete('page');signature.sort();
    if(!Number.isInteger(page)||page<1||page>this.maxPages)fail('incomplete');
    if(!Array.isArray(payload.articleList)||payload.articleList.length>1000||typeof payload.isMoreData!=='boolean'||payload.isMoreData&&payload.articleList.length===0||page>1&&payload.articleList.length===0)fail('invalid_response');
    if(state.signature!==signature.toString()){state.pages.clear();state.signature=signature.toString();}
    const old=state.pages.get(page);
    if(old&&JSON.stringify(old)!==JSON.stringify(payload))fail('incomplete');
    state.pages.set(page,payload);
  }
  ready(id) {
    const state=this.complexes.get(id);if(!state?.detail||!state.pages.size)return false;
    const last=Math.max(...state.pages.keys());
    return state.pages.get(last).isMoreData===false&&Array.from({length:last},(_,i)=>i+1).every(page=>state.pages.has(page));
  }
  finish(favorite,id,now=new Date(),location) {
    if(!this.ready(id))fail('incomplete');
    const state=this.complexes.get(id),seen=new Set(),articles=[];
    for(const [page,payload] of [...state.pages].sort((a,b)=>a[0]-b[0])) {
      if(page<state.pages.size&&!payload.isMoreData)fail('incomplete');
      for(const raw of payload.articleList) {
        const articleId=String(raw?.articleNo||'');
        if(!/^[1-9]\d{0,11}$/.test(articleId)||seen.has(articleId)||raw.complexNo!==undefined&&String(raw.complexNo)!==id)fail('incomplete');
        seen.add(articleId);if(seen.size>20000)fail('incomplete');
        if(!apartmentListingType(raw.realEstateTypeCode)||raw.tradeTypeCode!==LISTING_TRADE_TYPE)continue;
        const article=normalizeArticle(raw);if(article)articles.push(article);
      }
    }
    const verification=verifyComplexEvidence({...state.detail,article_building_dongs:articles.map(article=>article.building)},favorite,id,location),complexName=verification.complexName,collectedAt=new Date(now).toISOString();
    const sourceUrl=complexUrl(id),group={favorite,complexNo:id,complexName,tradeType:LISTING_TRADE_TYPE,status:'ready',attemptedAt:collectedAt,collectedAt,errorCode:null,articles,collectionMethod:'browser',coverage:'complete',pageCount:state.pages.size,sourceUrl,observation:housingObservation(state.detail.complexDetail,{sourceUrl,observedAt:collectedAt,verificationMethod:verification.method,buildingWitnesses:verification.buildingWitnesses})};
    if(!validListingGroup(group))fail('invalid_response');return group;
  }
}

export async function launchListingBrowser({headless=true}={}) {
  const local=fileURLToPath(new URL('../local/playwright-browsers',import.meta.url));
  if(!process.env.PLAYWRIGHT_BROWSERS_PATH&&fs.existsSync(local))process.env.PLAYWRIGHT_BROWSERS_PATH=local;
  try{
    const {chromium}=await import('playwright');return await chromium.launch({headless});
  }catch{fail('browser_unavailable');}
}

export async function createBrowserListingSource({browser,page,baseUrl='https://new.land.naver.com',headless=true,timeoutMs=30000,targetTimeoutMs=120000,scrollGapMs=1500,maxScrolls=2000,now=()=>Date.now()}={}) {
  let owned=false;
  if(!page){browser??=await launchListingBrowser({headless});owned=true;const context=await browser.newContext({locale:'ko-KR',timezoneId:'Asia/Seoul'});page=await context.newPage();}
  page.setDefaultTimeout(timeoutMs);
  const origin=new URL(baseUrl).origin;
  let initialized=false;
  async function collect(target,{complexNo,signal}={}) {
    signal?.throwIfAborted();
    const {favorite}=target,pages=new BrowserListingPages({maxPages:maxScrolls+1}),pending=new Set(),requests=new Set(),started=now();let observedError=null,capturing=false;
    const requestListener=request=>{if(capturing&&/^\/api\/(articles\/complex|complexes)\/[1-9]\d*$/.test(new URL(request.url()).pathname))requests.add(request);};
    const responseListener=response=>{
      if(!requests.delete(response.request()))return;
      const url=new URL(response.url());
      if(url.origin!==origin||!/^\/api\/(articles\/complex|complexes)\/[1-9]\d*$/.test(url.pathname))return;
      if(url.pathname.startsWith('/api/articles/')&&(url.searchParams.get('tradeType')!==LISTING_TRADE_TYPE||url.searchParams.get('realEstateType')!=='APT'))return;
      const task=(async()=>{
        try{
          if(response.status()>=400){pages.consume(response.url(),response.status(),{});return;}
          if(!response.headers()['content-type']?.includes('application/json'))fail('invalid_response');
          pages.consume(response.url(),response.status(),await response.json());
        }catch(error){observedError=Object.hasOwn(LISTING_ERRORS,error.code)?error:new BrowserListingError('invalid_response');}
      })();pending.add(task);task.finally(()=>pending.delete(task));
    };
    page.on('request',requestListener);page.on('response',responseListener);
    const abort=()=>{void page.close().catch(()=>{});};signal?.addEventListener('abort',abort,{once:true});
    const check=async()=>{
      signal?.throwIfAborted();
      await Promise.all([...pending]);if(observedError)throw observedError;
      if(now()-started>targetTimeoutMs)fail('timeout');
      const body=await page.locator('body').innerText();
      if(/자동입력\s*방지|비정상적인\s*접근|접근이?\s*제한|Too Many Requests|captcha/i.test(body))fail('blocked');
    };
    try {
      if(!initialized){
        const home=await page.goto(baseUrl+'/',{waitUntil:'domcontentloaded',timeout:timeoutMs});
        if(home?.status()===429)fail('rate_limited');if(home?.status()===401||home?.status()===403)fail('unauthorized');
        if(home?.status()===404||new URL(page.url()).pathname==='/404')fail('site_unavailable');
        await page.getByRole('button',{name:'단지, 지역검색',exact:true}).waitFor({state:'visible',timeout:timeoutMs});initialized=true;
      }
      const url=complexNo?`${baseUrl}/complexes/${complexNo}?a=APT&b=A1&e=RETAIL`:baseUrl+'/';
      capturing=Boolean(complexNo);
      const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:timeoutMs});
      if(response?.status()===429)fail('rate_limited');if(response?.status()===403||response?.status()===401)fail('unauthorized');
      if(response?.status()===404||new URL(page.url()).pathname==='/404')fail(complexNo?'unmatched':'site_unavailable');
      if(!complexNo) {
        await page.getByRole('button',{name:'단지, 지역검색',exact:true}).click();
        await page.locator('#land_search').fill(target.query);
        await page.locator('#land_search').press('Enter');
      }
      try{await page.waitForURL(url=>/\/complexes\/[1-9]\d*/.test(url.pathname),{timeout:timeoutMs});}
      catch{await check();fail('unmatched');}
      const current=new URL(page.url()),id=current.origin===origin?current.pathname.match(/^\/complexes\/([1-9]\d{0,11})\/?$/)?.[1]:null;if(!id)fail('unmatched');
      if(complexNo&&id!==complexNo)fail('address_mismatch');
      if(!complexNo){capturing=true;await page.goto(`${baseUrl}/complexes/${id}?a=APT&b=A1&e=RETAIL`,{waitUntil:'domcontentloaded',timeout:timeoutMs});}
      await page.locator('#complexTitle').waitFor({state:'visible',timeout:timeoutMs});
      const grouped=page.locator('#address_group2');
      if(await grouped.count())await grouped.setChecked(false,{force:true});
      let lastCount=-1,unchanged=0;
      for(let iteration=0;iteration<=maxScrolls;iteration++) {
        await check();
        if(pages.ready(id))return pages.finish(favorite,id,new Date(now()));
        const state=pages.complexes.get(id);
        if(state?.detail)verifyComplex(state.detail,favorite,id);
        const count=state?.pages.size||0;unchanged=count===lastCount?unchanged+1:0;lastCount=count;
        if(unchanged>Math.ceil(timeoutMs/Math.max(scrollGapMs,100)))fail('incomplete');
        const scroller=page.locator('.item_list--article');
        if(await scroller.count())await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
        await sleep(Math.max(scrollGapMs,50));
      }
      fail('incomplete');
    }catch(error){
      signal?.throwIfAborted();
      if(Object.hasOwn(LISTING_ERRORS,error.code))throw error;
      await check();fail(error.name==='TimeoutError'?'timeout':'unavailable');
    }finally{signal?.removeEventListener('abort',abort);page.off('request',requestListener);page.off('response',responseListener);await Promise.all([...pending]);}
  }
  return {collect,close:async()=>{if(owned)await browser.close();}};
}
