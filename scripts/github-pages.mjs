import {execFileSync} from 'node:child_process';
import {ROOT} from '../server/storage.mjs';
export async function githubApi(endpoint,method='GET',body) {
  const credential=execFileSync('git',['-c',`safe.directory=${ROOT.replaceAll('\\','/')}`,'credential','fill'],{cwd:ROOT,input:'protocol=https\nhost=github.com\n\n',encoding:'utf8',timeout:30000});
  const token=credential.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9);
  if(!token)throw new Error('GitHub Git 인증을 먼저 설정하세요.');
  const response=await fetch('https://api.github.com/repos/Psionic7/psionic7.github.io'+endpoint,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'home-records-pages','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`GitHub API HTTP ${response.status}`);
  return response.status===204?{}:response.json();
}
if(process.argv[1]?.endsWith('github-pages.mjs')) {
  try {
    const action=process.argv[2]||'status';
    if(action==='info'){const r=await githubApi('');console.log({url:r.html_url,private:r.private,default_branch:r.default_branch});}
    else if(action==='status'){const r=await githubApi('/pages'),b=await githubApi('/pages/builds/latest');console.log({url:r.html_url,source:r.source,status:r.status,build_status:b.status,commit:b.commit,error:b.error});}
    else if(action==='rebuild'){const r=await githubApi('/pages/builds','POST');console.log({status:r.status});}
    else if(action==='enable'){const r=await githubApi('/pages','PUT',{build_type:'legacy',source:{branch:'main',path:'/docs'}});console.log({source:r.source,status:r.status});}
    else throw new Error('info, status, rebuild, enable 중 하나를 지정하세요.');
  }catch{console.error('GitHub 요청 실패. Git 인증과 Pages 설정을 확인하세요.');process.exitCode=1;}
}
