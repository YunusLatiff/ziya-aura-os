const UA = 'AuraOS/0.9 (Ziya Energy public business research)';

function env(name, fallback=''){
  return String(process.env[name] || fallback).trim();
}

function baseUrl(){
  return env('SEARXNG_URL', 'http://127.0.0.1:8888');
}

function hostname(url=''){
  try{
    return new URL(url).hostname.toLowerCase().replace(/^www\./,'');
  }catch{
    return '';
  }
}

function isExcluded(host, domains=[]){
  return domains.some(domain=>{
    const d=String(domain||'')
      .toLowerCase()
      .replace(/^www\./,'');

    return host===d || host.endsWith(`.${d}`);
  });
}

export function searxngStatus(){
  return {
    configured:true,
    local:true,
    name:'Local SearXNG',
    url:baseUrl()
  };
}

export async function searxngSearch(query, count=10, options={}){
  const q=String(query||'').trim();

  if(!q) return [];

  const u=new URL('/search', baseUrl());

  u.searchParams.set('q', q);
  u.searchParams.set('format', 'json');
  u.searchParams.set('language', 'en');
  u.searchParams.set('safesearch', '0');
  u.searchParams.set('categories', 'general');

  const timeout=Math.max(
    5000,
    Number(process.env.SEARXNG_TIMEOUT_MS || 20000)
  );

  const response=await fetch(u,{
    headers:{
      'Accept':'application/json',
      'User-Agent':UA
    },
    signal:AbortSignal.timeout(timeout)
  });

  if(!response.ok){
    throw new Error(
      `SearXNG HTTP ${response.status}: ${await response.text()}`
    );
  }

  const data=await response.json();

  const results=[];
  const seen=new Set();

  for(const item of data.results || []){
    const url=String(item.url || '').trim();

    if(!/^https?:\/\//i.test(url)) continue;

    const host=hostname(url);

    if(!host) continue;

    if(isExcluded(host, options.excludeDomains || [])){
      continue;
    }

    const key=url.toLowerCase();

    if(seen.has(key)) continue;
    seen.add(key);

    results.push({
      provider:'SEARXNG',
      title:String(item.title || '').trim(),
      url,
      description:String(item.content || '').trim(),
      score:Number.isFinite(item.score)
        ? item.score
        : null,
      engines:Array.isArray(item.engines)
        ? item.engines
        : []
    });

    if(results.length >= count) break;
  }

  return results;
}

export async function searxngHealth(){
  try{
    const results=await searxngSearch(
      'South Africa business',
      1
    );

    return {
      ok:true,
      resultCount:results.length,
      url:baseUrl()
    };
  }catch(error){
    return {
      ok:false,
      resultCount:0,
      url:baseUrl(),
      error:String(error)
    };
  }
}
