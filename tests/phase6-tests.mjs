import assert from 'node:assert/strict';
import {executeAuraCommand} from '../src/aura-interface.mjs';
import {load,mutate} from '../src/store.mjs';
import {seed} from '../src/orchestrator.mjs';

seed();
let r=await executeAuraCommand('status');
assert.equal(r.ok,true);assert.match(r.reply,/leads discovered/i);
r=await executeAuraCommand('pause Tony');
assert.equal(r.ok,false);assert.match(r.reply,/protected/i);
r=await executeAuraCommand('pause Vision');
assert.equal(r.ok,true);assert.equal(load().agents.Vision.status,'PAUSED');
r=await executeAuraCommand('resume Vision');
assert.equal(r.ok,true);assert.equal(load().agents.Vision.status,'WAITING');
r=await executeAuraCommand('help');assert.match(r.reply,/health scan/i);
console.log('Aura OS v0.6.0 Phase 6 tests passed. Text command parsing, hierarchy enforcement and Tony protection verified.');
