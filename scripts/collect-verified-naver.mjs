import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {connect,paths,ROOT,readJson,atomicWrite,checkedBytes} from '../server/storage.mjs';
import {dailyListingTargets} from '../server/daily-naver-listings.mjs';
import {readNaverMatch,verifyNaverObservation} from '../server/apartment-naver-matches.mjs';
import {createSystemChromeListingSource} from '../server/naver-system-chrome.mjs';
import {listingSnapshot,validComplexNo} from '../src/naver-listings.mjs';

const {values}=parseArgs({options:{database:{type:'string'},'complex-no':{type:'string'},python:{type:'string'},output:{type:'string'}}});
if(!validComplexNo(values['complex-no']))throw Error('--complex-no에 로컬에서 확정한 네이버 단지번호를 입력하세요.');
const output=path.resolve(values.output||path.join(ROOT,'local/naver-current-collection',values['complex-no']+'.json'));
if(!output.startsWith(path.join(ROOT,'local')+path.sep))throw Error('검증 수집 결과는 local 디렉터리에 저장하세요.');
fs.mkdirSync(path.dirname(output),{recursive:true});
const sourceFile=output.replace(/\.json$/,'')+'-source.jsonl';
const attemptSource=output.replace(/\.json$/,'')+'-attempt-'+randomUUID()+'.jsonl';
const db=connect(values.database||paths.db,true);
let source;
const report={startedAt:new Date().toISOString(),complexNo:values['complex-no'],status:'running',results:[]};
try{
 const targets=dailyListingTargets(db,readJson(path.join(ROOT,'automation/config.json'))).filter(target=>{
  const match=readNaverMatch(db,target);return match?.state==='verified'&&match.scopeCurrent&&match.active===1&&match.complex_no===values['complex-no'];
 });
 if(!targets.length)throw Error('현재 로컬 DB에 범위가 유효한 확정 연결이 없습니다.');
 source=await createSystemChromeListingSource({python:values.python||process.env.NAVER_BROWSER_PYTHON,discover:false,headless:false,timeoutMs:120000,connections:targets.map(target=>({id:target.favorite.id,complexNo:values['complex-no']})),spawnWorker:(...args)=>{
  const child=spawn(...args);
  fs.writeFileSync(attemptSource,'');child.stdout.on('data',chunk=>fs.appendFileSync(attemptSource,chunk));return child;
 }});
 const groups=[];
 for(const target of targets){
  const group=await source.collect(target,{complexNo:values['complex-no']});verifyNaverObservation(target,group);groups.push(group);
  const row={id:target.favorite.id,name:group.complexName,ads:group.articles.length,providerGroups:new Set(group.articles.map(article=>article.providerHouseId)).size,pages:group.pageCount,coverage:group.coverage,collectedAt:group.collectedAt};
  report.results.push(row);console.log(JSON.stringify(row));
 }
 atomicWrite(output,checkedBytes(JSON.stringify(listingSnapshot(groups),null,2)+'\n'));fs.renameSync(attemptSource,sourceFile);report.status='complete';
}catch(error){report.status='failed';report.errorCode=error.code||'invalid_response';console.error('확정 단지 실제 수집 실패:',report.errorCode);process.exitCode=1;}
finally{
 await source?.close();db.close();report.finishedAt=new Date().toISOString();
 atomicWrite(output.replace(/\.json$/,'')+'-report.json',checkedBytes(JSON.stringify(report,null,2)+'\n'));
}
