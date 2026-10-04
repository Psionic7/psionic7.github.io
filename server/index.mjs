import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {ROOT,paths,initialize,connect,regions,savedIds,saveFavorites,serviceKey} from './storage.mjs';
import {collectMonth,monthsBetween,collectionTasks,currentMonth} from './collector.mjs';
import {addressKey,collectAddresses,pendingAddresses} from './addresses.mjs';
import {exportData} from './export.mjs';
import {checkPublic} from '../scripts/check-public.mjs';
import {buildCatalog} from '../src/domain.mjs';

export function createAdminServer({files=paths,staticRoot=path.join(ROOT,'admin-dist'),fetcher,addressFetcher}={}) {
  const token=randomBytes(32).toString('hex');
  let job={status:'idle',completed:0,total:0,rows:0},controller;
  const busy=()=>job.status==='running';
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const withDb=callback=>{const db=connect(files.db);try{return callback(db);}finally{db.close();}};
  const state=()=>withDb(db=>{
    const catalog=regions(db).filter(r=>!['suji','gwanggyo','bundang'].includes(r.region_id));
    // Expand historical group favorites against the full catalog, if needed.
    const saved=savedIds(files.favorites,regions(db));
    return {app:'home-records-local-admin',csrf:token,catalog,saved,job,keyReady:Boolean(serviceKey(files.env)),addressKeyReady:Boolean(addressKey(files.env)),currentMonth:currentMonth(),stats:{count:db.prepare('SELECT count(*) AS n FROM trades').get().n,roadAddresses:db.prepare('SELECT count(*) AS n FROM road_addresses').get().n,pendingAddresses:db.prepare("SELECT count(*) AS n FROM (SELECT DISTINCT region_code,dong,jibun FROM trades WHERE trim(jibun)!='') t LEFT JOIN address_lookups a USING(region_code,dong,jibun) WHERE a.region_code IS NULL").get().n,districts:db.prepare('SELECT region_code,count(*) AS count,min(deal_month) AS start,max(deal_month) AS end FROM trades GROUP BY region_code').all()},history:db.prepare('SELECT * FROM collection_runs ORDER BY id DESC LIMIT 100').all()};
  });
  const server=http.createServer(async(req,res)=>{
    const port=server.address()?.port,hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!hosts.has(req.headers.host)||req.headers.origin&&!new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]).has(req.headers.origin))return json(res,403,{error:'이 PC의 로컬 관리자에서만 접근할 수 있습니다.'});
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    // OSM web tiles require a Referer. Cross-origin requests disclose only this origin.
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    let pathname;try{pathname=decodeURIComponent(new URL(req.url,`http://${req.headers.host}`).pathname);}catch{return json(res,400,{error:'잘못된 경로'});}
    try {
      if(pathname==='/api/state'&&req.method==='GET')return json(res,200,state());
      if(pathname.startsWith('/api/')) {
        if(req.method!=='POST')return json(res,405,{error:'허용되지 않은 요청'});
        const supplied=Buffer.from(req.headers['x-admin-csrf']||'');
        if(supplied.length!==token.length||!timingSafeEqual(supplied,Buffer.from(token))||req.headers['content-type']?.split(';')[0]!=='application/json')return json(res,403,{error:'관리자 요청 검증 실패'});
        let body='';for await(const chunk of req){body+=chunk.toString('utf8');if(Buffer.byteLength(body)>1024*1024)return json(res,413,{error:'요청이 너무 큽니다.'});}
        let input;try{input=JSON.parse(body);if(!input||Array.isArray(input)||typeof input!=='object')throw new Error();}catch{return json(res,400,{error:'JSON 요청이 올바르지 않습니다.'});}
        if(pathname==='/api/cancel'){controller?.abort();return json(res,200,{ok:true});}
        if(pathname==='/api/raw-data') {
          const {region_id,start,end}=input;
          if(typeof region_id!=='string'||!/^\d{6}$/.test(start||'')||!/^\d{6}$/.test(end||'')||start>end||[start,end].some(m=>Number(m.slice(4))<1||Number(m.slice(4))>12))throw new Error('원천 조회 지역과 계약월을 확인하세요.');
          const rows=withDb(db=>{
            const region=buildCatalog(regions(db)).find(r=>r.region_id===region_id);
            if(!region)throw new Error('원천 조회 지역이 올바르지 않습니다.');
            const dongClause=region.dongs.length?` AND dong IN (${region.dongs.map(()=>'?').join(',')})`:'';
            return db.prepare(`SELECT * FROM trades WHERE region_code=? AND deal_month>=? AND deal_month<=?${dongClause} ORDER BY deal_date DESC,id DESC`)
              .all(region.region_code,start,end,...region.dongs).map(({raw_json,...row})=>({...row,raw:JSON.parse(raw_json)}));
          });
          return json(res,200,{rows});
        }
        if(busy())return json(res,409,{error:'현재 작업이 끝난 뒤 실행하세요.'});
        if(pathname==='/api/favorites') {
          const saved=withDb(db=>saveFavorites(input.ids,files.favorites,regions(db)));
          return json(res,200,{saved});
        }
        if(pathname==='/api/regions') {
          const {code,name,label,dongs=[]}=input;
          if(typeof code!=='string'||!/^(11|41)\d{3}$/.test(code)||typeof name!=='string'||!/^(서울특별시 |경기도 )/.test(name)||typeof label!=='string'||!label.trim()||label.length>120||name.length>120||!Array.isArray(dongs)||dongs.length>200||dongs.some(d=>typeof d!=='string'||!d.trim()||d.length>40))throw new Error('서울·경기 시군구 코드, 지역명과 법정동명을 확인하세요.');
          const id=`custom_${code}_${randomBytes(6).toString('hex')}`;
          withDb(db=>db.prepare('INSERT INTO regions VALUES (?,?,?,?,?,?,?)').run(id,label.trim(),code,name.trim(),JSON.stringify([...new Set(dongs.map(d=>d.trim()))]),null,null));
          return json(res,200,{region_id:id});
        }
        if(pathname==='/api/collect') {
          const months=monthsBetween(input.start,input.end),selected=withDb(db=>{const catalog=regions(db),ids=new Set(savedIds(files.favorites,catalog));return catalog.filter(r=>ids.has(r.region_id));});
          if(!selected.length)throw new Error('저장한 수집 지역이 없습니다. 먼저 업데이트하세요.');
          const key=serviceKey(files.env);if(!key)throw new Error('.env에 MOLIT_SERVICE_KEY를 설정하세요.');
          const tasks=collectionTasks(selected,months);
          controller=new AbortController();const active=controller;
          job={kind:'collect',status:'running',completed:0,total:tasks.length,rows:0,startedAt:new Date().toISOString(),message:'수집을 시작합니다.'};
          // One async worker; each completed month is committed atomically.
          (async()=>{
            const db=connect(files.db);
            try {
              for(const task of tasks){active.signal.throwIfAborted();job.message=`${task.name} · ${task.month}`;const n=await collectMonth(db,key,task.code,task.month,task.name,{signal:active.signal,fetcher});job.completed++;job.rows+=n;}
              job.status='completed';job.message='수집 완료. 공개 데이터 내보내기를 실행하세요.';
            } catch(e){job.status=active.signal.aborted?'cancelled':'failed';job.message=active.signal.aborted?'수집을 중단했습니다. 완료한 월은 보존됩니다.':/^(API |공공 API |수집 중 |거래 필드)/.test(e.message)?e.message:'수집 실패. API 승인, 연결 및 응답을 확인하세요.';}
            finally {db.close();job.finishedAt=new Date().toISOString();if(controller===active)controller=null;}
          })();
          return json(res,202,{job});
        }
        if(pathname==='/api/addresses') {
          const limit=Number(input.limit ?? 100),refresh=input.refresh===true;
          if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('주소 조회 건수를 확인하세요.');
          const key=addressKey(files.env);if(!key)throw new Error('.env에 JUSO_ADDRESS_SEARCH_KEY를 설정하세요.');
          const total=withDb(db=>pendingAddresses(db,limit,{refresh}).length);
          controller=new AbortController();const active=controller;
          job={kind:'addresses',status:'running',completed:0,total,rows:0,startedAt:new Date().toISOString(),message:'도로명주소를 조회하고 있습니다.'};
          (async()=>{
            const db=connect(files.db);
            try {
              const result=await collectAddresses(db,key,{limit,refresh,signal:active.signal,fetcher:addressFetcher||fetch,onProgress:counts=>{
                job.completed=counts.completed;job.rows=counts.exact;job.message=`도로명주소 확인 ${counts.exact}건 · 미확정 ${counts.unresolved}건`;
              }});
              job.status='completed';job.message=`도로명주소 조회 완료: 정확히 일치 ${result.exact}건 · 미확정 ${result.unresolved}건. 공개 데이터 내보내기를 실행하세요.`;
            }catch(e){job.status=active.signal.aborted?'cancelled':'failed';job.message=active.signal.aborted?'주소 조회를 중단했습니다. 완료한 주소는 보존됩니다.':e.message;}
            finally{db.close();job.finishedAt=new Date().toISOString();if(controller===active)controller=null;}
          })();
          return json(res,202,{job});
        }
        if(pathname==='/api/export') {
          const result=exportData({source:files.db,favorites:files.favorites,secretsFile:files.env});
          return json(res,200,{count:result.count,favorites:result.favorite_region_ids.length});
        }
        if(pathname==='/api/build') {
          job={kind:'build',status:'running',completed:0,total:1,rows:0,message:'GitHub Pages 정적 파일을 빌드하고 있습니다.'};
          const child=spawn(process.execPath,['node_modules/vite/bin/vite.js','build'],{cwd:ROOT,windowsHide:true,stdio:'ignore'});
          const failed=()=>{job.status='failed';job.message='정적 빌드에 실패했습니다. 터미널에서 build.bat을 실행해 확인하세요.';};
          child.on('error',failed);child.on('exit',code=>{
            if(code!==0)return failed();
            try{fs.writeFileSync(path.join(ROOT,'docs/.nojekyll'),'');checkPublic();job.status='completed';job.completed=1;job.message='빌드·공개 파일 검사 완료. Git으로 커밋하고 푸시하면 배포됩니다.';}catch{job.status='failed';job.message='공개 파일 검사에 실패했습니다. check:publish 결과를 확인하세요.';}
          });
          return json(res,202,{job});
        }
        return json(res,404,{error:'존재하지 않는 관리자 API'});
      }
      if(req.method!=='GET'&&req.method!=='HEAD')return json(res,405,{error:'허용되지 않은 요청'});
      let filename;
      if(pathname==='/boundaries/dongs')filename=path.join(ROOT,'admin/assets/dong_boundaries.geojson');
      else if(pathname==='/boundaries/admin')filename=path.join(ROOT,'admin/assets/admin_boundaries.json');
      else {
        const relative=pathname==='/'?'index.html':pathname.slice(1);
        if(relative.includes('\\')||relative.split('/').some(p=>p==='..'||p.startsWith('.')))return json(res,404,{error:'파일 없음'});
        filename=path.resolve(staticRoot,relative);
        if(!filename.startsWith(path.resolve(staticRoot)+path.sep))return json(res,404,{error:'파일 없음'});
      }
      if(!fs.existsSync(filename)||!fs.statSync(filename).isFile())return json(res,404,{error:'파일 없음'});
      const ext=path.extname(filename),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.geojson':'application/geo+json','.png':'image/png','.svg':'image/svg+xml'}[ext]||'application/octet-stream';
      res.writeHead(200,{'Content-Type':mime,'Cache-Control':ext==='.html'?'no-store':'no-cache','X-Content-Type-Options':'nosniff'});
      if(req.method==='HEAD')res.end();else fs.createReadStream(filename).pipe(res);
    }catch(e){json(res,400,{error:/^(원천 조회|저장한 수집|수집 지역|서울·경기|계약월|월 범위|한 번에|API 키|\.env에|지역 코드|원천 필드|공개 파일|원본 작업)/.test(e.message)?e.message:'요청 처리 실패. 로컬 파일 상태와 입력값을 확인하세요.'});}
  });
  server.on('close',()=>controller?.abort());
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await initialize();
    const port=Number(process.env.ADMIN_PORT||8623);
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('관리자 포트가 올바르지 않습니다.');
    const server=createAdminServer();
    server.on('error',()=>{console.error('관리자 서버를 실행하지 못했습니다. 포트 사용 여부를 확인하세요.');process.exitCode=1;});
    server.listen(port,'127.0.0.1',()=>console.log(`React 로컬 관리자: http://127.0.0.1:${port}/`));
  }catch{console.error('관리자 초기화 실패. 기존 작업 DB와 지역 목록 파일을 확인하세요. 원본은 보존되었습니다.');process.exitCode=1;}
}
