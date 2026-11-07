import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createDailyListingSource} from '../server/naver-listing-source.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';

test('real Python/nodriver Chrome searches a visible suggestion and reads sale pages through the nested scroll event', {skip:!process.env.NAVER_BROWSER_PYTHON},async t=>{
  const favorite=makeApartmentFavorite({apartment:'무인테스트단지',dong:'풍덕천동',jibun:'1191'},{region_code:'41465',region_name:'경기도 용인시 수지구'}),requests=[];
  const detail={complexDetail:{complexNo:'10959',complexName:favorite.apartment,cortarAddress:'경기도 용인시 수지구 풍덕천동',detailAddress:'1191'}};
  const raw=(id,trade='A1')=>({articleNo:id,articleName:favorite.apartment,realEstateTypeCode:'APT',tradeTypeCode:trade,dealOrWarrantPrc:'13억',area1:112,area2:84,rentPrc:trade==='B2'?'100':undefined});
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');requests.push(url.pathname+url.search);
    if(url.pathname.startsWith('/api/')){
      res.writeHead(200,{'content-type':'application/json'});
      const page=Number(url.searchParams.get('page'));
      res.end(JSON.stringify(url.pathname.startsWith('/api/complexes/')?detail:{articleList:page===1?[raw('2660000001'),raw('2660000002','B1')]:[raw('2660000003')],isMoreData:page===1}));return;
    }
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
    res.end(`<!doctype html><html lang="ko"><body>
      <button onclick="document.querySelector('#land_search').hidden=false">단지, 지역검색</button>
      <input id="land_search" hidden oninput="document.querySelector('.search_item').hidden=false">
      <ul><li class="search_item" hidden><button class="search_button" onmousedown="document.querySelector('#markers').hidden=false">풍덕천동 무인테스트단지</button></li></ul>
      <div id="markers" hidden><a id="10959COMPLEX"><span class="complex_title">무인테스트단지</span></a></div>
      ${url.pathname.endsWith('/10959')?`<h3 id="complexTitle">무인테스트단지</h3><input id="address_group2" type="checkbox">
      <div class="item_list--article" style="height:100px;overflow:auto"><div id="articleListArea" style="height:600px"></div></div>
      <script>
        fetch('/api/complexes/10959');let page=1,busy=false,more=true;
        async function load(){if(busy||!more)return;busy=true;const r=await fetch('/api/articles/complex/10959?realEstateType=APT&tradeType='+new URLSearchParams(location.search).get('b')+'&sameAddressGroup=false&page='+page++);const data=await r.json();more=data.isMoreData;busy=false;}
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
  assert(requests.some(url=>url.includes('tradeType=A1')&&url.includes('page=2')));
  assert(requests.includes('/complexes/10959?a=APT&b=A1&e=RETAIL'));
});
