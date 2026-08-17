import crypto from 'node:crypto';
import path from 'node:path';
import {load} from './store.mjs';
import {loadCrm,mutateCrm,saveCrm} from './crm-store.mjs';

const now=()=>new Date().toISOString();
export const CRM_SOURCES=Object.freeze(['Natasha','Vision','Peter','MJ','Pepper','External Channel Partner','Direct / Organic','Referral','Other']);
export const CRM_STAGES=Object.freeze(['DISCOVERED','FRIDAY_REVIEW','APPROVED','OUTREACH','ENGAGED','QUALIFYING','AWAITING_INFORMATION','DOCUMENTS_COMPLETE','READY_FOR_TONY','TONY_PROCESSING','PROPOSAL_READY','OWNER_REVIEW','PROPOSAL_PRESENTED','NEGOTIATION','WON','LOST','ON_HOLD','REWORK','REJECTED','DUPLICATE','DISQUALIFIED','DO_NOT_CONTACT']);
const ACTIVE_STAGES=new Set(CRM_STAGES.filter(x=>!['WON','LOST','REJECTED','DUPLICATE','DISQUALIFIED','DO_NOT_CONTACT'].includes(x)));
const LEGACY_MANAGED_STAGES=new Set(['DISCOVERED','FRIDAY_REVIEW','APPROVED','OUTREACH','REWORK','REJECTED','DUPLICATE']);
const TONY_MANAGED_STAGES=new Set(['DOCUMENTS_COMPLETE','READY_FOR_TONY','TONY_PROCESSING','PROPOSAL_READY']);
const RESEARCHERS=new Set(['Vision','Peter','MJ']);
const ACTORS=new Set(['Owner','Aura','Steve','Friday','Ultron','Vision','Peter','MJ','Pepper','Natasha','Wanda','TonyObserver','CRM']);

function norm(v=''){return String(v||'').toLowerCase().replace(/https?:\/\/(www\.)?/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function stable(prefix,...parts){return `${prefix}-${crypto.createHash('sha1').update(parts.map(norm).join('|')).digest('hex').slice(0,12).toUpperCase()}`}
function clean(v){return v==null?'':String(v).trim()}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function same(a,b){return norm(a)===norm(b)}
function jsonClone(v){return JSON.parse(JSON.stringify(v??null))}
function requireActor(actor){if(actor==='Tony')throw new Error('Tony has no CRM access. Tony remains protected and external.');if(!ACTORS.has(actor))throw new Error(`Unknown CRM actor: ${actor}`)}
function pushUnique(db,collection,row,key='id'){const list=db[collection]||(db[collection]=[]);const idx=list.findIndex(x=>x[key]===row[key]);if(idx>=0)list[idx]={...list[idx],...row};else list.unshift(row);return idx>=0?list[idx]:row}
function activity(db,{actor='CRM',type='NOTE',summary,companyId=null,opportunityId=null,details={},externalKey=null,createdAt=null}){
  requireActor(actor);if(externalKey&&db.activities.some(x=>x.externalKey===externalKey))return null;
  const row={id:crypto.randomUUID(),companyId,opportunityId,actor,type,summary:clean(summary)||type,details:jsonClone(details)||{},externalKey:externalKey||null,createdAt:createdAt||now(),immutable:true};
  db.activities.unshift(row);return row;
}
function audit(db,actor,action,targetType,targetId,before,after,reason=''){
  return activity(db,{actor,type:'AUDIT',summary:`${actor} ${action} ${targetType} ${targetId}`,companyId:targetType==='company'?targetId:null,opportunityId:targetType==='opportunity'?targetId:null,details:{action,targetType,targetId,before:jsonClone(before),after:jsonClone(after),reason}})
}
function companyMatch(db,lead){
  const domain=norm(lead.website||'');const name=norm(lead.companyName||'');const address=norm(lead.address||'');
  return db.companies.find(c=>(domain&&norm(c.website)===domain)||(name&&address&&norm(c.name)===name&&norm(c.primaryAddress)===address)||(name&&norm(c.name)===name))||null;
}
function stageForLead(lead,draft=null,message=null){
  if(message?.status==='SENT')return 'OUTREACH';
  if(draft)return 'OUTREACH';
  const s=String(lead.fridayStatus||'PENDING');
  if(s==='APPROVED')return 'APPROVED';if(s==='REWORK')return 'REWORK';if(s==='REJECTED')return 'REJECTED';if(s==='DUPLICATE_IGNORED')return 'DUPLICATE';return 'FRIDAY_REVIEW';
}
function ensureLegacyLead(db,lead,auraDb){
  if(!lead?.id||!lead.companyName)return null;
  let company=companyMatch(db,lead);
  if(!company){
    company={id:stable('ZIYA-C',lead.companyName,lead.address||lead.website||lead.id),name:clean(lead.companyName),normalizedName:norm(lead.companyName),website:clean(lead.website),industry:clean(lead.facilityType),phone:clean(lead.contactNumber),email:clean(lead.email),primaryAddress:clean(lead.address),originalSource:RESEARCHERS.has(lead.agent)?lead.agent:'Other',sourceDetail:'Aura legacy lead import',status:'PROSPECT',createdAt:lead.createdAt||now(),updatedAt:lead.updatedAt||lead.createdAt||now(),metadata:{}};
    db.companies.unshift(company);activity(db,{actor:lead.agent&&ACTORS.has(lead.agent)?lead.agent:'CRM',type:'LEAD_CREATED',summary:`${lead.companyName} added to CRM.`,companyId:company.id,details:{leadId:lead.id,source:lead.agent},externalKey:`lead-created:${lead.id}`,createdAt:lead.createdAt});
  }else{
    company.website=company.website||clean(lead.website);company.phone=company.phone||clean(lead.contactNumber);company.email=company.email||clean(lead.email);company.primaryAddress=company.primaryAddress||clean(lead.address);company.updatedAt=lead.updatedAt||company.updatedAt;
  }
  let site=db.sites.find(s=>s.companyId===company.id&&same(s.address,lead.address||company.primaryAddress));
  if(!site){site={id:stable('ZIYA-S',company.id,lead.address||company.primaryAddress||'primary'),companyId:company.id,name:'Primary Site',address:clean(lead.address||company.primaryAddress),city:'',province:'Gauteng',operatingDays:'',operatingHours:'',createdAt:lead.createdAt||now(),updatedAt:lead.updatedAt||now(),metadata:{}};db.sites.unshift(site)}
  if(lead.contactPerson||lead.email||lead.contactNumber){
    const contactId=stable('ZIYA-P',company.id,lead.email||lead.contactNumber||lead.contactPerson||'primary');
    pushUnique(db,'contacts',{id:contactId,companyId:company.id,name:clean(lead.contactPerson)||'Primary Contact',role:clean(lead.contactRole),phone:clean(lead.contactNumber),email:clean(lead.email),createdAt:lead.createdAt||now(),updatedAt:lead.updatedAt||now(),metadata:{}},'id');
  }
  const draft=(auraDb.emailDrafts||[]).find(d=>d.leadId===lead.id);const message=(auraDb.outboundMessages||[]).find(m=>m.leadId===lead.id&&['SENT','SENDING','DELIVERY_UNKNOWN','FAILED'].includes(m.status));
  let opp=db.opportunities.find(o=>o.leadId===lead.id);
  const stage=stageForLead(lead,draft,message);
  if(!opp){
    opp={id:stable('ZIYA-O',lead.id),companyId:company.id,siteId:site.id,leadId:lead.id,title:`${lead.companyName} · Zero-CAPEX Energy Opportunity`,stage,source:RESEARCHERS.has(lead.agent)?lead.agent:'Other',sourceDetail:`${lead.agent||'Unknown'} research`,owner:'Yunus',estimatedValue:null,solution:'Zero-CAPEX Solar + BESS',estimatedKwhMin:num(lead.estimatedKwhMin),estimatedKwhMax:num(lead.estimatedKwhMax),usageConfidence:clean(lead.usageConfidence),fridayStatus:clean(lead.fridayStatus),fridayScore:num(lead.fridayScore),status:'OPEN',createdAt:lead.createdAt||now(),updatedAt:lead.updatedAt||lead.createdAt||now(),wonAt:null,lostAt:null,lossReason:null,proposalPath:null,metadata:{facilityType:lead.facilityType||'',unitCount:lead.unitCount??null,evidence:lead.evidence||[],fridayReasons:lead.fridayReasons||[]}};
    db.opportunities.unshift(opp);db.attributions.unshift({id:crypto.randomUUID(),opportunityId:opp.id,recordedSource:opp.source,confirmedSource:null,confirmedBy:null,confirmedAt:null,evidence:{leadId:lead.id,agent:lead.agent},createdAt:opp.createdAt});
  }else{
    if(LEGACY_MANAGED_STAGES.has(opp.stage))opp.stage=stage;opp.fridayStatus=clean(lead.fridayStatus);opp.fridayScore=num(lead.fridayScore);opp.estimatedKwhMin=num(lead.estimatedKwhMin);opp.estimatedKwhMax=num(lead.estimatedKwhMax);opp.usageConfidence=clean(lead.usageConfidence);opp.updatedAt=lead.updatedAt||opp.updatedAt;opp.metadata={...(opp.metadata||{}),facilityType:lead.facilityType||opp.metadata?.facilityType||'',unitCount:lead.unitCount??opp.metadata?.unitCount??null,evidence:lead.evidence||opp.metadata?.evidence||[],fridayReasons:lead.fridayReasons||opp.metadata?.fridayReasons||[]};
  }
  if(lead.fridayStatus&&lead.fridayStatus!=='PENDING')activity(db,{actor:'Friday',type:'FRIDAY_REVIEW',summary:`Friday ${String(lead.fridayStatus).toLowerCase()} ${lead.companyName}.`,companyId:company.id,opportunityId:opp.id,details:{score:lead.fridayScore,reasons:lead.fridayReasons||[]},externalKey:`friday:${lead.id}:${lead.fridayStatus}:${lead.fridayScore??''}`,createdAt:lead.updatedAt});
  if(draft){
    const outreachRow={id:stable('ZIYA-OUT',draft.id),opportunityId:opp.id,leadId:lead.id,draftId:draft.id,channel:'EMAIL',recipientName:clean(draft.recipientName||lead.contactPerson),recipient:clean(draft.recipientEmail||lead.email),subject:clean(draft.subject),status:message?.status||draft.status||'DRAFT',sentAt:message?.sentAt||draft.sentAt||null,repliedAt:null,responseClass:null,createdAt:draft.createdAt||now(),updatedAt:draft.updatedAt||message?.updatedAt||now(),metadata:{ultronReviews:draft.ultronReviews||[],smtpMessageId:message?.messageId||null,error:message?.error||draft.lastSendError||null}};
    pushUnique(db,'outreach',outreachRow,'id');
    activity(db,{actor:'Pepper',type:message?.status==='SENT'?'OUTREACH_SENT':'OUTREACH_PREPARED',summary:message?.status==='SENT'?`Pepper emailed ${lead.companyName}.`:`Pepper prepared outreach for ${lead.companyName}.`,companyId:company.id,opportunityId:opp.id,details:{draftId:draft.id,status:outreachRow.status,recipient:outreachRow.recipient},externalKey:`outreach:${draft.id}:${outreachRow.status}`,createdAt:message?.sentAt||draft.updatedAt||draft.createdAt});
  }
  return {company,site,opportunity:opp};
}
function matchTonyCompany(db,name=''){const n=norm(name);if(!n)return null;return db.companies.find(c=>n.includes(norm(c.name))||norm(c.name).includes(n))||null}
function syncTony(db,auraDb){
  const t=auraDb.tonyObserver;if(!t)return;
  activity(db,{actor:'TonyObserver',type:'TONY_STATUS',summary:`Tony observed ${t.status||'UNKNOWN'}.`,details:{status:t.status,running:!!t.running,lastActivityAt:t.lastActivityAt,jobs:t.jobs||{}},externalKey:`tony-status:${t.observedAt||t.status}`,createdAt:t.observedAt});
  const job=t.latestJob||t.activeJob;const companyName=job?.company||job?.companyName||'';const company=matchTonyCompany(db,companyName);
  if(company){const opp=db.opportunities.find(o=>o.companyId===company.id&&ACTIVE_STAGES.has(o.stage));if(opp){const st=String(job?.status||'');if(TONY_MANAGED_STAGES.has(opp.stage)&&['RECEIVED','CALCULATING','GENERATING_PDF','EMAILING'].includes(st))opp.stage='TONY_PROCESSING';if(TONY_MANAGED_STAGES.has(opp.stage)&&st==='COMPLETED')opp.stage='PROPOSAL_READY';if(t.completed?.latest?.path&&norm(path.basename(t.completed.latest.path)).includes(norm(company.name)))opp.proposalPath=t.completed.latest.path;opp.updatedAt=t.observedAt||now();activity(db,{actor:'TonyObserver',type:'TONY_JOB',summary:`Tony job for ${company.name}: ${st||t.status}.`,companyId:company.id,opportunityId:opp.id,details:{job,latestPdf:t.completed?.latest||null},externalKey:`tony-job:${job?.id||company.id}:${job?.updatedAt||t.observedAt||st}`,createdAt:job?.updatedAt||t.observedAt})}}
}

export function initCrm(){const db=loadCrm();saveCrm(db);return db}
export function syncLegacyAuraData(auraDb=load()){
  return mutateCrm(db=>{
    for(const lead of auraDb.leads||[])ensureLegacyLead(db,lead,auraDb);
    syncTony(db,auraDb);
    for(const e of (auraDb.events||[]).slice(0,1500)){
      const actor=ACTORS.has(e.agent)?e.agent:(e.agent==='Tony'?'TonyObserver':'CRM');
      if(actor==='TonyObserver'&&e.agent==='Tony')continue;
      activity(db,{actor,type:e.eventType||'AGENT_EVENT',summary:e.message||`${actor} event`,details:{level:e.level||'INFO',data:e.data||{}},externalKey:`aura-event:${e.id||crypto.createHash('sha1').update(`${e.createdAt}|${e.agent}|${e.eventType}|${e.message}`).digest('hex')}`,createdAt:e.createdAt});
    }
    db.meta.lastLegacySyncAt=now();return {companies:db.companies.length,opportunities:db.opportunities.length,activities:db.activities.length};
  })
}

export function crmSummary(){
  const db=loadCrm();const open=db.opportunities.filter(o=>ACTIVE_STAGES.has(o.stage));const won=db.opportunities.filter(o=>o.stage==='WON');const pipelineValue=open.reduce((a,o)=>a+(Number(o.estimatedValue)||0),0);const qualified=open.filter(o=>['APPROVED','OUTREACH','ENGAGED','QUALIFYING','AWAITING_INFORMATION','DOCUMENTS_COMPLETE','READY_FOR_TONY','TONY_PROCESSING','PROPOSAL_READY','OWNER_REVIEW','PROPOSAL_PRESENTED','NEGOTIATION'].includes(o.stage)).length;
  const byStage=Object.fromEntries(CRM_STAGES.map(s=>[s,db.opportunities.filter(o=>o.stage===s).length]));
  const bySource={};for(const o of db.opportunities){bySource[o.source||'Other']=(bySource[o.source||'Other']||0)+1}
  const waitingInfo=db.opportunities.filter(o=>o.stage==='AWAITING_INFORMATION').length;const proposals=db.opportunities.filter(o=>['PROPOSAL_READY','OWNER_REVIEW','PROPOSAL_PRESENTED','NEGOTIATION'].includes(o.stage)).length;
  return {companies:db.companies.length,opportunities:db.opportunities.length,open:open.length,qualified,won:won.length,lost:db.opportunities.filter(o=>o.stage==='LOST').length,pipelineValue,proposals,waitingInformation:waitingInfo,tasksOpen:db.tasks.filter(t=>!['DONE','CANCELLED'].includes(t.status)).length,byStage,bySource,lastSyncAt:db.meta.lastLegacySyncAt};
}
export function listCompanies({limit=500,search=''}={}){const q=norm(search);return loadCrm().companies.filter(c=>!q||[c.name,c.website,c.primaryAddress,c.email].some(v=>norm(v).includes(q))).slice(0,Math.max(1,Math.min(2000,Number(limit)||500)))}
export function listOpportunities({limit=500,stage='',source='',search=''}={}){const db=loadCrm(),q=norm(search);return db.opportunities.filter(o=>(!stage||o.stage===stage)&&(!source||o.source===source)&&(!q||norm(o.title).includes(q)||norm(db.companies.find(c=>c.id===o.companyId)?.name).includes(q))).slice(0,Math.max(1,Math.min(2000,Number(limit)||500))).map(o=>({...o,company:db.companies.find(c=>c.id===o.companyId)||null,site:db.sites.find(s=>s.id===o.siteId)||null,attribution:db.attributions.find(a=>a.opportunityId===o.id)||null}))}
export function getOpportunity(id){const db=loadCrm(),o=db.opportunities.find(x=>x.id===id);if(!o)return null;return {...o,company:db.companies.find(c=>c.id===o.companyId)||null,site:db.sites.find(s=>s.id===o.siteId)||null,contacts:db.contacts.filter(c=>c.companyId===o.companyId),activities:db.activities.filter(a=>a.opportunityId===id).slice(0,200),tasks:db.tasks.filter(t=>t.opportunityId===id),documents:db.documents.filter(d=>d.opportunityId===id),outreach:db.outreach.filter(x=>x.opportunityId===id),attribution:db.attributions.find(a=>a.opportunityId===id)||null}}
export function listActivities({limit=200,opportunityId=null,actor=null}={}){return loadCrm().activities.filter(a=>(!opportunityId||a.opportunityId===opportunityId)&&(!actor||a.actor===actor)).slice(0,Math.max(1,Math.min(1000,Number(limit)||200)))}
export function listTasks({limit=300,assignedTo='',status=''}={}){return loadCrm().tasks.filter(t=>(!assignedTo||t.assignedTo===assignedTo)&&(!status||t.status===status)).slice(0,Math.max(1,Math.min(1000,Number(limit)||300)))}
export function sourcePerformance(){const db=loadCrm();const sources=[...new Set([...CRM_SOURCES,...db.opportunities.map(o=>o.source).filter(Boolean)])];return sources.map(source=>{const ops=db.opportunities.filter(o=>o.source===source),won=ops.filter(o=>o.stage==='WON'),open=ops.filter(o=>ACTIVE_STAGES.has(o.stage));return {source,leads:ops.length,open:open.length,qualified:ops.filter(o=>!['DISCOVERED','FRIDAY_REVIEW','REWORK','REJECTED','DUPLICATE','DISQUALIFIED'].includes(o.stage)).length,proposals:ops.filter(o=>['PROPOSAL_READY','OWNER_REVIEW','PROPOSAL_PRESENTED','NEGOTIATION','WON'].includes(o.stage)).length,won:won.length,winRate:ops.length?won.length/ops.length:0,pipelineValue:open.reduce((a,o)=>a+(Number(o.estimatedValue)||0),0)}})}
export function agentPerformance(){const db=loadCrm();const agents=['Vision','Peter','MJ','Friday','Pepper','Ultron','Steve','Aura','Natasha','Wanda','TonyObserver'];return agents.map(agent=>{const acts=db.activities.filter(a=>a.actor===agent);const sourced=db.opportunities.filter(o=>o.source===agent);return {agent,activities:acts.length,sourcedLeads:sourced.length,won:sourced.filter(o=>o.stage==='WON').length,open:sourced.filter(o=>ACTIVE_STAGES.has(o.stage)).length,lastActivityAt:acts[0]?.createdAt||null,emailsSent:agent==='Pepper'?db.outreach.filter(x=>x.status==='SENT').length:0,replies:agent==='Pepper'?db.outreach.filter(x=>x.repliedAt).length:0}})}

export function changeOpportunityStage(actor,id,stage,{reason='',ownerInstruction=false}={}){
  requireActor(actor);if(!CRM_STAGES.includes(stage))throw new Error(`Invalid CRM stage: ${stage}`);if(['WON','LOST'].includes(stage))throw new Error('Use the dedicated WON/LOST workflow.');if(!['Owner','Aura','Wanda','Friday','Pepper','TonyObserver','CRM'].includes(actor))throw new Error(`${actor} may not change opportunity stage.`);if(actor==='Aura'&&!ownerInstruction&&['PROPOSAL_PRESENTED','NEGOTIATION','ON_HOLD'].includes(stage))throw new Error('Aura requires an owner instruction for commercial stage changes.');
  return mutateCrm(db=>{const o=db.opportunities.find(x=>x.id===id);if(!o)throw new Error('Opportunity not found.');const before=o.stage;o.stage=stage;o.updatedAt=now();audit(db,actor,'changed stage','opportunity',id,{stage:before},{stage},reason);return jsonClone(o)})
}
export function markOpportunityWon(actor,id,{source,verifiedBy='Owner',reason='Owner confirmed deal won'}={}){
  requireActor(actor);if(!['Owner','Aura'].includes(actor))throw new Error('Only the owner, or Aura acting on the owner’s instruction, may mark a deal WON.');if(!CRM_SOURCES.includes(source))throw new Error('A valid source attribution is required before marking WON.');if(verifiedBy!=='Owner')throw new Error('WON attribution must be owner-verified.');
  return mutateCrm(db=>{const o=db.opportunities.find(x=>x.id===id);if(!o)throw new Error('Opportunity not found.');const before={stage:o.stage,source:o.source};o.stage='WON';o.status='CLOSED';o.wonAt=now();o.updatedAt=o.wonAt;let a=db.attributions.find(x=>x.opportunityId===id);if(!a){a={id:crypto.randomUUID(),opportunityId:id,recordedSource:o.source,createdAt:o.createdAt};db.attributions.unshift(a)}a.confirmedSource=source;a.confirmedBy='Owner';a.confirmedAt=o.wonAt;a.evidence={...(a.evidence||{}),ownerVerified:true};audit(db,actor,'marked WON','opportunity',id,before,{stage:'WON',confirmedSource:source},reason);activity(db,{actor:'CRM',type:'OWNER_VERIFIED_WON',summary:`Deal won. Origin attribution confirmed: ${source}.`,companyId:o.companyId,opportunityId:o.id,details:{source,verifiedBy:'Owner'},externalKey:`won:${o.id}:${o.wonAt}`});return {opportunity:jsonClone(o),attribution:jsonClone(a),event:{type:'OWNER_VERIFIED_WON',source}}})
}
export function markOpportunityLost(actor,id,{reason,ownerInstruction=false}={}){
  requireActor(actor);if(!['Owner','Aura'].includes(actor))throw new Error('Only Owner or Aura may close a deal as LOST.');if(actor==='Aura'&&!ownerInstruction)throw new Error('Aura requires an owner instruction to mark a deal LOST.');if(!clean(reason))throw new Error('A lost reason is required.');return mutateCrm(db=>{const o=db.opportunities.find(x=>x.id===id);if(!o)throw new Error('Opportunity not found.');const before=o.stage;o.stage='LOST';o.status='CLOSED';o.lostAt=now();o.lossReason=clean(reason);o.updatedAt=o.lostAt;audit(db,actor,'marked LOST','opportunity',id,{stage:before},{stage:'LOST',reason:o.lossReason},o.lossReason);return jsonClone(o)})
}
export function addTask(actor,{opportunityId=null,companyId=null,title,assignedTo,dueAt=null,priority='NORMAL'}={}){requireActor(actor);if(!clean(title)||!clean(assignedTo))throw new Error('Task title and assignee are required.');return mutateCrm(db=>{const row={id:crypto.randomUUID(),opportunityId,companyId,title:clean(title),assignedTo:clean(assignedTo),status:'OPEN',priority:clean(priority)||'NORMAL',dueAt:dueAt||null,createdBy:actor,createdAt:now(),updatedAt:now()};db.tasks.unshift(row);activity(db,{actor,type:'TASK_CREATED',summary:`Task assigned to ${row.assignedTo}: ${row.title}`,companyId,opportunityId,details:row});return jsonClone(row)})}

export function publishAgentUpdate(actor,payload={}){
  requireActor(actor);const type=clean(payload.type).toUpperCase();const allowed={Vision:['NOTE','RESEARCH_UPDATE'],Peter:['NOTE','RESEARCH_UPDATE'],MJ:['NOTE','RESEARCH_UPDATE'],Friday:['NOTE','QUALIFICATION_UPDATE'],Pepper:['NOTE','OUTREACH_UPDATE','OUTREACH_REPLY'],Ultron:['NOTE','QA_UPDATE'],Steve:['NOTE','REPORT','RECOMMENDATION'],Aura:['NOTE','SUPERVISOR_UPDATE'],Natasha:['NOTE','MARKETING_UPDATE','MARKETING_LEAD'],Wanda:['NOTE','CLIENT_UPDATE','QUALIFICATION_UPDATE','DOCUMENT_UPDATE'],TonyObserver:['PROPOSAL_UPDATE','TONY_STATUS'],CRM:['NOTE']};if(!(allowed[actor]||[]).includes(type))throw new Error(`${actor} may not publish CRM event ${type}.`);
  return mutateCrm(db=>{const o=payload.opportunityId?db.opportunities.find(x=>x.id===payload.opportunityId):null;const row={id:crypto.randomUUID(),actor,type,opportunityId:o?.id||payload.opportunityId||null,companyId:o?.companyId||payload.companyId||null,summary:clean(payload.summary)||`${actor} published ${type}.`,data:jsonClone(payload.data||{}),createdAt:now()};db.agentPublications.unshift(row);activity(db,{actor,type,summary:row.summary,companyId:row.companyId,opportunityId:row.opportunityId,details:row.data});return jsonClone(row)})
}

export function crmExecutiveContext(){const s=crmSummary(),src=sourcePerformance().filter(x=>x.leads||x.won),agents=agentPerformance().filter(x=>x.activities||x.sourcedLeads);return {summary:s,sourcePerformance:src,agentPerformance:agents,topOpen:listOpportunities({limit:12}).filter(o=>ACTIVE_STAGES.has(o.stage)).map(o=>({id:o.id,company:o.company?.name,title:o.title,stage:o.stage,source:o.source,estimatedValue:o.estimatedValue,fridayScore:o.fridayScore}))}}
export function answerCrmQuestion(text=''){
  const n=norm(text),s=crmSummary(),src=sourcePerformance(),agents=agentPerformance();
  if(/how many (projects|deals|opportunities)|projects.*pipeline|pipeline.*projects/.test(n))return `We currently have ${s.open} open opportunities in the CRM${s.pipelineValue?` with a recorded pipeline value of R${Math.round(s.pipelineValue).toLocaleString('en-ZA')}`:''}. ${s.proposals} are at proposal-ready or later stages.`;
  if(/lead database|leads looking|how.*leads|lead base/.test(n)){const top=src.filter(x=>x.leads).sort((a,b)=>b.leads-a.leads).slice(0,4).map(x=>`${x.source} ${x.leads}`).join(', ');return `The CRM contains ${s.companies} unique companies and ${s.opportunities} opportunity records. ${s.qualified} are qualified or progressing beyond approval. Source volumes are ${top||'not yet populated'}.`}
  if(/pipeline value|value.*pipeline/.test(n))return s.pipelineValue?`Recorded open pipeline value is R${Math.round(s.pipelineValue).toLocaleString('en-ZA')} across ${s.open} opportunities.`:`There are ${s.open} open opportunities, but deal values have not been entered consistently yet, so I won't invent a pipeline value.`;
  if(/who.*performing|best agent|agent performance/.test(n)){const ranked=src.filter(x=>x.leads).sort((a,b)=>(b.won-a.won)||(b.qualified-a.qualified));if(!ranked.length)return 'There is not enough CRM outcome data yet to rank lead sources reliably.';const a=ranked[0];return `${a.source} currently leads by recorded outcomes with ${a.won} won deal${a.won===1?'':'s'}, ${a.qualified} qualified opportunities and ${a.leads} sourced leads.`}
  if(/pepper/.test(n)&&/(email|outreach|perform|response|reply)/.test(n)){const a=agents.find(x=>x.agent==='Pepper');return `Pepper has ${a?.emailsSent||0} CRM-recorded sent emails and ${a?.replies||0} recorded replies. Reply tracking will only increase when inbound responses are actually captured; I won't infer replies from sends.`}
  if(/proposal/.test(n)&&/(how many|status|waiting|ready)/.test(n))return `There are ${s.proposals} opportunities at proposal-ready, owner-review, presented or negotiation stages. ${s.waitingInformation} opportunities are currently marked as waiting for information.`;
  if(/source|origin|where.*lead/.test(n)){const rows=src.filter(x=>x.leads).sort((a,b)=>b.leads-a.leads).slice(0,6);return rows.length?`Lead sources currently recorded are ${rows.map(x=>`${x.source}: ${x.leads} leads, ${x.won} won`).join('; ')}.`:'No sourced opportunities have been recorded yet.'}
  return null;
}

export function findOpportunityByName(query,{activeOnly=true}={}){
  const q=norm(query);if(!q)return null;const rows=listOpportunities({limit:1000});
  const candidates=rows.filter(o=>!activeOnly||ACTIVE_STAGES.has(o.stage)||['WON','LOST'].includes(o.stage));
  return candidates.find(o=>norm(o.company?.name)===q||norm(o.title)===q)||candidates.find(o=>norm(o.company?.name).includes(q)||q.includes(norm(o.company?.name))||norm(o.title).includes(q))||null;
}
