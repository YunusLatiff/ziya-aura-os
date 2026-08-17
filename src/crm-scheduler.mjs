import {syncLegacyAuraData} from './crm.mjs';
let timer=null;let running=false;
export async function crmSyncTick(){if(running)return {skipped:true};running=true;try{return syncLegacyAuraData()}finally{running=false}}
export function startCrmScheduler(){if(timer)return timer;queueMicrotask(()=>crmSyncTick().catch(()=>{}));timer=setInterval(()=>crmSyncTick().catch(()=>{}),10000);timer.unref?.();return timer}
