import path from 'node:path';
import {parseArgs} from 'node:util';
import {connect,paths,ROOT,readJson} from '../server/storage.mjs';
import {validateConfig} from '../automation/config.mjs';
import {createApartmentBaseline} from '../server/apartment-baseline.mjs';
import {loadApartmentBaseline,installApartmentBaseline,assertInstalledBaseline} from '../server/apartment-baseline-state.mjs';
import {deriveBaselineHousing} from '../server/apartment-baseline-runtime.mjs';

const {values,positionals}=parseArgs({allowPositionals:true,options:{source:{type:'string'},database:{type:'string'},directory:{type:'string'},'public-root':{type:'string'}}});
const config=validateConfig(readJson(path.join(ROOT,'automation/config.json'))),action=positionals[0];
if(action==='create'){
 const db=connect(values.source||paths.db,true);
 try{db.exec('BEGIN');console.log(JSON.stringify(createApartmentBaseline(db,{config,directory:values.directory,publicRoot:values['public-root']}),null,2));}finally{db.close();}
}else if(action==='check'){
 const baseline=loadApartmentBaseline({directory:values.directory,config});
 console.log(JSON.stringify({generation:baseline.manifest.generation,targets:baseline.manifest.targets,verifiedTargets:baseline.manifest.verifiedTargets}));
}else if(action==='apply'){
 if(!values.database)throw Error('--database에 수집 이력 DB를 명시하세요.');
 const baseline=loadApartmentBaseline({directory:values.directory,config}),db=connect(path.resolve(values.database));
 try{installApartmentBaseline(db,baseline,{config});const stats=deriveBaselineHousing(db);assertInstalledBaseline(db,{expected:baseline,config});console.log(JSON.stringify(stats,null,2));}finally{db.close();}
}else throw Error('create, check, apply 중 하나를 지정하세요.');
