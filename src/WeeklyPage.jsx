import React,{useMemo} from 'react';
import TransactionPage from './TransactionPage.jsx';
import DongSelector from './weekly/DongSelector.jsx';
export default function WeeklyPage({manifest,catalog,selectedIds=[],onChange,favoriteRegions=[],...props}) {
  const selected=useMemo(()=>{const byId=new Map(catalog.filter(region=>region.dongs.length===1).map(region=>[region.region_id,region]));return selectedIds.map(id=>byId.get(id)).filter(Boolean);},[catalog,selectedIds]);
  return <TransactionPage {...props} manifest={manifest} regions={selected} onRemove={region=>onChange(selectedIds.filter(id=>id!==region.region_id))} renderSelection={()=> <DongSelector manifest={manifest} catalog={catalog} selected={selected} selectedIds={selectedIds} onChange={onChange} favoriteRegions={favoriteRegions}/>}/>;
}
