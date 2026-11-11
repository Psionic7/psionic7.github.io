import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {backup} from 'node:sqlite';
import {parseArgs} from 'node:util';
import {connect,paths,ROOT,readJson,atomicWrite,checkedBytes} from '../server/storage.mjs';
import {loadApartmentBaseline,installApartmentBaseline,assertInstalledBaseline,baselineHash} from '../server/apartment-baseline-state.mjs';
import {deriveBaselineHousing,baselineApartmentInformation} from '../server/apartment-baseline-runtime.mjs';
import {dailyListingTargets} from '../server/daily-naver-listings.mjs';

const {values}=parseArgs({options:{source:{type:'string'},database:{type:'string'},report:{type:'string'}}});
if(!values.database)throw Error('--database에 새 검증 복사본 경로를 지정하세요.');
const source=path.resolve(values.source||paths.db),target=path.resolve(values.database),reportFile=path.resolve(values.report||path.join(ROOT,'local/apartment-baseline-validation/report.json'));
if(!target.startsWith(path.join(ROOT,'local')+path.sep)||target===source||fs.existsSync(target))throw Error('검증 DB는 local 아래의 새 파일이어야 합니다.');
if(!reportFile.startsWith(path.join(ROOT,'local')+path.sep))throw Error('검증 보고서는 local 아래에 저장하세요.');
const config=readJson(path.join(ROOT,'automation/config.json')),baseline=loadApartmentBaseline({config});
const snapshot=db=>{
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>row.name).filter(name=>/^molit_/.test(name)||['trades','collection_runs','api_pages','naver_listing_snapshots','naver_listing_days','naver_listing_connections'].includes(name));
 return Object.fromEntries(tables.map(name=>{
  const hash=createHash('sha256');let rows=0;
  for(const row of db.prepare('SELECT * FROM '+name+' ORDER BY rowid').iterate()){hash.update(JSON.stringify(row)+'\n');rows++;}
  return [name,{rows,sha256:hash.digest('hex')}];
 }));
};
const bindingHash=db=>{
 const hash=createHash('sha256');
 for(const row of db.prepare('SELECT trade_id,entity_id,precision,root_id,cohort_id,building_id FROM housing_identity_bindings ORDER BY trade_id').iterate())hash.update(JSON.stringify(row)+'\n');
 return hash.digest('hex');
};
const report={status:'running',startedAt:new Date().toISOString(),generation:baseline.manifest.generation,source:path.relative(ROOT,source),database:path.relative(ROOT,target)};
let db;
try{
 fs.mkdirSync(path.dirname(target),{recursive:true});const original=connect(source,true);
 try{await backup(original,target);}finally{original.close();}
 db=connect(target);report.marketBefore=snapshot(db);report.bindingBefore=bindingHash(db);
 console.log('최신 로컬 DB 복사 및 원천 해시 기록 완료');
 installApartmentBaseline(db,baseline,{config});report.housing=deriveBaselineHousing(db);report.bindingAfter=bindingHash(db);
 if(report.bindingBefore!==report.bindingAfter)throw Error('기존 로컬 확정 거래 배정 변경');
 const information=baselineApartmentInformation(db),targets=dailyListingTargets(db,config);
 report.informationGeneration=information.generation;report.targets=targets.length;report.providerApartments=Object.keys(baseline.payload.providers.molit).length;
 db.exec("UPDATE apartment_complexes SET name='옛 복원 대장 무시 검증'; UPDATE apartment_inventory_regions SET status='pending'");
 deriveBaselineHousing(db);
 if(baselineHash(baselineApartmentInformation(db))!==baselineHash(information)||baselineHash(dailyListingTargets(db,config))!==baselineHash(targets))throw Error('옛 복원 대장이 확정 기준을 변경');
 assertInstalledBaseline(db,{expected:baseline,config});report.marketAfter=snapshot(db);
 if(JSON.stringify(report.marketBefore)!==JSON.stringify(report.marketAfter))throw Error('기준본 설치 중 원천 관측 또는 이력 변경');
 report.status='passed';report.oldRegistryIgnored=true;console.log(JSON.stringify({status:report.status,rows:report.housing.row_count,targets:report.targets,providerApartments:report.providerApartments,generation:report.generation}));
}catch(error){report.status='failed';report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{db?.close();report.finishedAt=new Date().toISOString();atomicWrite(reportFile,checkedBytes(JSON.stringify(report,null,2)+'\n'));}
