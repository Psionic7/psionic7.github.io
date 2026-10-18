import {normalizeApartmentName} from './apartment-boundaries.mjs';

export function resolveTradeCandidates(trade, candidates, aliases) {
  // Attached parcels often span neighbouring complexes. Prefer the actual
  // building's primary parcel before applying names or shared-address rules.
  const primary = candidates.filter(c => c.jibun === trade.jibun && c.dong === trade.dong);
  const pool = primary.length ? primary : candidates;
  const name = normalizeApartmentName(trade.apartment);
  const named = pool.filter(c => aliases.get(c.apartment_id)?.has(name));
  const selected = named.length ? named : pool;
  const validYear = c => !trade.year || !c.build_year || Number(trade.year) === c.build_year;
  if (selected.length === 1) return validYear(selected[0]) ? {ids: [selected[0].apartment_id], method: named.length ? 'parcel_and_official_name' : 'unique_registry_parcel'} : {ids: [], method: 'review'};
  // Separate registry roots can represent buildings within one complex. Keep
  // every stable master ID; share trades only with matching primary parcel,
  // official road address, approval year and a common official name.
  const first = selected[0];
  if (primary.length && first?.road_address && first.build_year && selected.every(c =>
    validYear(c) && c.road_address === first.road_address && c.build_year === first.build_year) &&
    [...(aliases.get(first.apartment_id) || [])].some(alias => alias && selected.every(c => aliases.get(c.apartment_id)?.has(alias)))) {
    return {ids: selected.map(c => c.apartment_id).sort(), method: 'shared_registry_address'};
  }
  return {ids: selected.map(c => c.apartment_id), method: 'review'};
}
