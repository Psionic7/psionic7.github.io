import {exportData} from '../server/export.mjs';
import {parseArgs} from 'node:util';
const {values}=parseArgs({options:{source:{type:'string'},target:{type:'string'},'favorites-file':{type:'string'},'secrets-file':{type:'string'}}});
try {
  const manifest=exportData({source:values.source,target:values.target,favorites:values['favorites-file'],secretsFile:values['secrets-file']});
  console.log(`공개 데이터 내보내기 완료: ${manifest.count.toLocaleString('ko-KR')}건, 즐겨찾기 ${manifest.favorite_region_ids.length}곳`);
}catch{console.error('내보내기 실패: 작업 DB, 저장한 지역 목록 및 비밀 값 포함 여부를 확인하세요.');process.exitCode=1;}
