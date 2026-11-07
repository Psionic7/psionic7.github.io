import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {BrowserListingError,BrowserListingPages} from './naver-browser-collector.mjs';
import {LISTING_ERRORS,validComplexNo} from '../src/naver-listings.mjs';
import {browserCaptureGroup} from './naver-browser-capture.mjs';
import {listingSearchNames} from './naver-listing-names.mjs';

export async function createSystemChromeListingSource({python=process.env.NAVER_BROWSER_PYTHON,connections=[],firstPageOnly=false,discover=false,headless=false,baseUrl='https://new.land.naver.com',spawnWorker=spawn,timeoutMs=90000}={}) {
  const origin=new URL(baseUrl).origin;
  if(baseUrl!==origin||origin!=='https://new.land.naver.com'&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))throw Error('매물 브라우저 주소를 확인하세요.');
  if(!Array.isArray(connections)||connections.length>1000||new Set(connections.map(r=>r?.id)).size!==connections.length||connections.some(r=>typeof r?.id!=='string'||r.complexNo!==null&&!/^[1-9]\d{0,11}$/.test(r.complexNo)))throw new Error('매물 단지 연결 파일을 확인하세요.');
  const byFavorite=new Map(connections.filter(r=>r.complexNo).map(r=>[r.id,r.complexNo]));
  const observations=new Map();
  if(!python)throw new BrowserListingError('browser_unavailable');
  const child=spawnWorker(python,['-u',fileURLToPath(new URL('../scripts/naver-system-chrome.py',import.meta.url)),'--base-url',baseUrl],{windowsHide:true,stdio:['pipe','pipe',process.env.NAVER_BROWSER_DIAGNOSTICS==='1'?'inherit':'ignore'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',NAVER_CHROME_HEADLESS:headless?'1':'0'}});
  const lines=createInterface({input:child.stdout});
  let pending,dead=false,closed=false;
  const failure=()=>{dead=true;pending?.reject(new BrowserListingError('browser_unavailable'));pending=null;};
  child.on('error',failure);child.on('exit',failure);
  lines.on('line',line=>{
    if(!pending)return;
    try{const value=JSON.parse(line);pending.resolve(value);}catch{pending.reject(new BrowserListingError('invalid_response'));}
    pending=null;
  });
  const receive=()=>new Promise((resolve,reject)=>{
    if(dead)return reject(new BrowserListingError('browser_unavailable'));
    const timer=setTimeout(()=>{pending=null;child.kill();reject(new BrowserListingError('timeout'));},timeoutMs);
    pending={resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};
  });
  try{const ready=await receive();if(ready.ready!==true)throw new BrowserListingError('browser_unavailable');}
  catch(error){child.kill();throw error;}
  const request=async input=>{
    const result=receive();child.stdin.write(JSON.stringify({...input,timeoutSeconds:Math.floor(timeoutMs/1000)-10})+'\n');
    const payload=await result;
    if(payload.errorCode)throw new BrowserListingError(Object.hasOwn(LISTING_ERRORS,payload.errorCode)?payload.errorCode:'invalid_response');
    return payload;
  };
  async function collectKnown(target,complexNo,signal) {
      signal?.throwIfAborted();
      const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
      try {
        let observation=observations.get(complexNo);
        if(!observation){observation={payload:await request({complexNo,firstPageOnly}),observedAt:new Date().toISOString()};observations.set(complexNo,observation);}
        const {payload,observedAt}=observation;
        signal?.throwIfAborted();
        if(payload.errorCode){if(!Object.hasOwn(LISTING_ERRORS,payload.errorCode))throw new BrowserListingError('invalid_response');throw new BrowserListingError(payload.errorCode);}
        if(!/^[1-9]\d*$/.test(payload.complexNo)||complexNo&&payload.complexNo!==complexNo||!Array.isArray(payload.responses))throw new BrowserListingError('invalid_response');
        const pages=new BrowserListingPages();
        for(const response of payload.responses){if(new URL(response.url).origin!==origin)throw new BrowserListingError('invalid_response');pages.consume(response.url,response.status,response.payload);}
        if(payload.complexDetail)pages.consume(`https://new.land.naver.com/api/complexes/${payload.complexNo}`,200,{complexDetail:payload.complexDetail});
        if(firstPageOnly&&!pages.ready(payload.complexNo)){
          const state=pages.complexes.get(payload.complexNo),first=state?.pages.get(1);
          if(!first)throw new BrowserListingError('incomplete');
          const articles=first.articleList.filter(a=>(!a.realEstateTypeCode||a.realEstateTypeCode==='APT')&&a.tradeTypeCode==='A1');
          if(!articles.length)throw new BrowserListingError('incomplete');
          if(!state.detail?.complexDetail)throw new BrowserListingError('invalid_response');
          return {...browserCaptureGroup({version:1,favorite:target.favorite,complexDetail:state.detail.complexDetail,sourceUrl:`https://new.land.naver.com/complexes/${payload.complexNo}`,observedAt,articles}),areaSource:'list'};
        }
        return {...pages.finish(target.favorite,payload.complexNo,new Date(observedAt)),areaSource:'list'};
      }catch(error){signal?.throwIfAborted();throw error;}finally{signal?.removeEventListener('abort',abort);}
  }
  return {
    async collect(target,{complexNo,signal}={}) {
      complexNo??=target.complexNo||byFavorite.get(target.favorite.id);
      if(complexNo)return collectKnown(target,complexNo,signal);
      if(!discover)throw new BrowserListingError('unmatched');
      signal?.throwIfAborted();
      if(typeof target.query!=='string'||!target.query.trim()||target.query.length>300)throw new BrowserListingError('unmatched');
      const names=listingSearchNames(target.favorite);
      const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
      let result;
      try{result=await request({discover:true,query:target.query,names});}
      catch(error){signal?.throwIfAborted();throw error;}
      finally{signal?.removeEventListener('abort',abort);}
      if(!Array.isArray(result.candidates)||result.candidates.length>8||result.candidates.some(c=>!validComplexNo(c?.complexNo)||typeof c.name!=='string'||c.name.length>300))throw new BrowserListingError('invalid_response');
      const normalize=name=>name.replace(/[\s()[\]·.,_-]|아파트/g,'').toLowerCase();
      const candidates=[...new Map(result.candidates.filter(c=>names.map(normalize).some(name=>name===normalize(c.name)||name.length>=4&&normalize(c.name).includes(name))).map(c=>[c.complexNo,c])).values()];
      const matches=[];
      for(const candidate of candidates){
        signal?.throwIfAborted();
        try{matches.push(await collectKnown(target,candidate.complexNo,signal));}
        catch(error){if(error.code!=='address_mismatch')throw error;}
      }
      if(matches.length!==1)throw new BrowserListingError('unmatched');
      byFavorite.set(target.favorite.id,matches[0].complexNo);return matches[0];
    },
    async close(){if(closed)return;closed=true;lines.close();if(!dead){child.stdin.end(JSON.stringify({close:true})+'\n');const timer=setTimeout(()=>child.kill(),3000);timer.unref();child.once('exit',()=>clearTimeout(timer));}}
  };
}
