import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dailyBatchStatus} from '../src/researcher.mjs';
import {eligiblePepperLeads,buildPepperDraft,ultronReviewDraft} from '../src/outreach.mjs';
import {policyDefaults} from '../src/agent-policy.mjs';

const now=new Date().toISOString();
const db={
  leadBatches:[
    {id:'v1',agent:'Vision',createdAt:now,status:'APPROVED'},
    {id:'v2',agent:'Vision',createdAt:now,status:'RESEARCHING'},
    {id:'v3',agent:'Vision',createdAt:now,status:'APPROVED'},
    {id:'p1',agent:'Peter',createdAt:now,status:'RESEARCHING'}
  ],
  leads:[],
  emailDrafts:[]
};
const daily=dailyBatchStatus('Vision',db);
assert.equal(daily.limit,3);
assert.equal(daily.started,3);
assert.equal(daily.remaining,0);
assert.equal(daily.completed,2);

const leadA={id:'a',batchId:'b1',agent:'Vision',fridayStatus:'APPROVED',companyName:'A Manufacturing',facilityType:'MANUFACTURING',address:'Germiston',contactPerson:'Thabo Molefe',email:'thabo@example.co.za'};
const leadB={...leadA,id:'b',batchId:'b2',companyName:'B Manufacturing'};
assert.deepEqual(eligiblePepperLeads({leadBatches:[],leads:[leadA,leadB],emailDrafts:[]}).map(x=>x.id),['a','b']);

const good=buildPepperDraft(leadA);
const goodReview=ultronReviewDraft(good,leadA);
assert.equal(goodReview.approved,true,goodReview.reasons.join('; '));
assert.match(good.body,/no upfront capital/i);

const offMessage={...good,body:`Hi Thabo,

I'm reaching out from Ziya Energy about A Manufacturing. We install solar systems. Would you like a call?

Kind regards,
Ziya Energy`};
const offReview=ultronReviewDraft(offMessage,leadA);
assert.equal(offReview.approved,false);
assert.ok(offReview.criticalReasons.some(x=>/zero-upfront/i.test(x)));

const defaults=policyDefaults();
assert.equal(defaults.Pepper.draft.allowIndividualApprovedLeads,true);
assert.ok(defaults.Ultron.qa.minScore<=80);

const researcherSource=fs.readFileSync(new URL('../src/researcher.mjs',import.meta.url),'utf8');
assert.match(researcherSource,/fridayReviewLead\(lead\.id\)/);
assert.match(researcherSource,/LEAD_PASSED_TO_PEPPER/);

console.log('Aura OS v0.8.7 tests passed. Three daily batches per researcher, streaming Friday→Pepper handoff and focused/less-strict Ultron QA verified.');
