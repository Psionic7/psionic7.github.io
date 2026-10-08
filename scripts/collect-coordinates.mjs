import {parseArgs} from 'node:util';
import {initialize,connect} from '../server/storage.mjs';
import {coordinateKey,pendingCoordinates,collectCoordinates} from '../server/coordinates.mjs';
const {values}=parseArgs({options:{limit:{type:'string',default:'100'},refresh:{type:'boolean',default:false}}});
try {
  const limit=Number(values.limit);
  if(!Number.isInteger(limit)||limit<1||limit>10000)throw new Error('좌표 조회 건수를 1~10000으로 설정하세요.');
  await initialize();const key=coordinateKey();
  if(!key)throw new Error('.env에 JUSO_COORDINATE_SEARCH_KEY를 설정하세요.');
  const db=connect();
  try {
    console.log(`좌표 조회 대상 ${pendingCoordinates(db,limit,{refresh:values.refresh}).length}곳`);
    const result=await collectCoordinates(db,key,{limit,refresh:values.refresh,onProgress:counts=>{
      if(counts.completed%25===0||counts.completed===counts.total)console.log(`${counts.completed}/${counts.total} · 저장 ${counts.exact} · 미확정 ${counts.unresolved}`);
    }});
    console.log(`완료: 좌표 ${result.exact}곳 · 미확정 ${result.unresolved}곳`);
  }finally{db.close();}
}catch(error){console.error(/^(공식 좌표|좌표 조회|\.env에)/.test(error.message)?error.message:'좌표 수집 실패. 로컬 DB와 설정을 확인하세요.');process.exitCode=1;}
