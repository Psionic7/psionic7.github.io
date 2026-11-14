import React from 'react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {act,cleanup,renderHook} from '@testing-library/react';
import {useStoredState,readPreferences,clearFavorites} from '../src/preferences.js';
import {validRegionFavorites} from '../src/region-favorites.js';
import {makeApartmentFavorite,refreshApartmentFavorites,validApartmentFavorites} from '../src/apartment-favorites.js';

const id='dong_41465101';
const toggle=previous=>previous.includes(id)?previous.filter(value=>value!==id):[...previous,id];
const useFavorites=()=>useStoredState('viewer','regions',[],validRegionFavorites);
function deferredLocks(){
  const queue=[];
  vi.stubGlobal('navigator',{locks:{request:vi.fn((_name,callback)=>new Promise((resolve,reject)=>queue.push(()=>{try{resolve(callback());}catch(error){reject(error);}})))}});
  return async()=>{while(queue.length)queue.shift()();await Promise.resolve();};
}
beforeEach(()=>localStorage.clear());
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});

it('control: serializes consecutive add and remove operations without losing the last action',async()=>{
  const drain=deferredLocks(),view=renderHook(useFavorites);
  act(()=>{view.result.current[1](toggle);view.result.current[1](toggle);});
  await act(drain);
  expect(view.result.current[0]).toEqual([]);expect(readPreferences('viewer').regions).toEqual([]);
});

it('applies a favorite when the browser rejects Web Locks but localStorage remains writable',async()=>{
  vi.stubGlobal('navigator',{locks:{request:vi.fn(()=>Promise.reject(new DOMException('Lock access is denied','SecurityError')))}});
  const view=renderHook(useFavorites);
  await act(async()=>{view.result.current[1](toggle);await Promise.resolve();});
  expect(view.result.current[0]).toEqual([id]);
  expect(readPreferences('viewer').regions).toEqual([id]);
});

it('shows a delayed favorite write in the current screen after back navigation remounts it',async()=>{
  const drain=deferredLocks(),before=renderHook(useFavorites);
  act(()=>{before.result.current[1](toggle);});before.unmount();
  const after=renderHook(useFavorites);
  await act(drain);
  expect(readPreferences('viewer').regions).toEqual([id]);
  expect(after.result.current[0]).toEqual([id]);
});

it('keeps delete-all final when a previously requested favorite is waiting for the browser lock',async()=>{
  const drain=deferredLocks(),view=renderHook(useFavorites);
  act(()=>{view.result.current[1](toggle);});
  act(()=>{expect(clearFavorites()).toBe(true);});view.unmount();
  await act(drain);
  expect(readPreferences('viewer').regions).toEqual([]);
});

it('does not report a failed favorite removal as removed, and can retry the same action',()=>{
 const view=renderHook(useFavorites);act(()=>view.result.current[1](toggle));
 const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Storage is blocked','SecurityError');});
 let result;act(()=>{result=view.result.current[1](toggle);});
 expect(result).toBe(false);expect(view.result.current[0]).toEqual([id]);expect(readPreferences('viewer').regions).toEqual([id]);
 write.mockRestore();act(()=>{result=view.result.current[1](toggle);});
 expect(result).toBe(true);expect(view.result.current[0]).toEqual([]);expect(readPreferences('viewer').regions).toEqual([]);
});

it('does not duplicate a selection when an old root and its current address are both saved',()=>{
  const region={region_code:'41465',region_name:'경기도 용인시 수지구'};
  const base={apartment:'단지',dong:'풍덕천동',jibun:'1',road_address:'경기도 용인시 수지구 도로 1',master_id:'hub:audit'};
  const legacy=makeApartmentFavorite(base,region);
  const modern=makeApartmentFavorite({...base,identity_ref:{kind:'cohort',id:'cohort:hub:audit:road'},identity_coverage:{entity_ids:[],cohort_ids:['cohort:hub:audit:road'],root_ids:['hub:audit']}},region);
  expect(validApartmentFavorites([legacy,modern])).toBe(true);
  const refreshed=refreshApartmentFavorites([legacy,modern],[modern]);
  expect(validApartmentFavorites(refreshed)).toBe(true);
  expect(refreshed).toHaveLength(1);
});
