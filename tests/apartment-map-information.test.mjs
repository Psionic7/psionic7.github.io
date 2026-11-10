import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {validateIdentityMap} from '../src/apartment-identity.mjs';
import {readApartmentInformationFile,writeApartmentInformationFile} from '../server/apartment-information-files.mjs';

const generation='a'.repeat(64);
function information(){
 const ref={kind:'root',id:'hub:map-information'};
 return {...makeApartmentFavorite({apartment:'공통 단지',dong:'정자동',jibun:'121',road_address:'경기도 성남시 분당구 내정로 55',master_id:ref.id,identity_ref:ref,identity_coverage:{entity_ids:[],cohort_ids:[],root_ids:[ref.id]},identity_related_sources:[]},{region_code:'41135',region_name:'경기도 성남시 분당구'}),
  selection_id:ref.id,scope_kind:'root',apartment_id:ref.id,name_aliases:['공통 단지'],postal_code:null,addresses:[],active:true,residential_status:'residential',map_visible:true,map_member_refs:[ref],
  location:{status:'missing',precision:'unknown',latitude:null,longitude:null,source:null,observed_at:null,building_id:null,entrance_index:null,anchors:[]},
  area:{identity_ref:ref,geometry_scope:ref,legal_code:'4113510300',region_ids:['dong_41135103'],parcels:[],boundary_refs:[],boundary_ids:[],bbox:null,zoning_refs:[]},
  latitude:null,longitude:null,location_status:'missing'};
}
const catalog=(apartments=[])=>({version:1,schema_version:2,generation,apartments});

test('map projection accepts a common root with an explicitly missing location',()=>{
 const common=information(),map=[structuredClone(common)];
 assert.equal(validateIdentityMap(map,catalog([common])).length,1);
});

test('map projection rejects legacy inferred roots and drift in transaction coverage',()=>{
 const common=information(),legacy=structuredClone(common);delete legacy.identity_ref;
 assert.throws(()=>validateIdentityMap([legacy],catalog([common])),/지도|공통|식별|정보/);
 const changed=structuredClone(common);changed.identity_coverage.root_ids.push('hub:unrelated');
 assert.throws(()=>validateIdentityMap([changed],catalog([common])),/지도|공통|식별|정보/);
});

test('map projection rejects coordinates that differ from the common location',()=>{
 const common=information(),anchor={building_id:'building-1',entrance_index:0,latitude:37.36,longitude:127.11,source:'주소정보누리집',observed_at:'2026-11-10T00:00:00Z'};
 common.location={status:'confirmed',precision:'entrance',...anchor,anchors:[anchor]};
 common.latitude=37.36;common.longitude=127.11;common.location_status='confirmed';
 assert.equal(validateIdentityMap([common],catalog([common])).length,1);
 const changed=structuredClone(common);changed.latitude=37.37;
 assert.throws(()=>validateIdentityMap([changed],catalog([common])),/지도|공통|식별|정보/);
});

test('map projection rejects independent changes to common area information',()=>{
 const common=information(),changed=structuredClone(common);changed.area.region_ids=['dong_41135104'];
 assert.throws(()=>validateIdentityMap([changed],catalog([common])),/지도|공통|식별|정보/);
});

test('inactive or ancillary-only common roots cannot reappear as apartment map choices',()=>{
 for(const change of [{active:false},{residential_status:'ancillary_only'}]){
  const common={...information(),...change};
  assert.throws(()=>validateIdentityMap([structuredClone(common)],catalog([common])),/지도|공통|식별|정보/);
 }
});

function directory(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'apartment-information-files-'));
 t.after(()=>{const resolved=path.resolve(root);assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('apartment-information-files-'));fs.rmSync(resolved,{recursive:true,force:true});});
 return root;
}

test('immutable common catalog metadata selects its exact content and retains previous versions',t=>{
 const root=directory(t),first=catalog(),meta=writeApartmentInformationFile(root,first),second={...first,generation:'b'.repeat(64)},next=writeApartmentInformationFile(root,second);
 const folder=path.join(root,'apartment-identity');
 fs.writeFileSync(path.join(folder,'catalog.json'),'obsolete invalid legacy content');
 assert.equal(fs.existsSync(path.join(folder,meta.file)),true);assert.equal(fs.existsSync(path.join(folder,next.file)),true);
 assert.deepEqual(readApartmentInformationFile(root,{apartment_information:meta}),first);
 assert.deepEqual(readApartmentInformationFile(root,{apartment_information:next}),second);
});

test('common catalog reads reject content, housing, generation and path mismatches',t=>{
 const root=directory(t),value=catalog(),housing='c'.repeat(64),meta=writeApartmentInformationFile(root,value,{housingSha256:housing}),manifest={housing:{sha256:housing},apartment_information:meta};
 assert.deepEqual(readApartmentInformationFile(root,manifest),value);
 assert.throws(()=>readApartmentInformationFile(root,{...manifest,housing:{sha256:'d'.repeat(64)}}),/공통 아파트 정보/);
 assert.throws(()=>readApartmentInformationFile(root,{...manifest,apartment_information:{...meta,generation:'e'.repeat(64)}}),/공통 아파트 정보/);
 assert.throws(()=>readApartmentInformationFile(root,{...manifest,apartment_information:{...meta,file:'../catalog.json'}}),/공통 아파트 정보/);
 fs.appendFileSync(path.join(root,'apartment-identity',meta.file),' ');
 assert.throws(()=>readApartmentInformationFile(root,manifest),/체크섬|크기/);
});

test('legacy fallback is available only without immutable metadata and rejects unexpected files',t=>{
 const root=directory(t),folder=path.join(root,'apartment-identity');fs.mkdirSync(folder);
 const legacy={version:1,apartments:[]};fs.writeFileSync(path.join(folder,'catalog.json'),JSON.stringify(legacy));
 assert.deepEqual(readApartmentInformationFile(root,{}),legacy);
 const meta={file:`catalog-${'f'.repeat(12)}.json`,sha256:'f'.repeat(64),bytes:12,schema_version:2,housing_sha256:null,generation};
 assert.throws(()=>readApartmentInformationFile(root,{apartment_information:meta}),/파일이 없습니다/);
 fs.writeFileSync(path.join(folder,'unrelated.json'),'{}');
 assert.throws(()=>readApartmentInformationFile(root,{}),/허용되지 않은 파일/);
});
