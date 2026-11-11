import path from 'node:path';
import {parseArgs} from 'node:util';
import {connect,paths,ROOT,readJson} from '../server/storage.mjs';
import {dailyListingTargets} from '../server/daily-naver-listings.mjs';
import {verifyNaverSharedMatch,recordNaverSharedMatch} from '../server/apartment-naver-matches.mjs';
import {validListingSnapshot} from '../src/naver-listings.mjs';

const {values}=parseArgs({options:{database:{type:'string'},'target-id':{type:'string'},'representative-id':{type:'string'},snapshot:{type:'string'},apply:{type:'boolean'}}});
if(!values['target-id']||!values['representative-id'])throw Error('--target-id와 --representative-id를 지정하세요.');
const db=connect(values.database?path.resolve(values.database):paths.db,!values.apply);
try{
 if(values.apply)db.exec('BEGIN IMMEDIATE');
 const targets=dailyListingTargets(db,readJson(path.join(ROOT,'automation/config.json')));
 const target=targets.find(target=>target.favorite.id===values['target-id']);
 const representative=targets.find(target=>target.favorite.id===values['representative-id']);
 if(!target||!representative)throw Error('현재 로컬 대장 범위에 포함된 대상과 대표 단지가 필요합니다.');
 let group;
 if(values.snapshot){
  const snapshot=readJson(path.resolve(values.snapshot));
  if(!validListingSnapshot(snapshot))throw Error('원본 매물 스냅샷 형식을 확인하세요.');
  group=snapshot.groups.find(group=>group.favorite.id===representative.favorite.id);
 }else{
  const row=db.prepare('SELECT group_json FROM naver_listing_snapshots WHERE apartment_id=?').get(representative.favorite.id);
  group=row?JSON.parse(row.group_json):null;
 }
 const verified=verifyNaverSharedMatch(db,target,representative,group);
 if(values.apply){
  recordNaverSharedMatch(db,target,representative,group);
  const save=db.prepare(`INSERT INTO naver_listing_snapshots VALUES(?,?,?) ON CONFLICT(apartment_id) DO UPDATE SET collected_at=excluded.collected_at,group_json=excluded.group_json WHERE excluded.collected_at>=naver_listing_snapshots.collected_at`);
  for(const value of [group,{...group,favorite:target.favorite,observation:verified.observation}])save.run(value.favorite.id,value.collectedAt,JSON.stringify(value));
  db.exec('COMMIT');
 }
 console.log(JSON.stringify({applied:values.apply===true,targetId:target.favorite.id,representativeId:representative.favorite.id,complexNo:group.complexNo,observedAt:group.observation.observed_at,buildingWitnesses:verified.observation.shared_scope.building_witnesses,rawAdvertisements:group.articles.length},null,2));
}catch(error){
 if(values.apply&&db.isTransaction)db.exec('ROLLBACK');
 console.error(error.code||error.message);process.exitCode=1;
}finally{db.close();}
