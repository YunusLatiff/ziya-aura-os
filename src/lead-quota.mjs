import {load} from './store.mjs';

export const QUOTA_AGENTS=['Vision','Peter','MJ'];
const DEFAULT_TIMEZONE='Africa/Johannesburg';

function envInt(name,fallback,{min=0,max=1_000_000}={}){
  const n=Number(process.env[name]);
  if(!Number.isFinite(n))return fallback;
  return Math.max(min,Math.min(max,Math.floor(n)));
}

export function quotaTimezone(){return String(process.env.LEAD_QUOTA_TIMEZONE||DEFAULT_TIMEZONE).trim()||DEFAULT_TIMEZONE}

export function quotaMonthKey(value=new Date(),timeZone=quotaTimezone()){
  const d=value instanceof Date?value:new Date(value);
  if(Number.isNaN(d.getTime()))return null;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit'}).formatToParts(d);
  const year=parts.find(x=>x.type==='year')?.value;
  const month=parts.find(x=>x.type==='month')?.value;
  return year&&month?`${year}-${month}`:null;
}

export function leadQuotaConfig(){
  return {
    timezone:quotaTimezone(),
    globalLimit:envInt('LEADS_MONTHLY_APPROVED_CAP',180,{min:1,max:100000}),
    agentLimits:{
      Vision:envInt('VISION_MONTHLY_APPROVED_CAP',60,{min:0,max:100000}),
      Peter:envInt('PETER_MONTHLY_APPROVED_CAP',60,{min:0,max:100000}),
      MJ:envInt('MJ_MONTHLY_APPROVED_CAP',60,{min:0,max:100000})
    }
  };
}

function approvedAt(lead){return lead?.fridayApprovedAt||lead?.approvedAt||lead?.updatedAt||lead?.createdAt||null}
function isApprovedInMonth(lead,month,timeZone){return lead?.fridayStatus==='APPROVED'&&quotaMonthKey(approvedAt(lead),timeZone)===month}

export function leadQuotaStatus(db=load(),at=new Date()){
  const cfg=leadQuotaConfig();
  const month=quotaMonthKey(at,cfg.timezone);
  const leads=Array.isArray(db?.leads)?db.leads:[];
  const agents={};
  for(const agent of QUOTA_AGENTS){
    const used=leads.filter(l=>l.agent===agent&&isApprovedInMonth(l,month,cfg.timezone)).length;
    const limit=cfg.agentLimits[agent];
    agents[agent]={used,limit,remaining:Math.max(0,limit-used),reached:used>=limit};
  }
  const used=QUOTA_AGENTS.reduce((sum,a)=>sum+agents[a].used,0);
  const limit=cfg.globalLimit;
  return {month,timezone:cfg.timezone,global:{used,limit,remaining:Math.max(0,limit-used),reached:used>=limit},agents};
}

export function quotaDecision(agent,db=load(),at=new Date()){
  const s=leadQuotaStatus(db,at);
  const a=s.agents[agent];
  if(!a)return {allowed:false,reason:'UNKNOWN_AGENT',remaining:0,status:s};
  if(s.global.reached)return {allowed:false,reason:'GLOBAL_MONTHLY_CAP_REACHED',remaining:0,status:s};
  if(a.reached)return {allowed:false,reason:'AGENT_MONTHLY_CAP_REACHED',remaining:0,status:s};
  return {allowed:true,reason:null,remaining:Math.max(0,Math.min(a.remaining,s.global.remaining)),status:s};
}

export function remainingApprovalSlots(agent,db=load(),at=new Date()){return quotaDecision(agent,db,at).remaining}
