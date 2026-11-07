import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {BrowserListingError,BrowserListingPages} from './naver-browser-collector.mjs';
import {LISTING_ERRORS} from '../src/naver-listings.mjs';
import {browserCaptureGroup} from './naver-browser-capture.mjs';

export async function createSystemChromeListingSource({python=process.env.NAVER_BROWSER_PYTHON,connections=[],firstPageOnly=false,spawnWorker=spawn,timeoutMs=90000}={}) {
  if(!Array.isArray(connections)||connections.length>1000||new Set(connections.map(r=>r?.id)).size!==connections.length||connections.some(r=>typeof r?.id!=='string'||r.complexNo!==null&&!/^[1-9]\d{0,11}$/.test(r.complexNo)))throw new Error('매물 단지 연결 파일을 확인하세요.');
  const byFavorite=new Map(connections.filter(r=>r.complexNo).map(r=>[r.id,r.complexNo]));
  const observations=new Map();
  if(!python)throw new BrowserListingError('browser_unavailable');
  const child=spawnWorker(python,['-u',fileURLToPath(new URL('../scripts/naver-system-chrome.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
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
  return {
    async collect(target,{complexNo,signal}={}) {
      complexNo??=byFavorite.get(target.favorite.id);
      if(!complexNo)throw new BrowserListingError('unmatched');
      signal?.throwIfAborted();
      const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
      try {
        let observation=observations.get(complexNo);
        if(!observation){const result=receive();child.stdin.write(JSON.stringify({complexNo,firstPageOnly,timeoutSeconds:Math.floor(timeoutMs/1000)-10})+'\n');observation={payload:await result,observedAt:new Date().toISOString()};if(!observation.payload.errorCode)observations.set(complexNo,observation);}
        const {payload,observedAt}=observation;
        signal?.throwIfAborted();
        if(payload.errorCode){if(!Object.hasOwn(LISTING_ERRORS,payload.errorCode))throw new BrowserListingError('invalid_response');throw new BrowserListingError(payload.errorCode);}
        if(!/^[1-9]\d*$/.test(payload.complexNo)||complexNo&&payload.complexNo!==complexNo||!Array.isArray(payload.responses))throw new BrowserListingError('invalid_response');
        const pages=new BrowserListingPages();
        for(const response of payload.responses){if(new URL(response.url).origin!=='https://new.land.naver.com')throw new BrowserListingError('invalid_response');pages.consume(response.url,response.status,response.payload);}
        if(payload.complexDetail)pages.consume(`https://new.land.naver.com/api/complexes/${payload.complexNo}`,200,{complexDetail:payload.complexDetail});
        if(firstPageOnly&&!pages.ready(payload.complexNo)){
          const state=pages.complexes.get(payload.complexNo),first=state?.pages.get(1);
          if(!first)throw new BrowserListingError('incomplete');
          const articles=first.articleList.filter(a=>(!a.realEstateTypeCode||a.realEstateTypeCode==='APT')&&['A1','B1','B2'].includes(a.tradeTypeCode));
          if(!articles.length)throw new BrowserListingError('incomplete');
          if(!state.detail?.complexDetail)throw new BrowserListingError('invalid_response');
          return {...browserCaptureGroup({version:1,favorite:target.favorite,complexDetail:state.detail.complexDetail,sourceUrl:`https://new.land.naver.com/complexes/${payload.complexNo}`,observedAt,articles}),areaSource:'list'};
        }
        return {...pages.finish(target.favorite,payload.complexNo,new Date(observedAt)),areaSource:'list'};
      }finally{signal?.removeEventListener('abort',abort);}
    },
    async close(){if(closed)return;closed=true;lines.close();if(!dead){child.stdin.end(JSON.stringify({close:true})+'\n');const timer=setTimeout(()=>child.kill(),3000);timer.unref();child.once('exit',()=>clearTimeout(timer));}}
  };
}
