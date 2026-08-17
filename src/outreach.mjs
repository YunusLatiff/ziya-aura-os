import crypto from 'node:crypto';
import {load,mutate} from './store.mjs';
import {logEvent} from './orchestrator.mjs';
import {effectivePolicy} from './agent-policy.mjs';
import {syncLegacyAuraData} from './crm.mjs';

const now=()=>new Date().toISOString();
const trim=s=>String(s||'').replace(/\s+/g,' ').trim();
const firstName=s=>trim(s).split(/\s+/)[0]||'';
const wordCount=s=>trim(s).split(/\s+/).filter(Boolean).length;

function facilityLabel(lead){
  const map={
    FACTORY:'manufacturing facility',
    MANUFACTURING:'manufacturing operation',
    WAREHOUSE:'warehouse or distribution facility',
    RETAIL:'retail site',
    SHOPPING_CENTRE:'shopping centre',
    OFFICE_PARK:'office park',
    COMMERCIAL:'commercial property',
    ESTATE:'residential estate',
    APARTMENT_COMPLEX:'apartment complex'
  };
  return map[lead?.facilityType]||'property';
}

function objectiveLine(lead){
  if(lead?.agent==='Vision') return 'reduce electricity costs, manage peak demand and improve energy resilience';
  if(lead?.agent==='Peter') return 'reduce operating electricity costs and assess where solar or battery storage may make commercial sense';
  if(lead?.agent==='MJ') return 'reduce common-area electricity costs and assess practical solar or battery opportunities for the property';
  return 'reduce electricity costs and assess practical energy opportunities';
}

function regionHint(lead){
  if(lead?.address) return ` at ${trim(lead.address)}`;
  if(lead?.region) return ` in ${trim(lead.region)}`;
  return '';
}

export function buildPepperDraft(lead,batch={}){
  const pepperPolicy=effectivePolicy('Pepper').draft||{};
  if(!lead?.id) throw new Error('Pepper requires a lead id.');
  if(lead.fridayStatus!=='APPROVED') throw new Error('Pepper may only draft for Friday-approved leads.');

  const name=firstName(lead.contactPerson);
  const greeting=name?`Hi ${name},`:'Hi there,';
  const company=trim(lead.companyName)||'your organisation';
  const facility=facilityLabel(lead);
  const location=regionHint(lead);
  const objective=objectiveLine(lead);

  const subject=`Zero-upfront energy assessment for ${company}`;
  const body=[
    greeting,
    '',
    `I’m reaching out from Ziya Energy. We help South African businesses and property operators reduce electricity costs through commercially structured solar PV and battery solutions that can be implemented with no upfront capital, subject to project eligibility.`,
    '',
    `From publicly available information, ${company} appears to operate or manage a ${facility}${location}. I’m not assuming your exact electricity profile, but it looks like the type of site where a structured assessment could identify practical ways to ${objective}.`,
    '',
    `We start with the site’s actual electricity consumption, tariff, operating profile and recent bills before recommending anything, so the proposal is based on the numbers rather than a generic solar pitch.`,
    '',
    `Would it be useful if I sent a short overview, or would you be open to a brief conversation?`,
    '',
    `Kind regards,`,
    `Ziya Energy`
  ].join('\n');

  return {
    id:crypto.randomUUID(),
    leadId:lead.id,
    batchId:lead.batchId||batch.id||null,
    researcher:lead.agent||null,
    agent:'Pepper',
    status:'ULTRON_REVIEW',
    version:1,
    subject,
    body,
    recipientName:trim(lead.contactPerson),
    recipientEmail:trim(lead.email),
    companyName:company,
    createdAt:now(),
    updatedAt:now(),
    pepperNotes:[
      'Grounded only in lead data already approved by Friday.',
      'No guaranteed savings, ROI, system size or consumption claim added.',
      `Pepper tone policy: ${pepperPolicy.tone||'warm, concise, consultative'}.`,
      'No email has been sent.'
    ],
    ultronReviews:[]
  };
}

export function ultronReviewDraft(draft,lead){
  const critical=[];
  const advisories=[];
  const qa=effectivePolicy('Ultron').qa||{};
  const subject=trim(draft?.subject);
  const body=trim(draft?.body);
  const wc=wordCount(body);
  const company=trim(lead?.companyName);

  // Ultron is a commercial-safety and message-focus gate, not a copywriting perfectionist.
  if(!subject) critical.push('Subject line is missing.');
  if(company&&!body.toLowerCase().includes(company.toLowerCase())) critical.push('Company/property name is not used in the body.');
  if(!/ziya energy/i.test(body)) critical.push('The email does not clearly identify Ziya Energy.');
  if(!/(no|zero)[ -]?(?:upfront|up-front).{0,20}(?:capital|capex)|without.{0,12}(?:upfront|up-front).{0,12}(?:capital|capex)/i.test(body)) critical.push('The zero-upfront-capital proposition is not clear.');
  if(!/solar|battery|bess|energy|electricity/i.test(body)) critical.push('The email does not focus on the relevant commercial energy solution.');
  if(!/actual (?:electricity )?consumption|tariff|operating profile|electricity bills?|recent bills?|structured assessment/i.test(body)) critical.push('The email does not explain that recommendations are based on the client’s actual energy profile.');
  if(!/\?|would you|would it be useful|open to|send a short overview|brief conversation|brief call/i.test(body)) critical.push('The email needs a simple, low-friction next step.');
  if(/guarantee|guaranteed|best price|limited time|act now|free quote|massive savings|huge savings|revolutionary|game[- ]changing/i.test(body)) critical.push('Language is promotional, spam-like or makes an inappropriate claim.');
  if(/\b\d+(?:\.\d+)?\s*%\b|save\s+R?\s*[\d,.]+|ROI\s+of\s+\d/i.test(body)) critical.push('Draft contains an unsupported quantified commercial claim.');
  if(lead?.contactPerson&&draft?.recipientName&&trim(draft.recipientName)!==trim(lead.contactPerson)) critical.push('Recipient name does not match the Friday-approved lead record.');

  // Style issues are advisory unless they accumulate enough to materially hurt the message.
  if(subject.length>90) advisories.push('Subject line could be shorter.');
  if(wc<Number(qa.minWords??60)) advisories.push(`Email is shorter than the preferred ${Number(qa.minWords??60)} words.`);
  if(wc>Number(qa.maxWords??260)) advisories.push(`Email is longer than the preferred ${Number(qa.maxWords??260)} words.`);
  if(/dear sir|dear madam|to whom it may concern/i.test(body)) advisories.push('Greeting is impersonal.');
  if((body.match(/!/g)||[]).length>Number(qa.maxExclamations??2)) advisories.push('Tone is more enthusiastic than preferred for B2B outreach.');

  const score=Math.max(0,100-critical.length*25-advisories.length*5);
  const minScore=Number(qa.minScore??80);
  const approved=critical.length===0&&score>=minScore;
  const reasons=[...critical,...advisories];

  return {
    approved,
    score,
    reasons,
    criticalReasons:critical,
    advisories,
    instructions:approved
      ? (advisories.length?'Approved by Ultron. Optional polish: '+advisories.join(' '):'Approved by Ultron. Core commercial points are covered.')
      : [...critical,...advisories].map((r,i)=>`${i+1}. ${r}`).join('\n')||`Raise quality score to at least ${minScore}.`
  };
}

export function revisePepperDraft(draft,lead,review){
  const clean=buildPepperDraft(lead,{id:draft.batchId});
  return {
    ...draft,
    subject:clean.subject,
    body:clean.body,
    recipientName:clean.recipientName,
    recipientEmail:clean.recipientEmail,
    status:'ULTRON_REVIEW',
    version:Number(draft.version||1)+1,
    updatedAt:now(),
    pepperNotes:[...(draft.pepperNotes||[]),`Revision created from Ultron instructions: ${review?.reasons?.join(' | ')||'quality correction'}`]
  };
}

export function eligiblePepperLeads(db){
  const drafted=new Set((db.emailDrafts||[]).map(d=>d.leadId));
  // Phase 8.7: Friday-approved leads flow to Pepper individually; batch completion is no longer a gate.
  return (db.leads||[]).filter(l=>l.fridayStatus==='APPROVED'&&!drafted.has(l.id));
}

function setAgent(agent,status,currentTask,lastError=null){
  mutate(db=>{if(db.agents?.[agent]){db.agents[agent].status=status;db.agents[agent].currentTask=currentTask;db.agents[agent].lastError=lastError;db.agents[agent].lastHeartbeat=now();}});
}

function saveReview(draftId,review,status){
  mutate(db=>{const d=(db.emailDrafts||[]).find(x=>x.id===draftId);if(!d)return;d.ultronReviews=d.ultronReviews||[];d.ultronReviews.push({createdAt:now(),score:review.score,approved:review.approved,reasons:review.reasons,instructions:review.instructions,version:d.version});d.status=status;d.updatedAt=now();});
}

function maybeCompleteBatch(batchId){
  mutate(db=>{
    const b=(db.leadBatches||[]).find(x=>x.id===batchId);if(!b)return;
    const approvedLeads=(db.leads||[]).filter(l=>l.batchId===batchId&&l.fridayStatus==='APPROVED');
    const drafts=(db.emailDrafts||[]).filter(d=>d.batchId===batchId&&d.status==='APPROVED');
    if(approvedLeads.length>=10&&drafts.length>=approvedLeads.length){
      b.readyForPepper=false;
      b.outreachStatus='ULTRON_APPROVED';
      b.pepperCompletedAt=now();
      b.updatedAt=now();
    }
  });
}

export async function outreachStep(){
  const db=load();
  const candidates=eligiblePepperLeads(db);
  if(!candidates.length){
    setAgent('Pepper','WAITING','Waiting for the next Friday-approved lead.');
    setAgent('Ultron','WAITING','Waiting for Pepper drafts.');
    return {created:0,approved:0,rework:0,rejected:0};
  }

  let created=0,approved=0,rework=0,rejected=0;
  for(const lead of candidates.slice(0,10)){
    setAgent('Pepper','WORKING',`Drafting outreach for ${lead.companyName}`);
    let draft=buildPepperDraft(lead);
    mutate(x=>{x.emailDrafts=x.emailDrafts||[];x.emailDrafts.unshift(draft);});
    created++;
    logEvent('Pepper','INFO','OUTREACH_DRAFTED',`Pepper drafted outreach for ${lead.companyName}.`,{leadId:lead.id,draftId:draft.id,batchId:lead.batchId});

    setAgent('Ultron','WORKING',`Reviewing Pepper draft for ${lead.companyName}`);
    let review=ultronReviewDraft(draft,lead);
    saveReview(draft.id,review,review.approved?'APPROVED':'PEPPER_REWORK');

    if(review.approved){
      approved++;
      logEvent('Ultron','INFO','OUTREACH_APPROVED',`Ultron approved Pepper's draft for ${lead.companyName}.`,{leadId:lead.id,draftId:draft.id,score:review.score});
    }else{
      rework++;
      logEvent('Ultron','WARN','OUTREACH_REWORK',`Ultron returned Pepper's draft for ${lead.companyName} with rectification instructions.`,{leadId:lead.id,draftId:draft.id,score:review.score,reasons:review.reasons});
      draft=revisePepperDraft(draft,lead,review);
      mutate(x=>{const i=x.emailDrafts.findIndex(d=>d.id===draft.id);if(i>=0)x.emailDrafts[i]=draft;});
      logEvent('Pepper','INFO','OUTREACH_REVISED',`Pepper revised outreach for ${lead.companyName}.`,{leadId:lead.id,draftId:draft.id,version:draft.version});
      review=ultronReviewDraft(draft,lead);
      saveReview(draft.id,review,review.approved?'APPROVED':'ULTRON_REJECTED');
      if(review.approved){
        approved++;
        logEvent('Ultron','INFO','OUTREACH_APPROVED',`Ultron approved Pepper's revised draft for ${lead.companyName}.`,{leadId:lead.id,draftId:draft.id,score:review.score,version:draft.version});
      }else{
        rejected++;
        logEvent('Ultron','ERROR','OUTREACH_REJECTED',`Ultron rejected Pepper's revised draft for ${lead.companyName}; human/Aura review required.`,{leadId:lead.id,draftId:draft.id,score:review.score,reasons:review.reasons});
      }
    }
    maybeCompleteBatch(lead.batchId);
    syncLegacyAuraData();
  }

  setAgent('Pepper','WAITING','Waiting for the next Friday-approved lead.');
  setAgent('Ultron','WAITING','Waiting for the next Pepper draft.');
  return {created,approved,rework,rejected};
}

export function outreachStatus(){
  const db=load();
  const drafts=db.emailDrafts||[];
  return {
    enabled:!!db.meta?.outreachCycleEnabled,
    lastTickAt:db.meta?.outreachLastTickAt||null,
    total:drafts.length,
    review:drafts.filter(d=>d.status==='ULTRON_REVIEW').length,
    rework:drafts.filter(d=>d.status==='PEPPER_REWORK').length,
    approved:drafts.filter(d=>d.status==='APPROVED').length,
    rejected:drafts.filter(d=>d.status==='ULTRON_REJECTED').length,
    sendLocked:true
  };
}

export function setOutreachCycle(enabled){
  mutate(db=>{db.meta=db.meta||{};db.meta.outreachCycleEnabled=!!enabled;db.meta.outreachChangedAt=now();});
  logEvent('Aura','INFO',enabled?'OUTREACH_CYCLE_STARTED':'OUTREACH_CYCLE_STOPPED',enabled?'Aura started Phase 3 Pepper + Ultron processing.':'Aura stopped Phase 3 Pepper + Ultron processing.');
  return outreachStatus();
}
