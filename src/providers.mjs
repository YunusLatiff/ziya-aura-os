const ua = 'AuraOS/0.2.5 (+Ziya Energy lead research; public web only)';

function env(name){return String(process.env[name]||'').trim()}
const usageCache={value:null,fetchedAt:0,budgetBlocked:false,lastError:null};
const USAGE_TTL_MS=60000;
function threshold(){const n=Number(env('TAVILY_USAGE_STOP_PERCENT')||90);return Math.max(50,Math.min(100,n))/100}
function reserve(){return Math.max(0,Number(env('TAVILY_CREDIT_RESERVE')||25))}
function monthlyCreditCap(){return Math.max(1,Number(env('TAVILY_MONTHLY_CREDIT_CAP')||900))}
export function tavilyBudgetDecision(usage=0,limit=0){
  const used=Math.max(0,Number(usage)||0);const planLimit=Math.max(0,Number(limit)||0);const remaining=planLimit>0?Math.max(0,planLimit-used):null;const ratio=planLimit>0?used/planLimit:0;const cap=monthlyCreditCap();
  return {blocked:used>=cap||(planLimit>0&&(ratio>=threshold()||remaining<=reserve())),cap,remaining,ratio};
}

export async function tavilyUsage(force=false){
  const key=env('TAVILY_API_KEY');
  if(!key) return null;
  if(!force&&usageCache.value&&Date.now()-usageCache.fetchedAt<USAGE_TTL_MS) return usageCache.value;
  try{
    const r=await fetch('https://api.tavily.com/usage',{headers:{'Authorization':`Bearer ${key}`,'User-Agent':ua},signal:AbortSignal.timeout(12000)});
    if(!r.ok) throw new Error(`Tavily Usage HTTP ${r.status}: ${await r.text()}`);
    const j=await r.json();
    const usage=Number(j?.key?.usage??j?.account?.usage??0);
    const limit=Number(j?.key?.limit??j?.account?.limit??0);
    const remaining=limit>0?Math.max(0,limit-usage):null;
    const ratio=limit>0?usage/limit:0;
    usageCache.value={usage,limit,remaining,ratio,currentPlan:j?.account?.current_plan||'',searchUsage:Number(j?.key?.search_usage??0)};
    usageCache.fetchedAt=Date.now();usageCache.lastError=null;
    usageCache.budgetBlocked=tavilyBudgetDecision(usage,limit).blocked;
    return usageCache.value;
  }catch(e){usageCache.lastError=String(e);return usageCache.value}
}

export async function refreshProviderStatus(){await tavilyUsage(false);return providerStatus()}

export function tavilyBudgetAvailable(){return !!env('TAVILY_API_KEY')&&!usageCache.budgetBlocked}

export function providerStatus(){
  const u=usageCache.value;
  return {
    tavily:{configured:!!env('TAVILY_API_KEY'),name:'Tavily Search API',usage:u,budgetBlocked:usageCache.budgetBlocked,usageError:usageCache.lastError,stopPercent:Math.round(threshold()*100),reserve:reserve(),monthlyCreditCap:monthlyCreditCap()},
    geoapify:{configured:!!env('GEOAPIFY_API_KEY'),name:'Geoapify Places / Geocoding'},
    publicWeb:{configured:true,name:'Public website fetcher'},
    linkedInAutomation:{configured:false,name:'LinkedIn automation',disabled:true,reason:'Automated LinkedIn crawling/login is intentionally disabled.'}
  };
}

export async function tavilySearch(query,count=10,options={}){
  const key=env('TAVILY_API_KEY');
  if(!key) return [];
  await tavilyUsage(false);
  if(usageCache.budgetBlocked) return [];
  const body={query,search_depth:'basic',max_results:Math.min(20,count),topic:'general',country:'south africa',include_answer:false,include_raw_content:false,include_images:false,include_usage:true};
  if(Array.isArray(options.excludeDomains)&&options.excludeDomains.length) body.exclude_domains=[...new Set(options.excludeDomains)].slice(0,150);
  if(Array.isArray(options.includeDomains)&&options.includeDomains.length) body.include_domains=[...new Set(options.includeDomains)].slice(0,300);
  const r=await fetch('https://api.tavily.com/search',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`,'User-Agent':ua},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
  if(r.status===432){usageCache.budgetBlocked=true;usageCache.lastError='Tavily plan usage limit reached';if(usageCache.value)usageCache.value.remaining=0;return []}
  if(!r.ok) throw new Error(`Tavily Search HTTP ${r.status}: ${await r.text()}`);
  const j=await r.json();
  if(j.usage?.credits&&usageCache.value){usageCache.value.usage+=Number(j.usage.credits);usageCache.value.searchUsage+=Number(j.usage.credits);usageCache.value.remaining=Math.max(0,usageCache.value.limit-usageCache.value.usage);usageCache.value.ratio=usageCache.value.limit?usageCache.value.usage/usageCache.value.limit:0;usageCache.budgetBlocked=tavilyBudgetDecision(usageCache.value.usage,usageCache.value.limit).blocked}
  return (j.results||[]).map(x=>({provider:'TAVILY',title:x.title||'',url:x.url||'',description:x.content||'',score:Number.isFinite(x.score)?x.score:null,credits:j.usage?.credits??null}));
}

export async function geoapifyPlaceSearch(textQuery,max=10){
  const key=env('GEOAPIFY_API_KEY');if(!key) return [];
  const u=new URL('https://api.geoapify.com/v1/geocode/search');u.searchParams.set('text',textQuery);u.searchParams.set('filter','countrycode:za');u.searchParams.set('lang','en');u.searchParams.set('limit',String(Math.min(20,max)));u.searchParams.set('format','json');u.searchParams.set('apiKey',key);
  const r=await fetch(u,{headers:{'Accept':'application/json','User-Agent':ua},signal:AbortSignal.timeout(15000)});if(!r.ok) throw new Error(`Geoapify Geocoding HTTP ${r.status}: ${await r.text()}`);const j=await r.json();
  return (j.results||[]).map(p=>({provider:'GEOAPIFY',placeId:p.place_id||'',companyName:p.name||p.address_line1||'',address:p.formatted||[p.address_line1,p.address_line2].filter(Boolean).join(', '),phone:'',email:'',website:'',placeUrl:(p.lat!=null&&p.lon!=null)?`https://www.openstreetmap.org/?mlat=${encodeURIComponent(p.lat)}&mlon=${encodeURIComponent(p.lon)}#map=18/${encodeURIComponent(p.lat)}/${encodeURIComponent(p.lon)}`:'',types:[p.category,p.result_type].filter(Boolean),lat:p.lat??null,lon:p.lon??null,geoConfidence:p.rank?.confidence??null}));
}

export async function geoapifyPlaceDetails(placeId){
  const key=env('GEOAPIFY_API_KEY');if(!key||!placeId)return null;
  const u=new URL('https://api.geoapify.com/v2/place-details');u.searchParams.set('id',placeId);u.searchParams.set('features','details,building');u.searchParams.set('lang','en');u.searchParams.set('apiKey',key);
  const r=await fetch(u,{headers:{'Accept':'application/geo+json,application/json','User-Agent':ua},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`Geoapify Place Details HTTP ${r.status}: ${await r.text()}`);const j=await r.json();const f=(j.features||[]).find(x=>x?.properties?.feature_type==='details')||(j.features||[])[0];const p=f?.properties||{};
  return {name:p.name||'',address:p.formatted||[p.address_line1,p.address_line2].filter(Boolean).join(', '),phone:p.contact?.phone||'',email:p.contact?.email||'',website:p.website||p.brand_details?.website||p.operator_details?.website||p.owner_details?.website||'',categories:p.categories||[],buildingUnits:p.building?.units||p.building?.flats||null,description:p.description||''};
}

export async function fetchPublicPage(url){
  try{const u=new URL(url);if(/(^|\.)linkedin\.com$/i.test(u.hostname))return{url,blocked:true,text:'',html:''};if(!/^https?:$/.test(u.protocol))return{url,blocked:true,text:'',html:''};const r=await fetch(url,{headers:{'User-Agent':ua,'Accept':'text/html,application/xhtml+xml'},redirect:'follow',signal:AbortSignal.timeout(12000)});if(!r.ok)return{url,status:r.status,text:'',html:''};const type=r.headers.get('content-type')||'';if(!type.includes('text/html'))return{url,status:r.status,text:'',html:''};const html=(await r.text()).slice(0,1_500_000);const text=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();return{url,status:r.status,text,html}}catch(e){return{url,error:String(e),text:'',html:''}}
}
