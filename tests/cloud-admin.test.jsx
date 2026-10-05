import React from 'react';
import {afterEach, expect, test, vi} from 'vitest';
import {render, screen, waitFor, cleanup} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CloudAdmin from '../src/CloudAdmin.jsx';
import {adminClient} from '../src/cloud-admin-client.js';

afterEach(() => {cleanup(); localStorage.clear(); sessionStorage.clear();});
const config = {version: 1, time_kst: '07:15', recent_months: 3, address_limit: 1000, region_ids: ['dong_11110101']};
const catalog = [{region_id: 'dong_11110101', label: '서울특별시 종로구 청운동'}];
const loaded = {sha: 'old', config, workflow: "- cron: '15 22 * * *' # collection-schedule"};

test('admin token remains only in memory, saved edits gate dispatch and logout removes controls', async () => {
  const user = userEvent.setup(), storageSpy = vi.spyOn(Storage.prototype, 'setItem');
  const client = {login: vi.fn(async () => 'administrator'), load: vi.fn(async () => loaded), runs: vi.fn(async () => []),
    dispatch: vi.fn(async () => {}), save: vi.fn(async c => ({...loaded, sha: 'new', config: c}))};
  const factory = vi.fn(() => client);
  render(<CloudAdmin clientFactory={factory} fetcher={async () => ({ok: true, json: async () => ({regions: catalog, count: 12, published_at: '2026-10-01Z'})})} />);
  await waitFor(() => expect(screen.getByRole('button', {name: '관리자 접속'}).disabled).toBe(false));
  await user.type(screen.getByLabelText('GitHub 토큰'), 'temporary-token');
  await user.click(screen.getByRole('button', {name: '관리자 접속'}));
  await screen.findByText('예약 수집 설정');
  expect(factory).toHaveBeenCalledWith('temporary-token'); expect(storageSpy).not.toHaveBeenCalled();
  const months = screen.getByLabelText('최근 계약월 재수집'); await user.selectOptions(months, '4');
  expect(screen.getByRole('button', {name: '수집하고 배포'}).disabled).toBe(true);
  await user.click(screen.getByRole('button', {name: '설정 저장'}));
  await waitFor(() => expect(client.save).toHaveBeenCalled());
  await user.click(screen.getByRole('button', {name: '수집하고 배포'}));
  await waitFor(() => expect(client.dispatch).toHaveBeenCalledWith(''));
  expect(screen.getByRole('button', {name: '실행 요청됨'}).disabled).toBe(true);
  await user.click(screen.getByRole('button', {name: 'administrator · 로그아웃'}));
  expect(screen.getByLabelText('GitHub 토큰').value).toBe(''); expect(screen.queryByText('예약 수집 설정')).toBeNull();
  storageSpy.mockRestore();
});
test('GitHub client denies non-maintainers and never discloses a server response or token', async () => {
  const client = adminClient('sensitive-token', async url => ({ok: true, status: 200, json: async () => url.endsWith('/user') ? {login: 'viewer'} : {permissions: {push: false}, default_branch: 'main'}}));
  await expect(client.login()).rejects.toThrow('관리 권한');
  await expect(adminClient('sensitive-token', async () => ({ok: false, status: 403})).login()).rejects.toThrow('토큰 권한');
});
test('settings and schedule are committed together and concurrent changes are rejected', async () => {
  const requests = [];
  const fake = async (url, options) => {
    const body = options.body && JSON.parse(options.body); requests.push({url, method: options.method, body});
    let value;
    if (url.includes('/git/ref/')) value = {object: {sha: 'old'}};
    else if (url.endsWith('/git/commits/old')) value = {tree: {sha: 'base'}};
    else if (url.endsWith('/git/blobs')) value = {sha: 'blob'};
    else if (url.endsWith('/git/trees')) value = {sha: 'tree'};
    else if (url.endsWith('/git/commits')) value = {sha: 'new'};
    else value = {};
    return {ok: true, status: 200, json: async () => value};
  };
  const result = await adminClient('token', fake).save({...config, time_kst: '08:30'}, loaded, catalog);
  expect(result.workflow).toContain("'30 23 * * *'");
  const tree = requests.find(r => r.url.endsWith('/git/trees')).body;
  expect(tree.tree.map(f => f.path)).toEqual(['automation/config.json', '.github/workflows/refresh-data.yml']);
  expect(requests.at(-1).body).toEqual({sha: 'new', force: false});
  await expect(adminClient('token', async () => ({ok: true, status: 200, json: async () => ({object: {sha: 'someone-else'}})})).save(config, loaded, catalog)).rejects.toThrow('다른 곳');
});
