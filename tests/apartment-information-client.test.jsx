import {createHash,webcrypto} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import useApartmentInformation,{apartmentInformationVersion,loadApartmentInformation} from '../src/useApartmentInformation.js';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {sourceIdentityId} from '../src/housing-identity.mjs';
import {validateManifest} from '../src/manifest.mjs';
import {loadSearchIndex} from '../src/HomeSearch.jsx';
import {loadDistrict} from '../src/data.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
function pack(value){
 value.generation=hash(JSON.stringify({schema_version:2,apartments:value.apartments}));
 const body=JSON.stringify(value),sha256=hash(body);
 return {value,body,metadata:{file:`catalog-${sha256.slice(0,12)}.json`,sha256,bytes:Buffer.byteLength(body),schema_version:2,housing_sha256:null,generation:value.generation}};
}
function fixture(name,zone='기존 구역'){
 const ref={kind:'root',id:'hub:client-information'},region={region_code:'41135',region_name:'경기도 성남시 분당구'};
 const item={...makeApartmentFavorite({apartment:name,dong:'정자동',jibun:'121',master_id:ref.id,identity_ref:ref},region),name_aliases:[name],postal_code:null,addresses:[],selection_id:ref.id,scope_kind:'root',active:true,residential_status:'residential',map_visible:true,map_member_refs:[ref],
  location:{status:'missing',precision:'unknown',latitude:null,longitude:null,building_id:null,entrance_index:null,source:null,observed_at:null,anchors:[]},
  area:{identity_ref:ref,geometry_scope:ref,region_ids:['dong_41135103'],parcels:[],boundary_refs:[],boundary_ids:[],bbox:null,zoning_refs:[{id:zone,name:zone,source:'V-World'}]}};
 return pack({version:1,schema_version:2,apartments:[item]});
}
const response=body=>new Response(body,{headers:{'Content-Type':'application/json'}});
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('loads and verifies the immutable UTF-8 catalog selected by the manifest',async()=>{
 const f=fixture('한글 단지 무결성'),fetcher=vi.fn(async()=>response(f.body));vi.stubGlobal('fetch',fetcher);
 expect(await loadApartmentInformation(f.metadata)).toEqual(f.value.apartments);
 expect(fetcher.mock.calls[0][0]).toBe('/apartment-identity/'+f.metadata.file);
 expect(f.metadata.bytes).toBeGreaterThan(f.body.length);
});

it('rejects corrupt bytes, mismatched generations and unsafe catalog paths',async()=>{
 const f=fixture('원본 무결성');let body=f.body;
 const fetcher=vi.fn(async()=>response(body));vi.stubGlobal('fetch',fetcher);
 body=body.replace('원본 무결성','변조 무결성');
 await expect(loadApartmentInformation(f.metadata)).rejects.toThrow(/체크섬/);
 body=f.body;
 await expect(loadApartmentInformation({...f.metadata,bytes:f.metadata.bytes+1})).rejects.toThrow(/크기/);
 await expect(loadApartmentInformation({...f.metadata,generation:'f'.repeat(64)})).rejects.toThrow(/생성 버전/);
 const before=fetcher.mock.calls.length;
 await expect(loadApartmentInformation({...f.metadata,file:'../catalog.json'})).rejects.toThrow(/경로/);
 expect(fetcher).toHaveBeenCalledTimes(before);
});

it('uses a stable hook key and replaces spatial information when only the common catalog changes',async()=>{
 const first=fixture('공간 갱신 단지'),second=fixture('공간 갱신 단지','갱신된 구역');let release;
 const fetcher=vi.fn(async url=>url.endsWith(first.metadata.file)?response(first.body):new Promise(resolve=>{release=()=>resolve(response(second.body));}));vi.stubGlobal('fetch',fetcher);
 const view=renderHook(({source})=>useApartmentInformation(source),{initialProps:{source:first.metadata}});
 await waitFor(()=>expect(view.result.current).toHaveLength(1));
 view.rerender({source:{generation:first.metadata.generation,...first.metadata}});await act(async()=>{});
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(apartmentInformationVersion({housing:{sha256:'a'.repeat(64)},apartment_information:first.metadata})).not.toBe(apartmentInformationVersion({housing:{sha256:'a'.repeat(64)},apartment_information:second.metadata}));
 view.rerender({source:second.metadata});await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(view.result.current).toEqual([]);
 await act(async()=>{release();});
 await waitFor(()=>expect(view.result.current[0]?.area.zoning_refs[0].name).toBe('갱신된 구역'));
});

it('retains the versioned legacy catalog path when immutable metadata is unavailable',async()=>{
 const f=fixture('이전 형식'),legacy={version:1,apartments:f.value.apartments},fetcher=vi.fn(async()=>response(JSON.stringify(legacy)));vi.stubGlobal('fetch',fetcher);
 expect(await loadApartmentInformation('legacy version/1')).toEqual(legacy.apartments);
 expect(fetcher.mock.calls[0][0]).toBe('/apartment-identity/catalog.json?v=legacy%20version%2F1');
});

it('validates the catalog reference and its housing connection in a manifest',()=>{
 const f=fixture('목록 참조'),manifest={regions:[],districts:{},months:['202601'],published_at:'2026-01-31T00:00:00Z',apartment_information:f.metadata};
 expect(validateManifest(manifest)).toBe(manifest);
 for(const change of [{file:'../../catalog.json'},{bytes:0},{schema_version:1},{generation:'invalid'},{housing_sha256:'b'.repeat(64)}])expect(()=>validateManifest({...manifest,apartment_information:{...f.metadata,...change}})).toThrow(/형식/);
 const housing={sha256:'c'.repeat(64)};
 expect(validateManifest({...manifest,housing,apartment_information:{...f.metadata,housing_sha256:housing.sha256}})).toBeTruthy();
});

it('builds a current search from common information when compiled search metadata is stale',async()=>{
 const f=fixture('검색 공통 단지'),item=f.value.apartments[0],row={region_code:'99998',dong:'시험동',jibun:'1',apartment:'검색 신고명',deal_date:'2026-01-01'};
 Object.assign(item,{region_code:row.region_code,region_name:'검색 지역',dong:row.dong,jibun:row.jibun,key:JSON.stringify([row.dong,row.jibun,item.apartment]),identity_default_sources:[sourceIdentityId(row)]});
 const current=pack(f.value),urls=[];
 vi.stubGlobal('fetch',vi.fn(async url=>{urls.push(url);if(url==='/data/client-search.json')return response(JSON.stringify([row]));if(url==='/apartment-identity/'+current.metadata.file)return response(current.body);throw Error('Unexpected request: '+url);}));
 const manifest={regions:[{region_id:'dong_99998101',region_code:row.region_code,region_name:item.region_name,dongs:[row.dong]}],districts:{[row.region_code]:{file:'client-search.json',sha256:'d'.repeat(64),months:['202601']}},apartment_information:current.metadata};
 const results=await loadSearchIndex(manifest);
 expect(results).toHaveLength(1);expect(results[0].identity_ref).toEqual(item.identity_ref);expect(results[0].apartment).toBe(item.apartment);
 expect(urls).toContain('/apartment-identity/'+current.metadata.file);expect(urls.some(url=>url.startsWith('/apartment-identity/catalog.json'))).toBe(false);
});

it('rejects explicitly stale query metadata before loading a different common generation',async()=>{
 const f=fixture('조회 버전'),fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const manifest={apartment_information:f.metadata,districts:{'99997':{file:'unused.json',browser:{file:'unused-catalog.json',apartment_information_generation:'f'.repeat(64)}}}};
 await expect(loadDistrict(manifest,'99997',{catalogOnly:true})).rejects.toThrow(/공통 아파트 정보.*버전/);
 expect(fetcher).not.toHaveBeenCalled();
});
