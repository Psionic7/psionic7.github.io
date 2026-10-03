import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {ROOT,paths,readJson,secretValues,checkedBytes,connect} from '../server/storage.mjs';
import {sha256} from '../server/export.mjs';
const privateName=name=>name.split('/').some(p=>['local','admin-dist','.venv','.streamlit'].includes(p)) || /(^|\/)(\.env[^/]*|collection_regions\.json|my_real_estate\.sqlite3|secrets\.toml)$/.test(name);
export function checkPublic(root=ROOT,secretsFile=paths.env,{checkIndex=true}={}) {
  const secrets=secretValues(secretsFile);
  const git=(...args)=>execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,...args],{maxBuffer:100*1024*1024});
  const tracked=git('ls-files','-z').toString().split('\0').filter(Boolean);
  if(checkIndex) for(const name of tracked) {if(privateName(name))throw new Error('Git 인덱스에 비공개 파일이 있습니다.');checkedBytes(git('show',':'+name),secrets);}
  const candidates=new Set([...tracked,...git('ls-files','--others','--exclude-standard','-z').toString().split('\0').filter(Boolean)]);
  for(const name of candidates) {if(privateName(name))throw new Error('게시 대상에 비공개 파일이 있습니다.');const file=path.join(root,name);if(fs.existsSync(file)&&fs.statSync(file).isFile()) checkedBytes(fs.readFileSync(file),secrets);}
  for(const sub of ['public/data','docs/data']) {
    const folder=path.join(root,sub),manifest=readJson(path.join(folder,'manifest.json'));
    const known=new Set(manifest.regions.map(r=>r.region_id)),favorites=manifest.favorite_region_ids;
    if(!Array.isArray(favorites)||new Set(favorites).size!==favorites.length||favorites.some(id=>!known.has(id)||['suji','gwanggyo','bundang'].includes(id)))throw new Error('공개 즐겨찾기 목록 오류');
    const database=manifest.database||{file:'public.sqlite3',format:'sqlite3'};
    if(!['public.sqlite3','public.sqlite3.gz'].includes(database.file)||(database.file.endsWith('.gz')?database.format!=='sqlite3+gzip':database.format!=='sqlite3'))throw new Error('공개 SQLite 파일 경로 / 형식 오류');
    const allowed=new Set(['manifest.json',database.file,...Object.values(manifest.districts).map(d=>d.file)]);
    if(fs.readdirSync(folder).some(f=>!allowed.has(f)))throw new Error('공개 데이터 폴더에 허용되지 않은 파일이 있습니다.');
    let count=0;
    for(const [code,item] of Object.entries(manifest.districts)) {
      if(!/^trades-\d{5}-[a-f0-9]{12}\.json$/.test(item.file))throw new Error('데이터 경로 오류');
      const bytes=checkedBytes(fs.readFileSync(path.join(folder,item.file)),secrets),rows=JSON.parse(bytes);
      if(sha256(bytes)!==item.sha256||rows.length!==item.count||rows.some(r=>r.region_code!==code))throw new Error('데이터 체크섬 / 건수 불일치');
      count+=rows.length;
    }
    const archive=checkedBytes(fs.readFileSync(path.join(folder,database.file)),secrets);
    if(database.sha256&&(sha256(archive)!==database.sha256||archive.length!==database.bytes))throw new Error('SQLite 체크섬 / 크기 오류');
    let dbFile=path.join(folder,database.file),temporary;
    if(database.format==='sqlite3+gzip') {
      if(!Number.isSafeInteger(database.uncompressed_bytes)||database.uncompressed_bytes<=0||database.uncompressed_bytes>1024*1024*1024)throw new Error('SQLite 압축 해제 크기 오류');
      const unpacked=checkedBytes(gunzipSync(archive,{maxOutputLength:database.uncompressed_bytes}),secrets,{maxBytes:Infinity});
      if(unpacked.length!==database.uncompressed_bytes||sha256(unpacked)!==database.uncompressed_sha256)throw new Error('압축 해제한 SQLite 체크섬 오류');
      temporary=path.join(os.tmpdir(),`home-records-check-${randomUUID()}.sqlite3`);fs.writeFileSync(temporary,unpacked,{flag:'wx'});dbFile=temporary;
    }
    let db;
    try {
      db=connect(dbFile,true);
      const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>r.name);
      if(JSON.stringify(tables)!==JSON.stringify(['metadata','regions','trades']))throw new Error('공개 DB에 비공개 테이블이 있습니다.');
      if(count!==manifest.count||count!==db.prepare('SELECT count(*) AS n FROM trades').get().n||Object.values(db.prepare('PRAGMA integrity_check').get())[0]!=='ok')throw new Error('공개 DB 건수 / 무결성 오류');
    }finally{db?.close();if(temporary&&fs.existsSync(temporary))fs.unlinkSync(temporary);}
  }
  if(!fs.existsSync(path.join(root,'docs/.nojekyll')))throw new Error('Pages .nojekyll 누락');
  if(!fs.readFileSync(path.join(root,'public/data/manifest.json')).equals(fs.readFileSync(path.join(root,'docs/data/manifest.json'))))throw new Error('공개 데이터를 내보낸 뒤 빌드를 다시 실행하세요.');
  for(const name of fs.readdirSync(path.join(root,'docs'))) if(['admin','server','local','.env','admin-dist'].includes(name))throw new Error('Pages 빌드에 관리자 파일이 포함되어 있습니다.');
  return candidates.size;
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try{console.log(`공개 파일 검증 완료: ${checkPublic()}개 파일`);}catch(e){console.error(e.message);process.exitCode=1;}
}
