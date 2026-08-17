import assert from 'node:assert/strict';
import {loadCrm,saveCrm} from '../src/crm-store.mjs';
import {syncLegacyAuraData,crmSummary,listOpportunities,sourcePerformance,publishAgentUpdate,changeOpportunityStage,markOpportunityWon,markOpportunityLost,answerCrmQuestion,CRM_SOURCES} from '../src/crm.mjs';

const original=loadCrm();
try{
  saveCrm({schemaVersion:1,companies:[],sites:[],contacts:[],opportunities:[],activities:[],tasks:[],documents:[],outreach:[],attributions:[],agentPublications:[],meta:{createdAt:new Date().toISOString()}});
  const lead={id:'crm-v-1',companyName:'CRM Test Manufacturing',agent:'Vision',facilityType:'MANUFACTURING',address:'1 Test Road, Germiston',website:'https://crm-test.example',contactPerson:'Alex Test',contactRole:'CFO',contactNumber:'0110000000',email:'alex@crm-test.example',estimatedKwhMin:120000,estimatedKwhMax:180000,usageConfidence:'HIGH',fridayStatus:'APPROVED',fridayScore:92,fridayReasons:[],evidence:[{url:'https://crm-test.example',detail:'test'}],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const draft={id:'crm-d-1',leadId:lead.id,companyName:lead.companyName,recipientEmail:lead.email,subject:'Test',status:'APPROVED',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const msg={id:'crm-m-1',leadId:lead.id,draftId:draft.id,companyName:lead.companyName,recipientEmail:lead.email,status:'SENT',sentAt:new Date().toISOString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  syncLegacyAuraData({leads:[lead],emailDrafts:[draft],outboundMessages:[msg],tonyObserver:null});
  let summary=crmSummary();assert.equal(summary.companies,1);assert.equal(summary.opportunities,1);assert.equal(summary.open,1);
  let opp=listOpportunities({limit:10})[0];assert.equal(opp.source,'Vision');assert.equal(opp.stage,'OUTREACH');assert.equal(opp.fridayScore,92);
  assert.equal(sourcePerformance().find(x=>x.source==='Vision').leads,1);
  assert.throws(()=>publishAgentUpdate('Tony',{type:'NOTE',summary:'No'}),/no CRM access/i);
  assert.throws(()=>publishAgentUpdate('Vision',{type:'OUTREACH_UPDATE',summary:'No'}),/may not publish/i);
  publishAgentUpdate('Vision',{type:'RESEARCH_UPDATE',opportunityId:opp.id,summary:'Research refreshed.'});
  changeOpportunityStage('Aura',opp.id,'NEGOTIATION',{ownerInstruction:true,reason:'Owner instruction'});
  syncLegacyAuraData({leads:[lead],emailDrafts:[draft],outboundMessages:[msg],tonyObserver:null});
  opp=listOpportunities({limit:10})[0];assert.equal(opp.stage,'NEGOTIATION','legacy agent sync must never downgrade an owner-progressed CRM stage');
  assert.throws(()=>markOpportunityWon('Aura',opp.id,{source:'Invalid',verifiedBy:'Owner'}),/valid source/i);
  const won=markOpportunityWon('Owner',opp.id,{source:'Vision',verifiedBy:'Owner'});assert.equal(won.opportunity.stage,'WON');assert.equal(won.attribution.confirmedSource,'Vision');
  assert.equal(CRM_SOURCES.includes('Natasha'),true);
  assert.match(answerCrmQuestion('how many projects are in the pipeline'),/0 open opportunities/i);
  assert.match(answerCrmQuestion('how is our lead database looking'),/1 unique companies/i);
  assert.throws(()=>markOpportunityLost('Vision',opp.id,{reason:'No'}),/Only Owner or Aura/i);
  summary=crmSummary();assert.equal(summary.won,1);
} finally {saveCrm(original)}
console.log('Aura OS v0.8.5 CRM Core tests passed. Agent permissions, legacy publishing, pipeline queries, owner-verified WON attribution and Tony protection verified.');
