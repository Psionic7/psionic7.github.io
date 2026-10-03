// Guard commits to the preserved private archive without requiring its old runtime.
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {secretValues,checkedBytes} from '../server/storage.mjs';
try {
  const root=process.cwd(),secrets=secretValues(path.join(root,'.env'));
  const git=(...args)=>execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,...args],{maxBuffer:100*1024*1024});
  const names=git('ls-files','-z').toString().split('\0').filter(Boolean);
  for(const name of names) {
    if((path.basename(name).startsWith('.env')&&path.basename(name)!=='.env.example')||name.endsWith('secrets.toml'))throw new Error();
    checkedBytes(git('show',':'+name),secrets);
  }
  console.log('비공개 보관 저장소의 인증 값 검사 완료');
}catch{console.error('비공개 보관 저장소의 Git 인덱스에 인증 값 또는 비밀 파일이 있는지 확인하세요.');process.exitCode=1;}
