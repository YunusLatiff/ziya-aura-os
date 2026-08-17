import assert from 'node:assert/strict';

process.env.AURA_LLM_ENABLED='false';
process.env.AURA_ALWAYS_LISTEN='true';
const mod=await import('../src/aura-conversation.mjs');

assert.equal(mod.auraLlmEnabled(),false);
let status=mod.auraConversationStatus();
assert.equal(status.llmEnabled,false);
assert.equal(status.dormant,true);
assert.equal(status.alwaysListen,false,'Always-listening must be forced off while the LLM is dormant.');

let fetchCalled=false;
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{fetchCalled=true;throw new Error('fetch must not be called while dormant')};
const result=await mod.converseWithAura('Aura, how are we looking?',{wakeDetected:true});
assert.equal(result.disabled,true);
assert.equal(fetchCalled,false,'Dormant conversational Aura must never call Ollama.');
globalThis.fetch=originalFetch;

process.env.AURA_LLM_ENABLED='true';
process.env.AURA_ALWAYS_LISTEN='false';
status=mod.auraConversationStatus();
assert.equal(status.llmEnabled,true);
assert.equal(status.dormant,false);
assert.equal(status.alwaysListen,false);

console.log('Aura OS v0.6.2 hardware-safe dormant-mode tests passed. Ollama and continuous microphone stay off while disabled. Tony remains protected.');
