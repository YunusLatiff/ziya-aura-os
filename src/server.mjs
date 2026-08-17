import './env.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {seed,snapshot,command,logEvent} from './orchestrator.mjs';
import {load} from './store.mjs';
import {setLeadCycle,leadCycleStatus,startScheduler,tick} from './scheduler.mjs';
import {fridayReview} from './researcher.mjs';
import {refreshProviderStatus} from './providers.mjs';
import {setOutreachCycle,outreachStatus,outreachStep,ultronReviewDraft} from './outreach.mjs';
import {startOutreachScheduler,outreachTick} from './outreach-scheduler.mjs';
import {startOutboundScheduler,outboundTick} from './outbound-scheduler.mjs';
import {outboundStatus,setOutboundCycle,sendOneApproved,addDoNotContact,recoverInterruptedOutboundReservations,deliveryUnknownMessages,resolveDeliveryUnknown} from './outbound.mjs';
import {monitoringStatus,runHealthScan,generateSteveReport,emailSteveReport} from './monitor.mjs';
import {startMonitorScheduler} from './monitor-scheduler.mjs';
import {executeAuraCommand,commandHistory} from './aura-interface.mjs';
import {converseWithAura,auraConversationStatus,conversationHistory} from './aura-conversation.mjs';
import {allEffectivePolicies,policyHistory,setAgentPolicy,resetAgentPolicy,rollbackPolicy} from './agent-policy.mjs';
import {tonyObserverStatus,refreshTonyObservation} from './tony-observer.mjs';
import {startTonyObserverScheduler} from './tony-observer-scheduler.mjs';
import {initCrm,syncLegacyAuraData,crmSummary,listCompanies,listOpportunities,getOpportunity,listActivities,listTasks,sourcePerformance,agentPerformance,changeOpportunityStage,markOpportunityWon,markOpportunityLost,addTask,publishAgentUpdate,CRM_SOURCES,CRM_STAGES} from './crm.mjs';
import {startCrmScheduler,crmSyncTick} from './crm-scheduler.mjs';
import {leadQuotaStatus} from './lead-quota.mjs';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const publicDir=path.resolve(__dirname,'../public');
const port=Number(process.env.AURA_PORT||4310);
const crmUiPort=Number(process.env.CRM_PORT||4311);
const clients=new Set();
seed();recoverInterruptedOutboundReservations();initCrm();syncLegacyAuraData();startScheduler();startOutreachScheduler();startOutboundScheduler();startMonitorScheduler();startTonyObserverScheduler();startCrmScheduler();
function json(res,status,obj){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(obj))}
function body(req){return new Promise((resolve,reject)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e6)req.destroy()});req.on('end',()=>{try{resolve(s?JSON.parse(s):{})}catch(e){reject(e)}});req.on('error',reject)})}
function broadcast(event){const msg=`data: ${JSON.stringify(event)}\n\n`;for(const res of clients){try{res.write(msg)}catch{clients.delete(res)}}}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(url.pathname==='/api/status'&&req.method==='GET'){await refreshProviderStatus();return json(res,200,{...snapshot(),leadCycle:leadCycleStatus(),leadQuota:leadQuotaStatus(),outreach:outreachStatus(),outbound:outboundStatus(),monitoring:monitoringStatus(),auraConversation:auraConversationStatus(),tonyObserver:tonyObserverStatus(),crm:crmSummary(),crmUi:{port:crmUiPort,url:`http://localhost:${crmUiPort}`}})}
  if(url.pathname==='/api/lead-quota'&&req.method==='GET')return json(res,200,leadQuotaStatus());
  if(url.pathname==='/api/events'&&req.method==='GET')return json(res,200,snapshot().events);
  if(url.pathname==='/api/leads'&&req.method==='GET'){const db=load();const agent=url.searchParams.get('agent');const status=url.searchParams.get('status');let leads=db.leads||[];if(agent)leads=leads.filter(x=>x.agent===agent);if(status)leads=leads.filter(x=>x.fridayStatus===status);return json(res,200,leads.slice().reverse().slice(0,500))}
  if(url.pathname==='/api/batches'&&req.method==='GET')return json(res,200,(load().leadBatches||[]).slice(0,200));
  if(url.pathname==='/api/drafts'&&req.method==='GET')return json(res,200,(load().emailDrafts||[]).slice(0,300));
  if(url.pathname==='/api/aura/history'&&req.method==='GET')return json(res,200,commandHistory(Number(url.searchParams.get('limit')||40)));
  if(url.pathname==='/api/aura/conversation-history'&&req.method==='GET')return json(res,200,conversationHistory(Number(url.searchParams.get('limit')||30)));
  if(url.pathname==='/api/aura/converse'&&req.method==='POST'){try{const b=await body(req);const result=await converseWithAura(b.text||'',{wakeDetected:!!b.wakeDetected,conversationActive:!!b.conversationActive});broadcast({type:'refresh'});return json(res,result.ok===false?400:200,result)}catch(e){return json(res,500,{error:String(e)})}}
  if(url.pathname==='/api/aura/policies'&&req.method==='GET')return json(res,200,{policies:allEffectivePolicies(),history:policyHistory(50)});
  if(url.pathname==='/api/aura/policies'&&req.method==='POST'){try{const b=await body(req);const result=setAgentPolicy('Aura',b.target,b.path,b.value,b.reason||'Dashboard policy change');broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e)})}}
  if(url.pathname==='/api/aura/policies/reset'&&req.method==='POST'){try{const b=await body(req);const result=resetAgentPolicy('Aura',b.target,b.path||null,b.reason||'Dashboard policy reset');broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e)})}}
  if(url.pathname==='/api/aura/policies/rollback'&&req.method==='POST'){try{const b=await body(req);const result=rollbackPolicy('Aura',b.historyId);broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e)})}}
  if(url.pathname==='/api/aura/command'&&req.method==='POST'){try{const b=await body(req);const result=await executeAuraCommand(b.text||'');broadcast({type:'refresh'});return json(res,result.ok?200:400,result)}catch(e){return json(res,500,{error:String(e)})}}
  if(url.pathname==='/api/crm/summary'&&req.method==='GET')return json(res,200,crmSummary());
  if(url.pathname==='/api/crm/companies'&&req.method==='GET')return json(res,200,listCompanies({limit:url.searchParams.get('limit')||500,search:url.searchParams.get('search')||''}));
  if(url.pathname==='/api/crm/opportunities'&&req.method==='GET')return json(res,200,listOpportunities({limit:url.searchParams.get('limit')||500,stage:url.searchParams.get('stage')||'',source:url.searchParams.get('source')||'',search:url.searchParams.get('search')||''}));
  if(url.pathname==='/api/crm/activities'&&req.method==='GET')return json(res,200,listActivities({limit:url.searchParams.get('limit')||200,opportunityId:url.searchParams.get('opportunityId')||null,actor:url.searchParams.get('actor')||null}));
  if(url.pathname==='/api/crm/tasks'&&req.method==='GET')return json(res,200,listTasks({limit:url.searchParams.get('limit')||300,assignedTo:url.searchParams.get('assignedTo')||'',status:url.searchParams.get('status')||''}));
  if(url.pathname==='/api/crm/source-performance'&&req.method==='GET')return json(res,200,sourcePerformance());
  if(url.pathname==='/api/crm/agent-performance'&&req.method==='GET')return json(res,200,agentPerformance());
  if(url.pathname==='/api/crm/config'&&req.method==='GET')return json(res,200,{sources:CRM_SOURCES,stages:CRM_STAGES});
  if(url.pathname==='/api/crm/sync'&&req.method==='POST'){try{return json(res,200,{ok:true,...await crmSyncTick()})}catch(e){return json(res,500,{error:String(e.message||e)})}}
  if(url.pathname==='/api/crm/publish'&&req.method==='POST'){try{const b=await body(req);const result=publishAgentUpdate(b.actor,b.payload||{});broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,403,{error:String(e.message||e)})}}
  if(url.pathname==='/api/crm/tasks'&&req.method==='POST'){try{const b=await body(req);const result=addTask(b.actor||'Owner',b.task||b);broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e.message||e)})}}
  const crmOpp=url.pathname.match(/^\/api\/crm\/opportunities\/([^/]+)$/);
  if(crmOpp&&req.method==='GET'){const result=getOpportunity(decodeURIComponent(crmOpp[1]));return result?json(res,200,result):json(res,404,{error:'Opportunity not found.'})}
  const crmStage=url.pathname.match(/^\/api\/crm\/opportunities\/([^/]+)\/stage$/);
  if(crmStage&&req.method==='POST'){try{const b=await body(req);const result=changeOpportunityStage(b.actor||'Owner',decodeURIComponent(crmStage[1]),b.stage,{reason:b.reason||'',ownerInstruction:!!b.ownerInstruction});broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e.message||e)})}}
  const crmWon=url.pathname.match(/^\/api\/crm\/opportunities\/([^/]+)\/won$/);
  if(crmWon&&req.method==='POST'){try{const b=await body(req);const result=markOpportunityWon(b.actor||'Owner',decodeURIComponent(crmWon[1]),{source:b.source,verifiedBy:'Owner',reason:b.reason||'Owner confirmed deal won'});broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e.message||e)})}}
  const crmLost=url.pathname.match(/^\/api\/crm\/opportunities\/([^/]+)\/lost$/);
  if(crmLost&&req.method==='POST'){try{const b=await body(req);const result=markOpportunityLost(b.actor||'Owner',decodeURIComponent(crmLost[1]),{reason:b.reason,ownerInstruction:!!b.ownerInstruction});broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e.message||e)})}}
  if(url.pathname==='/api/tony/status'&&req.method==='GET')return json(res,200,tonyObserverStatus());
  if(url.pathname==='/api/tony/refresh'&&req.method==='POST'){try{const result=await refreshTonyObservation();broadcast({type:'refresh'});return json(res,200,{ok:true,...result})}catch(e){return json(res,500,{error:String(e)})}}

  if(url.pathname==='/api/monitor/scan'&&req.method==='POST'){try{const result=await runHealthScan();broadcast({type:'refresh'});return json(res,200,{ok:true,...result})}catch(e){return json(res,500,{error:String(e)})}}
  if(url.pathname==='/api/monitor/report'&&req.method==='POST'){try{const result=await generateSteveReport();broadcast({type:'refresh'});return json(res,200,{ok:true,report:result})}catch(e){return json(res,500,{error:String(e)})}}
  if(url.pathname==='/api/monitor/report-email'&&req.method==='POST'){try{const b=await body(req);const result=await emailSteveReport(b.reportId||null);broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e)})}}
  if(url.pathname==='/api/outreach/start'&&req.method==='POST'){const result=setOutreachCycle(true);broadcast({type:'refresh'});queueMicrotask(()=>outreachTick().catch(()=>{}));return json(res,200,result)}
  if(url.pathname==='/api/outreach/stop'&&req.method==='POST'){const result=setOutreachCycle(false);broadcast({type:'refresh'});return json(res,200,result)}
  if(url.pathname==='/api/outreach/run-once'&&req.method==='POST'){try{const result=await outreachStep();broadcast({type:'refresh'});return json(res,200,{ok:true,...result})}catch(e){return json(res,500,{error:String(e)})}}
  if(url.pathname==='/api/outbound/start'&&req.method==='POST'){try{const result=setOutboundCycle(true);broadcast({type:'refresh'});queueMicrotask(()=>outboundTick().catch(()=>{}));return json(res,200,result)}catch(e){return json(res,400,{error:String(e)})}}
  if(url.pathname==='/api/outbound/stop'&&req.method==='POST'){try{const result=setOutboundCycle(false);broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e)})}}
  if(url.pathname==='/api/outbound/send-one'&&req.method==='POST'){try{const result=await sendOneApproved();broadcast({type:'refresh'});return json(res,200,{ok:true,...result})}catch(e){return json(res,500,{error:String(e)})}}
  if(url.pathname==='/api/outbound/dnc'&&req.method==='POST'){try{const b=await body(req);const result=addDoNotContact(b.email,b.reason||'Manual do-not-contact');broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e)})}}
  if(url.pathname==='/api/outbound/recovery'&&req.method==='GET')return json(res,200,deliveryUnknownMessages());
  if(url.pathname==='/api/outbound/recovery/resolve'&&req.method==='POST'){try{const b=await body(req);const result=resolveDeliveryUnknown(b.messageId,b.resolution);broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e)})}}
  if(url.pathname==='/api/lead-cycle/start'&&req.method==='POST'){const result=setLeadCycle(true);broadcast({type:'refresh'});return json(res,200,result)}
  if(url.pathname==='/api/lead-cycle/stop'&&req.method==='POST'){const result=setLeadCycle(false);broadcast({type:'refresh'});return json(res,200,result)}
  if(url.pathname==='/api/lead-cycle/run-once'&&req.method==='POST'){try{await tick();broadcast({type:'refresh'});return json(res,200,{ok:true,...leadCycleStatus()})}catch(e){return json(res,500,{error:String(e)})}}
  const review=url.pathname.match(/^\/api\/batches\/([^/]+)\/review$/);
  if(review&&req.method==='POST'){try{const result=fridayReview(decodeURIComponent(review[1]));broadcast({type:'refresh'});return json(res,200,result)}catch(e){return json(res,400,{error:String(e)})}}
  if(url.pathname==='/api/stream'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(`data: ${JSON.stringify({type:'connected'})}\n\n`);clients.add(res);req.on('close',()=>clients.delete(res));return;}
  const m=url.pathname.match(/^\/api\/agents\/([^/]+)\/command$/);
  if(m&&req.method==='POST'){try{const b=await body(req);const result=command(b.actor||'Aura',decodeURIComponent(m[1]),String(b.action||''),b.payload||{});broadcast({type:'refresh'});return json(res,result.allowed?200:403,result)}catch(e){return json(res,400,{error:String(e)})}}
  if(url.pathname==='/api/dev/event'&&req.method==='POST'){const b=await body(req);const e=logEvent(b.agent||'Aura',b.level||'INFO',b.eventType||'DEV',b.message||'Development event',b.data||{});broadcast({type:'event',event:e});return json(res,200,e)}
  const relative=url.pathname==='/'?'index.html':url.pathname.replace(/^\//,'');
  const file=path.join(publicDir,relative);
  if(!file.startsWith(publicDir)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found')}
  const ext=path.extname(file);const type={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'}[ext]||'application/octet-stream';res.writeHead(200,{'Content-Type':type});fs.createReadStream(file).pipe(res);
});
server.listen(port,()=>{const e=logEvent('Aura','INFO','SYSTEM_START','Aura OS v0.8.6 online',{port,phase:'Dual-Port Aura Dashboard + Ziya CRM + Monthly Lead Quotas + Production Supervisor'});console.log(`Aura OS: http://localhost:${port}`);broadcast({type:'event',event:e})});
