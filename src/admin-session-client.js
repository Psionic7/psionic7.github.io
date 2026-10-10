const prefix = '/api/admin';
const messages = {
  401: '접속이 만료되었습니다. GitHub로 다시 로그인하세요.',
  403: '접속 상태를 확인한 뒤 다시 시도하세요.',
  409: '설정이 변경되었거나 작업이 진행 중입니다. 새로고침 후 다시 시도하세요.',
  429: '접속 시도가 많습니다. 1분 후 다시 시도하세요.',
  503: '관리자 서버 연결 설정을 확인하세요.',
};
export function sessionAdminClient(fetcher = fetch) {
  let csrf = '';
  const request = async (path, method = 'GET', body, restoring = false) => {
    const response = await fetcher(prefix + path, {
      method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(30000),
      headers: {'Content-Type': 'application/json', ...(method !== 'GET' && csrf ? {'X-Admin-CSRF': csrf} : {})},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (restoring && response.status === 401) return null;
    if (!response.ok) {
      const error = new Error(messages[response.status] || '관리자 요청을 완료하지 못했습니다.');
      error.status = response.status;
      throw error;
    }
    return response.json();
  };
  return {
    async restore() {
      const value = await request('/session', 'GET', undefined, true);
      if (!value) return null;
      if (typeof value.user !== 'string' || typeof value.csrf !== 'string' || !/^[a-f0-9]{64}$/.test(value.csrf))
        throw new Error('관리자 접속 상태를 확인하지 못했습니다.');
      csrf = value.csrf;
      return value.user;
    },
    async logout() {await request('/logout', 'POST', {});csrf = '';},
    load: () => request('/settings'),
    runs: () => request('/runs'),
    save: (config, loaded) => request('/settings', 'POST', {config, sha: loaded.sha}),
    dispatch: months => request('/collect', 'POST', {months}),
  };
}
export function adminPortalUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['/', '/admin.html'].includes(url.pathname)) return '';
    return url.origin + '/admin.html';
  } catch {return '';}
}
export function githubLoginError(search) {
  const code = new URLSearchParams(search).get('authError');
  const message = {denied: '이 저장소 소유자의 GitHub 계정으로 로그인하세요.', cancelled: 'GitHub 로그인이 취소되었습니다. 다시 로그인하세요.', invalid: 'GitHub 로그인 요청이 만료되었거나 올바르지 않습니다. 다시 로그인하세요.', unavailable: 'GitHub 로그인을 완료하지 못했습니다. 관리자 서버 연결 설정을 확인하세요.'}[code];
  return typeof message==='string'?message:'';
}
