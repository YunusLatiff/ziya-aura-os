import fs from 'node:fs';
import path from 'node:path';

const ROOT=path.resolve(process.cwd(),'data');
const DB=path.join(ROOT,'crm.json');
fs.mkdirSync(ROOT,{recursive:true});

const empty=()=>({
  schemaVersion:1,
  companies:[],sites:[],contacts:[],opportunities:[],activities:[],tasks:[],documents:[],outreach:[],attributions:[],agentPublications:[],
  meta:{createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),lastLegacySyncAt:null}
});

function ensureShape(db){
  const base=empty();
  const out={...base,...(db&&typeof db==='object'?db:{})};
  for(const key of ['companies','sites','contacts','opportunities','activities','tasks','documents','outreach','attributions','agentPublications']) if(!Array.isArray(out[key])) out[key]=[];
  out.meta={...base.meta,...(out.meta||{})};
  out.schemaVersion=Number(out.schemaVersion||1);
  return out;
}

export function crmDbPath(){return DB}
export function loadCrm(){
  if(!fs.existsSync(DB))return empty();
  try{return ensureShape(JSON.parse(fs.readFileSync(DB,'utf8')))}catch{return empty()}
}

function sleep(ms){const start=Date.now();while(Date.now()-start<ms){}}
export function saveCrm(input){
  const db=ensureShape(input);db.meta.updatedAt=new Date().toISOString();
  const data=JSON.stringify(db,null,2);const tmp=path.join(ROOT,`crm.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp,data,'utf8');let lastError;
  for(let attempt=1;attempt<=8;attempt++){
    try{fs.renameSync(tmp,DB);return db}catch(error){lastError=error;if(!['EPERM','EBUSY','EACCES'].includes(error.code))throw error;sleep(attempt*60)}
  }
  try{fs.writeFileSync(DB,data,'utf8');try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{};return db}
  catch(fallbackError){try{if(fs.existsSync(tmp))fs.unlinkSync(tmp)}catch{};throw new Error(`CRM save failed. Rename error: ${lastError?.message}. Direct-write error: ${fallbackError.message}`)}
}

export function mutateCrm(fn){const db=loadCrm();const result=fn(db);saveCrm(db);return result}
export function resetCrmForTests(){saveCrm(empty());return loadCrm()}
