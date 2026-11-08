import {makeApartmentFavorite} from '../../src/apartment-favorites.js';
import {listingSnapshot} from '../../src/naver-listings.mjs';

export function regionalListingFixture(){
 const at='2026-11-08T00:00:00.000Z';
 const article=id=>({id,name:'검증단지',tradeType:'A1',priceText:'10억',rentText:'',priceMan:100000,rentMan:0,areaM2:85,supplyAreaM2:110,floor:'1/10',building:'101동',direction:'남향',confirmedOn:'2026-11-08',description:'',realtor:''});
 const groups=['partial','complete'].map((coverage,index)=>({favorite:makeApartmentFavorite({apartment:'검증단지'+index,dong:'풍덕천동',jibun:String(index+1)},{region_code:'41465',region_name:'경기도 용인시 수지구'}),complexNo:String(index+111),complexName:'검증단지'+index,tradeType:'A1',status:'ready',attemptedAt:at,collectedAt:at,errorCode:null,articles:index?[article('2660000003')]:[article('2660000001'),article('2660000002')],collectionMethod:'browser',coverage,...(coverage==='complete'?{pageCount:1}:{}),sourceUrl:'https://new.land.naver.com/complexes/'+(index+111)}));
 const snapshot=listingSnapshot(groups,at);
 const report={version:1,source:'naver-land',tradeType:'A1',regionCode:'41465',firstPageOnly:true,startedAt:at,finishedAt:'2026-11-08T00:01:00.000Z',results:[...groups.map(g=>({favoriteId:g.favorite.id,apartment:g.favorite.apartment,complexNo:g.complexNo,status:g.coverage,articleCount:g.articles.length,collectedAt:g.collectedAt})),{favoriteId:'unmatched-fixture',apartment:'미확정단지',status:'unmatched',errorCode:'unmatched'}],summary:{targetCount:3,completeTargets:1,partialTargets:1,unmatchedTargets:1,failedTargets:0,notAttemptedTargets:0,complexCount:2,advertisementCount:3}};
 return {snapshot,report};
}
