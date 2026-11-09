const normalize=name=>name.replace(/[\s()[\]·.,_-]|아파트/g,'').toLowerCase();
export {normalize as normalizeListingName};
export function listingRegisteredNameMatches(registered,observed) {
  if(normalize(registered)===normalize(observed))return true;
  const village=name=>normalize(name).replaceAll('마을','');
  if(village(registered).length>=4&&village(registered)===village(observed))return true;
  const parts=registered.split(/[()[\]]/).map(value=>normalize(value).replaceAll('마을','')).filter(Boolean);
  if(parts.length<2||parts.length>6)return false;
  const target=normalize(observed).replaceAll('마을','');
  const consume=(rest,remaining)=>remaining.length?remaining.some((part,index)=>rest.startsWith(part)&&consume(rest.slice(part.length),remaining.filter((_,i)=>i!==index))):rest==='';
  return consume(target,parts);
}

export function listingSearchNames(favorite) {
  const names=[favorite.apartment,...(favorite.name_aliases||[]),...(favorite.trade_keys||[]).map(key=>JSON.parse(key)[2])];
  return [...new Set(names.flatMap(name=>[name,name.replace(/([가-힣])([1-9]\d?)$/,'$1$2차')]))];
}

const phases=name=>[...name.matchAll(/(\d+(?:-\d+)?)(단지|차)/g)].map(match=>match[1]);
export function listingPhase(names) {
  const values=[...new Set(names.flatMap(phases))];
  return values.length===1&&!values[0].includes('-')?values[0]:null;
}
export function listingPhaseMatches(phase,name) {
  const values=phases(name);
  return !phase||!values.length||values.some(value=>value===phase||value.includes('-'));
}
export function listingFavoritePhase(favorite) {
  return listingPhase([favorite.apartment,...(favorite.trade_keys||[]).map(key=>JSON.parse(key)[2])])??listingPhase(listingSearchNames(favorite));
}

export function listingQueryName(favorite,fallback) {
  const root=normalize(favorite.apartment);
  const names=listingSearchNames(favorite),phase=listingFavoritePhase(favorite);
  if(phase){
    const queries=names.flatMap(name=>{const match=[...name.matchAll(/(\d+)(단지|차)/g)].find(value=>value[1]===phase);if(!match)return [];const query=name.slice(0,match.index+match[0].length).replace(/아파트|[()[\]]/g,'').trim();return normalize(query).replace(/\d+(단지|차)$/,'').length>=2?[query]:[];}).sort((a,b)=>a.length-b.length);
    if(queries.length)return queries[0];
  }
  return listingSearchNames(favorite).find(name=>normalize(name).startsWith(root)&&/^[1-9]\d?차$/.test(normalize(name).slice(root.length)))||fallback;
}
