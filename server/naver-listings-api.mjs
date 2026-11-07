import path from 'node:path';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {localEnv} from './storage.mjs';
import {createListingCollector} from './naver-listings.mjs';
import {validTargets,listingSnapshot} from '../src/naver-listings.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export function listingMiddleware({collector=createListingCollector({stateFile:path.join(root,'local/naver-listings-cache.json'),authorization:process.env.NAVER_LAND_AUTHORIZATION||localEnv().NAVER_LAND_AUTHORIZATION||''}),snapshotFile=path.join(root,'public/listings/snapshot.json')}={}) {
  return async(req,res,next)=>{
    const pathname=req.url?.split('?')[0];
    if(!pathname?.startsWith('/api/naver-listings/'))return next();
    const json=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    const port=req.socket.localPort,hosts=new Set([`127.0.0.1:${port}`,`localhost:${port}`]);
    if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||!hosts.has(req.headers.host)||req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'이 PC의 같은 로컬 화면에서만 수집할 수 있습니다.'});
    if(pathname==='/api/naver-listings/status'&&req.method==='GET')return json(200,{available:true});
    if(!['/api/naver-listings/read','/api/naver-listings/collect'].includes(pathname))return json(404,{error:'존재하지 않는 매물 API'});
    if(req.method!=='POST')return json(405,{error:'JSON POST 요청을 사용하세요.'});
    if(req.headers['content-type']?.split(';')[0]!=='application/json')return json(415,{error:'JSON 요청을 사용하세요.'});
    try {
      const chunks=[];let bytes=0;
      for await(const chunk of req){bytes+=chunk.length;if(bytes>2*1024*1024)return json(413,{error:'요청이 너무 큽니다.'});chunks.push(chunk);}
      let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return json(400,{error:'JSON 형식을 확인하세요.'});}
      if(!validTargets(input))return json(400,{error:'즐겨찾기와 네이버 단지 연결을 확인하세요.'});
      const published=fs.existsSync(snapshotFile)?JSON.parse(fs.readFileSync(snapshotFile,'utf8').replace(/^\uFEFF/,'')):null;
      if(published)collector.restore(published);
      if(pathname==='/api/naver-listings/read') {
        const groups=input.favorites.map(favorite=>collector.read(favorite,input.connections.find(c=>c.favoriteId===favorite.id)?.complexNo)).filter(Boolean);
        return json(200,{...listingSnapshot(groups),...(published?.collection?{collection:published.collection}:{})});
      }
      if(input.favorites.length!==1||input.connections.length!==1)return json(400,{error:'단지 하나씩 수집하세요.'});
      const group=await collector.collect(input.favorites[0],input.connections[0].complexNo,{force:input.force===true});
      return json(200,listingSnapshot([group]));
    }catch{return json(500,{error:'매물 저장·처리에 실패했습니다. 로컬 수집 파일을 확인하세요.'});}
  };
}

export function naverListingsPlugin() {
  let middleware;
  const install=server=>{middleware??=listingMiddleware();server.middlewares.use(middleware);};
  return {name:'local-naver-listings',configureServer:install,configurePreviewServer:install};
}
