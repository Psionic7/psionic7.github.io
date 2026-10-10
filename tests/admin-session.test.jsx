import React from 'react';
import {afterEach,test,expect,vi} from 'vitest';
import {render,screen,waitFor,cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CloudAdmin from '../src/CloudAdmin.jsx';
import {sessionAdminClient,adminPortalUrl,githubLoginError} from '../src/admin-session-client.js';
const catalog=[{region_id:'dong_11110101',label:'서울특별시 종로구 청운동',region_name:'서울특별시 종로구',region_code:'11110',dongs:['청운동']}];
const config={version:1,time_kst:'01:00',recent_months:3,address_limit:1000,region_ids:['dong_11110101']};
const loaded={sha:'old',config},csrf='a'.repeat(64),EmptyMap=()=>null;
const manifestFetcher=async()=>({ok:true,json:async()=>({regions:catalog,count:12,published_at:'2026-10-01Z'})});
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();window.history.replaceState(null,'','/');vi.restoreAllMocks();});
test('GitHub mode offers a login link and no credential field when there is no session',async()=>{
 const client={restore:vi.fn(async()=>null)},storage=vi.spyOn(Storage.prototype,'setItem');
 render(<CloudAdmin githubAuth clientFactory={()=>client} fetcher={manifestFetcher} MapComponent={EmptyMap}/>);
 const link=await screen.findByRole('link',{name:'GitHub로 로그인'});expect(link.getAttribute('href')).toBe('/api/admin/login');
 expect(screen.queryByLabelText('GitHub 토큰')).toBeNull();expect(screen.queryByLabelText('관리자 비밀번호')).toBeNull();expect(client.restore).toHaveBeenCalledOnce();expect(storage).not.toHaveBeenCalled();
});
test('GitHub sessions restore after reload and existing edit, dispatch and logout operations use the server client',async()=>{
 const user=userEvent.setup(),client={restore:vi.fn(async()=>'Psionic7'),load:vi.fn(async()=>loaded),runs:vi.fn(async()=>[]),save:vi.fn(async value=>({sha:'new',config:value})),dispatch:vi.fn(async()=>{}),logout:vi.fn(async()=>{})};
 const factory=()=>client;let view=render(<CloudAdmin githubAuth clientFactory={factory} fetcher={manifestFetcher} MapComponent={EmptyMap}/>);
 await screen.findByText('예약 수집 설정');expect(screen.queryByLabelText('GitHub 토큰')).toBeNull();
 await user.selectOptions(screen.getByLabelText('최근 계약월 재수집'),'4');await user.click(screen.getByRole('button',{name:'설정 저장'}));await waitFor(()=>expect(client.save).toHaveBeenCalled());
 await user.click(screen.getByRole('button',{name:'수집하고 배포'}));await waitFor(()=>expect(client.dispatch).toHaveBeenCalledWith(''));
 view.unmount();view=render(<CloudAdmin githubAuth clientFactory={factory} fetcher={manifestFetcher} MapComponent={EmptyMap}/>);
 await screen.findByText('예약 수집 설정');expect(client.restore).toHaveBeenCalledTimes(2);
 await user.click(screen.getByRole('button',{name:'Psionic7 · 로그아웃'}));await screen.findByRole('link',{name:'GitHub로 로그인'});expect(client.logout).toHaveBeenCalledOnce();
});
test('an expired server session clears privileged controls and prompts GitHub login again',async()=>{
 const user=userEvent.setup(),expired=Object.assign(new Error('접속이 만료되었습니다.'),{status:401});
 const client={restore:async()=>'Psionic7',load:vi.fn(async()=>loaded),runs:async()=>[],dispatch:async()=>{throw expired;}};
 render(<CloudAdmin githubAuth clientFactory={()=>client} fetcher={manifestFetcher} MapComponent={EmptyMap}/>);
 await screen.findByText('예약 수집 설정');await user.click(screen.getByRole('button',{name:'수집하고 배포'}));
 await screen.findByRole('link',{name:'GitHub로 로그인'});expect(screen.queryByText('예약 수집 설정')).toBeNull();expect(screen.getByRole('alert').textContent).toBe('접속이 만료되었습니다.');
});
test('the session client uses same-origin cookies and CSRF without browser-held GitHub tokens or storage',async()=>{
 const calls=[],storage=vi.spyOn(Storage.prototype,'setItem');
 const fetcher=vi.fn(async(path,options)=>{calls.push({path,options});return new Response(JSON.stringify(path.endsWith('/session')?{user:'Psionic7',csrf}:{success:true}),{status:200,headers:{'Content-Type':'application/json'}});});
 const client=sessionAdminClient(fetcher);expect(await client.restore()).toBe('Psionic7');await client.save(config,loaded);await client.dispatch('3');await client.logout();
 for(const call of calls){expect(call.options.credentials).toBe('same-origin');expect(call.options.headers.Authorization).toBeUndefined();if(call.options.method==='POST')expect(call.options.headers['X-Admin-CSRF']).toBe(csrf);}
 expect(JSON.parse(calls.find(call=>call.path.endsWith('/settings')).options.body)).toEqual({config,sha:'old'});expect(storage).not.toHaveBeenCalled();
 const expired=sessionAdminClient(async()=>new Response('{}',{status:401}));expect(await expired.restore()).toBeNull();await expect(expired.load()).rejects.toMatchObject({status:401});
});
test('callback errors are fixed messages and unsafe portal addresses are rejected',async()=>{
 window.history.replaceState(null,'','/admin.html?authError=denied');
 render(<CloudAdmin githubAuth clientFactory={()=>({restore:async()=>null})} fetcher={manifestFetcher} MapComponent={EmptyMap}/>);
 await screen.findByRole('link',{name:'GitHub로 로그인'});expect(screen.getByRole('alert').textContent).toContain('소유자');expect(location.search).toBe('');
 expect(githubLoginError('?authError=__proto__')).toBe('');expect(githubLoginError('?authError=constructor')).toBe('');expect(githubLoginError('?authError=unknown')).toBe('');
 expect(adminPortalUrl('https://admin.example')).toBe('https://admin.example/admin.html');
 for(const value of ['javascript:alert(1)','http://admin.example','https://user:secret@admin.example','https://admin.example/path','https://admin.example/?token=x'])expect(adminPortalUrl(value)).toBe('');
});
test('the public Pages login panel prioritizes a configured GitHub portal and keeps token access collapsed',async()=>{
 render(<CloudAdmin portalUrl="https://admin.example" fetcher={manifestFetcher} MapComponent={EmptyMap}/>);
 await screen.findByRole('link',{name:'GitHub로 로그인'});expect(screen.getByRole('link',{name:'GitHub로 로그인'}).getAttribute('href')).toBe('https://admin.example/admin.html');
 expect(screen.getByText('토큰으로 관리자 접속').closest('details').open).toBe(false);
});
