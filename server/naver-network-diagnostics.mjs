import {lookup} from 'node:dns/promises';
import tls from 'node:tls';
import https from 'node:https';
import http2 from 'node:http2';
import {performance} from 'node:perf_hooks';

export async function diagnoseNaverConnection({timeoutMs=5000,complexNo='107215'}={}){
 if(!/^[1-9]\d{0,11}$/.test(complexNo))throw Error('진단 단지번호를 확인하세요.');
 const host='fin.land.naver.com',started=performance.now();let timer;
 const report={host,path:'node_direct_dns_tls_http',proxyConfigured:Boolean(process.env.HTTPS_PROXY||process.env.HTTP_PROXY)};
 const location=value=>{try{const url=new URL(value,'https://'+host);return {host:url.hostname,path:url.pathname};}catch{return null;}};
 try{
  const addresses=await Promise.race([lookup(host,{all:true}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(Error(),{code:'DNS_TIMEOUT'})),timeoutMs);})]);
  clearTimeout(timer);report.dns={status:'ok',durationMs:Math.round(performance.now()-started),addresses};
  const target=addresses.find(item=>item.family===4)||addresses[0],tlsStarted=performance.now();
  report.tls=await new Promise(resolve=>{
   const socket=tls.connect({host:target.address,servername:host,port:443,rejectUnauthorized:true});let finished=false;
   const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);socket.destroy();resolve({...value,durationMs:Math.round(performance.now()-tlsStarted)});};
   socket.once('secureConnect',()=>finish({status:'ok',protocol:socket.getProtocol(),address:target.address}));
   socket.once('error',error=>finish({status:'failed',code:error.code||'TLS_ERROR'}));
   timer=setTimeout(()=>finish({status:'failed',code:'TLS_TIMEOUT'}),timeoutMs);
  });
  const httpStarted=performance.now();
  report.http=await new Promise(resolve=>{
   let finished=false;
   const request=https.request({hostname:host,path:`/complexes/${complexNo}?articleTradeTypes=A1&tab=article`,method:'GET',agent:false,
    lookup:(_host,options,callback)=>options.all?callback(null,[target]):callback(null,target.address,target.family)},response=>{
     const redirect=response.headers.location?location(response.headers.location):null;
     finish({status:'ok',statusCode:response.statusCode,httpVersion:response.httpVersion,redirect});response.destroy();
    });
   const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);request.destroy();resolve({...value,address:target.address,durationMs:Math.round(performance.now()-httpStarted)});};
   request.once('error',error=>finish({status:'failed',code:error.code||'HTTP_ERROR'}));
   timer=setTimeout(()=>finish({status:'failed',code:'HTTP_HEADERS_TIMEOUT'}),timeoutMs);
   request.end();
  });
  const h2Started=performance.now();
  report.http2=await new Promise(resolve=>{
   const session=http2.connect('https://'+host,{lookup:(_host,options,callback)=>options.all?callback(null,[target]):callback(null,target.address,target.family)});let finished=false,request;
   const finish=value=>{if(finished)return;finished=true;clearTimeout(timer);request?.destroy();session.destroy();resolve({...value,address:target.address,durationMs:Math.round(performance.now()-h2Started)});};
   session.once('error',error=>finish({status:'failed',code:error.code||'HTTP2_ERROR'}));
   request=session.request({':method':'GET',':path':`/complexes/${complexNo}?articleTradeTypes=A1&tab=article`});
   request.once('response',headers=>finish({status:'ok',statusCode:headers[':status'],protocol:'h2',redirect:headers.location?location(headers.location):null}));
   request.once('error',error=>finish({status:'failed',code:error.code||'HTTP2_STREAM_ERROR'}));
   timer=setTimeout(()=>finish({status:'failed',code:'HTTP2_HEADERS_TIMEOUT'}),timeoutMs);request.end();
  });
 }catch(error){report.dns={status:'failed',code:error.code||'DNS_ERROR',durationMs:Math.round(performance.now()-started)};}
 finally{clearTimeout(timer);}
 return report;
}
