import React, {useRef} from 'react';
import {areaInputValue, areaM2, areaUnitLabel, formatNumber} from './domain.mjs';

export default function AreaRange({minArea, maxArea, ceilingM2, unit, onMinChange, onMaxChange}) {
  const drag=useRef(null);
  const ceiling=Math.ceil(areaInputValue(ceilingM2,unit));
  const low=minArea===''?0:areaInputValue(minArea,unit);
  const high=maxArea===''?ceiling:areaInputValue(maxArea,unit);
  const label=areaUnitLabel(unit);
  const dragValue=value=>Number(Number(value).toFixed(unit==='pyeong'?1:0));
  const changeMin=value=>{
    const m2=areaM2(dragValue(value),unit);
    onMinChange(Number(value)===0?'':maxArea===''?m2:Math.min(m2,maxArea));
  };
  const changeMax=value=>{
    const m2=areaM2(dragValue(value),unit);
    onMaxChange(Number(value)===ceiling?'':minArea===''?m2:Math.max(m2,minArea));
  };
  const pointerValue=event=>{
    const bounds=event.currentTarget.getBoundingClientRect();
    return Math.max(0,Math.min(ceiling,(event.clientX-bounds.left)/bounds.width*ceiling));
  };
  const startDrag=event=>{
    if(event.button!==0)return;
    const value=pointerValue(event);
    // Choose the nearest handle even when the two thumb hit areas overlap.
    drag.current={id:event.pointerId,lower:Math.abs(value-low)<Math.abs(value-high) || low===high && value<low};
    event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
    (drag.current.lower?changeMin:changeMax)(value);
  };
  const moveDrag=event=>{if(drag.current?.id===event.pointerId)(drag.current.lower?changeMin:changeMax)(pointerValue(event));};
  const endDrag=()=>{drag.current=null;};
  const arrowKey=(event,value,change)=>{
    const direction={ArrowLeft:-1,ArrowDown:-1,ArrowRight:1,ArrowUp:1}[event.key];
    if(!direction)return;
    event.preventDefault();
    change(Math.max(0,Math.min(ceiling,value+direction*(unit==='pyeong'?0.1:1))));
  };
  return <div className="area-range" role="group" aria-label="전용면적 범위 슬라이더">
    <div className="area-range-values"><span>최소 <strong>{minArea===''?'제한 없음':`${formatNumber(low,2)}${label}`}</strong></span><span>최대 <strong>{maxArea===''?'제한 없음':`${formatNumber(high,2)}${label}`}</strong></span></div>
    <div className="area-range-track" style={{'--range-start':`${low/ceiling*100}%`,'--range-end':`${Math.max(low,high)/ceiling*100}%`}} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
      <div className="area-range-fill"/>
      <input type="range" aria-label={`최소 전용면적 슬라이더 (${label})`} aria-valuetext={minArea===''?'제한 없음':`${formatNumber(low,2)}${label}`} min="0" max={ceiling} step="any" value={low} onChange={event=>changeMin(event.target.value)} onKeyDown={event=>arrowKey(event,low,changeMin)} style={{zIndex:low>=ceiling/2?4:2}}/>
      <input type="range" aria-label={`최대 전용면적 슬라이더 (${label})`} aria-valuetext={maxArea===''?'제한 없음':`${formatNumber(high,2)}${label}`} min="0" max={ceiling} step="any" value={high} onChange={event=>changeMax(event.target.value)} onKeyDown={event=>arrowKey(event,high,changeMax)} style={{zIndex:3}}/>
    </div>
    <div className="area-range-scale"><span>0{label}</span><span>{formatNumber(ceiling)}{label} · 제한 없음</span></div>
  </div>;
}
