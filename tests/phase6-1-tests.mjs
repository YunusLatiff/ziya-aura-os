import assert from 'node:assert/strict';
import {effectivePolicy,setAgentPolicy,adjustAgentPolicy,resetAgentPolicy} from '../src/agent-policy.mjs';
import {auraConversationStatus} from '../src/aura-conversation.mjs';

const v=effectivePolicy('Vision');assert.equal(v.research.kwhMin>=100000,true);
const before=effectivePolicy('Friday').scoring.approveMinScore;
const changed=adjustAgentPolicy('Aura','Friday','scoring.approveMinScore',1,'test');assert.equal(changed.effective.scoring.approveMinScore,before+1);
resetAgentPolicy('Aura','Friday','scoring.approveMinScore','test reset');assert.equal(effectivePolicy('Friday').scoring.approveMinScore,before);
assert.throws(()=>setAgentPolicy('Aura','Tony','research.kwhMin',1),/protected/i);
assert.throws(()=>setAgentPolicy('Aura','Vision','authority',1),/protected/i);
const status=auraConversationStatus();assert.equal(status.voiceOnly,true);assert.equal(status.alwaysListen,!!status.llmEnabled&&!!status.requestedAlwaysListen);
console.log('Aura OS v0.6.1 conversational voice and agent governance tests passed. Tony remains protected.');
