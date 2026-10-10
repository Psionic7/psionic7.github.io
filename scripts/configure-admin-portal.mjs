import {readFileSync,writeFileSync} from 'node:fs';
let origin;try {origin=new URL(process.env.ADMIN_ORIGIN || '');} catch {throw new Error('ADMIN_ORIGIN에 관리자 서버의 HTTPS 주소를 설정하세요.');}
if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)
  throw new Error('ADMIN_ORIGIN에 관리자 서버의 HTTPS 주소를 설정하세요.');
const clientId=process.env.GITHUB_OAUTH_CLIENT_ID || '';
if(!/^[A-Za-z0-9_]{1,100}$/.test(clientId))throw new Error('GitHub OAuth App의 Client ID를 설정하세요.');
const source=new URL('../auth-admin/wrangler.jsonc',import.meta.url);
const config=JSON.parse(readFileSync(source,'utf8'));
config.vars={ADMIN_ORIGIN:origin.origin,GITHUB_OAUTH_CLIENT_ID:clientId};
writeFileSync(new URL('../auth-admin/wrangler.deploy.json',import.meta.url),JSON.stringify(config,null,2)+'\n');
console.log('관리자 서버 배포 설정 생성 완료');
