import fs from 'node:fs';
import {validApartmentFavorites} from '../src/apartment-favorites.js';
import {LISTING_TRADE_TYPE,saleListingGroup,parseComplexNo,validListingGroup,validListingSnapshot,listingSnapshot} from '../src/naver-listings.mjs';
import {normalizeArticle,verifyComplexEvidence,writeListingSnapshot} from './naver-listings.mjs';
import {housingObservation} from './housing-location.mjs';
import {checkedBytes} from './storage.mjs';

export function browserCaptureGroup(capture,{now=Date.now(),location}={}) {
  if(!capture||capture.version!==1||!validApartmentFavorites([capture.favorite])||typeof capture.sourceUrl!=='string'||!capture.sourceUrl.startsWith('https://'))throw new Error('브라우저 수집 대상과 네이버 원문 URL을 확인하세요.');
  const complexNo=parseComplexNo(capture.sourceUrl);
  if(!complexNo||!capture.observedAt||!Number.isFinite(Date.parse(capture.observedAt))||new Date(capture.observedAt).toISOString()!==capture.observedAt||Date.parse(capture.observedAt)>now+60000)throw new Error('브라우저 수집 시각과 단지 URL을 확인하세요.');
  if(!Array.isArray(capture.articles)||capture.articles.length===0||capture.articles.length>20000)throw new Error('브라우저에서 확인한 매물 광고가 필요합니다. 빈 일부 수집을 매물 없음으로 저장할 수 없습니다.');
  const articles=capture.articles.filter(article=>article.tradeTypeCode===LISTING_TRADE_TYPE).map(normalizeArticle);
  if(!articles.length)throw new Error('브라우저에서 확인한 매매 광고가 없습니다. 일부 수집으로 매매 매물 없음을 확정할 수 없습니다.');
  if(articles.some(article=>!article))throw new Error('종료 광고를 브라우저 수집 결과에 넣을 수 없습니다.');
  const verification=verifyComplexEvidence({complexDetail:capture.complexDetail,article_building_dongs:articles.map(article=>article.building)},capture.favorite,complexNo,location),complexName=verification.complexName;
  const group={favorite:capture.favorite,complexNo,complexName,tradeType:LISTING_TRADE_TYPE,status:'ready',attemptedAt:capture.observedAt,collectedAt:capture.observedAt,errorCode:null,articles,collectionMethod:'browser',coverage:'partial',sourceUrl:capture.sourceUrl,observation:housingObservation(capture.complexDetail,{sourceUrl:capture.sourceUrl,observedAt:capture.observedAt,verificationMethod:verification.method,buildingWitnesses:verification.buildingWitnesses})};
  if(!validListingGroup(group))throw new Error('브라우저 매물의 번호·면적·가격·중복을 확인하세요.');
  return group;
}

export function saveBrowserCapture(capture,filename,options={}) {
  const group=browserCaptureGroup(capture,options);
  let groups=[],collection;
  if(fs.existsSync(filename)) {
    const previous=JSON.parse(fs.readFileSync(filename,'utf8').replace(/^\uFEFF/,''));
    if(!validListingSnapshot(previous))throw new Error('기존 매물 파일 검증 실패. 이전 파일을 보존합니다.');
    groups=previous.groups.map(saleListingGroup).filter(Boolean);
    collection=previous.collection;
  }
  const previous=groups.find(item=>item.favorite.id===group.favorite.id);
  if(previous?.collectedAt&&previous.collectedAt>group.collectedAt)throw new Error('더 최근에 수집한 결과를 과거 브라우저 자료로 덮어쓸 수 없습니다.');
  const snapshot={...listingSnapshot([...groups.filter(item=>item.favorite.id!==group.favorite.id),group]),...(collection?{collection}:{})};
  checkedBytes(JSON.stringify(snapshot));
  writeListingSnapshot(filename,snapshot);
  return group;
}
