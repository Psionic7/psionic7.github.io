import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {saveBrowserCapture} from '../server/naver-browser-capture.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
try {
  const {values}=parseArgs({options:{input:{type:'string'},output:{type:'string'},help:{type:'boolean'}}});
  if(values.help)console.log('pnpm listings:import-browser --input <브라우저 관찰 JSON> [--output <결과 JSON>]\n기본 출력: public/listings/snapshot.json. 화면에서 실제 확인한 일부 광고를 구분해 저장합니다.');
  else {
    if(!values.input)throw new Error('--input에 브라우저에서 실제 확인한 매물 JSON을 지정하세요.');
    const input=path.resolve(values.input),output=path.resolve(root,values.output||'public/listings/snapshot.json');
    if(input===output)throw new Error('관찰 원문을 결과 파일로 덮어쓸 수 없습니다.');
    const group=saveBrowserCapture(JSON.parse(fs.readFileSync(input,'utf8').replace(/^\uFEFF/,'')),output);
    console.log(`${group.favorite.apartment}: 브라우저에서 확인한 일부 광고 ${group.articles.length}건 저장 · ${group.collectedAt}`);
  }
}catch(error){console.error(error.message);process.exitCode=1;}
