import crypto from 'node:crypto';
import {load,mutate} from './store.mjs';
import {RESEARCH_PROFILES,BATCH_SIZE} from './research-config.mjs';

const now=()=>new Date().toISOString();
const clone=x=>JSON.parse(JSON.stringify(x));

const DEFAULTS={
  Vision:{research:{...RESEARCH_PROFILES.Vision,batchSize:BATCH_SIZE,minUsageConfidence:'MEDIUM',requireAddress:true,requireContact:true,maxCandidatesPerQuery:10}},
  Peter:{research:{...RESEARCH_PROFILES.Peter,batchSize:BATCH_SIZE,minUsageConfidence:'MEDIUM',requireAddress:true,requireContact:true,maxCandidatesPerQuery:10}},
  MJ:{research:{...RESEARCH_PROFILES.MJ,batchSize:BATCH_SIZE,minUsageConfidence:'MEDIUM',requireAddress:true,requireContact:true,maxCandidatesPerQuery:10}},
  Friday:{scoring:{reasonPenalty:18,missingEmailPenalty:5,missingPhonePenalty:5,missingContactPersonPenalty:7,lowEvidencePenalty:8,approveMinScore:85,reworkMinScore:50,requireContact:true,minEvidence:1}},
  Pepper:{draft:{minWords:60,maxWords:260,tone:'warm, concise, consultative, commercially credible',ctaStyle:'low-friction',allowIndividualApprovedLeads:true}},
  Ultron:{qa:{minWords:60,maxWords:260,maxExclamations:2,minScore:80,strictClaims:true,requireGrounding:true}},
  Steve:{monitoring:{agentStaleMinutes:10,batchStallMinutes:20}},
  Aura:{conversation:{style:'composed, concise, anticipatory, natural, subtly warm',confirmationForHighRisk:true}}
};

const PROTECTED_PATHS=[
  'authority','canCommand','reportsTo','protected','external','tony','source','code','filesystem','credentials','secrets'
];
const ALLOWED_TARGETS=['Aura','Steve','Friday','Ultron','Vision','Peter','MJ','Pepper'];

function merge(a,b){
  if(Array.isArray(a)||Array.isArray(b)) return clone(b===undefined?a:b);
  if(!a||typeof a!=='object'||!b||typeof b!=='object') return clone(b===undefined?a:b);
  const out={...clone(a)};
  for(const [k,v] of Object.entries(b)) out[k]=(v&&typeof v==='object'&&!Array.isArray(v))?merge(out[k]||{},v):clone(v);
  return out;
}
function getPath(obj,path){return String(path||'').split('.').filter(Boolean).reduce((o,k)=>o?.[k],obj)}
function setPath(obj,path,value){
  const parts=String(path||'').split('.').filter(Boolean);if(!parts.length)throw new Error('Policy path required.');
  let cur=obj;for(const p of parts.slice(0,-1)){if(!cur[p]||typeof cur[p]!=='object'||Array.isArray(cur[p]))cur[p]={};cur=cur[p]}
  cur[parts.at(-1)]=value;return obj;
}
function validateTarget(target){
  if(target==='Tony') throw new Error('Tony is protected and cannot be modified.');
  if(!ALLOWED_TARGETS.includes(target)) throw new Error(`Unknown or non-modifiable agent: ${target}`);
}
function validatePath(path){
  const n=String(path||'').toLowerCase();
  if(PROTECTED_PATHS.some(x=>n.includes(x.toLowerCase()))) throw new Error('That policy path is protected and cannot be changed.');
}
function coerceLike(current,value){
  if(typeof current==='number'){const n=Number(value);if(!Number.isFinite(n))throw new Error('Policy value must be numeric.');return n}
  if(typeof current==='boolean'){
    if(typeof value==='boolean')return value;const s=String(value).toLowerCase();if(['true','yes','on','1'].includes(s))return true;if(['false','no','off','0'].includes(s))return false;throw new Error('Policy value must be true or false.');
  }
  if(Array.isArray(current)){return Array.isArray(value)?value:String(value).split('|').map(x=>x.trim()).filter(Boolean)}
  return value;
}

export function policyDefaults(){return clone(DEFAULTS)}
export function effectivePolicy(target){
  const db=load();const base=DEFAULTS[target]||{};const override=db.agentPolicies?.[target]||{};return merge(base,override);
}
export function allEffectivePolicies(){return Object.fromEntries(ALLOWED_TARGETS.map(x=>[x,effectivePolicy(x)]))}
export function policyHistory(limit=100){return (load().agentPolicyHistory||[]).slice(0,Math.max(1,Math.min(500,Number(limit)||100)))}

export function setAgentPolicy(actor,target,path,value,reason='Aura runtime adjustment'){
  if(actor!=='Aura')throw new Error('Only Aura may alter agent policies.');validateTarget(target);validatePath(path);
  const before=effectivePolicy(target);const current=getPath(before,path);const coerced=coerceLike(current,value);
  const entry={id:crypto.randomUUID(),createdAt:now(),actor,target,path,before:clone(current),after:clone(coerced),reason};
  mutate(db=>{
    db.agentPolicies=db.agentPolicies||{};db.agentPolicies[target]=db.agentPolicies[target]||{};setPath(db.agentPolicies[target],path,coerced);
    db.agentPolicyHistory=db.agentPolicyHistory||[];db.agentPolicyHistory.unshift(entry);db.agentPolicyHistory=db.agentPolicyHistory.slice(0,1000);
  });
  return {...entry,effective:effectivePolicy(target)};
}
export function adjustAgentPolicy(actor,target,path,delta,reason='Aura runtime adjustment'){
  const current=getPath(effectivePolicy(target),path);if(typeof current!=='number')throw new Error('Only numeric policy values can be adjusted by a delta.');
  return setAgentPolicy(actor,target,path,current+Number(delta),reason);
}
export function resetAgentPolicy(actor,target,path=null,reason='Aura policy reset'){
  if(actor!=='Aura')throw new Error('Only Aura may alter agent policies.');validateTarget(target);if(path)validatePath(path);
  const before=effectivePolicy(target);const entry={id:crypto.randomUUID(),createdAt:now(),actor,target,path:path||'*',before:path?clone(getPath(before,path)):clone(before),after:path?clone(getPath(DEFAULTS[target]||{},path)):clone(DEFAULTS[target]||{}),reason,reset:true};
  mutate(db=>{
    db.agentPolicies=db.agentPolicies||{};
    if(!path) delete db.agentPolicies[target];
    else{
      const parts=path.split('.');let cur=db.agentPolicies[target];if(cur){for(const p of parts.slice(0,-1))cur=cur?.[p];if(cur)delete cur[parts.at(-1)]}
    }
    db.agentPolicyHistory=db.agentPolicyHistory||[];db.agentPolicyHistory.unshift(entry);db.agentPolicyHistory=db.agentPolicyHistory.slice(0,1000);
  });
  return {...entry,effective:effectivePolicy(target)};
}
export function rollbackPolicy(actor,historyId){
  if(actor!=='Aura')throw new Error('Only Aura may roll back policy changes.');const h=policyHistory(1000).find(x=>x.id===historyId);if(!h)throw new Error('Policy history entry not found.');
  return setAgentPolicy(actor,h.target,h.path,h.before,`Rollback of ${historyId}`);
}
export function describePolicy(target){return {target,effective:effectivePolicy(target),overrides:clone(load().agentPolicies?.[target]||{})}}

export function isHighRiskPolicyChange(target,path,before,after){
  const p=String(path||'');
  if(target==='Friday'&&(/approveMinScore|reasonPenalty|requireContact|minEvidence/.test(p))){
    if(p.endsWith('requireContact')&&after===false)return true;
    if(typeof before==='number'&&typeof after==='number'&&after<before)return true;
  }
  if(target==='Vision'&&p.endsWith('kwhMin')&&Number(after)<Number(before)*0.8)return true;
  if(target==='Peter'&&(/kwhMin|kwhMax/.test(p)))return true;
  if(target==='MJ'&&p.endsWith('apartmentMinUnits')&&Number(after)<Number(before)*0.8)return true;
  if(/batchSize|maxCandidatesPerQuery/.test(p)&&Number(after)>20)return true;
  return false;
}
