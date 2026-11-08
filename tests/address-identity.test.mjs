import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRoadAddress,normalizeParcel} from '../src/address-identity.mjs';

test('road identity ignores whitespace and parenthetical reference names while retaining building numbers',()=>{
 assert.equal(normalizeRoadAddress('경기도 용인시 수지구 수풍로 89 (동천동, 더샵 동천이스트포레)'),normalizeRoadAddress('경기도용인시수지구 수풍로89(동천동)'));
 assert.notEqual(normalizeRoadAddress('수풍로 89'),normalizeRoadAddress('수풍로 89-1'));
 assert.notEqual(normalizeRoadAddress('수풍로 13'),normalizeRoadAddress('수풍로 9'));
 assert.equal(normalizeRoadAddress(' (동천동) '),'');
});

test('parcel identity ignores spacing and zero padding without merging mountain lots or invalid placeholders',()=>{
 assert.equal(normalizeParcel('산 0151-02'),normalizeParcel('산151-2'));
 assert.equal(normalizeParcel('001-0'),normalizeParcel('1'));
 assert.notEqual(normalizeParcel('산151-2'),normalizeParcel('151-2'));
 assert.equal(normalizeParcel('BL-'),null);assert.equal(normalizeParcel('가-'),null);assert.equal(normalizeParcel(''),null);
});
