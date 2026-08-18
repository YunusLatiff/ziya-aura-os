import {
  searxngSearch,
  searxngStatus
} from './searxng-provider.mjs';

import {
  crawlPublicWebsite
} from './website-crawler.mjs';

import {
  tavilySearch,
  geoapifyPlaceSearch,
  geoapifyPlaceDetails,
  tavilyBudgetAvailable,
  providerStatus
} from './providers.mjs';

import {
  reserveFallback,
  fallbackStatus
} from './fallback-budget.mjs';

function localEnabled(){
  return !['false','0','off','disabled'].includes(
    String(
      process.env.LOCAL_DISCOVERY_ENABLED ?? 'true'
    ).toLowerCase()
  );
}

function crawlerEnabled(){
  return !['false','0','off','disabled'].includes(
    String(
      process.env.LOCAL_WEBSITE_CRAWL_ENABLED ?? 'true'
    ).toLowerCase()
  );
}

export function localDiscoveryStatus(){
  return {
    configured: localEnabled(),
    enabled: localEnabled(),
    searxng: searxngStatus(),
    browserResearch: crawlerEnabled(),
    fallbacks: {
      tavily: fallbackStatus('TAVILY'),
      geoapify: fallbackStatus('GEOAPIFY')
    }
  };
}

export async function localSearch(
  query,
  count=10,
  options={}
){
  if(!localEnabled()) return [];

  try{
    return await searxngSearch(
      query,
      count,
      options
    );
  }catch{
    return [];
  }
}

export async function researchWebsite(
  url,
  options={}
){
  if(!crawlerEnabled()){
    return {
      ok:false,
      pages:[],
      pagesVisited:0,
      text:''
    };
  }

  try{
    return await crawlPublicWebsite(
      url,
      options
    );
  }catch(error){
    return {
      ok:false,
      pages:[],
      pagesVisited:0,
      text:'',
      error:String(error)
    };
  }
}

export async function tavilyFallbackSearch(
  query,
  count=10,
  options={},
  reason='unspecified'
){
  if(!tavilyBudgetAvailable()) return [];

  const reservation =
    reserveFallback('TAVILY',reason);

  if(!reservation.allowed) return [];

  try{
    return await tavilySearch(
      query,
      count,
      options
    );
  }catch{
    return [];
  }
}

export async function geoapifyFallbackSearch(
  query,
  count=10,
  reason='unspecified'
){
  if(!providerStatus().geoapify.configured){
    return [];
  }

  const reservation =
    reserveFallback('GEOAPIFY',reason);

  if(!reservation.allowed) return [];

  try{
    return await geoapifyPlaceSearch(
      query,
      count
    );
  }catch{
    return [];
  }
}

export async function geoapifyFallbackDetails(
  placeId,
  reason='place-details'
){
  if(
    !placeId ||
    !providerStatus().geoapify.configured
  ){
    return null;
  }

  const reservation =
    reserveFallback('GEOAPIFY',reason);

  if(!reservation.allowed) return null;

  try{
    return await geoapifyPlaceDetails(placeId);
  }catch{
    return null;
  }
}

function scoreAddress(value, region=''){
  let score = 0;

  const text = String(value || '');
  const r = String(region || '').toLowerCase();

  if(/\b\d{4}\b/.test(text)) score += 2;

  if(
    /\b(gauteng|johannesburg|pretoria|tshwane|midrand|sandton|randburg|roodepoort|boksburg|germiston|kempton park|alberton|benoni|centurion|springs|edenvale|isando|jet park)\b/i
      .test(text)
  ){
    score += 4;
  }

  for(
    const word of r
      .split(/\s+/)
      .filter(x => x.length > 4)
  ){
    if(text.toLowerCase().includes(word)){
      score += 1;
    }
  }

  return score;
}

export function extractLocalAddress(
  text,
  region=''
){
  const input=String(text||'')
    .replace(/\\r/g,'')
    .replace(/[ \\t]+/g,' ')
    .replace(/\\n{3,}/g,'\\n\\n')
    .trim();

  if(!input) return '';

  const lines=input
    .split(/\\n+/)
    .map(x=>x.trim())
    .filter(Boolean);

  const patterns=[
    /\\b\\d{1,5}\\s+[A-Za-z0-9][A-Za-z0-9 &'().\\-]{1,70}\\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Boulevard|Blvd|Lane|Ln|Close|Crescent|Cres|Parkway|Highway)\\b(?:[ \\t,.-]+[A-Za-z][A-Za-z .'\\-]{1,40}){0,3}(?:[ \\t,]+\\d{4})?/gi,

    /\\b(?:Cnr|Corner)\\s+[A-Za-z0-9 .'\\-]{2,60}\\s+(?:and|&)\\s+[A-Za-z0-9 .'\\-]{2,60}(?:[ \\t,]+[A-Za-z][A-Za-z .'\\-]{1,40}){0,3}(?:[ \\t,]+\\d{4})?/gi
  ];

  const candidates=[];

  function cleanValue(raw=''){
    let value=String(raw||'')
      .replace(/^(?:\\+27|0)[0-9 ()-]{8,16}\\s*/,'')
      .trim();

    // If page text precedes the street number, start at the address.
    value=value.replace(
      /^.*?(?=\\b\\d{1,5}\\s+[A-Za-z0-9])/,
      ''
    );

    // Handles strings like:
    // "1 Waterfall Ridge Shopping Centre 8 Ridge Road ..."
    const streetSuffix=value.search(
      /\\b(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Boulevard|Blvd|Lane|Ln|Close|Crescent|Cres|Parkway|Highway)\\b/i
    );

    if(streetSuffix>0){
      const before=value.slice(0,streetSuffix);
      const numbers=[...before.matchAll(/\\b\\d{1,5}\\b/g)];

      if(numbers.length>1){
        const last=numbers[numbers.length-1];
        value=value.slice(last.index);
      }
    }

    // Stop when navigation/opening-hours/marketing copy starts.
    value=value.replace(
      /\\b(?:Facebook|Instagram|HOME|ABOUT|STORE|DIRECT|Situated near|Located near|Trading Hours|Opening Hours|Directions|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|ptacold)\\b.*$/i,
      ''
    );

    // A postal code is a strong natural end-of-address marker.
    const postal=value.match(/\\b\\d{4}\\b/);

    if(postal){
      value=value.slice(
        0,
        postal.index+postal[0].length
      );
    }else{
      // Otherwise stop at a South African province when present.
      const province=value.match(
        /\\b(Gauteng|Limpopo|Mpumalanga|North West|Free State|KwaZulu-Natal|Western Cape|Eastern Cape|Northern Cape)\\b/i
      );

      if(province){
        value=value.slice(
          0,
          province.index+province[0].length
        );
      }
    }

    value=value
      .replace(/\\s+[A-Z]$/,'')
      .replace(/[|;:,.-]+$/,'')
      .replace(/\\s+/g,' ')
      .trim();

    return value.slice(0,180);
  }

  for(const rawLine of lines){
    const line=rawLine.slice(0,600);

    for(const pattern of patterns){
      pattern.lastIndex=0;

      for(const match of line.matchAll(pattern)){
        const value=cleanValue(match[0]);

        if(value.length<12) continue;

        candidates.push({
          value,
          score:scoreAddress(value,region)
        });
      }
    }
  }

  candidates.sort(
    (a,b)=>
      b.score-a.score ||
      a.value.length-b.value.length
  );

  return candidates[0]?.value||'';
}
