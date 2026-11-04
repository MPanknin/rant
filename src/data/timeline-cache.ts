export interface StreamStats {
  resident:number; residentBytes:number; active:number; bytesRead:number;
  hits:number; misses:number; lastSeekMs:number; failures:number;
}
export interface StreamOptions<T> {
  load:(index:number,signal:AbortSignal)=>Promise<{value:T;bytes:number}>;
  sizeOf:(value:T)=>number;
  onChange?:()=>void;
  release?:(value:T)=>void;
  onError?:(index:number,error:unknown)=>void;
  ahead?:number; behind?:number; concurrency?:number; maxResidentBytes?:number;
}
export class TimelineCache<T> {
  private values=new Map<number,T>();
  private active=new Map<number,AbortController>();
  private failures=new Set<number>();
  private deferred=new Set<number>();
  private generation=0;
  private cursor=0;
  private count=0;
  private bytes=0;
  private residentBytes=0;
  private hits=0;
  private misses=0;
  private seekStart=0;
  private seekMs=0;
  private readonly ahead:number;
  private readonly behind:number;
  private readonly concurrency:number;
  private readonly budget:number;
  private readonly options:StreamOptions<T>;
  constructor(options:StreamOptions<T>) {
    this.options=options;
    this.ahead=options.ahead??20;
    this.behind=options.behind??4;
    this.concurrency=options.concurrency??4;
    this.budget=options.maxResidentBytes??128*1024*1024;
    if(!Number.isInteger(this.concurrency)||this.concurrency<1||!Number.isFinite(this.budget)||this.budget<=0)throw Error('Invalid cache configuration');
  }
  reset(count:number):void {
    if(!Number.isInteger(count)||count<0)throw Error('Invalid frame count');
    this.generation++;
    for(const request of this.active.values())request.abort();
    this.active.clear();for(const value of this.values.values())this.options.release?.(value);this.values.clear();this.failures.clear();this.deferred.clear();
    this.count=count;this.cursor=0;this.bytes=0;this.residentBytes=0;
    this.hits=0;this.misses=0;this.seekStart=0;this.seekMs=0;
    this.notify();this.pump();
  }
  get(index:number):T|undefined {return this.values.get(index)}
  hasFailed(index:number):boolean {return this.failures.has(index)}
  get playhead():number {return this.cursor}
  get stats():StreamStats {
    return {resident:this.values.size,residentBytes:this.residentBytes,active:this.active.size,bytesRead:this.bytes,hits:this.hits,misses:this.misses,lastSeekMs:this.seekMs,failures:this.failures.size};
  }
  seek(index:number):void {
    if(!Number.isInteger(index)||index<0||index>=this.count||index===this.cursor)return;
    this.cursor=index;
    this.deferred.clear();
    if(this.values.has(index)){this.hits++;this.seekMs=0;this.seekStart=0}
    else {this.misses++;this.seekStart=performance.now()}
    this.evictOutsideWindow();
    this.pump();this.notify();
  }
  dispose():void {this.reset(0)}
  private inside(i:number):boolean {
    if(this.count===0)return false;
    return (i-this.cursor+this.count)%this.count<=this.ahead||(this.cursor-i+this.count)%this.count<=this.behind;
  }
  private remove(i:number):void {
    const value=this.values.get(i);
    if(value===undefined)return;
    this.residentBytes-=this.options.sizeOf(value);
    this.values.delete(i);this.options.release?.(value);
  }
  private evictOutsideWindow():void {
    for(const i of this.values.keys())if(!this.inside(i))this.remove(i);
    for(const [i,request] of this.active)if(!this.inside(i)){this.active.delete(i);request.abort()}
  }
  private priorities():number[] {
    if(!this.count)return [];
    const order=[this.cursor];
    for(let i=1;i<=Math.min(this.ahead,this.count-1);i++)order.push((this.cursor+i)%this.count);
    for(let i=1;i<=Math.min(this.behind,this.count-1);i++)order.push((this.cursor-i+this.count)%this.count);
    return [...new Set(order)];
  }
  private retain(i:number,value:T):void {
    const size=this.options.sizeOf(value);
    if(!Number.isFinite(size)||size<0)throw Error('Invalid frame size');
    // Oversized frames are rejected and released, including prefetched frames.
    if(size>this.budget){if(i===this.cursor)this.options.onError?.(i,new Error('Frame exceeds resident memory budget'));this.failures.add(i);this.options.release?.(value);return}
    // Evict farthest non-playhead entries first, preserving current frame.
    const distance=(j:number)=>Math.min((j-this.cursor+this.count)%this.count,(this.cursor-j+this.count)%this.count);
    const victims=[...this.values.keys()].filter(j=>j!==this.cursor).sort((a,b)=>distance(b)-distance(a));
    if(i===this.cursor)while(this.residentBytes+size>this.budget&&victims.length)this.remove(victims.shift()!);
    if(this.residentBytes+size>this.budget){this.deferred.add(i);this.options.release?.(value);return;}
    this.values.set(i,value);this.residentBytes+=size;
  }
  private notify():void {this.options.onChange?.()}
  private pump():void {
    if(!this.count)return;
    for(const i of this.priorities()){
      if(this.active.size>=this.concurrency)break;
      if(this.values.has(i)||this.active.has(i)||this.failures.has(i)||this.deferred.has(i))continue;
      // Avoid prefetching when the budget is already occupied by the playhead.
      if(i!==this.cursor&&this.residentBytes>=this.budget)continue;
      const controller=new AbortController(),generation=this.generation;
      this.active.set(i,controller);
      void this.options.load(i,controller.signal).then(({value,bytes})=>{
        if(generation!==this.generation||controller.signal.aborted){this.options.release?.(value);return;}
        this.bytes+=bytes;
        if(this.inside(i))this.retain(i,value);else this.options.release?.(value);
        if(i===this.cursor&&this.values.has(i)&&this.seekStart){this.seekMs=performance.now()-this.seekStart;this.seekStart=0}
      }).catch(error=>{
        if(generation!==this.generation||controller.signal.aborted)return;
        this.failures.add(i);this.options.onError?.(i,error);
      }).finally(()=>{
        if(this.active.get(i)===controller)this.active.delete(i);
        if(generation===this.generation){this.notify();this.pump()}
      });
    }
    this.notify();
  }
}
