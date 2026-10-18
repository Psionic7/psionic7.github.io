export const intersects=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
export const validBounds=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<=b[2]&&b[1]<=b[3];
export function geometryBounds(geometry){
  const box=[Infinity,Infinity,-Infinity,-Infinity];
  const visit=value=>{if(typeof value[0]==='number'){box[0]=Math.min(box[0],value[0]);box[1]=Math.min(box[1],value[1]);box[2]=Math.max(box[2],value[0]);box[3]=Math.max(box[3],value[1]);}else for(const child of value)visit(child);};
  visit(geometry.coordinates);return box;
}
