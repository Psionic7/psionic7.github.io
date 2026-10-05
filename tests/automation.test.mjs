import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PUBLIC_SCHEMA, LOCAL_SCHEMA} from '../server/storage.mjs';
import {validateConfig, cronForKst, updateSchedule, recentMonths} from '../automation/config.mjs';
import {encryptState, decryptState} from '../server/cloud-state.mjs';
import {cloudGithub} from '../server/cloud-github.mjs';
import {collectConfigured} from '../scripts/automation.mjs';

const config = {version: 1, time_kst: '07:15', recent_months: 3, address_limit: 1000, region_ids: ['dong_11110101', 'dong_11110102']};
const key = 'a1'.repeat(32);
test('KST schedules and recent months handle UTC midnight and year changes', () => {
  assert.equal(cronForKst('07:15'), '15 22 * * *');
  assert.equal(cronForKst('09:00'), '0 0 * * *');
  assert.equal(cronForKst('23:59'), '59 14 * * *');
  assert.deepEqual(recentMonths(3, new Date('2025-12-31T16:00:00Z')), ['202511', '202512', '202601']);
  assert.equal(updateSchedule("on:\n  schedule:\n    - cron: '15 22 * * *' # collection-schedule\n", '12:34'), "on:\n  schedule:\n    - cron: '34 3 * * *' # collection-schedule\n");
  assert.throws(() => updateSchedule('different workflow', '12:34'));
  for (const value of [{...config, time_kst: '24:00'}, {...config, recent_months: 13}, {...config, region_ids: []}, {...config, region_ids: ['dong_11110101', 'dong_11110101']}]) assert.throws(() => validateConfig(value));
});
test('encrypted state authenticates all bytes and never exposes the DB', () => {
  const db = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.from('private response data '.repeat(100))]);
  const packed = encryptState(db, key);
  assert(!packed.includes(Buffer.from('private response')));
  assert.deepEqual(decryptState(packed, key), db);
  assert(!encryptState(db, key).equals(packed));
  assert.throws(() => decryptState(packed, 'b2'.repeat(32)));
  for (const offset of [0, 22, 35, packed.length - 1]) {const corrupt = Buffer.from(packed); corrupt[offset] ^= 1; assert.throws(() => decryptState(corrupt, key));}
  assert.throws(() => encryptState(Buffer.from('not sqlite'), key));
});
test('saved dongs share district/month API requests and address failures stop publishing', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(PUBLIC_SCHEMA + LOCAL_SCHEMA);
  for (const id of config.region_ids) db.prepare('INSERT INTO regions VALUES (?,?,?,?,?,?,?)').run(id, id, '11110', '서울특별시 종로구', '[]', null, null);
  const calls = [], addresses = [];
  const options = {now: new Date('2026-01-02Z'), tradeKey: 'key', jusoKey: 'address', onProgress: () => {},
    collector: async (_db, _key, code, month) => {calls.push([code, month]); return 4;},
    addressCollector: async (_db, _key, opts) => {addresses.push(opts); return {completed: 2};}};
  try {
    const result = await collectConfigured(db, config, options);
    assert.deepEqual(calls, [['11110', '202511'], ['11110', '202512'], ['11110', '202601']]);
    assert.equal(result.rows, 12); assert.deepEqual(addresses, [{limit: 1000}]);
    let touchedAddress = false;
    await assert.rejects(collectConfigured(db, config, {...options, collector: async () => {throw new Error('API failed');}, addressCollector: async () => {touchedAddress = true;}}));
    assert.equal(touchedAddress, false);
    await assert.rejects(collectConfigured(db, config, {...options, addressCollector: async () => {throw new Error('address failed');}}));
    await assert.rejects(collectConfigured(db, {...config, region_ids: ['dong_99999999']}, options));
  } finally {db.close();}
});
test('snapshot restore skips unfinished releases and uploads failing cannot delete good state', async () => {
  const existing = {id: 1, draft: true, tag_name: 'collection-state-1700000000000', assets: [{id: 10, name: 'state.enc', state: 'uploaded'}]};
  const incomplete = {id: 2, draft: true, tag_name: 'collection-state-1800000000000', assets: []};
  const deleted = [];
  const fetcher = async (url, options) => {
    if (url.includes('/releases?')) return {ok: true, status: 200, json: async () => [existing, incomplete]};
    if (url.endsWith('/releases/assets/10')) return {ok: true, arrayBuffer: async () => Buffer.from('old state')};
    if (url.endsWith('/releases') && options.method === 'POST') return {ok: true, status: 201, json: async () => ({id: 3})};
    if (url.includes('uploads.github.com')) return {ok: false, status: 500};
    if (options.method === 'DELETE') {deleted.push(url); return {ok: true, status: 204};}
    throw new Error('unexpected request');
  };
  const github = cloudGithub('token', undefined, fetcher);
  assert.equal((await github.restore()).toString(), 'old state');
  await assert.rejects(github.save(Buffer.from('new state')));
  assert.deepEqual(deleted, ['https://api.github.com/repos/Psionic7/psionic7.github.io/releases/3']);
});
test('multipart state is complete only after the manifest and tampering is rejected', async () => {
  const releases = [], assets = new Map(), order = [];
  const fetcher = async (url, options) => {
    if (url.includes('/releases?')) return {ok: true, status: 200, json: async () => releases};
    if (url.endsWith('/releases') && options.method === 'POST') {
      const value = JSON.parse(options.body), release = {...value, id: 9, assets: []}; releases.push(release);
      return {ok: true, status: 201, json: async () => release};
    }
    if (url.includes('uploads.github.com')) {
      const name = new URL(url).searchParams.get('name'), id = assets.size + 1;
      const data = Buffer.from(options.body); assets.set(id, data); order.push(name);
      releases[0].assets.push({id, name, state: 'uploaded'});
      return {ok: true, status: 201};
    }
    const id = Number(url.split('/').at(-1));
    if (assets.has(id)) return {ok: true, arrayBuffer: async () => assets.get(id)};
    throw new Error('unexpected request');
  };
  const github = cloudGithub('token', undefined, fetcher), bytes = Buffer.alloc(2 * 1024 * 1024 + 13, 17);
  await github.save(bytes);
  assert.deepEqual(order, ['state-0000.enc', 'state-0001.enc', 'state.json']);
  assert.deepEqual(await github.restore(), bytes);
  assets.get(1)[0] ^= 1;
  await assert.rejects(github.restore(), /무결성/);
});
