import React,{useMemo} from 'react';
import TransactionPage from './TransactionPage.jsx';
import ApartmentSelector from './transactions/ApartmentSelector.jsx';
import {sameApartmentFavorite} from './apartment-favorites.js';
import {apartmentQueryRegion} from './apartment-query.js';
export default function ApartmentPage({manifest,catalog,favorites=[],favoriteRegions=[],selected=[],onChange,searchRegionId,onSearchRegionChange,searchFilters,onSearchFiltersChange,onToggleFavorite,...props}) {
  const regions=useMemo(()=>selected.map(apartmentQueryRegion),[selected]);
  const searchRegion=catalog.find(region=>region.region_id===searchRegionId);
  const toggle=item=>onChange(selected.some(saved=>sameApartmentFavorite(saved,item))?selected.filter(saved=>!sameApartmentFavorite(saved,item)):selected.length<1000?[...selected,item]:selected);
  return <TransactionPage {...props} manifest={manifest} regions={regions} apartmentView filterScope="apartmentTransactions" searchRegionCode={searchRegion?.region_code} onRemove={item=>onChange(selected.filter(saved=>!sameApartmentFavorite(saved,item)))} renderSelection={({datasets,onRetry})=><ApartmentSelector manifest={manifest} catalog={catalog} favorites={favorites} favoriteRegions={favoriteRegions} selected={selected} onToggle={toggle} onClear={()=>onChange([])} searchRegion={searchRegion} onSearchRegionChange={onSearchRegionChange} filters={searchFilters} setFilters={onSearchFiltersChange} dataset={datasets[searchRegion?.region_code]} onRetry={onRetry} onToggleFavorite={onToggleFavorite}/>}/>;
}
