import {load,mutate} from './store.mjs';
import {logEvent} from './orchestrator.mjs';
import {monitorConfig,runHealthScan,generateSteveReport,emailSteveReport} from './monitor.mjs';
let timer=null,running=false;
function localDay(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export async function monitorTick(){if(running)return;running=true;try{await runHealthScan();const cfg=monitorConfig();const db=load();const day=localDay();if(new Date().getHours()>=cfg.reportHour&&db.meta?.steveAutoReportDay!==day){const report=await generateSteveReport({runScan:false});mutate(d=>{d.meta=d.meta||{};d.meta.steveAutoReportDay=day;});if(cfg.emailEnabled){try{await emailSteveReport(report.id);}catch(e){logEvent('Steve','ERROR','STEVE_REPORT_EMAIL_FAILED','Steve could not email the scheduled operational report.',{error:String(e),reportId:report.id});}}}}finally{running=false;}}
export function startMonitorScheduler(){if(timer)return;const cfg=monitorConfig();timer=setInterval(()=>monitorTick().catch(e=>logEvent('Aura','ERROR','MONITOR_ERROR','Aura health monitor tick failed.',{error:String(e)})),cfg.tickSeconds*1000);timer.unref?.();queueMicrotask(()=>monitorTick().catch(()=>{}));}
