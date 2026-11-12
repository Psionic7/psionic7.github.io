import https from 'node:https';
import {performance} from 'node:perf_hooks';

export const NAVER_DIAGNOSTIC_ENDPOINTS=[
 {label:'internet_control',host:'example.com',path:'/'},
 {label:'naver_home',host:'www.naver.com',path:'/'},
 {label:'land_legacy',host:'land.naver.com',path:'/'},
 {label:'land_desktop',host:'new.land.naver.com',path:'/'},
 {label:'land_mobile',host:'m.land.naver.com',path:'/'},
 {label:'fin_home',host:'fin.land.naver.com',path:'/'},
 {label:'fin_robots',host:'fin.land.naver.com',path:'/robots.txt'},
 {label:'fin_map',host:'fin.land.naver.com',path:'/map'},
 {label:'fin_complex',host:'fin.land.naver.com',path:'/complexes/107215?articleTradeTypes=A1&tab=article'},
];

export function probePublicEndpoint(endpoint,{timeoutMs=6000}={}){
 if(!NAVER_DIAGNOSTIC_ENDPOINTS.some(value=>value.host===endpoint.host&&value.path===endpoint.path))throw Error('허용된 진단 주소를 사용하세요.');
 const started=performance.now(),result={label:endpoint.label,host:endpoint.host,path:endpoint.path.split('?')[0]};
 return new Promise(resolve=>{
  let finished=false,timer;
  const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);request.destroy();resolve({...result,...value,durationMs:Math.round(performance.now()-started)});};
  const request=https.request({hostname:endpoint.host,path:endpoint.path,method:'GET',family:4,agent:false},response=>{
   let redirect=null;
   try{if(response.headers.location){const url=new URL(response.headers.location,'https://'+endpoint.host);redirect={host:url.hostname,path:url.pathname};}}catch{}
   finish({status:'headers_received',statusCode:response.statusCode,redirect});response.destroy();
  });
  request.once('socket',socket=>{
   socket.once('lookup',(error,address,family)=>{result.dns={code:error?.code||null,address:address||null,family:family||null,atMs:Math.round(performance.now()-started)};});
   socket.once('secureConnect',()=>{const cert=socket.getPeerCertificate();result.tls={authorized:socket.authorized,protocol:socket.getProtocol(),remoteAddress:socket.remoteAddress,subject:cert.subject?.CN||null,issuer:cert.issuer?.CN||null,fingerprint256:cert.fingerprint256||null,atMs:Math.round(performance.now()-started)};});
  });
  request.once('error',error=>finish({status:'failed',code:error.code||'REQUEST_ERROR'}));
  timer=setTimeout(()=>finish({status:'timeout',code:'RESPONSE_HEADERS_TIMEOUT'}),timeoutMs);request.end();
 });
}
