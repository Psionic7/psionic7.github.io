const normalize=name=>name.replace(/[\s()[\]·.,_-]|아파트/g,'').toLowerCase();

export function listingSearchNames(favorite) {
  const names=[favorite.apartment,...(favorite.name_aliases||[]),...(favorite.trade_keys||[]).map(key=>JSON.parse(key)[2])];
  return [...new Set(names.flatMap(name=>[name,name.replace(/([가-힣])([1-9]\d?)$/,'$1$2차')]))];
}

export function listingQueryName(favorite,fallback) {
  const root=normalize(favorite.apartment);
  return listingSearchNames(favorite).find(name=>normalize(name).startsWith(root)&&/^[1-9]\d?차$/.test(normalize(name).slice(root.length)))||fallback;
}
