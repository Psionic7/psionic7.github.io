import test from 'node:test';
import assert from 'node:assert/strict';
import {housingPoint,housingLocationEvidence,housingMapViewport,housingObservation,housingDistanceMeters} from '../server/housing-location.mjs';
import {verifyComplex,verifyComplexEvidence} from '../server/naver-listings.mjs';

const road='경기도 용인시 수지구 수풍로 13',point={latitude:37.32673,longitude:127.088684};
const polygon={type:'Polygon',coordinates:[[[127.088,37.326],[127.089,37.326],[127.089,37.327],[127.088,37.327],[127.088,37.326]]]};
const favorite={apartment:'이전이름',region_code:'41465',region_name:'경기도 용인시 수지구',dong:'풍덕천동',jibun:'692',road_address:road};
const detail={complexNo:'2219',complexName:'새로운이름',cortarAddress:'경기도 용인시 수지구 풍덕천동',detailAddress:'693',roadAddressPrefix:'경기도 용인시 수지구',roadAddress:'수풍로 13',...point};
const location={anchors:[{...point,source:'주소정보누리집',role:'entrance',crs:'EPSG:4326'}],primary_parcels:[{pnu:'4146510100106930000',geometry:polygon,source:'V-World'}],roads:[{road_address:road+' (풍덕천동)',source:'주소정보누리집'}],parcels:[{jibun:'692',relation:'primary',source:'건축HUB'}]};
test('a provider spanning roads needs actual APT advertisement evidence from an exclusive registered building',()=>{
 const cohort={...favorite,identity_ref:{kind:'cohort',id:'cohort:test'},name_aliases:['새로운이름']},scope={...location,exclusive_building_dongs:['510','511']};
 const observed={...detail,detailAddress:'692',roadAddress:'수풍로 15'};
 assert.throws(()=>verifyComplexEvidence({complexDetail:observed},cohort,'2219',scope),error=>error.code==='address_mismatch');
 assert.throws(()=>verifyComplexEvidence({complexDetail:observed,article_building_dongs:['101동']},cohort,'2219',scope),error=>error.code==='address_mismatch');
 const result=verifyComplexEvidence({complexDetail:observed,article_building_dongs:['제510동']},cohort,'2219',scope);
 assert.equal(result.method,'verified_primary_parcel_and_building_ads');assert.deepEqual(result.buildingWitnesses,['510']);
 assert.throws(()=>verifyComplexEvidence({complexDetail:{...observed,detailAddress:'999'},article_building_dongs:['510동']},cohort,'2219',scope),error=>error.code==='address_mismatch');
 assert.throws(()=>verifyComplexEvidence({complexDetail:{...observed,complexName:'다른단지'},article_building_dongs:['510동']},cohort,'2219',scope),error=>error.code==='address_mismatch');
});

test('observed point must be a real valid provider coordinate and is never synthesized from anchors',()=>{
 assert.equal(housingPoint({latitude:null,longitude:127}),null);
 assert.equal(housingPoint({latitude:127,longitude:37}),null);
 const evidence=housingLocationEvidence(location,{...detail,latitude:undefined,longitude:undefined});
 assert.equal(evidence.point,null);assert.equal(evidence.point_in_primary_polygon,false);assert.equal(evidence.anchor_corroborated,false);
 const observation=housingObservation({...detail,latitude:undefined,longitude:undefined},{sourceUrl:'https://new.land.naver.com/complexes/2219',observedAt:'2026-11-08T00:00:00.000Z',verificationMethod:'parcel'});
 assert.equal(observation.latitude,undefined);assert.equal(observation.longitude,undefined);assert.equal(observation.coordinate_role,undefined);
});
test('actual provider observation preserves addresses, point and type without duplicating a full road prefix',()=>{
 const observation=housingObservation({...detail,roadAddress:road,realEstateTypeCode:'APT'},{sourceUrl:'https://new.land.naver.com/complexes/2219',observedAt:'2026-11-08T00:00:00.000Z',verificationMethod:'verified_road_and_primary_polygon'});
 assert.equal(observation.road_address,road);assert.equal(observation.parcel_address,'경기도 용인시 수지구 풍덕천동 693');assert.equal(observation.latitude,point.latitude);assert.equal(observation.coordinate_role,'provider_label');assert.equal(observation.real_estate_type,'APT');
});
test('an independently verified road and observed primary-parcel containment support a renamed complex',()=>{
 assert.throws(()=>verifyComplex({complexDetail:detail},favorite,'2219'),error=>error.code==='address_mismatch');
 assert.deepEqual(verifyComplexEvidence({complexDetail:detail},favorite,'2219',location),{complexName:'새로운이름',method:'verified_road_and_primary_polygon'});
});
test('same-position neighbors and geometry alone never prove identity',()=>{
 assert.equal(housingDistanceMeters(point,point),0);
 assert.throws(()=>verifyComplex({complexDetail:{...detail,roadAddress:'수풍로 15'}},favorite,'2219',location),error=>error.code==='address_mismatch');
 assert.throws(()=>verifyComplex({complexDetail:detail},favorite,'2219',{...location,roads:[]}),error=>error.code==='address_mismatch');
});
test('missing polygons can use exact independent road plus an actual nearby official-entrance corroboration',()=>{
 assert.equal(verifyComplexEvidence({complexDetail:detail},favorite,'2219',{...location,primary_parcels:[]}).method,'verified_road_and_official_anchor');
 assert.throws(()=>verifyComplex({complexDetail:{...detail,latitude:37.33}},favorite,'2219',{...location,primary_parcels:[]}),error=>error.code==='address_mismatch');
 assert.throws(()=>verifyComplex({complexDetail:{...detail,latitude:37.3271}},favorite,'2219',location),error=>error.code==='address_mismatch');
});
test('unlabeled expected roads and malformed polygons cannot become independent evidence',()=>{
 assert.throws(()=>verifyComplex({complexDetail:detail},favorite,'2219',{...location,roads:[{road_address:road}]}),error=>error.code==='address_mismatch');
 const malformed={...polygon,coordinates:[[...polygon.coordinates[0].map(position=>position.map(String))]]};
 assert.equal(housingLocationEvidence({...location,anchors:[],primary_parcels:[{pnu:'4146510100106930000',geometry:malformed,source:'V-World'}]},detail).has_primary_polygon,false);
});
test('registered phase and explicit observed property type still reject contradictory same-address candidates',()=>{
 assert.throws(()=>verifyComplex({complexDetail:{...detail,complexName:'새로운이름2단지'}},{...favorite,name_aliases:['이전이름1단지']},'2219',location),error=>error.code==='address_mismatch');
 assert.throws(()=>verifyComplex({complexDetail:{...detail,detailAddress:'692',realEstateTypeCode:'OPST'}},favorite,'2219',location),error=>error.code==='address_mismatch');
});
test('map viewport uses verified entrance sources while retaining no invented observation',()=>{
 assert.deepEqual(housingMapViewport(location),{...point,zoom:17});
 const parcelViewport=housingMapViewport({primary_parcels:location.primary_parcels});
 assert(Math.abs(parcelViewport.latitude-37.3265)<1e-9);assert(Math.abs(parcelViewport.longitude-127.0885)<1e-9);assert.equal(parcelViewport.zoom,17);
 assert.equal(housingMapViewport({anchors:[{...point,role:'entrance',crs:'EPSG:5179',source:'unknown'}]}),null);
});
