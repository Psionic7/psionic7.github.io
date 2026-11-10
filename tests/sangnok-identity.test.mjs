import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildingClassification} from '../server/building-registry.mjs';
import {makeApartmentFavorite,refreshApartmentFavorites,sameApartmentFavorite,mapApartmentFavorite,favoriteTradeMatches} from '../src/apartment-favorites.js';
import {mapVisibleApartments} from '../src/apartment-map-data.js';
import {sourceIdentityId} from '../src/housing-identity.mjs';

const evidence=JSON.parse(fs.readFileSync(new URL('../project-notes/apartment-information-evidence-2026-11-10.json',import.meta.url)));
const region={region_code:'41135',region_name:'경기도 성남시 분당구'};
const residential=evidence.map_favorite_checks.filter(item=>item.trade_rows>0);
const sampleRows=residential.flatMap(item=>item.trade_groups.map(group=>{
 const row={...region,dong:'정자동',jibun:group.jibun,apartment:group.apartment};
 return {...row,identity:{entity_id:sourceIdentityId(row),precision:'complex',root_id:null,cohort_id:null,building_id:null}};
}));

for(const item of residential)test(`Sangnok saved scope remains visible and removable after migration: ${item.root_id}`,()=>{
 const legacy=makeApartmentFavorite({apartment:item.name,dong:'정자동',jibun:item.jibun,road_address:item.road_address,master_id:item.root_id,trade_keys:[]},region);
 const entities=sampleRows.filter(row=>item.trade_groups.some(group=>group.apartment===row.apartment&&group.jibun===row.jibun)).map(row=>row.identity.entity_id);
 const coverage={entity_ids:entities,cohort_ids:[item.refreshed_selection_id],root_ids:[item.root_id]};
 const root={...legacy,identity_ref:{kind:'root',id:item.root_id},identity_coverage:coverage,map_member_refs:[{kind:'root',id:item.root_id},item.refreshed_identity_ref]};
 const cohort={...makeApartmentFavorite({...legacy,identity_ref:item.refreshed_identity_ref,identity_coverage:coverage},region),location:{anchors:[{building_id:'not-saved'}]},area:{boundary_refs:[{id:'not-saved'}]}};
 const [saved]=refreshApartmentFavorites([legacy],[root,cohort]);
 assert.equal(saved.id,item.refreshed_selection_id);
 assert.equal(sameApartmentFavorite(root,saved),false);
 assert.deepEqual(mapVisibleApartments([root],{favoriteOnly:true},[saved]),[root]);
 assert.equal(mapApartmentFavorite(root,[saved]),saved);
 assert.deepEqual(sampleRows.filter(row=>favoriteTradeMatches(saved,row)).map(row=>row.apartment),item.trade_groups.map(group=>group.apartment));
 assert.equal(refreshApartmentFavorites([makeApartmentFavorite(root,root)],[root,cohort])[0].identity_ref.kind,'root');
 assert(!('location' in saved));assert(!('area' in saved));
});

for(const item of evidence.auxiliary_classification)test(`Sangnok support use cannot inherit residential floor classification: ${item.building_id}`,()=>{
 const title={mainAtchGbCd:item.main_accessory_code,mainPurpsCd:item.title_purpose_code,mainPurpsCdNm:'공동주택',etcPurps:item.recorded_use,hhldCnt:String(item.households),hoCnt:String(item.units)};
 const floors=[{mainPurpsCd:item.floor_purpose_code,mainPurpsCdNm:'아파트',etcPurps:item.floor_actual_use}];
 assert.equal(buildingClassification(title,floors),'other');
});
