import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {load,mutate} from './store.mjs';
import {syncLegacyAuraData} from './crm.mjs';
import {logEvent} from './orchestrator.mjs';

const execFileAsync=promisify(execFile);
const env=(k,d='')=>String(process.env[k]??d).trim();
const envBool=(k,d=true)=>['1','true','yes','on','enabled'].includes(env(k,d?'true':'false').toLowerCase());
const now=()=>new Date().toISOString();

export function tonyObserverCapabilities(){
  return Object.freeze({
    readOnly:true,
    commandsAllowed:false,
    modificationAllowed:false,
    readsTonyEnv:false,
    writesToTony:false,
    allowedReads:['data/state.json','data/processed/**','data/pending/**','data/failed/**','logs/tony.log','completed PDFs','process list']
  });
}

function exists(p){try{return !!p&&fs.existsSync(p)}catch{return false}}
function statSafe(p){try{return fs.statSync(p)}catch{return null}}
function readJsonSafe(p){try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return null}}
function cleanPath(p){return String(p||'').replace(/^['"]|['"]$/g,'').trim()}

function findAncestorNamed(start,name){
  let cur=path.resolve(start);
  for(let i=0;i<10;i++){
    if(path.basename(cur).toLowerCase()===name.toLowerCase())return cur;
    const parent=path.dirname(cur);if(parent===cur)break;cur=parent;
  }
  return null;
}

function findProjectRecursive(root,maxDepth=3,depth=0){
  if(!root||!exists(root)||depth>maxDepth)return null;
  const pkg=path.join(root,'package.json');
  if(exists(pkg)){
    const j=readJsonSafe(pkg);
    if(j?.name==='tony-ziya-assessment-agent')return root;
  }
  if(exists(path.join(root,'start-tony.ps1'))&&exists(path.join(root,'src','index.ts')))return root;
  let entries=[];try{entries=fs.readdirSync(root,{withFileTypes:true})}catch{return null}
  for(const e of entries){
    if(!e.isDirectory()||e.name.startsWith('.'))continue;
    const found=findProjectRecursive(path.join(root,e.name),maxDepth,depth+1);if(found)return found;
  }
  return null;
}

export function autoDetectTonyRoot(cwd=process.cwd()){
  const explicit=cleanPath(env('TONY_MONITOR_ROOT'));
  if(explicit)return findProjectRecursive(explicit,3)||explicit;
  const agents=findAncestorNamed(cwd,'Agents');
  if(agents){
    let dirs=[];try{dirs=fs.readdirSync(agents,{withFileTypes:true})}catch{}
    for(const d of dirs){
      if(!d.isDirectory()||!/^Tony-Ziya-Assessment-Agent/i.test(d.name))continue;
      const found=findProjectRecursive(path.join(agents,d.name),3);if(found)return found;
    }
  }
  return '';
}

export function autoDetectCompletedRoot(cwd=process.cwd()){
  const explicit=cleanPath(env('TONY_COMPLETED_ROOT'));
  if(explicit)return explicit;
  let cur=path.resolve(cwd);
  for(let i=0;i<12;i++){
    if(path.basename(cur).toLowerCase()==='ziya energy')return path.join(cur,'Automated Assessment');
    const parent=path.dirname(cur);if(parent===cur)break;cur=parent;
  }
  return '';
}

function walkFiles(root,{max=5000,filter=null}={}){
  const out=[];if(!exists(root))return out;const stack=[root];
  while(stack.length&&out.length<max){
    const dir=stack.pop();let entries=[];try{entries=fs.readdirSync(dir,{withFileTypes:true})}catch{continue}
    for(const e of entries){
      const p=path.join(dir,e.name);
      if(e.isDirectory())stack.push(p);else if(!filter||filter(p,e))out.push(p);
      if(out.length>=max)break;
    }
  }
  return out;
}

function countFiles(root){return walkFiles(root,{max:10000}).length}
function latestFile(files){
  let best=null;
  for(const p of files){const s=statSafe(p);if(!s)continue;if(!best||s.mtimeMs>best.mtimeMs)best={path:p,mtimeMs:s.mtimeMs,modifiedAt:s.mtime.toISOString(),name:path.basename(p)}}
  return best;
}
function tailLines(file,count=10){
  if(!exists(file))return [];
  try{
    const s=fs.statSync(file);const size=Math.min(s.size,160000);const fd=fs.openSync(file,'r');const b=Buffer.alloc(size);fs.readSync(fd,b,0,size,Math.max(0,s.size-size));fs.closeSync(fd);
    return b.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-count);
  }catch{return []}
}
function dateKey(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}

export function summarizeTonyState(state){
  const jobs=Object.values(state?.jobs||{});
  const counts={total:jobs.length,RECEIVED:0,CALCULATING:0,GENERATING_PDF:0,EMAILING:0,COMPLETED:0,NEEDS_REVIEW:0,FAILED:0,IGNORED:0};
  for(const j of jobs){const k=String(j?.status||'UNKNOWN');counts[k]=(counts[k]||0)+1}
  const sorted=jobs.slice().sort((a,b)=>Date.parse(b?.updatedAt||0)-Date.parse(a?.updatedAt||0));
  const active=sorted.find(j=>['RECEIVED','CALCULATING','GENERATING_PDF','EMAILING'].includes(j?.status))||null;
  const latest=sorted[0]||null;
  return {counts,activeJob:active,latestJob:latest};
}

function psQuote(s){return String(s).replace(/'/g,"''")}
export function buildTonyProcessProbe(projectRoot){
  const root=psQuote(path.resolve(projectRoot||'.'));
  const leaf=psQuote(path.basename(path.resolve(projectRoot||'.')));
  return `$root='${root}';$leaf='${leaf}'; Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -like ('*'+$root+'*') -or $_.CommandLine -like ('*'+$leaf+'*')) -and $_.Name -match '^(node|powershell|pwsh)(\\.exe)?$' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`;
}

async function detectTonyProcesses(projectRoot){
  if(process.platform!=='win32')return {supported:false,running:false,processes:[],error:null};
  if(!projectRoot)return {supported:true,running:false,processes:[],error:'Tony project root is not configured.'};
  try{
    const {stdout}=await execFileAsync('powershell.exe',['-NoProfile','-NonInteractive','-Command',buildTonyProcessProbe(projectRoot)],{windowsHide:true,timeout:8000,maxBuffer:1024*1024});
    const raw=String(stdout||'').trim();if(!raw)return {supported:true,running:false,processes:[],error:null};
    const parsed=JSON.parse(raw);const list=Array.isArray(parsed)?parsed:[parsed];
    return {supported:true,running:list.length>0,processes:list.map(x=>({pid:x.ProcessId,name:x.Name,commandLine:x.CommandLine})),error:null};
  }catch(e){return {supported:true,running:false,processes:[],error:String(e.message||e)}}
}

export async function inspectTony({projectRoot=autoDetectTonyRoot(),completedRoot=autoDetectCompletedRoot(),processResult=null}={}){
  const enabled=envBool('TONY_MONITOR_ENABLED',true);
  const observedAt=now();const capabilities=tonyObserverCapabilities();
  if(!enabled)return {enabled:false,status:'DISABLED',observedAt,capabilities,projectRoot,completedRoot};
  const resolvedProject=findProjectRecursive(projectRoot,3)||projectRoot;
  if(!resolvedProject||!exists(resolvedProject))return {enabled:true,status:'NOT_FOUND',observedAt,capabilities,projectRoot:resolvedProject||projectRoot,completedRoot,configured:false,running:false};

  const statePath=path.join(resolvedProject,'data','state.json');
  const logPath=path.join(resolvedProject,'logs','tony.log');
  const processedRoot=path.join(resolvedProject,'data','processed');
  const pendingRoot=path.join(resolvedProject,'data','pending');
  const failedRoot=path.join(resolvedProject,'data','failed');
  const state=readJsonSafe(statePath)||{jobs:{}};const summary=summarizeTonyState(state);
  const logs=tailLines(logPath,12);const logStat=statSafe(logPath);
  const processedFiles=walkFiles(processedRoot,{max:10000,filter:p=>path.basename(p).toLowerCase()==='assessment.json'});
  const pendingFiles=walkFiles(pendingRoot,{max:10000});const failedFiles=walkFiles(failedRoot,{max:10000});
  const completedPdfs=walkFiles(completedRoot,{max:10000,filter:p=>p.toLowerCase().endsWith('.pdf')});
  const latestCompleted=latestFile(completedPdfs);const today=dateKey();
  const completedToday=completedPdfs.reduce((n,p)=>{const s=statSafe(p);return n+(s&&dateKey(s.mtime)===today?1:0)},0);
  const probe=processResult||await detectTonyProcesses(resolvedProject);
  const running=!!probe.running;
  const status=probe.error&&!running?'UNKNOWN':running?'RUNNING':'STOPPED';
  const activityTimes=[logStat?.mtime?.toISOString(),summary.latestJob?.updatedAt,latestCompleted?.modifiedAt].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a));
  return {
    enabled:true,configured:true,status,running,observedAt,projectRoot:resolvedProject,completedRoot,capabilities,
    process:{supported:probe.supported,running,processCount:probe.processes?.length||0,processes:(probe.processes||[]).map(x=>({pid:x.pid,name:x.name})),error:probe.error||null},
    lastActivityAt:activityTimes[0]||null,lastLogAt:logStat?.mtime?.toISOString()||null,recentLog:logs,
    jobs:summary.counts,activeJob:summary.activeJob,latestJob:summary.latestJob,
    processedAssessments:processedFiles.length,pendingFiles:pendingFiles.length,failedFiles:failedFiles.length,
    completed:{total:completedPdfs.length,today:completedToday,latest:latestCompleted}
  };
}

export function tonyObserverStatus(){
  const db=load();
  return db.tonyObserver||{enabled:envBool('TONY_MONITOR_ENABLED',true),status:'AWAITING_FIRST_SCAN',running:false,observedAt:null,capabilities:tonyObserverCapabilities(),projectRoot:autoDetectTonyRoot(),completedRoot:autoDetectCompletedRoot()};
}

export async function refreshTonyObservation(options={}){
  const previous=tonyObserverStatus();const result=await inspectTony(options);
  mutate(db=>{
    db.tonyObserver=result;
    db.meta=db.meta||{};db.meta.tonyObserverLastScanAt=result.observedAt;
    const t=db.agents?.Tony;
    if(t){
      t.status=result.status==='RUNNING'?'RUNNING':result.status==='STOPPED'?'STOPPED':result.status;
      t.currentTask=result.activeJob?`Observed ${result.activeJob.status}${result.activeJob.company?` · ${result.activeJob.company}`:''}`:result.running?'Observed running · mailbox monitor':'Observed offline';
      t.lastHeartbeat=result.lastActivityAt||result.observedAt;
      t.lastError=result.process?.error||null;
      t.protected=true;t.external=true;
    }
  });
  syncLegacyAuraData();
  if(previous?.status&&previous.status!==result.status){
    logEvent('Aura',result.status==='RUNNING'?'INFO':'WARN','TONY_OBSERVER_STATUS',`Tony observed status changed: ${previous.status} → ${result.status}.`,{readOnly:true,status:result.status});
  }
  return result;
}
