const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=value=>typeof value==='string'&&value.trim().length>0;
const months=value=>Array.isArray(value)&&value.every(month=>typeof month==='string'&&/^\d{4}(0[1-9]|1[0-2])$/.test(month));

export function validateManifest(value){
  if(!object(value)||!Array.isArray(value.regions)||!object(value.districts)||!months(value.months)||!text(value.published_at)||!Number.isFinite(Date.parse(value.published_at))
    ||value.regions.some(region=>!object(region)||!text(region.region_id)||!text(region.region_code)||!text(region.region_name)||!text(region.label)||!Array.isArray(region.dongs)||region.dongs.some(dong=>!text(dong)))
    ||Object.values(value.districts).some(district=>!object(district)||!text(district.file)||!months(district.months)||district.dongs!==undefined&&(!Array.isArray(district.dongs)||district.dongs.some(dong=>!text(dong)))))
    throw new Error('공개 데이터 목록의 형식이 올바르지 않습니다. 잠시 후 다시 불러와 주세요.');
  return value;
}
