import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import useApartmentInformation,{loadApartmentInformation} from '../src/useApartmentInformation.js';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
const document=name=>({version:1,apartments:[{...makeApartmentFavorite({apartment:name,dong:'동천동',jibun:'1',master_id:'hub:versioned'},{region_code:'41465',region_name:'경기도 용인시 수지구'}),name_aliases:[name],postal_code:null,addresses:[]}]});
const response=value=>({ok:true,text:async()=>JSON.stringify(value)});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('loads changed identity information under a new published version while retaining the prior version cache',async()=>{
 const fetcher=vi.fn(async url=>response(document(String(url).includes('fixture-new')?'새 정보':'이전 정보')));vi.stubGlobal('fetch',fetcher);
 expect((await loadApartmentInformation('fixture-old'))[0].apartment).toBe('이전 정보');
 expect((await loadApartmentInformation('fixture-new'))[0].apartment).toBe('새 정보');
 expect((await loadApartmentInformation('fixture-old'))[0].apartment).toBe('이전 정보');
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it('does not let a delayed prior-version response replace the current apartment identity',async()=>{
 const pending=new Map();vi.stubGlobal('fetch',vi.fn(url=>new Promise(resolve=>pending.set(String(url),resolve))));
 function View({version}){const rows=useApartmentInformation(version);return <p>{rows[0]?.apartment||'불러오는 중'}</p>;}
 const view=render(<View version="fixture-late-old"/>);view.rerender(<View version="fixture-late-new"/>);
 await waitFor(()=>expect(pending.has('/apartment-identity/catalog.json?v=fixture-late-new')).toBe(true));
 await act(async()=>pending.get('/apartment-identity/catalog.json?v=fixture-late-new')(response(document('현재 단지'))));
 expect(screen.getByText('현재 단지')).toBeTruthy();
 await act(async()=>pending.get('/apartment-identity/catalog.json?v=fixture-late-old')(response(document('지난 단지'))));
 expect(screen.queryByText('지난 단지')).toBeNull();expect(screen.getByText('현재 단지')).toBeTruthy();
});
