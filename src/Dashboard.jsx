import React,{useMemo,useState} from 'react';
import {ChartNoAxesCombined,MapPin,Building2,Star,RefreshCw} from 'lucide-react';
import {useDistrictDatasets} from './weekly/useDistrictDatasets.js';
import {buildOverview,overviewDurations} from './dashboard/model.mjs';
import {FavoriteOverview,OverviewMetrics,OverviewTrend,RecentOverview,shortDate} from './dashboard/OverviewWidgets.jsx';
import './dashboard/dashboard.css';
export default function Dashboard({manifest,regions,apartments,days,onDaysChange,districtLoader,onOpenDong,onOpenApartment,onManageDongs,onManageApartments}) {
  const [retry,setRetry]=useState(0);
  const codes=useMemo(()=>[...new Set([...regions,...apartments].map(item=>item.region_code))].sort(),[regions,apartments]);
  const datasets=useDistrictDatasets(manifest,codes,districtLoader,retry);
  const model=useMemo(()=>buildOverview({manifest,regions,apartments,datasets,days}),[manifest,regions,apartments,datasets,days]);
  const hasFavorites=regions.length+apartments.length>0;
  if(!model)return <section className="panel notice" role="alert">자료 기준일을 확인할 수 없어 대시보드를 표시하지 못했습니다.</section>;
  return <div className="overview-dashboard">
    <section className="overview-hero panel" aria-label="대시보드 안내"><div><p className="overview-eyebrow"><Star size={13} fill="currentColor"/>MY NEIGHBORHOOD</p><h2>즐겨찾기의 흐름을 한눈에</h2><p>동 {regions.length}곳과 아파트 {apartments.length}곳, 관심 있는 곳의 최근 계약을 모았습니다.</p></div><div className="overview-manage"><button onClick={onManageDongs}><MapPin size={15}/>동 즐겨찾기 관리</button><button onClick={onManageApartments}><Building2 size={15}/>아파트 즐겨찾기 관리</button></div></section>
    <div className="overview-toolbar"><div role="group" aria-label="대시보드 조회 기간">{overviewDurations.map(value=><button key={value} aria-pressed={days===value} onClick={()=>onDaysChange(value)}>최근 {value}일</button>)}</div><p><time dateTime={model.range.start}>{shortDate(model.range.start)}</time> — <time dateTime={model.range.end}>{shortDate(model.range.end)}</time><span>자료 기준일 {shortDate(model.latestDay)}</span></p></div>
    {!hasFavorites?<section className="panel overview-empty" aria-label="대시보드 즐겨찾기 안내"><div className="overview-empty-icon"><ChartNoAxesCombined size={35}/></div><h3>즐겨찾기를 추가해 대시보드를 채워보세요.</h3><p>지역 지도의 동과 아파트 지도의 단지를 별표로 저장하면<br/>거래 활동과 마지막 계약을 이곳에서 함께 볼 수 있습니다.</p><div><button onClick={onManageDongs}><MapPin size={15}/>동 즐겨찾기 추가</button><button className="primary" onClick={onManageApartments}><Building2 size={15}/>아파트 즐겨찾기 추가</button></div></section>:<>
      <OverviewMetrics model={model}/>
      {(model.loading||model.failed||model.uncollected>0||model.partial)&&<div className="overview-data-status" role={model.failed?'alert':'status'}><span>자료 확인 {model.ready} / {regions.length+apartments.length}곳{model.loading?' · 불러오는 중':''}{model.failed?' · 일부 자료 로딩 실패':''}{model.uncollected?' · 미수집 '+model.uncollected+'곳':''}{model.partial?' · 일부 기간 자료 없음':''} · 확인된 자료만 요약합니다.</span>{model.failed&&<button className="text-button" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={14}/>자료 다시 불러오기</button>}</div>}
      <div className="overview-favorite-grid"><FavoriteOverview groups={model.dongGroups} type="dong" days={days} onOpen={onOpenDong} onManage={onManageDongs} range={model.range}/><FavoriteOverview groups={model.apartmentGroups} type="apartment" days={days} onOpen={onOpenApartment} onManage={onManageApartments} range={model.range}/></div>
      <div className="overview-insights"><OverviewTrend model={model}/><RecentOverview model={model} regions={regions} apartments={apartments} onOpenDong={onOpenDong} onOpenApartment={onOpenApartment}/></div>
      <p className="small-note overview-footnote">요약·흐름은 해제 거래를 제외합니다. 이전 기간 비교는 두 기간의 계약월 자료가 모두 있는 경우에만 표시합니다. 최근 계약은 신고 지연과 정정에 따라 추가·변경될 수 있습니다.</p>
    </>}
  </div>;
}
