import React, {useMemo} from 'react';
import {apartmentAddress, apartmentKey, areaUnitLabel, areaValue, formatNumber, priceEok, topTrades} from './domain.mjs';

export default function PriceLeaders({rows,areaUnit,regionName='',title='금액 상위 5건',onOpenApartment}) {
  const leaders=useMemo(()=>topTrades(rows),[rows]);
  if(!leaders.length)return null;
  const unit=areaUnitLabel(areaUnit);
  return <section className="price-leaders" aria-label={title}>
    <div className="section-title"><div><h3>{title}</h3><p>현재 지역·기간·면적 조건 · 해제 거래 제외 · 거래금액 높은 순 · 같은 금액은 계약일 최신순</p></div><span className="badge">{leaders.length}건</span></div>
    <div className="table-scroll" role="region" aria-label={`${title} 거래 내역`} tabIndex={0}><table className="summary-table"><thead><tr><th>순서</th><th>거래금액</th><th>아파트 / 주소</th><th>계약일</th><th>전용면적 ({unit})</th><th>층</th></tr></thead><tbody>{leaders.map((row,index)=><tr key={row.id}>
      <td>{index+1}</td><td><strong>{formatNumber(priceEok(row),2)}억 원</strong><small>{formatNumber(row.price_man)}만 원</small></td><td>{onOpenApartment?<button className="apartment-link" onClick={()=>onOpenApartment(apartmentKey(row))}>{row.apartment}</button>:<strong>{row.apartment}</strong>}<small>{apartmentAddress(row,regionName)}</small></td><td>{row.deal_date}</td><td>{formatNumber(areaValue(row.area_m2,areaUnit),2)}{unit}</td><td>{row.floor??'—'}층</td>
    </tr>)}</tbody></table></div>
  </section>;
}
