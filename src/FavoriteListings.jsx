import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ExternalLink,RefreshCw,Download,Building2} from 'lucide-react';
import {useStoredState} from './preferences.js';
import {TRADE_TYPES,LISTING_ERRORS,validConnections,validListingGroup,parseComplexNo,complexUrl,articleUrl,listingSearchUrl,listingIsStale,selectArticles,listingGroupForFavorite} from './naver-listings.mjs';
import ListingDailyStatus from './ListingDailyStatus.jsx';
import {sameApartmentFavorite} from './apartment-favorites.js';
import {listingClient,downloadListingTargets} from './naver-listings-client.js';
import './favorite-listings.css';

const time=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'});
const PAGE_SIZE=20;

function ComplexConnection({favorite,complexNo,onConnect,disabled}) {
  const [input,setInput]=useState(complexNo||''),[error,setError]=useState('');
  useEffect(()=>{setInput(complexNo||'');setError('');},[complexNo]);
  return <details className="listing-connection" open={!complexNo||undefined}>
    <summary>{complexNo?'네이버 단지 연결 변경':'네이버 단지 연결하기'}</summary>
    <p>네이버에서 주소를 확인한 단지의 URL 또는 번호를 입력하세요. 수집할 때 주소가 일치하는지 다시 확인합니다.</p>
    <a href={listingSearchUrl(favorite)} target="_blank" rel="noopener noreferrer">네이버에서 {favorite.apartment} 찾기<ExternalLink size={12}/></a>
    <form onSubmit={event=>{event.preventDefault();const id=parseComplexNo(input);if(!id){setError('네이버 단지 URL(https://new.land.naver.com/complexes/번호) 또는 숫자 번호를 입력하세요.');return;}onConnect(id);setError('');}}>
      <label>단지 URL 또는 번호<input aria-label={`${favorite.apartment} 네이버 단지 URL 또는 번호`} value={input} maxLength={500} onChange={event=>setInput(event.target.value)} placeholder="https://new.land.naver.com/complexes/…" disabled={disabled}/></label>
      <button type="submit" disabled={disabled}>연결 저장</button>
    </form>
    {error&&<p role="alert" className="listing-error">{error}</p>}
  </details>;
}

function ListingRows({favorite,group,filters}) {
  const [page,setPage]=useState(0);
  const rows=useMemo(()=>selectArticles(group.articles,filters),[group.articles,filters]);
  useEffect(()=>setPage(0),[group,filters]);
  const safePage=Math.min(page,Math.max(0,Math.ceil(rows.length/PAGE_SIZE)-1));
  if(!group.collectedAt)return null;
  if(!group.articles.length)return <p className="listing-empty">{group.status==='failed'?'이전 수집 당시':'수집 당시'} 네이버에 노출된 매매·전세·월세 아파트 광고가 없습니다.</p>;
  if(!rows.length)return <p className="listing-empty">현재 필터에 맞는 광고가 없습니다. 거래 유형과 전용면적을 확인하세요.</p>;
  return <>
    <div className="table-scroll listing-table" role="region" aria-label={`${favorite.apartment} 네이버 매물 광고`} tabIndex={0}><table>
      <thead><tr><th scope="col">거래</th><th scope="col">호가 / 보증금</th><th scope="col">전용 / 공급</th><th scope="col">동 · 층 · 방향</th><th scope="col">확인일 · 중개사</th><th scope="col">설명 · 원문</th></tr></thead>
      <tbody>{rows.slice(safePage*PAGE_SIZE,(safePage+1)*PAGE_SIZE).map(article=><tr key={article.id}>
        <td><span className={'listing-type listing-type-'+article.tradeType}>{TRADE_TYPES[article.tradeType]}</span></td>
        <td className="listing-price">{article.priceText}{!/[억만원]/.test(article.priceText)&&'만원'}{article.tradeType==='B2'&&<small>월 {article.rentText}만원</small>}</td>
        <td>{article.areaM2.toLocaleString('ko-KR')}㎡<small>{article.supplyAreaM2===null?'공급 미제공':article.supplyAreaM2.toLocaleString('ko-KR')+'㎡'}</small></td>
        <td>{article.building||'동 미제공'}<small>{article.floor||'층 미제공'} · {article.direction||'방향 미제공'}</small></td>
        <td>{article.confirmedOn||'확인일 미제공'}<small>{article.realtor||'중개사 미제공'}</small></td>
        <td><span className="listing-description">{article.description||'설명 미제공'}</span><a href={articleUrl(article.id)} target="_blank" rel="noopener noreferrer" aria-label={`${favorite.apartment} 매물 ${article.id} 네이버 원문`}>네이버 원문<ExternalLink size={11}/></a></td>
      </tr>)}</tbody>
    </table></div>
    <div className="listing-pagination"><span>필터 결과 {rows.length}개 광고 · {safePage+1} / {Math.ceil(rows.length/PAGE_SIZE)}페이지</span><div><button onClick={()=>setPage(safePage-1)} disabled={safePage===0} aria-label={`${favorite.apartment} 이전 매물 페이지`}>이전</button><button onClick={()=>setPage(safePage+1)} disabled={(safePage+1)*PAGE_SIZE>=rows.length} aria-label={`${favorite.apartment} 다음 매물 페이지`}>다음</button></div></div>
  </>;
}

export default function FavoriteListings({apartments,client=listingClient,onDownload=downloadListingTargets}) {
  const [connections,setConnections]=useStoredState('naverListings','connections',[],validConnections);
  const [groups,setGroups]=useState([]),[available,setAvailable]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [collection,setCollection]=useState(null);
  const [retry,setRetry]=useState(0),[progress,setProgress]=useState(null),[message,setMessage]=useState('');
  const [filters,setFilters]=useState({tradeType:'',minArea:'',maxArea:'',sort:'priceAsc'});
  const run=useRef(0),stop=useRef(false);
  const favoriteKey=JSON.stringify(apartments),connectionKey=JSON.stringify(connections);
  useEffect(()=>{let active=true;if(client.status)client.status().then(value=>{if(active)setCollection(value);}).catch(()=>{});return()=>{active=false;};},[client,retry]);
  useEffect(()=>{
    const generation=++run.current;stop.current=true;setProgress(null);setMessage('');
    if(!apartments.length){setGroups([]);setLoading(false);return;}
    setLoading(true);setError('');
    const currentConnections=connections.filter(c=>apartments.some(f=>f.id===c.favoriteId));
    client.load(apartments,currentConnections).then(result=>{
      if(generation!==run.current)return;
      setGroups(result.snapshot.groups);if(result.snapshot.collection)setCollection(result.snapshot.collection);setAvailable(result.available);setLoading(false);
    }).catch(reason=>{if(generation===run.current){setError(reason.message);setLoading(false);setAvailable(false);}});
    return()=>{++run.current;stop.current=true;};
  },[favoriteKey,connectionKey,client,retry]);
  const selected=apartments.map(favorite=>{
    const connection=connections.find(c=>c.favoriteId===favorite.id);
    const group=listingGroupForFavorite(groups,favorite,connection?.complexNo);
    const daily=collection?.results.find(result=>result.favoriteId===favorite.id||result.favorite&&sameApartmentFavorite(result.favorite,favorite));
    return {favorite,group,daily,complexNo:connection?.complexNo||group?.complexNo||''};
  });
  const connected=selected.filter(item=>item.complexNo);
  const collect=async()=>{
    if(progress||!available)return;
    const generation=run.current;stop.current=false;setMessage('');setError('');setProgress({done:0,total:connected.length});
    let done=0,failed=0;
    for(const {favorite,complexNo} of connected) {
      if(stop.current||generation!==run.current)break;
      try{
        const group=await client.collect(favorite,complexNo);
        if(generation!==run.current)return;
        if(!validListingGroup(group)||group.favorite.id!==favorite.id||group.complexNo!==complexNo)throw new Error('수집 결과의 단지 정보를 확인할 수 없습니다.');
        setGroups(previous=>[...previous.filter(item=>item.favorite.id!==favorite.id),group]);
        done++;setProgress({done,total:connected.length});
        if(group.status==='failed'){failed++;if(group.errorCode==='rate_limited'||group.errorCode==='unauthorized'){stop.current=true;break;}}
      }catch(reason){if(generation!==run.current)return;setError(reason.message);failed++;stop.current=true;break;}
    }
    if(generation!==run.current)return;
    setProgress(null);setMessage(`${done} / ${connected.length}곳 확인${failed?' · 수집 실패 '+failed+'곳':''}${done<connected.length?' · 나머지 단지는 수집하지 않았습니다.':''}`);
  };
  if(!apartments.length)return <section className="panel favorite-listings" aria-label="즐겨찾기 아파트 네이버 매물"><h2><Building2 size={18}/>즐겨찾기 아파트의 현재 매물</h2><ListingDailyStatus collection={collection}/><p className="small-note">아파트를 즐겨찾기에 추가하면 이곳에서 네이버 단지를 연결하고 매물 광고를 모아볼 수 있습니다.</p></section>;
  return <section className="panel favorite-listings" aria-label="즐겨찾기 아파트 네이버 매물">
    <div className="listing-heading"><div><p className="listing-eyebrow">NAVER 부동산 · 매매 / 전세 / 월세</p><h2>즐겨찾기 아파트의 현재 매물</h2><p>관심 단지의 호가를 실거래가와 함께 살펴보세요.</p></div><div className="listing-actions"><button onClick={()=>onDownload(apartments,connected.map(({favorite,complexNo})=>({favoriteId:favorite.id,complexNo})))} disabled={!!progress}><Download size={14}/>수집 대상 내려받기</button>{available&&<button className="primary" onClick={collect} disabled={loading||!!progress||!connected.length}><RefreshCw size={14}/>네이버 매물 수집</button>}</div></div>
    <ListingDailyStatus collection={collection}/>
    {loading?<p role="status">매물 수집 결과를 불러오는 중입니다.</p>:!available&&<p className="listing-notice">저장된 수집 결과를 표시합니다. 새 매물 수집은 로컬 미리보기에서 실행할 수 있습니다.</p>}
    {progress&&<div className="listing-progress" role="status"><span>네이버 매물 수집 {progress.done} / {progress.total}곳 · 전체 페이지를 확인하고 있습니다.</span><button onClick={()=>{stop.current=true;setMessage('진행 중인 단지 확인 후 중단합니다.');}}>수집 중단</button></div>}
    {(message||error)&&<div className="listing-notice" role={error?'alert':'status'}>{error||message}{error&&!progress&&<button onClick={()=>setRetry(v=>v+1)}>수집 결과 다시 불러오기</button>}</div>}
    <div className="listing-filters"><label>매물 거래 유형<select value={filters.tradeType} onChange={e=>setFilters({...filters,tradeType:e.target.value})}><option value="">전체 거래</option>{Object.entries(TRADE_TYPES).map(([code,label])=><option key={code} value={code}>{label}</option>)}</select></label><label>최소 전용면적(㎡)<input type="number" min="0" max="100000" value={filters.minArea} onChange={e=>setFilters({...filters,minArea:e.target.value})}/></label><label>최대 전용면적(㎡)<input type="number" min="0" max="100000" value={filters.maxArea} onChange={e=>setFilters({...filters,maxArea:e.target.value})}/></label><label>매물 정렬<select value={filters.sort} onChange={e=>setFilters({...filters,sort:e.target.value})}><option value="priceAsc">매매가·보증금 낮은 순</option><option value="priceDesc">매매가·보증금 높은 순</option><option value="latest">확인일 최신순</option><option value="areaAsc">전용면적 작은 순</option></select></label></div>
    <div className="listing-groups">{selected.map(({favorite,group,daily,complexNo})=><article key={favorite.id} className="listing-group" aria-label={`${favorite.apartment} 매물 수집 정보`}>
      <header><div><h3>{favorite.apartment}</h3><p>{favorite.region_name} {favorite.dong} · 지번 {favorite.jibun||'미상'}</p></div>{complexNo&&<a href={complexUrl(complexNo)} target="_blank" rel="noopener noreferrer">네이버 단지 {complexNo}<ExternalLink size={12}/></a>}</header>
      <ComplexConnection favorite={favorite} complexNo={complexNo} disabled={!!progress} onConnect={id=>{setGroups(previous=>previous.filter(g=>g.favorite.id!==favorite.id));setConnections(previous=>[...previous.filter(c=>c.favoriteId!==favorite.id),{favoriteId:favorite.id,complexNo:id}]);}}/>
      {daily&&daily.status!=='ready'&&group?.status!=='failed'&&<p className="listing-notice" role="alert">{collection.dayKst} 일일 수집: {daily.status==='not_attempted'?'미시도 · ':''}{LISTING_ERRORS[daily.errorCode]||'아직 확인하지 못했습니다.'}</p>}
      {group?<><div className={'listing-state'+(group.status==='failed'?' failed':'')}>
        {group.status==='failed'?<p role="alert">{LISTING_ERRORS[group.errorCode]}<small>마지막 시도 {time(group.attemptedAt)}</small></p>:<p>수집 당시 네이버 광고 <strong>{group.articles.length}건</strong></p>}
        {group.collectionMethod==='browser'&&group.coverage==='partial'&&<p>브라우저 화면에서 확인한 일부 광고 {group.articles.length}건입니다. 전체 매물 수집 결과가 아닙니다.</p>}
        {group.collectionMethod==='browser'&&group.coverage==='complete'&&<p>브라우저의 전체 {group.pageCount}개 목록 페이지를 확인한 결과입니다.</p>}
        {group.areaSource==='list'&&<p>면적은 네이버 목록에 표시된 값입니다. 상세 페이지와 표시 자릿수가 다를 수 있습니다.</p>}
        {group.collectedAt&&<p>{group.status==='failed'?'이전 수집 결과 · ':''}{listingIsStale(group)?'오래된 자료 · ':''}<time dateTime={group.collectedAt}>{time(group.collectedAt)}</time> 수집{group.complexName?' · '+group.complexName:''}</p>}
      </div><ListingRows favorite={favorite} group={group} filters={filters}/></>:<p className="listing-empty">{complexNo?'아직 수집한 매물 자료가 없습니다.':'네이버 단지를 연결하면 이 아파트의 매물을 수집할 수 있습니다.'}</p>}
    </article>)}</div>
    <p className="listing-footnote">네이버에 수집 시점에 노출된 광고입니다. 중개사별 동일 주택의 중복 광고가 포함될 수 있으며, 현장 매물 존재와 거래 가능 여부는 원문과 중개사에게 확인하세요. 매물 확인일과 이 사이트의 수집 시각은 다릅니다. 호가는 실제 계약 금액이 아닙니다.</p>
  </section>;
}
