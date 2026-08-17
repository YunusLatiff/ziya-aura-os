import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {leadQuotaStatus,quotaDecision,quotaMonthKey} from '../src/lead-quota.mjs';
import {tavilyBudgetDecision} from '../src/providers.mjs';
import {createCrmUiServer} from '../src/crm-ui-server.mjs';

process.env.LEADS_MONTHLY_APPROVED_CAP='180';
process.env.VISION_MONTHLY_APPROVED_CAP='60';
process.env.PETER_MONTHLY_APPROVED_CAP='60';
process.env.MJ_MONTHLY_APPROVED_CAP='60';
process.env.LEAD_QUOTA_TIMEZONE='Africa/Johannesburg';
process.env.TAVILY_MONTHLY_CREDIT_CAP='900';
process.env.TAVILY_USAGE_STOP_PERCENT='90';
process.env.TAVILY_CREDIT_RESERVE='25';

const stamp=new Date().toISOString();
const make=(agent,n)=>Array.from({length:n},(_,i)=>({id:`${agent}-${i}`,agent,fridayStatus:'APPROVED',fridayApprovedAt:stamp}));
let db={leads:[...make('Vision',59),...make('Peter',60),...make('MJ',60)]};
let q=leadQuotaStatus(db);
assert.equal(q.month,quotaMonthKey(new Date()));
assert.equal(q.global.used,179);
assert.equal(q.global.remaining,1);
assert.equal(q.agents.Vision.remaining,1);
assert.equal(quotaDecision('Vision',db).allowed,true);
assert.equal(quotaDecision('Peter',db).allowed,false);

db={leads:[...db.leads,...make('Vision',1)]};
q=leadQuotaStatus(db);
assert.equal(q.global.used,180);
assert.equal(q.global.reached,true);
assert.equal(quotaDecision('Vision',db).allowed,false);
assert.equal(quotaDecision('Vision',db).reason,'GLOBAL_MONTHLY_CAP_REACHED');

assert.equal(tavilyBudgetDecision(899,1000).blocked,false);
assert.equal(tavilyBudgetDecision(900,1000).blocked,true);
assert.equal(tavilyBudgetDecision(1000,1000).blocked,true);
assert.equal(tavilyBudgetDecision(900,1000).cap,900);

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ziya-crm-ui-'));
fs.writeFileSync(path.join(tmp,'index.html'),'<h1>Ziya CRM test</h1>');
const server=createCrmUiServer({publicDir:tmp,auraPort:65534});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const port=server.address().port;
const health=await fetch(`http://127.0.0.1:${port}/health`).then(r=>r.json());
assert.equal(health.ok,true);
const html=await fetch(`http://127.0.0.1:${port}/`).then(r=>r.text());
assert.match(html,/Ziya CRM test/);
await new Promise(resolve=>server.close(resolve));
fs.rmSync(tmp,{recursive:true,force:true});

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
assert.ok(/^0\.8\.(?:6|7|[89]|\d{2,})$/.test(pkg.version),`Expected Aura OS version 0.8.6 or later, got ${pkg.version}`);
assert.ok(fs.existsSync(new URL('../public/app.js',import.meta.url)));
assert.ok(fs.existsSync(new URL('../crm-public/app.js',import.meta.url)));

console.log('Aura OS v0.8.6 tests passed. Dual ports, 180 approved-lead monthly cap, 60/agent caps and 900-credit Tavily hard stop verified.');
