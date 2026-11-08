export const normalizeRoadAddress=value=>String(value||'').trim().replace(/(?:\s*\([^)]*\))+\s*$/,'').replace(/\s/g,'');

export function normalizeParcel(value) {
  const match=String(value||'').replace(/\s/g,'').match(/^(산)?(\d+)(?:-(\d+))?$/);
  if(!match)return null;
  const main=Number(match[2]),sub=Number(match[3]||0);
  if(!Number.isSafeInteger(main)||main<=0||!Number.isSafeInteger(sub)||sub<0)return null;
  return `${match[1]||''}${main}${sub?'-'+sub:''}`;
}
