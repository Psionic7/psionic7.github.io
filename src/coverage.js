export function hasTradeCoverage(manifest,region){
  const district=manifest.districts[region.region_code];
  return !!district&&(!region.dongs.length||!Array.isArray(district.dongs)||region.dongs.some(dong=>district.dongs.includes(dong)));
}
