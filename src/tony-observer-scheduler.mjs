import {refreshTonyObservation} from './tony-observer.mjs';
import {logEvent} from './orchestrator.mjs';
let timer=null;let running=false;
const intervalMs=()=>Math.max(10000,Number(process.env.TONY_MONITOR_INTERVAL_SECONDS||20)*1000);
export async function tonyObserverTick(){if(running)return;running=true;try{return await refreshTonyObservation()}catch(e){logEvent('Aura','WARN','TONY_OBSERVER_ERROR','Tony read-only observer scan failed.',{error:String(e),readOnly:true})}finally{running=false}}
export function startTonyObserverScheduler(){if(timer)return;queueMicrotask(()=>tonyObserverTick());timer=setInterval(()=>tonyObserverTick(),intervalMs());timer.unref?.()}
