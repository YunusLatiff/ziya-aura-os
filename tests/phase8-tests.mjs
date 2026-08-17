import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {recoverInterruptedOutboundReservations,eligibleOutboundDrafts,outboundStatus,deliveryUnknownMessages,resolveDeliveryUnknown} from '../src/outbound.mjs';
import {load,save} from '../src/store.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageJson=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.match(packageJson.version,/^0\.8\.(?:[0-9]+)$/);
for(const rel of [
  'start-aura.ps1','ziya-watchdog.ps1','configure-production.ps1','install-ziya-autostart.ps1',
  'uninstall-ziya-autostart.ps1','status-ziya-system.ps1','stop-ziya-system.ps1','backup-aura.ps1',
  'restore-aura-backup.ps1','resolve-outbound-recovery.ps1','production/ziya-production-lib.ps1'
]) assert.equal(fs.existsSync(path.join(root,rel)),true,`${rel} must exist`);

const start=fs.readFileSync(path.join(root,'start-aura.ps1'),'utf8');
assert.match(start,/Start-TonyExternal/);
assert.match(start,/Start-WatchdogExternal/);
const watchdog=fs.readFileSync(path.join(root,'ziya-watchdog.ps1'),'utf8');
assert.match(watchdog,/Start-AuraServerExternal/);
assert.match(watchdog,/Start-TonyExternal/);
assert.match(watchdog,/New-AuraStateBackup/);

const original=load();
try{
  const old=new Date(Date.now()-20*60_000).toISOString();
  const lead={id:'p8-lead',companyName:'Phase 8 Test',email:'test@example.org',fridayStatus:'APPROVED'};
  const draft={id:'p8-draft',leadId:lead.id,recipientEmail:lead.email,status:'SENDING',subject:'Test',body:'Test'};
  const msg={id:'p8-msg',draftId:draft.id,leadId:lead.id,recipientEmail:lead.email,status:'SENDING',createdAt:old,updatedAt:old};
  save({...original,leads:[...(original.leads||[]).filter(x=>x.id!==lead.id),lead],emailDrafts:[...(original.emailDrafts||[]).filter(x=>x.id!==draft.id),draft],outboundMessages:[...(original.outboundMessages||[]).filter(x=>x.id!==msg.id),msg]});
  const recovered=recoverInterruptedOutboundReservations({olderThanMinutes:10});
  assert.equal(recovered.count,1);
  const db=load();
  assert.equal(db.outboundMessages.find(x=>x.id===msg.id)?.status,'DELIVERY_UNKNOWN');
  assert.equal(db.emailDrafts.find(x=>x.id===draft.id)?.status,'DELIVERY_UNKNOWN');
  assert.equal(eligibleOutboundDrafts(db).some(x=>x.id===draft.id),false,'unknown-delivery draft must not be automatically queued');
  assert.ok(outboundStatus().deliveryUnknownTotal>=1);
  assert.equal(deliveryUnknownMessages().some(x=>x.id===msg.id),true);
  const resolution=resolveDeliveryUnknown(msg.id,'RELEASE_FOR_RETRY');
  assert.equal(resolution.status,'RETRY_RELEASED');
  const released=load();
  assert.equal(released.emailDrafts.find(x=>x.id===draft.id)?.status,'APPROVED');
} finally {
  save(original);
}

console.log('Aura OS v0.8.0 Phase 8 production-hardening tests passed. Aura startup supervises Tony externally; watchdog, backups and no-blind-resend recovery verified.');
