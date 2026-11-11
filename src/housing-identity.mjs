const rootId = value => typeof value === 'string' && /^hub:[^\s]{1,200}$/.test(value);
const cohortId = value => typeof value === 'string' && /^cohort:[^\s]{1,300}$/.test(value);
const sourceId = value => {
  if (typeof value !== 'string' || value.length > 2100) return false;
  try {
    const tuple = JSON.parse(value);
    return Array.isArray(tuple) && tuple.length === 4 && tuple.every(part => typeof part === 'string' && part.length <= 500) && /^\d{5}$/.test(tuple[0]) && Boolean(tuple[1] && tuple[3]);
  } catch { return false; }
};

export const sourceIdentityId = row => JSON.stringify([row.region_code, row.dong, row.jibun || '', row.apartment]);
export const bindingMatchesSource=(row,binding)=>Boolean(binding&&(binding.entity_id===sourceIdentityId(row)||binding.provider_apartment_id&&binding.provider_apartment_id===row.raw?.aptSeq?.trim()));

export function identityRef(favorite) {
  if (!favorite) return null;
  if (favorite.identity_ref !== undefined) return favorite.identity_ref;
  if (favorite.master_id) return {kind: 'root', id: favorite.master_id};
  if (typeof favorite.dong === 'string' && typeof favorite.apartment === 'string') return {kind: 'source', id: sourceIdentityId(favorite)};
  try {
    const tuple = JSON.parse(favorite.key);
    if (!Array.isArray(tuple) || tuple.length !== 3) return null;
    const id = JSON.stringify([favorite.region_code, ...tuple]);
    return sourceId(id) ? {kind: 'source', id} : null;
  } catch { return null; }
}

export function validIdentityRef(ref) {
  return Boolean(ref && Object.keys(ref).length === 2 && (ref.kind === 'root' ? rootId(ref.id) : ref.kind === 'cohort' ? cohortId(ref.id) : ref.kind === 'source' && sourceId(ref.id)));
}

const ids = (values, validate) => Array.isArray(values) && values.length <= 1000 && new Set(values).size === values.length && values.every(validate);
export const validRelatedSources = values => ids(values, sourceId);
export function validIdentityCoverage(value) {
  return Boolean(value && Object.keys(value).length === 3 && ids(value.entity_ids, sourceId) && ids(value.cohort_ids, cohortId) && ids(value.root_ids, rootId));
}

export function identityTradeMatches(favorite, row) {
  if (!favorite || !row || favorite.region_code && favorite.region_code !== row.region_code) return false;
  const ref = identityRef(favorite);
  if (!ref) return false;
  const binding = row.identity;
  if (ref.kind === 'source') return ref.id === (binding?.entity_id || sourceIdentityId(row));
  if (!binding) return false;
  if (binding.precision === 'building' || binding.precision === 'cohort') {
    return ref.kind === 'root' ? binding.root_id === ref.id : ref.kind === 'cohort' && binding.cohort_id === ref.id;
  }
  return binding.precision === 'complex' && (ref.kind === 'root' || ref.kind === 'cohort') && favorite.identity_coverage?.entity_ids.includes(binding.entity_id) === true;
}

export function identitySelectionEqual(a, b) {
  const left = identityRef(a), right = identityRef(b);
  return Boolean(left && right && left.kind === right.kind && left.id === right.id);
}

export const selectIdentityRows = (rows, favorite) => rows.filter(row => identityTradeMatches(favorite, row));

export function listingBuildingMembers(cohorts) {
  return cohorts.map(cohort=>({cohort_id:cohort.cohort_id,whole_cohort:true,building_dongs:cohort.building_dongs?.length&&cohort.building_dongs.every(dong=>/^\d+$|^[a-z가-힣]$/.test(dong))?[...cohort.building_dongs]:null}));
}
