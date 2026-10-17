import React,{useMemo} from 'react';
import {Star} from 'lucide-react';
import TransactionPage from './TransactionPage.jsx';
import ApartmentSelector from './transactions/ApartmentSelector.jsx';
import {sameApartmentFavorite} from './apartment-favorites.js';
import {apartmentQueryRegion} from './apartment-query.js';
export default function ApartmentPage({manifest,catalog,favorites=[],favoriteRegions=[],selected=[],onChange,searchRegionId,onSearchRegionChange,searchFilters,onSearchFiltersChange,onToggleFavorite,...props}) {
  const regions=useMemo(()=>selected.map(apartmentQueryRegion),[selected]);
  const searchRegion=catalog.find(region=>region.region_id===searchRegionId);
  const toggle=item=>onChange(selected.some(saved=>sameApartmentFavorite(saved,item))?selected.filter(saved=>!sameApartmentFavorite(saved,item)):selected.length<1000?[...selected,item]:selected);
  return <TransactionPage {...props} manifest={manifest} regions={regions} apartmentView renderResultActions={region=>{const item=selected.find(item=>item.id===region.region_id),saved=favorites.some(favorite=>sameApartmentFavorite(favorite,item));return item&&onToggleFavorite?<button className="favorite-result-action" aria-pressed={saved} aria-label={item.apartment+' 관심 단지 '+(saved?'해제':'저장')} title={saved?'관심 단지 해제':'관심 단지 저장'} onClick={()=>onToggleFavorite(item)}><Star size={18} fill={saved?'currentColor':'none'}/></button>:null;}} filterScope="apartmentTransactions" searchRegionCode={searchRegion?.region_code} renderSelection={({datasets,onRetry})=><ApartmentSelector manifest={manifest} catalog={catalog} favorites={favorites} favoriteRegions={favoriteRegions} selected={selected} onToggle={toggle} onClear={()=>onChange([])} searchRegion={searchRegion} onSearchRegionChange={onSearchRegionChange} filters={searchFilters} setFilters={onSearchFiltersChange} dataset={datasets[searchRegion?.region_code]} onRetry={onRetry} onToggleFavorite={onToggleFavorite}/>}/>;
}
