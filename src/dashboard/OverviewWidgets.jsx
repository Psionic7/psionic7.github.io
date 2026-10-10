import React,{useState} from 'react';
import {MapPin,Building2,ArrowUpRight,Clock3,ChartNoAxesCombined} from 'lucide-react';
import {areaValue,formatNumber,priceEok} from '../domain.mjs';
import {apartmentFavoriteLabel} from '../apartment-favorites.js';
export const shortDate=date=>date?date.slice(2).replaceAll('-','.'):'—';
const statuses={loading:'불러오는 중',error:'불러오기 실패',uncollected:'미수집'};
export function OverviewMetrics({model}) {
  return <section className="overview-metrics" aria-label="관심 거래 요약">
    <article><span><MapPin size={15}/>동 유효 거래</span><strong>{formatNumber(model.dongCount)}<small>건</small></strong><p>즐겨찾기 동 {model.dongGroups.length}곳 · 선택 기간</p></article>
    <article><span><Building2 size={15}/>아파트 유효 거래</span><strong>{formatNumber(model.apartmentCount)}<small>건</small></strong><p>즐겨찾기 아파트 {model.apartmentGroups.length}곳 · 선택 기간</p></article>
    <article><span><Clock3 size={15}/>마지막 유효 계약</span><strong className="overview-date"><time dateTime={model.lastValid?.deal_date}>{shortDate(model.lastValid?.deal_date)}</time></strong><p>관심 동·아파트의 전체 수집 자료 기준</p></article>
  </section>;
}
export function FavoriteOverview({groups,type,days,onOpen,onManage,range}) {
  const [limit,setLimit]=useState(4),isDong=type==='dong',title=isDong?'즐겨찾기한 동':'즐겨찾기한 아파트',Icon=isDong?MapPin:Building2;
  return <section className="panel overview-favorites" aria-label={title+' 현황'}>
    <div className="overview-section-heading"><h2><Icon size={18}/>{title}<span className="badge">{groups.length}곳</span></h2><button className="text-button" onClick={onManage}>{isDong?'동 관리':'아파트 관리'}<ArrowUpRight size={13}/></button></div>
    <p className="small-note">{isDong?'최근 '+days+'일의 유효 거래와 이전 같은 길이 기간의 변화':'마지막 계약은 전체 수집 자료의 최신 유효 거래'} · 저장한 순서</p>
    {!groups.length?<div className="overview-list-empty"><p>{isDong?'지역 지도의 별표로 동을 추가하세요.':'아파트 지도의 별표나 아파트 검색에서 즐겨찾기를 추가하세요.'}</p><button onClick={onManage}>{isDong?'동 즐겨찾기 추가':'아파트 즐겨찾기 추가'}</button></div>:<div className="overview-favorite-list">{groups.slice(0,limit).map(group=>{
      const {item,latest,status}=group,label=isDong?item.label:apartmentFavoriteLabel(item);
      return <button className={'overview-favorite '+(status==='ready'?'ready':status)} key={isDong?item.region_id:item.id} aria-label={label+' 거래 보기'} onClick={()=>onOpen(item,range)}>
        <div className="overview-favorite-name"><strong>{isDong?item.dongs[0]:item.apartment}</strong><small>{item.region_name}{isDong?'':' '+item.dong+' · 지번 '+(item.jibun||'미상')}</small>{status==='ready'&&isDong&&<span className="overview-change">{group.comparable?(group.count===group.previousCount?'이전 기간과 동일':(group.count>group.previousCount?'+':'')+formatNumber(group.count-group.previousCount)+'건 · 이전 기간 대비'):'이전 기간 비교 자료 없음'}</span>}{status==='ready'&&!isDong&&<span className="overview-last">마지막 계약 {shortDate(latest?.deal_date)}{latest&&' · '+formatNumber(areaValue(latest.area_m2,'pyeong'),1)+'평 · '+(latest.floor??'—')+'층'}</span>}</div>
        <div className="overview-favorite-value">{status==='ready'?<><strong>{isDong?formatNumber(group.count)+'건':latest?formatNumber(priceEok(latest),2)+'억 원':'—'}</strong><small>{isDong?(group.partial?'일부 기간 자료':'최근 '+days+'일'):formatNumber(group.count)+'건 · 최근 '+days+'일'}</small></>:<span className={'overview-state '+status}>{statuses[status]}</span>}<ArrowUpRight size={14}/></div>
      </button>;
    })}</div>}
    {groups.length>limit&&<button className="overview-more" onClick={()=>setLimit(previous=>previous+4)}>{isDong?'동':'아파트'} 더 보기 ({Math.min(limit,groups.length)} / {groups.length})</button>}
  </section>;
}
export function OverviewTrend({model}) {
  const max=Math.max(1,...model.trend.map(bin=>bin.count));
  return <section className="panel overview-trend" aria-label="관심 거래 흐름"><div className="overview-section-heading"><h2><ChartNoAxesCombined size={18}/>관심 거래 흐름</h2><span className="badge">{formatNumber(model.uniqueCount)}건</span></div>
    <p className="small-note">유효 거래 · 동·아파트 중복 제외 · {model.step}일 단위</p>
    {model.ready?<><figure><div className="overview-bars" role="img" aria-label={'선택 기간 유효 거래 '+model.uniqueCount+'건의 계약일 흐름'}>{model.trend.map(bin=><div key={bin.start} className="overview-bin" title={bin.start+' — '+bin.end+' · '+bin.count+'건'}><span>{formatNumber(bin.count)}</span><i style={{height:(bin.count?Math.max(4,bin.count/max*100):2)+'%'}} aria-hidden="true"/></div>)}</div><figcaption><time dateTime={model.range.start}>{shortDate(model.range.start)}</time><span>계약일 기준</span><time dateTime={model.range.end}>{shortDate(model.range.end)}</time></figcaption></figure>
    <details className="overview-chart-data"><summary>거래 흐름 수치 보기</summary><div className="table-scroll"><table className="summary-table"><thead><tr><th>기간</th><th>유효 거래</th></tr></thead><tbody>{model.trend.map(bin=><tr key={bin.start}><td>{shortDate(bin.start)} — {shortDate(bin.end)}</td><td>{formatNumber(bin.count)}건</td></tr>)}</tbody></table></div></details></>:<div className="overview-chart-empty">{model.loading?'관심 지역의 자료를 불러오는 중입니다.':'확인할 수 있는 거래 자료가 없습니다.'}</div>}
    <p className="small-note">{model.ready&&!model.uniqueCount?'선택 기간의 유효 거래가 없습니다.':'가격 변화가 아닌 거래 활동을 보여줍니다.'}</p>
  </section>;
}
export function RecentOverview({model,regions,apartments,onOpenDong,onOpenApartment}) {
  const dongs=new Map(regions.map(item=>[item.region_id,item])),apts=new Map(apartments.map(item=>[item.id,item]));
  const open=entry=>{const apartment=apts.get(entry.apartmentIds[0]);if(apartment)onOpenApartment(apartment,model.range,Boolean(entry.row.cancelled));else onOpenDong(dongs.get(entry.dongIds[0]),model.range,Boolean(entry.row.cancelled));};
  return <section className="panel overview-recent" aria-label="최근 관심 거래"><div className="overview-section-heading"><h2><Clock3 size={18}/>최근 관심 거래</h2><span className="badge">최신 8건</span></div><p className="small-note">계약일 최신순 · 해제 거래 포함 · 동·아파트에 함께 포함된 거래는 한 번만 표시</p>
    {model.recent.length?<div className="table-scroll overview-trades" role="region" aria-label="최근 관심 거래 내역" tabIndex={0}><table className="summary-table"><thead><tr><th>계약일</th><th>아파트 이름</th><th>전용면적</th><th>층</th><th>거래금액</th><th>거래 상태 / 해제일</th><th>조회</th></tr></thead><tbody>{model.recent.slice(0,8).map(entry=>{const {row}=entry;return <tr key={row.region_code+'|'+row.id} className={row.cancelled?'cancelled-trade':''}><td><time dateTime={row.deal_date}>{shortDate(row.deal_date)}</time></td><td><strong>{row.apartment}</strong><small>{row.dong}{entry.apartmentIds.length>0?' · 관심 아파트':' · 관심 동'}</small></td><td>{formatNumber(areaValue(row.area_m2,'pyeong'),1)}평</td><td>{row.floor??'—'}층</td><td><strong>{formatNumber(priceEok(row),2)}억 원</strong></td><td><span className={'trade-status '+(row.cancelled?'cancelled':'')}>{row.cancelled?'해제':'유효'}</span>{!!row.cancelled&&<small>해제일 {row.raw?.cdealDay?.trim()||'미상'}</small>}</td><td><button className="text-button" aria-label={row.apartment+' '+row.dong+' '+row.deal_date+' 거래 조회'} onClick={()=>open(entry)}><ArrowUpRight size={14}/></button></td></tr>;})}</tbody></table></div>:<div className="overview-chart-empty">{model.loading?'최근 거래를 불러오는 중입니다.':model.ready?'선택 기간에 확인된 관심 거래가 없습니다.':'확인할 수 있는 거래 자료가 없습니다.'}</div>}
  </section>;
}
