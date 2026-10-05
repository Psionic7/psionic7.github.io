import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {backup} from 'node:sqlite';
import {ROOT, paths, localEnv, connect, regions, atomicWrite} from '../server/storage.mjs';
import {encryptState, decryptState} from '../server/cloud-state.mjs';
import {cloudGithub, completeSnapshot} from '../server/cloud-github.mjs';
import {validateConfig, CONFIG_PATH} from '../automation/config.mjs';

// Run on the PC once. Never write a GitHub access token to disk or print credentials.
try {
  const env = localEnv();
  if (!env.MOLIT_SERVICE_KEY || !env.JUSO_ADDRESS_SEARCH_KEY) throw new Error('로컬 .env의 두 API 키를 먼저 설정하세요.');
  if (!fs.existsSync(paths.db)) throw new Error('초기 작업 DB가 없습니다. 로컬 관리자에서 데이터를 준비하세요.');
  const source = connect(paths.db, true);
  try {validateConfig(JSON.parse(fs.readFileSync(path.join(ROOT, CONFIG_PATH), 'utf8')), regions(source));}
  finally {source.close();}
  const require = createRequire(import.meta.url);
  const sodium = require(path.join(ROOT, 'local/automation-tools/node_modules/libsodium-wrappers'));
  await sodium.ready;
  const credential = execFileSync('git', ['-c', `safe.directory=${ROOT.replaceAll('\\', '/')}`, 'credential', 'fill'], {
    cwd: ROOT, input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', timeout: 30000,
  });
  const token = credential.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  const github = cloudGithub(token);
  const currentSecrets = await github.request('/actions/secrets');
  const keyFile = path.join(ROOT, 'local/collection-state.key');
  if (currentSecrets.secrets.some(s => s.name === 'COLLECTION_STATE_KEY') && !fs.existsSync(keyFile))
    throw new Error('기존 암호화 키가 로컬에 없습니다. 키를 복구한 후 다시 실행하세요.');
  if (!fs.existsSync(keyFile)) atomicWrite(keyFile, randomBytes(32).toString('hex'));
  const key = fs.readFileSync(keyFile, 'utf8').trim();
  const snapshots = await github.snapshots();
  for (const incomplete of snapshots.filter(r => !completeSnapshot(r)))
    await github.request(`/releases/${incomplete.id}`, 'DELETE');
  const complete = snapshots.filter(completeSnapshot);
  if (complete.length) decryptState(await github.restore(), key);
  const publicKey = await github.request('/actions/secrets/public-key');
  for (const [name, value] of Object.entries({MOLIT_SERVICE_KEY: env.MOLIT_SERVICE_KEY, JUSO_ADDRESS_SEARCH_KEY: env.JUSO_ADDRESS_SEARCH_KEY, COLLECTION_STATE_KEY: key})) {
    const encrypted = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(publicKey.key, sodium.base64_variants.ORIGINAL));
    await github.request(`/actions/secrets/${name}`, 'PUT', {encrypted_value: sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL), key_id: publicKey.key_id});
    console.log(`${name}: GitHub Secrets 등록 완료`);
  }
  if (!complete.length) {
    const seed = path.join(ROOT, 'local/automation-seed.sqlite3');
    const db = connect(paths.db, true);
    try {await backup(db, seed);} finally {db.close();}
    try {const bytes=encryptState(fs.readFileSync(seed), key); console.log(`암호화 DB 업로드 시작: ${Math.ceil(bytes.length / 1024 / 1024)} MiB`); await github.save(bytes);}
    finally {if (fs.existsSync(seed)) fs.unlinkSync(seed);}
    console.log('기존 작업 DB의 암호화한 초기본 등록 완료');
  } else console.log('기존 자동 수집 DB 유지');
  console.log('자동 수집 초기 설정 완료. local/collection-state.key는 별도로 백업하세요.');
} catch (error) {
  console.error(error.code === 'MODULE_NOT_FOUND' ? 'README의 초기 설정에 따라 local/automation-tools에 libsodium-wrappers를 설치하세요.' :
    /^(로컬|초기|기존|GitHub|DB |예약|수집)/.test(error.message) ? error.message : '자동 수집 초기 설정 실패. GitHub 인증·Secrets 권한과 로컬 DB를 확인하세요.');
  process.exitCode = 1;
}
