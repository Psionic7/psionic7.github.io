import React, { useEffect, useMemo, useState } from 'react';
import { ChartNoAxesCombined, Building2, ArrowDownUp, ListFilter } from 'lucide-react';
import { ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ScatterChart, Scatter, BarChart, Legend } from 'recharts';
import { areaSummary, areaInputValue, areaM2, areaUnitLabel, areaValue, apartmentAddress, apartmentSummary, favoriteRegions, formatNumber, monthly, priceEok, scopeRows, stableSample, stats, validRows } from './domain.mjs';
import { Empty } from './ViewState.jsx';
import AreaUnit from './AreaUnit.jsx';
import {areaPreference,unitPreference,useStoredState} from './preferences.js';
const color = '#178779';
const tooltipStyle = {border:'1px solid #dce5e5',borderRadius:12,fontSize:12};

export default function Dashboard({rows, region, manifest, favorites, start, end, districtLoader, onOpenApartment}) {
  // Keep the range in square metres so display rounding cannot move boundary trades.
  const scope=`dashboard:${region.region_id}`;
  const [minArea,setMinArea] = useStoredState(scope,'minArea',0,areaPreference);
  const [maxArea,setMaxArea] = useStoredState(scope,'maxArea',()=>Math.max(300,Math.ceil(rows.reduce((max,row)=>Math.max(max,row.area_m2),0))),areaPreference);
  const [dongs,setDongs] = useStoredState(scope,'dongs',[],value=>Array.isArray(value) && value.length<=2000 && value.every(dong=>typeof dong==='string' && rows.some(row=>row.dong===dong)));
  const [areaUnit,setAreaUnit] = useStoredState('display','areaUnit','m2',unitPreference);
  const unitLabel = areaUnitLabel(areaUnit);
  const [comparisons,setComparisons] = useState({}), [compareError,setCompareError] = useState('');
  const compareRegions = useMemo(() => favorites || favoriteRegions(manifest), [favorites, manifest]);
  useEffect(()=> {
    let active=true;
    setCompareError('');
    Promise.all([...new Set(compareRegions.map(item=>item.region_code))].map(async code=>[code,await districtLoader(manifest,code)]))
      .then(values=>{if(active)setComparisons(Object.fromEntries(values));})
      .catch(()=>{if(active)setCompareError('지역 비교 자료를 불러오지 못했습니다. 화면을 새로고침해 주세요.');});
    return ()=>{active=false;};
  },[manifest,compareRegions,districtLoader]);
  const valid = useMemo(()=>validRows(rows,minArea,maxArea,dongs),[rows,minArea,maxArea,dongs]);
  const summary=useMemo(()=>stats(valid),[valid]);
  const months=useMemo(()=>monthly(valid,start,end),[valid,start,end]);
  const apartments=useMemo(()=>apartmentSummary(valid).slice(0,10),[valid]);
  const areas=useMemo(()=>areaSummary(valid,areaUnit),[valid,areaUnit]);
  const points=useMemo(()=>stableSample(valid).map(row=>({...row,area_display:areaValue(row.area_m2,areaUnit),price:priceEok(row)})),[valid,areaUnit]);
  const allDongs=useMemo(()=>[...new Set(rows.map(row=>row.dong))].sort((a,b)=>a.localeCompare(b,'ko')),[rows]);
  const comparable=compareRegions.map(item=>({region_id:item.region_id,label:item.label,
    ...(comparisons[item.region_code] ? stats(validRows(scopeRows(comparisons[item.region_code],item,start,end),minArea,maxArea)) : {count:null,min:null,max:null,apartments:null})}));
  const cards=[['유효 거래',summary.count,'건',ChartNoAxesCombined,`${formatNumber(rows.filter(row=>row.cancelled).length)}건의 해제 거래 제외`],
    ['최저 거래금액',summary.min,'억 원',ArrowDownUp,'선택 조건의 유효 거래 최저가'],
    ['최고 거래금액',summary.max,'억 원',ArrowDownUp,'선택 조건의 유효 거래 최고가'],
    ['거래된 아파트',summary.apartments,'곳',Building2,'법정동 · 지번 · 아파트명 기준']];
  return <div className="dashboard">
    <section className="dashboard-filters"><div className="filter-title"><ListFilter size={17}/><strong>세부 조건</strong></div><AreaUnit value={areaUnit} onChange={setAreaUnit}/><div className="area-inputs"><label>최소 전용면적<input type="number" min="0" step="any" value={areaInputValue(minArea,areaUnit)} onChange={event=>setMinArea(areaM2(Math.max(0,Number(event.target.value)),areaUnit))}/><span>{unitLabel}</span></label><span>—</span><label>최대 전용면적<input type="number" min="0" step="any" value={areaInputValue(maxArea,areaUnit)} onChange={event=>setMaxArea(areaM2(Math.max(0,Number(event.target.value)),areaUnit))}/><span>{unitLabel}</span></label></div><details className="dong-picker"><summary>법정동 {dongs.length?`${dongs.length}개 선택`:'전체'}</summary><div className="picker-content"><button onClick={()=>setDongs([])}>모든 동 보기</button>{allDongs.map(dong=><label key={dong}><input type="checkbox" checked={dongs.includes(dong)} onChange={event=>setDongs(previous=>event.target.checked?[...previous,dong]:previous.filter(value=>value!==dong))}/>{dong}</label>)}</div></details></section>
    <p className="small-note area-explanation">전용평 = 전용면적(㎡) ÷ 3.305785 · 공급면적 기준의 분양 평형과 다릅니다. 단위 전환 시 같은 면적 범위를 유지합니다.</p>
    {minArea>maxArea && <p className="notice error" role="alert">최소 전용면적은 최대 전용면적보다 클 수 없습니다.</p>}
    <div className="metric-grid">{cards.map(([label,value,unit,Icon,note],index)=><section className={`metric-card ${index===1?'featured':''}`} key={label}><div className="metric-label">{label}<Icon size={17}/></div><p className="metric-value">{formatNumber(value,index===1||index===2?2:0)}<span>{unit}</span></p><small>{note}</small></section>)}</div>
    {!valid.length ? <section className="panel"><Empty title={rows.length?'선택한 조건에 유효 거래가 없습니다.':'이 지역은 아직 수집된 자료가 없습니다.'}>{rows.length?'면적이나 법정동 조건을 바꿔 보세요.':'지역 목록에 있어도 실거래 수집이 완료되지 않은 지역일 수 있습니다.'}</Empty></section> : <>
      <section className="panel trend-panel"><div className="section-title"><div><h2>거래의 흐름</h2><p>월별 최저·최고 거래금액과 거래 건수</p></div></div><div className="chart-container"><ResponsiveContainer width="100%" height={300}><ComposedChart data={months} margin={{top:15,right:10,bottom:0,left:0}}><CartesianGrid stroke="#edf1f2" vertical={false}/><XAxis dataKey="label" tick={{fontSize:11}} tickLine={false} axisLine={false}/><YAxis yAxisId="price" tick={{fontSize:11}} tickLine={false} axisLine={false} width={48} unit="억"/><YAxis yAxisId="volume" orientation="right" tick={{fontSize:11}} tickLine={false} axisLine={false} width={48} unit="건"/><Tooltip contentStyle={tooltipStyle} formatter={(value,name)=>[formatNumber(value,name==='거래 건수'?0:2)+(name==='거래 건수'?'건':'억 원'),name]}/><Legend/><Bar yAxisId="volume" dataKey="count" name="거래 건수" fill="#dfefeb" radius={[4,4,0,0]} maxBarSize={40} isAnimationActive={false}/><Line yAxisId="price" dataKey="min" name="최저 거래금액" stroke="#7799b2" strokeWidth={2} dot={{r:3}} connectNulls={false} isAnimationActive={false}/><Line yAxisId="price" dataKey="max" name="최고 거래금액" stroke={color} strokeWidth={2.6} dot={{r:3}} connectNulls={false} isAnimationActive={false}/></ComposedChart></ResponsiveContainer></div><details className="chart-data"><summary>월별 수치 보기</summary><SummaryTable headers={['계약월','유효 거래','최저 거래금액','최고 거래금액']} rows={months.map(item=>[item.label,(formatNumber(item.count)+'건'),(formatNumber(item.min,2)+'억 원'),(formatNumber(item.max,2)+'억 원')])}/></details></section>
      <div className="chart-grid"><section className="panel"><div className="section-title"><div><h2>면적과 가격의 관계</h2><p>전용면적별 개별 거래가격 ({unitLabel})</p></div></div><div className="chart-container"><ResponsiveContainer width="100%" height={285}><ScatterChart margin={{top:12,right:15,left:0,bottom:12}}><CartesianGrid stroke="#edf1f2"/><XAxis dataKey="area_display" name="전용면적" type="number" unit={unitLabel} tick={{fontSize:11}} tickLine={false} axisLine={false}/><YAxis dataKey="price" name="거래가격" type="number" unit="억" tick={{fontSize:11}} tickLine={false} axisLine={false} width={45}/><Tooltip content={<PointTooltip areaUnit={areaUnit}/>}/><Scatter data={points} fill={color} fillOpacity={0.4} isAnimationActive={false}/></ScatterChart></ResponsiveContainer></div><p className="small-note">{valid.length>3000?`전체 ${formatNumber(valid.length)}건 중 ${formatNumber(points.length)}건을 고르게 추려 표시합니다. 통계는 전체 거래로 계산합니다.`:`유효 거래 ${formatNumber(valid.length)}건을 표시합니다.`}</p></section>
      <section className="panel"><div className="section-title"><div><h2>면적대별 실거래</h2><p>전용면적 구간별 최저·최고 거래금액 ({unitLabel})</p></div></div><div className="chart-container"><ResponsiveContainer width="100%" height={235}><BarChart data={areas} margin={{top:12,right:8,left:0,bottom:0}}><CartesianGrid vertical={false} stroke="#edf1f2"/><XAxis dataKey="label" tick={{fontSize:10}} axisLine={false} tickLine={false}/><YAxis unit="억" tick={{fontSize:11}} width={45} axisLine={false} tickLine={false}/><Tooltip contentStyle={tooltipStyle} formatter={(value,name)=>[(formatNumber(value,2)+'억 원'),name]}/><Legend/><Bar dataKey="min" name="최저 거래금액" fill="#7799b2" radius={[5,5,0,0]} maxBarSize={35} isAnimationActive={false}/><Bar dataKey="max" name="최고 거래금액" fill={color} radius={[5,5,0,0]} maxBarSize={35} isAnimationActive={false}/></BarChart></ResponsiveContainer></div><div className="area-counts">{areas.map(item=><span key={item.label}>{item.label}<strong>{formatNumber(item.count)}건</strong></span>)}</div></section></div>
    </>}
    {compareRegions.length > 0 && <section className="panel"><div className="section-title"><div><h2>즐겨찾기 지역 비교</h2><p>저장한 즐겨찾기 {compareRegions.length}곳 · 같은 계약월·면적 기준 · 세부 법정동 선택은 적용하지 않습니다.</p></div></div>{compareError?<p className="notice error">{compareError}</p>:<div className="comparison-grid favorite-comparisons">{comparable.map(item=><div className={item.region_id===region.region_id?'current':''} key={item.region_id}><span>{item.label}</span><strong>{formatNumber(item.min,2)} — {formatNumber(item.max,2)}<small>억 원</small></strong><p>{formatNumber(item.count)}건 · 최저 — 최고 거래금액</p></div>)}</div>}</section>}
    {apartments.length>0 && <section className="panel"><div className="section-title"><div><h2>거래가 활발한 아파트</h2><p>유효 거래 건수 순 · 상위 {apartments.length}곳 · 아파트 이름을 누르면 아파트별 실거래가 탭으로 이동합니다. 같은 이름이라도 법정동과 지번이 다르면 별도 집계합니다.</p></div></div><div className="table-scroll summary-scroll"><table className="summary-table"><thead><tr>{['아파트','주소','거래 건수','최저 거래금액','최고 거래금액',('평균 전용면적 ('+unitLabel+')'),'최근 계약'].map(value=><th key={value}>{value}</th>)}</tr></thead><tbody>{apartments.map(item=><tr key={item.key}><td><button className="apartment-link" aria-label={(item.apartment+' '+apartmentAddress(item,region.region_name)+' 실거래 보기')} onClick={()=>onOpenApartment?.(item.key)}>{item.apartment}<span aria-hidden="true">→</span></button></td><td>{apartmentAddress(item,region.region_name)}</td><td>{formatNumber(item.count)}건</td><td>{formatNumber(item.min,2)}억</td><td>{formatNumber(item.max,2)}억</td><td>{formatNumber(areaValue(item.area,areaUnit),2)}{unitLabel}</td><td>{item.latest}</td></tr>)}</tbody></table></div></section>}
  </div>;
}
function PointTooltip({active,payload,areaUnit = 'm2'}) {
  if(!active || !payload?.length)return null;
  const row=payload[0].payload;
  return <div className="point-tooltip"><strong>{row.apartment}</strong><span>{row.dong} · {row.deal_date}</span><b>{formatNumber(row.price,2)}억 원</b><span>{formatNumber(areaValue(row.area_m2,areaUnit),2)}{areaUnitLabel(areaUnit)} · {row.floor??'—'}층</span></div>;
}
function SummaryTable({headers,rows}) {
  return <div className="table-scroll"><table className="summary-table"><thead><tr>{headers.map(value=><th key={value}>{value}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}>{row.map((value,column)=><td key={column}>{value}</td>)}</tr>)}</tbody></table></div>;
}
