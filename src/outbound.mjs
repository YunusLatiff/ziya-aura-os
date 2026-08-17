import crypto from 'node:crypto';
import {load,mutate} from './store.mjs';
import {logEvent} from './orchestrator.mjs';
import {smtpReady,sendSmtpMail,smtpConfig} from './mailer.mjs';
import {syncLegacyAuraData} from './crm.mjs';

const now=()=>new Date().toISOString();
const env=name=>String(process.env[name]||'').trim();
const bool=(name,def=false)=>{const v=env(name).toLowerCase();return v?['1','true','yes','on'].includes(v):def};
const num=(name,def)=>{const n=Number(env(name));return Number.isFinite(n)&&n>=0?n:def};
const emailOk=s=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||'').trim());
const canonicalEmail=s=>String(s||'').trim().toLowerCase();

export function outboundConfig(){
  return {
    enabledByConfig:bool('OUTBOUND_ENABLED',false),
    smtpReady:smtpReady(),
    dailyLimit:Math.max(1,Math.floor(num('OUTBOUND_DAILY_LIMIT',20))),
    minSecondsBetween:Math.max(10,Math.floor(num('OUTBOUND_MIN_SECONDS_BETWEEN',90))),
    batchLimit:Math.max(1,Math.floor(num('OUTBOUND_BATCH_LIMIT',5))),
    fromEmail:smtpConfig().fromEmail||'',
    fromName:smtpConfig().fromName||''
  };
}

function startOfToday(){const d=new Date();d.setHours(0,0,0,0);return d.getTime()}
function sentToday(db){return (db.outboundMessages||[]).filter(m=>m.status==='SENT'&&new Date(m.sentAt||m.createdAt).getTime()>=startOfToday()).length}
function lastSentMs(db){const sent=(db.outboundMessages||[]).filter(m=>m.status==='SENT'&&m.sentAt).map(m=>new Date(m.sentAt).getTime()).filter(Number.isFinite);return sent.length?Math.max(...sent):0}
function dncSet(db){return new Set((db.doNotContact||[]).map(x=>canonicalEmail(typeof x==='string'?x:x.email)).filter(Boolean))}
const deliveryBlockingStatuses=new Set(['SENT','SENDING','DELIVERY_UNKNOWN']);
function alreadySentLead(db,leadId){return (db.outboundMessages||[]).some(m=>m.leadId===leadId&&deliveryBlockingStatuses.has(m.status))}
function alreadySentEmail(db,email){const e=canonicalEmail(email);return (db.outboundMessages||[]).some(m=>canonicalEmail(m.recipientEmail)===e&&deliveryBlockingStatuses.has(m.status))}

export function eligibleOutboundDrafts(db=load()){
  const dnc=dncSet(db);
  const leads=new Map((db.leads||[]).map(l=>[l.id,l]));
  return (db.emailDrafts||[]).filter(d=>{
    const lead=leads.get(d.leadId);
    const email=canonicalEmail(d.recipientEmail||lead?.email);
    return d.status==='APPROVED' && lead?.fridayStatus==='APPROVED' && emailOk(email) && !dnc.has(email) && !alreadySentLead(db,d.leadId) && !alreadySentEmail(db,email);
  });
}

export function outboundStatus(){
  const db=load();const cfg=outboundConfig();const today=sentToday(db);const queue=eligibleOutboundDrafts(db);
  const last=lastSentMs(db);const waitMs=last?Math.max(0,cfg.minSecondsBetween*1000-(Date.now()-last)):0;
  return {
    enabled:!!db.meta?.outboundCycleEnabled,
    configured:cfg.enabledByConfig&&cfg.smtpReady,
    smtpReady:cfg.smtpReady,
    configEnabled:cfg.enabledByConfig,
    fromEmail:cfg.fromEmail,
    fromName:cfg.fromName,
    dailyLimit:cfg.dailyLimit,
    sentToday:today,
    remainingToday:Math.max(0,cfg.dailyLimit-today),
    minSecondsBetween:cfg.minSecondsBetween,
    waitSeconds:Math.ceil(waitMs/1000),
    queued:queue.length,
    sentTotal:(db.outboundMessages||[]).filter(m=>m.status==='SENT').length,
    failedTotal:(db.outboundMessages||[]).filter(m=>m.status==='FAILED').length,
    sendingTotal:(db.outboundMessages||[]).filter(m=>m.status==='SENDING').length,
    deliveryUnknownTotal:(db.outboundMessages||[]).filter(m=>m.status==='DELIVERY_UNKNOWN').length,
    dncCount:(db.doNotContact||[]).length,
    lastTickAt:db.meta?.outboundLastTickAt||null
  };
}


export function recoverInterruptedOutboundReservations({olderThanMinutes=null}={}){
  const configured=num('OUTBOUND_INTERRUPTED_MINUTES',10);
  const threshold=Math.max(1,Number.isFinite(Number(olderThanMinutes))?Number(olderThanMinutes):configured);
  const cutoff=Date.now()-threshold*60_000;
  const recovered=[];
  mutate(db=>{
    db.outboundMessages=db.outboundMessages||[];
    for(const m of db.outboundMessages){
      if(m.status!=='SENDING')continue;
      const stamp=Date.parse(m.updatedAt||m.createdAt||0);
      if(!Number.isFinite(stamp)||stamp>cutoff)continue;
      m.status='DELIVERY_UNKNOWN';
      m.recoveryAt=now();
      m.updatedAt=m.recoveryAt;
      m.error=`Aura restarted while this message was reserved as SENDING for more than ${threshold} minute(s). Delivery is unknown; automatic retry is blocked to prevent a duplicate email.`;
      const d=(db.emailDrafts||[]).find(x=>x.id===m.draftId);
      if(d){d.status='DELIVERY_UNKNOWN';d.lastSendError=m.error;d.updatedAt=m.recoveryAt;}
      recovered.push({id:m.id,draftId:m.draftId,leadId:m.leadId,recipientEmail:m.recipientEmail,companyName:m.companyName});
    }
  });
  if(recovered.length){
    logEvent('Aura','ERROR','OUTBOUND_RECOVERY_REQUIRED',`${recovered.length} interrupted outbound message(s) moved to DELIVERY_UNKNOWN. Automatic resend is blocked pending review.`,{count:recovered.length,messageIds:recovered.map(x=>x.id)});
  }
  return {count:recovered.length,messages:recovered,thresholdMinutes:threshold};
}


export function deliveryUnknownMessages(){
  const db=load();
  return (db.outboundMessages||[]).filter(m=>m.status==='DELIVERY_UNKNOWN').map(m=>({
    id:m.id,draftId:m.draftId,leadId:m.leadId,companyName:m.companyName||'',recipientEmail:m.recipientEmail||'',subject:m.subject||'',createdAt:m.createdAt||null,recoveryAt:m.recoveryAt||null,error:m.error||null
  }));
}

export function resolveDeliveryUnknown(messageId,resolution){
  const action=String(resolution||'').trim().toUpperCase();
  if(!['MARK_SENT','RELEASE_FOR_RETRY'].includes(action))throw new Error('Resolution must be MARK_SENT or RELEASE_FOR_RETRY.');
  let result=null;
  mutate(db=>{
    const m=(db.outboundMessages||[]).find(x=>x.id===messageId);
    if(!m)throw new Error('Outbound message not found.');
    if(m.status!=='DELIVERY_UNKNOWN')throw new Error(`Message is ${m.status}, not DELIVERY_UNKNOWN.`);
    const stamp=now();
    const d=(db.emailDrafts||[]).find(x=>x.id===m.draftId);
    const l=(db.leads||[]).find(x=>x.id===m.leadId);
    if(action==='MARK_SENT'){
      m.status='SENT';m.sentAt=m.sentAt||stamp;m.updatedAt=stamp;m.deliveryResolution='VERIFIED_SENT';m.resolvedAt=stamp;m.error=null;
      if(d){d.status='SENT';d.sentAt=d.sentAt||stamp;d.updatedAt=stamp;d.lastSendError=null;}
      if(l){l.contactedAt=l.contactedAt||stamp;l.outreachStatus='CONTACTED';l.updatedAt=stamp;}
    }else{
      m.status='RETRY_RELEASED';m.updatedAt=stamp;m.deliveryResolution='VERIFIED_NOT_SENT';m.resolvedAt=stamp;
      if(d){d.status='APPROVED';d.updatedAt=stamp;d.lastSendError=null;}
    }
    result={ok:true,messageId:m.id,resolution:action,status:m.status,draftStatus:d?.status||null};
  });
  logEvent('Aura','WARN','OUTBOUND_DELIVERY_RESOLVED',action==='MARK_SENT'?'Interrupted outbound message was manually verified as sent.':'Interrupted outbound message was manually verified as not sent and released for controlled retry.',{messageId,resolution:action});
  return result;
}

export function setOutboundCycle(enabled){
  const cfg=outboundConfig();
  if(enabled&&!cfg.enabledByConfig)throw new Error('Outbound sending is locked. Set OUTBOUND_ENABLED=true in Aura .env first.');
  if(enabled&&!cfg.smtpReady)throw new Error('Outbound SMTP is not fully configured.');
  mutate(db=>{db.meta=db.meta||{};db.meta.outboundCycleEnabled=!!enabled;db.meta.outboundChangedAt=now();});
  logEvent('Aura','INFO',enabled?'OUTBOUND_STARTED':'OUTBOUND_STOPPED',enabled?'Aura enabled controlled Phase 4 outbound sending.':'Aura stopped Phase 4 outbound sending.');
  return outboundStatus();
}

export function addDoNotContact(email,reason='Manual do-not-contact'){
  const e=canonicalEmail(email);if(!emailOk(e))throw new Error('A valid email address is required.');
  mutate(db=>{db.doNotContact=db.doNotContact||[];if(!db.doNotContact.some(x=>canonicalEmail(typeof x==='string'?x:x.email)===e))db.doNotContact.push({email:e,reason,createdAt:now()});});
  logEvent('Aura','INFO','DO_NOT_CONTACT_ADDED',`${e} added to do-not-contact list.`,{email:e,reason});
  return {ok:true,email:e};
}

function reserveMessage(draft,lead){
  const message={id:crypto.randomUUID(),draftId:draft.id,leadId:lead.id,batchId:draft.batchId||lead.batchId||null,companyName:draft.companyName||lead.companyName||'',recipientName:draft.recipientName||lead.contactPerson||'',recipientEmail:canonicalEmail(draft.recipientEmail||lead.email),subject:draft.subject,status:'SENDING',attempts:1,messageId:draft.smtpMessageId||`<${crypto.randomUUID()}@ziyaenergy.local>`,createdAt:now(),updatedAt:now(),sentAt:null,error:null};
  mutate(db=>{db.outboundMessages=db.outboundMessages||[];db.outboundMessages.unshift(message);const d=(db.emailDrafts||[]).find(x=>x.id===draft.id);if(d){d.status='SENDING';d.smtpMessageId=message.messageId;d.updatedAt=now();}if(db.agents?.Pepper){db.agents.Pepper.status='WORKING';db.agents.Pepper.currentTask=`Sending Ultron-approved outreach to ${message.companyName}`;db.agents.Pepper.lastError=null;db.agents.Pepper.lastHeartbeat=now();}});
  return message;
}

function markSent(messageId){
  mutate(db=>{const m=(db.outboundMessages||[]).find(x=>x.id===messageId);if(!m)return;m.status='SENT';m.sentAt=now();m.updatedAt=now();const d=(db.emailDrafts||[]).find(x=>x.id===m.draftId);if(d){d.status='SENT';d.sentAt=m.sentAt;d.updatedAt=now();}const l=(db.leads||[]).find(x=>x.id===m.leadId);if(l){l.contactedAt=m.sentAt;l.outreachStatus='CONTACTED';l.updatedAt=now();}});
}

function markFailed(messageId,error){
  mutate(db=>{const m=(db.outboundMessages||[]).find(x=>x.id===messageId);if(!m)return;m.status='FAILED';m.error=String(error);m.updatedAt=now();const d=(db.emailDrafts||[]).find(x=>x.id===m.draftId);if(d){d.status='SEND_FAILED';d.lastSendError=String(error);d.updatedAt=now();}if(db.agents?.Pepper){db.agents.Pepper.status='ERROR';db.agents.Pepper.currentTask='Outbound send failed — Aura review required.';db.agents.Pepper.lastError=String(error);db.agents.Pepper.lastHeartbeat=now();}});
}

export async function sendOneApproved(){
  const cfg=outboundConfig();if(!cfg.enabledByConfig)throw new Error('OUTBOUND_ENABLED is false.');if(!cfg.smtpReady)throw new Error('Outbound SMTP is not configured.');
  const db=load();if(sentToday(db)>=cfg.dailyLimit)return {sent:0,blocked:'DAILY_LIMIT'};
  const last=lastSentMs(db);if(last&&Date.now()-last<cfg.minSecondsBetween*1000)return {sent:0,blocked:'RATE_LIMIT',waitSeconds:Math.ceil((cfg.minSecondsBetween*1000-(Date.now()-last))/1000)};
  const draft=eligibleOutboundDrafts(db)[0];if(!draft)return {sent:0,blocked:'EMPTY_QUEUE'};
  const lead=(db.leads||[]).find(l=>l.id===draft.leadId);if(!lead)return {sent:0,blocked:'LEAD_NOT_FOUND'};
  const msg=reserveMessage(draft,lead);
  try{
    const result=await sendSmtpMail({toEmail:msg.recipientEmail,toName:msg.recipientName,subject:draft.subject,body:draft.body,messageId:msg.messageId});
    markSent(msg.id);
    syncLegacyAuraData();
    logEvent('Pepper','INFO','OUTBOUND_SENT',`Pepper sent Ultron-approved outreach to ${msg.companyName}.`,{leadId:lead.id,draftId:draft.id,messageId:result.messageId,recipientEmail:msg.recipientEmail});
    mutate(x=>{if(x.agents?.Pepper){x.agents.Pepper.status='WAITING';x.agents.Pepper.currentTask='Waiting for next approved outbound message.';x.agents.Pepper.lastError=null;x.agents.Pepper.lastHeartbeat=now();}});
    return {sent:1,messageId:result.messageId,companyName:msg.companyName,recipientEmail:msg.recipientEmail};
  }catch(e){markFailed(msg.id,e);syncLegacyAuraData();logEvent('Pepper','ERROR','OUTBOUND_FAILED',`Pepper failed to send outreach to ${msg.companyName}.`,{leadId:lead.id,draftId:draft.id,error:String(e)});throw e;}
}

export async function outboundStep(){
  mutate(db=>{db.meta=db.meta||{};db.meta.outboundLastTickAt=now();});
  const st=outboundStatus();if(!st.enabled)return {sent:0,blocked:'STOPPED'};if(!st.configured)return {sent:0,blocked:'NOT_CONFIGURED'};if(st.remainingToday<=0)return {sent:0,blocked:'DAILY_LIMIT'};if(st.waitSeconds>0)return {sent:0,blocked:'RATE_LIMIT',waitSeconds:st.waitSeconds};
  return sendOneApproved();
}
