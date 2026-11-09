import test from 'node:test';
import assert from 'node:assert/strict';
import {listingHouses} from '../src/listing-houses.mjs';
import {BrowserListingPages} from '../server/naver-browser-collector.mjs';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
test('explicit provider membership yields one house with all broker prices, and repeated ad IDs occur once',()=>{
 const ads=[{id:'1',priceMan:120000,providerHouseId:'111:1'},{id:'2',priceMan:125000,providerHouseId:'111:1'},{id:'3',priceMan:120000,providerHouseId:'111:3'}];
 const houses=listingHouses([...ads,ads[0]]);assert.equal(houses.length,2);assert.equal(houses[0].articles.length,2);assert.equal(houses[0].minPrice,120000);assert.equal(houses[0].maxPrice,125000);
});
test('complete flat capture retains additional broker ads exposed only inside the provider house and attaches real membership',()=>{
 const pages=new BrowserListingPages(),origin='https://new.land.naver.com';
 const favorite=makeApartmentFavorite({apartment:'테스트',dong:'풍덕천동',jibun:'1'},{region_code:'41465',region_name:'경기도 용인시 수지구'});
 const raw=id=>({articleNo:id,articleName:'테스트',tradeTypeCode:'A1',realEstateTypeCode:'APT',dealOrWarrantPrc:'10억',area2:84});
 pages.consume(origin+'/api/complexes/111',200,{complexDetail:{complexNo:'111',complexName:'테스트',cortarAddress:'경기도 용인시 수지구 풍덕천동',detailAddress:'1'}});
 pages.consume(origin+'/api/articles/complex/111?sameAddressGroup=false&tradeType=A1&realEstateType=APT&page=1',200,{articleList:[raw('9')],isMoreData:false});
 pages.consume(origin+'/api/articles/complex/111?sameAddressGroup=true&tradeType=A1&realEstateType=APT&page=1',200,{articleList:[raw('9')],isMoreData:false});
 pages.consume(origin+'/api/articles?representativeArticleNo=9',200,[raw('9'),raw('8')]);
 const group=pages.finish(favorite,'111');assert.equal(group.articles.length,2);assert.equal(listingHouses(group.articles).length,1);assert.equal(group.articles[1].providerHouseId,'111:9');
});
test('equal floor, area, price and same-address count are insufficient to join houses; complex namespaces stay separate',()=>{
 const base={floor:'10',areaM2:84,priceMan:120000,providerSameAddress:{advertisementCount:10}};
 assert.equal(listingHouses([{...base,id:'1'},{...base,id:'2'}]).length,2);
 assert.equal(listingHouses([{...base,id:'1',providerHouseId:'111:1'},{...base,id:'2',providerHouseId:'222:1'}]).length,2);
});
test('collector only trusts children of representatives observed on that complex grouped list and rejects conflicting membership',()=>{
 const pages=new BrowserListingPages();
 const grouped='https://new.land.naver.com/api/articles/complex/111?sameAddressGroup=true&tradeType=A1&realEstateType=APT&page=1';
 pages.consume('https://new.land.naver.com/api/articles?representativeArticleNo=9',200,[{articleNo:'1',tradeTypeCode:'A1'}]);assert.equal(pages.complexes.size,0);
 pages.consume(grouped,200,{articleList:[{articleNo:'9'},{articleNo:'8'}],isMoreData:false});
 pages.consume('https://new.land.naver.com/api/articles?representativeArticleNo=9',200,[{articleNo:'1',tradeTypeCode:'A1'},{articleNo:'2',tradeTypeCode:'A1'},{articleNo:'3',tradeTypeCode:'B1'}]);
 assert.equal(pages.complexes.get('111').houseMembers.size,2);
 assert.throws(()=>pages.consume('https://new.land.naver.com/api/articles?representativeArticleNo=8',200,[{articleNo:'1',tradeTypeCode:'A1'}]),error=>error.code==='invalid_response');
});
