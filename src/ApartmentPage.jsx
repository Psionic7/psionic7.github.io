import React,{useMemo} from 'react';
import {Star} from 'lucide-react';
import TransactionPage from './TransactionPage.jsx';
import ApartmentSelector from './transactions/ApartmentSelector.jsx';
import {sameApartmentFavorite,makeApartmentFavorite} from './apartment-favorites.js';
import {apartmentQueryRegion} from './apartment-query.js';
import useApartmentInformation,{apartmentInformationVersion} from './useApartmentInformation.js';
export default function ApartmentPage({manifest,catalog,favorites=[],favoriteRegions=[],selected=[],onChange,searchRegionId,onSearchRegionChange,searchFilters,onSearchFiltersChange,onToggleFavorite,...props}) {
  const information=useApartmentInformation(manifest.apartment_information||apartmentInformationVersion(manifest));
  const regions=useMemo(()=>selected.map(apartmentQueryRegion),[selected]);
  const searchRegion=catalog.find(region=>region.region_id===searchRegionId);
  const toggle=item=>onChange(selected.some(saved=>sameApartmentFavorite(saved,item))?selected.filter(saved=>!sameApartmentFavorite(saved,item)):selected.length<1000?[...selected,makeApartmentFavorite(item,item)]:selected);
  const relatedHistory=region=>{
    const partial=(region.identity_related_sources||[]).filter(id=>!region.identity_coverage?.entity_ids.includes(id));
    const sources=information.filter(item=>item.identity_ref?.kind==='source'&&partial.includes(item.identity_ref.id));
    const cohorts=region.identity_ref?.kind==='source'&&region.identity_coverage?.cohort_ids.length>1?information.filter(item=>item.identity_ref?.kind==='cohort'&&region.identity_coverage.cohort_ids.includes(item.id)):[];
    const choose=item=>{if(!selected.some(saved=>sameApartmentFavorite(saved,item)))onChange([...selected.filter(saved=>saved.id!==region.id),makeApartmentFavorite(item,item)]);};
    const legal=region.housing_legal_types?.filter(type=>type!=='아파트')||[];
    const status=region.residential_status==='ancillary_only'?'건축물대장에서 부속시설로 확인된 항목입니다. 지도나 검색에서 주거 단지를 다시 선택해 주세요.':region.residential_status==='unresolved'?'이 항목의 주거 용도는 아직 확인되지 않았습니다. 원천 단지의 거래 내역과 주거 판정은 별도로 확인합니다.':region.active===false?'현재 지도 선택에서 제외된 대장 항목입니다. 기존 거래 내역은 보존합니다.':'';
    return sources.length||cohorts.length||legal.length||status?<aside className="notice" aria-label="연결된 단지 거래">{status&&<p>{status}</p>}{legal.length>0&&<p>{region.housing_source_kind==='APT'?'실거래 원천 분류: 아파트 · ':' '}건축물대장 용도: {region.housing_legal_types.join(', ')}</p>}{sources.length>0&&<><p>이 주소로 구분할 수 없는 과거 거래는 원천 단지의 전체 내역에서 확인할 수 있습니다.</p>{sources.map(item=><button key={item.id} onClick={()=>choose(item)}>{item.apartment} 전체 거래 보기</button>)}</>}{cohorts.length>0&&<><p>여러 주소를 포함한 원천 단지입니다. 주소별 거래도 확인할 수 있습니다.</p>{cohorts.map(item=><button key={item.id} onClick={()=>choose(item)}>{item.road_address||item.apartment} 거래 보기</button>)}</>}</aside>:null;
  };
  return <TransactionPage {...props} manifest={manifest} regions={regions} apartmentView renderAfterTrades={({region})=>relatedHistory(region)} renderResultActions={region=>{const item=selected.find(item=>item.id===region.region_id),saved=favorites.some(favorite=>sameApartmentFavorite(favorite,item));return item&&onToggleFavorite?<button className="favorite-result-action" aria-pressed={saved} aria-label={item.apartment+' 관심 단지 '+(saved?'해제':'저장')} title={saved?'관심 단지 해제':'관심 단지 저장'} onClick={()=>onToggleFavorite(item)}><Star size={18} fill={saved?'currentColor':'none'}/></button>:null;}} filterScope="apartmentTransactions" searchRegionCode={searchRegion?.region_code} renderSelection={({datasets,onRetry})=><ApartmentSelector information={information} manifest={manifest} catalog={catalog} favorites={favorites} favoriteRegions={favoriteRegions} selected={selected} onToggle={toggle} onClear={()=>onChange([])} searchRegion={searchRegion} onSearchRegionChange={onSearchRegionChange} filters={searchFilters} setFilters={onSearchFiltersChange} dataset={datasets[searchRegion?.region_code]} onRetry={onRetry} onToggleFavorite={onToggleFavorite}/>}/>;
}
