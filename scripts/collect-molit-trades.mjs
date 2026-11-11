import path from 'node:path';
import {parseArgs} from 'node:util';
import {connect,paths,ROOT,serviceKey,atomicWrite,checkedBytes} from '../server/storage.mjs';
import {collectMonth,monthsBetween,verifyCollectedMonth} from '../server/collector.mjs';

const {values}=parseArgs({options:{database:{type:'string'},'region-code':{type:'string'},month:{type:'string',multiple:true},output:{type:'string'}}});
const code=values['region-code'],months=[...new Set(values.month||[])].sort();
if(!/^\d{5}$/.test(code||'')||!months.length)throw Error('--region-code와 하나 이상의 --month를 지정하세요.');
for(const month of months)monthsBetween(month,month);
const output=path.resolve(values.output||path.join(ROOT,'local/molit-provider-id-validation',code+'-collection.json'));
if(!output.startsWith(path.join(ROOT,'local')+path.sep))throw Error('수집 보고서는 local 디렉터리에 저장하세요.');
const db=connect(values.database?path.resolve(values.database):paths.db);
const report={startedAt:new Date().toISOString(),regionCode:code,service:'detailed',status:'running',months:[]};
try{
 const region=db.prepare('SELECT region_name FROM regions WHERE region_code=? LIMIT 1').get(code);
 if(!region)throw Error('로컬 지역 정보에 없는 지역 코드입니다.');
 const key=serviceKey();
 if(!key)throw Error('프로젝트 비밀 파일의 MOLIT_SERVICE_KEY를 확인하세요.');
 for(const month of months){
  const before=db.prepare('SELECT id FROM trades WHERE region_code=? AND deal_month=?').all(code,month);
  const count=await collectMonth(db,key,code,month,region.region_name);
  const runId=db.prepare('SELECT MAX(id) AS id FROM collection_runs WHERE region_code=? AND deal_month=?').get(code,month).id;
  verifyCollectedMonth(db,runId);
  const current=new Set(db.prepare('SELECT id FROM trades WHERE region_code=? AND deal_month=?').all(code,month).map(row=>row.id));
  const ids=db.prepare('SELECT count(*) AS n FROM molit_trade_identities WHERE run_id=?').get(runId).n;
  const retained=before.filter(row=>current.has(row.id)).length;
  const result={month,runId,rows:count,officialIdRows:ids,previousRows:before.length,retainedIds:retained,newIds:count-retained,retiredIds:before.length-retained};
  report.months.push(result);console.log(JSON.stringify(result));
 }
 report.status='complete';
}catch(error){
 report.status='failed';report.error=error.message;console.error(error.message);process.exitCode=1;
}finally{
 db.close();report.finishedAt=new Date().toISOString();
 atomicWrite(output,checkedBytes(JSON.stringify(report,null,2)+'\n'));
}
