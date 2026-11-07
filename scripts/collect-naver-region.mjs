import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {connect,readJson,atomicWrite,checkedBytes,ROOT} from '../server/storage.mjs';
import {dailyListingTargets} from '../server/daily-naver-listings.mjs';
import {writeListingSnapshot} from '../server/naver-listings.mjs';
import {LISTING_TRADE_TYPE,saleListingGroup,validListingSnapshot,listingSnapshot,LISTING_ERRORS} from '../src/naver-listings.mjs';
import {createSystemChromeListingSource} from '../server/naver-system-chrome.mjs';
import {validRegionalListingReport} from '../src/naver-listing-report.mjs';
import {setTimeout as pause} from 'node:timers/promises';

async function retryFileWrite(operation){
  for(let attempt=0;;attempt++){
    try{return operation();}
    catch(error){if(!['EPERM','EBUSY'].includes(error.code)||attempt>=6)throw error;await pause(50*(attempt+1));}
  }
}

const {values}=parseArgs({options:{'region-code':{type:'string'},connections:{type:'string'},python:{type:'string'},partial:{type:'boolean'},resume:{type:'boolean'},output:{type:'string'},help:{type:'boolean'}}});
if(values.help){console.log('pnpm listings:region --region-code 41465 --connections <브라우저 단지 검색 JSON> --python <nodriver Python> [--partial] [--resume] [--output <JSON>]\n--partial은 첫 목록만 확인한 단지를 일부 수집으로 표시합니다. 일일 전체 수집 완료로 기록하지 않습니다. --resume은 같은 단지의 24시간 이내 성공 결과를 재사용합니다.');}
else {
  let db,source;
  try {
    if(!/^\d{5}$/.test(values['region-code']||'')||!values.connections)throw new Error('매물 지역 코드와 단지 연결 파일을 지정하세요.');
    db=connect(undefined,true);
    const config=readJson(path.join(ROOT,'automation/config.json'));
    const regions=new Set(db.prepare('SELECT region_id FROM regions WHERE region_code=?').all(values['region-code']).map(r=>r.region_id));
    config.region_ids=config.region_ids.filter(id=>regions.has(id));
    if(!config.region_ids.length)throw new Error('매물 수집 설정에 해당 지역이 없습니다.');
    const targets=dailyListingTargets(db,config),filename=path.resolve(ROOT,values.output||'public/listings/snapshot.json');
    const initial=fs.existsSync(filename)?readJson(filename):listingSnapshot([]);
    if(!validListingSnapshot(initial))throw new Error('기존 매물 스냅샷 검증 실패');
    const groups=new Map(initial.groups.map(saleListingGroup).filter(Boolean).map(g=>[g.favorite.id,g]));
    const report={version:1,source:'naver-land',tradeType:LISTING_TRADE_TYPE,regionCode:values['region-code'],firstPageOnly:Boolean(values.partial),startedAt:new Date().toISOString(),finishedAt:null,results:[]};
    const connections=readJson(path.resolve(values.connections));
    const byFavorite=new Map(connections.map(row=>[row.id,row.complexNo]));
    source=await createSystemChromeListingSource({python:values.python,connections,firstPageOnly:Boolean(values.partial)});
    let stopped=null;
    for(const target of targets){
      if(stopped){report.results.push({favoriteId:target.favorite.id,apartment:target.favorite.apartment,status:'not_attempted',errorCode:stopped});continue;}
      try {
        const previous=groups.get(target.favorite.id);
        const age=previous?.collectedAt?Date.now()-Date.parse(previous.collectedAt):Infinity;
        const group=values.resume&&previous?.status==='ready'&&previous.complexNo===byFavorite.get(target.favorite.id)&&age>=0&&age<24*60*60*1000?previous:await source.collect(target);
        groups.set(group.favorite.id,group);
        const snapshot={...listingSnapshot([...groups.values()]),...(initial.collection?{collection:initial.collection}:{})};
        await retryFileWrite(()=>writeListingSnapshot(filename,snapshot));
        report.results.push({favoriteId:group.favorite.id,apartment:group.favorite.apartment,complexNo:group.complexNo,status:group.coverage==='complete'?'complete':'partial',articleCount:group.articles.length,collectedAt:group.collectedAt});
        console.log(`${group.favorite.apartment}: ${group.articles.length}건 · ${group.coverage}`);
      }catch(error){
        if(!Object.hasOwn(LISTING_ERRORS,error.code))throw error;
        report.results.push({favoriteId:target.favorite.id,apartment:target.favorite.apartment,status:error.code==='unmatched'||error.code==='address_mismatch'?'unmatched':'failed',errorCode:error.code});
        console.log(`${target.favorite.apartment}: ${LISTING_ERRORS[error.code]}`);
        if(['rate_limited','unauthorized','blocked','browser_unavailable','site_unavailable'].includes(error.code))stopped=error.code;
      }
      await retryFileWrite(()=>atomicWrite(path.join(ROOT,'local/suji-collection-report.json'),JSON.stringify(report,null,2)+'\n'));
    }
    report.finishedAt=new Date().toISOString();
    const successful=report.results.filter(r=>r.status==='complete'||r.status==='partial'),saved=successful.map(r=>groups.get(r.favoriteId));
    report.summary={targetCount:targets.length,completeTargets:report.results.filter(r=>r.status==='complete').length,partialTargets:report.results.filter(r=>r.status==='partial').length,unmatchedTargets:report.results.filter(r=>r.status==='unmatched').length,failedTargets:report.results.filter(r=>r.status==='failed').length,notAttemptedTargets:report.results.filter(r=>r.status==='not_attempted').length,complexCount:new Set(saved.map(g=>g.complexNo)).size,advertisementCount:new Set(saved.flatMap(g=>g.articles.map(a=>a.id))).size};
    if(!validRegionalListingReport(report,readJson(filename),values['region-code']))throw new Error('지역 매물 보고서와 저장한 광고의 집계 / 관찰 정보가 일치하지 않습니다.');
    checkedBytes(JSON.stringify(report));
    await retryFileWrite(()=>atomicWrite(path.join(ROOT,'local/suji-collection-report.json'),JSON.stringify(report,null,2)+'\n'));
    await retryFileWrite(()=>atomicWrite(path.join(path.dirname(filename),`region-${values['region-code']}-report.json`),JSON.stringify(report,null,2)+'\n'));
    console.log(JSON.stringify({targetCount:targets.length,counts:report.results.reduce((out,r)=>(out[r.status]=(out[r.status]||0)+1,out),{}),ads:report.results.reduce((n,r)=>n+(r.articleCount||0),0)}));
  }catch(error){console.error(error.message);process.exitCode=1;}
  finally{await source?.close();db?.close();}
}
