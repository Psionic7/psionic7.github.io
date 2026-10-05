export const CONFIG_PATH = 'automation/config.json';
export const WORKFLOW_PATH = '.github/workflows/refresh-data.yml';
export const WORKFLOW_ID = 'refresh-data.yml';
export const REPOSITORY = 'Psionic7/psionic7.github.io';

export function validateConfig(value, catalog) {
  if (value?.version !== 1 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time_kst || '') ||
      !Number.isInteger(value.recent_months) || value.recent_months < 1 || value.recent_months > 12 ||
      !Number.isInteger(value.address_limit) || value.address_limit < 1 || value.address_limit > 10000 ||
      !Array.isArray(value.region_ids) || !value.region_ids.length || value.region_ids.length > 5000 ||
      value.region_ids.some(id => typeof id !== 'string' || !/^dong_\d{8}$/.test(id)) ||
      new Set(value.region_ids).size !== value.region_ids.length) throw new Error('예약 시간, 수집 지역, 최근 개월 수와 주소 조회 한도를 확인하세요.');
  if (catalog && value.region_ids.some(id => !catalog.some(region => region.region_id === id)))
    throw new Error('수집 지역 목록에 유효하지 않은 지역이 있습니다.');
  return {version: 1, time_kst: value.time_kst, recent_months: value.recent_months,
    address_limit: value.address_limit, region_ids: [...value.region_ids]};
}

export function cronForKst(time) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('예약 시간을 확인하세요.');
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${(hour + 15) % 24} * * *`;
}

export function updateSchedule(workflow, time) {
  const marker = /^([ \t]*- cron: )'[^'\r\n]+'( # collection-schedule)$/gm;
  if ([...workflow.matchAll(marker)].length !== 1) throw new Error('예약 파일 형식이 변경되었습니다. 새로고침 후 다시 시도하세요.');
  return workflow.replace(marker, (_, before, after) => `${before}'${cronForKst(time)}'${after}`);
}

export function recentMonths(count, now = new Date()) {
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error('최근 수집 개월 수를 확인하세요.');
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit'}).formatToParts(now);
  const year = Number(parts.find(p => p.type === 'year').value), month = Number(parts.find(p => p.type === 'month').value);
  const index = year * 12 + month - 1;
  return Array.from({length: count}, (_, i) => {
    const n = index - count + 1 + i;
    return `${Math.floor(n / 12)}${String(n % 12 + 1).padStart(2, '0')}`;
  });
}
