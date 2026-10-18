import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PUBLIC_SCHEMA,LOCAL_SCHEMA} from '../server/storage.mjs';
import {refreshPlan,repairTradeData,REPAIR_KEY} from '../server/trade-refresh.mjs';
import {collectConfigured} from '../scripts/automation.mjs';
const config={version:1,time_kst:'01:00',recent_months:12,address_limit:1000,region_ids:['dong_41117102']};
function fixture(){const db=new DatabaseSync(':memory:');db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA);db.exec("INSERT INTO regions VALUES('dong_41117102','원천동','41117','영통구','[\"원천동\"]',NULL,NULL)");return db;}
test('historical refresh includes empty intervening months, wraps and deduplicates recent months',()=>{
  const db=fixture();try{
    db.exec("INSERT INTO trades VALUES(1,'41117','202401','2024-01-01','단지','원천동','1',1,1,1,2000,0,'{}')");
    const plan=refreshPlan(db,config,new Date('2026-10-18Z'));
    assert.equal(plan.recent[0],'202511');assert.equal(plan.history.length,12);assert.equal(plan.history[1],'202402');
    db.prepare('INSERT INTO metadata VALUES(?,?)').run('historical_refresh_cursor','202510');
    assert.equal(refreshPlan(db,config,new Date('2026-10-18Z')).history[0],'202401');
    assert.equal(new Set(plan.months).size,plan.months.length);
    db.exec("INSERT INTO collection_runs VALUES(1,'41117','영통구','202312','2026-10-18T00:00:00Z',0,0)");
    assert.equal(refreshPlan(db,config,new Date('2026-10-18Z')).history[0],'202312');
  }finally{db.close();}
});
test('a failed historical batch does not advance its cursor and a retry completes the same months',async()=>{
  const db=fixture();try{
    db.exec("INSERT INTO trades VALUES(1,'41117','202401','2024-01-01','단지','원천동','1',1,1,1,2000,0,'{}')");
    const options={now:new Date('2026-10-18Z'),tradeKey:'fixture',jusoKey:'fixture',onProgress:()=>{},addressCollector:async()=>({completed:0})};
    let calls=0;await assert.rejects(collectConfigured(db,config,{...options,collector:async()=>{if(++calls===2)throw Error('network');return 0;}}));
    assert.equal(db.prepare("SELECT * FROM metadata WHERE key='historical_refresh_cursor'").get(),undefined);
    const months=[];await collectConfigured(db,config,{...options,collector:async(_db,_key,_code,month)=>{months.push(month);return 0;}});
    assert.equal(months.length,24);assert.equal(db.prepare("SELECT value FROM metadata WHERE key='historical_refresh_cursor'").get().value,'202412');
  }finally{db.close();}
});
test('one-time repair is retriable and marks completion only after every affected month succeeds',async()=>{
  const db=fixture();try{
    let calls=0;await assert.rejects(repairTradeData(db,'fixture',{onProgress:()=>{},collector:async()=>{if(++calls===3)throw Error('network');return 1;}}));
    assert.equal(db.prepare('SELECT * FROM metadata WHERE key=?').get(REPAIR_KEY),undefined);
    const tasks=[];assert.equal((await repairTradeData(db,'fixture',{onProgress:()=>{},collector:async(_db,_key,code,month)=>{tasks.push([code,month]);return 1;}})).tasks,7);
    assert.deepEqual(tasks.at(-1),['41465','202607']);
    assert.deepEqual(await repairTradeData(db,'',{collector:async()=>{throw Error('must not run');}}),{changed:false,tasks:0});
  }finally{db.close();}
});
