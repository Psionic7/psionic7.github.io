import fs from 'node:fs';
import path from 'node:path';
import {readRegistryRegion,registryKey,fetchRegistryPage} from './building-registry.mjs';
import {coordinateKey} from './coordinates.mjs';
import {enrichVworldApartmentData} from './vworld-apartment-data.mjs';
import {vworldKey,vworldDomain,enrichApartmentMaster} from './apartment-master-enrichment.mjs';
import {masterScopes,startMasterRun,saveRegistrySnapshot,rebuildApartmentMaster,linkMasterTrades,masterStats} from './apartment-master.mjs';
import {regions,savedIds,paths,ROOT,checkedBytes,secretValues} from './storage.mjs';
export async function collectApartmentMaster(db,{favorites=paths.favorites,secretsFile=paths.env,signal,onProgress,registryReader=readRegistryRegion,enricher=enrichApartmentMaster,refresh=false,resume=false,vworldBatchSize=Infinity}={}){
 const scope=masterScopes(regions(db),savedIds(favorites,regions(db)));if(!scope.length)throw new Error('아파트를 수집할 지역을 먼저 저장하세요.');
 const key=registryKey(secretsFile),coords=coordinateKey(secretsFile),geo=vworldKey(secretsFile);if(!key||!coords||!geo)throw new Error('BUILDING_REGISTER_SERVICE_KEY(또는 건축물대장 승인된 MOLIT_SERVICE_KEY), JUSO_COORDINATE_SEARCH_KEY, VWORLD_API_KEY를 설정하세요.');
 const run=startMasterRun(db,scope,{preserveScanned:resume});let current=null;
 const cached=db.prepare('SELECT p.total_count,p.items_json,r.started_at FROM apartment_inventory_pages p JOIN apartment_inventory_runs r ON r.id=p.run_id WHERE region_id=? AND dataset=? AND page=? ORDER BY p.run_id DESC LIMIT 1');
 const savePage=db.prepare('INSERT OR REPLACE INTO apartment_inventory_pages VALUES(?,?,?,?,?,?)');
 const pageReader=regionId=>async(k,code,dataset,page,options)=>{const prior=resume?cached.get(regionId,dataset,page):null;let value;if(prior&&Date.now()-new Date(prior.started_at).getTime()<86400000){value={total:prior.total_count,items:JSON.parse(prior.items_json),cached:true};}else value=await fetchRegistryPage(k,code,dataset,page,{...options,onDiagnostic:d=>{const folder=path.join(ROOT,'local/master-api-diagnostics');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,code+'-'+dataset+'-'+page+'-'+d.attempt+'.txt'),checkedBytes(d.body,secretValues(secretsFile),{maxBytes:Infinity}));}});savePage.run(run,regionId,dataset,page,value.total,JSON.stringify(value.items));return value;};
 try{
 for(const s of scope){const saved=resume?db.prepare('SELECT status FROM apartment_inventory_regions WHERE region_id=?').get(s.region_id):null;if(saved?.status==='scanned'){onProgress?.({stage:'registry_cached',region:s.dong,completed:scope.indexOf(s)+1,total:scope.length});continue;}current=s;db.prepare("UPDATE apartment_inventory_regions SET status='running' WHERE region_id=?").run(s.region_id);onProgress?.({stage:'registry',region:s.dong,completed:scope.indexOf(s),total:scope.length});const snapshot=await registryReader(key,s.legal_code,{signal,...(registryReader===readRegistryRegion?{fetcher:pageReader(s.region_id)}:{}),onProgress:p=>onProgress?.({stage:'registry',region:s.dong,...p})});saveRegistrySnapshot(db,run,s,snapshot);rebuildApartmentMaster(db);}
 rebuildApartmentMaster(db);current=null;await enricher(db,{coordinateKey:coords,vworldKey:geo,domain:vworldDomain(secretsFile),signal,refresh,onProgress:p=>onProgress?.({stage:'enrichment',...p})});const vworldProgress=await enrichVworldApartmentData(db,{key:geo,domain:vworldDomain(secretsFile),signal,pause:1000,refresh,maxParcels:vworldBatchSize,onProgress:p=>onProgress?.({stage:'vworld',...p})});const linked=linkMasterTrades(db),stats=masterStats(db,scope.map(p=>p.region_id));
 db.prepare('UPDATE apartment_inventory_runs SET status=?,finished_at=? WHERE id=?').run(stats.readyToComplete?'complete':'needs_review',new Date().toISOString(),run);return{run,stats:masterStats(db,scope.map(p=>p.region_id)),linked,vworldProgress};
 }catch(error){if(current)db.prepare("UPDATE apartment_inventory_regions SET status='error',error=? WHERE region_id=?").run(error.message,current.region_id);db.prepare('UPDATE apartment_inventory_runs SET status=?,finished_at=?,error=? WHERE id=?').run(signal?.aborted?'cancelled':'error',new Date().toISOString(),error.message,run);throw error;}
}
