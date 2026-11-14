import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {connect,paths,ROOT,atomicWrite,checkedBytes} from '../server/storage.mjs';
import {planMolitSourceConnections,applyMolitSourceConnections} from '../server/molit-source-connections.mjs';

const {values}=parseArgs({options:{database:{type:'string'},observations:{type:'string'},apply:{type:'boolean',default:false},output:{type:'string'}}});
if(process.env.GITHUB_ACTIONS==='true')throw Error('공식 단지 연결 검토·확정은 로컬에서 실행하세요.');
const filename=path.resolve(values.output||path.join(ROOT,'local/data-validation/molit-source-connections.json'));
if(!filename.startsWith(path.join(ROOT,'local')+path.sep))throw Error('연결 검토 결과는 local 디렉터리에 저장하세요.');
const observations=[];let sourceHash='local-source';
if(values.observations){
 const file=path.resolve(values.observations),bytes=fs.readFileSync(file),manifest=JSON.parse(bytes),folder=path.dirname(file);
 sourceHash=createHash('sha256').update(bytes).digest('hex');
 for(const [code,meta] of Object.entries(manifest.districts||{})){
  if(!/^\d{5}$/.test(code)||!new RegExp('^trades-'+code+'-[a-f0-9]{12}\\.json$').test(meta.file))throw Error('공식 단지 관측 자료의 경로가 올바르지 않습니다.');
  const bytes=fs.readFileSync(path.join(folder,meta.file));if(createHash('sha256').update(bytes).digest('hex')!==meta.sha256)throw Error('공식 단지 관측 자료의 해시가 일치하지 않습니다.');
  const rows=JSON.parse(bytes);if(!Array.isArray(rows)||rows.length!==meta.count||rows.some(row=>row.region_code!==code))throw Error('공식 단지 관측 자료의 지역·건수가 일치하지 않습니다.');
  for(const row of rows)observations.push(row);
 }
 if(!observations.length)throw Error('공식 단지 관측 자료가 없습니다.');
}
const db=connect(values.database||paths.db);
try{
 const plan=planMolitSourceConnections(db,observations,{sourceHash}),result=values.apply?applyMolitSourceConnections(db,plan):null;
 atomicWrite(filename,checkedBytes(JSON.stringify({...plan,applied:values.apply,result},null,2)+'\n'));
 console.log(JSON.stringify({connections:plan.connections.length,newConnections:plan.connections.filter(row=>!row.existing).length,held:plan.held.length,applied:values.apply,result,output:filename}));
}finally{db.close();}
