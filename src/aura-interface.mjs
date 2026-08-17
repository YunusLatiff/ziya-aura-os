import crypto from 'node:crypto';
import {load,mutate} from './store.mjs';
import {command,snapshot,logEvent} from './orchestrator.mjs';
import {setLeadCycle,leadCycleStatus,tick} from './scheduler.mjs';
import {setOutreachCycle,outreachStatus,outreachStep} from './outreach.mjs';
import {setOutboundCycle,outboundStatus,sendOneApproved} from './outbound.mjs';
import {monitoringStatus,runHealthScan,generateSteveReport,emailSteveReport} from './monitor.mjs';
import {answerCrmQuestion,crmSummary} from './crm.mjs';
import {leadQuotaStatus} from './lead-quota.mjs';
import {providerStatus} from './providers.mjs';

const AGENT_NAMES=['Aura','Steve','Friday','Ultron','Vision','Peter','MJ','Pepper','Tony'];

function normalise(s=''){
  return String(s).toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9@.\s-]/g,' ').replace(/\s+/g,' ').trim();
}
function titleCaseAgent(text=''){
  const n=normalise(text);
  return AGENT_NAMES.find(a=>normalise(a)===n)||null;
}
function record(text,reply,action='INFO',ok=true,data={}){
  const row={id:crypto.randomUUID(),createdAt:new Date().toISOString(),text:String(text),reply:String(reply),action,ok,data};
  mutate(db=>{db.auraCommandHistory=db.auraCommandHistory||[];db.auraCommandHistory.unshift(row);db.auraCommandHistory=db.auraCommandHistory.slice(0,200)});
  logEvent('Aura',ok?'INFO':'WARN','AURA_INTERFACE',reply,{command:text,action,...data});
  return row;
}
function pipelineReply(){
  const s=snapshot(),p=s.pipeline||{},crm=crmSummary();
  const m=monitoringStatus(),o=outreachStatus(),ob=outboundStatus();
  return `Current status: ${p.discovered||0} leads discovered, ${crm.open||0} open CRM opportunities, ${crm.qualified||0} qualified or progressing, ${crm.proposals||0} at proposal-ready or later stages, and ${crm.companies||0} unique companies in the lead database. Pepper has sent ${ob.sentTotal||0} controlled emails. System health is ${m.health||'UNKNOWN'} with ${m.openCount||0} open incident(s).`;
}
function agentReply(agent){
  const db=load();const a=db.agents?.[agent];
  if(!a)return `I cannot find agent ${agent}.`;
  return `${agent} is ${a.status}. ${a.currentTask||'No current task.'}${a.lastError?` Latest error: ${a.lastError}`:''}`;
}
function incidentReply(){
  const m=monitoringStatus();const items=(m.incidents||[]).slice(0,5);
  if(!items.length)return `System health is ${m.health||'HEALTHY'}. There are no open incidents.`;
  return `System health is ${m.health||'DEGRADED'} with ${m.openCount||items.length} open incident(s). Top issues: ${items.map(i=>`${i.severity}: ${i.title}`).join('; ')}.`;
}
function helpReply(){
  return 'You can ask about the CRM pipeline, lead database, pipeline value, source performance, proposal status, Pepper outreach, system status, agent status, open incidents, or say: start/stop lead cycle, start/stop Pepper and Ultron, run outreach once, start/stop sending, send one approved, run health scan, generate Steve report, email Steve report, pause <agent>, or resume <agent>. Tony is protected and cannot be commanded.';
}

export function commandHistory(limit=40){return (load().auraCommandHistory||[]).slice(0,Math.max(1,Math.min(200,Number(limit)||40)))}

export async function executeAuraCommand(input=''){
  const text=String(input||'').trim();const n=normalise(text);
  if(!n)return record(text,'I did not receive a command.','INVALID',false);

  if(/^(help|commands|what can you do)$/.test(n))return record(text,helpReply(),'HELP');
  if(/(lead|approved).*(quota|cap|this month|monthly)|how many leads.*month/.test(n)){
    const q=leadQuotaStatus();const a=q.agents;
    return record(text,`This month we have ${q.global.used} of ${q.global.limit} approved leads. Vision is ${a.Vision.used}/${a.Vision.limit}, Peter ${a.Peter.used}/${a.Peter.limit}, and MJ ${a.MJ.used}/${a.MJ.limit}.`,'LEAD_QUOTA');
  }
  if(/tavily/.test(n)&&/(usage|credit|cap|limit|remaining|budget)/.test(n)){
    const t=providerStatus().tavily,u=t.usage;
    if(!t.configured)return record(text,'Tavily is not configured.','TAVILY_STATUS',false);
    if(!u)return record(text,`Tavily is configured with a hard monthly cap of ${t.monthlyCreditCap||900} credits, but usage has not been refreshed yet.`,'TAVILY_STATUS');
    return record(text,`Tavily has used ${u.usage} credits. Aura will hard-stop Tavily at ${t.monthlyCreditCap||900} credits this month. ${t.budgetBlocked?'Tavily research is currently paused.':`${Math.max(0,(t.monthlyCreditCap||900)-u.usage)} credits remain before the Aura hard stop.`}`,'TAVILY_STATUS');
  }
  const crmAnswer=answerCrmQuestion(text);if(crmAnswer)return record(text,crmAnswer,'CRM_QUERY');
  if(/^(status|system status|overview|what is happening|whats happening|what is going on)$/.test(n))return record(text,pipelineReply(),'STATUS');
  if(/incident|problem|issue|wrong|health/.test(n)&&!/^run health scan/.test(n))return record(text,incidentReply(),'INCIDENT_STATUS');

  const statusAgent=n.match(/(?:status of|how is|whats|what is)\s+(aura|steve|friday|ultron|vision|peter|mj|pepper|tony)/);
  if(statusAgent){const a=titleCaseAgent(statusAgent[1]);return record(text,agentReply(a),'AGENT_STATUS',true,{agent:a})}

  const agentCmd=n.match(/^(pause|resume)\s+(aura|steve|friday|ultron|vision|peter|mj|pepper|tony)$/);
  if(agentCmd){
    const action=agentCmd[1].toUpperCase(),target=titleCaseAgent(agentCmd[2]);
    if(target==='Tony')return record(text,'Tony is protected and external. I will not pause, resume, modify, or command Tony.','PROTECTED',false,{target});
    const result=command('Aura',target,action,{});
    return record(text,result.allowed?`${target} ${action==='PAUSE'?'paused':'resumed'}.`:`Command refused: ${result.reason}`,`${action}_${target}`,result.allowed,{target});
  }

  if(/^(start|enable) (the )?lead cycle$/.test(n)){const r=setLeadCycle(true);return record(text,'Lead cycle started.','LEAD_START',true,r)}
  if(/^(stop|disable) (the )?lead cycle$/.test(n)){const r=setLeadCycle(false);return record(text,'Lead cycle stopped.','LEAD_STOP',true,r)}
  if(/^(run|tick) (the )?lead cycle( once)?$/.test(n)){await tick();return record(text,'Lead research cycle ran once.','LEAD_RUN_ONCE')}

  if(/^(start|enable) (pepper( and| &) ultron|outreach|outreach cycle)$/.test(n)){const r=setOutreachCycle(true);return record(text,'Pepper and Ultron outreach cycle started.','OUTREACH_START',true,r)}
  if(/^(stop|disable) (pepper( and| &) ultron|outreach|outreach cycle)$/.test(n)){const r=setOutreachCycle(false);return record(text,'Pepper and Ultron outreach cycle stopped.','OUTREACH_STOP',true,r)}
  if(/^(run )?(outreach|pepper( and| &) ultron)( once)?$/.test(n)){const r=await outreachStep();return record(text,`Outreach processing completed. ${r?.processed??0} item(s) processed.`,'OUTREACH_ONCE',true,r||{})}

  if(/^(start|enable) (sending|outbound|outbound sending)$/.test(n)){
    try{const r=setOutboundCycle(true);return record(text,'Controlled outbound sending started.','OUTBOUND_START',true,r)}catch(e){return record(text,`I could not start outbound sending: ${String(e.message||e)}`,'OUTBOUND_START',false)}
  }
  if(/^(stop|disable) (sending|outbound|outbound sending)$/.test(n)){const r=setOutboundCycle(false);return record(text,'Controlled outbound sending stopped.','OUTBOUND_STOP',true,r)}
  if(/^(send one|send one approved|send one approved email|test one email)$/.test(n)){
    try{const r=await sendOneApproved();if(r?.blocked)return record(text,`Send blocked: ${r.blocked}${r.waitSeconds?` Wait ${r.waitSeconds} seconds.`:''}`,'SEND_ONE',false,r);return record(text,`One approved email was sent${r?.companyName?` for ${r.companyName}`:''}.`,'SEND_ONE',true,r||{})}catch(e){return record(text,`I could not send an approved email: ${String(e.message||e)}`,'SEND_ONE',false)}
  }

  if(/^run (a )?health scan$/.test(n)){const r=await runHealthScan();return record(text,`Health scan complete. System health: ${r.health||monitoringStatus().health||'UNKNOWN'}.`,'HEALTH_SCAN',true,r||{})}
  if(/^(generate|create) (a )?steve report$/.test(n)){const r=await generateSteveReport();return record(text,`Steve report generated. Health: ${r.health||'UNKNOWN'}.`,'STEVE_REPORT',true,{reportId:r.id})}
  if(/^(email|send) (the )?(latest )?steve report$/.test(n)){try{const r=await emailSteveReport(null);return record(text,`Steve report emailed${r.to?` to ${r.to}`:''}.`,'STEVE_EMAIL',true,r)}catch(e){return record(text,`I could not email Steve's report: ${String(e.message||e)}`,'STEVE_EMAIL',false)}}

  if(/^(show|list) (approved )?leads$/.test(n)){
    const db=load();const ls=(db.leads||[]).filter(x=>x.fridayStatus==='APPROVED').slice(0,10);
    return record(text,ls.length?`Friday-approved leads: ${ls.map(x=>x.companyName).join(', ')}.`:'There are no Friday-approved leads yet.','LIST_APPROVED');
  }
  if(/^(show|list) (ultron )?(approved )?drafts$/.test(n)){
    const db=load();const ds=(db.emailDrafts||[]).filter(x=>x.status==='APPROVED').slice(0,10);
    return record(text,ds.length?`Ultron-approved drafts: ${ds.map(x=>x.companyName||x.recipientEmail).join(', ')}.`:'There are no Ultron-approved drafts yet.','LIST_DRAFTS');
  }

  return record(text,`I did not recognise that command. ${helpReply()}`,'UNKNOWN',false);
}
