import {lookup} from 'node:dns/promises';
import tls from 'node:tls';
import {performance} from 'node:perf_hooks';

export async function diagnoseNaverConnection({timeoutMs=5000}={}){
 const host='fin.land.naver.com',started=performance.now();let timer;
 const report={host,path:'node_direct_dns_tls',proxyConfigured:Boolean(process.env.HTTPS_PROXY||process.env.HTTP_PROXY)};
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
 }catch(error){report.dns={status:'failed',code:error.code||'DNS_ERROR',durationMs:Math.round(performance.now()-started)};}
 finally{clearTimeout(timer);}
 return report;
}
