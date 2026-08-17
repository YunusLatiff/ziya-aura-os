import {outboundStep} from './outbound.mjs';
import {logEvent} from './orchestrator.mjs';
let timer=null,running=false;
const intervalMs=()=>Math.max(15000,Number(process.env.OUTBOUND_TICK_SECONDS||30)*1000);
export async function outboundTick(){if(running)return;running=true;try{return await outboundStep()}catch(e){logEvent('Aura','ERROR','OUTBOUND_SCHEDULER_ERROR','Controlled outbound tick failed.',{error:String(e)});return {sent:0,error:String(e)}}finally{running=false}}
export function startOutboundScheduler(){if(timer)return;timer=setInterval(()=>outboundTick(),intervalMs());timer.unref?.()}
