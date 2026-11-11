import {createHash} from 'node:crypto';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {sourceIdentityId,validIdentityRef,listingBuildingMembers} from '../src/housing-identity.mjs';

const sorted=values=>[...new Set(values||[])].sort();
const same=(a,b)=>JSON.stringify(sorted(a))===JSON.stringify(sorted(b));
const ref=(kind,id)=>({kind,id});
const coverage=(entities=[],cohorts=[],roots=[])=>({entity_ids:sorted(entities),cohort_ids:sorted(cohorts),root_ids:sorted(roots)});

export function housingSourceFingerprint(rows) {
  const hash=createHash('sha256');
  for(const row of [...rows].sort((a,b)=>a.id-b.id))hash.update(JSON.stringify([row.id,row.raw_json])+'\n');
  return hash.digest('hex');
}

export function packHousingIdentity(catalog,bindings,rows) {
  const entities=new Set(catalog.entities.map(item=>item.entity_id));
  const cohorts=new Map(catalog.cohorts.map(item=>[item.cohort_id,item]));
  const dictionary=[],byValue=new Map(),assignments=[],ids=new Set();
  for(const row of rows){
    if(ids.has(row.id))throw Error('주거 연결: 원본 거래 ID 중복');
    ids.add(row.id);
    const binding=bindings.get(row.id);
    const provider=(row.raw??JSON.parse(row.raw_json)).aptSeq?.trim();
    const linked=provider&&catalog.provider_sources?.[provider]?.includes(binding?.entity_id);
    if(!binding||binding.entity_id!==sourceIdentityId(row)&&!linked||!entities.has(binding.entity_id))throw Error('주거 연결: 원본 거래의 단지 배정 누락');
    if(!['building','cohort','complex','unresolved'].includes(binding.precision))throw Error('주거 연결: 배정 정밀도 오류');
    if(['building','cohort'].includes(binding.precision)){
      const cohort=cohorts.get(binding.cohort_id);
      if(!cohort||cohort.root_id!==binding.root_id||binding.precision==='building'&&!cohort.building_ids.includes(binding.building_id))throw Error('주거 연결: 건물·구획 참조 오류');
    }
    const value={entity_id:binding.entity_id,precision:binding.precision,root_id:binding.root_id||null,cohort_id:binding.cohort_id||null,building_id:binding.building_id||null,...(binding.entity_id!==sourceIdentityId(row)&&linked?{provider_apartment_id:provider}:{})};
    const key=JSON.stringify(value);
    if(!byValue.has(key)){byValue.set(key,dictionary.length);dictionary.push(value);}
    assignments.push([row.id,byValue.get(key)]);
  }
  if(ids.size!==bindings.size)throw Error('주거 연결: 현재 원본에 없는 거래 배정');
  assignments.sort((a,b)=>a[0]-b[0]);
  // Geometry remains in the working DB/map layer; share URLs only need small selections.
  const publicCohorts=catalog.cohorts.map(({location,...item})=>item);
  return {version:1,entities:catalog.entities,cohorts:publicCohorts,roots:catalog.roots,dictionary,assignments,row_count:rows.length,source_fingerprint:housingSourceFingerprint(rows),...(catalog.provider_sources?{provider_sources:catalog.provider_sources,baseline_sha256:catalog.baseline_sha256}:{})};
}

export function housingQueryInformation(base,payload) {
  const byRoot=new Map((base?.apartments||[]).filter(item=>!item.identity_ref||item.identity_ref.kind==='root').map(item=>[item.master_id||item.id,item]));
  const roots=new Map(payload.roots.map(item=>[item.root_id,item]));
  const entities=new Map(payload.entities.map(item=>[item.entity_id,item]));
  const cohorts=new Map(payload.cohorts.map(item=>[item.cohort_id,item]));
  const result=new Map();
  function favorite(item,kind,id,meta={}){
    const original=item.favorite||item,root=byRoot.get(item.master_id||item.root_id)||{};
    const names=sorted([original.apartment,...(original.name_aliases||[]),...(kind==='root'?root.name_aliases||[]:[])]);
    const value={...original,...makeApartmentFavorite({...original,...meta,identity_ref:ref(kind,id)},original),name_aliases:names,postal_code:original.postal_code||root.postal_code||null,addresses:original.addresses||[],...meta,identity_default_sources:[]};
    if(!validIdentityRef(value.identity_ref))throw Error('주거 선택 참조 오류');
    result.set(value.id,value);return value;
  }
  for(const original of byRoot.values()){
    const root=roots.get(original.id)||{root_id:original.id,cohort_ids:[],entity_ids:[],partial_entity_ids:[]};
    favorite(original,'root',original.id,{identity_listing_members:listingBuildingMembers(payload.cohorts.filter(cohort=>cohort.root_id===root.root_id)),identity_coverage:coverage(root.entity_ids,root.cohort_ids,[root.root_id]),identity_related_sources:sorted([...(root.entity_ids||[]),...(root.partial_entity_ids||[])])});
  }
  for(const cohort of cohorts.values()){
    if(!cohort.favorite?.apartment)throw Error('주거 주소 구획의 표시 정보 누락');
    const complete=payload.entities.filter(entity=>entity.state==='verified'&&same(entity.cohort_ids,[cohort.cohort_id])).map(entity=>entity.entity_id);
    favorite(cohort,'cohort',cohort.cohort_id,{identity_listing_members:listingBuildingMembers([cohort]),housing_legal_types:cohort.legal_types||[],identity_coverage:coverage(complete,[cohort.cohort_id],[cohort.root_id]),identity_related_sources:sorted(payload.entities.filter(entity=>entity.cohort_ids?.includes(cohort.cohort_id)).map(entity=>entity.entity_id))});
  }
  for(const entity of entities.values()){
    if(!entity.favorite?.apartment)throw Error('주거 원천 단지의 표시 정보 누락');
    favorite(entity,'source',entity.entity_id,{housing_source_kind:'APT',housing_legal_types:entity.legal_types||[],identity_coverage:coverage([entity.entity_id],entity.cohort_ids,entity.root_ids),identity_related_sources:[]});
  }
  for(const entity of entities.values()){
    let target=result.get(entity.entity_id);
    const memberCohorts=(entity.cohort_ids||[]).map(id=>cohorts.get(id)).filter(Boolean);
    const rootIds=sorted(memberCohorts.map(item=>item.root_id));
    if(entity.state==='verified'&&memberCohorts.length&&rootIds.length===1){
      const root=roots.get(rootIds[0]);
      if(root&&same(root.cohort_ids,entity.cohort_ids)&&result.has(root.root_id))target=result.get(root.root_id);
      else if(memberCohorts.length===1)target=result.get(memberCohorts[0].cohort_id);
    }
    target.identity_default_sources.push(entity.entity_id);
    target.name_aliases=sorted([...target.name_aliases,entity.favorite.apartment,...(entity.favorite.name_aliases||[])]);
  }
  for(const entry of result.values())entry.identity_search_default=entry.identity_default_sources.length>0||entry.identity_ref.kind==='root'&&!entry.identity_related_sources.length;
  return {version:1,apartments:[...result.values()]};
}
