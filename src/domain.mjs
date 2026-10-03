export const RAW_LABELS = {
  aptNm: '아파트명', umdNm: '법정동', jibun: '지번', dealAmount: '거래금액(만원)',
  dealYear: '계약년', dealMonth: '계약월', dealDay: '계약일', excluUseAr: '전용면적(㎡)',
  floor: '층', buildYear: '건축년도', sggCd: '시군구코드', aptDong: '아파트동',
  dealingGbn: '거래유형', estateAgentSggNm: '중개사 소재지', rgstDate: '등기일자',
  cdealType: '해제여부', cdealDay: '해제일자', buyerGbn: '매수자 구분',
  slerGbn: '매도자 구분', landLeaseholdGbn: '토지임대부 여부',
};
export const OPERATORS = {
  contains: '포함', equals: '일치', excludes: '제외', empty: '비어 있음',
  not_empty: '비어 있지 않음', gte: '숫자 이상', lte: '숫자 이하',
};
export const PYEONG_M2 = 3.305785;
export const formatNumber = (value, digits = 0) => value == null || !Number.isFinite(value)
  ? '—' : new Intl.NumberFormat('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
export const monthLabel = (value) => value ? `${value.slice(0, 4)}.${value.slice(4)}` : '—';
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function scopeRows(rows, region, start, end) {
  return rows.filter(row => row.region_code === region.region_code &&
    (!region.dongs.length || region.dongs.includes(row.dong)) &&
    (!start || row.deal_month >= start) && (!end || row.deal_month <= end));
}
export function validRows(rows, minArea = 0, maxArea = Infinity, dongs = []) {
  return rows.filter(row => row.cancelled === 0 && row.area_m2 >= minArea &&
    row.area_m2 <= maxArea && (!dongs.length || dongs.includes(row.dong)));
}
export const priceEok = row => row.price_man / 10000;
export const pricePerPyeong = row => row.price_man * PYEONG_M2 / row.area_m2;
export const apartmentKey = row => JSON.stringify([row.dong, row.jibun, row.apartment]);
export function stats(rows) {
  return { count: rows.length, median: median(rows.map(priceEok)),
    pyeong: median(rows.map(pricePerPyeong)), apartments: new Set(rows.map(apartmentKey)).size };
}
export function monthSequence(start, end) {
  if (!/^\d{6}$/.test(start ?? '') || !/^\d{6}$/.test(end ?? '') || start > end) return [];
  let year = Number(start.slice(0, 4)), month = Number(start.slice(4));
  if (month < 1 || month > 12 || Number(end.slice(4)) < 1 || Number(end.slice(4)) > 12) return [];
  const result = [];
  while (result.length < 1200) {
    const value = `${year}${String(month).padStart(2, '0')}`;
    if (value > end) break;
    result.push(value);
    if (++month > 12) { month = 1; year++; }
  }
  return result;
}
export function monthly(rows, start, end) {
  const groups = new Map();
  rows.forEach(row => { if (!groups.has(row.deal_month)) groups.set(row.deal_month, []); groups.get(row.deal_month).push(row); });
  return monthSequence(start, end).map(month => ({ month, label: monthLabel(month), ...stats(groups.get(month) || []) }));
}
export function apartmentSummary(rows) {
  const groups = new Map();
  rows.forEach(row => { const key = apartmentKey(row); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); });
  return [...groups].map(([key, items]) => ({ key, apartment: items[0].apartment,
    dong: items[0].dong, jibun: items[0].jibun, count: items.length,
    median: median(items.map(priceEok)), min: Math.min(...items.map(priceEok)),
    max: Math.max(...items.map(priceEok)), area: items.reduce((sum, row) => sum + row.area_m2, 0) / items.length,
    latest: items.reduce((value, row) => row.deal_date > value ? row.deal_date : value, ''),
  })).sort((a, b) => b.count - a.count || b.median - a.median || a.key.localeCompare(b.key, 'ko'));
}
export function areaSummary(rows) {
  const ranges = [[0, 60, '60㎡ 이하'], [60, 85, '60–85㎡'], [85, 102, '85–102㎡'],
    [102, 135, '102–135㎡'], [135, Infinity, '135㎡ 초과']];
  return ranges.map(([min, max, label]) => ({ label, ...stats(rows.filter(row => row.area_m2 > min && row.area_m2 <= max)) }));
}
export function rawFields(rows) {
  const available = new Set(rows.flatMap(row => Object.keys(row.raw)));
  return [...Object.keys(RAW_LABELS).filter(field => available.has(field)),
    ...[...available].filter(field => !(field in RAW_LABELS)).sort()];
}
export function filterError(filters) {
  for (const [field, filter] of Object.entries(filters)) {
    if (['gte', 'lte'].includes(filter.op) && filter.value?.trim() && !Number.isFinite(parseNumeric(filter.value))) {
      return `${RAW_LABELS[field] || field}: 숫자를 입력해 주세요.`;
    }
  }
  return '';
}
function parseNumeric(value) {
  const stripped = String(value ?? '').replaceAll(',', '').trim();
  return stripped ? Number(stripped) : NaN;
}
export function filterRaw(rows, filters = {}, query = '') {
  if (filterError(filters)) return [];
  const text = query.trim().toLocaleLowerCase();
  return rows.filter(row => {
    if (text && !Object.values(row.raw).some(value => value.toLocaleLowerCase().includes(text))) return false;
    return Object.entries(filters).every(([field, filter]) => {
      const value = row.raw[field] ?? '', needle = filter.value ?? '';
      if (filter.op === 'empty') return value === '';
      if (filter.op === 'not_empty') return value !== '';
      if (!needle.trim()) return true;
      if (filter.op === 'gte' || filter.op === 'lte') {
        const number = parseNumeric(value), limit = parseNumeric(needle);
        return Number.isFinite(number) && (filter.op === 'gte' ? number >= limit : number <= limit);
      }
      const normalized = value.toLocaleLowerCase(), lowered = needle.toLocaleLowerCase();
      if (filter.op === 'equals') return normalized === lowered;
      if (filter.op === 'excludes') return !normalized.includes(lowered);
      return normalized.includes(lowered);
    });
  });
}
export function sortRaw(rows, field, direction = 'asc') {
  if (!field) return rows;
  return [...rows].sort((a, b) => String(a.raw[field] ?? '').localeCompare(String(b.raw[field] ?? ''), 'ko', {numeric: true}) * (direction === 'asc' ? 1 : -1));
}
export function csv(rows, fields) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return '\uFEFF' + [fields.map(field => quote(RAW_LABELS[field] || field)).join(','),
    ...rows.map(row => fields.map(field => quote(row.raw[field] ?? '')).join(','))].join('\r\n');
}
export function hierarchy(region) {
  const parts = region.region_name.split(' ');
  return { province: parts[0], city: parts[0] === '서울특별시' ? '서울특별시' : parts[1],
    district: parts[0] === '서울특별시' ? parts[1] : (parts[2] || '구 없음') };
}
export function buildCatalog(regions) {
  const districts = new Map();
  regions.forEach(region => {
    if (!districts.has(region.region_code)) districts.set(region.region_code, {
      region_id: `area_${region.region_code}`, label: `${region.region_name} 전체`,
      region_code: region.region_code, region_name: region.region_name, dongs: [],
    });
  });
  return [...regions.filter(region => !region.region_id.startsWith('dong_')),
    ...[...districts.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko')),
    ...regions.filter(region => region.region_id.startsWith('dong_'))];
}
export function stableSample(rows, maximum = 3000) {
  if (rows.length <= maximum) return rows;
  const stride = rows.length / maximum;
  return Array.from({ length: maximum }, (_, i) => rows[Math.floor(i * stride)]);
}
