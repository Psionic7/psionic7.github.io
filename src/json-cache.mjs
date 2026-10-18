// Share in-flight requests; bound settled JSON retained between views.
export function createJsonCache(load,{maxEntries=48,maxCharacters=4*1024*1024,sizeOf=()=>0}={}){
  const entries=new Map();let characters=0;
  const trim=()=>{for(const [key,entry] of entries){if(entries.size<=maxEntries&&characters<=maxCharacters)break;if(!entry.settled)continue;entries.delete(key);characters-=entry.size;}};
  return key=>{
    if(entries.has(key)){const entry=entries.get(key);entries.delete(key);entries.set(key,entry);return entry.promise;}
    const entry={settled:false,size:0};entries.set(key,entry);
    entry.promise=Promise.resolve().then(()=>load(key)).then(value=>{entry.settled=true;entry.size=sizeOf(value);characters+=entry.size;trim();return value;},error=>{entries.delete(key);throw error;});return entry.promise;
  };
}
