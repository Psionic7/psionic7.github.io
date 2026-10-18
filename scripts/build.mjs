import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
// CLI and the local administrator must prepare the same generated data before
// Vite reads its manifests and copies public assets.
export function buildPublic({cwd=root,run=execFileSync}={}){
  for(const script of ['scripts/prepare-browser-data.mjs','node_modules/vite/bin/vite.js','scripts/finish-build.mjs']){
    run(process.execPath,[script,...(script.includes('vite/bin/')?['build']:[])],{cwd,windowsHide:true,stdio:'inherit'});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)buildPublic();
