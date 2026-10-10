import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {adminClient} from '../automation/github-admin-client.mjs';
import {REPOSITORY, validateConfig} from '../automation/config.mjs';
export {AdminSessions} from './session-store.mjs';

const publicOrigin = 'https://psionic7.github.io', owner = REPOSITORY.split('/')[0];
const hash = value => createHash('sha256').update(value).digest();
const randomId = () => randomBytes(32).toString('hex');
const equals = (left, right) => timingSafeEqual(hash(left), hash(right));
const version = env => hash(env.GITHUB_OAUTH_CLIENT_ID + ':' + env.GITHUB_OAUTH_CLIENT_SECRET + ':' + env.GITHUB_ADMIN_TOKEN).toString('hex');
const sessionSeconds = 4 * 60 * 60;
class AdminError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
function json(value, status = 200, headers = {}) {
  return Response.json(value, {status, headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers}});
}
function cookieName(local, oauth = false) {
  return (local ? 'home-records-preview-' : '__Host-home-records-') + (oauth ? 'oauth' : 'admin');
}
function cookie(value, local, {seconds = sessionSeconds, oauth = false} = {}) {
  return cookieName(local, oauth) + '=' + value + '; Path=/; HttpOnly; SameSite=' + (oauth ? 'Lax' : 'Strict') + '; Max-Age=' + seconds + (local ? '' : '; Secure');
}
function readCookie(request, local, oauth = false) {
  const values = (request.headers.get('Cookie') || '').split(';').map(value => value.trim());
  const found = values.find(value => value.startsWith(cookieName(local, oauth) + '='));
  const value = found?.slice(cookieName(local, oauth).length + 1) || '';
  return /^[a-f0-9]{64}$/.test(value) ? value : '';
}
function configuration(env, url, local) {
  if (typeof env.GITHUB_ADMIN_TOKEN !== 'string' || !env.GITHUB_ADMIN_TOKEN.trim() ||
      typeof env.GITHUB_OAUTH_CLIENT_ID !== 'string' || !/^[A-Za-z0-9_]{1,100}$/.test(env.GITHUB_OAUTH_CLIENT_ID) ||
      typeof env.GITHUB_OAUTH_CLIENT_SECRET !== 'string' || !env.GITHUB_OAUTH_CLIENT_SECRET.trim() ||
      !env.ADMIN_SESSIONS?.get || !env.ADMIN_SESSIONS?.idFromName)
    throw new AdminError(503, '관리자 서버 설정이 완료되지 않았습니다.');
  let origin;
  try {origin = new URL(env.ADMIN_ORIGIN);} catch {throw new AdminError(503, '관리자 서버 주소 설정을 확인하세요.');}
  if (origin.origin !== url.origin || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !local))
    throw new AdminError(503, '관리자 서버 주소 설정을 확인하세요.');
  return origin.origin + '/api/admin/callback';
}
function assertOrigin(request) {
  if ((request.headers.has('Sec-Fetch-Site') && !['same-origin','none'].includes(request.headers.get('Sec-Fetch-Site')))  ||
      (request.method !== 'GET' && request.headers.get('Origin') !== new URL(request.url).origin))
    throw new AdminError(403, '이 관리자 페이지에서 다시 요청하세요.');
}
async function readBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || ''))
    throw new AdminError(415, '요청 형식을 확인하세요.');
  if (Number(request.headers.get('Content-Length')) > 32768)
    throw new AdminError(413, '요청 크기가 너무 큽니다.');
  const reader = request.body?.getReader();
  if (!reader) throw new AdminError(400, '요청 내용을 확인하세요.');
  const chunks = []; let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32768) {await reader.cancel();throw new AdminError(413, '요청 크기가 너무 큽니다.');}
    chunks.push(value);
  }
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset);offset += chunk.byteLength;}
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {throw new AdminError(400, '요청 내용을 확인하세요.');}
}
async function store(env, action, body) {
  const object = env.ADMIN_SESSIONS.get(env.ADMIN_SESSIONS.idFromName('admin-sessions'));
  const response = await object.fetch(new Request('https://sessions/' + action, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
  }));
  if (!response.ok) throw new AdminError(503, '접속 상태를 확인하지 못했습니다. 잠시 후 다시 시도하세요.');
  return response.json();
}
async function readManifest(fetcher) {
  const response = await fetcher(publicOrigin + '/data/manifest.json', {cache: 'no-store', signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new AdminError(503, '공개 지역 목록을 확인하지 못했습니다.');
  const manifest = await response.json();
  if (!Array.isArray(manifest.regions)) throw new AdminError(503, '공개 지역 목록을 확인하지 못했습니다.');
  return manifest;
}
function publicError(error) {
  if (error instanceof AdminError) return json({message: error.message}, error.status);
  if (error.message === '설정이 다른 곳에서 변경되었습니다. 새로고침 후 다시 저장하세요.')
    return json({message: error.message}, 409);
  if (['예약 시간, 수집 지역, 최근 개월 수와 주소 조회 한도를 확인하세요.', '수집 지역 목록에 유효하지 않은 지역이 있습니다.', '최근 개월 수를 확인하세요.'].includes(error.message))
    return json({message: error.message}, 400);
  return json({message: '관리자 작업을 완료하지 못했습니다. 서버의 GitHub 연결 설정과 실행 이력을 확인하세요.'}, 503);
}
function protect(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.tile.openstreetmap.org; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
  return new Response(response.body, {status: response.status, headers});
}
function redirect(origin, path, cookies = []) {
  const headers = new Headers({'Location': origin + path, 'Cache-Control': 'no-store'});
  for (const value of cookies) headers.append('Set-Cookie', value);
  return protect(new Response(null, {status: 303, headers}));
}
async function identity(code, oauth, env, fetcher) {
  const response = await fetcher('https://github.com/login/oauth/access_token', {
    method: 'POST', headers: {'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'home-records-admin'},
    body: JSON.stringify({client_id: env.GITHUB_OAUTH_CLIENT_ID, client_secret: env.GITHUB_OAUTH_CLIENT_SECRET, code, redirect_uri: oauth.redirectUri, code_verifier: oauth.verifier}),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new AdminError(503, 'GitHub 로그인을 확인하지 못했습니다.');
  const token = await response.json();
  if (typeof token.access_token !== 'string' || !token.access_token || token.token_type?.toLowerCase() !== 'bearer' || token.error)
    throw new AdminError(401, 'GitHub 로그인을 확인하지 못했습니다.', 'invalid');
  const options = {headers: {'Authorization': 'Bearer ' + token.access_token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'home-records-admin'}, cache: 'no-store', signal: AbortSignal.timeout(30000)};
  const [userResponse, repoResponse] = await Promise.all([
    fetcher('https://api.github.com/user', options), fetcher('https://api.github.com/repos/' + REPOSITORY, options),
  ]);
  if (!userResponse.ok || !repoResponse.ok) throw new AdminError(503, 'GitHub 계정을 확인하지 못했습니다.');
  const [user, repository] = await Promise.all([userResponse.json(), repoResponse.json()]);
  if (!Number.isSafeInteger(user.id) || user.id<=0 || user.id !== repository.owner?.id || user.login?.toLowerCase() !== owner.toLowerCase())
    throw new AdminError(403, '이 저장소 소유자의 GitHub 계정으로 접속하세요.', 'denied');
  return user.login;
}

export async function handleAdmin(request, env, {fetcher = fetch, clientFactory = adminClient} = {}) {
  const url = new URL(request.url), local = env.LOCAL_PREVIEW === true && url.protocol === 'http:' && url.hostname === '127.0.0.1';
  try {
    if (url.protocol !== 'https:' && !local) throw new AdminError(403, 'HTTPS 주소로 접속하세요.');
    if (url.pathname === '/') return redirect(url.origin, '/admin.html');
    if (url.pathname === '/data/manifest.json' && request.method === 'GET') return protect(json(await readManifest(fetcher)));
    if (!url.pathname.startsWith('/api/admin/')) {
      if (!env.ASSETS?.fetch) return new Response(null, {status: 404});
      return protect(await env.ASSETS.fetch(request));
    }
    const path = url.pathname.slice('/api/admin'.length);
    const routes = {'/login': 'GET', '/callback': 'GET', '/session': 'GET', '/logout': 'POST', '/settings': ['GET', 'POST'], '/runs': 'GET', '/collect': 'POST'};
    if (!routes[path]) throw new AdminError(404, '관리자 요청을 찾을 수 없습니다.');
    if (![routes[path]].flat().includes(request.method)) throw new AdminError(405, '요청 방식을 확인하세요.');
    if (path !== '/callback') assertOrigin(request);
    const redirectUri = configuration(env, url, local);
    const githubFetcher = (endpoint, options = {}) => fetcher(endpoint, {...options, headers: {...options.headers, 'User-Agent': 'home-records-admin'}});
    const client = clientFactory(env.GITHUB_ADMIN_TOKEN, githubFetcher);
    if (path === '/login') {
      const attempt = await store(env, 'attempt', {key: hash(request.headers.get('CF-Connecting-IP') || 'local').toString('hex')});
      if (!attempt.allowed) throw new AdminError(429, '접속 시도가 많습니다. 1분 후 다시 시도하세요.');
      const state = randomId(), binding = randomId(), verifier = randomBytes(32).toString('base64url');
      await store(env, 'oauth-create', {state, binding, verifier, redirectUri, version: version(env)});
      const authorization = new URL('https://github.com/login/oauth/authorize');
      authorization.search = new URLSearchParams({client_id: env.GITHUB_OAUTH_CLIENT_ID, redirect_uri: redirectUri, state, code_challenge: hash(verifier).toString('base64url'), code_challenge_method: 'S256', login: owner, allow_signup: 'false', scope: 'read:user'}).toString();
      return protect(new Response(null, {status: 302, headers: {'Location': authorization.href, 'Cache-Control': 'no-store', 'Set-Cookie': cookie(binding, local, {seconds: 600, oauth: true})}}));
    }
    if (path === '/callback') {
      const state = url.searchParams.get('state'), binding = readCookie(request, local, true);
      if (url.searchParams.getAll('state').length !== 1 || !/^[a-f0-9]{64}$/.test(state || '') || !binding)
        throw new AdminError(401, 'GitHub 로그인 요청을 확인하지 못했습니다.', 'invalid');
      const oauth = await store(env, 'oauth-consume', {state, binding});
      if (!oauth || oauth.version !== version(env) || oauth.redirectUri !== redirectUri)
        throw new AdminError(401, 'GitHub 로그인 요청이 만료되었습니다.', 'invalid');
      if (url.searchParams.has('error')) throw new AdminError(401, 'GitHub 로그인이 취소되었습니다.', 'cancelled');
      const code = url.searchParams.get('code');
      if (url.searchParams.getAll('code').length !== 1 || !/^[A-Za-z0-9_-]{1,512}$/.test(code || ''))
        throw new AdminError(401, 'GitHub 로그인 요청을 확인하지 못했습니다.', 'invalid');
      const user = await identity(code, oauth, env, fetcher), tokenUser = await client.login();
      if (tokenUser.toLowerCase() !== owner.toLowerCase()) throw new AdminError(503, '서버의 GitHub 연결 설정을 확인하세요.');
      const previous = readCookie(request, local);
      if (previous) await store(env, 'delete', {id: previous});
      const id = randomId(), csrf = randomId();
      await store(env, 'create', {id, csrf, user, version: version(env)});
      return redirect(url.origin, '/admin.html', [cookie('', local, {seconds: 0, oauth: true}), cookie(id, local)]);
    }
    const sessionId = readCookie(request, local), session = sessionId ? await store(env, 'get', {id: sessionId}) : null;
    if (!session || session.version !== version(env)) {
      if (session) await store(env, 'delete', {id: sessionId});
      return protect(json({message: '접속이 만료되었습니다. 다시 로그인하세요.'}, 401, {'Set-Cookie': cookie('', local, {seconds: 0})}));
    }
    if (request.method !== 'GET' && !equals(request.headers.get('X-Admin-CSRF') || '', session.csrf))
      throw new AdminError(403, '접속 상태를 확인한 뒤 다시 요청하세요.');
    if (path === '/session') return protect(json({user: session.user, csrf: session.csrf, expires: session.expires}));
    if (path === '/logout') {
      await store(env, 'delete', {id: sessionId});
      return protect(json({loggedOut: true}, 200, {'Set-Cookie': cookie('', local, {seconds: 0})}));
    }
    if (path === '/runs') return protect(json(await client.runs()));
    if (path === '/settings' && request.method === 'GET') {
      const loaded = await client.load();
      return protect(json({sha: loaded.sha, config: loaded.config}));
    }
    const body = await readBody(request);
    if ((await client.runs()).some(run => run.status !== 'completed'))
      throw new AdminError(409, '진행 중인 수집·배포가 끝난 뒤 다시 요청하세요.');
    if (path === '/collect') {
      if (typeof body.months !== 'string' || (body.months!==''&&!/^(?:[1-9]|1[0-2])$/.test(body.months))) throw new AdminError(400, '최근 개월 수를 확인하세요.');
      await client.dispatch(body.months);
      return protect(json({requested: true}));
    }
    const manifest = await readManifest(fetcher), config = validateConfig(body.config, manifest.regions), loaded = await client.load();
    if (typeof body.sha !== 'string' || body.sha !== loaded.sha)
      throw new AdminError(409, '설정이 다른 곳에서 변경되었습니다. 새로고침 후 다시 저장하세요.');
    const saved = await client.save(config, loaded, manifest.regions);
    return protect(json({sha: saved.sha, config: saved.config}));
  } catch (error) {
    if (url.pathname === '/api/admin/callback')
      return redirect(url.origin, '/admin.html?authError=' + (error instanceof AdminError && ['denied', 'cancelled', 'invalid'].includes(error.code) ? error.code : 'unavailable'), [cookie('', local, {seconds: 0, oauth: true})]);
    return protect(publicError(error));
  }
}
export default {fetch: handleAdmin};
