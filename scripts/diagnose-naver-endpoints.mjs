import path from 'node:path';
import {ROOT,atomicWrite,checkedBytes} from '../server/storage.mjs';
import {NAVER_DIAGNOSTIC_ENDPOINTS,probePublicEndpoint} from '../server/naver-endpoint-diagnostics.mjs';

const report={version:1,status:'running',startedAt:new Date().toISOString(),runner:process.env.RUNNER_OS||process.platform,results:[]};
const save=()=>atomicWrite(path.join(ROOT,'local/data-validation/naver-endpoints.json'),checkedBytes(JSON.stringify(report,null,2)+'\n'));
save();
for(const endpoint of NAVER_DIAGNOSTIC_ENDPOINTS){
 const result=await probePublicEndpoint(endpoint);report.results.push(result);save();
 console.log(JSON.stringify({label:result.label,host:result.host,path:result.path,status:result.status,statusCode:result.statusCode,code:result.code,tls:result.tls?.authorized||false,durationMs:result.durationMs}));
}
report.status='recorded';report.finishedAt=new Date().toISOString();save();
