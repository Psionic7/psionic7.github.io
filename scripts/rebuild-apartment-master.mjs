import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {backup} from 'node:sqlite';
import {ROOT,paths,connect} from '../server/storage.mjs';
import {rebuildApartmentMaster,linkMasterTrades,masterCollectionRunning} from '../server/apartment-master.mjs';
import {enrichApartmentMaster,vworldKey,vworldDomain} from '../server/apartment-master-enrichment.mjs';
import {coordinateKey} from '../server/coordinates.mjs';
import {exportApartmentMap} from '../server/export-apartment-map.mjs';

const {values}=parseArgs({options:{'enrich-new':{type:'boolean',default:false}}});
let db;
try {
  if(!fs.existsSync(paths.db))throw new Error('저장된 작업 DB가 없습니다.');
  db=connect();
  if(masterCollectionRunning(db))throw new Error('전체 아파트 수집이 실행 중입니다.');
  const before=db.prepare('SELECT count(*) AS n FROM trades').get().n;
  const existing=new Set(db.prepare('SELECT apartment_id FROM apartment_complexes WHERE active=1').all().map(p=>p.apartment_id));
  const backupPath=path.join(ROOT,'local',`before-housing-map-${Date.now()}.sqlite3`);
  await backup(db,backupPath);
  console.log('작업 DB 백업: '+path.basename(backupPath));
  rebuildApartmentMaster(db);
  const added=db.prepare('SELECT apartment_id,name FROM apartment_complexes WHERE active=1').all().filter(p=>!existing.has(p.apartment_id));
  console.log('원천 대장에서 추가한 주거 단지: '+added.length+'개');
  // Also resume a previously added senior complex if enrichment failed after
  // rebuilding. Existing confirmed apartments never enter this repair scope.
  const pendingSenior=db.prepare(`SELECT DISTINCT c.apartment_id FROM apartment_complexes c
    JOIN apartment_buildings b USING(apartment_id) JOIN apartment_building_inventory i USING(building_id)
    WHERE c.active=1 AND i.active=1 AND i.classification='senior_housing'
      AND (EXISTS(SELECT 1 FROM apartment_buildings x WHERE x.apartment_id=c.apartment_id AND x.coordinate_status!='exact')
        OR EXISTS(SELECT 1 FROM apartment_parcels p WHERE p.apartment_id=c.apartment_id AND p.boundary_status!='exact'))`).all();
  const enrichIds=[...new Set([...added,...pendingSenior].map(p=>p.apartment_id))];
  if(values['enrich-new']&&enrichIds.length)await enrichApartmentMaster(db,{
    coordinateKey:coordinateKey(),vworldKey:vworldKey(),domain:vworldDomain(),
    apartmentIds:enrichIds,
    onProgress:p=>console.log(`새 단지 보강 ${p.completed}/${p.total} · ${p.kind}`),
  });
  linkMasterTrades(db);
  if(db.prepare('SELECT count(*) AS n FROM trades').get().n!==before)throw new Error('거래 원본 건수가 달라졌습니다.');
  if(Object.values(db.prepare('PRAGMA quick_check').get())[0]!=='ok')throw new Error('작업 DB 무결성 검사 실패');
  db.close();db=null;
  const result=exportApartmentMap();
  if(!result)throw new Error('지역 수집 상태가 미완료여서 기존 지도를 유지했습니다.');
  console.log(`지도 갱신: ${result.count}개 항목 · 거래 원본 ${before}건 유지`);
}catch(error){
  console.error(/^(저장된|전체 아파트|작업 DB|거래 원본|지역 수집|주소 좌표|브이월드|JUSO_)/.test(error.message)?error.message:'주거 지도 재구성 실패. DB 백업과 API 설정을 확인하세요.');
  process.exitCode=1;
}finally{db?.close();}
