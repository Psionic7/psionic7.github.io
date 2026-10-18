import React,{useEffect,useRef} from 'react';
import {Database,Clock3,ChevronDown,TriangleAlert} from 'lucide-react';
import {publishedDay} from './weekly.mjs';
export default function DataStatus({manifest}) {
  const disclosure=useRef(null);
  useEffect(()=>{const close=event=>{if(event.type==='keydown'&&event.key!=='Escape')return;if(event.type==='pointerdown'&&disclosure.current?.contains(event.target))return;if(disclosure.current)disclosure.current.open=false;};document.addEventListener('pointerdown',close);document.addEventListener('keydown',close);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close);};},[]);
  const day=publishedDay(manifest.published_at),today=publishedDay(new Date().toISOString());
  const age=Math.max(0,Math.floor((Date.parse(today)-Date.parse(day))/86400000));
  const names=[...new Set(Object.keys(manifest.districts).map(code=>manifest.regions.find(r=>r.region_code===code)?.region_name?.replace(/^(경기도|서울특별시) /,'')||code))];
  return <aside className={'data-status-banner'+(age>2?' stale':'')} aria-label="조회 자료 범위">
    <div className="data-status-main"><Database size={16} aria-hidden="true"/><strong>거래 자료 {names.length}개 시군구</strong><span className="data-status-divider" aria-hidden="true"/><Clock3 size={16} aria-hidden="true"/><span>자료 기준일 <time dateTime={day}>{day}</time></span>{age>2&&<span className="data-age"><TriangleAlert size={14} aria-hidden="true"/>{age}일 전 자료</span>}</div>
    <details ref={disclosure} className="data-status-detail"><summary>자료 범위<ChevronDown size={14} aria-hidden="true"/></summary><div><strong>{names.join(' · ')||'수집된 지역 없음'}</strong><p>{age>2?`갱신 지연 · ${age}일 전 자료`:'최근 갱신 자료'} · ‘최근’ 기간은 이 기준일까지입니다.</p><p>기준일은 마지막 수집 날짜입니다. 과거 계약월은 순환 갱신하므로 모든 과거 거래를 같은 날 재조회한 것은 아닙니다.</p></div></details>
  </aside>;
}
