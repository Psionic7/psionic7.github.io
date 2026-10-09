import fs from 'node:fs';
import {connect,initialize,paths} from '../server/storage.mjs';
import {masterCollectionRunning,masterStats,linkMasterTrades} from '../server/apartment-master.mjs';
import {vworldDomain,vworldKey} from '../server/apartment-master-enrichment.mjs';
import {enrichVworldApartmentData} from '../server/vworld-apartment-data.mjs';

const batchArg=process.argv.find(arg=>arg.startsWith('--batch-size='));
const batchSize=batchArg?Number(batchArg.split('=')[1]):50;
if(!Number.isSafeInteger(batchSize)||batchSize<1)throw new Error('--batch-size는 1 이상의 정수여야 합니다.');

const controller=new AbortController();
process.once('SIGINT',()=>controller.abort(new Error('수집 중단')));
let db;
let runId;
try{
 await initialize();
 db=connect();
 const regions=db.prepare("SELECT region_id FROM apartment_inventory_regions WHERE status='scanned' ORDER BY region_id").all();
 const latest=db.prepare("SELECT scope_json FROM apartment_inventory_runs ORDER BY id DESC LIMIT 1").get();
 const scopes=latest?.scope_json?JSON.parse(latest.scope_json):[];
 const scopeIds=scopes.map(scope=>scope.region_id).filter(id=>regions.some(region=>region.region_id===id));
 if(!scopeIds.length)throw new Error('먼저 건축물대장 수집을 완료하세요.');
 if(masterCollectionRunning(db))throw new Error('아파트 수집 작업이 실행 중입니다. 기존 작업 종료 후 다시 실행하세요.');
 const key=vworldKey(paths.env);
 if(!key)throw new Error('VWORLD_API_KEY를 .env에 설정하세요.');
 runId=Number(db.prepare('INSERT INTO apartment_inventory_runs(started_at,status,scope_json,owner_pid,owner_host) VALUES(?,?,?,?,?)').run(new Date().toISOString(),'running',JSON.stringify(scopes),process.pid,(await import('node:os')).hostname()).lastInsertRowid);
 const progress=await enrichVworldApartmentData(db,{key,domain:vworldDomain(paths.env),signal:controller.signal,pause:1000,maxParcels:batchSize,onProgress:p=>console.log(JSON.stringify(p))});
 let linked={matched:0,ambiguous:0,unmatched:0};
 let status='partial';
 let stats;
 if(!progress.remaining){
  linked=linkMasterTrades(db);
  stats=masterStats(db,scopeIds);
  status=stats.readyToComplete?'complete':'needs_review';
 }
 db.prepare('UPDATE apartment_inventory_runs SET status=?,finished_at=?,error=? WHERE id=?').run(status,new Date().toISOString(),'',runId);
 const summary={run:runId,status,batchCompleted:progress.processed??0,total:progress.total,remaining:progress.remaining??0,withFootprints:stats?.withFootprints,withLandPrice:stats?.withLandPrice,withZoning:stats?.withZoning,withRegionBoundary:stats?.withRegionBoundary,withDistrictBoundary:stats?.withDistrictBoundary,issues:stats?.issues,linked};
 fs.writeFileSync('local/apartment-vworld-batch-report.json',JSON.stringify(summary,null,2));
 console.log(JSON.stringify(summary));
}catch(error){
 if(db&&runId)db.prepare('UPDATE apartment_inventory_runs SET status=?,finished_at=?,error=? WHERE id=?').run(controller.signal.aborted?'cancelled':'error',new Date().toISOString(),error.message,runId);
 console.error(error.message);
 process.exitCode=1;
}finally{db?.close();}
