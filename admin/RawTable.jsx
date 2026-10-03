import React, { useEffect, useMemo, useState } from 'react';
import { Download, Search, Filter, X, ChevronLeft, ChevronRight, ArrowUpDown, Columns3 } from 'lucide-react';
import { RAW_LABELS, OPERATORS, csv, filterError, filterRaw, formatNumber, areaValue, rawFields, sortRaw } from '../src/domain.mjs';
import { Empty } from '../src/ViewState.jsx';
import AreaUnit from '../src/AreaUnit.jsx';
const convertedArea = '__exclusivePyeong';
const fieldLabel = field => field === convertedArea ? '전용면적(평 · 환산)' : (RAW_LABELS[field] || field);

export default function RawTable({rows, region, start, end}) {
  const sourceFields = useMemo(() => rawFields(rows), [rows]);
  const [areaUnit, setAreaUnit] = useState('m2');
  const hasArea = sourceFields.includes('excluUseAr');
  const fields = areaUnit === 'pyeong' && hasArea ? sourceFields.flatMap(field => field === 'excluUseAr' ? [field, convertedArea] : [field]) : sourceFields;
  const displayRows = useMemo(() => !hasArea ? rows : rows.map(row => {
    const original = String(row.raw.excluUseAr ?? '').trim();
    const m2 = Number(original.replaceAll(',', ''));
    return {...row, raw: {...row.raw, [convertedArea]: original && Number.isFinite(m2) ? String(areaValue(m2, 'pyeong')) : ''}};
  }), [rows, hasArea]);
  const [filters, setFilters] = useState({}), [query, setQuery] = useState('');
  const [hidden, setHidden] = useState([]), [page, setPage] = useState(1), [size, setSize] = useState(100);
  const [sort, setSort] = useState({field: '', direction: 'asc'});
  const result = useMemo(() => sortRaw(filterRaw(displayRows, filters, query), sort.field, sort.direction), [displayRows, filters, query, sort]);
  const visible = fields.filter(field => !hidden.includes(field));
  const pages = Math.max(1, Math.ceil(result.length / size));
  const safePage = Math.min(page, pages);
  useEffect(() => { setPage(1); }, [rows, filters, query, size]);
  const shown = result.slice((safePage - 1) * size, safePage * size);
  const active = Object.entries(filters).filter(([,filter]) => ['empty', 'not_empty'].includes(filter.op) || filter.value?.trim());
  const error = filterError(filters).replace(convertedArea, fieldLabel(convertedArea));
  const changeFilter = (field, value) => setFilters(previous => ({...previous, [field]: {...(previous[field] || {op:'contains',value:''}), ...value}}));
  const clearFilter = field => setFilters(previous => { const next = {...previous}; delete next[field]; return next; });
  const download = () => {
    const blob = new Blob([csv(result, sourceFields)], {type:'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `${region.region_id}_${start}_${end}_raw.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="panel raw-panel">
    <div className="section-title"><div><h2>신고 자료 그대로</h2><p>해제 거래 포함 · 원천 필드 {sourceFields.length}개 · 각 열의 필터 버튼을 사용하세요.</p></div><button className="primary" onClick={download} disabled={!result.length || !!error}><Download size={16} />CSV 다운로드</button></div>
    {hasArea && <div className="raw-area-unit"><AreaUnit value={areaUnit} onChange={setAreaUnit}/><p className="small-note">평 표시에서는 환산 열을 추가합니다. 원본 ㎡와 CSV는 그대로 유지합니다. 전용평 = ㎡ ÷ 3.305785.</p></div>}
    <div className="table-toolbar"><label className="inline-search"><Search size={16}/><input aria-label="원천 데이터 전체 검색" type="search" placeholder="모든 열에서 검색" value={query} onChange={event => setQuery(event.target.value)}/></label><span><strong>{formatNumber(result.length)}</strong> / {formatNumber(rows.length)}건</span><details className="column-picker"><summary><Columns3 size={15}/>표시 열</summary><div className="picker-content">{fields.map(field => <label key={field}><input type="checkbox" checked={!hidden.includes(field)} onChange={event => setHidden(previous => event.target.checked ? previous.filter(value => value !== field) : [...previous,field])}/>{fieldLabel(field)}</label>)}</div></details><button onClick={() => {setFilters({});setQuery('');}}>필터 초기화</button></div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {active.length > 0 && <div className="filter-chips">{active.map(([field, filter]) => <button key={field} onClick={() => clearFilter(field)}>{fieldLabel(field)} · {OPERATORS[filter.op]} {filter.value}<X size={13}/></button>)}</div>}
    {!rows.length ? <Empty/> : <>
      <div className="table-scroll" tabIndex={0} aria-label="원천 데이터 표"><table className="raw-table"><thead><tr>{visible.map(field => <th key={field}><div className="column-heading"><button className="sort-button" onClick={() => setSort({field,direction: sort.field === field && sort.direction === 'asc' ? 'desc' : 'asc'})}>{fieldLabel(field)}<ArrowUpDown size={12}/>{sort.field === field && <span>{sort.direction === 'asc' ? '↑':'↓'}</span>}</button><details className="column-filter"><summary aria-label={`${fieldLabel(field)} 필터`} className={active.some(([value])=>value===field)?'active':''}><Filter size={13}/></summary><div className="filter-popover"><strong>{fieldLabel(field)}</strong><small>{field === convertedArea ? '전용면적(㎡) ÷ 3.305785' : field}</small><select aria-label={`${field} 필터 조건`} value={filters[field]?.op || 'contains'} onChange={event => changeFilter(field,{op:event.target.value})}>{Object.entries(OPERATORS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>{!['empty','not_empty'].includes(filters[field]?.op) && <input aria-label={`${field} 필터 값`} placeholder="필터 값" value={filters[field]?.value || ''} onChange={event=>changeFilter(field,{value:event.target.value})}/>}<button onClick={()=>clearFilter(field)}>이 열 필터 해제</button></div></details></div></th>)}</tr></thead><tbody>{shown.map(row => <tr key={row.id} className={row.cancelled ? 'cancelled-row':''}>{visible.map(field=><td key={field} title={row.raw[field] || ''}>{field === convertedArea && row.raw[field] !== '' ? formatNumber(Number(row.raw[field]),2) : (row.raw[field] ?? '')}</td>)}</tr>)}</tbody></table>{!result.length && <Empty title="필터와 일치하는 자료가 없습니다."/>}{!visible.length && <p className="notice">표시 열을 하나 이상 선택해 주세요.</p>}</div>
      <div className="pagination"><label>페이지당 행<select aria-label="페이지당 행" value={size} onChange={event=>setSize(Number(event.target.value))}>{[100,500,1000].map(value=><option key={value} value={value}>{value}개</option>)}</select></label><span>{formatNumber(safePage)} / {formatNumber(pages)} 페이지</span><button aria-label="이전 페이지" disabled={safePage<=1} onClick={()=>setPage(safePage-1)}><ChevronLeft size={17}/></button><button aria-label="다음 페이지" disabled={safePage>=pages} onClick={()=>setPage(safePage+1)}><ChevronRight size={17}/></button></div>
    </>}
    <p className="small-note">빈 칸은 원천 API의 빈 값을 그대로 나타냅니다. 옅은 주황색 행은 계약 해제 거래입니다. CSV에는 필터 결과의 모든 행과 원천 열이 포함됩니다.</p>
    <details className="field-guide"><summary>원천 필드 설명 보기</summary><dl>{sourceFields.map(field=><div key={field}><dt>{field}</dt><dd>{RAW_LABELS[field] || '추가 API 필드'}</dd></div>)}</dl></details>
  </section>;
}
