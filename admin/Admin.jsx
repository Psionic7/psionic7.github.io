import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Star,House,Database,Download,Play,Square,Save,Undo2,MapPin,ExternalLink,Plus} from 'lucide-react';
import RegionMap from './RegionMap.jsx';
import {hierarchy,formatNumber} from '../src/domain.mjs';
const unique=values=>[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));
export async function adminApi(endpoint,body,csrf) {
  const response=await fetch('/api/'+endpoint,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Admin-CSRF':csrf},body:JSON.stringify(body)});
  const value=await response.json();if(!response.ok)throw new Error(value.error||'요청 실패');return value;
}
export default function Admin({initialState,initialBoundaries,initialAdminBoundaries,request=adminApi,MapComponent=RegionMap}) {
  const [state,setState]=useState(initialState),[draft,setDraft]=useState(initialState?.saved||[]),[saved,setSaved]=useState(initialState?.saved||[]);
  const [boundaries,setBoundaries]=useState(initialBoundaries),[adminBoundaries,setAdminBoundaries]=useState(initialAdminBoundaries);
  const [province,setProvince]=useState(''),[city,setCity]=useState(''),[district,setDistrict]=useState(''),[query,setQuery]=useState('');
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[pending,setPending]=useState(false),[start,setStart]=useState(''),[end,setEnd]=useState('');
  const [custom,setCustom]=useState({code:'',name:'',label:'',dongs:''});
  const loadStarted=useRef(false);
  const refreshState=next=>setState(previous=>previous&&JSON.stringify(previous.catalog)===JSON.stringify(next.catalog)?{...next,catalog:previous.catalog}:next);
  useEffect(()=>{
    if(loadStarted.current||initialState)return;loadStarted.current=true;let active=true;
    Promise.all([request('state'),fetch('/boundaries/dongs').then(r=>{if(!r.ok)throw new Error('법정동 경계 로드 실패');return r.json();}),fetch('/boundaries/admin').then(r=>{if(!r.ok)throw new Error('시·구 경계 로드 실패');return r.json();})]).then(([s,d,a])=>{if(active){setState(s);setDraft(s.saved);setSaved(s.saved);setBoundaries(d);setAdminBoundaries(a);}}).catch(e=>active&&setError(e.message));
    return ()=>{active=false;loadStarted.current=false;};
  },[initialState,request]);
  useEffect(()=>{if(state?.currentMonth&&!end){setEnd(state.currentMonth);setStart(state.currentMonth);}},[state?.currentMonth,end]);
  useEffect(()=>{
    if(state?.job.status!=='running')return;
    let active=true;const interval=setInterval(()=>request('state').then(s=>{if(active)refreshState(s);}).catch(e=>active&&setError(e.message)),1000);
    return ()=>{active=false;clearInterval(interval);};
  },[state?.job.status,request]);
  const catalog=state?.catalog||[];
  const choices=useMemo(()=>catalog.filter(r=>{const h=hierarchy(r);return(!province||h.province===province)&&(!city||h.city===city)&&(!district||h.district===district)&&(!query||r.label.includes(query));}),[catalog,province,city,district,query]);
  const visibleIds=useMemo(()=>choices.map(r=>r.region_id),[choices]);
  const added=draft.filter(id=>!saved.includes(id)),removed=saved.filter(id=>!draft.includes(id)),dirty=Boolean(added.length||removed.length);
  const running=state?.job.status==='running';
  const toggle=id=>setDraft(current=>current.includes(id)?current.filter(v=>v!==id):[...current,id]);
  async function action(endpoint,body,onSuccess) {
    if(pending)return;setPending(true);setError('');setMessage('');
    try {const result=await request(endpoint,body,state.csrf);onSuccess?.(result);const next=await request('state');refreshState(next);}
    catch(e){setError(e.message);}finally{setPending(false);}
  }
  return <div className="admin-shell"><header className="admin-header"><a className="brand" href="/"><span className="brand-icon"><House size={25}/></span><span>집의 기록<small>React · 로컬 관리자</small></span></a><span className="badge">관리자 PC 전용</span><a href="https://psionic7.github.io/" target="_blank" rel="noreferrer">공개 사이트 <ExternalLink size={14}/></a></header>
    <main className="admin-main"><div className="page-header"><div><p className="eyebrow">LOCAL DATA COLLECTION</p><h1>데이터 수집 · 관리</h1><p>수집 지역을 편집하고 실거래 자료를 로컬 SQLite에 저장합니다.</p></div><div className="admin-count"><Database size={20}/><strong>{formatNumber(state?.stats.count||0)}건</strong><small>로컬 거래 데이터</small></div></div>
      {error&&<div className="notice error" role="alert">{error}</div>}{message&&<div className="notice success" role="status">{message}</div>}
      {!state||!boundaries||!adminBoundaries?<section className="panel">지역 목록과 경계를 불러오고 있습니다.</section>:<>
      <section className="panel"><div className="panel-heading"><MapPin size={19}/><h2>지도에서 수집 지역 선택</h2><span className="badge">선택 {draft.length}곳 · 저장 {saved.length}곳</span></div><p className="small-note">지역을 클릭하면 정보 팝업이 열립니다. 우측 위 별표를 눌러 추가·해제하세요. 지도와 확대 상태는 유지됩니다.</p>
        <div className="location-filters"><label>시도<select value={province} onChange={e=>{setProvince(e.target.value);setCity('');setDistrict('');}}><option value="">서울·경기 전체</option>{unique(catalog.map(r=>hierarchy(r).province)).map(v=><option key={v}>{v}</option>)}</select></label><label>시·군<select value={city} onChange={e=>{setCity(e.target.value);setDistrict('');}}><option value="">전체 시·군</option>{unique(catalog.filter(r=>!province||hierarchy(r).province===province).map(r=>hierarchy(r).city)).map(v=><option key={v}>{v}</option>)}</select></label><label>구<select value={district} onChange={e=>setDistrict(e.target.value)}><option value="">전체 구</option>{unique(catalog.filter(r=>(!province||hierarchy(r).province===province)&&(!city||hierarchy(r).city===city)).map(r=>hierarchy(r).district)).map(v=><option key={v}>{v}</option>)}</select></label><label>동·읍·면 검색<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="동 이름 또는 지역명"/></label></div>
        <div className="action-row"><button disabled={pending||running} onClick={()=>setDraft(current=>[...new Set([...current,...visibleIds])])}>표시 지역 모두 추가 ({choices.length})</button><button disabled={pending||running} onClick={()=>setDraft(current=>current.filter(id=>!visibleIds.includes(id)))}>표시 지역 모두 해제</button><button disabled={pending||running} onClick={()=>setDraft([])}>전체 선택 해제</button><span className="small-note">필터를 바꿔도 수집 대상은 유지됩니다.</span></div>
        <div className={dirty?'draft-status dirty':'draft-status'} role="status">{dirty?`업데이트 필요 · 추가 ${added.length}곳 · 해제 ${removed.length}곳. 변경사항은 아직 파일에 저장되지 않았습니다.`:'저장된 수집 지역과 일치합니다.'}</div>
        <div className="action-row"><button className="button primary" disabled={!dirty||pending||running} onClick={()=>action('favorites',{ids:draft},result=>{setSaved(result.saved);setDraft(result.saved);setMessage('수집 지역을 파일에 저장했습니다.');})}><Save size={16}/>수집 지역 업데이트</button><button disabled={!dirty||pending||running} onClick={()=>setDraft([...saved])}><Undo2 size={16}/>변경사항 되돌리기</button></div>
        <MapComponent boundaries={boundaries} adminBoundaries={adminBoundaries} catalog={catalog} draft={draft} saved={saved} visibleIds={visibleIds} onToggle={running||pending?()=>{}:toggle}/>
        <p className="small-note">경계 기준: 2023-07-29 · 서울 467개 / 경기 745개 법정읍면동. 부천·화성 등의 이후 행정구역 개편은 반영되지 않을 수 있습니다. <a href="https://github.com/KnellBalm/kr-admin-geojson" target="_blank" rel="noreferrer">V-World / kr-admin-geojson</a></p>
        <details className="selection-list"><summary>편집 중인 수집 지역 {draft.length}곳</summary><div className="favorite-chips">{draft.map(id=>{const r=catalog.find(c=>c.region_id===id);return <button key={id} disabled={running||pending} onClick={()=>toggle(id)}><Star size={12} fill="currentColor"/>{r?.label||id} ×</button>;})}</div></details>
      </section>
      <div className="admin-grid"><section className="panel"><div className="panel-heading"><Database size={19}/><h2>실거래 데이터 수집</h2></div><p>저장한 지역 <strong>{saved.length}곳</strong> · API 시군구 <strong>{new Set(catalog.filter(r=>saved.includes(r.region_id)).map(r=>r.region_code)).size}곳</strong></p><p className="small-note">API는 시군구 전체 자료를 반환합니다. 동별 조회 범위는 별도로 적용하며, 같은 시군구·월은 한 번만 요청합니다.</p>
        {!state.keyReady&&<div className="notice error">프로젝트의 .env 파일에 MOLIT_SERVICE_KEY를 설정하세요.</div>}
        {dirty&&<p className="draft-reminder">저장하지 않은 지역 변경은 이번 수집에 반영되지 않습니다.</p>}
        <div className="two-fields"><label>시작 계약월 (YYYYMM)<input inputMode="numeric" maxLength={6} value={start} onChange={e=>setStart(e.target.value)}/></label><label>종료 계약월 (YYYYMM)<input inputMode="numeric" maxLength={6} value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
        <div className="action-row"><button className="button primary" disabled={running||pending||!saved.length||!state.keyReady} onClick={()=>action('collect',{start,end})}><Play size={16}/>저장 지역 수집</button><button disabled={!running||pending||state.job.kind!=='collect'} onClick={()=>action('cancel',{})}><Square size={14}/>수집 중단</button></div>
        {state.job.status!=='idle'&&<div className="job-status" role="status"><strong>{state.job.message}</strong><progress max={state.job.total||1} value={state.job.completed}/><small>{state.job.completed}/{state.job.total} 작업 · {formatNumber(state.job.rows)}건 · {state.job.status}</small></div>}
      </section><section className="panel"><div className="panel-heading"><Download size={19}/><h2>공개 데이터 내보내기</h2></div><p>원천 거래와 저장한 즐겨찾기를 공개용 SQLite·JSON으로 내보냅니다. API 키·수집 이력·응답 XML은 제외합니다.</p><div className="publish-steps"><button disabled={running||pending} onClick={()=>action('export',{},r=>setMessage(`공개 데이터 내보내기 완료: ${formatNumber(r.count)}건 · 즐겨찾기 ${r.favorites}곳. 정적 빌드를 실행하세요.`))}><Download size={16}/>1. 공개 데이터 내보내기</button><button disabled={running||pending} onClick={()=>action('build',{})}><Database size={16}/>2. GitHub Pages 정적 빌드·검사</button></div><p className="small-note">3. 생성된 public/data와 docs를 커밋·푸시하면 공개 사이트가 업데이트됩니다.</p><pre>git add public/data docs{`\n`}git commit -m "Update transaction data"{`\n`}git push origin main</pre><p className="small-note">로컬 작업 파일: local/my_real_estate.sqlite3 · local/collection_regions.json</p></section></div>
      <section className="panel"><details><summary><Plus size={15}/> 경계에 없는 지역 등록 (행정구역 개편 등)</summary><p className="small-note">새 시군구의 공식 5자리 LAWD_CD와 법정동명을 알고 있을 때 등록합니다. 현재 지도 경계에는 표시되지 않으며 아래 목록에서 별표로 선택할 수 있습니다.</p><div className="location-filters">{[['code','시군구 코드'],['name','전체 시군구명'],['label','표시 이름'],['dongs','법정동 (쉼표 구분, 비우면 구 전체)']].map(([k,label])=><label key={k}>{label}<input value={custom[k]} onChange={e=>setCustom(c=>({...c,[k]:e.target.value}))}/></label>)}</div><button disabled={pending||running} onClick={()=>action('regions',{...custom,dongs:custom.dongs.split(',').map(d=>d.trim()).filter(Boolean)},()=>{setMessage('지역을 등록했습니다. 별표 선택 후 업데이트해 수집 대상으로 저장하세요.');setCustom({code:'',name:'',label:'',dongs:''});})}>지역 등록</button><div className="favorite-chips">{catalog.filter(r=>r.region_id.startsWith('custom_')).map(r=><button key={r.region_id} disabled={pending||running} onClick={()=>toggle(r.region_id)}><Star size={14} fill={draft.includes(r.region_id)?'currentColor':'none'}/>{r.label}</button>)}</div></details></section>
      <section className="panel"><div className="panel-heading"><Database size={19}/><h2>최근 수집 이력</h2></div><div className="admin-table-scroll"><table><thead><tr><th>지역</th><th>계약월</th><th>수집 시각</th><th>응답 건수</th><th>저장 건수</th></tr></thead><tbody>{state.history.map(r=><tr key={r.id}><td>{r.region_name}</td><td>{r.deal_month}</td><td>{new Date(r.fetched_at).toLocaleString('ko-KR')}</td><td>{formatNumber(r.api_count)}</td><td>{formatNumber(r.stored_count)}</td></tr>)}</tbody></table>{!state.history.length&&<p>아직 수집 이력이 없습니다.</p>}</div></section>
      </>}
      <footer className="page-footer">React · Vite / Node.js · SQLite · 관리자 API는 이 PC에서만 실행됩니다.</footer>
    </main></div>;
}
