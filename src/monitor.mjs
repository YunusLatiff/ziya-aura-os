import crypto from 'node:crypto';
import {load,mutate} from './store.mjs';
import {providerStatus} from './providers.mjs';
import {smtpReady,sendSmtpMail} from './mailer.mjs';
import {logEvent} from './orchestrator.mjs';

const now=()=>new Date().toISOString();
const env=n=>String(process.env[n]||'').trim();
const minutes=n=>Number(n)*60_000;
const ageMs=v=>v?Math.max(0,Date.now()-Date.parse(v)):Infinity;
const validDate=v=>!!v&&!Number.isNaN(Date.parse(v));

export function monitorConfig(){
  const stale=Number(env('MONITOR_AGENT_STALE_MINUTES')||10);
  const batch=Number(env('MONITOR_BATCH_STALL_MINUTES')||20);
  const outbound=Number(env('MONITOR_OUTBOUND_STUCK_MINUTES')||10);
  const interval=Number(env('MONITOR_TICK_SECONDS')||60);
  const reportHour=Number(env('STEVE_AUTO_REPORT_HOUR')||17);
  return {
    staleMinutes:Number.isFinite(stale)?Math.max(2,stale):10,
    batchStallMinutes:Number.isFinite(batch)?Math.max(5,batch):20,
    outboundStuckMinutes:Number.isFinite(outbound)?Math.max(3,outbound):10,
    tickSeconds:Number.isFinite(interval)?Math.max(30,interval):60,
    reportHour:Number.isFinite(reportHour)?Math.max(0,Math.min(23,reportHour)):17,
    emailEnabled:/^(1|true|yes|on)$/i.test(env('STEVE_EMAIL_ENABLED')),
    reportEmail:env('STEVE_REPORT_EMAIL')||env('OUTBOUND_REPLY_TO')||env('OUTBOUND_FROM_EMAIL')||env('OUTBOUND_SMTP_USER')
  };
}

function incidentMap(db){return new Map((db.incidents||[]).filter(i=>i.status==='OPEN'&&i.source==='AURA_MONITOR').map(i=>[i.key,i]));}
function severityRank(s){return ({INFO:1,WARN:2,CRITICAL:3})[s]||0;}
function healthFrom(open){return open.some(i=>i.severity==='CRITICAL')?'CRITICAL':open.some(i=>i.severity==='WARN')?'DEGRADED':'HEALTHY';}

function addFinding(findings,key,severity,title,detail,data={}){findings.set(key,{key,severity,title,detail,data});}

export async function runHealthScan(){
  const db=load();
  const cfg=monitorConfig();
  const findings=new Map();
  const agents=db.agents||{};

  for(const [name,a] of Object.entries(agents)){
    if(name==='Tony'||a?.protected||a?.external)continue;
    if(a?.status==='ERROR') addFinding(findings,`agent-error:${name}`,'CRITICAL',`${name} is in ERROR`,a.lastError||a.currentTask||'Agent reported an error.',{agent:name});
    if(a?.status==='WORKING'&&validDate(a.lastHeartbeat)&&ageMs(a.lastHeartbeat)>minutes(cfg.staleMinutes)) addFinding(findings,`agent-stale:${name}`,'WARN',`${name} may be stalled`,`Working state has not heartbeated for more than ${cfg.staleMinutes} minutes.`,{agent:name,lastHeartbeat:a.lastHeartbeat});
  }

  const providers=providerStatus();
  if(providers.tavily?.budgetBlocked) addFinding(findings,'provider:tavily-budget','WARN','Tavily research budget is paused','Aura has reached or protected the configured Tavily usage budget. Geoapify/fallback discovery can continue where supported.',{usage:providers.tavily.usage||null});

  if(db.meta?.leadCycleEnabled){
    for(const b of db.leadBatches||[]){
      if(!['RESEARCHING','REWORK','FRIDAY_REVIEW'].includes(b.status))continue;
      const stamp=b.updatedAt||b.createdAt;
      if(validDate(stamp)&&ageMs(stamp)>minutes(cfg.batchStallMinutes)) addFinding(findings,`batch-stall:${b.id}`,'WARN',`${b.agent} batch #${b.batchNumber} appears stalled`,`${b.status} has not changed for more than ${cfg.batchStallMinutes} minutes.`,{batchId:b.id,agent:b.agent,batchNumber:b.batchNumber,status:b.status});
    }
  }

  const sending=(db.outboundMessages||[]).filter(m=>m.status==='SENDING');
  for(const m of sending){
    if(validDate(m.updatedAt||m.createdAt)&&ageMs(m.updatedAt||m.createdAt)>minutes(cfg.outboundStuckMinutes)) addFinding(findings,`outbound-stuck:${m.id}`,'CRITICAL',`Outbound message stuck in SENDING`,`${m.companyName||m.recipientEmail||'Message'} has remained reserved for more than ${cfg.outboundStuckMinutes} minutes. Manual review is required before retrying.`,{messageId:m.id,draftId:m.draftId,recipientEmail:m.recipientEmail});
  }

  const deliveryUnknown=(db.outboundMessages||[]).filter(m=>m.status==='DELIVERY_UNKNOWN');
  if(deliveryUnknown.length) addFinding(findings,'outbound:delivery-unknown','CRITICAL',`${deliveryUnknown.length} outbound message(s) have unknown delivery state`,'Aura recovered interrupted SENDING reservations after a restart. Automatic resend is blocked to prevent duplicate outreach; verify delivery before resolving these records.',{count:deliveryUnknown.length,messageIds:deliveryUnknown.slice(0,20).map(m=>m.id)});

  const failed24=(db.outboundMessages||[]).filter(m=>m.status==='FAILED'&&validDate(m.updatedAt||m.createdAt)&&ageMs(m.updatedAt||m.createdAt)<24*60*60_000);
  if(failed24.length) addFinding(findings,'outbound:recent-failures','WARN',`${failed24.length} outbound send failure(s) in the last 24 hours`,'Review SMTP errors and recipient validity before increasing send volume.',{count:failed24.length,latest:failed24[0]?.error||null});

  if(db.meta?.outboundCycleEnabled&&!smtpReady()) addFinding(findings,'outbound:smtp-not-ready','CRITICAL','Outbound cycle enabled without a ready SMTP configuration','Stop outbound sending or repair SMTP configuration.',{});

  const leads=db.leads||[];
  const reviewed=leads.filter(l=>['APPROVED','REWORK','REJECTED','DUPLICATE_IGNORED'].includes(l.fridayStatus));
  if(reviewed.length>=10){
    const poor=reviewed.filter(l=>['REWORK','REJECTED'].includes(l.fridayStatus)).length/reviewed.length;
    if(poor>=0.8) addFinding(findings,'quality:high-rework','WARN','Lead quality rejection/rework rate is high',`${Math.round(poor*100)}% of reviewed leads are currently rework/rejected. Tighten discovery before consuming more enrichment credits.`,{rate:poor,reviewed:reviewed.length});
  }

  const approvedBatches=(db.leadBatches||[]).filter(b=>b.readyForPepper);
  const drafts=db.emailDrafts||[];
  if(db.meta?.outreachCycleEnabled&&approvedBatches.length&&drafts.length===0) addFinding(findings,'outreach:no-drafts','WARN','Pepper has approved batches but no drafts','Run the Phase 3 outreach step and inspect Pepper if the queue remains empty.',{approvedBatches:approvedBatches.length});

  mutate(d=>{
    d.incidents=d.incidents||[];
    d.meta=d.meta||{};
    const existing=incidentMap(d);
    const scanAt=now();
    for(const f of findings.values()){
      const old=existing.get(f.key);
      if(old){old.severity=f.severity;old.title=f.title;old.detail=f.detail;old.data=f.data;old.lastSeenAt=scanAt;old.updatedAt=scanAt;}
      else d.incidents.unshift({id:crypto.randomUUID(),key:f.key,source:'AURA_MONITOR',status:'OPEN',severity:f.severity,title:f.title,detail:f.detail,data:f.data,createdAt:scanAt,updatedAt:scanAt,lastSeenAt:scanAt,resolvedAt:null});
    }
    for(const i of d.incidents){
      if(i.source==='AURA_MONITOR'&&i.status==='OPEN'&&!findings.has(i.key)){i.status='RESOLVED';i.resolvedAt=scanAt;i.updatedAt=scanAt;}
    }
    d.incidents=d.incidents.slice(0,500);
    d.meta.monitorLastScanAt=scanAt;
    const open=d.incidents.filter(i=>i.source==='AURA_MONITOR'&&i.status==='OPEN');
    d.meta.monitorHealth=healthFrom(open);
    if(d.agents?.Aura){d.agents.Aura.lastHeartbeat=scanAt;}
    if(d.agents?.Steve&&d.agents.Steve.status!=='PAUSED'&&d.agents.Steve.status!=='ERROR'){
      d.agents.Steve.status=open.length?'WORKING':'WAITING';
      d.agents.Steve.currentTask=open.length?`Reviewing ${open.length} open operational incident(s).`:'System healthy — waiting for operational changes.';
      d.agents.Steve.lastHeartbeat=scanAt;
      d.agents.Steve.lastError=null;
    }
  });

  const fresh=load();
  const open=(fresh.incidents||[]).filter(i=>i.source==='AURA_MONITOR'&&i.status==='OPEN').sort((a,b)=>severityRank(b.severity)-severityRank(a.severity));
  return {health:healthFrom(open),openCount:open.length,critical:open.filter(i=>i.severity==='CRITICAL').length,warnings:open.filter(i=>i.severity==='WARN').length,lastScanAt:fresh.meta?.monitorLastScanAt||null,incidents:open};
}

function recommendations(db,open){
  const rec=[];
  if(open.some(i=>i.key.startsWith('agent-error:')))rec.push('Resolve agent ERROR states before increasing autonomous workload.');
  if(open.some(i=>i.key==='provider:tavily-budget'))rec.push('Keep Tavily enrichment selective; continue cheaper discovery paths until credits reset.');
  if(open.some(i=>i.key==='quality:high-rework'))rec.push('Tighten candidate pre-filters and source matching to improve Friday approval rate.');
  if(open.some(i=>i.key.startsWith('outbound:')||i.key.startsWith('outbound-stuck:')))rec.push('Hold outbound volume until SMTP/send-state issues are cleared.');
  const ready=(db.emailDrafts||[]).filter(d=>d.status==='APPROVED').length;
  if(ready&&!db.meta?.outboundCycleEnabled)rec.push(`${ready} Ultron-approved draft(s) are waiting; use controlled outbound when you are ready.`);
  if(!rec.length)rec.push('No material operational intervention is required. Continue current cycles and review quality metrics periodically.');
  return rec;
}

export async function generateSteveReport({runScan=true}={}){
  if(runScan)await runHealthScan();
  const db=load();
  const open=(db.incidents||[]).filter(i=>i.source==='AURA_MONITOR'&&i.status==='OPEN').sort((a,b)=>severityRank(b.severity)-severityRank(a.severity));
  const leads=db.leads||[], drafts=db.emailDrafts||[], msgs=db.outboundMessages||[];
  const health=healthFrom(open);
  const rec=recommendations(db,open);
  const lines=[
    `ZIYA ENERGY — STEVE OPERATIONS REPORT`,
    `Generated: ${new Date().toLocaleString('en-ZA')}`,
    `System health: ${health}`,
    '',
    `PIPELINE`,
    `Leads discovered: ${leads.length}`,
    `Friday approved leads: ${leads.filter(l=>l.fridayStatus==='APPROVED').length}`,
    `Global registry: ${(db.leadRegistry||[]).length}`,
    `Pepper drafts: ${drafts.length}`,
    `Ultron approved drafts: ${drafts.filter(d=>d.status==='APPROVED').length}`,
    `Emails sent: ${msgs.filter(m=>m.status==='SENT').length}`,
    `Send failures: ${msgs.filter(m=>m.status==='FAILED').length}`,
    '',
    `OPEN INCIDENTS (${open.length})`,
    ...(open.length?open.map(i=>`[${i.severity}] ${i.title} — ${i.detail}`):['None']),
    '',
    `STEVE RECOMMENDATIONS`,
    ...rec.map((x,i)=>`${i+1}. ${x}`)
  ];
  const report={id:crypto.randomUUID(),createdAt:now(),health,openIncidentCount:open.length,recommendations:rec,body:lines.join('\n')};
  mutate(d=>{d.steveReports=d.steveReports||[];d.steveReports.unshift(report);d.steveReports=d.steveReports.slice(0,100);d.meta=d.meta||{};d.meta.steveLastReportAt=report.createdAt;if(d.agents?.Steve){d.agents.Steve.status='WAITING';d.agents.Steve.currentTask='Latest operations report compiled.';d.agents.Steve.lastHeartbeat=report.createdAt;}});
  logEvent('Steve','INFO','STEVE_REPORT','Steve compiled an operational report.',{reportId:report.id,health,openIncidents:open.length});
  return report;
}

export async function emailSteveReport(reportId=null){
  const cfg=monitorConfig();
  if(!cfg.emailEnabled)throw new Error('Steve email reports are locked. Set STEVE_EMAIL_ENABLED=true in Aura .env first.');
  if(!smtpReady())throw new Error('SMTP is not configured for Steve reports.');
  if(!cfg.reportEmail)throw new Error('STEVE_REPORT_EMAIL is not configured.');
  const db=load();
  let report=reportId?(db.steveReports||[]).find(r=>r.id===reportId):(db.steveReports||[])[0];
  if(!report)report=await generateSteveReport();
  const result=await sendSmtpMail({toEmail:cfg.reportEmail,toName:'Ziya Energy Operations',subject:`Steve Operations Report — ${report.health}`,body:report.body});
  mutate(d=>{const r=(d.steveReports||[]).find(x=>x.id===report.id);if(r){r.emailedAt=now();r.emailMessageId=result.messageId;}});
  logEvent('Steve','INFO','STEVE_REPORT_EMAIL','Steve emailed the latest operational report.',{reportId:report.id,to:cfg.reportEmail,messageId:result.messageId});
  return {ok:true,reportId:report.id,to:cfg.reportEmail,messageId:result.messageId};
}

export function monitoringStatus(){
  const db=load(), cfg=monitorConfig();
  const open=(db.incidents||[]).filter(i=>i.source==='AURA_MONITOR'&&i.status==='OPEN').sort((a,b)=>severityRank(b.severity)-severityRank(a.severity));
  return {health:db.meta?.monitorHealth||healthFrom(open),lastScanAt:db.meta?.monitorLastScanAt||null,openCount:open.length,critical:open.filter(i=>i.severity==='CRITICAL').length,warnings:open.filter(i=>i.severity==='WARN').length,incidents:open.slice(0,30),reports:(db.steveReports||[]).slice(0,20),lastReportAt:db.meta?.steveLastReportAt||null,emailEnabled:cfg.emailEnabled,emailReady:cfg.emailEnabled&&smtpReady()&&!!cfg.reportEmail,reportEmail:cfg.reportEmail||'',tickSeconds:cfg.tickSeconds,autoReportHour:cfg.reportHour};
}
