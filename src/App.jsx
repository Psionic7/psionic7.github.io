import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { House, ChartNoAxesCombined, Building2, CalendarDays, Info, Search, ArrowUpRight, Copy, Database, SlidersHorizontal, Star, Map } from 'lucide-react';
import { buildCatalog, favoriteRegions, formatNumber, hierarchy, monthLabel, scopeRows } from './domain.mjs';
import { fetchJson, loadDistrict } from './data.js';
import {Empty,Loading} from './ViewState.jsx';
import {weekBounds} from './weekly.mjs';
import {clearPreferences,restoreExplorer,savePreferences,useStoredState} from './preferences.js';
import {validApartmentFavorites,sameApartmentFavorite} from './apartment-favorites.js';
const ApartmentMapPage = lazy(() => import('./ApartmentMapPage.jsx'));
const Dashboard = lazy(() => import('./Dashboard.jsx'));
const ApartmentPage = lazy(() => import('./ApartmentPage.jsx'));
const WeeklyPage = lazy(() => import('./WeeklyPage.jsx'));
const tabs = [['dashboard', '대시보드', ChartNoAxesCombined], ['apartments', '아파트별 실거래가', Building2], ['weekly', '동 별 실거래가', CalendarDays], ['map', '아파트 지도', Map], ['about', '데이터 안내', Info]];
const unique = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'ko'));
const timestamp = value => new Date(value).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short'});

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

function Explorer({ manifest, districtLoader,onResetPreferences }) {
  const catalog = useMemo(() => buildCatalog(manifest.regions), [manifest]);
  const favorites = useMemo(() => favoriteRegions(manifest, catalog), [manifest, catalog]);
  const initial = useMemo(() => restoreExplorer(manifest,catalog,new URLSearchParams(window.location.search)), []);
  const [regionId, setRegionId] = useState(initial.regionId);
  const region = catalog.find(item => item.region_id === regionId) || null;
  const regionCode = region?.region_code;
  const available = manifest.districts[regionCode]?.months || manifest.months;
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [tab, setTab] = useState(initial.tab);
  const isWeekly = tab === 'weekly',isApartment=tab==='apartments';
  const [apartmentFavorites,setApartmentFavorites]=useStoredState('viewer','apartments',[],validApartmentFavorites);
  const toggleApartmentFavorite=item=>setApartmentFavorites(previous=>previous.some(saved=>sameApartmentFavorite(saved,item))?previous.filter(saved=>!sameApartmentFavorite(saved,item)):[...previous,item]);
  const openFavorite=(item,range)=>{
    setRegionId('area_'+item.region_code);setProvince('');setCity('');setDistrict('');setSearch('');setSelectedApartment(item.master_id?(item.trade_keys[0]||item.key):item.key);
    const months=manifest.districts[item.region_code]?.months||manifest.months;
    const from=range?.start.replaceAll('-','').slice(0,6),to=range?.end.replaceAll('-','').slice(0,6);
    setStart(months.includes(from)?from:months[0]||'');setEnd(months.includes(to)?to:months.at(-1)||'');
    setTab('apartments');document.querySelector('.tabs')?.scrollIntoView?.({block:'start'});
  };
  const [weeklyIds,setWeeklyIds] = useState(initial.weeklyIds);
  const [weeklyDay,setWeeklyDay] = useState(initial.weeklyDay);
  const [weeklyPeriod,setWeeklyPeriod] = useState(initial.weeklyPeriod);
  const [selectedApartment, setSelectedApartment] = useState(initial.selectedApartment);
  const [province, setProvince] = useState(initial.province), [city, setCity] = useState(initial.city), [district, setDistrict] = useState(initial.district);
  const [search, setSearch] = useState(initial.search), [rows, setRows] = useState([]), [busy, setBusy] = useState(true);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    if (!isApartment) return;
    if (!regionCode) { setRows([]); setBusy(false); setError(''); return; }
    setBusy(true); setError('');
    districtLoader(manifest, regionCode).then(value => { if (active) { setRows(value); setBusy(false); } })
      .catch(reason => { if (active) { setError(reason.message); setBusy(false); } });
    return () => { active = false; };
  }, [manifest, regionCode, districtLoader, retry, isApartment]);
  useEffect(() => {
    const params = new URLSearchParams({tab});
    if (isWeekly) {
      weeklyIds.forEach(id=>params.append('dong',id));params.set('period',weeklyPeriod.mode);
      if(weeklyPeriod.mode==='week'&&weeklyDay)params.set('week',weeklyDay);
      if(weeklyPeriod.mode==='month')params.set('month',weeklyPeriod.month);
      if(weeklyPeriod.mode==='custom'){params.set('from',weeklyPeriod.start);params.set('to',weeklyPeriod.end);}
    }
    else if (isApartment && region) { params.set('region', region.region_id); params.set('start', start); params.set('end', end); }
    window.history.replaceState(null, '', `?${params}`);
  }, [regionId, start, end, tab, weeklyIds, weeklyDay,weeklyPeriod]);
  useEffect(()=>{
    savePreferences('explorer',{regionId,start,end,tab,weeklyIds,weeklyDay,weeklyPeriod,selectedApartment,province,city,district,search});
  },[regionId,start,end,tab,weeklyIds,weeklyDay,weeklyPeriod,selectedApartment,province,city,district,search]);
  const choices = catalog.filter(item => {
    const location = hierarchy(item);
    return (!province || location.province === province) && (!city || location.city === city) &&
      (!district || location.district === district) && (!search.trim() || item.label.includes(search.trim()) || item.region_name.includes(search.trim()));
  });
  const provinces = unique(catalog.map(item => hierarchy(item).province));
  const cities = unique(catalog.filter(item => !province || hierarchy(item).province === province).map(item => hierarchy(item).city));
  const districts = unique(catalog.filter(item => (!province || hierarchy(item).province === province) && (!city || hierarchy(item).city === city)).map(item => hierarchy(item).district));
  const data = useMemo(() => region ? scopeRows(rows, region, start, end) : [], [rows, region, start, end]);
  const chooseRegion = id => {
    const next = catalog.find(item => item.region_id === id);
    setRegionId(id);
    setSelectedApartment('');
    const months = manifest.districts[next.region_code]?.months || manifest.months;
    if (!months.includes(start) || !months.includes(end)) {
      setStart(months[Math.max(0, months.length - 12)] || ''); setEnd(months.at(-1) || '');
    }
  };
  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { setCopied(false); window.prompt('이 주소를 복사해 주세요.', window.location.href); }
  };
  const resetLocation = () => { setProvince(''); setCity(''); setDistrict(''); setSearch(''); };
  return <div className="app-shell public-shell">
    <main className="main-content">
      <div className="site-brand"><a className="brand" href="/"><span className="brand-icon"><House size={25} /></span><span>집의 기록<small>아파트 실거래 아카이브</small></span></a><span className="small-note">자료 업데이트 {timestamp(manifest.published_at)} KST</span></div>
      <header className="page-header"><div><p className="eyebrow">HOME RECORDS / REAL TRANSACTIONS</p><h1>실거래로 읽는 우리 동네</h1><p>지역과 기간을 골라 거래의 흐름을 살펴보세요.</p></div><button className="share-button" onClick={share}><Copy size={15} />{copied ? '주소 복사됨' : '조회 주소 복사'}</button></header>
      <nav className="tabs" aria-label="조회 화면">{tabs.map(([id, label, Icon]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={17} />{label}</button>)}</nav>
      <section className="tab-content" role="tabpanel" aria-label={tabs.find(([id]) => id === tab)[1]}>
      {isApartment && <>
      <section className="panel query-panel" aria-label="조회 조건">
      <div className="sidebar-heading"><SlidersHorizontal size={16} /><h2>조회 조건</h2></div>
      <section className="favorites-section" aria-label="즐겨찾기 지역"><div className="filter-heading"><span><Star size={14} /> 즐겨찾기</span><small>{favorites.length}곳</small></div>
        {favorites.length ? <div className="favorite-regions">{favorites.map(item => <button key={item.region_id} className={regionId === item.region_id ? 'selected' : ''} onClick={() => { resetLocation(); chooseRegion(item.region_id); }}><Star size={13} fill="currentColor" /><span>{item.dongs.length === 1 ? item.dongs[0] : item.label}<small>{item.region_name}</small></span></button>)}</div> : <p className="small-note">등록된 즐겨찾기 지역이 없습니다.</p>}
      </section>
      <div className="location-filters">
      <div className="filter-heading"><span>시 · 구 · 동 찾기</span><button className="text-button" onClick={resetLocation}>초기화</button></div>
      <label>시도<select value={province} onChange={event => {setProvince(event.target.value); setCity(''); setDistrict('');}}><option value="">전체 시도</option>{provinces.map(value => <option key={value}>{value}</option>)}</select></label>
      <div className="two-fields"><label>시<select value={city} onChange={event => {setCity(event.target.value); setDistrict('');}}><option value="">전체 시</option>{cities.map(value => <option key={value}>{value}</option>)}</select></label><label>구<select value={district} onChange={event => setDistrict(event.target.value)}><option value="">전체 구</option>{districts.map(value => <option key={value}>{value}</option>)}</select></label></div>
      <label className="search-input"><span>지역 검색</span><Search size={16} /><input type="search" placeholder="동 이름 또는 지역명" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label>조회 지역<select value={choices.some(item => item.region_id === regionId) ? regionId : ''} onChange={event => chooseRegion(event.target.value)}><option value="" disabled>지역 선택 ({formatNumber(choices.length)}곳)</option>{choices.map(item => <option key={item.region_id} value={item.region_id}>{item.label}{manifest.districts[item.region_code] ? '' : ' · 미수집'}</option>)}</select></label>
      <p className="small-note">구 전체 또는 법정동을 선택할 수 있습니다.<br />현재 조회: <strong>{region?.label || '선택한 지역 없음'}</strong>{region && <button className="text-button clear-region" onClick={() => setRegionId('')}>조회 선택 해제</button>}</p>
      </div>
      <div className="period-filters">
      <span className="filter-heading">계약월 범위</span>
      <div className="two-fields"><label>시작 계약월<select disabled={!region} value={start} onChange={event => { setStart(event.target.value); if (event.target.value > end) setEnd(event.target.value); }}>{available.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label><label>종료 계약월<select disabled={!region} value={end} onChange={event => {setEnd(event.target.value); if (event.target.value < start) setStart(event.target.value);}}>{available.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label></div>
      {region && <div className="scope-card"><span className="status-dot" /><div><strong>{region.region_name}</strong><small>시군구 코드 {region.region_code}</small>{region.dongs.length > 0 && <small>{region.dongs.join(' · ')}</small>}</div></div>}
      <p className="small-note">선택한 지역·기간의 아파트별 실거래가를 조회합니다. 조회 조건은 이 브라우저에 자동 저장됩니다.</p>
      </div>
      </section>
      <div className="context-line"><strong>{region?.label || '조회할 지역을 선택해 주세요'}</strong>{region && <><span>{monthLabel(start)} — {monthLabel(end)}</span><span>{formatNumber(data.length)}건의 원천 자료</span></>}</div>
      </>}
      {tab==='map'?<Suspense fallback={<Loading text="아파트 지도를 준비하고 있습니다."/>}><ApartmentMapPage manifest={manifest} favorites={apartmentFavorites} onToggleFavorite={toggleApartmentFavorite}/></Suspense>:tab==='dashboard'?<Suspense fallback={<Loading text="즐겨찾기 대시보드를 준비하고 있습니다."/>}><Dashboard manifest={manifest} catalog={catalog} favorites={apartmentFavorites} onRemoveFavorite={id=>setApartmentFavorites(previous=>previous.filter(item=>item.id!==id))} onOpenApartment={openFavorite} onAddApartments={()=>setTab('apartments')} districtLoader={districtLoader}/></Suspense>:isWeekly ? <Suspense fallback={<Loading text="주간 조회를 준비하고 있습니다." />}><WeeklyPage manifest={manifest} catalog={catalog} selectedIds={weeklyIds} onChange={setWeeklyIds} day={weeklyDay} period={weeklyPeriod} onPeriodChange={setWeeklyPeriod} onDayChange={value=>setWeeklyDay(weekBounds(value)?.start||'')} districtLoader={districtLoader}/></Suspense> : tab === 'about' ? <About manifest={manifest} onResetPreferences={onResetPreferences} /> : !region ? <section className="panel"><Empty title="조회할 지역을 선택해 주세요.">{favorites.length ? '위의 즐겨찾기에서 지역을 고르거나 시·구·동으로 검색하세요.' : '위의 시·구·동 필터에서 조회할 지역을 고르세요.'}</Empty></section> : busy ? <Loading /> : error ? <div className="notice error" role="alert">{error}<button onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></div> :
        <Suspense fallback={<Loading text="조회 화면을 준비하고 있습니다." />}>
          <ApartmentPage key={region.region_id} rows={data} region={region} start={start} end={end} selectedKey={selectedApartment} onSelect={setSelectedApartment} favorites={apartmentFavorites} onToggleFavorite={toggleApartmentFavorite}/>
        </Suspense>}
      </section>
      <footer className="page-footer">자료: 국토교통부 아파트 매매 실거래가 · 신고 자료의 정정과 해제에 따라 값이 달라질 수 있습니다.</footer>
    </main>
  </div>;
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
    <section className="panel"><div className="panel-heading"><Info size={19} /><h2>데이터를 읽는 방법</h2></div><ul className="reading-guide"><li><strong>대시보드</strong>는 이 브라우저에서 즐겨찾기한 아파트들을 보여줍니다. 거래표에는 해제 거래도 표시할 수 있으며 최저·최고가와 최근 거래가격은 유효 거래만으로 계산합니다.</li><li><strong>원천 데이터</strong>는 로컬 관리자 전용입니다. 관리자 화면의 원천 데이터 탭에서 해제 거래를 포함한 전체 필드 조회·필터·CSV 다운로드를 사용할 수 있습니다.</li><li><strong>아파트 즐겨찾기</strong>는 각 사용자가 별표로 선택한 단지이며 이 브라우저에 저장됩니다. 아파트별 조회의 즐겨찾기 지역은 관리자가 저장한 수집 지역입니다.</li><li><strong>지역 목록</strong>은 {manifest.boundary_catalog_date} 법정읍면동 경계 자료에 기반합니다. 이후 행정구역 개편은 반영되지 않을 수 있습니다.</li><li><strong>전용평</strong>은 전용면적 ÷ 3.305785로 계산합니다. 공급면적을 기준으로 하는 분양 평형과 다릅니다.</li></ul></section>
    <section className="panel local-guide"><div className="panel-heading"><House size={19} /><h2>데이터 수집 · 관리</h2></div><p>GitHub Actions에서 매일 예약 수집·주소 조회·검사·배포를 실행합니다. 저장소 관리자는 웹 관리자에서 예약 시간과 수집 지역을 변경하고 수동 실행할 수 있습니다.</p><p><a className="button" href="/admin.html">웹 수집 관리자 <ArrowUpRight size={14} /></a></p><p>관리자의 PC에서는 <code>run-admin.bat</code>으로 원천 자료 조회와 별도 수집을 사용할 수 있습니다. 로컬 수집 DB와 클라우드 수집 DB는 각각 관리됩니다.</p><p className="small-note">API 키는 GitHub Secrets에 보관합니다. 공개 SQLite·JSON과 사이트 소스는 누구나 내려받을 수 있습니다.</p><a href="https://github.com/Psionic7/psionic7.github.io#자동-수집과-웹-관리자" target="_blank" rel="noreferrer">데이터 갱신 안내 <ArrowUpRight size={14} /></a></section>
  </div>;
}
