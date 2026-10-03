const pending = new Map();
export async function fetchJson(path, fresh = false) {
  const response = await fetch(path, { cache: fresh ? 'no-store' : 'default' });
  if (!response.ok) throw new Error(`데이터를 불러오지 못했습니다 (${response.status}).`);
  return response.json();
}
export function loadDistrict(manifest, code) {
  const district = manifest.districts[code];
  if (!district) return Promise.resolve([]);
  const path = `/data/${district.file}`;
  if (!pending.has(path)) pending.set(path, fetchJson(path).catch(error => { pending.delete(path); throw error; }));
  return pending.get(path);
}
