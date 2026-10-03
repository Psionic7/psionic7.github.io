import React, {useEffect, useMemo, useState} from 'react';
import {Building2, Search, ChevronLeft, ChevronRight} from 'lucide-react';
import {ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip} from 'recharts';
import {apartmentKey, areaUnitLabel, areaValue, formatNumber, monthly, priceEok, pricePerPyeong, stats, unitPrice} from './domain.mjs';
import {Empty} from './ViewState.jsx';

const areaLabel = (area,unit) => unit === 'pyeong'
  ? `${formatNumber(areaValue(area,unit),2)}평 (${area.toLocaleString('ko-KR',{maximumFractionDigits:4})}㎡)`
  : `${area.toLocaleString('ko-KR',{maximumFractionDigits:4})}㎡`;

export default function ApartmentExplorer({apartments, rows, selectedKey, onSelect, region, start, end, areaUnit}) {
  const [search,setSearch] = useState('');
  const selected = apartments.find(item=>item.key===selectedKey);
  const needle = search.trim().toLocaleLowerCase();
  const choices = apartments.filter(item=>`${item.apartment} ${item.dong} ${item.jibun}`.toLocaleLowerCase().includes(needle));
  const selectedRows = useMemo(()=>selectedKey ? rows.filter(row=>apartmentKey(row)===selectedKey) : [],[rows,selectedKey]);
  const optionLabel = item => `${item.apartment} · ${item.dong} ${item.jibun} (${formatNumber(item.count)}건)`;
  return <section id="apartment-detail" className="panel apartment-explorer" aria-label="아파트별 실거래가">
    <div className="section-title"><div><h2><Building2 size={19}/>아파트별 실거래가</h2><p>선택한 지역·기간에 해당하는 전체 아파트를 검색합니다. 계약 해제 거래는 제외합니다.</p></div><span className="badge">{formatNumber(apartments.length)}개 단지</span></div>
    <div className="apartment-selector">
      <label className="search-input"><span>아파트 검색</span><Search size={16}/><input type="search" placeholder="아파트명 · 법정동 · 지번" value={search} onChange={event=>setSearch(event.target.value)}/></label>
      <label>조회 아파트<select value={selected?.key||''} onChange={event=>onSelect(event.target.value)}><option value="" disabled>아파트 선택 ({formatNumber(choices.length)}곳)</option>
        {selected&&!choices.some(item=>item.key===selected.key)&&<option value={selected.key}>{optionLabel(selected)}</option>}
        {choices.map(item=><option key={item.key} value={item.key}>{optionLabel(item)}</option>)}
      </select></label>
      <button disabled={!selectedKey} onClick={()=>onSelect('')}>아파트 선택 해제</button>
    </div>
    {needle&&!choices.length&&<p className="notice">검색과 일치하는 아파트가 없습니다. 아파트명이나 법정동을 확인해 주세요.</p>}
    {selected ? <ApartmentDetails key={selected.key} apartment={selected} rows={selectedRows} region={region} start={start} end={end} areaUnit={areaUnit}/>
      : <Empty title={apartments.length?'실거래가를 살펴볼 아파트를 선택해 주세요.':'이 조건에 조회할 아파트가 없습니다.'}>{apartments.length?'위에서 아파트명·법정동·지번으로 검색해 단지를 선택하세요.':'지역이나 계약월 조건을 바꿔 보세요.'}</Empty>}
  </section>;
}

function ApartmentDetails({apartment, rows, region, start, end, areaUnit}) {
  const [area,setArea] = useState(''), [page,setPage] = useState(1);
  const availableAreas = useMemo(()=>[...new Set(rows.map(row=>row.area_m2))].sort((a,b)=>a-b),[rows]);
  const activeArea = availableAreas.some(value=>String(value)===area)?area:'';
  const trades = useMemo(()=>rows.filter(row=>!activeArea||row.area_m2===Number(activeArea))
    .sort((a,b)=>b.deal_date.localeCompare(a.deal_date)||b.id-a.id),[rows,activeArea]);
  const summary = useMemo(()=>stats(trades),[trades]);
  const months = useMemo(()=>monthly(trades,start,end),[trades,start,end]);
  const areaStats = useMemo(()=>{
    const groups = new Map();
    rows.forEach(row=>{if(!groups.has(row.area_m2))groups.set(row.area_m2,[]);groups.get(row.area_m2).push(row);});
    return [...groups].sort(([a],[b])=>a-b).map(([m2,items])=>({m2,...stats(items),latest:items.reduce((last,row)=>row.deal_date>last.deal_date||row.deal_date===last.deal_date&&row.id>last.id?row:last)}));
  },[rows]);
  const priceRange = useMemo(()=>trades.reduce((range,row)=>({min:Math.min(range.min,row.price_man),max:Math.max(range.max,row.price_man)}),{min:Infinity,max:0}),[trades]);
  const buildYears = [...new Set(rows.map(row=>row.build_year).filter(year=>Number.isFinite(year)&&year>0))].sort((a,b)=>a-b);
  const latest = trades[0];
  const unit = areaUnitLabel(areaUnit), priceLabel = areaUnit==='pyeong'?'전용평당':'전용㎡당';
  const pages = Math.max(1,Math.ceil(trades.length/50)), safePage = Math.min(page,pages);
  useEffect(()=>setPage(1),[rows,activeArea]);
  const shown = trades.slice((safePage-1)*50,safePage*50);
  return <div className="apartment-details">
    <header className="apartment-heading"><div><h3>{apartment.apartment}</h3><p>{region.region_name} {apartment.dong} · 지번 {apartment.jibun||'미상'}{buildYears.length>0&&` · 건축 ${buildYears.length===1?buildYears[0]:`${buildYears[0]}–${buildYears.at(-1)}`}년`}</p></div>
      <label>단지 전용면적<select value={activeArea} onChange={event=>setArea(event.target.value)}><option value="">전체 면적 ({availableAreas.length}종류)</option>{availableAreas.map(value=><option key={value} value={String(value)}>{areaLabel(value,areaUnit)}</option>)}</select></label>
    </header>
    <div className="apartment-metrics" aria-label="선택 아파트 통계">
      <div><span>최근 거래가격</span><strong>{latest?formatNumber(priceEok(latest),2):'—'}<small>억 원</small></strong><p>{latest?`${latest.deal_date} · ${formatNumber(areaValue(latest.area_m2,areaUnit),2)}${unit} · ${latest.floor??'—'}층`:'거래 없음'}</p></div>
      <div><span>기간 중앙값</span><strong>{formatNumber(summary.median,2)}<small>억 원</small></strong><p>{priceLabel} {formatNumber(unitPrice(summary,areaUnit))}만 원</p></div>
      <div><span>최저 · 최고</span><strong className="price-range">{trades.length?`${formatNumber(priceRange.min/10000,2)}–${formatNumber(priceRange.max/10000,2)}`:'—'}<small>억 원</small></strong><p>선택 기간·면적의 유효 거래 기준</p></div>
      <div><span>조회 거래건수</span><strong>{formatNumber(summary.count)}<small>건</small></strong><p>해제 거래 제외 · 중복 신고 원본 유지</p></div>
    </div>
    <div className="apartment-trend"><h3>단지 월별 가격 추이</h3><p className="small-note">월별 중앙값·거래 건수 · 거래가 없는 월은 가격을 연결하지 않습니다.</p>
      <ResponsiveContainer width="100%" height={250}><ComposedChart data={months} margin={{top:18,right:8,bottom:5,left:0}}>
        <CartesianGrid stroke="#edf1f2" vertical={false}/><XAxis dataKey="label" tick={{fontSize:11}} tickLine={false} axisLine={false}/>
        <YAxis yAxisId="price" unit="억" width={50} tick={{fontSize:11}} tickLine={false} axisLine={false}/><YAxis yAxisId="count" orientation="right" unit="건" width={45} tick={{fontSize:11}} tickLine={false} axisLine={false}/>
        <Tooltip contentStyle={{borderRadius:10,fontSize:12}} formatter={(value,name)=>[`${formatNumber(value,name==='금액 중앙값'?2:0)}${name==='금액 중앙값'?'억 원':'건'}`,name]}/>
        <Bar yAxisId="count" dataKey="count" name="거래 건수" fill="#d9ece5" radius={[4,4,0,0]} maxBarSize={36} isAnimationActive={false}/>
        <Line yAxisId="price" dataKey="median" name="금액 중앙값" stroke="#178779" strokeWidth={2.5} dot={{r:3}} connectNulls={false} isAnimationActive={false}/>
      </ComposedChart></ResponsiveContainer>
      <details className="chart-data"><summary>단지 월별 수치 보기</summary><div className="table-scroll"><table className="summary-table"><thead><tr><th>계약월</th><th>거래 건수</th><th>금액 중앙값</th></tr></thead><tbody>{months.map(item=><tr key={item.month}><td>{item.label}</td><td>{formatNumber(item.count)}건</td><td>{formatNumber(item.median,2)}억 원</td></tr>)}</tbody></table></div></details>
    </div>
    <details className="apartment-area-summary"><summary>단지 전용면적별 가격 비교 ({areaStats.length}종류)</summary><p className="small-note">선택한 지역·기간에 해당하는 단지의 전체 면적을 비교합니다. 이 표의 면적별 보기를 누르면 상세 조회 면적이 바뀝니다.</p><div className="table-scroll"><table className="summary-table"><thead><tr><th>전용면적 ({unit})</th><th>유효 거래</th><th>금액 중앙값</th><th>{priceLabel} 중앙값</th><th>최근 거래</th><th>조회</th></tr></thead><tbody>{areaStats.map(item=><tr key={item.m2}><td>{formatNumber(areaValue(item.m2,areaUnit),2)}{unit}</td><td>{formatNumber(item.count)}건</td><td>{formatNumber(item.median,2)}억 원</td><td>{formatNumber(unitPrice(item,areaUnit))}만 원</td><td>{item.latest.deal_date} · {formatNumber(priceEok(item.latest),2)}억 원</td><td><button aria-label={`${areaLabel(item.m2,areaUnit)} 실거래 보기`} aria-pressed={activeArea===String(item.m2)} onClick={()=>setArea(String(item.m2))}>면적별 보기</button></td></tr>)}</tbody></table></div></details>
    <div className="section-title apartment-trades-title"><div><h3>단지 실거래 내역</h3><p>계약일 최신순 · 같은 날짜의 신고 순서는 구분할 수 없습니다.</p></div><span className="badge">{formatNumber(trades.length)}건</span></div>
    <div className="table-scroll apartment-trades" role="region" aria-label="선택 아파트 실거래 내역" tabIndex={0}><table className="summary-table"><thead><tr><th>계약일</th><th>전용면적 ({unit})</th><th>층</th><th>거래금액</th><th>{priceLabel} 가격</th><th>거래유형</th></tr></thead><tbody>{shown.map(row=><tr key={row.id}><td>{row.deal_date}</td><td>{formatNumber(areaValue(row.area_m2,areaUnit),2)}{unit}</td><td>{row.floor??'—'}층</td><td><strong>{formatNumber(priceEok(row),2)}억 원</strong><small>{formatNumber(row.price_man)}만 원</small></td><td>{formatNumber(areaUnit==='pyeong'?pricePerPyeong(row):row.price_man/row.area_m2)}만 원</td><td>{row.raw?.dealingGbn?.trim()||'—'}</td></tr>)}</tbody></table></div>
    <div className="pagination"><span>페이지당 50건 · {formatNumber(safePage)} / {formatNumber(pages)} 페이지</span><button aria-label="단지 거래 이전 페이지" disabled={safePage<=1} onClick={()=>setPage(safePage-1)}><ChevronLeft size={17}/></button><button aria-label="단지 거래 다음 페이지" disabled={safePage>=pages} onClick={()=>setPage(safePage+1)}><ChevronRight size={17}/></button></div>
  </div>;
}
