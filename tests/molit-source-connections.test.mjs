import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {PUBLIC_SCHEMA,LOCAL_SCHEMA} from '../server/storage.mjs';
import {normalize} from '../server/collector.mjs';
import {normalizedTradeFields} from '../server/trade-integrity.mjs';
import {sourceIdentityId} from '../src/housing-identity.mjs';
import {planMolitSourceConnections,applyMolitSourceConnections,approvedMolitProviders} from '../server/molit-source-connections.mjs';

const raw={aptNm:'삼성1',umdNm:'풍덕천동',jibun:'693',dealAmount:'119,500',excluUseAr:'134.97',floor:'9',buildYear:'1994',dealYear:'2026',dealMonth:'10',dealDay:'20'};
const observed=(extra={})=>{const item={...raw,aptSeq:'41465-9',...extra},values=normalize(item,'41465','202610');return {...Object.fromEntries(normalizedTradeFields.map((key,index)=>[key,values[index]])),raw:item};};
function fixture(t){
 const db=new DatabaseSync(':memory:');db.exec(PUBLIC_SCHEMA+LOCAL_SCHEMA);t.after(()=>db.close());
 const row=observed();delete row.raw.aptSeq;
 db.prepare('INSERT INTO trades VALUES('+Array(13).fill('?').join(',')+')').run(1,...normalizedTradeFields.map(key=>row[key]),JSON.stringify(row.raw));
 return db;
}

test('a local exact contract confirms the official ID without changing any trade and repeats without new writes',t=>{
 const db=fixture(t),before=db.prepare('SELECT * FROM trades').all();
 const plan=planMolitSourceConnections(db,[observed()]);assert.equal(plan.connections.length,1);assert.equal(plan.held.length,0);assert.deepEqual(approvedMolitProviders(db),{});
 assert.deepEqual(applyMolitSourceConnections(db,plan),{added:1,total:1,held:0});
 assert.deepEqual(approvedMolitProviders(db),{'41465-9':[sourceIdentityId(observed())]});
 const again=planMolitSourceConnections(db,[observed()]);assert.equal(again.connections[0].existing,true);assert.equal(applyMolitSourceConnections(db,again).added,0);
 assert.deepEqual(db.prepare('SELECT * FROM trades').all(),before);
});

test('similar names and addresses without an exact local contract never approve a provider',t=>{
 const db=fixture(t),plan=planMolitSourceConnections(db,[observed({dealAmount:'120,000'})]);
 assert.equal(plan.connections.length,0);assert.equal(plan.held[0].reason,'no_exact_local_contract');
 assert.equal(applyMolitSourceConnections(db,plan).total,0);
 assert.throws(()=>planMolitSourceConnections(db,[{...observed(),price_man:100}]),/정규화/);
});

test('provider collisions remain held and cannot replace an existing local approval',t=>{
 const db=fixture(t);applyMolitSourceConnections(db,planMolitSourceConnections(db,[observed()]));
 const before=db.prepare('SELECT * FROM apartment_molit_sources').all();
 const plan=planMolitSourceConnections(db,[observed(),observed({aptSeq:'41465-other'})]);
 assert.equal(plan.connections.length,0);assert.equal(plan.held.length,2);applyMolitSourceConnections(db,plan);
 assert.deepEqual(db.prepare('SELECT * FROM apartment_molit_sources').all(),before);
 const shared=planMolitSourceConnections(db,[observed(),observed({jibun:'694'})]);assert.equal(shared.connections.length,0);
});

test('approval is atomic if a local witness changes and is forbidden on an installed cloud baseline',t=>{
 const db=fixture(t),other=observed({jibun:'694',aptSeq:'41465-10'});
 db.prepare('INSERT INTO trades VALUES('+Array(13).fill('?').join(',')+')').run(2,...normalizedTradeFields.map(key=>other[key]),JSON.stringify({...other.raw,aptSeq:''}));
 const plan=planMolitSourceConnections(db,[observed(),other]);assert.equal(plan.connections.length,2);
 db.exec('UPDATE trades SET price_man=120000 WHERE id=2');assert.throws(()=>applyMolitSourceConnections(db,plan),/근거가 달라/);assert.deepEqual(approvedMolitProviders(db),{});
 db.exec('CREATE TABLE local_apartment_baseline(id INTEGER)');assert.throws(()=>planMolitSourceConnections(db,[]),/로컬 원본/);assert.throws(()=>applyMolitSourceConnections(db,plan),/로컬 원본/);
});

test('a later batch cannot add a conflicting source to an already approved provider',t=>{
 const db=fixture(t);applyMolitSourceConnections(db,planMolitSourceConnections(db,[observed()]));
 const other=observed({jibun:'694',dealAmount:'130,000'});
 db.prepare('INSERT INTO trades VALUES('+Array(13).fill('?').join(',')+')').run(2,...normalizedTradeFields.map(key=>other[key]),JSON.stringify({...other.raw,aptSeq:''}));
 const before=db.prepare('SELECT * FROM apartment_molit_sources').all();
 const plan=planMolitSourceConnections(db,[other]);
 assert.equal(plan.connections.length,0);assert.equal(plan.held.length,1);assert.equal(plan.held[0].reason,'ambiguous_source');
 assert.deepEqual(new Set(plan.held[0].sources),new Set([sourceIdentityId(observed()),sourceIdentityId(other)]));
 applyMolitSourceConnections(db,plan);assert.deepEqual(db.prepare('SELECT * FROM apartment_molit_sources').all(),before);
});
