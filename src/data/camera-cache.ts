import {TimelineCache} from './timeline-cache';
import type {Frame} from './types';

/** Owns a small decoded-image window, including object URL and request cleanup. */
export function createCameraCache(frameAt:(i:number)=>Frame,onChange:()=>void){
  return new TimelineCache<HTMLImageElement>({
    ahead:6,behind:1,concurrency:2,maxResidentBytes:24*1024*1024,
    sizeOf:img=>img.naturalWidth*img.naturalHeight*4,
    release:img=>{URL.revokeObjectURL(img.src);img.removeAttribute('src')},
    onChange,
    load:async(i,signal)=>{
      const frame=frameAt(i),img=new Image();
      if(!frame.imageFile&&!frame.imageUrl)return {value:img,bytes:0};
      let blob:Blob;
      if(frame.imageFile)blob=frame.imageFile;
      else {const r=await fetch(frame.imageUrl!,{signal});if(!r.ok)throw Error('Camera HTTP '+r.status);blob=await r.blob()}
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      const url=URL.createObjectURL(blob);img.src=url;img.alt='Camera frame '+frame.name;
      try{await img.decode();if(signal.aborted)throw new DOMException('Aborted','AbortError');return {value:img,bytes:blob.size}}
      catch(error){URL.revokeObjectURL(url);img.removeAttribute('src');throw error}
    }
  });
}
