import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {connect,paths,ROOT,atomicWrite} from '../server/storage.mjs';
import {dailyListingTargets,listingExport} from '../server/daily-naver-listings.mjs';
import {housingIdentityCatalog,synchronizeHousingIdentity} from '../server/apartment-identity.mjs';
import {seedNaverMatches,readNaverMatch,recordNaverMatch,recordNaverMatchFailure,naverMatchStats,exportNaverMatchSeed} from '../server/apartment-naver-matches.mjs';
import {createDailyListingSource} from '../server/naver-listing-source.mjs';

const {values}=parseArgs({options:{database:{type:'string'},python:{type:'string'},'refresh-known':{type:'boolean'},'retry-unmatched':{type:'boolean'},'write-seed':{type:'boolean'},'max-targets':{type:'string',default:'1000'},output:{type:'string',default:'local/data-validation/naver-matches.json'}}});
const limit=Number(values['max-targets']);if(!Number.isInteger(limit)||limit<0||limit>1000)throw Error('단지 연결 확인 개수는 0~1000입니다.');
if(path.extname(values.output).toLowerCase()!=='.json')throw Error('단지 연결 감사 파일은 JSON 형식이어야 합니다.');
const db=connect(values.database?path.resolve(values.database):paths.db);let source;
try{
  const config=JSON.parse(fs.readFileSync(path.join(ROOT,'automation/config.json'),'utf8'));
  synchronizeHousingIdentity(db);
  const targets=dailyListingTargets(db,config),catalog=housingIdentityCatalog(db);
  const initialSnapshot=JSON.parse(fs.readFileSync(path.join(ROOT,'public/listings/snapshot.json'),'utf8'));
  const snapshot=listingExport(db,{initialSnapshot});
  seedNaverMatches(db,targets,catalog,snapshot);
  let attempted=0;
  for(const target of targets){
    const match=readNaverMatch(db,target);
    const eligible=values['refresh-known']&&match.complex_no&&match.state==='pending'||values['retry-unmatched']&&['unmatched','review','pending'].includes(match.state);
    if(!eligible||attempted>=limit)continue;
    source??=await createDailyListingSource({python:values.python,initialSnapshot,discover:values['retry-unmatched']===true,timeoutMs:70000});attempted++;
    try{const result=await source.resolve(target,{complexNo:match.complex_no||undefined});recordNaverMatch(db,target,result);console.log(`${attempted}: ${target.favorite.apartment} · ${result.complexNo} · 연결 ${readNaverMatch(db,target).state}`);}
    catch(error){
      if(!error.code)throw error;
      recordNaverMatchFailure(db,target,error.code);
      console.log(`${attempted}: ${target.favorite.apartment} · ${error.code}`);
      if(['blocked','rate_limited','unauthorized','site_unavailable','browser_unavailable'].includes(error.code))break;
    }
  }
  const rows=targets.map(target=>{const match=readNaverMatch(db,target);return {target_id:target.favorite.id,name:target.favorite.apartment,road:target.favorite.road_address,state:match.state,complex_no:match.complex_no,reason:match.reason,observation:match.observation};});
  const sources=db.prepare('SELECT source_entity_id,target_id,scope_json,registry_state,complex_no,state,last_verified_at FROM apartment_naver_source_connections ORDER BY source_entity_id,target_id').all().map(({scope_json,...row})=>({...row,scope:JSON.parse(scope_json)}));
  const report={generatedAt:new Date().toISOString(),attempted,...naverMatchStats(db),rows,sources};
  atomicWrite(path.resolve(ROOT,values.output),JSON.stringify(report,null,2)+'\n');
  const bySource=new Map();for(const row of sources){const entries=bySource.get(row.source_entity_id)||[];entries.push(row);bySource.set(row.source_entity_id,entries);}
  const table=(title,include)=>{
    const lines=[`## ${title}`,'','| 지역 코드 | 동 | 원천 아파트명 | 지번 | 확인 상태 |','|---|---|---|---|---|'];
    for(const [id,entries] of bySource){if(!include(entries))continue;const [region,dong,jibun,name]=JSON.parse(id);const states=[...new Set(entries.map(row=>row.state))].join(', ');lines.push(`| ${region} | ${dong.replaceAll('|','\\|')} | ${name.replaceAll('|','\\|')} | ${jibun.replaceAll('|','\\|')} | ${states} |`);}
    return lines.join('\n');
  };
  const markdown=['# 네이버 단지 연결 검토',`기준 ${report.generatedAt}. 하나 이상의 연결이 확인된 원천 단지 ${report.linkedSources}개 중 ${report.partiallyLinkedSources}개는 다른 관련 구획에 미확정 상태가 있다. 확인된 연결이 없는 원천 단지는 ${report.unlinkedSources}개다. 미확정은 매물 0건이 아니다.`,table('확인된 네이버 연결이 없는 원천 단지',entries=>entries.every(row=>row.state!=='verified')),table('일부 관련 구획이 미확정인 원천 단지',entries=>entries.some(row=>row.state==='verified')&&entries.some(row=>row.state!=='verified'))].join('\n\n')+'\n';
  atomicWrite(path.resolve(ROOT,values.output.replace(/\.json$/i,'.md')),markdown);
  if(values['write-seed'])atomicWrite(path.join(ROOT,'automation/naver-verified-matches.json'),JSON.stringify(exportNaverMatchSeed(db))+'\n');
  console.log(JSON.stringify({...naverMatchStats(db),attempted}));
}finally{await source?.close();db.close();}
