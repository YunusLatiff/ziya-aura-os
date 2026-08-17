import assert from 'node:assert/strict';
import {mayCommand} from '../src/agents.mjs';
import {reviewLead} from '../src/friday.mjs';
import {classifyLead,isProbableDuplicate} from '../src/lead-intelligence.mjs';

assert.equal(mayCommand('Aura','Vision'),true);
assert.equal(mayCommand('Friday','Vision'),true);
assert.equal(mayCommand('Friday','Ultron'),false);
assert.equal(mayCommand('Ultron','Pepper'),true);
for(const actor of ['Aura','Steve','Friday','Vision','Peter','MJ','Pepper','Ultron']) assert.equal(mayCommand(actor,'Tony'),false,`${actor} must never command Tony`);

const base={id:'1',companyName:'TEST Industrial',address:'1 Test Road',website:'https://example.org',contactPerson:'',contactRole:'',contactNumber:'011 000 0000',email:'info@example.org',evidence:[{url:'https://example.org',detail:'test'},{url:'https://example.org/about',detail:'test'}],dedupeKey:'test|1'};
let r=reviewLead({...base,agent:'Vision',facilityType:'MANUFACTURING',estimatedKwhMin:120000,estimatedKwhMax:240000,usageConfidence:'MEDIUM'},[]);assert.equal(r.status,'APPROVED');
r=reviewLead({...base,id:'2',agent:'Vision',facilityType:'MANUFACTURING',estimatedKwhMin:80000,estimatedKwhMax:180000,usageConfidence:'MEDIUM'},[]);assert.equal(r.status,'REJECTED');
r=reviewLead({...base,id:'3',agent:'Peter',facilityType:'OFFICE_PARK',estimatedKwhMin:5000,estimatedKwhMax:65000,usageConfidence:'MEDIUM'},[]);assert.equal(r.status,'APPROVED');
r=reviewLead({...base,id:'4',agent:'MJ',facilityType:'APARTMENT_COMPLEX',unitCount:69,usageConfidence:'HIGH'},[]);assert.equal(r.status,'REJECTED');
r=reviewLead({...base,id:'5',agent:'MJ',facilityType:'APARTMENT_COMPLEX',unitCount:70,usageConfidence:'HIGH'},[]);assert.equal(r.status,'APPROVED');
assert.equal(classifyLead('Vision','Johannesburg business directory',[]).facilityType,'UNKNOWN');
assert.equal(classifyLead('Peter','Nike Factory Store sale outlet',[]).facilityType,'UNKNOWN');
assert.equal(classifyLead('MJ','generic Johannesburg property page',[]).facilityType,'UNKNOWN');
console.log('Aura OS v0.2.5 tests passed. Tony protection, lead integrity, canonical dedupe and Friday rules enforced.');

const dupA={id:'a',companyName:'SkyView Retail Park',address:'Strydom Park, Randburg, South Africa',website:'',fridayStatus:'APPROVED'};
const dupB={id:'b',companyName:'SkyView Retail Park',address:'Randburg, 2167, South Africa',website:'',fridayStatus:'PENDING'};
assert.equal(isProbableDuplicate(dupA,dupB),true);
r=reviewLead({...base,id:'6',agent:'MJ',facilityType:'ESTATE',usageConfidence:'MEDIUM',integrityStatus:'FAIL',integrityReasons:['Generic road/street/location, not a named residential development.']},[]);
assert.equal(r.status,'REJECTED');

import {registryMatch} from '../src/lead-registry.mjs';
assert.equal(registryMatch({companyName:'SkyView Retail Park',address:'1 Main Road, Randburg'},{companyName:'Sky View Retail Park',address:'1 Main Rd Randburg'}).match,true);
assert.equal(registryMatch({companyName:'Brand Store Sandton',address:'Sandton'},{companyName:'Brand Store Pretoria',address:'Pretoria'}).match,false);
console.log('Aura OS v0.2.5 registry tests passed.');
