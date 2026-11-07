import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import FavoriteListings from './FavoriteListings.jsx';
import {validListingSnapshot} from './naver-listings.mjs';
import './styles.css';
import './naver-listings-preview.css';

function BrowserListingsPreview() {
  const [snapshot,setSnapshot]=useState(null),[error,setError]=useState('');
  const [region,setRegion]=useState(()=>new URLSearchParams(location.search).get('region')||'');
  const [query,setQuery]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    fetch('/listings/snapshot.json',{cache:'no-store',signal:controller.signal}).then(response=>{if(!response.ok)throw new Error('수집 결과를 불러오지 못했습니다.');return response.json();}).then(value=>{if(!validListingSnapshot(value))throw new Error('수집 결과 형식을 확인하세요.');setSnapshot(value);}).catch(reason=>{if(reason.name!=='AbortError')setError(reason.message);});
    return()=>controller.abort();
  },[]);
  const collected=snapshot?.groups.filter(group=>group.collectionMethod==='browser')||[];
  const regions=[...new Map(collected.map(group=>[group.favorite.region_code,group.favorite.region_name]))];
  const selected=collected.filter(group=>(!region||group.favorite.region_code===region)&&(!query||group.favorite.apartment.replace(/\s/g,'').includes(query.replace(/\s/g,''))));
  const groups=[...new Map(selected.map(group=>[group.complexNo,group])).values()];
  const advertisementCount=new Set(groups.flatMap(group=>group.articles.map(article=>article.id))).size;
  const client={load:async()=>({available:false,snapshot:{...snapshot,groups}})};
  return <main className="naver-browser-preview"><header><a href="/?tab=dashboard">← 관심 목록으로</a><p>집의 기록 · 네이버 매물 수집 결과</p><h1>수집한 아파트 매물</h1><p>단지 주소를 대조한 수집 결과입니다. 전체·일부 수집 여부와 실제 수집 시각을 함께 표시합니다. 개인 즐겨찾기와 별도로 조회할 수 있습니다.</p></header>
    {snapshot&&<div className="naver-preview-filters"><label>지역<select value={region} onChange={event=>setRegion(event.target.value)}><option value="">전체 지역</option>{regions.map(([code,name])=><option key={code} value={code}>{name}</option>)}</select></label><label>단지명 검색<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="단지명을 입력하세요"/></label><p role="status">확인된 {groups.length}개 단지 · 광고 {advertisementCount.toLocaleString('ko-KR')}건</p></div>}
    {error?<p role="alert">{error}</p>:!snapshot?<p role="status">실제 수집 결과를 불러오는 중입니다.</p>:groups.length?<FavoriteListings apartments={groups.map(group=>group.favorite)} client={client}/>:<p>조건에 맞는 수집 결과가 없습니다.</p>}
  </main>;
}

createRoot(document.getElementById('root')).render(<BrowserListingsPreview/>);
