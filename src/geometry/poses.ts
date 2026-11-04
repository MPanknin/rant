/** Row-major rigid world-from-sensor transforms. Velodyne: X forward, Y left, Z up. */
export function isRigidPose(p:unknown):p is number[]{
  if(!Array.isArray(p)||p.length!==12||!p.every(Number.isFinite))return false;
  for(let a=0;a<3;a++)for(let b=0;b<3;b++){
    let dot=0;for(let k=0;k<3;k++)dot+=p[a*4+k]*p[b*4+k];
    if(Math.abs(dot-(a===b?1:0))>.002)return false;
  }
  const det=p[0]*(p[5]*p[10]-p[6]*p[9])-p[1]*(p[4]*p[10]-p[6]*p[8])+p[2]*(p[4]*p[9]-p[5]*p[8]);
  return Math.abs(det-1)<.002;
}
/** inverse(current world-from-sensor) × source world-from-sensor. */
export function relativePose(current:readonly number[],source:readonly number[]):number[]{
  const out=new Array<number>(12);
  for(let r=0;r<3;r++){
    for(let c=0;c<3;c++)out[r*4+c]=current[r]*source[c]+current[4+r]*source[4+c]+current[8+r]*source[8+c];
    out[r*4+3]=current[r]*(source[3]-current[3])+current[4+r]*(source[7]-current[7])+current[8+r]*(source[11]-current[11]);
  }
  return out;
}
export function transformPoint(t:readonly number[],x:number,y:number,z:number):[number,number,number]{
  return [t[0]*x+t[1]*y+t[2]*z+t[3],t[4]*x+t[5]*y+t[6]*z+t[7],t[8]*x+t[9]*y+t[10]*z+t[11]];
}
/** Writes into a reused bounded GPU staging buffer; never allocates per return. */
export function accumulateInto(output:Float32Array,current:readonly number[],scans:Iterable<{points:Float32Array;pose:readonly number[]}>,perScan=12000){
  let count=0,used=0;
  for(const {points,pose} of scans){
    if(count*3>=output.length)break;
    const t=relativePose(current,pose),stride=Math.max(1,Math.ceil(points.length/4/perScan));used++;
    for(let i=0;i<points.length&&count*3+2<output.length;i+=4*stride){
      const x=points[i],y=points[i+1],z=points[i+2];
      if(!Number.isFinite(x+y+z))continue;
      const j=count++*3;
      output[j]=t[0]*x+t[1]*y+t[2]*z+t[3];output[j+1]=t[4]*x+t[5]*y+t[6]*z+t[7];output[j+2]=t[8]*x+t[9]*y+t[10]*z+t[11];
    }
  }
  return {count,used};
}
