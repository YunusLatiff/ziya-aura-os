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
  const input = String(text || '')
    .replace(/\r/g,'')
    .replace(/[ \t]+/g,' ')
    .replace(/\n{3,}/g,'\n\n')
    .trim();

  if(!input) return '';

  const patterns = [
    /\b\d{1,5}\s+[A-Za-z0-9][A-Za-z0-9 &'().\-]{2,70}\s(?:Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Boulevard|Blvd|Lane|Ln|Close|Crescent|Cres|Parkway|Highway)\b(?:[\s,]+[A-Za-z][A-Za-z .'\-]{2,50}){1,3}(?:[\s,]+\d{4})?/gi,

    /\b(?:Cnr|Corner)\s+[A-Za-z0-9 .'\-]{2,60}\s+(?:and|&)\s+[A-Za-z0-9 .'\-]{2,60}(?:,\s*[A-Za-z][A-Za-z .'\-]{2,50}){1,3}(?:,\s*\d{4})?/gi
  ];

  const candidates = [];

  for(const pattern of patterns){
    for(const match of input.matchAll(pattern)){
      const value = String(match[0] || '')
        .replace(/^(?:\+27|0)[0-9 ()-]{8,16}\s*/,'')
        .replace(/\s+/g,' ')
        .trim()
        .slice(0,220);

      if(value.length < 12) continue;

      candidates.push({
        value,
        score:scoreAddress(value,region)
      });
    }
  }

  candidates.sort(
    (a,b) =>
      b.score-a.score ||
      a.value.length-b.value.length
  );

  return candidates[0]?.value || '';
}
