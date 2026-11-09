import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {BrowserListingError,BrowserListingPages} from './naver-browser-collector.mjs';
import {LISTING_ERRORS,validComplexNo,apartmentListingType} from '../src/naver-listings.mjs';
import {browserCaptureGroup} from './naver-browser-capture.mjs';
import {listingSearchNames,listingFavoritePhase,listingPhaseMatches} from './naver-listing-names.mjs';
import {verifyComplex,verifyComplexEvidence} from './naver-listings.mjs';
import {housingMapViewport,housingPoint,housingLocationEvidence,housingObservation} from './housing-location.mjs';

export async function createSystemChromeListingSource({python=process.env.NAVER_BROWSER_PYTHON,connections=[],firstPageOnly=false,discover=false,headless=false,baseUrl='https://new.land.naver.com',spawnWorker=spawn,timeoutMs=90000}={}) {
  const origin=new URL(baseUrl).origin;
  if(baseUrl!==origin||origin!=='https://new.land.naver.com'&&!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin))throw Error('매물 브라우저 주소를 확인하세요.');
  if(!Array.isArray(connections)||connections.length>1000||new Set(connections.map(r=>r?.id)).size!==connections.length||connections.some(r=>typeof r?.id!=='string'||r.complexNo!==null&&!/^[1-9]\d{0,11}$/.test(r.complexNo)))throw new Error('매물 단지 연결 파일을 확인하세요.');
  const byFavorite=new Map(connections.filter(r=>r.complexNo).map(r=>[r.id,r.complexNo]));
  const observations=new Map();
  const discoveries=new Map();
  const details=new Map();
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
          const articles=first.articleList.filter(a=>apartmentListingType(a.realEstateTypeCode)&&a.tradeTypeCode==='A1');
          if(!articles.length)throw new BrowserListingError('incomplete');
          if(!state.detail?.complexDetail)throw new BrowserListingError('invalid_response');
          return {...browserCaptureGroup({version:1,favorite:target.favorite,complexDetail:state.detail.complexDetail,sourceUrl:`https://new.land.naver.com/complexes/${payload.complexNo}`,observedAt,articles},{location:target.location}),areaSource:'list'};
        }
        return {...pages.finish(target.favorite,payload.complexNo,new Date(observedAt),target.location),areaSource:'list'};
      }catch(error){signal?.throwIfAborted();throw error;}finally{signal?.removeEventListener('abort',abort);}
  }
  async function inspectKnown(target,complexNo,signal) {
    signal?.throwIfAborted();
    const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
    try{
      let detail=details.get(complexNo);
      if(!detail){detail=await request({inspect:true,complexNo});details.set(complexNo,detail);}
      signal?.throwIfAborted();
      let verification;
      try{verification=verifyComplexEvidence(detail,target.favorite,complexNo,target.location);}
      catch(error){
        if(!error.needsBuildingEvidence)throw error;
        // A provider complex may span roads. Only actual full APT ads can
        // supply the registered building evidence absent from its first page.
        return await collectKnown(target,complexNo,signal);
      }
      const sourceUrl=`https://new.land.naver.com/complexes/${complexNo}`;
      return {favorite:target.favorite,complexNo,complexName:verification.complexName,sourceUrl,observation:housingObservation(detail.complexDetail,{sourceUrl,observedAt:new Date().toISOString(),verificationMethod:verification.method,buildingWitnesses:verification.buildingWitnesses})};
    }finally{signal?.removeEventListener('abort',abort);}
  }
  async function execute(target,{complexNo,signal,metadataOnly=false}={}) {
      const fetchKnown=metadataOnly?inspectKnown:collectKnown;
      complexNo??=target.complexNo||byFavorite.get(target.favorite.id);
      if(complexNo){try{return await fetchKnown(target,complexNo,signal);}catch(error){if(error.code!=='address_mismatch'||!discover||!housingMapViewport(target.location))throw error;byFavorite.delete(target.favorite.id);}}
      if(!discover)throw new BrowserListingError('unmatched');
      signal?.throwIfAborted();
      const viewport=housingMapViewport(target.location);
      if(!viewport&&(typeof target.query!=='string'||!target.query.trim()||target.query.length>300))throw new BrowserListingError('unmatched');
      const names=listingSearchNames(target.favorite);
      const phase=listingFavoritePhase(target.favorite);
      const normalize=name=>name.replace(/[\s()[\]·.,_-]|아파트/g,'').toLowerCase();
      const queries=[...new Map([target.query,...names.map(name=>`${target.favorite.dong} ${name.replace(/아파트|[()[\]]/g,'')}`)].filter(query=>typeof query==='string'&&query.trim()&&query.length<=300).map(query=>[query.replace(/\s/g,''),query])).values()].slice(0,4);
      let searchError;
      const inspectCandidates=async candidates=>{
        const matches=[];
        for(const candidate of candidates){
          signal?.throwIfAborted();
          try{
            let detail=details.get(candidate.complexNo);
            if(!detail){const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});try{detail=await request({inspect:true,complexNo:candidate.complexNo});details.set(candidate.complexNo,detail);}finally{signal?.removeEventListener('abort',abort);}}
            signal?.throwIfAborted();
            try{verifyComplex(detail,target.favorite,candidate.complexNo,target.location);}
            catch(error){if(!error.needsBuildingEvidence)throw error;await collectKnown(target,candidate.complexNo,signal);}
            matches.push(candidate.complexNo);
          }catch(error){signal?.throwIfAborted();if(error.code!=='address_mismatch')throw error;}
        }
        if(matches.length>1)throw new BrowserListingError('unmatched');
        return matches;
      };
      const collectMatch=async id=>{const group=await fetchKnown(target,id,signal);byFavorite.set(target.favorite.id,group.complexNo);return group;};
      if(viewport){
        const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
        let result;
        try{const input={discover:true,location:viewport,phase},key=JSON.stringify(input);result=discoveries.get(key);if(!result){result=await request(input);discoveries.set(key,result);}}
        catch(error){signal?.throwIfAborted();if(['unavailable','timeout','unmatched'].includes(error.code))searchError=error;else throw error;}
        finally{signal?.removeEventListener('abort',abort);}
        if(result){
          if(!Array.isArray(result.candidates)||result.candidates.length>2000||result.candidates.some(c=>!validComplexNo(c?.complexNo)||typeof c.name!=='string'||c.name.length>300||!housingPoint(c)))throw new BrowserListingError('invalid_response');
          const candidates=[...new Map(result.candidates.filter(candidate=>{
            if(!listingPhaseMatches(phase,candidate.name))return false;
            const evidence=housingLocationEvidence(target.location,candidate);
            return evidence.point_in_primary_polygon||evidence.nearest_primary_polygon_m!==null&&evidence.nearest_primary_polygon_m<=300||evidence.nearest_anchor_m!==null&&evidence.nearest_anchor_m<=300;
          }).map(candidate=>[candidate.complexNo,candidate])).values()].sort((a,b)=>{
            const distance=candidate=>{const evidence=housingLocationEvidence(target.location,candidate);return evidence.point_in_primary_polygon?-1:Math.min(evidence.nearest_primary_polygon_m??Infinity,evidence.nearest_anchor_m??Infinity);};
            return distance(a)-distance(b)||a.complexNo.localeCompare(b.complexNo);
          });
          if(candidates.length>32)throw new BrowserListingError('unmatched');
          const matches=await inspectCandidates(candidates);
          if(matches.length===1)return collectMatch(matches[0]);
        }
      }
      for(const query of queries){
        const abort=()=>child.kill();signal?.addEventListener('abort',abort,{once:true});
        let result;
        try{const input={discover:true,query,names,dong:target.favorite.dong,phase},key=JSON.stringify(input);result=discoveries.get(key);if(!result){result=await request(input);discoveries.set(key,result);}}
        catch(error){signal?.throwIfAborted();if(error.code==='unavailable'){searchError=error;continue;}throw error;}
        finally{signal?.removeEventListener('abort',abort);}
        if(!Array.isArray(result.candidates)||result.candidates.length>8||result.candidates.some(c=>!validComplexNo(c?.complexNo)||typeof c.name!=='string'||c.name.length>300))throw new BrowserListingError('invalid_response');
        const candidates=[...new Map(result.candidates.filter(c=>listingPhaseMatches(phase,c.name)&&names.map(normalize).some(name=>name===normalize(c.name)||name.length>=4&&normalize(c.name).includes(name))).map(c=>[c.complexNo,c])).values()];
        const matches=await inspectCandidates(candidates);
        if(matches.length===1)return collectMatch(matches[0]);
      }
      if(searchError)throw searchError;
      throw new BrowserListingError('unmatched');
  }
  return {
    collect:(target,options)=>execute(target,options),
    resolve:(target,options)=>execute(target,{...options,metadataOnly:true}),
    async close(){if(closed)return;closed=true;lines.close();if(!dead){child.stdin.end(JSON.stringify({close:true})+'\n');const timer=setTimeout(()=>child.kill(),3000);timer.unref();child.once('exit',()=>clearTimeout(timer));}}
  };
}
