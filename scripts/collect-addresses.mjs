import {parseArgs} from 'node:util';
import {initialize,connect,paths} from '../server/storage.mjs';
import {addressKey,collectAddresses,pendingAddresses} from '../server/addresses.mjs';

const {values}=parseArgs({options:{limit:{type:'string'},all:{type:'boolean'},refresh:{type:'boolean'}}});
try {
  await initialize();
  const key=addressKey();
  if(!key)throw new Error('JUSO_ADDRESS_SEARCH_KEY를 .env에 설정하세요.');
  const db=connect(paths.db);
  try {
    const limit=values.all?10000:Number(values.limit ?? 100);
    const total=pendingAddresses(db,limit,{refresh:values.refresh}).length;
    console.log(`공식 도로명주소 조회 대상 ${total.toLocaleString('ko-KR')}곳`);
    const result=await collectAddresses(db,key,{limit,refresh:values.refresh,onProgress:counts=>{
      if(counts.completed%25===0 || counts.completed===counts.total)
        console.log(`${counts.completed}/${counts.total} · 정확히 일치 ${counts.exact} · 미확정 ${counts.unresolved}`);
    }});
    console.log(`완료: 도로명주소 ${result.exact}곳, 미확정 ${result.unresolved}곳`);
  }finally{db.close();}
}catch(error){console.error(error.message);process.exitCode=1;}
