export interface StreamStats { resident:number; active:number; bytesRead:number; hits:number; misses:number; lastSeekMs:number; failures:number }
export interface StreamItem<T> { value?:T; bytes?:number }
export interface StreamOptions<T> {
  load:(index:number,signal:AbortSignal)=>Promise<{value:T;bytes:number}>;
  onChange?:()=>void;
  onError?:(index:number,error:unknown)=>void;
  ahead?:number; behind?:number; concurrency?:number;
}
export class TimelineCache<T> {
  private values=new Map<number,T>();
  private active=new Map<number,AbortController>();
  private failures=new Set<number>();
  private generation=0;
  private cursor=0;
  private count=0;
  private bytes=0;
  private hits=0;
  private misses=0;
  private seekStart=0;
  private seekMs=0;
  private ahead:number;
  private behind:number;
  private concurrency:number;
  constructor(private options:StreamOptions<T>) {
    this.ahead=options.ahead??20;
    this.behind=options.behind??4;
    this.concurrency=options.concurrency??4;
  }
  reset(count:number):void {
    this.generation++;
    for(const request of this.active.values())request.abort();
    this.active.clear();this.values.clear();this.failures.clear();
    this.count=count;this.cursor=0;this.bytes=0;this.hits=0;this.misses=0;this.seekStart=0;this.seekMs=0;
    this.notify();this.pump();
  }
  get(index:number):T|undefined {return this.values.get(index)}
  get playhead():number {return this.cursor}
  get stats():StreamStats {return {resident:this.values.size,active:this.active.size,bytesRead:this.bytes,hits:this.hits,misses:this.misses,lastSeekMs:this.seekMs,failures:this.failures.size}}
  seek(index:number):void {
    if(!Number.isInteger(index)||index<0||index>=this.count||index===this.cursor)return;
    this.cursor=index;
    if(this.values.has(index)){this.hits++;this.seekMs=0;this.seekStart=0}
    else {this.misses++;this.seekStart=performance.now()}
    this.evict();
    this.pump();
    this.notify();
  }
  dispose():void {this.reset(0)}
  private inside(i:number):boolean {
    if(this.count===0)return false;
    return (i-this.cursor+this.count)%this.count<=this.ahead||(this.cursor-i+this.count)%this.count<=this.behind;
  }
  private evict():void {
    for(const i of this.values.keys())if(!this.inside(i))this.values.delete(i);
    for(const [i,request] of this.active)if(!this.inside(i)){this.active.delete(i);request.abort()}
  }
  private notify():void {this.options.onChange?.()}
  private pump():void {
    if(!this.count)return;
    const priority=[this.cursor,...Array.from({length:Math.min(this.ahead,this.count-1)},(_,i)=>(this.cursor+i+1)%this.count),...Array.from({length:Math.min(this.behind,this.count-1)},(_,i)=>(this.cursor-i-1+this.count)%this.count)];
    for(const i of new Set(priority)){
      if(this.active.size>=this.concurrency)break;
      if(this.values.has(i)||this.active.has(i)||this.failures.has(i))continue;
      const controller=new AbortController();
      const generation=this.generation;
      this.active.set(i,controller);
      void this.options.load(i,controller.signal).then(({value,bytes})=>{
        if(generation!==this.generation||controller.signal.aborted)return;
        this.bytes+=bytes;
        if(this.inside(i))this.values.set(i,value);
        if(i===this.cursor&&this.seekStart){this.seekMs=performance.now()-this.seekStart;this.seekStart=0}
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
