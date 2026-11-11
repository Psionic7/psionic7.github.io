import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {fetchMolitPage,currentMonth} from '../server/collector.mjs';
import {serviceKey,ROOT,atomicWrite,checkedBytes} from '../server/storage.mjs';

// This probe never connects to SQLite or feeds detailed rows to the basic normalizer.
export async function checkMolitAccess({key=serviceKey(),code='41135',month=currentMonth(),fetcher=fetch,signal}={}){
 if(!key)throw Error('MOLIT_SERVICE_KEY를 설정하세요.');
 const results=[];
 for(const service of ['basic','detailed']){
  const result={service,regionCode:code,month,requestedRows:1,checkedAt:new Date().toISOString()};
  try{
   const page=await fetchMolitPage({service,key,code,month,page:1,numOfRows:1,fetcher,signal});
   Object.assign(result,{status:'ready',httpStatus:page.httpStatus,total:page.total,receivedRows:page.items.length,officialIdRows:page.items.filter(row=>Boolean(row.aptSeq?.trim())).length,fields:[...new Set(page.items.flatMap(Object.keys))].sort()});
  }catch(error){
   signal?.throwIfAborted();
   Object.assign(result,{status:'failed',code:error.code||'api_error',providerCode:error.providerCode||null,httpStatus:error.httpStatus||null,message:error.message});
  }
  results.push(result);
 }
 const detailed=results[1],detailedIdStatus=detailed.status==='failed'?'unavailable':!detailed.receivedRows?'no_rows':detailed.officialIdRows?'present':'missing';
 return {checkedAt:new Date().toISOString(),status:results.every(row=>row.status==='ready')?'complete':'failed',detailedIdStatus,results};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const {values}=parseArgs({options:{'region-code':{type:'string'},month:{type:'string'},output:{type:'string'}}});
  const filename=path.resolve(values.output||path.join(ROOT,'local/data-validation/molit-access.json'));
  if(!filename.startsWith(path.join(ROOT,'local')+path.sep))throw Error('검사 결과는 local 디렉터리에 저장하세요.');
  const result=await checkMolitAccess({code:values['region-code'],month:values.month});
  atomicWrite(filename,checkedBytes(JSON.stringify(result,null,2)+'\n'));console.log(JSON.stringify(result,null,2));if(result.status!=='complete')process.exitCode=1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
