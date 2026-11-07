import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {BrowserListingPages,createBrowserListingSource,launchListingBrowser} from '../server/naver-browser-collector.mjs';

const favorite=makeApartmentFavorite({apartment:'브라우저테스트단지',dong:'정자동',jibun:'199'},{region_code:'41135',region_name:'경기도 성남시 분당구'});
const detail={complexDetail:{complexNo:'12345',complexName:'브라우저테스트단지',cortarAddress:'경기도 성남시 분당구 정자동',detailAddress:'199'}};
const raw=(id,changes={})=>({articleNo:id,articleName:'브라우저테스트단지',realEstateTypeCode:'APT',tradeTypeCode:'A1',dealOrWarrantPrc:'13억 2,000',area1:64.69,area2:48.84,articleConfirmYmd:'20261106',...changes});
let browser;
before(async()=>{browser=await launchListingBrowser();});
after(async()=>{await browser?.close();});

async function fixture(t,{pages=[{articleList:[raw('26000000001'),raw('26000000002')],isMoreData:true},{articleList:[raw('26000000003',{tradeTypeCode:'B2',dealOrWarrantPrc:'3억 3,000',rentPrc:'70'})],isMoreData:false}],complex=detail,articleStatus=200,homeStatus=200}={}) {
  const requests=[];
  const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><title>테스트 브라우저 단지</title><body>
    <button onclick="document.getElementById('land_search').hidden=false">단지, 지역검색</button><input id="land_search" hidden onkeydown="if(event.key==='Enter')location.href='/complexes/12345?a=APT'">
    <h3 id="complexTitle">브라우저테스트단지</h3><label><input id="address_group2" type="checkbox">동일매물 묶기</label>
    <div class="item_list--article" style="overflow-y:auto;height:100px"><div style="height:500px" id="articleListArea"></div></div>
    <script>
      if(location.pathname.includes('/12345')){
        fetch('/api/complexes/12345').then(r=>r.json());
        let page=1,busy=false,more=true;
        const load=async()=>{if(busy||!more)return;busy=true;const response=await fetch('/api/articles/complex/12345?sameAddressGroup=false&realEstateType=APT&page='+page++);const data=await response.json();more=data.isMoreData;document.getElementById('articleListArea').style.height=(500+page*200)+'px';busy=false;};
        load();document.querySelector('.item_list--article').addEventListener('scroll',load);
      }
    </script></body></html>`;
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');requests.push(url.pathname+url.search);
    if(url.pathname.startsWith('/api/')){
      res.writeHead(url.pathname.startsWith('/api/articles/')?articleStatus:200,{'Content-Type':'application/json'});
      res.end(JSON.stringify(url.pathname.startsWith('/api/articles/')?pages[Number(url.searchParams.get('page'))-1]:complex));
    }else{res.writeHead(url.pathname==='/'?homeStatus:200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');const page=await browser.newPage();
  t.after(async()=>{await page.close();await new Promise(resolve=>server.close(resolve));});
  const source=await createBrowserListingSource({page,baseUrl:`http://127.0.0.1:${server.address().port}`,timeoutMs:2000,targetTimeoutMs:5000,scrollGapMs:50,maxScrolls:15});
  return {source,requests};
}

test('real Chromium searches the visible page, scrolls its list and captures every page through normal browser requests',async t=>{
  const {source,requests}=await fixture(t),group=await source.collect({favorite,query:'정자동 브라우저테스트단지'});
  assert.equal(group.coverage,'complete');assert.equal(group.collectionMethod,'browser');assert.equal(group.pageCount,2);assert.equal(group.articles.length,3);assert.equal(group.articles[2].rentMan,70);
  assert(requests.some(url=>url==='/'));assert(requests.some(url=>url.includes('page=2')));
});

test('known mapping revalidates the actual complex address and preserves precise areas',async t=>{
  const {source,requests}=await fixture(t),group=await source.collect({favorite,query:'unused'},{complexNo:'12345'});
  assert.equal(group.articles[0].areaM2,48.84);assert(requests.includes('/complexes/12345'));
});

test('a verified empty first page is complete zero, while repeated IDs and address mismatch are failures',async t=>{
  const empty=await fixture(t,{pages:[{articleList:[],isMoreData:false}]});assert.equal((await empty.source.collect({favorite},{complexNo:'12345'})).articles.length,0);
  const repeated=await fixture(t,{pages:[{articleList:[raw('26000000001')],isMoreData:true},{articleList:[raw('26000000001')],isMoreData:false}]});
  await assert.rejects(repeated.source.collect({favorite},{complexNo:'12345'}),error=>error.code==='incomplete');
  const wrong=await fixture(t,{complex:{complexDetail:{...detail.complexDetail,detailAddress:'200'}}});
  await assert.rejects(wrong.source.collect({favorite},{complexNo:'12345'}),error=>error.code==='address_mismatch');
});

test('browser 429 stops without requesting another page',async t=>{
  const {source,requests}=await fixture(t,{articleStatus:429,pages:[{}]});
  await assert.rejects(source.collect({favorite},{complexNo:'12345'}),error=>error.code==='rate_limited');assert(!requests.some(url=>url.includes('page=2')));
});

test('page coverage rejects missing pages and grouped responses rather than calling them complete',()=>{
  const pages=new BrowserListingPages();pages.consume('https://new.land.naver.com/api/complexes/12345',200,detail);
  pages.consume('https://new.land.naver.com/api/articles/complex/12345?sameAddressGroup=true&page=1',200,{articleList:[raw('26000000001')],isMoreData:false});assert.equal(pages.ready('12345'),false);
  pages.consume('https://new.land.naver.com/api/articles/complex/12345?sameAddressGroup=false&page=2',200,{articleList:[raw('26000000001')],isMoreData:false});assert.equal(pages.ready('12345'),false);assert.throws(()=>pages.finish(favorite,'12345'),error=>error.code==='incomplete');
});

test('an unavailable browser entry page fails immediately without producing an empty successful collection',async t=>{
  const {source,requests}=await fixture(t,{homeStatus:404});await assert.rejects(source.collect({favorite,query:'정자동 브라우저테스트단지'}),error=>error.code==='site_unavailable');assert(!requests.some(url=>url.startsWith('/api/')));
});
