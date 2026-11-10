import test from 'node:test';
import assert from 'node:assert/strict';
import {buildingClassification} from '../server/building-registry.mjs';

const title=(actualUse,changes={})=>({mainAtchGbCd:'0',mainPurpsCd:'02000',mainPurpsCdNm:'공동주택',etcPurps:actualUse,hhldCnt:'0',hoCnt:'0',...changes});
const apartmentFloor=actualUse=>({mainPurpsCd:'02001',mainPurpsCdNm:'아파트',etcPurps:actualUse});

for(const actualUse of ['지하주차장','경비실','노인정.관리사무소.전기실.입주자집회소','지하주차장(기계실)','지하 주차장','아파트 부속시설(경비실)','노인복지주택 부속시설(관리사무소)']){
 test(`support-only actual use stays nonresidential despite apartment floor codes: ${actualUse}`,()=>{
  assert.equal(buildingClassification(title(actualUse),[apartmentFloor(actualUse),apartmentFloor(actualUse)]),'other');
 });
}

test('an apartment purpose code does not turn an explicitly described guardhouse into a dwelling',()=>{
 assert.equal(buildingClassification(title('경비실',{mainPurpsCd:'02001',mainPurpsCdNm:'아파트',hhldCnt:'',hoCnt:''})),'other');
});

test('a mixed building retains genuine apartment floor use alongside support floors',()=>{
 const floors=[apartmentFloor('경비실'),apartmentFloor('아파트'),apartmentFloor('지하주차장')];
 assert.equal(buildingClassification(title('경비실'),floors),'apartment');
 assert.equal(buildingClassification(title('아파트'),[apartmentFloor('지하주차장')]),'apartment');
 assert.equal(buildingClassification(title('아파트 및 지하주차장'),[apartmentFloor('주차장')]),'apartment');
});

test('unknown or zero household counts do not exclude confirmed apartments',()=>{
 for(const hhldCnt of ['', '0']){
  assert.equal(buildingClassification(title('아파트',{hhldCnt,hoCnt:''})),'apartment');
 }
 const unknown=title('',{mainPurpsCd:'02001',mainPurpsCdNm:'아파트',hhldCnt:'',hoCnt:''});
 assert.equal(buildingClassification(unknown),'apartment');
 assert.equal(buildingClassification(unknown,[apartmentFloor('지하주차장')]),'apartment');
});

test('senior residences remain residential when units rather than households are reported',()=>{
 const senior={mainAtchGbCd:'0',mainPurpsCd:'11000',mainPurpsCdNm:'노유자시설',etcPurps:'노인복지주택',hhldCnt:'0',hoCnt:'537'};
 assert.equal(buildingClassification(senior,[apartmentFloor('지하주차장')]),'senior_housing');
 assert.equal(buildingClassification(title('관리사무소'),[{mainPurpsCd:'11000',mainPurpsCdNm:'노유자시설',etcPurps:'노인복지주택'}]),'senior_housing');
});

test('generic housing remains reviewable and explicitly ancillary buildings stay excluded',()=>{
 assert.equal(buildingClassification(title('')),'review');
 assert.equal(buildingClassification(title('다세대주택')),'other');
 assert.equal(buildingClassification(title('아파트 부속시설',{mainAtchGbCd:'1'}),[apartmentFloor('아파트')]),'other');
});
