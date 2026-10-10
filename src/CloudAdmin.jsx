import React, {lazy, Suspense, useEffect, useMemo, useRef, useState} from 'react';
import {adminClient} from './cloud-admin-client.js';
import {sessionAdminClient,adminPortalUrl,githubLoginError} from './admin-session-client.js';
import {REPOSITORY} from '../automation/config.mjs';
import {hierarchy} from './domain.mjs';
const CloudRegionMap = lazy(() => import('./CloudRegionMap.jsx'));
const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));

const statusName = run => run.status === 'completed' ? ({success: '성공', failure: '실패', cancelled: '취소', skipped: '건너뜀'}[run.conclusion] || run.conclusion) : ({queued: '대기', in_progress: '실행 중', waiting: '배포 대기'}[run.status] || run.status);
const time = value => new Date(value).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short'});
export default function CloudAdmin({clientFactory, fetcher = fetch, MapComponent = CloudRegionMap, githubAuth = typeof __ADMIN_GITHUB_AUTH__ !== 'undefined' && __ADMIN_GITHUB_AUTH__, portalUrl = import.meta.env.VITE_ADMIN_PORTAL_URL || ''}) {
  const githubPortal = adminPortalUrl(portalUrl);
  const [restoring,setRestoring] = useState(githubAuth);
  const [token, setToken] = useState(''), [client, setClient] = useState(null), [user, setUser] = useState('');
  const [loaded, setLoaded] = useState(null), [config, setConfig] = useState(null), [catalog, setCatalog] = useState([]);
  const [runs, setRuns] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState(()=>githubAuth?githubLoginError(window.location.search):''), [message, setMessage] = useState('');
  const [search, setSearch] = useState(''), [months, setMonths] = useState(''), [published, setPublished] = useState(null), [pending, setPending] = useState(false);
  const requestedAfter = useRef(new Set());
  const [province, setProvince] = useState(''), [city, setCity] = useState(''), [district, setDistrict] = useState('');
  const matches = useMemo(() => catalog.filter(r => {
    const location = hierarchy(r);
    return (!province || location.province === province) && (!city || location.city === city) &&
      (!district || location.district === district) && (!search.trim() || r.label.includes(search.trim()));
  }), [catalog, province, city, district, search]);
  const visibleIds = useMemo(() => matches.map(r => r.region_id), [matches]);
  const provinces = unique(catalog.map(r => hierarchy(r).province));
  const cities = unique(catalog.filter(r => !province || hierarchy(r).province === province).map(r => hierarchy(r).city));
  const districts = unique(catalog.filter(r => (!province || hierarchy(r).province === province) && (!city || hierarchy(r).city === city)).map(r => hierarchy(r).district));
  useEffect(() => {
    let active = true;
    fetcher('/data/manifest.json', {cache: 'no-store'}).then(r => {if (!r.ok) throw new Error(); return r.json();})
      .then(m => {if (active) {setCatalog(m.regions.filter(r => /^dong_\d{8}$/.test(r.region_id))); setPublished(m);}})
      .catch(() => {if (active) setError('공개 지역 목록을 불러오지 못했습니다. 새로고침하세요.');});
    return () => {active = false;};
  }, [fetcher]);
  useEffect(() => {
    if (!githubAuth) return;
    let active = true;
    const params=new URLSearchParams(window.location.search);
    if (params.has('authError')) {params.delete('authError');window.history.replaceState(null,'',window.location.pathname+(params.size?'?'+params:''));}
    const next = clientFactory ? clientFactory() : sessionAdminClient(fetcher);
    (async () => {
      try {
        const name = await next.restore();
        if (!name) return;
        const [data,history] = await Promise.all([next.load(),next.runs()]);
        if (active) {setClient(next);setUser(name);setLoaded(data);setConfig(data.config);setRuns(history);}
      } catch (e) {if (active) setError(e.message);}
      finally {if (active) setRestoring(false);}
    })();
    return () => {active=false;};
  },[githubAuth,clientFactory,fetcher]);
  useEffect(() => {
    if (!client) return;
    let active = true;
    const timer = setInterval(async () => {
      try {const items = await client.runs(); if (active) {setRuns(items); if (items.some(r => r.event === 'workflow_dispatch' && !requestedAfter.current.has(r.id))) setPending(false);}}
      catch (e) {if (active) {if (githubAuth && e.status===401) clearSession();setError(githubAuth?e.message:'진행 상태를 불러오지 못했습니다. 토큰 만료 또는 연결 상태를 확인하세요.');}}
    }, 15000);
    return () => {active = false; clearInterval(timer);};
  }, [client]);
  const operation = async task => {
    setBusy(true); setError(''); setMessage('');
    try {await task();} catch (e) {if (githubAuth && e.status===401) clearSession();setError(e.message);} finally {setBusy(false);}
  };
  const login = event => {
    event.preventDefault();
    operation(async () => {
      const next = clientFactory ? clientFactory(token) : adminClient(token,fetcher), name = await next.login();
      const [data, history] = await Promise.all([next.load(), next.runs()]);
      setClient(next); setUser(name); setLoaded(data); setConfig(data.config); setRuns(history); setToken('');
    });
  };
  const clearSession = () => {setClient(null); setUser(''); setToken(''); setLoaded(null); setConfig(null); setRuns([]); setError(''); setMessage(''); setPending(false);};
  const logout = () => operation(async () => {if (client.logout) await client.logout();clearSession();});
  const refresh = () => operation(async () => {
    const [data, history] = await Promise.all([client.load(), client.runs()]);
    setLoaded(data); setConfig(data.config); setRuns(history); setMessage('저장된 설정을 불러왔습니다.');
  });
  const dirty = config && loaded && JSON.stringify(config) !== JSON.stringify(loaded.config);
  const activeRun = runs.some(r => r.status !== 'completed');
  const visible = matches.slice(0, 100);
  const toggle = id => {if (!busy) setConfig(c => ({...c, region_ids: c.region_ids.includes(id) ? c.region_ids.filter(v => v !== id) : [...c.region_ids, id]}));};
  return <main className="cloud-admin">
    <header className="page-header"><div><a href={githubAuth?'https://psionic7.github.io/':'/'}>집의 기록</a><h1>데이터 수집 관리자</h1><p>매일 예약 수집과 수동 실행을 관리합니다.</p></div>{client && <button disabled={busy} onClick={logout}>{user} · 로그아웃</button>}</header>
    {error && <p role="alert" className="notice error">{error}</p>}{message && <p role="status" className="notice">{message}</p>}
    {published && <p className="small-note">공개 자료 업데이트: {time(published.published_at)} KST · {published.count.toLocaleString('ko-KR')}건</p>}
    {restoring?<section className="panel"><p role="status">접속 상태를 확인하고 있습니다.</p></section>:!client ? <section className="panel">
      <h2>관리자 접속</h2>
      {githubAuth?<><p>GitHub 계정으로 로그인하세요. 이 저장소 소유자의 계정으로만 관리자 기능을 사용할 수 있습니다.</p><p><a className="button primary" href="/api/admin/login">GitHub로 로그인</a></p><p className="small-note">토큰을 직접 입력하지 않아도 됩니다. 접속은 최대 4시간 유지됩니다.</p></>:<>
        {githubPortal?<><p>GitHub 계정으로 로그인하면 토큰을 입력하지 않고 관리할 수 있습니다.</p><p><a className="button primary" href={githubPortal}>GitHub로 로그인</a></p></>:<p>이 저장소를 관리할 수 있는 GitHub 토큰으로 접속합니다. 토큰은 열린 페이지의 메모리에만 유지되며 새로고침·로그아웃 시 사라집니다.</p>}
        <details open={!githubPortal}><summary>토큰으로 관리자 접속</summary>
          <form onSubmit={login}><label>GitHub 토큰<input type="password" autoComplete="off" spellCheck="false" value={token} onChange={e => setToken(e.target.value)} required /></label><button className="primary" disabled={busy || !catalog.length}>관리자 접속</button></form>
          <details><summary>토큰 만들기</summary><p><a href={`https://github.com/settings/personal-access-tokens/new?name=Home+Records+Admin&resource_owner=Psionic7`} target="_blank" rel="noreferrer">GitHub에서 Fine-grained 토큰 만들기</a></p><p>저장소를 {REPOSITORY} 하나로 제한하고 Actions·Contents에 Read and write 권한을 설정하세요. 예약 시간 변경을 위해 Workflows의 Read and write 권한도 필요합니다. API 키는 이 화면에 입력하지 않습니다.</p></details>
        </details>
      </>}
    </section> : <>
      <section className="panel"><div className="section-title"><h2>예약 수집 설정</h2><button disabled={busy} onClick={refresh}>저장 설정 다시 불러오기</button></div>
        <div className="cloud-fields">
          <label>매일 수집 시간 (한국 시간)<input type="time" value={config.time_kst} onChange={e => setConfig(c => ({...c, time_kst: e.target.value}))} /></label>
          <label>최근 계약월 재수집<select value={config.recent_months} onChange={e => setConfig(c => ({...c, recent_months: Number(e.target.value)}))}>{Array.from({length: 12}, (_, i) => <option key={i} value={i + 1}>최근 {i + 1}개월</option>)}</select></label>
          <label>한 번에 조회할 새 주소 수<input type="number" min="1" max="10000" value={config.address_limit} onChange={e => setConfig(c => ({...c, address_limit: Number(e.target.value)}))} /></label>
        </div>
        <p className="small-note">최근 계약월을 다시 받아 늦게 신고되거나 해제된 거래를 반영합니다. 예약 실행은 GitHub 상황에 따라 지연될 수 있습니다.</p>
        <h3>수집 지역 · {config.region_ids.length}곳</h3><div className="weekly-selected">{config.region_ids.map(id => <button disabled={busy} key={id} onClick={() => toggle(id)}>{catalog.find(r => r.region_id === id)?.label || id} ×</button>)}</div>
        <div className="cloud-fields cloud-map-filters">
          <label>수집 지역 시도<select value={province} onChange={e => {setProvince(e.target.value); setCity(''); setDistrict('');}}><option value="">전체 시도</option>{provinces.map(v => <option key={v}>{v}</option>)}</select></label>
          <label>수집 지역 시·군<select value={city} onChange={e => {setCity(e.target.value); setDistrict('');}}><option value="">전체 시·군</option>{cities.map(v => <option key={v}>{v}</option>)}</select></label>
          <label>수집 지역 구<select value={district} onChange={e => setDistrict(e.target.value)}><option value="">전체 구</option>{districts.map(v => <option key={v}>{v}</option>)}</select></label>
        </div>
        <label>추가할 지역 검색<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="시·구·동 이름" /></label>
        <Suspense fallback={<p role="status">지역 지도를 준비하고 있습니다.</p>}><MapComponent fetcher={fetcher} catalog={catalog} draft={config.region_ids} saved={loaded.config.region_ids} visibleIds={visibleIds} onToggle={toggle} disabled={busy} /></Suspense>
        <p className="small-note">지도에서 지역을 누른 뒤 팝업의 별표로 추가·해제하세요. 선택은 위 목록과 함께 바뀌며 설정 저장을 눌러야 적용됩니다. 시·군·구 필터와 검색은 지도에도 적용됩니다. 경계 기준: 2023-07-29 · V-World / kr-admin-geojson.</p>
        <div className="weekly-dong-picker">{visible.map(r => <label key={r.region_id}><input type="checkbox" checked={config.region_ids.includes(r.region_id)} disabled={busy} onChange={() => toggle(r.region_id)} />{r.label}</label>)}</div>
        <p className="small-note">검색 결과는 최대 100곳까지 표시합니다. 같은 시군구의 여러 동은 API를 한 번만 요청합니다.</p>
        <button className="primary" disabled={busy || !dirty || activeRun || pending || !config.region_ids.length} onClick={() => operation(async () => {const saved = await client.save(config, loaded, catalog); setLoaded(saved); setConfig(saved.config); setMessage('예약 시간과 수집 지역을 저장했습니다. 사이트도 최신 저장 DB로 다시 배포됩니다.');})}>설정 저장</button>
      </section>
      <section className="panel"><h2>지금 수집</h2><p>저장한 지역을 수집하고 도로명주소 조회·검사·사이트 배포까지 실행합니다.</p>
        <div className="cloud-fields"><label>이번 실행의 수집 기간<select value={months} onChange={e => setMonths(e.target.value)}><option value="">저장 설정 사용 (최근 {loaded.config.recent_months}개월)</option>{Array.from({length: 12}, (_, i) => <option key={i} value={i + 1}>최근 {i + 1}개월</option>)}</select></label>
        <button className="primary" disabled={busy || dirty || activeRun || pending} onClick={() => operation(async () => {requestedAfter.current = new Set(runs.map(r => r.id)); await client.dispatch(months); setPending(true); setMessage('수집 실행을 요청했습니다. 아래 실행 기록에 나타나기까지 잠시 걸릴 수 있습니다.'); setRuns(await client.runs());})}>{pending ? '실행 요청됨' : activeRun ? '작업 실행 중' : '수집하고 배포'}</button></div>
        {dirty && <p className="small-note">변경한 설정을 저장하거나 다시 불러온 뒤 실행하세요.</p>}
      </section>
      <section className="panel"><div className="section-title"><h2>최근 실행 기록</h2><a href={`https://github.com/${REPOSITORY}/actions/workflows/refresh-data.yml`} target="_blank" rel="noreferrer">GitHub에서 상세 로그·중단</a></div>
        <p className="small-note">15초마다 갱신합니다. 성공은 수집·검사·배포 완료를 의미하며, 실패하면 기존 공개 사이트가 유지됩니다.</p>
        {runs.length ? <ul className="cloud-runs">{runs.map(r => <li key={r.id}><a href={r.html_url} target="_blank" rel="noreferrer">{time(r.created_at)} KST</a><span>{({schedule: '예약 수집', workflow_dispatch: '수동 실행', push: '사이트 갱신'}[r.event] || r.event)}</span><strong>{statusName(r)}</strong></li>)}</ul> : <p>실행 기록이 없습니다.</p>}
      </section>
    </>}
  </main>;
}
