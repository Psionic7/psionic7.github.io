import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createDailyListingSource} from '../server/naver-listing-source.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';

test('real Chrome waits for independent detail when a redevelopment UI parcel uses a block label',{skip:!process.env.NAVER_BROWSER_PYTHON},async t=>{
 const favorite=makeApartmentFavorite({apartment:'대장블록단지',dong:'동천동',jibun:'BL-',road_address:'경기도 용인시 수지구 고기로 40'},{region_code:'41465',region_name:'경기도 용인시 수지구'});
 const point={latitude:37.34,longitude:127.09},location={anchors:[{...point,role:'entrance',crs:'EPSG:4326',source:'주소 API'}],roads:[{road_address:favorite.road_address,source:'건축물대장'}],primary_parcels:[],parcels:[]};
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/complexes/112793'){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({complexDetail:{complexNo:'112793',complexName:'블록단지',cortarNo:'4146510200',cortarAddress:'경기도 용인시 수지구 동천동',detailAddress:'903',roadAddressPrefix:'경기도 용인시 수지구',roadAddress:'고기로 40',...point}}));return;}
  if(url.pathname.startsWith('/api/articles/')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({articleList:[],isMoreData:false}));return;}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(`<html><body><h3 id="complexTitle">블록단지</h3><table><tr><th>주소</th><td>경기도 용인시 수지구 동천동 5블록</td></tr></table><script>setTimeout(()=>fetch('/api/complexes/112793'),400);fetch('/api/articles/complex/112793?realEstateType=APT&tradeType=A1&sameAddressGroup=false&page=1')</script></body></html>`);
 });server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
 const source=await createDailyListingSource({baseUrl:`http://127.0.0.1:${server.address().port}`,python:process.env.NAVER_BROWSER_PYTHON,timeoutMs:30000});t.after(()=>source.close());
 const group=await source.collect({favorite,location},{complexNo:'112793'});
 assert.equal(group.coverage,'complete');assert.equal(group.articles.length,0);assert.equal(group.observation.latitude,point.latitude);assert.equal(group.observation.verification_method,'verified_road_and_official_anchor');
});

test('real Python/nodriver Chrome searches a visible suggestion and reads sale pages through the nested scroll event', {skip:!process.env.NAVER_BROWSER_PYTHON},async t=>{
  const favorite=makeApartmentFavorite({apartment:'무인테스트단지',dong:'풍덕천동',jibun:'1190',road_address:'경기도 용인시 수지구 테스트로 1 (풍덕천동)'},{region_code:'41465',region_name:'경기도 용인시 수지구'}),requests=[];
  favorite.name_aliases=['무인테스트단지8단지'];
  const detail={complexDetail:{complexNo:'10959',complexName:favorite.apartment,cortarAddress:'경기도 용인시 수지구 풍덕천동',detailAddress:'1191'}};
  const raw=(id,trade='A1')=>({articleNo:id,articleName:favorite.apartment,realEstateTypeCode:'APT',tradeTypeCode:trade,dealOrWarrantPrc:'13억',area1:112,area2:84,rentPrc:trade==='B2'?'100':undefined});
  let homeLoads=0,denied=false;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');requests.push(url.pathname+url.search);
    const complexNo=url.pathname.match(/^\/complexes\/(10959|10960)$/)?.[1];
    if(denied&&complexNo){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html><body>자동입력 방지</body></html>');return;}
    if(url.pathname.startsWith('/api/')){
      res.writeHead(200,{'content-type':'application/json'});
      if(url.searchParams.get('view')==='overview'){res.end(JSON.stringify({complex:{...detail.complexDetail,latitude:37.33,longitude:127.09}}));return;}
      if(url.searchParams.get('view')==='conflicting'){res.end(JSON.stringify({complexDetail:{...detail.complexDetail,cortarAddress:'경기도 용인시 수지구 동천동',detailAddress:'999',roadAddress:'다른길 99',latitude:37.6,longitude:127.2}}));return;}
      const page=Number(url.searchParams.get('page'));
      const id=url.pathname.split('/').pop();
      res.end(JSON.stringify(url.pathname.startsWith('/api/complexes/')?{complexDetail:{...detail.complexDetail,complexNo:id,...(id==='10960'?{detailAddress:'1192',complexName:'무인테스트단지별동'}:{})}}:{articleList:page===1?[raw('2660000001'),raw('2660000002','B1')]:[raw('2660000003')],isMoreData:page===1}));return;
    }
    if(url.pathname==='/')homeLoads++;
    const suggestions=['풍덕천동 무인테스트단지','풍덕천동 무인테스트단지별동','풍덕천동 무인테스트단지7단지'];if(homeLoads%2) suggestions.reverse();
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(`<!doctype html><html lang="ko"><body>
      <button onclick="document.querySelector('#land_search').hidden=false">단지, 지역검색</button>
      <input id="land_search" value="이전 검색어" hidden oninput="document.querySelectorAll('.search_item').forEach(el=>el.hidden=this.value!=='풍덕천동 무인테스트단지')">
      <ul><li class="search_item type_recent"><button class="search_button" onmousedown="location.href='/recent-error'">풍덕천동 무인테스트단지</button></li>${suggestions.map(label=>`<li class="search_item" hidden><button class="search_button" onmousedown="${label.endsWith('7단지')?"location.href='/wrong-phase'":"document.querySelector('#markers').hidden=false"}">${label}</button></li>`).join('')}</ul>
      <div id="markers" hidden><a id="10959COMPLEX"><span class="complex_title">무인테스트단지</span></a><a id="10960COMPLEX"><span class="complex_title">무인테스트단지별동</span></a></div>
      ${complexNo?`<h3 id="complexTitle">${complexNo==='10960'?'무인테스트단지별동':'무인테스트단지'}</h3><input id="address_group2" type="checkbox">
      <table><tr><th>주소</th><td><p class="address">경기도 용인시 수지구 풍덕천동 ${complexNo==='10960'?'1192':'1191'}</p><p class="address"><i class="icon_roadname" aria-label="도로명"></i>경기도 용인시 수지구 테스트로 ${complexNo==='10960'?'2':'1'}</p></td></tr></table>
      <div class="item_list--article" style="height:100px;overflow:auto"><div id="articleListArea" style="height:600px"></div></div>
      <script>
        ${complexNo==='10960'?`fetch('/api/complexes/${complexNo}');`:`setTimeout(()=>fetch('/api/complexes/${complexNo}?view=conflicting'),200);setTimeout(()=>fetch('/api/complexes/${complexNo}?view=overview'),400);`}let page=1,busy=false,more=true;
        async function load(){if(busy||!more)return;busy=true;const r=await fetch('/api/articles/complex/${complexNo}?realEstateType=APT&tradeType='+new URLSearchParams(location.search).get('b')+'&sameAddressGroup=false&page='+page++);const data=await r.json();more=data.isMoreData;busy=false;}
        load();document.querySelector('.item_list--article').addEventListener('scroll',load);
      </script>`:''}
      </body></html>`);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  let source;
  t.after(async()=>{await source?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  source=await createDailyListingSource({baseUrl:`http://127.0.0.1:${server.address().port}`,python:process.env.NAVER_BROWSER_PYTHON,timeoutMs:45000});
  const group=await source.collect({favorite,query:'풍덕천동 무인테스트단지'});
  assert.equal(group.tradeType,'A1');assert.equal(group.coverage,'complete');assert.equal(group.pageCount,2);
  assert.deepEqual(group.articles.map(a=>a.id),['2660000001','2660000003']);
  assert.equal(group.observation.latitude,37.33);assert.equal(group.observation.longitude,127.09);assert.equal(group.observation.coordinate_role,'provider_label');assert.match(group.observation.road_address,/테스트로 1$/);
  assert(requests.some(url=>url.includes('tradeType=A1')&&url.includes('page=2')));
  assert(requests.includes('/complexes/10959?a=APT&b=A1&e=RETAIL'));
  assert(!requests.some(url=>url.startsWith('/wrong-phase')));
  await source.close();denied=true;
  source=await createDailyListingSource({baseUrl:`http://127.0.0.1:${server.address().port}`,python:process.env.NAVER_BROWSER_PYTHON,timeoutMs:45000});
  await assert.rejects(source.collect({favorite,query:'풍덕천동 무인테스트단지'}),error=>error.code==='blocked');
});

test('real Chrome location discovery ignores stale map batches and verifies renamed candidates before complete collection',{skip:!process.env.NAVER_BROWSER_PYTHON},async t=>{
 const favorite=makeApartmentFavorite({apartment:'건축물대장이름',dong:'풍덕천동',jibun:'1191',road_address:'경기도 용인시 수지구 옛길 9'},{region_code:'41465',region_name:'경기도 용인시 수지구'}),requests=[];
 const location={anchors:[{latitude:37.33,longitude:127.09,role:'entrance',crs:'EPSG:4326',source:'Juso'}],roads:[{road_address:'경기도 용인시 수지구 테스트로 1',source:'Juso'}],parcels:[],primary_parcels:[{pnu:'4146510100111910000',source:'V-World',geometry:{type:'Polygon',coordinates:[[[127.089,37.329],[127.091,37.329],[127.091,37.331],[127.089,37.331],[127.089,37.329]]]}}]};
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');requests.push(url.pathname+url.search);
  const id=url.pathname.match(/^\/(?:api\/complexes\/|complexes\/)(10959|10960)$/)?.[1];
  const name=id==='10960'?'다른이웃단지':'현재네이버이름',street=id==='10960'?'테스트로 2':'테스트로 1';
  if(url.pathname==='/api/complexes/single-markers/2.0'){
   res.writeHead(200,{'content-type':'application/json'});
   if(url.searchParams.has('stale'))res.end(JSON.stringify([{markerId:'99999',markerType:'COMPLEX',complexName:'이전지역',latitude:37.36,longitude:127.12}]));
   else setTimeout(()=>res.end(JSON.stringify([{markerId:'10959',markerType:'COMPLEX',complexName:'현재네이버이름',latitude:37.3301,longitude:127.0901},{markerId:'10960',markerType:'COMPLEX',complexName:'다른이웃단지',latitude:37.3301,longitude:127.0901}])),600);
   return;
  }
  if(url.pathname.startsWith('/api/')){
   res.writeHead(200,{'content-type':'application/json'});
   if(url.pathname.startsWith('/api/complexes/'))res.end(JSON.stringify({complexDetail:{complexNo:id,complexName:name,cortarAddress:'경기도 용인시 수지구 풍덕천동',detailAddress:'1192',roadAddressPrefix:'경기도 용인시 수지구',roadAddress:street,latitude:37.3301,longitude:127.0901,realEstateTypeCode:'APT'}}));
   else res.end(JSON.stringify({articleList:[{articleNo:'2660000010',articleName:'현재네이버이름',realEstateTypeCode:'APT',tradeTypeCode:'A1',dealOrWarrantPrc:'13억',area1:112,area2:84}],isMoreData:false}));
   return;
  }
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
  if(url.pathname==='/complexes')res.end(`<!doctype html><html><body>공개 지도<script>fetch('/api/complexes/single-markers/2.0?stale=1');setTimeout(()=>fetch('/api/complexes/single-markers/2.0?fresh=1'),700);</script></body></html>`);
  else if(id)res.end(`<!doctype html><html><body><h3 id="complexTitle">${name}</h3><input id="address_group2" type="checkbox"><table><tr><th>주소</th><td><p>경기도 용인시 수지구 풍덕천동 1192</p><p><i class="icon_roadname"></i>경기도 용인시 수지구 ${street}</p></td></tr></table><script>fetch('/api/complexes/${id}');fetch('/api/articles/complex/${id}?realEstateType=APT&tradeType=A1&sameAddressGroup=false&page=1');</script></body></html>`);
  else res.end('<!doctype html><html><body>시작 화면</body></html>');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');let source;
 t.after(async()=>{await source?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 source=await createDailyListingSource({baseUrl:`http://127.0.0.1:${server.address().port}`,python:process.env.NAVER_BROWSER_PYTHON,timeoutMs:45000});
 const group=await source.collect({favorite,query:'검색에 없는 이름',location});
 assert.equal(group.complexName,'현재네이버이름');assert.equal(group.coverage,'complete');assert.equal(group.articles.length,1);assert.equal(group.observation.latitude,37.3301);assert.notEqual(group.observation.latitude,location.anchors[0].latitude);assert.equal(group.observation.verification_method,'verified_road_and_primary_polygon');
 assert(!requests.some(path=>path.startsWith('/complexes/99999')));
 assert.equal(requests.filter(path=>path==='/complexes/10959?a=APT&b=A1&e=RETAIL').length,2);
 assert.equal(requests.filter(path=>path==='/complexes/10960?a=APT&b=A1&e=RETAIL').length,1);
});

test('real Chrome expands every provider house even when the open button changes its tracking attribute',{skip:!process.env.NAVER_BROWSER_PYTHON},async t=>{
 const favorite=makeApartmentFavorite({apartment:'묶음테스트',dong:'풍덕천동',jibun:'1'},{region_code:'41465',region_name:'경기도 용인시 수지구'}),opened=[];
 const raw=id=>({articleNo:id,articleName:'묶음테스트',tradeTypeCode:'A1',realEstateTypeCode:'APT',dealOrWarrantPrc:'10억',area2:84});
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://localhost');res.setHeader('content-type','application/json');
  if(u.pathname==='/api/complexes/111'){res.end(JSON.stringify({complexDetail:{complexNo:'111',complexName:'묶음테스트',cortarAddress:'경기도 용인시 수지구 풍덕천동',detailAddress:'1',latitude:37.33,longitude:127.09}}));return;}
  if(u.pathname==='/api/articles/complex/111'){res.end(JSON.stringify({articleList:u.searchParams.get('sameAddressGroup')==='true'?[{...raw('11'),sameAddrCnt:2},{...raw('21'),sameAddrCnt:2}]:['11','12','21','22'].map(raw),isMoreData:false}));return;}
  if(u.pathname==='/api/articles'){const id=u.searchParams.get('representativeArticleNo');opened.push(id);res.end(JSON.stringify([raw(id),raw(id==='11'?'12':'22')]));return;}
  res.setHeader('content-type','text/html; charset=utf-8');res.end(`<!doctype html><h3 id="complexTitle">묶음테스트</h3><input id="address_group2" type="checkbox" onchange="fetch('/api/articles/complex/111?realEstateType=APT&tradeType=A1&sameAddressGroup='+this.checked+'&page=1')"><div id="articleListArea">${['11','21'].map(id=>`<div class="item"><div class="item_inner"><a class="item_link" data-nclk="TAA.groupo" aria-expanded="false" onclick="this.dataset.nclk='TAA.groupc';this.setAttribute('aria-expanded','true');fetch('/api/articles?index=0&representativeArticleNo=${id}')">묶음</a></div></div>`).join('')}</div><script>fetch('/api/complexes/111');fetch('/api/articles/complex/111?realEstateType=APT&tradeType=A1&sameAddressGroup=false&page=1')</script>`);
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 let source;t.after(async()=>{await source?.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 source=await createDailyListingSource({baseUrl:`http://127.0.0.1:${server.address().port}`,python:process.env.NAVER_BROWSER_PYTHON,timeoutMs:45000});
 const group=await source.collect({favorite},{complexNo:'111'});assert.deepEqual(opened,['11','21']);assert.deepEqual(group.articles.map(a=>a.providerHouseId),['111:11','111:11','111:21','111:21']);
});
