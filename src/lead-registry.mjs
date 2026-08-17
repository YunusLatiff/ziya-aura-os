import crypto from 'node:crypto';
import {canonicalEntityName,canonicalAddress,domainOf,sameEntity} from './lead-intelligence.mjs';

function now(){return new Date().toISOString()}
function normPhone(s=''){return String(s).replace(/\D/g,'').replace(/^27/,'0')}
function emailDomain(e=''){const p=String(e).toLowerCase().split('@');return p.length===2?p[1]:''}
function distanceM(a,b){
  if(!Number.isFinite(a?.lat)||!Number.isFinite(a?.lon)||!Number.isFinite(b?.lat)||!Number.isFinite(b?.lon)) return Infinity;
  const R=6371000,rad=x=>x*Math.PI/180;
  const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
  const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}

export function ensureLeadRegistry(db){
  if(!Array.isArray(db.leadRegistry)) db.leadRegistry=[];
  return db.leadRegistry;
}

export function registryIdentity(x={}){
  return {
    canonicalName:canonicalEntityName(x.companyName||x.title||''),
    canonicalAddress:canonicalAddress(x.address||''),
    domain:domainOf(x.website||x.url||''),
    phone:normPhone(x.contactNumber||x.phone||''),
    emailDomain:emailDomain(x.email||''),
    placeId:x.placeId||'',
    lat:Number.isFinite(Number(x.lat))?Number(x.lat):null,
    lon:Number.isFinite(Number(x.lon))?Number(x.lon):null
  };
}

export function registryMatch(candidate,entry){
  const a=registryIdentity(candidate),b=registryIdentity(entry);
  if(a.placeId&&b.placeId&&a.placeId===b.placeId) return {match:true,reason:'same Geoapify place ID'};
  const compact=x=>String(x||'').replace(/\s+/g,'');
  const nameSame=a.canonicalName&&b.canonicalName&&(a.canonicalName===b.canonicalName||compact(a.canonicalName)===compact(b.canonicalName));
  const nameSimilar=sameEntity({companyName:a.canonicalName},{companyName:b.canonicalName});
  const addressSame=a.canonicalAddress&&b.canonicalAddress&&(a.canonicalAddress===b.canonicalAddress||a.canonicalAddress.includes(b.canonicalAddress)||b.canonicalAddress.includes(a.canonicalAddress));
  const near=distanceM(a,b)<=300;
  if(nameSame&&(addressSame||near)) return {match:true,reason:addressSame?'same canonical name + address':'same canonical name + nearby coordinates'};
  if(nameSimilar&&addressSame) return {match:true,reason:'similar canonical name + address'};
  if(nameSimilar&&near) return {match:true,reason:'similar canonical name + nearby coordinates'};
  if(a.phone&&b.phone&&a.phone===b.phone&&nameSimilar) return {match:true,reason:'same phone + matching entity name'};
  if(a.domain&&b.domain&&a.domain===b.domain&&nameSimilar) return {match:true,reason:'same website domain + matching entity name'};
  return {match:false,reason:''};
}

export function findRegistryDuplicate(candidate,registry=[],excludeLeadId=''){
  for(const entry of registry){
    if(excludeLeadId&&entry.firstLeadId===excludeLeadId) continue;
    const m=registryMatch(candidate,entry);
    if(m.match) return {...m,entry};
  }
  return null;
}

export function registerLead(db,lead){
  const registry=ensureLeadRegistry(db);
  const duplicate=findRegistryDuplicate(lead,registry,lead.id);
  if(duplicate) return duplicate.entry;
  const id=registryIdentity(lead);
  const entry={
    id:crypto.randomUUID(),firstLeadId:lead.id||null,firstBatchId:lead.batchId||null,firstBatchNumber:null,
    firstAgent:lead.agent||null,firstSeenAt:lead.createdAt||now(),lastSeenAt:now(),seenCount:1,
    companyName:lead.companyName||'',address:lead.address||'',website:lead.website||'',contactNumber:lead.contactNumber||'',email:lead.email||'',
    placeId:lead.placeId||'',lat:lead.lat??null,lon:lead.lon??null,...id
  };
  const batch=(db.leadBatches||[]).find(b=>b.id===lead.batchId);
  entry.firstBatchNumber=batch?.batchNumber??null;
  registry.push(entry);
  return entry;
}

export function markDuplicateSeen(db,duplicate,agent,batchId){
  const entry=(db.leadRegistry||[]).find(x=>x.id===duplicate?.entry?.id);
  if(!entry) return;
  entry.lastSeenAt=now();entry.seenCount=(entry.seenCount||1)+1;
  entry.lastDuplicateAgent=agent||null;entry.lastDuplicateBatchId=batchId||null;
}

export function migrateRegistryFromLeads(db){
  ensureLeadRegistry(db);
  for(const lead of db.leads||[]) registerLead(db,lead);
  return db.leadRegistry.length;
}
