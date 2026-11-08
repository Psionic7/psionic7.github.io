import {normalizeApartmentName} from './apartment-boundaries.mjs';
import {normalizeRoadAddress,normalizeParcel} from '../src/address-identity.mjs';

export function resolveTradeCandidates(trade, candidates, aliases,{roadAliases=aliases}={}) {
  if(trade.road_ambiguous)return {ids:[],method:'road_address_conflict'};
  // Attached parcels often span neighbouring complexes. Prefer the actual
  // building's primary parcel before applying names or shared-address rules.
  const lot=normalizeParcel(trade.jibun);
  const primary = candidates.filter(c => lot&&normalizeParcel(c.jibun)===lot&&c.dong===trade.dong);
  const name=normalizeApartmentName(trade.apartment);
  const validYear=c=>!trade.year||!c.build_year||Number(trade.year)===c.build_year;
  const road=normalizeRoadAddress(trade.road_address);
  if(road){
    const addressed=candidates.filter(c=>[c.road_address,...(c.road_addresses||[])].some(value=>normalizeRoadAddress(value)===road));
    if(addressed.length){
      const phases=value=>[...String(value||'').matchAll(/(\d+(?:-\d+)?)(?:단지|차)/g)].map(match=>match[1]);
      const requestedPhases=phases(trade.apartment);
      const phaseAgrees=c=>{const known=[...new Set([...(roadAliases.get(c.apartment_id)||[])].flatMap(phases))];return !requestedPhases.length||!known.length||[...requestedPhases,...known].some(value=>value.includes('-'))||requestedPhases.some(value=>known.includes(value));};
      const independentlyNamed=addressed.filter(c=>phaseAgrees(c)&&roadAliases.get(c.apartment_id)?.has(name));
      let named=addressed.filter(c=>phaseAgrees(c)&&(roadAliases.get(c.apartment_id)?.has(name)||primary.includes(c)&&validYear(c)&&aliases.get(c.apartment_id)?.has(name)));
      const primaryNamed=named.filter(c=>primary.includes(c));
      if(primaryNamed.length)named=primaryNamed;
      if(!named.length)return {ids:[],method:'road_name_conflict'};
      if(named.length===1)return validYear(named[0])?{ids:[named[0].apartment_id],method:independentlyNamed.includes(named[0])?'road_and_verified_name':'road_and_existing_link'}:{ids:[],method:'review'};
      if(named.every(c=>primary.includes(c)&&validYear(c)&&c.build_year===named[0].build_year)&&named[0].build_year)return {ids:named.map(c=>c.apartment_id).sort(),method:'shared_registry_address'};
      return {ids:named.map(c=>c.apartment_id),method:'review'};
    }
    if(candidates.some(c=>[c.road_address,...(c.road_addresses||[])].some(value=>normalizeRoadAddress(value))))return {ids:[],method:'road_address_conflict'};
  }
  const pool = primary.length ? primary : candidates;
  const named = pool.filter(c => aliases.get(c.apartment_id)?.has(name));
  const selected = named.length ? named : pool;
  if (selected.length === 1) return validYear(selected[0]) ? {ids: [selected[0].apartment_id], method: named.length ? 'parcel_and_official_name' : 'unique_registry_parcel'} : {ids: [], method: 'review'};
  // Separate registry roots can represent buildings within one complex. Keep
  // every stable master ID; share trades only with matching primary parcel,
  // official road address, approval year and a common official name.
  const first = selected[0];
  if (primary.length && normalizeRoadAddress(first?.road_address) && first.build_year && selected.every(c =>
    validYear(c) && normalizeRoadAddress(c.road_address)===normalizeRoadAddress(first.road_address) && c.build_year === first.build_year) &&
    [...(aliases.get(first.apartment_id) || [])].some(alias => alias && selected.every(c => aliases.get(c.apartment_id)?.has(alias)))) {
    return {ids: selected.map(c => c.apartment_id).sort(), method: 'shared_registry_address'};
  }
  return {ids: selected.map(c => c.apartment_id), method: 'review'};
}
