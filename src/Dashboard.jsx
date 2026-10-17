import React,{useMemo,useState} from 'react';
import {MapPin,Building2,Star,RefreshCw,ArrowRight,Database,CalendarDays} from 'lucide-react';
import {publishedDay} from './weekly.mjs';
import {useDistrictDatasets} from './weekly/useDistrictDatasets.js';
import {buildOverview,overviewDurations} from './dashboard/model.mjs';
import {FavoriteOverview,OverviewMetrics,OverviewTrend,RecentOverview,shortDate} from './dashboard/OverviewWidgets.jsx';
import './dashboard/dashboard.css';
export default function Dashboard({manifest,regions,apartments,days,onDaysChange,districtLoader,onOpenDong,onOpenApartment,onManageDongs,onManageApartments,onSearch}) {
  const [retry,setRetry]=useState(0);
  const codes=useMemo(()=>[...new Set([...regions,...apartments].map(item=>item.region_code))].sort(),[regions,apartments]);
  const latestDay=publishedDay(manifest.published_at),end=new Date((latestDay||'2000-01-01')+'T00:00:00Z');
  const start=new Date(end);start.setUTCDate(start.getUTCDate()-days*2+1);
  const datasets=useDistrictDatasets(manifest,codes,districtLoader,retry,{start:start.toISOString().slice(0,10),end:latestDay,includeLatest:true});
  const model=useMemo(()=>buildOverview({manifest,regions,apartments,datasets,days}),[manifest,regions,apartments,datasets,days]);
  const hasFavorites=regions.length+apartments.length>0;
  if(!model)return <section className="panel notice" role="alert">자료 기준일을 확인할 수 없어 대시보드를 표시하지 못했습니다.</section>;
  return <div className="overview-dashboard">
    {!hasFavorites?<section className="panel dashboard-welcome" aria-label="대시보드 안내"><div><h2>궁금한 아파트의 실거래가부터 찾아보세요.</h2><p>즐겨찾기 없이 바로 조회할 수 있습니다. 저장한 동네와 단지는 이 대시보드에서 모아봅니다.</p></div><button className="primary" onClick={onSearch}>실거래가 검색<ArrowRight size={16}/></button></section>:<section className="dashboard-heading" aria-label="대시보드 안내"><h2>관심 동 {regions.length}곳 · 아파트 {apartments.length}곳</h2><div><button onClick={onManageDongs}>동 즐겨찾기 관리</button><button onClick={onManageApartments}>아파트 즐겨찾기 관리</button></div></section>}
    {hasFavorites&&<div className="overview-toolbar"><div role="group" aria-label="대시보드 조회 기간">{overviewDurations.map(value=><button key={value} aria-pressed={days===value} onClick={()=>onDaysChange(value)}>최근 {value}일</button>)}</div><p><time dateTime={model.range.start}>{shortDate(model.range.start)}</time> — <time dateTime={model.range.end}>{shortDate(model.range.end)}</time><span>{model.latestDay} 기준 최근 기간</span></p></div>}
    {!hasFavorites?<section className="overview-onboarding" aria-label="대시보드 즐겨찾기 안내"><div className="onboarding-heading"><div><p className="section-kicker">MAKE IT YOURS</p><h3>즐겨찾기를 추가해 대시보드를 채워보세요.</h3></div><span><Star size={14}/>나만의 기록 시작하기</span></div><div className="onboarding-cards"><article className="onboarding-card"><span className="onboarding-icon"><MapPin size={23}/></span><div><span className="onboarding-step">01 / NEIGHBORHOOD</span><h4>살펴보고 싶은 동네가 있나요?</h4><p>지역 지도에서 동을 저장하면<br/>동네의 거래 활동을 한눈에 모아볼 수 있어요.</p><button onClick={onManageDongs}>동 즐겨찾기 추가<ArrowRight size={15}/></button></div><span className="onboarding-watermark" aria-hidden="true">01</span></article><article className="onboarding-card"><span className="onboarding-icon apricot"><Building2 size={23}/></span><div><span className="onboarding-step">02 / APARTMENT</span><h4>눈여겨보는 아파트가 있나요?</h4><p>마음에 드는 단지를 별표로 저장하고<br/>최근 계약과 실제 거래금액을 확인해 보세요.</p><button onClick={onManageApartments}>아파트 즐겨찾기 추가<ArrowRight size={15}/></button></div><span className="onboarding-watermark" aria-hidden="true">02</span></article></div><p className="onboarding-note"><Star size={12}/>지도에서 별표를 누르면, 이곳에 우리 동네의 기록이 쌓입니다.</p></section>:<>
      <OverviewMetrics model={model}/>
      {(model.loading||model.failed||model.uncollected>0||model.partial)&&<div className="overview-data-status" role={model.failed?'alert':'status'}><span>자료 확인 {model.ready} / {regions.length+apartments.length}곳{model.loading?' · 불러오는 중':''}{model.failed?' · 일부 자료 로딩 실패':''}{model.uncollected?' · 미수집 '+model.uncollected+'곳':''}{model.partial?' · 일부 기간 자료 없음':''} · 확인된 자료만 요약합니다.</span>{model.failed&&<button className="text-button" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={14}/>자료 다시 불러오기</button>}</div>}
      <div className="overview-favorite-grid"><FavoriteOverview groups={model.dongGroups} type="dong" days={days} onOpen={onOpenDong} onManage={onManageDongs} range={model.range}/><FavoriteOverview groups={model.apartmentGroups} type="apartment" days={days} onOpen={onOpenApartment} onManage={onManageApartments} range={model.range}/></div>
      <div className="overview-insights"><OverviewTrend model={model}/><RecentOverview model={model} regions={regions} apartments={apartments} onOpenDong={onOpenDong} onOpenApartment={onOpenApartment}/></div>
      <p className="small-note overview-footnote">요약·흐름은 해제 거래를 제외합니다. 이전 기간 비교는 두 기간의 계약월 자료가 모두 있는 경우에만 표시합니다. 최근 계약은 신고 지연과 정정에 따라 추가·변경될 수 있습니다.</p>
    </>}
  </div>;
}
