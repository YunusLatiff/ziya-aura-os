import assert from 'node:assert/strict';
import {buildPepperDraft,ultronReviewDraft,revisePepperDraft,eligiblePepperLeads} from '../src/outreach.mjs';

const lead={id:'lead-1',batchId:'batch-1',agent:'Vision',fridayStatus:'APPROVED',companyName:'Example Manufacturing',facilityType:'MANUFACTURING',address:'Wadeville, Germiston, Gauteng, South Africa',contactPerson:'Thabo Molefe',email:'thabo@example.co.za'};
const draft=buildPepperDraft(lead,{id:'batch-1'});
assert.equal(draft.status,'ULTRON_REVIEW');
assert.match(draft.subject,/Example Manufacturing/);
assert.match(draft.body,/publicly available information/i);
assert.match(draft.body,/no upfront capital/i);
assert.match(draft.body,/actual electricity consumption/i);
assert.doesNotMatch(draft.body,/guaranteed|massive savings|\d+%/i);

let review=ultronReviewDraft(draft,lead);
assert.equal(review.approved,true,review.reasons.join('; '));

const bad={...draft,body:'Dear Sir, ACT NOW! Guaranteed 40% massive savings. ROI of 60%. Call me!'};
review=ultronReviewDraft(bad,lead);
assert.equal(review.approved,false);
assert.ok(review.criticalReasons.length>=3);
const revised=revisePepperDraft(bad,lead,review);
assert.equal(revised.version,2);
assert.equal(ultronReviewDraft(revised,lead).approved,true);

const db={
  leadBatches:[{id:'batch-1',readyForPepper:false},{id:'batch-2',readyForPepper:false}],
  leads:[lead,{...lead,id:'lead-2',batchId:'batch-2'}],
  emailDrafts:[]
};
assert.deepEqual(eligiblePepperLeads(db).map(x=>x.id),['lead-1','lead-2']);
assert.throws(()=>buildPepperDraft({...lead,id:'bad',fridayStatus:'REWORK'}),/Friday-approved/);

console.log('Aura OS Phase 3 tests passed. Friday-approved leads stream individually to Pepper; Ultron checks core commercial points without over-policing style.');
