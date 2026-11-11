import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {ROOT,atomicWrite,checkedBytes} from '../server/storage.mjs';
import {createDailyListingSource} from '../server/naver-listing-source.mjs';
import {validComplexNo} from '../src/naver-listings.mjs';
import {diagnoseNaverConnection} from '../server/naver-network-diagnostics.mjs';
import {loadApartmentBaseline} from '../server/apartment-baseline-state.mjs';
import {naverMatchScope} from '../server/apartment-naver-matches.mjs';

const {values}=parseArgs({options:{'complex-no':{type:'string',default:'107215'},mode:{type:'string',default:'known'},'timeout-ms':{type:'string',default:'90000'},headless:{type:'boolean',default:false},report:{type:'string'}}});
const timeoutMs=Number(values['timeout-ms']);
if(!validComplexNo(values['complex-no'])||values.mode!=='known'||!Number.isSafeInteger(timeoutMs)||timeoutMs<12000||timeoutMs>180000)throw Error('확정 단지번호·known 모드·제한 시간(12000–180000ms)을 확인하세요.');
const reportFile=path.resolve(values.report||path.join(ROOT,'local/data-validation/naver-live.json'));
if(!reportFile.startsWith(path.join(ROOT,'local')+path.sep))throw Error('진단 보고서는 local 아래에 저장하세요.');
const baseline=loadApartmentBaseline({config:JSON.parse(fs.readFileSync(path.join(ROOT,'automation/config.json'),'utf8'))});
const table=baseline.payload.tables.apartment_naver_matches;
const matches=new Map(table.rows.map(row=>{const match=Object.fromEntries(table.columns.map((column,i)=>[column,row[i]]));return [match.target_id,match];}));
const target=baseline.payload.targets.find(target=>{const match=matches.get(target.favorite.id);return match?.state==='verified'&&match.active===1&&match.complex_no===values['complex-no']&&match.scope_hash===naverMatchScope(target);});
if(!target)throw Error('로컬 기준본에 현재 범위가 유효한 확정 단지 연결이 없습니다.');
const report={version:2,source:'system-chrome',tradeType:'A1',complexNo:values['complex-no'],baseline_sha256:baseline.manifest.generation,startedAt:new Date().toISOString(),status:'running',results:[]};
const save=()=>atomicWrite(reportFile,checkedBytes(JSON.stringify(report,null,2)+'\n'));
save();report.network=await diagnoseNaverConnection();save();
{
 const mode='known';
 const started=Date.now();let source;
 report.active={mode,startedAt:new Date(started).toISOString()};save();
 try{
  source=await createDailyListingSource({source:'system-chrome',diagnostics:true,diagnosticScreenshots:true,timeoutMs,headless:values.headless});
  report.active.diagnosticsFile=path.relative(ROOT,source.diagnosticsFile).replaceAll('\\','/');save();
  const group=await source.collect(target,{complexNo:values['complex-no']});
  if(group.tradeType!=='A1'||group.coverage!=='complete'||!group.pageCount||group.articles.some(article=>article.tradeType!=='A1'))throw Error('매매 전체 수집 검증 실패');
  report.results.push({mode,status:'complete',complexNo:group.complexNo,advertisementCount:group.articles.length,pageCount:group.pageCount,collectedAt:group.collectedAt,durationMs:Date.now()-started,diagnosticsFile:report.active.diagnosticsFile});
  console.log(`${mode}: ${group.articles.length}건 · ${group.pageCount}페이지 · ${Date.now()-started}ms`);
 }catch(error){
  report.results.push({mode,status:'failed',errorCode:error.code||'invalid_response',durationMs:Date.now()-started,diagnostics:error.diagnostics||null});
  console.error(`실제 네이버 ${mode} 수집 검증 실패: ${error.code||'invalid_response'} · 단계 ${error.diagnostics?.phase||'unknown'}`);
 }finally{await source?.close();delete report.active;save();}
}
report.status=report.results.some(item=>item.status==='failed')?'failed':'complete';report.finishedAt=new Date().toISOString();save();
if(report.status==='failed')process.exitCode=1;
