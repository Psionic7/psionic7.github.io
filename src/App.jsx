import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { House, ChartNoAxesCombined, Table2, Info, Search, ArrowUpRight, Copy, RefreshCw, Database, SlidersHorizontal, Star } from 'lucide-react';
import { buildCatalog, favoriteRegions, formatNumber, hierarchy, monthLabel, scopeRows } from './domain.mjs';
import { fetchJson, loadDistrict } from './data.js';
import RawTable from './RawTable.jsx';
const Dashboard = lazy(() => import('./Dashboard.jsx'));
const tabs = [['dashboard', '대시보드', ChartNoAxesCombined], ['raw', '원천 데이터', Table2], ['about', '데이터 안내', Info]];
const unique = values => [...new Set(values)].sort((a, b) => a.localeCompare(b, 'ko'));
const timestamp = value => new Date(value).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short'});

export function Loading({ text = '실거래 데이터를 불러오는 중입니다.' }) {
  return <div className="loading" role="status"><RefreshCw size={22} className="spin" />{text}</div>;
}
export function Empty({ title = '이 조건에 해당하는 실거래가 없습니다.', children }) {
  return <div className="empty"><Database size={32} /><h3>{title}</h3><p>{children || '지역이나 계약월, 면적 조건을 바꿔 보세요.'}</p></div>;
}
export default function App({ initialManifest = null, districtLoader = loadDistrict }) {
  const [manifest, setManifest] = useState(initialManifest), [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
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
  return <Explorer manifest={manifest} districtLoader={districtLoader} />;
}

function Explorer({ manifest, districtLoader }) {
  const catalog = useMemo(() => buildCatalog(manifest.regions), [manifest]);
  const favorites = useMemo(() => favoriteRegions(manifest, catalog), [manifest, catalog]);
  const initial = useMemo(() => new URLSearchParams(window.location.search), []);
  const [regionId, setRegionId] = useState(catalog.some(item => item.region_id === initial.get('region')) ? initial.get('region') : '');
  const region = catalog.find(item => item.region_id === regionId) || null;
  const regionCode = region?.region_code;
  const available = manifest.districts[regionCode]?.months || manifest.months;
  const initialEnd = available.includes(initial.get('end')) ? initial.get('end') : (available.at(-1) || '');
  const [start, setStart] = useState(available.includes(initial.get('start')) && initial.get('start') <= initialEnd ? initial.get('start') : (available.filter(value => value <= initialEnd).slice(-12)[0] || ''));
  const [end, setEnd] = useState(available.includes(initial.get('end')) ? initial.get('end') : (available.at(-1) || ''));
  const [tab, setTab] = useState(tabs.some(([value]) => value === initial.get('tab')) ? initial.get('tab') : 'dashboard');
  const [province, setProvince] = useState(''), [city, setCity] = useState(''), [district, setDistrict] = useState('');
  const [search, setSearch] = useState(''), [rows, setRows] = useState([]), [busy, setBusy] = useState(true);
  const [error, setError] = useState(''), [retry, setRetry] = useState(0), [copied, setCopied] = useState(false);
  useEffect(() => {
    let active = true;
    if (!regionCode) { setRows([]); setBusy(false); setError(''); return; }
    setBusy(true); setError('');
    districtLoader(manifest, regionCode).then(value => { if (active) { setRows(value); setBusy(false); } })
      .catch(reason => { if (active) { setError(reason.message); setBusy(false); } });
    return () => { active = false; };
  }, [manifest, regionCode, districtLoader, retry]);
  useEffect(() => {
    const params = new URLSearchParams({tab});
    if (region) { params.set('region', region.region_id); params.set('start', start); params.set('end', end); }
    window.history.replaceState(null, '', `?${params}`);
  }, [regionId, start, end, tab]);
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
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="/"><span className="brand-icon"><House size={25} /></span><span>집의 기록<small>아파트 실거래 아카이브</small></span></a>
      <div className="sidebar-heading"><SlidersHorizontal size={16} /><h2>조회 조건</h2></div>
      <section className="favorites-section" aria-label="즐겨찾기 지역"><div className="filter-heading"><span><Star size={14} /> 즐겨찾기</span><small>{favorites.length}곳</small></div>
        {favorites.length ? <div className="favorite-regions">{favorites.map(item => <button key={item.region_id} className={regionId === item.region_id ? 'selected' : ''} onClick={() => { resetLocation(); chooseRegion(item.region_id); }}><Star size={13} fill="currentColor" /><span>{item.dongs.length === 1 ? item.dongs[0] : item.label}<small>{item.region_name}</small></span></button>)}</div> : <p className="small-note">등록된 즐겨찾기 지역이 없습니다.</p>}
      </section>
      <div className="filter-heading"><span>시 · 구 · 동 찾기</span><button className="text-button" onClick={resetLocation}>초기화</button></div>
      <label>시도<select value={province} onChange={event => {setProvince(event.target.value); setCity(''); setDistrict('');}}><option value="">전체 시도</option>{provinces.map(value => <option key={value}>{value}</option>)}</select></label>
      <div className="two-fields"><label>시<select value={city} onChange={event => {setCity(event.target.value); setDistrict('');}}><option value="">전체 시</option>{cities.map(value => <option key={value}>{value}</option>)}</select></label><label>구<select value={district} onChange={event => setDistrict(event.target.value)}><option value="">전체 구</option>{districts.map(value => <option key={value}>{value}</option>)}</select></label></div>
      <label className="search-input"><span>지역 검색</span><Search size={16} /><input type="search" placeholder="동 이름 또는 지역명" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label>조회 지역<select value={choices.some(item => item.region_id === regionId) ? regionId : ''} onChange={event => chooseRegion(event.target.value)}><option value="" disabled>지역 선택 ({formatNumber(choices.length)}곳)</option>{choices.map(item => <option key={item.region_id} value={item.region_id}>{item.label}{manifest.districts[item.region_code] ? '' : ' · 미수집'}</option>)}</select></label>
      <p className="small-note">구 전체 또는 법정동을 선택할 수 있습니다.<br />현재 조회: <strong>{region?.label || '선택한 지역 없음'}</strong>{region && <button className="text-button clear-region" onClick={() => setRegionId('')}>조회 선택 해제</button>}</p>
      <div className="sidebar-divider" />
      <span className="filter-heading">계약월 범위</span>
      <div className="two-fields"><label>시작 계약월<select disabled={!region} value={start} onChange={event => { setStart(event.target.value); if (event.target.value > end) setEnd(event.target.value); }}>{available.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label><label>종료 계약월<select disabled={!region} value={end} onChange={event => {setEnd(event.target.value); if (event.target.value < start) setStart(event.target.value);}}>{available.map(value => <option key={value} value={value}>{monthLabel(value)}</option>)}</select></label></div>
      {region && <div className="scope-card"><span className="status-dot" /><div><strong>{region.region_name}</strong><small>시군구 코드 {region.region_code}</small>{region.dongs.length > 0 && <small>{region.dongs.join(' · ')}</small>}</div></div>}
      <div className="sidebar-footer"><span className="badge">공개 데이터 조회</span><p>자료 업데이트<br /><strong>{timestamp(manifest.published_at)} KST</strong></p><a href="https://github.com/Psionic7/psionic7.github.io" target="_blank" rel="noreferrer">GitHub 프로젝트 <ArrowUpRight size={14} /></a></div>
    </aside>
    <main className="main-content">
      <header className="page-header"><div><p className="eyebrow">HOME RECORDS / REAL TRANSACTIONS</p><h1>실거래로 읽는 우리 동네</h1><p>지역과 기간을 골라 거래의 흐름을 살펴보세요.</p></div><button className="share-button" onClick={share}><Copy size={15} />{copied ? '주소 복사됨' : '조회 주소 복사'}</button></header>
      <div className="context-line"><strong>{region?.label || '조회할 지역을 선택해 주세요'}</strong>{region && <><span>{monthLabel(start)} — {monthLabel(end)}</span><span>{formatNumber(data.length)}건의 원천 자료</span></>}</div>
      <nav className="tabs" aria-label="조회 화면">{tabs.map(([id, label, Icon]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={17} />{label}</button>)}</nav>
      {tab === 'about' ? <About manifest={manifest} /> : !region ? <section className="panel"><Empty title="조회할 지역을 선택해 주세요.">{favorites.length ? '왼쪽 즐겨찾기에서 지역을 고르거나 시·구·동으로 검색하세요.' : '왼쪽의 시·구·동 필터에서 조회할 지역을 고르세요.'}</Empty></section> : busy ? <Loading /> : error ? <div className="notice error" role="alert">{error}<button onClick={() => setRetry(value => value + 1)}>다시 불러오기</button></div> :
        tab === 'raw' ? <RawTable key={region.region_id} rows={data} region={region} start={start} end={end} /> :
        <Suspense fallback={<Loading text="대시보드를 준비하고 있습니다." />}><Dashboard key={region.region_id} rows={data} region={region} manifest={manifest} favorites={favorites} start={start} end={end} districtLoader={districtLoader} /></Suspense>}
      <footer className="page-footer">자료: 국토교통부 아파트 매매 실거래가 · 신고 자료의 정정과 해제에 따라 값이 달라질 수 있습니다.</footer>
    </main>
  </div>;
}

function About({ manifest }) {
  const covered = Object.keys(manifest.districts);
  return <div className="about-grid">
    <section className="panel"><div className="panel-heading"><Database size={19} /><h2>공개 데이터</h2></div><p>로컬에서 수집한 아파트 매매 신고 자료를 공개합니다. 조회 화면은 마지막으로 배포한 자료를 사용합니다.</p>
      <dl className="info-list"><div><dt>전체 거래</dt><dd>{formatNumber(manifest.count)}건</dd></div><div><dt>계약월</dt><dd>{monthLabel(manifest.months[0])} — {monthLabel(manifest.months.at(-1))}</dd></div><div><dt>데이터 생성</dt><dd>{timestamp(manifest.published_at)} KST</dd></div><div><dt>지역 목록</dt><dd>{formatNumber(manifest.regions.length)}개 · 서울 / 경기</dd></div></dl>
      <h3>수집된 시군구</h3>{covered.map(code => <p className="coverage-row" key={code}><span>{manifest.regions.find(item => item.region_code === code)?.region_name || code}</span><strong>{formatNumber(manifest.districts[code].count)}건</strong></p>)}
      <a className="button primary" href="/data/public.sqlite3" download><Database size={15} />공개 SQLite 다운로드</a>
    </section>
    <section className="panel"><div className="panel-heading"><Info size={19} /><h2>데이터를 읽는 방법</h2></div><ul className="reading-guide"><li><strong>대시보드</strong>는 계약 해제 거래를 제외합니다. 거래금액과 전용면적당 가격의 중앙값을 보여줍니다.</li><li><strong>원천 데이터</strong>에는 해제 거래를 포함한 API의 모든 필드가 들어 있습니다. 열마다 필터를 적용하고 CSV로 내려받을 수 있습니다.</li><li><strong>즐겨찾기</strong>는 관리자가 별표로 선택하고 저장한 지역입니다. 데이터와 함께 업데이트되며, 처음 접속할 때 조회 지역은 선택되어 있지 않습니다.</li><li><strong>지역 목록</strong>은 {manifest.boundary_catalog_date} 법정읍면동 경계 자료에 기반합니다. 이후 행정구역 개편은 반영되지 않을 수 있습니다.</li><li><strong>전용평</strong>은 전용면적 ÷ 3.305785로 계산합니다. 공급면적을 기준으로 하는 분양 평형과 다릅니다.</li></ul></section>
    <section className="panel local-guide"><div className="panel-heading"><House size={19} /><h2>데이터 수집 · 관리</h2><span className="badge">로컬 전용</span></div><p>관리자의 PC에서 <strong>psionic7.github.io</strong> 폴더의 <code>run-admin.bat</code>을 실행하면 별도의 React 관리자 화면이 열립니다.</p><ol><li>지도에서 수집할 지역을 고르고 <strong>수집 지역 업데이트</strong>로 저장합니다.</li><li>계약월을 정해 Node.js로 실거래 자료를 수집합니다.</li><li><strong>공개 데이터 내보내기</strong>를 실행합니다.</li><li>정적 빌드·검사를 실행하고 GitHub에 반영하면 공개 자료가 갱신됩니다.</li></ol><p className="small-note">이 사이트에는 API 키나 수집용 서버가 없습니다. 공개 SQLite·JSON과 사이트 소스는 누구나 내려받을 수 있습니다.</p><a href="https://github.com/Psionic7/psionic7.github.io#데이터-갱신" target="_blank" rel="noreferrer">데이터 갱신 안내 <ArrowUpRight size={14} /></a></section>
  </div>;
}
