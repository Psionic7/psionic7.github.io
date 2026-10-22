import React,{useState} from 'react';
import {formatNumber,priceEok} from '../domain.mjs';

export default function TradeTrend({rows,countMode=false}){
  const valid=rows.filter(row=>!row.cancelled);
  const areas=[...new Set(valid.map(row=>Number(row.area_m2)))].sort((a,b)=>a-b);
  const [chosen,setChosen]=useState(null);
  const area=areas.includes(chosen)?chosen:Number(valid[0]?.area_m2);
  const points=valid.filter(row=>Number(row.area_m2)===area).sort((a,b)=>a.deal_date.localeCompare(b.deal_date));
  if(!valid.length)return null;
  const dates=points.map(row=>Date.parse(row.deal_date)),prices=points.map(priceEok);
  const low=Math.min(...prices),high=Math.max(...prices),span=high-low||1;
  const xy=points.map((row,index)=>({x:48+(dates[index]-dates[0])/(dates.at(-1)-dates[0]||1)*544,y:105-(prices[index]-low)/span*70,row}));
  return <details className="trade-trend"><summary>같은 전용면적의 거래 흐름 보기</summary>
    <label>비교할 전용면적<select value={area} onChange={event=>setChosen(Number(event.target.value))}>{areas.map(value=><option value={value} key={value}>{formatNumber(value,2)}㎡ · {valid.filter(row=>Number(row.area_m2)===value).length}건</option>)}</select></label>
    {points.length<2?<p>{countMode?'조회한 최근 거래 중 이 면적의 유효 거래는 1건입니다. 흐름을 비교하려면 조회 건수를 늘려 보세요.':'이 면적은 선택 기간에 유효 거래가 1건입니다. 흐름을 비교하려면 기간을 늘려 보세요.'}</p>:<figure><svg viewBox="0 0 640 145" role="img" aria-label={`전용 ${area}제곱미터 유효 거래 ${points.length}건, 최저 ${low.toFixed(2)}억원, 최고 ${high.toFixed(2)}억원`}>
      {[35,70,105].map(y=><line key={y} x1="48" x2="592" y1={y} y2={y} stroke="#e5eaf3"/>)}
      <text x="0" y="39">{high.toFixed(2)}억</text><text x="0" y="109">{low.toFixed(2)}억</text>
      <polyline points={xy.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="#2858df" strokeWidth="2"/>
      {xy.map((p,index)=><circle key={p.row.id??index} cx={p.x} cy={p.y} r="4" fill="#2858df"><title>{p.row.deal_date} · {p.row.floor??'미상'}층 · {formatNumber(priceEok(p.row),2)}억 원</title></circle>)}
      <text x="48" y="135">{points[0].deal_date}</text><text x="592" y="135" textAnchor="end">{points.at(-1).deal_date}</text>
    </svg><figcaption>동일 전용면적의 유효 거래만 표시합니다. 층·향·상태 차이는 보정하지 않았습니다.</figcaption></figure>}
  </details>;
}
