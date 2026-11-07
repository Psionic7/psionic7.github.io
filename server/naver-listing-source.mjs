import {validListingSnapshot} from '../src/naver-listings.mjs';
import {createSystemChromeListingSource} from './naver-system-chrome.mjs';
import {createBrowserListingSource} from './naver-browser-collector.mjs';

export function createDailyListingSource({source=process.env.NAVER_LISTING_SOURCE||'system-chrome',initialSnapshot,connections=[],python=process.env.NAVER_BROWSER_PYTHON||(process.platform==='win32'?'python':'python3'),headless=false,...options}={}) {
  if(initialSnapshot&&!validListingSnapshot(initialSnapshot))throw Error('매물 초기 스냅샷 검증 실패');
  const known=new Map((initialSnapshot?.groups||[]).map(group=>[group.favorite.id,{id:group.favorite.id,complexNo:group.complexNo}]));
  for(const row of connections)known.set(row.id,row);
  if(source==='system-chrome')return createSystemChromeListingSource({...options,python,connections:[...known.values()],discover:true,headless});
  if(source==='playwright')return createBrowserListingSource({...options,headless});
  throw Error('매물 브라우저 소스를 확인하세요.');
}
