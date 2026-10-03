import React, {useEffect, useMemo, useState} from 'react';
import {RefreshCw, Star} from 'lucide-react';
import RawTable from './RawTable.jsx';
import {Empty, Loading} from '../src/ViewState.jsx';
import {buildCatalog, hierarchy, monthLabel, monthSequence} from '../src/domain.mjs';

const unique = values => [...new Set(values)].sort((a,b)=>a.localeCompare(b,'ko'));

export default function RawExplorer({state, request}) {
  const catalog = useMemo(()=>buildCatalog(state.catalog),[state.catalog]);
  const [regionId,setRegionId] = useState(''), [start,setStart] = useState(''), [end,setEnd] = useState('');
  const [province,setProvince] = useState(''), [city,setCity] = useState(''), [district,setDistrict] = useState(''), [search,setSearch] = useState('');
  const [rows,setRows] = useState([]), [busy,setBusy] = useState(false), [error,setError] = useState(''), [revision,setRevision] = useState(0);
  const region = catalog.find(r=>r.region_id===regionId);
  const coverage = state.stats.districts?.find(d=>d.region_code===region?.region_code);
  const months = useMemo(()=>monthSequence(coverage?.start||state.currentMonth, coverage?.end||state.currentMonth),[coverage?.start,coverage?.end,state.currentMonth]);
  const choices = catalog.filter(r=>{
    const h = hierarchy(r);
    return (!province||h.province===province)&&(!city||h.city===city)&&(!district||h.district===district)&&(!search.trim()||r.label.includes(search.trim()));
  });
  const favorites = catalog.filter(r=>state.saved.includes(r.region_id));
  const choose = id => {
    const next = catalog.find(r=>r.region_id===id);
    const range = state.stats.districts?.find(d=>d.region_code===next?.region_code);
    const available = monthSequence(range?.start||state.currentMonth,range?.end||state.currentMonth);
    setRegionId(id);
    if(!available.includes(start)||!available.includes(end)) {
      setStart(available.slice(-12)[0]||state.currentMonth);setEnd(available.at(-1)||state.currentMonth);
    }
  };
  useEffect(()=>{
    let active = true;
    setRows([]);setError('');
    if(!regionId||!start||!end){setBusy(false);return;}
    setBusy(true);
    request('raw-data',{region_id:regionId,start,end},state.csrf)
      .then(result=>{if(active){setRows(result.rows);setBusy(false);}})
      .catch(e=>{if(active){setError(e.message);setBusy(false);}});
    return ()=>{active=false;};
  },[regionId,start,end,state.csrf,request,revision]);
  return <section role="tabpanel" aria-label="원천 데이터">
    <section className="panel admin-raw-query" aria-label="원천 조회 조건">
      <div className="section-title"><div><h2>로컬 SQLite 원천 데이터</h2><p>배포 여부와 관계없이 이 PC에 저장된 최신 거래를 조회합니다. 해제 거래도 포함합니다.</p></div><button disabled={!region||busy} onClick={()=>setRevision(v=>v+1)}><RefreshCw size={15}/>자료 새로고침</button></div>
      {favorites.length>0&&<div className="favorite-chips raw-favorites">{favorites.map(r=><button key={r.region_id} onClick={()=>{setProvince('');setCity('');setDistrict('');setSearch('');choose(r.region_id);}}><Star size={12}/>{r.dongs.length===1?r.dongs[0]:r.label}</button>)}</div>}
      <div className="location-filters">
        <label>시도<select value={province} onChange={e=>{setProvince(e.target.value);setCity('');setDistrict('');}}><option value="">전체 시도</option>{unique(catalog.map(r=>hierarchy(r).province)).map(v=><option key={v}>{v}</option>)}</select></label>
        <label>시·군<select value={city} onChange={e=>{setCity(e.target.value);setDistrict('');}}><option value="">전체 시·군</option>{unique(catalog.filter(r=>!province||hierarchy(r).province===province).map(r=>hierarchy(r).city)).map(v=><option key={v}>{v}</option>)}</select></label>
        <label>구<select value={district} onChange={e=>setDistrict(e.target.value)}><option value="">전체 구</option>{unique(catalog.filter(r=>(!province||hierarchy(r).province===province)&&(!city||hierarchy(r).city===city)).map(r=>hierarchy(r).district)).map(v=><option key={v}>{v}</option>)}</select></label>
        <label>지역 검색<input type="search" placeholder="동 이름 또는 지역명" value={search} onChange={e=>setSearch(e.target.value)}/></label>
      </div>
      <div className="admin-raw-period">
        <label>조회 지역<select value={choices.some(r=>r.region_id===regionId)?regionId:''} onChange={e=>choose(e.target.value)}><option value="" disabled>지역 선택</option>{choices.map(r=><option key={r.region_id} value={r.region_id}>{r.label}</option>)}</select></label>
        <label>시작 계약월<select disabled={!region} value={start} onChange={e=>{setStart(e.target.value);if(e.target.value>end)setEnd(e.target.value);}}>{months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
        <label>종료 계약월<select disabled={!region} value={end} onChange={e=>{setEnd(e.target.value);if(e.target.value<start)setStart(e.target.value);}}>{months.map(m=><option key={m} value={m}>{monthLabel(m)}</option>)}</select></label>
      </div>
      <p className="small-note">현재 조회: {region?.label||'선택한 지역 없음'} · 이 화면의 조회 조건은 수집 지역 초안을 변경하지 않습니다.</p>
    </section>
    {!region?<section className="panel"><Empty title="원천 데이터를 조회할 지역을 선택해 주세요."/></section>:busy?<Loading/>:error?<div className="notice error" role="alert">{error}</div>:<RawTable key={regionId} rows={rows} region={region} start={start} end={end}/>}
  </section>;
}
