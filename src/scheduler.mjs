import {load,mutate} from './store.mjs';
import {RESEARCHERS} from './research-config.mjs';
import {researchStep,prepareReplacements,releaseQuotaHeld,dailyBatchStatus} from './researcher.mjs';
import {logEvent} from './orchestrator.mjs';
import {leadQuotaStatus,quotaDecision} from './lead-quota.mjs';

let timer=null;
let running=false;
const active=new Set();
const intervalMs=()=>Math.max(15000,Number(process.env.RESEARCH_TICK_SECONDS||30)*1000);

export function leadCycleStatus(){
  const db=load();
  return {
    enabled:!!db.meta?.leadCycleEnabled,
    running,
    activeResearchers:[...active],
    intervalSeconds:intervalMs()/1000,
    lastTickAt:db.meta?.leadCycleLastTickAt||null,
    quota:leadQuotaStatus(db),
    dailyBatches:Object.fromEntries(RESEARCHERS.map(agent=>[agent,dailyBatchStatus(agent,db)]))
  };
}

export function setLeadCycle(enabled){
  mutate(db=>{db.meta=db.meta||{};db.meta.leadCycleEnabled=!!enabled;db.meta.leadCycleChangedAt=new Date().toISOString()});
  logEvent('Aura','INFO',enabled?'LEAD_CYCLE_STARTED':'LEAD_CYCLE_STOPPED',enabled?'Aura started the autonomous lead cycle.':'Aura stopped the autonomous lead cycle.');
  if(enabled) queueMicrotask(()=>tick().catch(()=>{}));
  return leadCycleStatus();
}

async function runResearcher(agent){
  if(active.has(agent)) return;
  let fresh=load();
  if(fresh.agents[agent]?.status==='PAUSED') return;
  const q=quotaDecision(agent,fresh);
  if(!q.allowed){
    mutate(d=>{if(d.agents[agent]){d.agents[agent].status='QUOTA_REACHED';d.agents[agent].lastError=null;d.agents[agent].currentTask=`Monthly approved-lead quota reached (${q.status.agents[agent].used}/${q.status.agents[agent].limit}).`;d.agents[agent].lastHeartbeat=new Date().toISOString()}});
    return;
  }
  active.add(agent);
  try{
    releaseQuotaHeld(agent);
    fresh=load();
    if(!quotaDecision(agent,fresh).allowed)return;
    prepareReplacements(agent);
    mutate(d=>{if(d.agents[agent]){d.agents[agent].status='WORKING';d.agents[agent].lastError=null;d.agents[agent].lastHeartbeat=new Date().toISOString()}});
    const result=await researchStep(agent);
    mutate(d=>{if(d.agents[agent]){d.agents[agent].lastError=null;d.agents[agent].lastHeartbeat=new Date().toISOString()}});
    return result;
  }catch(e){
    mutate(d=>{if(d.agents[agent]){d.agents[agent].status='ERROR';d.agents[agent].lastError=String(e);d.agents[agent].currentTask='Research error — Aura/Steve review required.';d.agents[agent].lastHeartbeat=new Date().toISOString()}});
    logEvent(agent,'ERROR','RESEARCH_ERROR',`${agent} research step failed.`,{error:String(e)});
  }finally{active.delete(agent)}
}

export async function tick(){
  if(running) return;
  const db=load();
  if(!db.meta?.leadCycleEnabled) return;
  running=true;
  try{
    mutate(d=>{d.meta=d.meta||{};d.meta.leadCycleLastTickAt=new Date().toISOString()});
    await Promise.allSettled(RESEARCHERS.map(runResearcher));
  }finally{running=false}
}

export function startScheduler(){
  if(timer) return;
  timer=setInterval(()=>tick().catch(e=>logEvent('Aura','ERROR','SCHEDULER_ERROR','Lead scheduler tick failed.',{error:String(e)})),intervalMs());
  timer.unref?.();
}
