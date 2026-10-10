import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAuthFixture,fixtureOrigin,fixtureConfig} from './helpers/admin-auth-fixture.mjs';

test('GitHub login uses a server-side verifier, PKCE S256 and a separate browser state cookie',async()=>{
 const f=createAuthFixture(),flow=await f.begin(),authorization=flow.authorize,stored=f.data.get('oauth:'+flow.state);
 assert.equal(flow.response.status,302);assert.equal(authorization.origin+authorization.pathname,'https://github.com/login/oauth/authorize');
 assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');assert.equal(authorization.searchParams.get('code_challenge'),createHash('sha256').update(stored.verifier).digest('base64url'));
 assert.notEqual(stored.binding,flow.state);assert.match(flow.response.headers.get('Set-Cookie'),/HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
 for(const secret of [f.env.GITHUB_ADMIN_TOKEN,f.env.GITHUB_OAUTH_CLIENT_SECRET,stored.verifier])assert(!authorization.href.includes(secret));
 assert.equal(authorization.searchParams.get('redirect_uri'),fixtureOrigin+'/api/admin/callback');
});
test('only the repository owner gets an opaque HttpOnly session and secrets never appear in browser responses',async()=>{
 const f=createAuthFixture(),signed=await f.signIn();
 assert.equal(signed.response.status,303);assert.equal(signed.response.headers.get('Location'),fixtureOrigin+'/admin.html');
 const cookies=signed.response.headers.getSetCookie();assert(cookies.some(cookie=>/admin=.*HttpOnly; SameSite=Strict; Max-Age=14400; Secure/.test(cookie)));
 assert.deepEqual(Object.keys(signed.session).sort(),['csrf','expires','user']);assert.equal(signed.session.user,'Psionic7');
 assert.match(signed.session.csrf,/^[a-f0-9]{64}$/);assert(!f.data.has('oauth:'+signed.flow.state));
 const exchange=f.state.github.find(item=>item.url.endsWith('/access_token')),body=JSON.parse(exchange.options.body);
 assert.equal(body.code_verifier.length,43);assert.equal(body.redirect_uri,fixtureOrigin+'/api/admin/callback');assert.equal(body.client_secret,f.env.GITHUB_OAUTH_CLIENT_SECRET);
 const text=JSON.stringify(signed.session)+cookies.join('')+await(await f.request('/settings',{cookie:signed.cookie})).text();
 for(const secret of [f.env.GITHUB_ADMIN_TOKEN,f.env.GITHUB_OAUTH_CLIENT_SECRET,'fixture-oauth-token',body.code_verifier])assert(!text.includes(secret));
});
test('callback requires the initiating browser and an unexpired one-time state; replay never performs another exchange',async()=>{
 const f=createAuthFixture(),flow=await f.begin();
 const wrong=await f.request('/callback?code=fixture-code&state='+flow.state,{cookie:flow.cookie.replace(/=.+$/,'='+'a'.repeat(64))});
 assert(wrong.headers.get('Location').endsWith('authError=invalid'));assert.equal(f.state.github.length,0);
 const success=await f.callback(flow);assert(success.headers.get('Location').endsWith('/admin.html'));
 const before=f.state.github.length,replay=await f.callback(flow);assert(replay.headers.get('Location').endsWith('authError=invalid'));assert.equal(f.state.github.length,before);
 const noCookie=await f.request('/callback?code=fixture-code&state='+flow.state);assert(noCookie.headers.get('Location').endsWith('authError=invalid'));
});
test('expired and cancelled flows, duplicate parameters and rotated secrets fail without token exchange',async()=>{
 for(const variation of ['expired','cancelled','duplicate','rotated']){
  const f=createAuthFixture(),flow=await f.begin();
  if(variation==='expired')f.data.get('oauth:'+flow.state).expires=Date.now()-1;
  if(variation==='rotated')f.env.GITHUB_OAUTH_CLIENT_SECRET='rotated-fixture-secret';
  const suffix=variation==='cancelled'?'&error=access_denied':variation==='duplicate'?'&state='+flow.state:'';
  const response=await f.request('/callback?code=fixture-code&state='+flow.state+suffix,{cookie:flow.cookie});
  assert(response.headers.get('Location').includes('authError='));assert.equal(f.state.github.length,0);
 }
});
test('identity checks reject another account, same login with different ID and a mismatched server credential',async()=>{
 for(const variation of ['other','id','server']){
  const f=createAuthFixture(),flow=await f.begin();
  if(variation==='other')f.state.user={id:8,login:'someone'};
  if(variation==='id')f.state.user.id=8;
  if(variation==='server')f.state.tokenUser='someone';
  const response=await f.callback(flow);
  assert(response.headers.get('Location').endsWith(variation==='server'?'authError=unavailable':'authError=denied'));
  assert(!response.headers.getSetCookie().some(cookie=>cookie.includes('admin=')));assert.equal([...f.data.keys()].filter(key=>key.startsWith('session:')).length,0);
 }
});
test('all administrative reads and writes require a session and arbitrary GitHub proxy endpoints are absent',async()=>{
 const f=createAuthFixture();
 for(const path of ['/session','/settings','/runs'])assert.equal((await f.request(path)).status,401);
 for(const path of ['/settings','/collect','/logout'])assert.equal((await f.request(path,{method:'POST',body:{}})).status,401);
 assert.equal((await f.request('/proxy?url=https://api.github.com/user')).status,404);
 assert.equal(f.state.github.length,0);assert.equal(f.state.saves.length,0);assert.equal(f.state.dispatches.length,0);
});
test('same-origin and CSRF guards run before administrative effects and reject oversized or malformed requests',async()=>{
 const f=createAuthFixture(),signed=await f.signIn(),valid={'X-Admin-CSRF':signed.session.csrf};
 assert.equal((await f.request('/collect',{method:'POST',cookie:signed.cookie,body:{months:''}})).status,403);
 assert.equal((await f.request('/collect',{method:'POST',cookie:signed.cookie,body:{months:''},headers:{...valid,Origin:'https://other.example'}})).status,403);
 assert.equal((await f.request('/runs',{cookie:signed.cookie,headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 assert.equal((await f.request('/collect',{method:'POST',cookie:signed.cookie,body:{months:'x'.repeat(40000)},headers:valid})).status,413);
 assert.equal((await f.request('/collect',{method:'POST',cookie:signed.cookie,body:{months:''},headers:{...valid,'Content-Type':'text/plain'}})).status,415);
 assert.equal((await f.request('/collect',{cookie:signed.cookie})).status,405);
 assert.equal(f.state.dispatches.length,0);
});
test('settings are validated against the server catalog and current SHA; active jobs prevent mutations',async()=>{
 const f=createAuthFixture(),signed=await f.signIn(),options={method:'POST',cookie:signed.cookie,headers:{'X-Admin-CSRF':signed.session.csrf}};
 assert.equal((await f.request('/settings',{...options,body:{sha:'stale',config:fixtureConfig}})).status,409);
 assert.equal((await f.request('/settings',{...options,body:{sha:'old',config:{...fixtureConfig,region_ids:['dong_99999999']}}})).status,400);
 const saved=await f.request('/settings',{...options,body:{sha:'old',config:{...fixtureConfig,time_kst:'02:00'},workflow:'attacker',catalog:[]}});
 assert.equal(saved.status,200);assert.equal(f.state.saves[0].loaded.workflow.includes('0 16'),true);assert.match(f.state.loaded.workflow,/'0 17 \* \* \*'/);
 assert(!('workflow' in await saved.json()));
 f.state.runs=[{status:'in_progress'}];
 assert.equal((await f.request('/collect',{...options,body:{months:'3'}})).status,409);assert.equal(f.state.dispatches.length,0);
 f.state.runs=[];
 assert.equal((await f.request('/collect',{...options,body:{months:'3'}})).status,200);assert.deepEqual(f.state.dispatches,['3']);
});
test('logout revokes a copied cookie; expired sessions and secret rotation require another GitHub sign-in',async()=>{
 const f=createAuthFixture(),signed=await f.signIn();
 assert.equal((await f.request('/logout',{method:'POST',cookie:signed.cookie,headers:{'X-Admin-CSRF':signed.session.csrf},body:{}})).status,200);
 assert.equal((await f.request('/session',{cookie:signed.cookie})).status,401);
 const second=await f.signIn();const entry=[...f.data.values()].find(value=>value.csrf===second.session.csrf);entry.expires=Date.now()-1;
 assert.equal((await f.request('/session',{cookie:second.cookie})).status,401);
 const third=await f.signIn();f.env.GITHUB_ADMIN_TOKEN='rotated-fixture-server-token';
 assert.equal((await f.request('/session',{cookie:third.cookie})).status,401);
});
test('login initiation is rate limited atomically and cleanup removes expired OAuth states',async()=>{
 const f=createAuthFixture(),responses=await Promise.all(Array.from({length:6},()=>f.request('/login')));
 assert.equal(responses.filter(response=>response.status===302).length,5);assert.equal(responses.filter(response=>response.status===429).length,1);
 for(const value of f.data.values())value.expires=Date.now()-1;
 await f.object.alarm();assert.equal(f.data.size,0);
});
test('missing secrets and insecure production requests fail closed; upstream errors do not disclose credentials',async()=>{
 const f=createAuthFixture();delete f.env.GITHUB_OAUTH_CLIENT_SECRET;
 assert.equal((await f.request('/login')).status,503);
 const insecure=createAuthFixture({origin:'http://admin.example'});assert.equal((await insecure.request('/login')).status,403);
 const other=createAuthFixture(),signed=await other.signIn();
 other.clientFactory=()=>{throw new Error(other.env.GITHUB_ADMIN_TOKEN);};
 const {handleAdmin}=await import('../auth-admin/worker.mjs');
 const response=await handleAdmin(new Request(fixtureOrigin+'/api/admin/runs',{headers:{Cookie:signed.cookie}}),other.env,{fetcher:other.fetcher,clientFactory:other.clientFactory});
 assert.equal(response.status,503);assert(!(await response.text()).includes(other.env.GITHUB_ADMIN_TOKEN));
});

test('concurrent callbacks consume one OAuth state once',async()=>{
 const f=createAuthFixture(),flow=await f.begin(),responses=await Promise.all([f.callback(flow),f.callback(flow)]);
 assert.equal(responses.filter(response=>response.headers.get('Location').endsWith('/admin.html')).length,1);
 assert.equal(responses.filter(response=>response.headers.get('Location').endsWith('authError=invalid')).length,1);
 assert.equal(f.state.github.filter(request=>request.url.endsWith('/access_token')).length,1);
});
test('session cleanup respects the Durable Object 128-key deletion limit',async()=>{
 const f=createAuthFixture(),original=f.storage.delete;let calls=0;
 f.storage.delete=async keys=>{assert(Array.isArray(keys)&&keys.length<=128);calls++;return original(keys);};
 for(let index=0;index<300;index++)f.data.set('session:'+index,{expires:Date.now()-1});
 await f.object.alarm();assert.equal(f.data.size,0);assert.equal(calls,3);
});
