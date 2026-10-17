import React,{useEffect,useMemo,useState} from 'react';
import {Search,ArrowUpRight,MapPin,Building2} from 'lucide-react';
import {fetchJson} from './data.js';
import {hasTradeCoverage} from './coverage.js';

export const normalizeSearch=value=>String(value||'').toLocaleLowerCase().replace(/[\s·()_-]/g,'');
export async function loadSearchIndex(){
  const index=await fetchJson('/apartment-map/manifest.json',true);
  if(!/^apartments-[a-f0-9]{12}\.json$/.test(index?.apartments?.file||''))throw new Error('검색 목록을 확인할 수 없습니다.');
  const items=await fetchJson('/apartment-map/'+index.apartments.file);
  if(!Array.isArray(items))throw new Error('검색 목록을 확인할 수 없습니다.');
  return items;
}
export default function HomeSearch({manifest,catalog,onApartment,onRegion,loader=loadSearchIndex}){
  const [query,setQuery]=useState(''),[items,setItems]=useState(null),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0),[limit,setLimit]=useState(12);
  const needle=normalizeSearch(query);
  const searching=!!needle;
  useEffect(()=>{if(!searching)return;let active=true;setFailed(false);loader().then(value=>{if(active)setItems(value);}).catch(()=>{if(active)setFailed(true);});return()=>{active=false;};},[searching,loader,retry]);
  useEffect(()=>setLimit(12),[query]);
  const covered=catalog.filter(region=>hasTradeCoverage(manifest,region));
  const districts=covered.filter(region=>!region.dongs.length);
  const matches=useMemo(()=>(items||[]).filter(item=>hasTradeCoverage(manifest,{...item,dongs:[item.dong]})&&normalizeSearch([item.apartment,item.region_name,item.dong,item.road_address,...(item.name_aliases||[])].join(' ')).includes(needle)),[items,manifest,needle]);
  const regionMatches=searching?covered.filter(region=>region.dongs.length&&normalizeSearch(region.label).includes(needle)).slice(0,6):[];
  return <section className="home-search" aria-label="단지·동네 통합 검색">
    <label htmlFor="home-search-input">어느 아파트가 궁금하세요?</label>
    <div className="home-search-field"><Search size={22}/><input id="home-search-input" type="search" value={query} placeholder="단지명 또는 동네 이름을 입력하세요" onChange={event=>setQuery(event.target.value)}/>{query&&<button onClick={()=>setQuery('')}>지우기</button>}</div>
    {!searching?<div className="search-coverage"><span>실거래가 제공 지역</span>{districts.map(region=><button key={region.region_id} onClick={()=>setQuery(region.region_name)}>{region.region_name.replace(/^경기도 |^서울특별시 /,'')}<ArrowUpRight size={14}/></button>)}</div>:<div className="home-search-results" aria-live="polite">
      {regionMatches.length>0&&<div className="search-region-matches">{regionMatches.map(region=><button key={region.region_id} onClick={()=>onRegion(region)}><MapPin size={16}/>{region.label}<ArrowUpRight size={14}/></button>)}</div>}
      <p>{failed?'단지 목록을 불러오지 못했습니다.':items?`단지 ${matches.length}곳 · 거래 자료 제공 지역에서 검색`:'단지 목록을 불러오는 중입니다.'}{failed&&<button onClick={()=>setRetry(value=>value+1)}>다시 시도</button>}</p>
      {items&&matches.slice(0,limit).map(item=><button className="home-search-result" key={item.id} aria-label={item.apartment+' '+item.region_name+' '+item.dong+' 실거래가 보기'} onClick={()=>onApartment(item)}><Building2 size={20}/><span><strong>{item.apartment}</strong><small>{item.region_name} {item.dong} · {item.jibun}</small></span><ArrowUpRight size={17}/></button>)}
      {items&&!matches.length&&!regionMatches.length&&<p>일치하는 단지나 동네가 없습니다. 다른 이름이나 주소로 검색해 보세요.</p>}
      {matches.length>limit&&<button className="search-more" onClick={()=>setLimit(value=>value+12)}>단지 더 보기 ({limit} / {matches.length})</button>}
    </div>}
  </section>;
}
