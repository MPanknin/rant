const node=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
export type ToolMode='inspect'|'measure'|'annotate';

/** Progressive disclosure and dialog behavior, independent of rendering and data loading. */
export function createWorkspaceUI(){
  for(const name of ['recordings','info']){
    const dialog=node<HTMLDialogElement>(name+'-dialog');
    node('open-'+name).onclick=()=>dialog.showModal();
    dialog.querySelector<HTMLButtonElement>('[data-close-dialog]')!.onclick=()=>dialog.close();
    dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close()}});
  }
  const view=node<HTMLDetailsElement>('view-options');
  document.addEventListener('pointerdown',e=>{if(!view.contains(e.target as Node))view.open=false});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&view.open){view.open=false;view.querySelector('summary')!.focus()}});
  for(const label of document.querySelectorAll<HTMLElement>('.upload'))label.addEventListener('keydown',e=>{if(e.key==='Enter'||e.code==='Space'){e.preventDefault();label.querySelector('input')!.click()}});
  return {
    setTool(mode:ToolMode){
      for(const name of ['inspect','measure','annotate']){const button=node(name+'-mode');button.classList.toggle('selected',mode===name);button.setAttribute('aria-pressed',String(mode===name))}
      node('tool-feedback').hidden=mode!=='measure';
      node('annotation-panel').hidden=mode!=='annotate';
    },
    showPoint(show:boolean){node('point-panel').hidden=!show},
    recordingLoaded(){node<HTMLDialogElement>('recordings-dialog').close();node('recording-error').hidden=true;node('point-panel').hidden=true},
    recordingError(message:string){node('recording-error').textContent=message;node('recording-error').hidden=false},
  };
}
