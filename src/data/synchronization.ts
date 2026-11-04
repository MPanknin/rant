export function parseKittiTimestamps(text:string,relative=true):number[]|undefined {
  const lines=text.trim().split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  if(!lines.length)return;
  const times=lines.map(line=>{
    // KITTI raw: UTC date/time with up to nanosecond precision.
    const match=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?$/.exec(line);
    if(!match)return NaN;
    const epoch=Date.parse(match[1]+'T'+match[2]+'Z');
    return epoch+(Number('0.'+(match[3]??'0'))*1000);
  });
  if(times.some(t=>!Number.isFinite(t))||times.some((t,i)=>i>0&&t<times[i-1]))return;
  return relative?times.map(t=>(t-times[0])/1000):times.map(t=>t/1000);
}
export function nearestTimestampIndex(timestamps:readonly number[],time:number,maxDelta=0.05):number|undefined {
  if(!timestamps.length||!Number.isFinite(time))return;
  let low=0,high=timestamps.length;
  while(low<high){const mid=(low+high)>>>1;if(timestamps[mid]<time)low=mid+1;else high=mid}
  const next=low<timestamps.length?low:-1,prev=low>0?low-1:-1;
  const candidate=prev<0?next:next<0?prev:
    Math.abs(timestamps[prev]-time)<=Math.abs(timestamps[next]-time)?prev:next;
  return candidate>=0&&Math.abs(timestamps[candidate]-time)<=maxDelta?candidate:undefined;
}
