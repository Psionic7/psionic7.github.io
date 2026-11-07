import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {ROOT,paths,connect,readJson,atomicWrite} from '../server/storage.mjs';
import {validateConfig} from '../automation/config.mjs';
import {collectDailyListings,dailyListingTargets,listingExport} from '../server/daily-naver-listings.mjs';
import {writeListingSnapshot} from '../server/naver-listings.mjs';
import {createDailyListingSource} from '../server/naver-listing-source.mjs';

try {
  const {values}=parseArgs({options:{plan:{type:'boolean'},force:{type:'boolean'},headed:{type:'boolean'},help:{type:'boolean'},database:{type:'string'},output:{type:'string'},'region-code':{type:'string'},source:{type:'string',default:'system-chrome'},python:{type:'string'},connections:{type:'string'}}});
  if(values.help)console.log('pnpm listings:daily [--plan] [--force] [--headed] [--region-code <시군구 5자리>] [--source playwright|system-chrome] [--python <nodriver 설치 Python>] [--connections <브라우저 검색 JSON>] [--database <SQLite>] [--output <JSON>]\n저장된 수집 지역의 전체 아파트의 매매 매물을 한국 날짜별 하루 한 번 수집합니다. --plan은 조회만 수행합니다.');
  else {
    const config=validateConfig(readJson(path.join(ROOT,'automation/config.json'))),db=connect(values.database?path.resolve(values.database):paths.db,values.plan===true);
    try {
      if(!['playwright','system-chrome'].includes(values.source))throw new Error('매물 브라우저 소스를 확인하세요.');
      if(values['region-code']){
        if(!/^\d{5}$/.test(values['region-code']))throw new Error('매물 지역 코드는 시군구 5자리입니다.');
        const selected=new Set(db.prepare('SELECT region_id FROM regions WHERE region_code=?').all(values['region-code']).map(region=>region.region_id));
        config.region_ids=config.region_ids.filter(id=>selected.has(id));
        if(!config.region_ids.length)throw new Error('수집 지역 설정에 해당 시군구가 없습니다.');
      }
      if(values.plan){const targets=dailyListingTargets(db,config);console.log(JSON.stringify({time_kst:config.time_kst,tradeType:'A1',regions:config.region_ids.length,apartments:targets.length,targets:targets.map(t=>({id:t.favorite.id,apartment:t.favorite.apartment,address:t.favorite.road_address||`${t.favorite.region_name} ${t.favorite.dong} ${t.favorite.jibun}`}))},null,2));}
      else {
        const filename=path.resolve(ROOT,values.output||'public/listings/snapshot.json');
        if(path.extname(filename).toLowerCase()!=='.json')throw new Error('매물 출력은 JSON 파일을 지정하세요.');
        const initialSnapshot=fs.existsSync(filename)?readJson(filename):undefined;
        const connections=values.connections?readJson(path.resolve(values.connections)):[];
        const sourceFactory=()=>createDailyListingSource({source:values.source,python:values.python,connections,initialSnapshot,headless:values.source==='playwright'&&!values.headed});
        const report=await collectDailyListings(db,config,{force:values.force,browserSource:values.source,sourceFactory,initialSnapshot,onProgress:console.log});
        const snapshot=listingExport(db,{initialSnapshot});
        writeListingSnapshot(filename,snapshot);
        if(filename===path.join(ROOT,'public/listings/snapshot.json'))atomicWrite(path.join(ROOT,'public/listings/collection.json'),JSON.stringify({version:1,source:'naver-land',collection:snapshot.collection||null})+'\n');
        atomicWrite(path.join(ROOT,'local/data-validation/listings.json'),JSON.stringify(report,null,2)+'\n');
        console.log(`매매 매물 일일 수집 ${report.dayKst}: 성공 ${report.successCount}/${report.targetCount} · 실패 ${report.failureCount} · 미확정 ${report.unmatchedCount} · 미시도 ${report.notAttemptedCount}`);
        if(report.status!=='complete')process.exitCode=1;
      }
    }finally{db.close();}
  }
}catch(error){console.error(/^(매물|수집 지역|저장된|예약 시간)/.test(error.message)?error.message:'매물 일일 수집 실패. 로컬 기록과 브라우저 연결을 확인하세요.');process.exitCode=1;}
