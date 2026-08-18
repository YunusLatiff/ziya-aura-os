import crypto from 'node:crypto';
import {mutate,load} from './store.mjs';
import {logEvent} from './orchestrator.mjs';
import {DEFAULT_REGIONS,COMMON_EXCLUDED_DOMAINS} from './research-config.mjs';
import {effectivePolicy} from './agent-policy.mjs';
import {fetchPublicPage,providerStatus} from './providers.mjs';
import {
  localDiscoveryStatus,
  localSearch,
  researchWebsite,
  tavilyFallbackSearch,
  geoapifyFallbackSearch,
  extractLocalAddress
} from './discovery-router.mjs';
import {cleanCompanyName,domainOf,dedupeKey,extractContacts,classifyLead,estimateUsage,isProbableDuplicate,sourceMatchesEntity,canonicalEntityName} from './lead-intelligence.mjs';
import {reviewLead,reviewBatch} from './friday.mjs';
import {findRegistryDuplicate,registerLead,markDuplicateSeen} from './lead-registry.mjs';
import {syncLegacyAuraData} from './crm.mjs';
import {quotaDecision,remainingApprovalSlots} from './lead-quota.mjs';
import {outreachTick} from './outreach-scheduler.mjs';

function regions(){
  const configured=String(process.env.RESEARCH_REGIONS||'').split('|').map(x=>x.trim()).filter(Boolean);
  return configured.length?configured:DEFAULT_REGIONS;
}
function now(){return new Date().toISOString()}
const dailyBatchLimit=()=>Math.max(1,Number(process.env.RESEARCH_DAILY_BATCHES_PER_AGENT||3));
const dailyBatchTimezone=()=>String(process.env.RESEARCH_DAILY_BATCH_TIMEZONE||'Africa/Johannesburg');

function localDayKey(value=new Date()){
  const date=value instanceof Date?value:new Date(value);
  if(Number.isNaN(date.getTime())) return '';
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:dailyBatchTimezone(),year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(date);
  const map=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

export function dailyBatchStatus(agent,db=load()){
  const day=localDayKey();
  const batches=(db.leadBatches||[]).filter(b=>b.agent===agent&&localDayKey(b.createdAt)===day);
  const completed=batches.filter(b=>b.status==='APPROVED').length;
  const active=batches.filter(b=>!['APPROVED','CANCELLED'].includes(b.status)).length;
  const limit=dailyBatchLimit();
  return {agent,day,timezone:dailyBatchTimezone(),limit,started:batches.length,completed,active,remaining:Math.max(0,limit-batches.length)};
}

function hasOpenBatch(agent,db=load()){
  return (db.leadBatches||[]).some(b=>b.agent===agent&&!['APPROVED','CANCELLED'].includes(b.status));
}

function triggerPepperForApprovedLead(leadId){
  const db=load();
  if(!db.meta?.outreachCycleEnabled) return;
  queueMicrotask(()=>outreachTick().catch(error=>{
    logEvent('Aura','ERROR','STREAMING_OUTREACH_ERROR','Immediate Pepper handoff failed after Friday approval.',{leadId,error:String(error)});
  }));
}
function normalizePhone(s=''){return String(s).replace(/\s+/g,' ').trim()}
function genericEmailScore(e=''){const local=e.split('@')[0].toLowerCase();return /^(info|sales|contact|admin|enquiries|hello|reception)/.test(local)?1:2}
function selectEmail(emails=[]){return [...emails].sort((a,b)=>genericEmailScore(b)-genericEmailScore(a))[0]||''}

const NOISE_DOMAINS=/indeed|pnet|careers24|glassdoor|adzuna|joblife|tripadvisor|wikipedia|facebook|instagram|youtube|tiktok|linkedin|property24|privateproperty|gumtree|bizcommunity|brabys|snupit|cylex|yellowpages|hotfrog/i;
const GENERIC_NAMES=/^(factory|factories|manufacturing|manufacturer|warehouse|warehouses|johannesburg|pretoria|midrand|ekurhuleni|gauteng|south africa|shopping centre|shopping center|shopping mall|office park|commercial building|apartment complex|residential estate|home|contact|about)$/i;
const NOISE_TEXT=/\b(jobs?|vacanc(?:y|ies)|careers?|salary|salaries|reviews?|things to do|tourist|tourism|top \d+|best outlets?|directory|list of|full list|businesses in|all you should know|for sale|to rent|property listings?|recruitment agenc(?:y|ies)|press release|news article|employee reviews?)\b/i;

const PUBLIC_INSTITUTION=/\b(municipal|municipality|metro police|police department|government|department of|tvet|college|university|school|clinic|hospital|radio|fm\b|church|mosque|hotel|lodge|restaurant|museum|stadium|library|pay point|head office)\b/i;
const VISION_RETAIL_NOISE=/\b(factory shop|factory store|outlet|retail|shopping|dance|fitness|gym|salon|showroom)\b/i;
const MJ_GENERIC_LOCATION=/\b(residential street|residential road|street|road|avenue|suburb|township|ward|neighbourhood|neighborhood)\b/i;
const MJ_NAME_SIGNAL=/\b(estate|apartments?|apartment complex|residences?|residential complex|village|sectional title|homeowners association|hoa)\b/i;
const PETER_PAGE_NOISE=/\b(shop\b.*\bat\b|shops in|store locator|directory|jobs?|vacanc(?:y|ies)|retail jobs|online directories)\b/i;

function regionMatchesAddress(region,address=''){
  const r=String(region||'').toLowerCase();
  const a=String(address||'').toLowerCase();
  if(!a) return false;
  if(r.includes('johannesburg')) return /\b(johannesburg|sandton|randburg|roodepoort|midrand|soweto)\b/.test(a);
  if(r.includes('pretoria')) return /\b(pretoria|tshwane|centurion|akasia|menlyn|montana)\b/.test(a);
  if(r.includes('midrand')) return /\b(midrand|waterfall|kyalami|halfway house|vorna valley|glen austin)\b/.test(a);
  if(r.includes('ekurhuleni')) return /\b(ekurhuleni|germiston|kempton park|boksburg|benoni|brakpan|springs|alberton|edenvale|isando|jet park|spartan)\b/.test(a);
  return true;
}

function preFridayIntegrity(lead){
  const reasons=[];
  const policy=effectivePolicy(lead.agent).research;
  const name=String(lead.companyName||'');
  const aggregate=`${name} ${lead.address||''} ${lead.sector||''} ${(lead.evidence||[]).map(e=>e.detail||'').join(' ')}`;

  if(!lead.companyName||GENERIC_NAMES.test(cleanCompanyName(lead.companyName))) reasons.push('Generic or missing entity name.');
  if(!lead.address) reasons.push('No physical address verified.');
  else if(!regionMatchesAddress(lead.region,lead.address)) reasons.push('Address does not match the active research region.');

  if(lead.agent==='Vision'){
    if(PUBLIC_INSTITUTION.test(aggregate)) reasons.push('Non-industrial public/institutional entity.');
    if(VISION_RETAIL_NOISE.test(name)) reasons.push('Retail/outlet/non-industrial entity.');
    if(!['MANUFACTURING','WAREHOUSE'].includes(lead.facilityType)) reasons.push('Not an industrial facility.');
    if(!(Number.isFinite(lead.estimatedKwhMin)&&lead.estimatedKwhMin>=Number(policy.kwhMin))) reasons.push('Lower usage estimate below the active Vision threshold.');
    if(!['HIGH','MEDIUM'].includes(lead.usageConfidence)) reasons.push('Industrial scale evidence too weak.');
  }

  if(lead.agent==='Peter'){
    if(PUBLIC_INSTITUTION.test(aggregate)) reasons.push('Public/institutional entity outside Peter mandate.');
    if(PETER_PAGE_NOISE.test(name)) reasons.push('Directory/locator/jobs page rather than a commercial property or retailer.');
    if(!['RETAIL','SHOPPING_CENTRE','OFFICE_PARK','COMMERCIAL'].includes(lead.facilityType)) reasons.push('Not a qualifying retail/commercial facility.');
    if(!(Number.isFinite(lead.estimatedKwhMin)&&Number.isFinite(lead.estimatedKwhMax)&&lead.estimatedKwhMin>=Number(policy.kwhMin)&&lead.estimatedKwhMax<=Number(policy.kwhMax))) reasons.push("Usage band outside Peter's active policy range.");
    if(!['HIGH','MEDIUM'].includes(lead.usageConfidence)) reasons.push('Commercial scale evidence too weak.');
  }

  if(lead.agent==='MJ'){
    if(PUBLIC_INSTITUTION.test(aggregate)) reasons.push('Public/institutional entity outside MJ mandate.');
    if(MJ_GENERIC_LOCATION.test(name)&&!MJ_NAME_SIGNAL.test(name)) reasons.push('Generic road/street/location, not a named residential development.');
    if(!MJ_NAME_SIGNAL.test(name)) reasons.push('Entity name does not identify a specific estate/apartment development.');
    if(!['ESTATE','APARTMENT_COMPLEX'].includes(lead.facilityType)) reasons.push('Not a qualifying estate/apartment complex.');
    if(lead.facilityType==='APARTMENT_COMPLEX'&&!(Number.isFinite(lead.unitCount)&&lead.unitCount>=Number(policy.apartmentMinUnits))) reasons.push("Apartment complex lacks enough units for MJ's active policy.");
    if(!['HIGH','MEDIUM'].includes(lead.usageConfidence)) reasons.push('Residential development evidence too weak.');
  }

  return {ok:reasons.length===0,reasons};
}

function candidateText(c){return `${c.companyName||''} ${c.title||''} ${c.description||''} ${(c.types||[]).join(' ')}`.replace(/\s+/g,' ')}
function looksLikeCandidate(agent,c){
  const text=candidateText(c);
  const name=cleanCompanyName(c.companyName||c.title||'');
  const domain=domainOf(c.url||c.website||'');
  if(!name||name.length<3||GENERIC_NAMES.test(name)) return false;
  if(domain&&NOISE_DOMAINS.test(domain)) return false;
  if(NOISE_TEXT.test(text)) return false;
  if(agent==='Vision') return /manufactur|factory|production|processing plant|fabricat|assembly|industrial plant|warehouse|distribution cent(?:re|er)|cold storage|cold chain|logistics hub/i.test(text);
  if(agent==='Peter') return /shopping cent(?:re|er)|mall|retail cent(?:re|er)|supermarket|office park|business park|commercial office|office building|retail store/i.test(text);
  if(agent==='MJ') return /residential estate|security estate|lifestyle estate|gated estate|sectional title|apartment complex|apartment building|apartments|flats|residential development/i.test(text);
  return false;
}

function personFromResult(result,company=''){
  const raw=`${result.title||''} ${result.description||''}`.replace(/\s+/g,' ');
  const role='(?:facilities?|facility|operations?|property|centre|center|general|plant|maintenance|energy|engineering|technical|estate|building|portfolio|asset)\\s+(?:manager|director|head|executive)|(?:manager|director|head)\\s+(?:of\\s+)?(?:facilities?|operations?|property|engineering|maintenance)';
  const name='([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,2})';
  let m=raw.match(new RegExp(`${name}\\s*(?:[-–—|,]|is|:)\\s*(${role})`,'i'));
  if(!m) m=raw.match(new RegExp(`(${role})\\s*(?:[-–—|,:]|at|is)\\s*${name}`,'i'));
  if(!m) return null;
  const firstIsRole=/manager|director|head|facilit|operation|property|plant|maintenance|engineering|technical/i.test(m[1]);
  const person=firstIsRole?m[2]:m[1];
  const contactRole=firstIsRole?m[1]:m[2];
  if(company&&person.toLowerCase().includes(company.toLowerCase().split(' ')[0])) return null;
  return {person:person.trim(),role:contactRole.trim(),sourceUrl:result.url,detail:raw.slice(0,420)};
}

async function findContactPerson(company,domain,region=''){
  const q=domain
    ? `"${company}" facilities manager OR operations manager OR property manager site:${domain}`
    : `"${company}" facilities manager OR operations manager OR property manager ${region||'South Africa'}`;

  // Keyless/local search first.
  const local=await localSearch(q,8,{
    excludeDomains:COMMON_EXCLUDED_DOMAINS
  });

  for(const r of local){
    if(!sourceMatchesEntity(r,company,domain?`https://${domain}`:'')) continue;

    const p=personFromResult(r,company);
    if(p) return p;
  }

  // Tavily is strictly last-resort and passes through the daily fallback gate.
  const fallback=await tavilyFallbackSearch(
    q,
    6,
    {excludeDomains:COMMON_EXCLUDED_DOMAINS},
    `contact-person:${company}`
  );

  for(const r of fallback){
    if(!sourceMatchesEntity(r,company,domain?`https://${domain}`:'')) continue;

    const p=personFromResult(r,company);
    if(p) return p;
  }

  return null;
}

async function enrichCandidate(agent,candidate,context){
  const evidence=[];
  const sourceUrls=[];

  let companyName=candidate.companyName||cleanCompanyName(candidate.title||'');
  let address=candidate.address||'';
  let phone=normalizePhone(candidate.phone||'');
  let website=candidate.website||candidate.url||'';

  let aggregate=`${candidate.title||''} ${candidate.description||''} ${companyName} ${address}`;

  if(candidate.placeUrl){
    sourceUrls.push(candidate.placeUrl);

    evidence.push({
      type:'PLACE',
      url:candidate.placeUrl,
      detail:`Public place record: ${companyName}${address?`, ${address}`:''}.`
    });
  }

  if(candidate.url){
    sourceUrls.push(candidate.url);

    evidence.push({
      type:'SEARCH_RESULT',
      url:candidate.url,
      detail:(candidate.description||candidate.title||'').slice(0,700)
    });
  }

  // Do not treat social/directory/noise URLs as the official website.
  if(website&&NOISE_DOMAINS.test(domainOf(website))){
    website='';
  }

  // If discovery supplied only a company/place name, resolve its official site locally.
  if(!website&&companyName){
    const official=await localSearch(
      `"${companyName}" ${context.region} official website`,
      5,
      {excludeDomains:COMMON_EXCLUDED_DOMAINS}
    );

    const match=
      official.find(r=>sourceMatchesEntity(r,companyName,''))||
      official[0];

    if(match?.url){
      website=match.url;

      sourceUrls.push(match.url);

      evidence.push({
        type:'LOCAL_WEBSITE_RESOLUTION',
        url:match.url,
        detail:(match.description||match.title||'').slice(0,500)
      });
    }
  }

  let siteText='';
  let sitePages=[];

  // Autonomous Playwright investigation first.
  if(website){
    const crawl=await researchWebsite(
      website,
      {
        maxPages:4,
        delayMs:500
      }
    );

    if(crawl?.text){
      siteText=crawl.text;
      sitePages=crawl.pages||[];

      aggregate+=' '+siteText.slice(0,180000);

      for(const p of sitePages){
        if(p?.url) sourceUrls.push(p.url);
      }

      evidence.push({
        type:'LOCAL_WEBSITE_CRAWL',
        url:sitePages[0]?.url||website,
        detail:siteText.slice(0,700)
      });
    }else{
      // Cheap direct HTTP fallback; still no API key or search credit.
      const direct=await fetchPublicPage(website);

      if(direct.text){
        siteText=direct.text;

        aggregate+=' '+siteText.slice(0,180000);

        sourceUrls.push(direct.url||website);

        evidence.push({
          type:'COMPANY_WEBSITE',
          url:direct.url||website,
          detail:siteText.slice(0,700)
        });
      }
    }
  }

  // Extract an address from the company's own website before any geocoding API.
  if(!address&&siteText){
    const locallyFound=extractLocalAddress(
      siteText,
      context.region
    );

    if(locallyFound){
      address=locallyFound;

      evidence.push({
        type:'LOCAL_ADDRESS',
        url:sitePages[0]?.url||website,
        detail:`Address extracted from public company website: ${address}`
      });
    }
  }

  // Use free/local search snippets as a second address source.
  if(!address&&companyName){
    const addressResults=await localSearch(
      `"${companyName}" address location ${context.region}`,
      6,
      {excludeDomains:COMMON_EXCLUDED_DOMAINS}
    );

    for(const r of addressResults){
      if(!sourceMatchesEntity(r,companyName,website)) continue;

      const found=extractLocalAddress(
        `${r.title||''} ${r.description||''}`,
        context.region
      );

      if(!found) continue;

      address=found;
      sourceUrls.push(r.url);

      evidence.push({
        type:'LOCAL_ADDRESS_SEARCH',
        url:r.url,
        detail:(r.description||r.title||'').slice(0,500)
      });

      break;
    }
  }

  // Geoapify now runs only when local methods could not establish an address.
  if(!address&&companyName){
    const places=await geoapifyFallbackSearch(
      `${companyName} ${context.region}`,
      3,
      `address:${companyName}`
    );

    const p=
      places.find(x=>
        x.companyName &&
        !GENERIC_NAMES.test(cleanCompanyName(x.companyName))
      ) ||
      places[0];

    if(p){
      address=p.address||address;

      candidate.placeId=p.placeId||candidate.placeId;
      candidate.placeUrl=p.placeUrl||candidate.placeUrl;

      if(p.placeUrl){
        sourceUrls.push(p.placeUrl);
      }

      evidence.push({
        type:'PLACE_VALIDATION_FALLBACK',
        url:p.placeUrl||'',
        detail:`Geoapify fallback validation for ${companyName}: ${p.address||'location match'}.`
      });
    }
  }

  let contacts=extractContacts(siteText);

  if(candidate.email){
    contacts.emails=[
      candidate.email,
      ...contacts.emails
    ];
  }

  if(candidate.phone&&!phone){
    phone=normalizePhone(candidate.phone);
  }

  // Keyless SearXNG contact enrichment.
  if(!contacts.emails.length||!phone){
    const contactResults=await localSearch(
      `"${companyName}" contact email phone ${context.region}`,
      6,
      {excludeDomains:COMMON_EXCLUDED_DOMAINS}
    );

    for(const r of contactResults){
      if(!sourceMatchesEntity(r,companyName,website)) continue;

      aggregate+=' '+(r.description||'');

      if(r.url) sourceUrls.push(r.url);

      evidence.push({
        type:'LOCAL_CONTACT_SEARCH',
        url:r.url,
        detail:(r.description||r.title||'').slice(0,500)
      });

      const extracted=extractContacts(
        `${r.title||''} ${r.description||''}`
      );

      contacts={
        emails:[
          ...new Set([
            ...contacts.emails,
            ...extracted.emails
          ])
        ],
        phones:[
          ...new Set([
            ...contacts.phones,
            ...extracted.phones
          ])
        ]
      };
    }
  }

  // Tavily only if local website + local search still failed.
  if(!contacts.emails.length||(!phone&&!contacts.phones.length)){
    const contactResults=await tavilyFallbackSearch(
      `"${companyName}" contact email phone ${context.region}`,
      5,
      {excludeDomains:COMMON_EXCLUDED_DOMAINS},
      `contacts:${companyName}`
    );

    for(const r of contactResults){
      if(!sourceMatchesEntity(r,companyName,website)) continue;

      aggregate+=' '+(r.description||'');

      if(r.url) sourceUrls.push(r.url);

      evidence.push({
        type:'CONTACT_SEARCH_FALLBACK',
        url:r.url,
        detail:(r.description||r.title||'').slice(0,500)
      });

      const extracted=extractContacts(
        `${r.title||''} ${r.description||''}`
      );

      contacts={
        emails:[
          ...new Set([
            ...contacts.emails,
            ...extracted.emails
          ])
        ],
        phones:[
          ...new Set([
            ...contacts.phones,
            ...extracted.phones
          ])
        ]
      };
    }
  }

  if(!phone){
    phone=contacts.phones[0]||'';
  }

  const email=selectEmail(contacts.emails);

  const classification=classifyLead(
    agent,
    aggregate,
    candidate.types||[]
  );

  const usage=estimateUsage(
    agent,
    classification.facilityType,
    classification.signals
  );

  const domain=domainOf(website);

  const person=await findContactPerson(
    companyName,
    domain,
    context.region
  );

  if(person){
    sourceUrls.push(person.sourceUrl);

    evidence.push({
      type:'CONTACT_PERSON',
      url:person.sourceUrl,
      detail:person.detail
    });
  }

  const lead={
    id:crypto.randomUUID(),
    batchId:context.batchId,
    agent,
    createdAt:now(),
    updatedAt:now(),

    companyName,
    address,
    contactPerson:person?.person||'',
    contactRole:person?.role||'',
    contactNumber:phone,
    email,
    website,

    placeId:candidate.placeId||'',
    lat:candidate.lat??null,
    lon:candidate.lon??null,

    facilityType:classification.facilityType,
    sector:context.sector,
    region:context.region,

    estimatedKwhMin:usage.min,
    estimatedKwhMax:usage.max,
    usageConfidence:usage.confidence,
    usageMethod:usage.method,

    unitCount:
      classification.signals.unitCount||
      Number(candidate.buildingUnits)||
      null,

    facilityAreaM2:
      classification.signals.areaM2||
      null,

    evidence:[
      ...new Map(
        evidence.map(e=>[
          `${e.type}|${e.url}|${e.detail}`,
          e
        ])
      ).values()
    ].slice(0,15),

    sourceUrls:[
      ...new Set(sourceUrls.filter(Boolean))
    ].slice(0,15),

    fridayStatus:'PENDING',
    fridayScore:null,
    fridayReasons:[],
    dedupeKey:'',
    status:'DISCOVERED'
  };

  lead.dedupeKey=dedupeKey(lead);
  lead.canonicalName=canonicalEntityName(lead.companyName);

  const integrity=preFridayIntegrity(lead);

  lead.integrityStatus=
    integrity.ok?'PASS':'FAIL';

  lead.integrityReasons=
    integrity.reasons;

  return lead;
}

async function discover(agent,batch){
  const profile=effectivePolicy(agent).research;
  const regionList=regions();
  const cursor=batch.searchCursor||0;

  const region=
    regionList[cursor%regionList.length];

  const sector=
    profile.sectors[
      Math.floor(cursor/regionList.length)%
      profile.sectors.length
    ];

  const query=`${sector} ${region}`;

  const candidates=[];
  const seen=new Set();

  // v0.9 PRIMARY DISCOVERY:
  // local SearXNG - no Tavily/Geoapify credit.
  const local=await localSearch(
    query,
    12,
    {excludeDomains:COMMON_EXCLUDED_DOMAINS}
  );

  for(const r of local){
    if(!looksLikeCandidate(agent,r)) continue;

    const k=(
      domainOf(r.url)||
      canonicalEntityName(r.title)
    ).toLowerCase();

    if(!k||seen.has(k)) continue;

    seen.add(k);
    candidates.push(r);
  }

  // Geoapify only when local discovery did not produce enough viable candidates.
  if(candidates.length<4){
    const places=await geoapifyFallbackSearch(
      query,
      12,
      `discovery:${agent}:${sector}:${region}`
    );

    for(const p of places){
      if(!looksLikeCandidate(agent,p)) continue;

      const k=(
        p.placeId||
        `${canonicalEntityName(p.companyName)}|${p.address||''}`
      ).toLowerCase();

      if(!k||seen.has(k)) continue;

      seen.add(k);
      candidates.push(p);
    }
  }

  // Tavily is now the final discovery source, behind its daily fallback cap.
  if(candidates.length<4){
    const web=await tavilyFallbackSearch(
      `${sector} ${region} company address contact`,
      8,
      {excludeDomains:COMMON_EXCLUDED_DOMAINS},
      `discovery:${agent}:${sector}:${region}`
    );

    for(const r of web){
      if(!looksLikeCandidate(agent,r)) continue;

      const k=(
        domainOf(r.url)||
        canonicalEntityName(r.title)
      ).toLowerCase();

      if(!k||seen.has(k)) continue;

      seen.add(k);
      candidates.push(r);
    }
  }

  return {
    candidates:candidates.slice(
      0,
      Number(profile.maxCandidatesPerQuery||8)
    ),
    region,
    sector,
    query,
    nextCursor:cursor+1
  };
}

export function ensureBatch(agent){
  const db=load();
  let batch=(db.leadBatches||[]).find(b=>b.agent===agent&&!['APPROVED','CANCELLED'].includes(b.status));
  if(batch) return batch;

  const daily=dailyBatchStatus(agent,db);
  if(daily.started>=daily.limit) return null;

  const slots=remainingApprovalSlots(agent,db);
  if(slots<=0) return null;

  const batchSize=Math.min(Number(effectivePolicy(agent).research.batchSize||10),slots);
  batch={
    id:crypto.randomUUID(),
    agent,
    batchNumber:1+(db.leadBatches||[]).filter(b=>b.agent===agent).length,
    targetSize:batchSize,
    status:'RESEARCHING',
    createdAt:now(),
    updatedAt:now(),
    searchCursor:0,
    submittedAt:null,
    approvedAt:null,
    readyForPepper:false,
    streamingFriday:true
  };
  mutate(d=>{
    d.leadBatches=d.leadBatches||[];
    d.leadBatches.unshift(batch);
    if(d.agents[agent]){
      d.agents[agent].status='WORKING';
      d.agents[agent].lastError=null;
      d.agents[agent].currentTask=`Building daily batch ${daily.started+1}/${daily.limit} · batch #${batch.batchNumber} (0/${batch.targetSize} approved)`;
      d.agents[agent].lastHeartbeat=now();
    }
  });
  logEvent('Friday','INFO','BATCH_DISPATCH',`Friday opened ${agent} daily batch ${daily.started+1}/${daily.limit} (#${batch.batchNumber}). Leads will be reviewed individually as they arrive.`,{batchId:batch.id,dailyBatch:daily.started+1,dailyLimit:daily.limit});
  return batch;
}

function updateBatchProgress(batchId){
  const db=load();
  const batch=(db.leadBatches||[]).find(b=>b.id===batchId);
  if(!batch) throw new Error('Batch not found');
  const summary=reviewBatch(batch,db.leads||[]);
  const wasComplete=batch.status==='APPROVED';
  mutate(d=>{
    const x=(d.leadBatches||[]).find(q=>q.id===batchId);
    if(!x)return;
    x.updatedAt=now();
    x.reviewSummary=summary;
    if(summary.complete){
      x.status='APPROVED';
      x.approvedAt=x.approvedAt||now();
      x.readyForPepper=true; // legacy marker only; Pepper streams individual approvals.
      if(d.agents?.[x.agent]){
        d.agents[x.agent].status='WAITING';
        d.agents[x.agent].lastError=null;
        d.agents[x.agent].currentTask=`Batch #${x.batchNumber} complete (${summary.approved}/${x.targetSize} approved).`;
        d.agents[x.agent].lastHeartbeat=now();
      }
    }else{
      if(x.status!=='CANCELLED') x.status='RESEARCHING';
      if(d.agents?.[x.agent]){
        d.agents[x.agent].status='WORKING';
        d.agents[x.agent].lastError=null;
        d.agents[x.agent].currentTask=`Building batch #${x.batchNumber} (${summary.approved}/${x.targetSize} approved · ${summary.replacementsNeeded} still needed)`;
        d.agents[x.agent].lastHeartbeat=now();
      }
    }
    if(d.agents?.Friday){
      d.agents.Friday.status='WAITING';
      d.agents.Friday.lastError=null;
      d.agents.Friday.currentTask=null;
      d.agents.Friday.lastHeartbeat=now();
    }
  });
  if(summary.complete&&!wasComplete){
    logEvent('Friday','INFO','BATCH_APPROVED',`Friday completed ${batch.agent} batch #${batch.batchNumber}. Pepper has already received approved leads individually.`,{batchId,summary});
  }
  return summary;
}

export function fridayReviewLead(leadId){
  let db=load();
  const lead=(db.leads||[]).find(l=>l.id===leadId);
  if(!lead) throw new Error('Lead not found');
  if(lead.fridayStatus!=='PENDING') return {status:lead.fridayStatus,score:lead.fridayScore,reasons:lead.fridayReasons||[],alreadyReviewed:true};

  if(db.agents?.Friday){
    mutate(d=>{
      if(d.agents?.Friday){
        d.agents.Friday.status='WORKING';
        d.agents.Friday.lastError=null;
        d.agents.Friday.currentTask=`Reviewing ${lead.companyName||'new lead'} as it arrives`;
        d.agents.Friday.lastHeartbeat=now();
      }
    });
    db=load();
  }

  const result=reviewLead(lead,db.leads||[],db.leadRegistry||[]);
  let finalResult=result;
  if(result.status==='APPROVED'){
    const q=quotaDecision(lead.agent,load());
    if(!q.allowed){
      finalResult={
        ...result,
        status:'QUOTA_HELD',
        reasons:[...(result.reasons||[]),`Approved-lead quota reached for ${lead.agent}; qualification preserved and held for the next quota window.`]
      };
    }
  }

  const stamp=now();
  mutate(d=>{
    const x=(d.leads||[]).find(l=>l.id===leadId);
    if(!x)return;
    Object.assign(x,{
      fridayStatus:finalResult.status,
      fridayScore:finalResult.score,
      fridayReasons:finalResult.reasons,
      updatedAt:stamp,
      status:finalResult.status==='APPROVED'
        ?'FRIDAY_APPROVED'
        :finalResult.status==='DUPLICATE_IGNORED'
          ?'DUPLICATE_IGNORED'
          :'FRIDAY_'+finalResult.status
    });
    if(finalResult.status==='APPROVED') x.fridayApprovedAt=stamp;
  });

  logEvent(
    'Friday',
    ['APPROVED','DUPLICATE_IGNORED'].includes(finalResult.status)?'INFO':'WARN',
    'LEAD_REVIEW',
    `Friday ${String(finalResult.status).toLowerCase()} ${lead.companyName}.`,
    {leadId,score:finalResult.score,reasons:finalResult.reasons,streaming:true}
  );

  updateBatchProgress(lead.batchId);
  syncLegacyAuraData();

  if(finalResult.status==='APPROVED'){
    logEvent('Friday','INFO','LEAD_PASSED_TO_PEPPER',`Friday passed ${lead.companyName} to Pepper immediately after approval.`,{leadId,batchId:lead.batchId});
    triggerPepperForApprovedLead(leadId);
  }

  return finalResult;
}

export async function researchStep(agent){
  const providers=providerStatus();
  const localDiscovery=localDiscoveryStatus();

  if(
    !localDiscovery.enabled &&
    !providers.geoapify.configured &&
    !providers.tavily.configured
  ){
    mutate(db=>{
      if(db.agents[agent]){
        db.agents[agent].status='BLOCKED';
        db.agents[agent].lastError=null;
        db.agents[agent].currentTask='Waiting for a public research provider.';
        db.agents[agent].lastHeartbeat=now();
      }
    });

    logEvent(
      agent,
      'WARN',
      'RESEARCH_BLOCKED',
      `${agent} cannot research: local discovery and fallback providers are unavailable.`
    );

    return {blocked:true};
  }

  mutate(db=>{if(db.agents[agent]){db.agents[agent].status='WORKING';db.agents[agent].lastError=null;db.agents[agent].lastHeartbeat=now()}});
  const batch=ensureBatch(agent);
  if(!batch){
    const fresh=load();
    const q=quotaDecision(agent,fresh);
    const daily=dailyBatchStatus(agent,fresh);
    if(!q.allowed){
      mutate(db=>{if(db.agents[agent]){db.agents[agent].status='QUOTA_REACHED';db.agents[agent].lastError=null;db.agents[agent].currentTask=`Monthly approved-lead quota reached (${q.status.agents[agent].used}/${q.status.agents[agent].limit}).`;db.agents[agent].lastHeartbeat=now()}});
      return {blocked:true,quota:true};
    }
    if(daily.started>=daily.limit){
      mutate(db=>{if(db.agents[agent]){db.agents[agent].status='DAILY_TARGET_REACHED';db.agents[agent].lastError=null;db.agents[agent].currentTask=`Daily batch target reached (${daily.started}/${daily.limit}). Waiting for the next Johannesburg day.`;db.agents[agent].lastHeartbeat=now()}});
      return {blocked:true,dailyLimit:true,daily};
    }
    return {blocked:true};
  }

  // Pick up any legacy PENDING records before doing new research.
  const legacyPending=load().leads?.filter(l=>l.batchId===batch.id&&l.fridayStatus==='PENDING').map(l=>l.id)||[];
  for(const id of legacyPending) fridayReviewLead(id);

  let current=load();
  let batchLeads=(current.leads||[]).filter(l=>l.batchId===batch.id);
  let approved=batchLeads.filter(l=>l.fridayStatus==='APPROVED').length;
  const targetSize=Number(batch.targetSize||effectivePolicy(agent).research.batchSize||10);
  if(approved>=targetSize) return updateBatchProgress(batch.id);

  const found=await discover(agent,batch);
  mutate(db=>{
    const b=(db.leadBatches||[]).find(x=>x.id===batch.id);
    if(b){b.searchCursor=found.nextCursor;b.updatedAt=now()}
    if(db.agents[agent]){db.agents[agent].status='WORKING';db.agents[agent].lastError=null;db.agents[agent].currentTask=`Searching ${found.sector} · ${found.region} · ${approved}/${targetSize} approved`;db.agents[agent].lastHeartbeat=now()}
  });
  logEvent(agent,'INFO','RESEARCH_QUERY',`${agent} searching: ${found.query}`,{batchId:batch.id,candidates:found.candidates.length});

  let added=0;
  for(const c of found.candidates){
    current=load();
    approved=(current.leads||[]).filter(l=>l.batchId===batch.id&&l.fridayStatus==='APPROVED').length;
    if(approved>=targetSize) break;

    try{
      const before=load();
      const earlyDuplicate=findRegistryDuplicate(c,before.leadRegistry||[]);
      if(earlyDuplicate){
        mutate(d=>markDuplicateSeen(d,earlyDuplicate,agent,batch.id));
        logEvent('Friday','INFO','DUPLICATE_IGNORED',`Friday ignored previously pulled candidate ${c.companyName||c.title||'candidate'}.`,{batchId:batch.id,originalLeadId:earlyDuplicate.entry.firstLeadId,originalBatchNumber:earlyDuplicate.entry.firstBatchNumber,reason:earlyDuplicate.reason});
        continue;
      }

      const lead=await enrichCandidate(agent,c,{batchId:batch.id,region:found.region,sector:found.sector});
      if(lead.integrityStatus!=='PASS'){
        logEvent(agent,'INFO','CANDIDATE_SKIPPED',`${agent} skipped ${lead.companyName||'candidate'}: ${lead.integrityReasons.join('; ')}`,{batchId:batch.id,reasons:lead.integrityReasons});
        continue;
      }
      if(!effectivePolicy(agent).research.allowedTypes.includes(lead.facilityType)){
        logEvent(agent,'INFO','CANDIDATE_SKIPPED',`${agent} skipped ${lead.companyName||'candidate'}: facility type ${lead.facilityType}.`,{batchId:batch.id});
        continue;
      }

      const db=load();
      const registryDuplicate=findRegistryDuplicate(lead,db.leadRegistry||[]);
      const historicalDuplicate=(db.leads||[]).find(x=>isProbableDuplicate(lead,x));
      if(registryDuplicate||historicalDuplicate){
        if(registryDuplicate) mutate(d=>markDuplicateSeen(d,registryDuplicate,agent,batch.id));
        const original=registryDuplicate?.entry||historicalDuplicate;
        logEvent('Friday','INFO','DUPLICATE_IGNORED',`Friday ignored previously pulled lead ${lead.companyName}.`,{batchId:batch.id,originalLeadId:original?.firstLeadId||original?.id||null,originalBatchNumber:original?.firstBatchNumber||null,reason:registryDuplicate?.reason||'historical lead match'});
        continue;
      }

      mutate(d=>{d.leads=d.leads||[];d.leads.push(lead);registerLead(d,lead)});
      added++;
      logEvent(agent,'INFO','LEAD_DISCOVERED',`${agent} found ${lead.companyName||'candidate lead'}. Friday is reviewing it immediately.`,{leadId:lead.id,batchId:batch.id});
      syncLegacyAuraData();

      // Streaming handoff: Friday evaluates this individual lead immediately.
      fridayReviewLead(lead.id);
    }catch(e){
      logEvent(agent,'WARN','CANDIDATE_ERROR',`${agent} could not enrich/review a candidate.`,{error:String(e),batchId:batch.id});
    }
  }

  current=load();
  approved=(current.leads||[]).filter(l=>l.batchId===batch.id&&l.fridayStatus==='APPROVED').length;
  mutate(db=>{if(db.agents[agent]){db.agents[agent].status='WORKING';db.agents[agent].lastError=null;db.agents[agent].currentTask=`Building lead batch #${batch.batchNumber} (${approved}/${targetSize} approved)`;db.agents[agent].lastHeartbeat=now()}});
  if(approved>=targetSize) return updateBatchProgress(batch.id);
  return {added,progress:approved,target:targetSize};
}

// Retained for manual/backward-compatible operations. Normal Phase 8.7 flow no longer waits for submission.
export function submitBatch(batchId){
  const db=load();
  const batch=(db.leadBatches||[]).find(b=>b.id===batchId);
  if(!batch) throw new Error('Batch not found');
  mutate(d=>{
    const b=(d.leadBatches||[]).find(x=>x.id===batchId);
    if(!b)return;
    b.status='FRIDAY_REVIEW';b.submittedAt=now();b.updatedAt=now();
  });
  logEvent(batch.agent,'INFO','BATCH_SUBMITTED',`${batch.agent} manually submitted batch #${batch.batchNumber}; Friday will review any remaining pending leads.`,{batchId});
  return fridayReview(batchId);
}

export function fridayReview(batchId){
  const db=load();
  const batch=(db.leadBatches||[]).find(b=>b.id===batchId);
  if(!batch) throw new Error('Batch not found');
  const ids=(db.leads||[]).filter(l=>l.batchId===batchId&&l.fridayStatus==='PENDING').map(l=>l.id);
  for(const id of ids) fridayReviewLead(id);
  return updateBatchProgress(batchId);
}

export function releaseQuotaHeld(agent){
  const db=load();
  const q=quotaDecision(agent,db);
  if(!q.allowed||q.remaining<=0) return {released:0};
  const held=(db.leads||[]).filter(l=>l.agent===agent&&l.fridayStatus==='QUOTA_HELD').slice(0,q.remaining);
  if(!held.length) return {released:0};
  mutate(d=>{
    for(const h of held){
      const x=(d.leads||[]).find(l=>l.id===h.id);
      if(x){x.fridayStatus='PENDING';x.status='DISCOVERED';x.updatedAt=now()}
    }
  });
  for(const h of held){
    try{fridayReviewLead(h.id)}catch{}
  }
  return {released:held.length};
}

export function prepareReplacements(agent){
  const db=load();
  const batch=(db.leadBatches||[]).find(b=>b.agent===agent&&b.status==='REWORK');
  if(!batch) return null;
  mutate(d=>{
    const b=(d.leadBatches||[]).find(x=>x.id===batch.id);
    if(b){b.status='RESEARCHING';b.updatedAt=now()}
    if(d.agents?.[agent]){
      d.agents[agent].status='WORKING';
      d.agents[agent].lastError=null;
      d.agents[agent].currentTask=`Continuing batch #${batch.batchNumber} with streaming Friday review`;
      d.agents[agent].lastHeartbeat=now();
    }
  });
  return batch;
}

