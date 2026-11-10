import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync,backup} from 'node:sqlite';
import {PUBLIC_SCHEMA,LOCAL_SCHEMA} from '../server/storage.mjs';
import {initializeApartmentMaster,startMasterRun,saveRegistrySnapshot} from '../server/apartment-master.mjs';
import {REGISTRY_DATASETS} from '../server/building-registry.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const script=path.join(root,'scripts/rebuild-apartment-master.mjs');
const scope={region_id:'dong_41465101',legal_code:'4146510100',region_code:'41465',region_name:'경기도 용인시 수지구',dong:'풍덕천동'};
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function folder(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'home-rebuild-cli-'));
 t.after(()=>{const resolved=path.resolve(directory);assert(path.dirname(resolved)===path.resolve(os.tmpdir())&&path.basename(resolved).startsWith('home-rebuild-cli-'));fs.rmSync(resolved,{recursive:true,force:true});});
 return directory;
}
function populate(filename){
 const db=new DatabaseSync(filename);db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA);initializeApartmentMaster(db);
 db.prepare('INSERT INTO regions VALUES(?,?,?,?,?,?,?)').run(scope.region_id,'풍덕천동',scope.region_code,scope.region_name,JSON.stringify([scope.dong]),37,127);
 const title=(id,actual,dong,households)=>({mgmBldrgstPk:id,sigunguCd:'41465',bjdongCd:'10100',platGbCd:'0',bun:'0001',ji:'0000',bldNm:'검증단지',dongNm:dong,mainAtchGbCd:'0',mainPurpsCd:'02000',mainPurpsCdNm:'공동주택',etcPurps:actual,newPlatPlc:'경기도 용인시 수지구 시험로 1',useAprDay:'20000103',hhldCnt:households,hoCnt:households,grndFlrCnt:households==='0'?'1':'15',naRoadCd:'414653012345',naUgrndCd:'0',naMainBun:'1',naSubBun:'0'});
 const titles=[title('dwelling','아파트','101동','50'),title('guard','경비실','경비실','0')];
 const floors=[{mgmBldrgstPk:'dwelling',mainPurpsCd:'02001',mainPurpsCdNm:'아파트',etcPurps:'아파트'},{mgmBldrgstPk:'guard',mainPurpsCd:'02001',mainPurpsCdNm:'아파트',etcPurps:'경비실'}];
 const snapshot=Object.fromEntries(REGISTRY_DATASETS.map((key,index)=>{const items=[titles,[],[],[],floors][index];return[key,{total:items.length,items,pages:[{page:1,total:items.length,items}]}];}));
 const run=startMasterRun(db,[scope]);saveRegistrySnapshot(db,run,scope,snapshot);db.prepare("UPDATE apartment_inventory_runs SET status='needs_review' WHERE id=?").run(run);
 db.prepare('INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(1,scope.region_code,'202609','2026-09-01','검증단지',scope.dong,'1',100000,85,10,2000,0,JSON.stringify({aptDong:'101'}));
 return db;
}

test('the rebuild CLI targets a copied DB and output directory, creates a source-adjacent backup and prepares common information',async t=>{
 const directory=folder(t),original=path.join(directory,'original.sqlite3'),source=path.join(directory,'copy.sqlite3'),target=path.join(directory,'map');
 const favorites=path.join(directory,'regions.json'),secrets=path.join(directory,'.env');
 fs.writeFileSync(favorites,JSON.stringify({version:1,regions:[{region_id:scope.region_id}]}));fs.writeFileSync(secrets,'');
 const db=populate(original);await backup(db,source);db.close();const originalHash=hash(original);
 const result=spawnSync(process.execPath,[script,'--source',source,'--target',target,'--favorites-file',favorites,'--secrets-file',secrets],{cwd:root,encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);assert.equal(hash(original),originalHash);
 const manifest=JSON.parse(fs.readFileSync(path.join(target,'manifest.json')));
 assert.equal(manifest.count,1);
 const apartments=JSON.parse(fs.readFileSync(path.join(target,manifest.apartments.file)));
 assert.equal(apartments[0].master_id,'hub:dwelling');assert.equal(apartments[0].identity_ref.kind,'root');
 const updated=new DatabaseSync(source,{readOnly:true});
 try{
  assert.equal(updated.prepare('SELECT count(*) n FROM trades').get().n,1);
  assert.equal(updated.prepare("SELECT classification FROM apartment_building_inventory WHERE building_id='guard'").get().classification,'other');
  assert.equal(updated.prepare("SELECT count(*) n FROM sqlite_master WHERE name='apartment_information'").get().n,1);
  assert.equal(updated.prepare("SELECT count(*) n FROM housing_identity_meta WHERE key='generation'").get().n,1);
 }finally{updated.close();}
 const backups=fs.readdirSync(directory).filter(name=>/^before-housing-map-.*\.sqlite3$/.test(name));assert.equal(backups.length,1);
 const preserved=new DatabaseSync(path.join(directory,backups[0]),{readOnly:true});
 try{assert.equal(preserved.prepare('SELECT count(*) n FROM trades').get().n,1);assert.equal(preserved.prepare('SELECT count(*) n FROM apartment_complexes').get().n,0);}finally{preserved.close();}
});

test('an explicitly missing source never falls back to the real working database',t=>{
 const directory=folder(t),target=path.join(directory,'map');
 const result=spawnSync(process.execPath,[script,'--source',path.join(directory,'missing.sqlite3'),'--target',target],{cwd:root,encoding:'utf8',windowsHide:true});
 assert.equal(result.status,1);assert.match(result.stderr,/저장된 작업 DB가 없습니다/);assert.equal(fs.existsSync(target),false);assert.deepEqual(fs.readdirSync(directory),[]);
});
