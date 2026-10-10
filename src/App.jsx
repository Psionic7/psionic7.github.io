import React,{lazy,Suspense,useEffect,useMemo,useState} from 'react';
import {House,Building2,CalendarDays,Info,ChartNoAxesCombined,ArrowUpRight,Copy,Database,SlidersHorizontal,Map as MapIcon,MapPin} from 'lucide-react';
import {buildCatalog,formatNumber,monthLabel} from './domain.mjs';
import {fetchJson,loadDistrict} from './data.js';
import {Loading} from './ViewState.jsx';
import {weekBounds} from './weekly.mjs';
import {clearPreferences,readPreferences,restoreExplorer,savePreferences,useStoredState} from './preferences.js';
import {validApartmentFavorites,sameApartmentFavorite} from './apartment-favorites.js';
import {validRegionFavorites} from './region-favorites.js';
import {restoreApartmentQuery,appendTransactionPeriod} from './apartment-query.js';
import {restoreOverviewDays} from './dashboard/model.mjs';
const Dashboard=lazy(()=>import('./Dashboard.jsx'));
const ApartmentMapPage=lazy(()=>import('./ApartmentMapPage.jsx'));
const RegionMapPage=lazy(()=>import('./RegionMapPage.jsx'));
const ApartmentPage=lazy(()=>import('./ApartmentPage.jsx'));
const WeeklyPage=lazy(()=>import('./WeeklyPage.jsx'));
const tabs=[['dashboard','대시보드',ChartNoAxesCombined],['apartments','아파트별 실거래가',Building2],['weekly','동 별 실거래가',CalendarDays],['map','아파트 지도',MapIcon],['regions','지역 지도',MapPin],['about','데이터 안내',Info]];
const timestamp=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'medium',timeStyle:'short'});
export default function App({ initialManifest = null, districtLoader = loadDistrict }) {
  const [manifest, setManifest] = useState(initialManifest), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [preferencesRevision,setPreferencesRevision]=useState(0);
  useEffect(() => {
    if (initialManifest) return;
    let active = true;
    setError('');
    fetchJson(`/data/manifest.json?v=${__DATA_VERSION__}`, true).then(value => { if (active) setManifest(value); })
      .catch(reason => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [initialManifest, revision]);
  if (error) return <main className="startup"><h1>집의 기록</h1><div role="alert" className="notice error">{error}</div><button onClick={() => setRevision(value => value + 1)}>다시 불러오기</button></main>;
  if (!manifest) return <main className="startup"><h1>집의 기록</h1><Loading text="공개 데이터 목록을 불러오는 중입니다." /></main>;
  const resetPreferences=()=>{clearPreferences();window.history.replaceState(null,'','/');setPreferencesRevision(value=>value+1);};
  return <Explorer key={preferencesRevision} manifest={manifest} districtLoader={districtLoader} onResetPreferences={resetPreferences} />;
}


function Explorer({manifest,districtLoader,onResetPreferences}) {
  const catalog=useMemo(()=>buildCatalog(manifest.regions),[manifest]);
  const [apartmentFavorites,setApartmentFavorites]=useStoredState('viewer','apartments',[],validApartmentFavorites);
  const [regionFavorites,setRegionFavorites]=useStoredState('viewer','regions',[],validRegionFavorites);
  const favorites=useMemo(()=>{const byId=new Map(catalog.map(region=>[region.region_id,region]));return regionFavorites.map(id=>byId.get(id)).filter(Boolean);},[catalog,regionFavorites]);
  const initial=useMemo(()=>restoreExplorer(manifest,catalog,new URLSearchParams(window.location.search)),[]);
  const apartmentInitial=useMemo(()=>restoreApartmentQuery(manifest,catalog,new URLSearchParams(window.location.search),apartmentFavorites),[]);
  const [tab,setTab]=useState(initial.tab),[weeklyIds,setWeeklyIds]=useState(initial.weeklyIds),[weeklyDay,setWeeklyDay]=useState(initial.weeklyDay),[weeklyPeriod,setWeeklyPeriod]=useState(initial.weeklyPeriod);
  const [selectedApartments,setSelectedApartments]=useState(apartmentInitial.selected),[searchRegionId,setSearchRegionId]=useState(apartmentInitial.regionId),[apartmentDay,setApartmentDay]=useState(apartmentInitial.day),[apartmentPeriod,setApartmentPeriod]=useState(apartmentInitial.period);
  const [apartmentFilters,setApartmentFilters]=useState(apartmentInitial.filters);
  const [dashboardDays,setDashboardDays]=useState(()=>restoreOverviewDays(new URLSearchParams(window.location.search),readPreferences('overview').days));
  const [copied,setCopied]=useState(false);
  const toggleRegionFavorite=id=>{if(catalog.some(region=>region.region_id===id&&region.dongs.length===1))setRegionFavorites(previous=>previous.includes(id)?previous.filter(saved=>saved!==id):previous.length<2000?[...previous,id]:previous);};
  const toggleApartmentFavorite=item=>setApartmentFavorites(previous=>previous.some(saved=>sameApartmentFavorite(saved,item))?previous.filter(saved=>!sameApartmentFavorite(saved,item)):previous.length<1000?[...previous,item]:previous);
  const openOverviewDong=(item,range,includeCancelled=false)=>{setWeeklyIds([item.region_id]);setWeeklyPeriod(previous=>({...previous,mode:'custom',...range}));savePreferences('weekly',{...readPreferences('weekly'),minArea:'',maxArea:'',areaBands:[],includeCancelled});setTab('weekly');};
  const openOverviewApartment=(item,range,includeCancelled=false)=>{setSelectedApartments([item]);setApartmentPeriod(previous=>({...previous,mode:'custom',...range}));setSearchRegionId('area_'+item.region_code);setApartmentFilters({province:'',city:'',district:'',search:''});savePreferences('apartmentTransactions',{...readPreferences('apartmentTransactions'),minArea:'',maxArea:'',areaBands:[],includeCancelled});setTab('apartments');};
  useEffect(()=>{savePreferences('overview',{days:dashboardDays});},[dashboardDays]);
  useEffect(()=>{savePreferences('explorer',{...readPreferences('explorer'),tab,weeklyIds,weeklyDay,weeklyPeriod});},[tab,weeklyIds,weeklyDay,weeklyPeriod]);
  useEffect(()=>{savePreferences('apartmentTransactions',{...readPreferences('apartmentTransactions'),selected:selectedApartments,regionId:searchRegionId,day:apartmentDay,period:apartmentPeriod});},[selectedApartments,searchRegionId,apartmentDay,apartmentPeriod]);
  useEffect(()=>{savePreferences('apartmentSearch',{...readPreferences('apartmentSearch'),filters:apartmentFilters});},[apartmentFilters]);
  useEffect(()=>{
    const params=new URLSearchParams({tab});
    if(tab==='dashboard')params.set('days',String(dashboardDays));
    if(tab==='weekly'){weeklyIds.forEach(id=>params.append('dong',id));appendTransactionPeriod(params,weeklyPeriod,weeklyDay);}
    if(tab==='apartments'){if(searchRegionId)params.set('region',searchRegionId);if(selectedApartments.length)selectedApartments.forEach(item=>params.append('apt',JSON.stringify(item)));else params.set('apt','');appendTransactionPeriod(params,apartmentPeriod,apartmentDay);}
    window.history.replaceState(null,'','?'+params);
  },[tab,weeklyIds,weeklyDay,weeklyPeriod,selectedApartments,searchRegionId,apartmentDay,apartmentPeriod,dashboardDays]);
  const share=async()=>{try{await navigator.clipboard.writeText(window.location.href);setCopied(true);setTimeout(()=>setCopied(false),2500);}catch{window.prompt('이 주소를 복사해 주세요.',window.location.href);}};
  return <div className="app-shell public-shell"><main className="main-content">
    <div className="site-brand"><a className="brand" href="/"><span className="brand-icon"><House size={25}/></span><span>집의 기록<small>아파트 실거래 아카이브</small></span></a><span className="small-note">자료 업데이트 {timestamp(manifest.published_at)} KST</span></div>
    <header className="page-header"><div><p className="eyebrow">HOME RECORDS / REAL TRANSACTIONS</p><h1>실거래로 읽는 우리 동네</h1><p>지역과 기간을 골라 거래의 흐름을 살펴보세요.</p></div><button className="share-button" onClick={share}><Copy size={15}/>{copied?'주소 복사됨':'조회 주소 복사'}</button></header>
    <nav className="tabs" aria-label="조회 화면">{tabs.map(([id,label,Icon])=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}><Icon size={17}/>{label}</button>)}</nav>
    <section className="tab-content" role="tabpanel" aria-label={tabs.find(([id])=>id===tab)[1]}>
      <Suspense fallback={<Loading text="조회 화면을 준비하고 있습니다."/>}>
        {tab==='dashboard'?<Dashboard manifest={manifest} regions={favorites} apartments={apartmentFavorites} days={dashboardDays} onDaysChange={setDashboardDays} districtLoader={districtLoader} onOpenDong={openOverviewDong} onOpenApartment={openOverviewApartment} onManageDongs={()=>setTab('regions')} onManageApartments={()=>setTab('map')}/>
        :tab==='apartments'?<ApartmentPage manifest={manifest} catalog={catalog} favorites={apartmentFavorites} favoriteRegions={favorites} selected={selectedApartments} onChange={setSelectedApartments} searchRegionId={searchRegionId} onSearchRegionChange={setSearchRegionId} searchFilters={apartmentFilters} onSearchFiltersChange={setApartmentFilters} day={apartmentDay} onDayChange={value=>setApartmentDay(weekBounds(value)?.start||'')} period={apartmentPeriod} onPeriodChange={setApartmentPeriod} districtLoader={districtLoader} onToggleFavorite={toggleApartmentFavorite}/>
        :tab==='weekly'?<WeeklyPage manifest={manifest} catalog={catalog} favoriteRegions={favorites} selectedIds={weeklyIds} onChange={setWeeklyIds} day={weeklyDay} onDayChange={value=>setWeeklyDay(weekBounds(value)?.start||'')} period={weeklyPeriod} onPeriodChange={setWeeklyPeriod} districtLoader={districtLoader}/>
        :tab==='map'?<ApartmentMapPage manifest={manifest} favorites={apartmentFavorites} onToggleFavorite={toggleApartmentFavorite}/>
        :tab==='regions'?<RegionMapPage catalog={catalog} favorites={regionFavorites} onToggleFavorite={toggleRegionFavorite}/>
        :<About manifest={manifest} onResetPreferences={onResetPreferences}/>}
      </Suspense>
    </section><footer className="page-footer">자료: 국토교통부 아파트 매매 실거래가 · 신고 자료의 정정과 해제에 따라 값이 달라질 수 있습니다.</footer>
  </main></div>;
}
function About({ manifest,onResetPreferences }) {
  const covered = Object.keys(manifest.districts);
  return <div className="about-grid">
    <section className="panel"><div className="panel-heading"><SlidersHorizontal size={19}/><h2>이 브라우저의 조회 설정</h2></div><p>마지막 조회 지역·기간·탭, 아파트 즐겨찾기와 면적, 주간 조회 동, 검색·필터·면적 단위를 자동으로 기억합니다. 창을 닫았다 다시 열어도 같은 기기와 브라우저에서 복원됩니다.</p><p className="small-note">조회 설정은 이 브라우저에 보관됩니다. 다른 기기나 브라우저에는 공유되지 않으며, 시크릿 모드 종료나 사이트 데이터 삭제 시 사라질 수 있습니다. 공유 링크에 지정된 조건은 저장된 조건보다 우선합니다.</p><button onClick={onResetPreferences}>이 브라우저의 조회 설정 초기화</button></section>
    <section className="panel"><div className="panel-heading"><Database size={19} /><h2>공개 데이터</h2></div><p>로컬에서 수집한 아파트 매매 신고 자료를 공개합니다. 조회 화면은 마지막으로 배포한 자료를 사용합니다.</p>
      <dl className="info-list"><div><dt>전체 거래</dt><dd>{formatNumber(manifest.count)}건</dd></div><div><dt>계약월</dt><dd>{monthLabel(manifest.months[0])} — {monthLabel(manifest.months.at(-1))}</dd></div><div><dt>데이터 생성</dt><dd>{timestamp(manifest.published_at)} KST</dd></div><div><dt>지역 목록</dt><dd>{formatNumber(manifest.regions.length)}개 · 서울 / 경기</dd></div></dl>
      <h3>수집된 시군구</h3>{covered.map(code => <p className="coverage-row" key={code}><span>{manifest.regions.find(item => item.region_code === code)?.region_name || code}</span><strong>{formatNumber(manifest.districts[code].count)}건</strong></p>)}
      <a className="button primary" href={`/data/${manifest.database?.file||'public.sqlite3'}`} download><Database size={15} />공개 SQLite 다운로드{manifest.database?.format==='sqlite3+gzip'?' (.gz)':''}</a>
      {manifest.database?.format==='sqlite3+gzip'&&<p className="small-note">전체 거래가 담긴 SQLite 압축 파일입니다. 다운로드 후 gzip 압축을 풀면 public.sqlite3로 사용할 수 있습니다.</p>}
    </section>
    <section className="panel"><div className="panel-heading"><Info size={19} /><h2>데이터를 읽는 방법</h2></div><ul className="reading-guide"><li><strong>아파트별 실거래가</strong>는 즐겨찾기나 지역 검색으로 선택한 아파트를 보여줍니다. 동 별 실거래가와 같은 기간·면적·해제 거래 필터와 거래표를 사용합니다.</li><li><strong>원천 데이터</strong>는 로컬 관리자 전용입니다. 관리자 화면의 원천 데이터 탭에서 해제 거래를 포함한 전체 필드 조회·필터·CSV 다운로드를 사용할 수 있습니다.</li><li><strong>아파트 즐겨찾기</strong>는 각 사용자가 별표로 선택한 단지이며 이 브라우저에 저장됩니다. 지역 즐겨찾기는 지역 지도에서 별표로 선택하며 아파트 즐겨찾기와 함께 이 브라우저에 저장됩니다.</li><li><strong>지역 목록</strong>은 {manifest.boundary_catalog_date} 법정읍면동 경계 자료에 기반합니다. 이후 행정구역 개편은 반영되지 않을 수 있습니다.</li><li><strong>전용평</strong>은 전용면적 ÷ 3.305785로 계산합니다. 공급면적을 기준으로 하는 분양 평형과 다릅니다.</li></ul></section>
    <section className="panel local-guide"><div className="panel-heading"><House size={19} /><h2>데이터 수집 · 관리</h2></div><p>GitHub Actions에서 매일 예약 수집·주소 조회·검사·배포를 실행합니다. 저장소 관리자는 웹 관리자에서 예약 시간과 수집 지역을 변경하고 수동 실행할 수 있습니다.</p><p><a className="button" href="/admin.html">웹 수집 관리자 <ArrowUpRight size={14} /></a></p><p>관리자의 PC에서는 <code>run-admin.bat</code>으로 원천 자료 조회와 별도 수집을 사용할 수 있습니다. 로컬 수집 DB와 클라우드 수집 DB는 각각 관리됩니다.</p><p className="small-note">API 키는 GitHub Secrets에 보관합니다. 공개 SQLite·JSON과 사이트 소스는 누구나 내려받을 수 있습니다.</p><a href="https://github.com/Psionic7/psionic7.github.io#자동-수집과-웹-관리자" target="_blank" rel="noreferrer">데이터 갱신 안내 <ArrowUpRight size={14} /></a></section>
  </div>;
}
