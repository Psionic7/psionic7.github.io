import React from 'react';
import {CalendarDays,ChevronLeft,ChevronRight} from 'lucide-react';
import FilterGroup from './weekly/FilterGroup.jsx';
import {recentRange,shiftMonth,shiftWeek,weekBounds} from './weekly.mjs';

export default function PeriodPicker({period,onChange,day,onDayChange,range,earliestDay,latestDay,error}) {
  const week=weekBounds(day),monthMin=earliestDay?.slice(0,7),monthMax=latestDay?.slice(0,7);
  return <FilterGroup number="01" title="조회 기간" label="조회 기간 설정" icon={CalendarDays} caption="계약일 기준" className="period-card">
    <div className="period-tabs" role="group" aria-label="조회 기간 기준">{[['week','주간'],['month','월간'],['custom','직접 지정']].map(([mode,label])=><button type="button" key={mode} aria-pressed={period.mode===mode} onClick={()=>onChange({...period,mode})}>{label}</button>)}</div>
    <div className="period-fields">
      {period.mode==='week'&&<><label>조회 주 기준 날짜<input type="date" value={day} min={earliestDay} max={latestDay||undefined} onChange={event=>onDayChange(event.target.value)}/></label><div className="period-stepper"><button aria-label="이전 주" disabled={!week||!!earliestDay&&shiftWeek(day,-1)<weekBounds(earliestDay).start} onClick={()=>onDayChange(shiftWeek(day,-1))}><ChevronLeft size={16}/></button><span>월요일 — 일요일</span><button aria-label="다음 주" disabled={!week||!!latestDay&&shiftWeek(day,1)>latestDay} onClick={()=>onDayChange(shiftWeek(day,1))}><ChevronRight size={16}/></button></div></>}
      {period.mode==='month'&&<><label>조회 월<input type="month" value={period.month} min={monthMin} max={monthMax} onChange={event=>onChange({...period,month:event.target.value})}/></label><div className="period-stepper"><button aria-label="이전 달" disabled={!range||!!monthMin&&shiftMonth(period.month,-1)<monthMin} onClick={()=>onChange({...period,month:shiftMonth(period.month,-1)})}><ChevronLeft size={16}/></button><span>선택한 달 전체</span><button aria-label="다음 달" disabled={!range||!!monthMax&&shiftMonth(period.month,1)>monthMax} onClick={()=>onChange({...period,month:shiftMonth(period.month,1)})}><ChevronRight size={16}/></button></div></>}
      {period.mode==='custom'&&<><label>조회 시작일<input type="date" value={period.start} min={earliestDay} max={latestDay||undefined} onChange={event=>onChange({...period,start:event.target.value})}/></label><label>조회 종료일<input type="date" value={period.end} min={earliestDay} max={latestDay||undefined} onChange={event=>onChange({...period,end:event.target.value})}/></label></>}
    </div>
    <div className="period-shortcuts"><span>빠른 선택</span>{[7,30,90].map(count=>{const recent=recentRange(latestDay,count,earliestDay);return <button type="button" key={count} disabled={!recent} aria-pressed={period.mode==='custom'&&period.start===recent?.start&&period.end===recent?.end} onClick={()=>onChange({...period,mode:'custom',...recent})}>최근 {count}일</button>;})}</div>
    <div className={`period-summary ${error?'invalid':''}`}><span>적용 기간</span><strong>{range?`${range.start} — ${range.end}`:'날짜를 확인해 주세요'}</strong></div>
    {error&&<p className="notice error" role="alert">{error}</p>}
    <p className="small-note">자료 기준일 {latestDay||'미상'} · 최근 기간은 자료 기준일까지 계산합니다.</p>
  </FilterGroup>;
}
