import {createHash} from 'node:crypto';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
import {geometryBounds} from '../src/map-bounds.mjs';
export function mapTilePayloads(boundaries,source,encode=value=>Buffer.from(JSON.stringify(value))){
  const groups=new Map(),payloads=new Map(),tiles=[];
  for(const feature of boundaries.features){
    const bbox=geometryBounds(feature.geometry),key=Math.floor((bbox[0]+bbox[2])/2/.02)+'_'+Math.floor((bbox[1]+bbox[3])/2/.02);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push({...feature,bbox});
  }
  for(const [cell,features] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
    const bbox=[Math.min(...features.map(f=>f.bbox[0])),Math.min(...features.map(f=>f.bbox[1])),Math.max(...features.map(f=>f.bbox[2])),Math.max(...features.map(f=>f.bbox[3]))];
    const bytes=encode({type:'FeatureCollection',features}),sha256=digest(bytes),file='tile-'+cell+'-'+sha256.slice(0,12)+'.json';payloads.set(file,bytes);tiles.push({file,sha256,bytes:bytes.length,bbox});
  }
  const manifest={version:1,source_sha256:source,feature_count:boundaries.features.length,tiles};payloads.set('manifest.json',encode(manifest));return {payloads,manifest};
}
