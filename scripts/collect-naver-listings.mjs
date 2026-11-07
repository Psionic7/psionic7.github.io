import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {localEnv} from '../server/storage.mjs';
import {createListingCollector,writeListingSnapshot} from '../server/naver-listings.mjs';
import {validTargets,listingSnapshot,LISTING_ERRORS} from '../src/naver-listings.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
try {
  const {values}=parseArgs({options:{targets:{type:'string'},output:{type:'string'},force:{type:'boolean',default:false},help:{type:'boolean',default:false}}});
  if(values.help){console.log('pnpm listings:collect --targets <즐겨찾기 JSON> [--output <결과 JSON>] [--force]\n기본 출력: local/naver-listings-snapshot.json. 정적 화면: --output public/listings/snapshot.json');}
  else {
    if(!values.targets)throw new Error('--targets에 화면에서 내려받은 수집 대상 JSON을 지정하세요.');
    const input=JSON.parse(fs.readFileSync(path.resolve(values.targets),'utf8').replace(/^\uFEFF/,''));
    if(!validTargets(input)||!input.favorites.length)throw new Error('즐겨찾기 수집 대상 형식이 올바르지 않습니다.');
    const output=path.resolve(root,values.output||'local/naver-listings-snapshot.json');
    if(path.resolve(values.targets)===output||['naver-listings-cache.json','naver-listings-cli-cache.json'].some(name=>output===path.join(root,'local',name)))throw new Error('수집 대상·내부 캐시 파일을 출력으로 덮어쓸 수 없습니다.');
    const initialSnapshot=fs.existsSync(output)?JSON.parse(fs.readFileSync(output,'utf8').replace(/^\uFEFF/,'')):undefined;
    const collector=createListingCollector({stateFile:path.join(root,'local/naver-listings-cli-cache.json'),initialSnapshot,authorization:process.env.NAVER_LAND_AUTHORIZATION||localEnv().NAVER_LAND_AUTHORIZATION||''});
    const groups=[];let failures=0,limited=false;
    for(const favorite of input.favorites) {
      const complexNo=input.connections.find(item=>item.favoriteId===favorite.id)?.complexNo;
      if(!complexNo){failures++;const old=collector.read(favorite);if(old)groups.push(old);console.error(`${favorite.apartment}: 네이버 단지 연결 없음`);continue;}
      if(limited){failures++;const old=collector.read(favorite,complexNo);if(old)groups.push(old);console.error(`${favorite.apartment}: 네이버 접근 제한으로 수집하지 않음`);continue;}
      const group=await collector.collect(favorite,complexNo,{force:values.force});groups.push(group);
      if(group.status==='failed'){failures++;limited=['rate_limited','unauthorized'].includes(group.errorCode);console.error(`${favorite.apartment}: ${LISTING_ERRORS[group.errorCode]}`);}
      else console.log(`${favorite.apartment}: ${group.articles.length}개 광고 · ${group.collectedAt}`);
    }
    writeListingSnapshot(output,listingSnapshot(groups));
    console.log(`결과 저장: ${path.relative(root,output)} · 수집 실패/미연결 ${failures}곳`);
    if(failures)process.exitCode=1;
  }
}catch(error){console.error(error.message);process.exitCode=1;}
