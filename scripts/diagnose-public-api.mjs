import dns from 'node:dns/promises';
import {execFileSync} from 'node:child_process';

// Connectivity diagnostics only: never send an API key or print an API query.
for (const host of ['apis.data.go.kr', 'business.juso.go.kr']) {
  try {console.log(JSON.stringify({host, addresses: await dns.lookup(host, {all: true})}));}
  catch (error) {console.log(JSON.stringify({host, dns_error: error.code}));}
  const start = Date.now();
  try {
    const response = await fetch(`https://${host}/`, {signal: AbortSignal.timeout(10000)});
    console.log(JSON.stringify({host, transport: 'node', status: response.status, ms: Date.now() - start}));
  } catch (error) {console.log(JSON.stringify({host, transport: 'node', error: error.name, code: error.cause?.code, ms: Date.now() - start}));}
  try {
    const status = execFileSync(process.platform === 'win32' ? 'curl.exe' : 'curl', ['-4', '-s', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', '-w', '%{http_code}', '--connect-timeout', '8', '--max-time', '12', `https://${host}/`], {encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
    console.log(JSON.stringify({host, transport: 'curl-ipv4', status: Number(status)}));
  } catch (error) {console.log(JSON.stringify({host, transport: 'curl-ipv4', exit: error.status}));}
}
