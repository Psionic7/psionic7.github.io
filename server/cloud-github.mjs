import {REPOSITORY} from '../automation/config.mjs';
import {createHash} from 'node:crypto';

export const completeSnapshot = release => release.assets.some(a => ['state.enc', 'state.json'].includes(a.name) && a.state === 'uploaded');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const PART_SIZE = 2 * 1024 * 1024;

export function cloudGithub(token, repository = REPOSITORY, fetcher = fetch) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('GitHub 자동 수집 인증 설정을 확인하세요.');
  const base = `https://api.github.com/repos/${repository}`;
  const headers = {Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'home-records-automation'};
  const request = async (endpoint, method = 'GET', body) => {
    const response = await fetcher(base + endpoint, {method, headers: {...headers, 'Content-Type': 'application/json'},
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000)});
    if (!response.ok) throw new Error(`GitHub 자동 수집 요청 실패 (HTTP ${response.status})`);
    return response.status === 204 ? null : response.json();
  };
  const snapshots = async () => {
    const found = [];
    for (let page = 1; page <= 10; page++) {
      const releases = await request(`/releases?per_page=100&page=${page}`);
      found.push(...releases.filter(r => r.draft && /^collection-state-\d{13}$/.test(r.tag_name)));
      if (releases.length < 100) break;
    }
    return found.sort((a, b) => b.tag_name.localeCompare(a.tag_name));
  };
  const download = async id => {
    const response = await fetcher(`${base}/releases/assets/${id}`, {headers: {...headers, Accept: 'application/octet-stream'}, signal: AbortSignal.timeout(180000)});
    if (!response.ok) throw new Error('자동 수집 DB를 내려받지 못했습니다.');
    return Buffer.from(await response.arrayBuffer());
  };
  const upload = async (release, name, bytes) => {
    const url = `https://uploads.github.com/repos/${repository}/releases/${release.id}/assets?name=${name}`;
    let response;
    try {response = await fetcher(url, {method: 'POST', headers: {...headers, 'Content-Type': 'application/octet-stream'}, body: bytes, signal: AbortSignal.timeout(180000)});}
    catch (error) {throw new Error(error.name === 'TimeoutError' ? 'GitHub DB 업로드 제한 시간을 초과했습니다.' : 'GitHub DB 업로드 연결에 실패했습니다.');}
    if (!response.ok) throw new Error('자동 수집 DB를 보관하지 못했습니다.');
  };
  return {
    request, snapshots,
    async restore() {
      const latest = (await snapshots()).find(completeSnapshot);
      if (!latest) throw new Error('자동 수집의 초기 DB가 없습니다. 로컬에서 automation:setup을 먼저 실행하세요.');
      const index = latest.assets.find(a => a.name === 'state.json' && a.state === 'uploaded');
      if (!index) return download(latest.assets.find(a => a.name === 'state.enc' && a.state === 'uploaded').id);
      let manifest;
      try {const bytes = await download(index.id); if (bytes.length > 100000) throw new Error(); manifest = JSON.parse(bytes);}
      catch {throw new Error('자동 수집 DB 보관 목록을 확인하세요.');}
      if (manifest.version !== 1 || !Number.isInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > 1024 * 1024 * 1024 ||
          !/^[a-f\d]{64}$/.test(manifest.sha256) || !Array.isArray(manifest.parts) || !manifest.parts.length || manifest.parts.length > 512 ||
          manifest.parts.some((p, i) => p.name !== `state-${String(i).padStart(4, '0')}.enc` || !Number.isInteger(p.bytes) || p.bytes < 1 || p.bytes > PART_SIZE || !/^[a-f\d]{64}$/.test(p.sha256)) ||
          manifest.parts.reduce((sum, p) => sum + p.bytes, 0) !== manifest.bytes)
        throw new Error('자동 수집 DB 보관 목록이 올바르지 않습니다.');
      const parts = [];
      for (const part of manifest.parts) {
        const asset = latest.assets.find(a => a.name === part.name && a.state === 'uploaded');
        if (!asset) throw new Error('자동 수집 DB 조각이 누락되었습니다.');
        const bytes = await download(asset.id);
        if (bytes.length !== part.bytes || hash(bytes) !== part.sha256) throw new Error('자동 수집 DB 조각의 무결성 확인 실패');
        parts.push(bytes);
      }
      const bytes = Buffer.concat(parts);
      if (bytes.length !== manifest.bytes || hash(bytes) !== manifest.sha256) throw new Error('자동 수집 DB 전체 무결성 확인 실패');
      return bytes;
    },
    async save(bytes) {
      const release = await request('/releases', 'POST', {tag_name: `collection-state-${Date.now()}`, target_commitish: 'main',
        name: '자동 수집 작업 DB (암호화)', body: '자동 수집용 암호화 DB입니다. 공개 자료는 Pages에서 제공됩니다.', draft: true});
      try {
        const parts = [];
        for (let offset = 0; offset < bytes.length; offset += PART_SIZE) {
          const part = bytes.subarray(offset, offset + PART_SIZE), name = `state-${String(parts.length).padStart(4, '0')}.enc`;
          await upload(release, name, part);
          parts.push({name, bytes: part.length, sha256: hash(part)});
          console.log(`암호화 DB 조각 ${parts.length}/${Math.ceil(bytes.length / PART_SIZE)} 보관 완료`);
        }
        // Commit marker is last: unfinished uploads are never used to restore state.
        await upload(release, 'state.json', Buffer.from(JSON.stringify({version: 1, bytes: bytes.length, sha256: hash(bytes), parts})));
        // Keep the newest three complete snapshots. A failed upload never replaces a good DB.
        const all = (await snapshots()).filter(completeSnapshot);
        for (const old of all.slice(3)) {
          try {await request(`/releases/${old.id}`, 'DELETE');}
          catch {console.warn('이전 DB 정리는 다음 실행에서 다시 시도합니다.');}
        }
        return release.id;
      } catch (error) {
        try {await request(`/releases/${release.id}`, 'DELETE');} catch {}
        throw error;
      }
    },
  };
}
