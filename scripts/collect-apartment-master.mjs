import fs from 'node:fs';import {backup} from 'node:sqlite';import {initialize,connect,paths,regions,savedIds} from '../server/storage.mjs';
import {collectApartmentMaster} from '../server/collect-apartment-master.mjs';import {masterStats,initializeApartmentMaster} from '../server/apartment-master.mjs';
const controller=new AbortController();process.once('SIGINT',()=>controller.abort(new Error('수집 중단')));
const batchArg=process.argv.find(arg=>arg.startsWith('--vworld-batch-size='));
const vworldBatchSize=batchArg?Number(batchArg.split('=')[1]):Infinity;
if(batchArg&&(!Number.isSafeInteger(vworldBatchSize)||vworldBatchSize<1))throw new Error('--vworld-batch-size는 1 이상의 정수여야 합니다.');
try{
 await initialize();const db=connect();try{initializeApartmentMaster(db);if(process.argv.includes('--status')){console.log(JSON.stringify(masterStats(db,savedIds(paths.favorites,regions(db))),null,2));}else{
 const filename=`local/before-apartment-master-${Date.now()}.sqlite3`;if(!process.argv.includes('--resume')){await backup(db,filename);console.log('아파트 마스터 수집 전 DB 백업 완료');}const r=await collectApartmentMaster(db,{signal:controller.signal,resume:process.argv.includes('--resume'),refresh:process.argv.includes('--refresh'),vworldBatchSize,onProgress:p=>console.log(JSON.stringify(p))});fs.writeFileSync('local/apartment-master-collection-report.json',JSON.stringify(r,null,2));console.log(JSON.stringify({run:r.run,complete:r.stats.complete,complexes:r.stats.complexes,withLocation:r.stats.withLocation,withBoundary:r.stats.withBoundary,issues:r.stats.issues,linked:r.linked,vworldRemaining:r.vworldProgress?.remaining??0}));if(!r.stats.complete&&!r.vworldProgress?.remaining)process.exitCode=2;
 }}finally{db.close();}
}catch(error){console.error(error.message);process.exitCode=1;}
