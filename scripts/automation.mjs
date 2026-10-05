import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT, paths, readJson, initialize, connect, regions, saveFavorites, serviceKey, atomicWrite} from '../server/storage.mjs';
import {collectMonth, collectionTasks} from '../server/collector.mjs';
import {addressKey, collectAddresses} from '../server/addresses.mjs';
import {exportData} from '../server/export.mjs';
import {decryptState, encryptState} from '../server/cloud-state.mjs';
import {cloudGithub} from '../server/cloud-github.mjs';
import {validateConfig, recentMonths, CONFIG_PATH} from '../automation/config.mjs';

export async function collectConfigured(db, config, {now, tradeKey = serviceKey(), jusoKey = addressKey(), collector = collectMonth, addressCollector = collectAddresses, onProgress = console.log} = {}) {
  const catalog = regions(db), settings = validateConfig(config, catalog);
  if (!tradeKey || !jusoKey) throw new Error('실거래 API 키와 도로명주소 API 키를 설정하세요.');
  const selected = catalog.filter(r => settings.region_ids.includes(r.region_id));
  const tasks = collectionTasks(selected, recentMonths(settings.recent_months, now));
  let count = 0;
  for (const task of tasks) {
    const n = await collector(db, tradeKey, task.code, task.month, task.name);
    count += n;
    onProgress(`${task.name} ${task.month}: ${n}건`);
  }
  const addresses = await addressCollector(db, jusoKey, {limit: settings.address_limit});
  // Keep three recent source responses for each district/month in cloud state.
  // Historical transactions remain intact; repeated daily XML cannot grow without bound.
  db.exec(`BEGIN;
    DELETE FROM api_pages WHERE run_id IN (
      SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY region_code,deal_month ORDER BY id DESC) AS n FROM collection_runs) WHERE n>3
    );
    DELETE FROM collection_runs WHERE id IN (
      SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY region_code,deal_month ORDER BY id DESC) AS n FROM collection_runs) WHERE n>3
    );
    COMMIT;`);
  return {tasks: tasks.length, rows: count, addresses};
}

export async function runAutomation(action) {
  const config = validateConfig(readJson(path.join(ROOT, CONFIG_PATH)));
  if (action === 'restore') {
    const github = cloudGithub(process.env.GITHUB_TOKEN, process.env.GITHUB_REPOSITORY);
    const raw = decryptState(await github.restore(), process.env.COLLECTION_STATE_KEY);
    const temporary = paths.db + '.restore.tmp';
    fs.mkdirSync(path.dirname(paths.db), {recursive: true});
    try {
      atomicWrite(temporary, raw);
      const db = connect(temporary, true);
      try {if (Object.values(db.prepare('PRAGMA quick_check').get())[0] !== 'ok') throw new Error('저장된 DB 무결성 확인 실패');}
      finally {db.close();}
      // The cloud runner owns its local/ directory; manual setup never restores over the PC DB.
      if (!process.env.GITHUB_ACTIONS && fs.existsSync(paths.db)) throw new Error('기존 로컬 DB를 덮어쓸 수 없습니다. 복원은 GitHub Actions에서 실행하세요.');
      fs.renameSync(temporary, paths.db);
    } finally {if (fs.existsSync(temporary)) fs.unlinkSync(temporary);}
    await initialize({...paths, legacy: path.join(ROOT, 'local/no-legacy')});
    const db = connect();
    try {saveFavorites(config.region_ids, paths.favorites, regions(db));} finally {db.close();}
    console.log('자동 수집 DB 복원 완료');
  } else if (action === 'collect') {
    const settings = {...config};
    if (process.env.INPUT_RECENT_MONTHS) settings.recent_months = Number(process.env.INPUT_RECENT_MONTHS);
    const db = connect();
    try {const result = await collectConfigured(db, settings); console.log(`수집 완료: ${result.tasks}개 지역·월, ${result.rows}건, 새 주소 ${result.addresses.completed}건`);}
    finally {db.close();}
  } else if (action === 'export') {
    const manifest = exportData();
    const status = {prepared_at: new Date().toISOString(), published_at: manifest.published_at, count: manifest.count, run_url: process.env.GITHUB_SERVER_URL && `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`};
    atomicWrite(path.join(ROOT, 'public/automation-status.json'), JSON.stringify(status) + '\n');
    console.log(`공개 데이터 ${manifest.count}건 내보내기 완료`);
  } else if (action === 'save') {
    const github = cloudGithub(process.env.GITHUB_TOKEN, process.env.GITHUB_REPOSITORY);
    await github.save(encryptState(fs.readFileSync(paths.db), process.env.COLLECTION_STATE_KEY));
    console.log('자동 수집 DB 보관 완료');
  } else throw new Error('restore, collect, export, save 중 하나를 지정하세요.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {await runAutomation(process.argv[2]);}
  catch (error) {console.error(/^(GitHub|자동 수집|DB |암호화|저장된 DB|기존 로컬|실거래 API|공공 API|API |거래 필드|수집 중|공식 주소|예약 시간|수집 지역)/.test(error.message) ? error.message : '자동 수집 작업 실패. Actions의 실패 단계를 확인하세요.'); process.exitCode = 1;}
}
