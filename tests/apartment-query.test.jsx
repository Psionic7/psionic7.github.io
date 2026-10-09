import {beforeEach,it,expect} from 'vitest';
import {restoreApartmentQuery,validApartmentSelection,apartmentQueryRegion} from '../src/apartment-query.js';
import {makeApartmentFavorite} from '../src/apartment-favorites.js';
import {savePreferences,restoreExplorer} from '../src/preferences.js';
const region={region_id:'dong_41465101',region_code:'41465',region_name:'경기도 용인시 수지구',dongs:['풍덕천동']};
const catalog=[region],manifest={months:['202601','202609','202610'],published_at:'2026-10-03T12:00:00Z'};
const item=makeApartmentFavorite({apartment:'저장단지',dong:'풍덕천동',jibun:'1'},region);
const restore=params=>restoreApartmentQuery(manifest,catalog,new URLSearchParams(params),[item]);
beforeEach(()=>localStorage.clear());
it('migrates legacy dashboard links and filters while ordinary apartment visits start with a separate empty selection',()=>{
 savePreferences('favoriteDashboard',{day:'2026-09-28',period:{mode:'month',month:'2026-09',start:'2026-09-01',end:'2026-09-30'}});
 expect(restore('tab=dashboard')).toMatchObject({selected:[item],day:'2026-09-28',period:{mode:'month',month:'2026-09'}});
 expect(restore('tab=apartments').selected).toEqual([]);
});
it('preserves old saved apartment selections and accepts old contract-month links as the common custom period',()=>{
 savePreferences('explorer',{regionId:region.region_id,selectedApartment:item.key});
 expect(restore('tab=apartments').selected).toEqual([item]);
 const shared=restore('tab=apartments&region='+region.region_id+'&start=202601&end=202610');
 expect(shared.selected).toEqual([]);expect(shared.period).toMatchObject({mode:'custom',start:'2026-01-01',end:'2026-10-03'});
});
it('a shared selection and period override saved selections without changing apartment favorites',()=>{
 savePreferences('apartmentTransactions',{selected:[item],period:{mode:'month',month:'2026-01'}});
 expect(restore('tab=apartments&apt=&period=month&month=2026-09')).toMatchObject({selected:[],period:{mode:'month',month:'2026-09'}});
 const params=new URLSearchParams({tab:'apartments',apt:JSON.stringify(item),period:'custom',from:'2026-09-01',to:'2026-09-02'});
 expect(restoreApartmentQuery(manifest,catalog,params,[])).toMatchObject({selected:[item],period:{mode:'custom',start:'2026-09-01',end:'2026-09-02'}});
});
it('discards malformed, duplicated, forged or unknown district selections and invalid periods',()=>{
 for(const value of ['bad','null',JSON.stringify({...item,id:'forged'}),JSON.stringify({...item,region_code:'99999'})])expect(restore(new URLSearchParams({tab:'apartments',apt:value}).toString()).selected).toEqual([]);
 const params=new URLSearchParams({tab:'apartments',period:'custom',from:'2099-01-01',to:'2099-01-02'});params.append('apt',JSON.stringify(item));params.append('apt',JSON.stringify(item));
 expect(restore(params.toString())).toMatchObject({selected:[],period:{mode:'week'}});
});
it('does not borrow an explicit weekly URL period or selection for the independent apartment view',()=>{
 savePreferences('apartmentTransactions',{selected:[item],period:{mode:'month',month:'2026-01'}});
 expect(restore('tab=weekly&period=month&month=2026-09')).toMatchObject({selected:[item],period:{mode:'month',month:'2026-01'}});
});
it('master selections retain verified aliases, and equivalent individual trades cannot create duplicate query cards',()=>{
 const master=makeApartmentFavorite({...item,master_id:'hub:official',trade_keys:[item.key,JSON.stringify(['동천동','2','신고단지'])]},region);
 expect(validApartmentSelection([master],catalog)).toBe(true);expect(validApartmentSelection([master,item],catalog)).toBe(false);
 expect(apartmentQueryRegion(master).dongs).toEqual(['풍덕천동','동천동']);
});

it('keeps the saved dong period independent when opening an explicit apartment period link',()=>{
 savePreferences('explorer',{tab:'weekly',weeklyDay:'2026-09-28',weeklyPeriod:{mode:'month',month:'2026-01',start:'2026-01-01',end:'2026-01-31'}});
 const result=restoreExplorer({...manifest,districts:{}},catalog,new URLSearchParams('tab=apartments&period=month&month=2026-09&week=2026-02-09'));
 expect(result.tab).toBe('apartments');expect(result.weeklyPeriod.month).toBe('2026-01');expect(result.weeklyDay).toBe('2026-09-28');
});
