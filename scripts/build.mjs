import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
// CLI and the local administrator must prepare the same generated data before
// Vite reads its manifests and copies public assets.
export function buildPublic({cwd=root,run=execFileSync}={}){
  const steps=[['scripts/prepare-browser-data.mjs'],['scripts/check-trade-data.mjs','--target','public/data','--require-search'],['node_modules/vite/bin/vite.js','build'],['scripts/finish-build.mjs'],['scripts/check-trade-data.mjs','--target','docs/data','--require-search']];
  for(const args of steps){
    run(process.execPath,args,{cwd,windowsHide:true,stdio:'inherit'});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)buildPublic();
