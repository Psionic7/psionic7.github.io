import {AdminSessions} from '../../auth-admin/session-store.mjs';
import {handleAdmin} from '../../auth-admin/worker.mjs';
import {validateConfig, updateSchedule} from '../../automation/config.mjs';

export const fixtureOrigin = 'https://admin.example';
export const fixtureCatalog = [{region_id: 'dong_11110101', label: '서울특별시 종로구 청운동', region_code: '11110', region_name: '서울특별시 종로구', dongs: ['청운동']}];
export const fixtureConfig = {version: 1, time_kst: '01:00', recent_months: 3, address_limit: 1000, region_ids: ['dong_11110101']};
export function createAuthFixture({origin = fixtureOrigin, manifest = {regions: fixtureCatalog}, config = fixtureConfig} = {}) {
  const data = new Map(); let alarm = null, transaction = Promise.resolve();
  const storage = {
    get: async key => data.get(key),
    put: async (key,value) => {data.set(key,value);},
    delete: async keys => {for (const key of Array.isArray(keys)?keys:[keys]) data.delete(key);},
    list: async () => new Map(data),
    getAlarm: async () => alarm,
    setAlarm: async value => {alarm=value;},
    transaction(callback) {const result=transaction.then(()=>callback(storage));transaction=result.catch(()=>{});return result;},
  };
  const object = new AdminSessions({storage});
  const state = {user: {id: 7, login: 'Psionic7'}, repository: {owner: {id: 7}}, tokenUser: 'Psionic7', runs: [],
    loaded: {sha: 'old', config, workflow: "on:\n  schedule:\n    - cron: '0 16 * * *' # collection-schedule\n"}, saves: [], dispatches: [], github: [], tokens: []};
  const env = {GITHUB_ADMIN_TOKEN: 'fixture-server-token', GITHUB_OAUTH_CLIENT_ID: 'fixtureClient', GITHUB_OAUTH_CLIENT_SECRET: 'fixture-client-secret', ADMIN_ORIGIN: origin,
    ADMIN_SESSIONS: {idFromName: name => name, get: () => object}};
  if(origin.startsWith('http://127.0.0.1'))env.LOCAL_PREVIEW=true;
  const fetcher = async (url, options = {}) => {
    state.github.push({url, options});
    if(url.endsWith('/data/manifest.json'))return Response.json(manifest);
    if(url==='https://github.com/login/oauth/access_token')return Response.json({access_token: 'fixture-oauth-token', token_type: 'bearer'});
    if(url==='https://api.github.com/user')return Response.json(state.user);
    if(url==='https://api.github.com/repos/Psionic7/psionic7.github.io')return Response.json(state.repository);
    throw new Error('Unexpected upstream request');
  };
  const client = {
    login: async () => state.tokenUser,
    load: async () => state.loaded,
    runs: async () => state.runs,
    dispatch: async months => {state.dispatches.push(months);},
    save: async (value,loaded,catalog) => {
      state.saves.push({value,loaded,catalog});
      const next=validateConfig(value,catalog);
      state.loaded={sha:'new',config:next,workflow:updateSchedule(loaded.workflow,next.time_kst)};
      return state.loaded;
    },
  };
  const clientFactory = token => {state.tokens.push(token);return client;};
  const handle = request => handleAdmin(request,env,{fetcher,clientFactory});
  const request = (path, {method = 'GET', headers = {}, body, cookie} = {}) => handle(new Request(origin+'/api/admin'+path,{
    method, headers:{...(method!=='GET'?{'Origin':origin,'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...headers},
    body:body===undefined?undefined:JSON.stringify(body),
  }));
  const begin = async () => {
    const response=await request('/login');
    const authorize=new URL(response.headers.get('Location'));
    const cookie=response.headers.get('Set-Cookie').split(';')[0];
    return {response,authorize,cookie,state:authorize.searchParams.get('state')};
  };
  const callback = flow => request('/callback?code=fixture-code&state='+flow.state,{cookie:flow.cookie,headers:{'Sec-Fetch-Site':'cross-site'}});
  const signIn = async () => {
    const flow=await begin(),response=await callback(flow);
    const cookie=response.headers.getSetCookie().find(value=>value.startsWith(env.LOCAL_PREVIEW?'home-records-preview-admin=':'__Host-home-records-admin=')).split(';')[0];
    const session=await (await request('/session',{cookie})).json();
    return {flow,response,cookie,session};
  };
  return {env,state,data,storage,object,fetcher,clientFactory,handle,request,begin,callback,signIn};
}
