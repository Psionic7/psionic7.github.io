export function validRegionFavorites(value) {
  return Array.isArray(value)&&value.length<=2000&&value.every(id=>typeof id==='string'&&/^dong_\d{8}$/.test(id))&&new Set(value).size===value.length;
}
