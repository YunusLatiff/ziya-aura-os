import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const dbPath=path.join(root,'data','aura.json');
if(!fs.existsSync(dbPath)){
  console.error(`Aura database not found: ${dbPath}`);
  process.exit(1);
}

const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=path.join(root,'data',`aura.pre-v0.2.4-reset.${stamp}.json`);
const db=JSON.parse(fs.readFileSync(dbPath,'utf8'));
fs.copyFileSync(dbPath,backup);

// Clear only Phase 2 lead/outreach working data. Tony is intentionally never modified.
db.leads=[];
db.leadBatches=[];
db.emailDrafts=[];

const phase2EventTypes=new Set([
  'RESEARCH_QUERY','RESEARCH_ERROR','RESEARCH_BLOCKED','CANDIDATE_ERROR','CANDIDATE_SKIPPED','CANDIDATE_DUPLICATE',
  'LEAD_DISCOVERED','LEAD_REVIEW','BATCH_DISPATCH','BATCH_SUBMITTED','BATCH_APPROVED','BATCH_REWORK'
]);
if(Array.isArray(db.events)) db.events=db.events.filter(e=>!phase2EventTypes.has(e?.eventType));

for(const name of ['Vision','Peter','MJ','Friday','Pepper']){
  if(!db.agents?.[name]) continue;
  db.agents[name].status='WAITING';
  db.agents[name].currentTask=null;
  db.agents[name].lastError=null;
  db.agents[name].lastHeartbeat=new Date().toISOString();
}

if(db.meta){
  db.meta.leadCycleEnabled=false;
  db.meta.leadCycleChangedAt=new Date().toISOString();
  db.meta.leadCycleLastTickAt=null;
}

fs.writeFileSync(dbPath,JSON.stringify(db,null,2),'utf8');
console.log('Phase 2 lead data reset complete.');
console.log(`Backup: ${backup}`);
console.log('Tony was not modified. API keys were not modified.');
