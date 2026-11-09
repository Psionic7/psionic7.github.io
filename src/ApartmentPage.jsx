import React,{useMemo} from 'react';
import {Star} from 'lucide-react';
import TransactionPage from './TransactionPage.jsx';
import ApartmentSelector from './transactions/ApartmentSelector.jsx';
import {sameApartmentFavorite} from './apartment-favorites.js';
import {apartmentQueryRegion} from './apartment-query.js';
import ApartmentSaleListings from './transactions/ApartmentSaleListings.jsx';
import useApartmentListings from './transactions/useApartmentListings.js';
import useApartmentInformation from './useApartmentInformation.js';
export default function ApartmentPage({manifest,catalog,favorites=[],favoriteRegions=[],selected=[],onChange,searchRegionId,onSearchRegionChange,searchFilters,onSearchFiltersChange,onToggleFavorite,listingClient,...props}) {
  const listings=useApartmentListings(selected,listingClient);
  const information=useApartmentInformation(manifest.housing?.sha256||manifest.published_at);
  const regions=useMemo(()=>selected.map(apartmentQueryRegion),[selected]);
  const searchRegion=catalog.find(region=>region.region_id===searchRegionId);
  const toggle=item=>onChange(selected.some(saved=>sameApartmentFavorite(saved,item))?selected.filter(saved=>!sameApartmentFavorite(saved,item)):selected.length<1000?[...selected,item]:selected);
  const relatedHistory=region=>{
    const partial=(region.identity_related_sources||[]).filter(id=>!region.identity_coverage?.entity_ids.includes(id));
    const sources=information.filter(item=>item.identity_ref?.kind==='source'&&partial.includes(item.identity_ref.id));
    const cohorts=region.identity_ref?.kind==='source'&&region.identity_coverage?.cohort_ids.length>1?information.filter(item=>item.identity_ref?.kind==='cohort'&&region.identity_coverage.cohort_ids.includes(item.id)):[];
    const choose=item=>{if(!selected.some(saved=>sameApartmentFavorite(saved,item)))onChange([...selected.filter(saved=>saved.id!==region.id),item]);};
    const legal=region.housing_legal_types?.filter(type=>type!=='아파트')||[];
    return sources.length||cohorts.length||legal.length?<aside className="notice" aria-label="연결된 단지 거래">{legal.length>0&&<p>{region.housing_source_kind==='APT'?'실거래 원천 분류: 아파트 · ':' '}건축물대장 용도: {region.housing_legal_types.join(', ')}</p>}{sources.length>0&&<><p>이 주소로 구분할 수 없는 과거 거래는 원천 단지의 전체 내역에서 확인할 수 있습니다.</p>{sources.map(item=><button key={item.id} onClick={()=>choose(item)}>{item.apartment} 전체 거래 보기</button>)}</>}{cohorts.length>0&&<><p>여러 주소를 포함한 원천 단지입니다. 주소별 거래와 매물도 확인할 수 있습니다.</p>{cohorts.map(item=><button key={item.id} onClick={()=>choose(item)}>{item.road_address||item.apartment} 거래·매물 보기</button>)}</>}</aside>:null;
  };
  return <TransactionPage {...props} manifest={manifest} regions={regions} apartmentView renderAfterTrades={({region,...filters})=><>{relatedHistory(region)}<ApartmentSaleListings favorite={region} result={listings} {...filters}/></>} renderResultActions={region=>{const item=selected.find(item=>item.id===region.region_id),saved=favorites.some(favorite=>sameApartmentFavorite(favorite,item));return item&&onToggleFavorite?<button className="favorite-result-action" aria-pressed={saved} aria-label={item.apartment+' 관심 단지 '+(saved?'해제':'저장')} title={saved?'관심 단지 해제':'관심 단지 저장'} onClick={()=>onToggleFavorite(item)}><Star size={18} fill={saved?'currentColor':'none'}/></button>:null;}} filterScope="apartmentTransactions" searchRegionCode={searchRegion?.region_code} renderSelection={({datasets,onRetry})=><ApartmentSelector information={information} manifest={manifest} catalog={catalog} favorites={favorites} favoriteRegions={favoriteRegions} selected={selected} onToggle={toggle} onClear={()=>onChange([])} searchRegion={searchRegion} onSearchRegionChange={onSearchRegionChange} filters={searchFilters} setFilters={onSearchFiltersChange} dataset={datasets[searchRegion?.region_code]} onRetry={onRetry} onToggleFavorite={onToggleFavorite}/>}/>;
}
