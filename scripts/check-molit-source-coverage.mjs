import path from 'node:path';
import {parseArgs} from 'node:util';
import {connect,paths,ROOT,atomicWrite,checkedBytes} from '../server/storage.mjs';
import {assertInstalledBaseline} from '../server/apartment-baseline-state.mjs';
import {assertMolitSourceCoverage} from '../server/molit-source-coverage.mjs';

const {values}=parseArgs({options:{database:{type:'string'},output:{type:'string'}}});
const filename=path.resolve(values.output||path.join(ROOT,'local/data-validation/molit-source-coverage.json'));
if(!filename.startsWith(path.join(ROOT,'local')+path.sep))throw Error('공식 단지 연결 검사 결과는 local 디렉터리에 저장하세요.');
const db=connect(values.database||paths.db,true);
try{
 assertInstalledBaseline(db);
 const report=assertMolitSourceCoverage(db);atomicWrite(filename,checkedBytes(JSON.stringify({status:'passed',...report},null,2)+'\n'));
 console.log(`공식 단지 연결 검사 통과: ID 보강 거래 ${report.checked}건, 기존 조회 누락 0건`);
}catch(error){
 atomicWrite(filename,checkedBytes(JSON.stringify({status:'failed',error:error.message,...error.report},null,2)+'\n'));console.error(error.message);process.exitCode=1;
}finally{db.close();}
