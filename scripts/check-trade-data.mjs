import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {verifyTradeExport} from '../server/verify-trade-export.mjs';
import {ROOT,paths,atomicWrite} from '../server/storage.mjs';

export function checkTradeData({target=path.join(ROOT,'public/data'),source=fs.existsSync(paths.db)?paths.db:undefined,requireSearch=false,reportFile}={}) {
  try {
    const result=verifyTradeExport({target,source,requireSearch});
    if(reportFile)atomicWrite(reportFile,JSON.stringify(result,null,2)+'\n');
    return result;
  } catch(error) {
    const message=error.message.startsWith('데이터 검증 실패:')?error.message:'데이터 검증 실패: 원천 DB·추출 파일의 형식과 경로를 확인하세요.';
    if(reportFile)atomicWrite(reportFile,JSON.stringify({status:'failed',finished_at:new Date().toISOString(),message},null,2)+'\n');
    throw new Error(message);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try {
    const {values}=parseArgs({options:{target:{type:'string'},source:{type:'string'},report:{type:'string'},'require-search':{type:'boolean',default:false}}});
    const label=values.target?.replaceAll('\\','/').startsWith('docs/')?'build':'public';
    const result=checkTradeData({target:values.target,source:values.source,requireSearch:values['require-search'],reportFile:values.report||path.join(ROOT,`local/data-validation/${label}.json`)});
    console.log(`데이터 검증 통과: ${result.rows.toLocaleString('ko-KR')}건 · ${result.districts}개 구 · ${result.months}개 월별 파일 · 저장 원천 이력 ${result.source_history?.months??0}개 구·월`);
  } catch(error){console.error(error.message);process.exitCode=1;}
}
