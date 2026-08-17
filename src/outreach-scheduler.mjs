import {load,mutate} from './store.mjs';
import {logEvent} from './orchestrator.mjs';
import {outreachStep} from './outreach.mjs';

let timer=null;
let running=false;
const intervalMs=()=>Math.max(15000,Number(process.env.OUTREACH_TICK_SECONDS||30)*1000);

export async function outreachTick(){
  if(running)return {skipped:true,reason:'already-running'};
  const db=load();
  if(!db.meta?.outreachCycleEnabled)return {skipped:true,reason:'disabled'};
  running=true;
  try{
    mutate(d=>{d.meta=d.meta||{};d.meta.outreachLastTickAt=new Date().toISOString();});
    return await outreachStep();
  }finally{running=false;}
}

export function startOutreachScheduler(){
  if(timer)return;
  timer=setInterval(()=>outreachTick().catch(e=>logEvent('Aura','ERROR','OUTREACH_SCHEDULER_ERROR','Phase 3 outreach scheduler failed.',{error:String(e)})),intervalMs());
  timer.unref?.();
}
