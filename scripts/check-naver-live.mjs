import fs from 'node:fs';
import path from 'node:path';
import {ROOT,atomicWrite} from '../server/storage.mjs';
import {createDailyListingSource} from '../server/naver-listing-source.mjs';
import {validListingSnapshot} from '../src/naver-listings.mjs';

const snapshot=JSON.parse(fs.readFileSync(path.join(ROOT,'public/listings/snapshot.json'),'utf8'));
if(!validListingSnapshot(snapshot))throw Error('매물 검증 대상 스냅샷이 올바르지 않습니다.');
const saved=snapshot.groups.find(group=>group.complexNo==='107215');
if(!saved)throw Error('매물 검증 대상 단지가 없습니다.');
const startedAt=new Date().toISOString(),results=[];
let source;
try{
  for(const discover of [false,true]){
    await source?.close();source=await createDailyListingSource();
    const group=await source.collect({favorite:saved.favorite,query:`${saved.favorite.dong} ${saved.favorite.apartment}`},discover?{}:{complexNo:saved.complexNo});
    if(group.tradeType!=='A1'||group.coverage!=='complete'||!group.pageCount||group.articles.some(article=>article.tradeType!=='A1'))throw Error('매매 전체 수집 검증 실패');
    results.push({mode:discover?'search':'known',complexNo:group.complexNo,advertisementCount:group.articles.length,pageCount:group.pageCount,collectedAt:group.collectedAt});
    console.log(`${discover?'자동 검색':'저장 단지'}: ${group.articles.length}건 · ${group.pageCount}페이지 전체 확인`);
  }
}catch(error){
  results.push({status:'failed',errorCode:error.code||'invalid_response'});process.exitCode=1;
  console.error('실제 네이버 무인 수집 검증 실패:',error.code||'invalid_response');
}finally{
  await source?.close();
  atomicWrite(path.join(ROOT,'local/data-validation/naver-live.json'),JSON.stringify({version:1,source:'system-chrome',tradeType:'A1',startedAt,finishedAt:new Date().toISOString(),status:process.exitCode?'failed':'complete',results},null,2)+'\n');
}
