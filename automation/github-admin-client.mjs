import {CONFIG_PATH, WORKFLOW_PATH, WORKFLOW_ID, REPOSITORY, validateConfig, updateSchedule} from './config.mjs';

function decode(content) {
  return new TextDecoder().decode(Uint8Array.from(atob(content.replace(/\s/g, '')), c => c.charCodeAt(0)));
}
function encode(content) {
  const bytes = new TextEncoder().encode(content);
  return btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
}

export function adminClient(token, fetcher = fetch) {
  if (typeof token !== 'string' || !token.trim()) throw new Error('GitHub 토큰을 입력하세요.');
  const request = async (endpoint, method = 'GET', body) => {
    const response = await fetcher(`https://api.github.com${endpoint}`, {method, headers: {
      Authorization: `Bearer ${token.trim()}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json',
    }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000), cache: 'no-store'});
    if (!response.ok) {
      const messages = {401: '토큰이 만료되었거나 올바르지 않습니다.', 403: '토큰 권한 또는 GitHub API 호출 한도를 확인하세요.',
        404: '자동 수집 설정을 찾을 수 없습니다. 토큰 권한과 초기 설정을 확인하세요.',
        409: '설정이 다른 곳에서 변경되었습니다. 새로고침 후 다시 저장하세요.',
        422: '요청을 반영하지 못했습니다. 설정이 변경되었거나 토큰 권한이 부족할 수 있습니다. 새로고침 후 다시 시도하세요.'};
      throw new Error(messages[response.status] || `GitHub 요청 실패 (HTTP ${response.status})`);
    }
    return response.status === 204 ? null : response.json();
  };
  const repo = `/repos/${REPOSITORY}`;
  return {
    async login() {
      const user = await request('/user'), repository = await request(repo);
      if (!repository.permissions?.push || repository.default_branch !== 'main') throw new Error('이 저장소의 관리 권한이 필요합니다.');
      return user.login;
    },
    async load() {
      const ref = await request(`${repo}/git/ref/heads/main`);
      const [configFile, workflowFile] = await Promise.all([
        request(`${repo}/contents/${CONFIG_PATH}?ref=${ref.object.sha}`),
        request(`${repo}/contents/${WORKFLOW_PATH}?ref=${ref.object.sha}`),
      ]);
      return {sha: ref.object.sha, config: validateConfig(JSON.parse(decode(configFile.content))), workflow: decode(workflowFile.content)};
    },
    async runs() {
      const data = await request(`${repo}/actions/workflows/${WORKFLOW_ID}/runs?per_page=10&branch=main`);
      return data.workflow_runs.map(r => ({id: r.id, status: r.status, conclusion: r.conclusion, event: r.event, created_at: r.created_at, html_url: r.html_url}));
    },
    async dispatch(months) {
      if (months !== '' && (!Number.isInteger(Number(months)) || Number(months) < 1 || Number(months) > 12)) throw new Error('최근 개월 수를 확인하세요.');
      await request(`${repo}/actions/workflows/${WORKFLOW_ID}/dispatches`, 'POST', {ref: 'main', inputs: {collect: true, recent_months: String(months)}});
    },
    async save(value, loaded, catalog) {
      const config = validateConfig(value, catalog);
      const ref = await request(`${repo}/git/ref/heads/main`);
      if (ref.object.sha !== loaded.sha) throw new Error('설정이 다른 곳에서 변경되었습니다. 새로고침 후 다시 저장하세요.');
      const parent = await request(`${repo}/git/commits/${loaded.sha}`);
      const files = [[CONFIG_PATH, JSON.stringify(config, null, 2) + '\n'], [WORKFLOW_PATH, updateSchedule(loaded.workflow, config.time_kst)]];
      const blobs = await Promise.all(files.map(async ([path, content]) => {
        const blob = await request(`${repo}/git/blobs`, 'POST', {content: encode(content), encoding: 'base64'});
        return {path, mode: '100644', type: 'blob', sha: blob.sha};
      }));
      const tree = await request(`${repo}/git/trees`, 'POST', {base_tree: parent.tree.sha, tree: blobs});
      const commit = await request(`${repo}/git/commits`, 'POST', {message: 'Update scheduled collection settings', tree: tree.sha, parents: [loaded.sha]});
      await request(`${repo}/git/refs/heads/main`, 'PATCH', {sha: commit.sha, force: false});
      return {sha: commit.sha, config, workflow: files[1][1]};
    },
  };
}
