import {
  natashaTick,
  ensureNatashaState,
  natashaStatus
} from './natasha.mjs';

import {
  mutate
} from './store.mjs';

import {
  logEvent
} from './orchestrator.mjs';

let running=false;
let timer=null;

const now=()=>new Date().toISOString();

const intervalMinutes=()=>{
  const raw=Number(
    process.env.NATASHA_TICK_MINUTES||30
  );

  if(!Number.isFinite(raw)){
    return 30;
  }

  return Math.max(
    5,
    Math.min(1440,raw)
  );
};

export async function natashaSchedulerTick(){
  if(running){
    return {
      skipped:true,
      reason:'ALREADY_RUNNING'
    };
  }

  running=true;

  try{
    return await natashaTick();
  }catch(error){
    mutate(db=>{
      if(db.agents?.Natasha){
        db.agents.Natasha.status='ERROR';

        db.agents.Natasha.lastError=
          String(
            error?.message||
            error
          );

        db.agents.Natasha.lastHeartbeat=
          now();
      }
    });

    logEvent(
      'Natasha',
      'ERROR',
      'NATASHA_TICK_ERROR',
      'Natasha organic marketing tick failed.',
      {
        error:String(
          error?.stack||
          error?.message||
          error
        )
      }
    );

    return {
      ok:false,
      error:String(
        error?.message||
        error
      )
    };
  }finally{
    running=false;
  }
}

export function setNatashaPaused(
  paused=true
){
  ensureNatashaState();

  mutate(db=>{
    if(!db.agents?.Natasha){
      return;
    }

    db.agents.Natasha.status=
      paused
        ?'PAUSED'
        :'WAITING';

    db.agents.Natasha.currentTask=
      paused
        ?'Organic marketing paused by Aura/owner.'
        :'Organic-only marketing active · Meta publishing connection pending';

    db.agents.Natasha.lastError=null;
    db.agents.Natasha.lastHeartbeat=now();

    db.natasha=db.natasha||{};

    db.natasha.runtimePaused=
      !!paused;

    db.natasha.updatedAt=
      now();
  });

  logEvent(
    'Natasha',
    'INFO',
    paused
      ?'NATASHA_PAUSED'
      :'NATASHA_RESUMED',
    paused
      ?'Natasha organic marketing was paused.'
      :'Natasha organic marketing was resumed.',
    {
      mode:'ORGANIC_ONLY',
      budgetR:0
    }
  );

  return natashaStatus();
}

export function startNatashaScheduler(){
  ensureNatashaState();

  if(timer){
    return {
      started:false,
      alreadyRunning:true,
      intervalMinutes:
        intervalMinutes()
    };
  }

  const ms=
    intervalMinutes()*
    60*
    1000;

  queueMicrotask(()=>{
    natashaSchedulerTick()
      .catch(()=>{});
  });

  timer=setInterval(()=>{
    natashaSchedulerTick()
      .catch(()=>{});
  },ms);

  if(typeof timer.unref==='function'){
    timer.unref();
  }

  logEvent(
    'Natasha',
    'INFO',
    'NATASHA_SCHEDULER_STARTED',
    'Natasha organic marketing scheduler started.',
    {
      intervalMinutes:
        intervalMinutes(),
      budgetR:0,
      mode:'ORGANIC_ONLY'
    }
  );

  return {
    started:true,
    intervalMinutes:
      intervalMinutes()
  };
}

export function stopNatashaScheduler(){
  if(timer){
    clearInterval(timer);
    timer=null;
  }

  return {
    stopped:true
  };
}
