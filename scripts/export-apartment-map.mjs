import {parseArgs} from 'node:util';
import fs from 'node:fs';
import {initialize,connect} from '../server/storage.mjs';
import {osmBoundaryFeatures} from '../server/apartment-boundaries.mjs';
import {exportApartmentMap} from '../server/export-apartment-map.mjs';
const {values}=parseArgs({options:{input:{type:'string'}}});
try {
  await initialize();
  if(values.input){const payload=JSON.parse(fs.readFileSync(values.input,'utf8'));osmBoundaryFeatures(payload);const db=connect();try{db.prepare('INSERT INTO apartment_boundary_sources VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET response_json=excluded.response_json,fetched_at=excluded.fetched_at').run('osm-collected-regions',JSON.stringify(payload),new Date().toISOString());}finally{db.close();}}
  const result=exportApartmentMap();console.log(result?`지도 내보내기 완료: 아파트 ${result.count}개 · 경계 ${result.boundary_count}곳 · 경계 연결 ${result.boundary_apartments}개`:'기존 지도 자료 유지');
}catch(error){console.error(/^(아파트 경계|원천|지도)/.test(error.message)?error.message:'지도 자료 내보내기 실패. 입력 파일과 DB를 확인하세요.');process.exitCode=1;}
