import React from 'react';
import {LISTING_ERRORS} from './naver-listings.mjs';

export default function ListingDailyStatus({collection}) {
  if(!collection)return <p className="listing-notice">수집 지역 전체 아파트의 매매 매물은 실거래가 수집과 함께 한국 날짜별 하루 한 번 수집합니다. 아직 일일 매물 수집 실행 기록은 없습니다.</p>;
  const state={running:'수집 중',complete:'전체 확인',partial:'일부 수집 미완료',failed:'수집 미완료'}[collection.status];
  return <div className="listing-notice" role={collection.status==='complete'?'status':'alert'} aria-label="지역 전체 매물 일일 수집 상태">
    <strong>{collection.dayKst} · 지역 전체 {collection.tradeType==='A1'?'매매 매물':'매물 (이전 거래 유형)'} {state}</strong>
    {collection.errorCode==='inventory_unavailable'?<p>{LISTING_ERRORS.inventory_unavailable}</p>:<p>{collection.regionIds.length}개 동 · 대상 {collection.targetCount}곳 · 성공 {collection.successCount}곳 · 실패 {collection.failureCount}곳 · 단지 연결 미확정 {collection.unmatchedCount}곳 · 미시도 {collection.notAttemptedCount}곳</p>}
    {collection.finishedAt&&<small>마지막 확인 {new Date(collection.finishedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'})} · 실패한 단지의 이전 자료는 보존합니다.</small>}
  </div>;
}
