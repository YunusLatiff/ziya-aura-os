import {natashaTick} from './natasha.mjs';
import {logEvent} from './orchestrator.mjs';

let running=false;

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
