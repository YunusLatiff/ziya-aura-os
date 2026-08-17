import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {mayCommand} from '../src/agents.mjs';
import {tonyObserverCapabilities,summarizeTonyState,inspectTony,buildTonyProcessProbe} from '../src/tony-observer.mjs';

assert.equal(mayCommand('Aura','Tony'),false);
assert.equal(mayCommand('Steve','Tony'),false);
assert.equal(mayCommand('Friday','Tony'),false);

const caps=tonyObserverCapabilities();
assert.equal(caps.readOnly,true);
assert.equal(caps.commandsAllowed,false);
assert.equal(caps.modificationAllowed,false);
assert.equal(caps.readsTonyEnv,false);
assert.equal(caps.writesToTony,false);

const summary=summarizeTonyState({jobs:{
  a:{messageKey:'a',status:'COMPLETED',company:'Alpha',assessmentId:'ZE-2026-00001',updatedAt:'2026-08-16T08:00:00.000Z'},
  b:{messageKey:'b',status:'NEEDS_REVIEW',company:'Beta',updatedAt:'2026-08-16T09:00:00.000Z'},
  c:{messageKey:'c',status:'GENERATING_PDF',company:'Gamma',updatedAt:'2026-08-16T10:00:00.000Z'}
}});
assert.equal(summary.counts.COMPLETED,1);
assert.equal(summary.counts.NEEDS_REVIEW,1);
assert.equal(summary.activeJob.company,'Gamma');
assert.equal(summary.latestJob.company,'Gamma');

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'aura-tony-observer-'));
const project=path.join(tmp,'Tony-Ziya-Assessment-Agent-v0.4-Direct-Mail');
const completed=path.join(tmp,'Automated Assessment');
fs.mkdirSync(path.join(project,'data','processed','ZE-2026-00001'),{recursive:true});
fs.mkdirSync(path.join(project,'data','pending'),{recursive:true});
fs.mkdirSync(path.join(project,'data','failed'),{recursive:true});
fs.mkdirSync(path.join(project,'logs'),{recursive:true});
fs.mkdirSync(path.join(completed,'Alpha'),{recursive:true});
fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({name:'tony-ziya-assessment-agent'}));
fs.writeFileSync(path.join(project,'data','state.json'),JSON.stringify({counter:1,year:2026,jobs:{a:{messageKey:'a',status:'COMPLETED',company:'Alpha',assessmentId:'ZE-2026-00001',updatedAt:new Date().toISOString(),pdfPath:path.join(completed,'Alpha','Alpha - ZE-2026-00001 - Energy Assessment.pdf')}}}));
fs.writeFileSync(path.join(project,'data','processed','ZE-2026-00001','assessment.json'),'{}');
fs.writeFileSync(path.join(project,'logs','tony.log'),`${new Date().toISOString()} INFO  Tony connected to direct IMAP\n`);
fs.writeFileSync(path.join(completed,'Alpha','Alpha - ZE-2026-00001 - Energy Assessment.pdf'),'pdf');

const observed=await inspectTony({projectRoot:project,completedRoot:completed,processResult:{supported:true,running:true,processes:[{pid:123,name:'node.exe'}],error:null}});
assert.equal(observed.status,'RUNNING');
assert.equal(observed.running,true);
assert.equal(observed.jobs.COMPLETED,1);
assert.equal(observed.processedAssessments,1);
assert.equal(observed.completed.total,1);
assert.match(observed.completed.latest.name,/Alpha/);
assert.equal(observed.capabilities.writesToTony,false);

const probe=buildTonyProcessProbe(project);
assert.match(probe,/Get-CimInstance Win32_Process/);
assert.doesNotMatch(probe,/Stop-Process|Terminate|Kill|Remove-Item|Set-Content|Out-File/i);

fs.rmSync(tmp,{recursive:true,force:true});
console.log('Aura OS v0.7.0 Phase 7 tests passed. Tony observation is read-only; commands, modification, credentials and Tony env access remain blocked.');
