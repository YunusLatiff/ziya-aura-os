import crypto from 'node:crypto';
import {load,mutate} from './store.mjs';
import {logEvent} from './orchestrator.mjs';

const VERSION='1.0.0-organic';
const SAST_OFFSET_MS=2*60*60*1000;

const now=()=>new Date().toISOString();

const env=(name,fallback='')=>
  String(process.env[name]??fallback).trim();

const envBool=(name,fallback=false)=>{
  const value=env(name,fallback?'true':'false').toLowerCase();
  return ['1','true','yes','on','enabled'].includes(value);
};

const clamp=(n,min,max)=>
  Math.max(min,Math.min(max,Number(n)||min));

function sastDate(date=new Date()){
  return new Date(date.getTime()+SAST_OFFSET_MS);
}

function sastDateString(date=new Date()){
  return sastDate(date).toISOString().slice(0,10);
}

function mondayKey(date=new Date()){
  const d=sastDate(date);
  const day=d.getUTCDay();
  const back=(day+6)%7;

  d.setUTCDate(d.getUTCDate()-back);

  return d.toISOString().slice(0,10);
}

function futureDate(daysAhead=1,hour=9){
  const d=sastDate(new Date());

  d.setUTCDate(d.getUTCDate()+daysAhead);
  d.setUTCHours(hour,0,0,0);

  const yyyy=d.getUTCFullYear();
  const mm=String(d.getUTCMonth()+1).padStart(2,'0');
  const dd=String(d.getUTCDate()).padStart(2,'0');
  const hh=String(d.getUTCHours()).padStart(2,'0');

  return `${yyyy}-${mm}-${dd}T${hh}:00:00+02:00`;
}

export function natashaConfig(){
  return {
    version:VERSION,

    enabled:envBool(
      'NATASHA_ENABLED',
      true
    ),

    mode:'ORGANIC_ONLY',

    monthlyAdBudgetR:0,

    paidAdvertisingEnabled:false,

    platforms:[
      'FACEBOOK',
      'INSTAGRAM'
    ],

    postsPerWeek:clamp(
      env('NATASHA_POSTS_PER_WEEK','4'),
      1,
      7
    ),

    timezone:'Africa/Johannesburg',

    publishing:{
      connected:false,
      automatic:false,
      provider:'META_OFFICIAL_API',
      reason:'Meta publishing connection not configured yet.'
    },

    paidMedia:{
      status:'DORMANT',
      currentBudgetR:0,

      futureBudgetTiers:[
        6000,
        10000,
        15000,
        20000,
        25000,
        30000
      ],

      survivalCycleDays:90,

      activationRequiresOwner:true
    }
  };
}

const SECTORS=[
  {
    key:'SHOPPING_CENTRES',
    name:'shopping centres',
    audience:'Property owners, asset managers and facilities managers',
    problem:'rising common-area electricity costs and tariff exposure',
    visual:'Premium South African shopping centre exterior or rooftop solar installation'
  },

  {
    key:'MANUFACTURING',
    name:'manufacturing facilities',
    audience:'Operations directors, plant managers and CFOs',
    problem:'high daytime electrical demand and production-cost exposure',
    visual:'Modern South African manufacturing facility with rooftop solar and industrial energy infrastructure'
  },

  {
    key:'WAREHOUSE',
    name:'warehouses and distribution centres',
    audience:'Property owners, logistics operators and facilities managers',
    problem:'large roof area, daytime demand and escalating electricity costs',
    visual:'Large logistics warehouse with extensive rooftop solar array'
  },

  {
    key:'COMMERCIAL',
    name:'commercial buildings and office parks',
    audience:'Commercial property owners and facilities teams',
    problem:'unpredictable operating costs and common-area consumption',
    visual:'Premium office park with integrated commercial solar'
  },

  {
    key:'ESTATES',
    name:'residential estates',
    audience:'Estate executives, trustees and property managers',
    problem:'common-area electricity costs, backup requirements and tariff increases',
    visual:'Premium residential estate with solar and battery energy infrastructure'
  }
];

const PILLARS=[
  'ZERO_CAPEX',
  'ENERGY_RISK',
  'SOLAR_BESS',
  'EDUCATION',
  'COMMERCIAL_CASE'
];

const FORMATS=[
  'SINGLE_IMAGE',
  'CAROUSEL',
  'SINGLE_IMAGE',
  'REEL_BRIEF'
];

function sectorAt(index=0){
  return SECTORS[
    Math.abs(Number(index)||0)%SECTORS.length
  ];
}

function pillarAt(index=0){
  return PILLARS[
    Math.abs(Number(index)||0)%PILLARS.length
  ];
}

function formatAt(index=0){
  return FORMATS[
    Math.abs(Number(index)||0)%FORMATS.length
  ];
}

function copyFor(sector,pillar){
  if(pillar==='ZERO_CAPEX'){
    return {
      headline:'Energy infrastructure without the upfront capital burden.',

      caption:
`For qualifying ${sector.name}, reducing electricity exposure does not necessarily mean funding a solar and battery project from your own balance sheet.

Ziya Energy structures commercial solar PV, battery storage and energy optimisation through funded energy solutions designed around the site.

The objective is straightforward: reduce long-term energy risk while preserving capital for the business.

Interested in seeing whether your site could qualify for a zero-upfront energy structure?`,

      cta:'Request a commercial energy assessment'
    };
  }

  if(pillar==='ENERGY_RISK'){
    return {
      headline:'Your electricity tariff is a business risk.',

      caption:
`${sector.audience} are increasingly dealing with ${sector.problem}.

Energy should not be treated only as a monthly utility expense. For energy-intensive properties, it is a long-term operating risk that can be actively managed.

Ziya Energy combines solar PV, battery storage and commercial energy structuring to help businesses build a more predictable energy position.

A proper solution starts with the site's actual consumption profile — not a generic solar quote.`,

      cta:'Assess your site with Ziya Energy'
    };
  }

  if(pillar==='SOLAR_BESS'){
    return {
      headline:'Solar reduces energy cost. Storage changes when you depend on the grid.',

      caption:
`For commercial sites, solar PV and battery energy storage perform different jobs.

Solar can reduce daytime grid purchases. Battery storage can shift energy, support peak periods and improve resilience.

The right system is not simply the biggest system that fits on the roof. It is the system engineered around the site's load profile, tariff and operating requirements.

That is how Ziya approaches commercial energy infrastructure.`,

      cta:'Speak to Ziya about PV + BESS'
    };
  }

  if(pillar==='EDUCATION'){
    return {
      headline:'Before sizing solar, understand the load.',

      caption:
`A commercial energy proposal should begin with consumption data.

Operating hours, monthly kWh, tariff structure, peak demand and the shape of the site's load all affect the correct solar and battery configuration.

For ${sector.name}, designing from assumptions instead of actual consumption can materially distort the commercial case.

Ziya Energy starts with the energy profile and engineers the solution from there.`,

      cta:'Send us your electricity profile'
    };
  }

  return {
    headline:'The strongest solar proposal is a business case, not a panel count.',

    caption:
`For ${sector.name}, an energy project needs to make commercial sense before it makes technical sense.

That means understanding the site's electricity spend, consumption profile, operating schedule, tariff exposure and capital constraints.

Ziya Energy structures commercial solar, BESS and funded energy solutions around those variables.

The result is an energy strategy built around the business rather than a commodity equipment quote.`,

    cta:'Explore a commercial energy solution'
  };
}

function hashtagsFor(sector){
  const sectorTag=
    sector.key==='SHOPPING_CENTRES'
      ?'#CommercialProperty'
      :sector.key==='MANUFACTURING'
        ?'#Manufacturing'
        :sector.key==='WAREHOUSE'
          ?'#Logistics'
          :sector.key==='ESTATES'
            ?'#PropertyManagement'
            :'#CommercialRealEstate';

  return [
    '#ZiyaEnergy',
    '#CommercialSolar',
    '#BatteryStorage',
    '#EnergyAsAService',
    '#SouthAfrica',
    sectorTag
  ];
}

export function buildOrganicPost({
  index=0,
  scheduledAt=null
}={}){
  const sector=sectorAt(index);
  const pillar=pillarAt(index);
  const format=formatAt(index);
  const copy=copyFor(sector,pillar);

  return {
    id:crypto.randomUUID(),

    agent:'Natasha',

    version:VERSION,

    createdAt:now(),
    updatedAt:now(),

    mode:'ORGANIC_ONLY',

    paid:false,
    paidBudgetR:0,

    platforms:[
      'FACEBOOK',
      'INSTAGRAM'
    ],

    sector:sector.key,
    sectorName:sector.name,

    audience:sector.audience,

    pillar,

    format,

    headline:copy.headline,
    caption:copy.caption,
    cta:copy.cta,

    hashtags:hashtagsFor(sector),

    website:'https://ziyaenergy.co.za',

    creativeBrief:{
      objective:'Premium B2B organic promotional content',
      visualDirection:sector.visual,
      brand:'Ziya Energy',
      tone:'Premium, technical, commercially credible, modern',
      avoid:[
        'residential installer aesthetic',
        'cheap solar advertising',
        'guaranteed savings claims',
        'fabricated statistics',
        'stock-photo handshake imagery'
      ]
    },

    scheduledAt,

    status:'PLANNED',

    designStatus:'PENDING',

    publishStatus:'BLOCKED_META_NOT_CONNECTED',

    publishedAt:null,

    metaPostIds:[],

    performance:{
      impressions:0,
      reach:0,
      likes:0,
      comments:0,
      shares:0,
      saves:0,
      profileVisits:0,
      websiteClicks:0,
      enquiries:0,
      qualifiedLeads:0,
      attributableWon:0
    }
  };
}

export function ensureNatashaState(){
  const cfg=natashaConfig();

  mutate(db=>{
    db.agents=db.agents||{};

    if(!db.agents.Natasha){
      db.agents.Natasha={
        name:'Natasha',
        role:'Organic Marketing Agent',
        authority:45,
        reportsTo:'Aura',
        status:cfg.enabled
          ?'WAITING'
          :'DISABLED',
        currentTask:cfg.enabled
          ?'Preparing zero-budget organic marketing.'
          :'Natasha is disabled.',
        lastError:null,
        lastHeartbeat:now(),
        protected:false,
        external:false
      };
    }else{
      db.agents.Natasha.name='Natasha';
      db.agents.Natasha.role='Organic Marketing Agent';
      db.agents.Natasha.reportsTo='Aura';
      db.agents.Natasha.lastHeartbeat=now();
    }

    db.natasha=db.natasha||{
      createdAt:now()
    };

    Object.assign(
      db.natasha,
      cfg,
      {
        updatedAt:now()
      }
    );

    db.natashaPosts=
      Array.isArray(db.natashaPosts)
        ?db.natashaPosts
        :[];

    db.natashaPerformance=
      db.natashaPerformance||{
        totalPosts:0,
        totalReach:0,
        totalWebsiteClicks:0,
        totalEnquiries:0,
        totalQualifiedLeads:0,
        attributableWon:0
      };
  });

  return natashaStatus();
}

export function planOrganicWeek(){
  ensureNatashaState();

  const cfg=natashaConfig();
  const db=load();

  if(!cfg.enabled){
    return {
      created:0,
      blocked:'DISABLED'
    };
  }

  const planKey=mondayKey();

  const existing=(db.natashaPosts||[])
    .filter(x=>x.planKey===planKey);

  if(existing.length){
    return {
      created:0,
      planKey,
      posts:existing,
      alreadyPlanned:true
    };
  }

  const times=[9,12,10,14,11,13,9];
  const posts=[];

  for(let i=0;i<cfg.postsPerWeek;i++){
    const daysAhead=1+(i*2);

    const post=buildOrganicPost({
      index:i,
      scheduledAt:futureDate(
        daysAhead,
        times[i%times.length]
      )
    });

    post.planKey=planKey;
    posts.push(post);
  }

  mutate(db2=>{
    db2.natashaPosts=db2.natashaPosts||[];

    db2.natashaPosts.push(...posts);

    db2.natasha.lastPlanKey=planKey;
    db2.natasha.lastPlanAt=now();

    if(db2.agents?.Natasha){
      db2.agents.Natasha.status='WAITING';

      db2.agents.Natasha.currentTask=
        `${posts.length} organic Facebook/Instagram posts planned · awaiting creative production`;

      db2.agents.Natasha.lastHeartbeat=now();
      db2.agents.Natasha.lastError=null;
    }
  });

  logEvent(
    'Natasha',
    'INFO',
    'NATASHA_WEEK_PLANNED',
    `Natasha created ${posts.length} zero-budget organic social posts.`,
    {
      planKey,
      posts:posts.map(x=>x.id),
      budgetR:0,
      platforms:[
        'FACEBOOK',
        'INSTAGRAM'
      ]
    }
  );

  return {
    created:posts.length,
    planKey,
    posts
  };
}

export function natashaStatus(){
  const db=load();
  const cfg=natashaConfig();

  const posts=db.natashaPosts||[];

  const planned=posts
    .filter(x=>x.status==='PLANNED')
    .length;

  const published=posts
    .filter(x=>x.publishStatus==='PUBLISHED')
    .length;

  const nextPosts=posts
    .filter(x=>x.scheduledAt)
    .sort(
      (a,b)=>
        new Date(a.scheduledAt)-
        new Date(b.scheduledAt)
    )
    .slice(0,8);

  return {
    ...cfg,

    agent:
      db.agents?.Natasha||null,

    counts:{
      total:posts.length,
      planned,
      published
    },

    nextPosts
  };
}

export function updatePostDesign(
  postId,
  {
    assetPath='',
    assetUrl='',
    notes=''
  }={}
){
  let updated=null;

  mutate(db=>{
    const post=(db.natashaPosts||[])
      .find(x=>x.id===postId);

    if(!post){
      throw new Error(
        'Natasha post not found.'
      );
    }

    post.designStatus='READY';
    post.assetPath=assetPath;
    post.assetUrl=assetUrl;
    post.designNotes=notes;
    post.updatedAt=now();

    updated={...post};
  });

  return updated;
}

export function recordOrganicPerformance(
  postId,
  metrics={}
){
  let result=null;

  mutate(db=>{
    const post=(db.natashaPosts||[])
      .find(x=>x.id===postId);

    if(!post){
      throw new Error(
        'Natasha post not found.'
      );
    }

    post.performance={
      ...post.performance,
      ...metrics
    };

    post.updatedAt=now();

    const posts=db.natashaPosts||[];

    db.natashaPerformance={
      totalPosts:
        posts.filter(
          x=>x.publishStatus==='PUBLISHED'
        ).length,

      totalReach:
        posts.reduce(
          (a,x)=>
            a+
            Number(
              x.performance?.reach||0
            ),
          0
        ),

      totalWebsiteClicks:
        posts.reduce(
          (a,x)=>
            a+
            Number(
              x.performance?.websiteClicks||0
            ),
          0
        ),

      totalEnquiries:
        posts.reduce(
          (a,x)=>
            a+
            Number(
              x.performance?.enquiries||0
            ),
          0
        ),

      totalQualifiedLeads:
        posts.reduce(
          (a,x)=>
            a+
            Number(
              x.performance?.qualifiedLeads||0
            ),
          0
        ),

      attributableWon:
        posts.reduce(
          (a,x)=>
            a+
            Number(
              x.performance?.attributableWon||0
            ),
          0
        )
    };

    result={
      post:{...post},
      totals:{...db.natashaPerformance}
    };
  });

  return result;
}

export async function natashaTick(){
  ensureNatashaState();

  const cfg=natashaConfig();
  const db=load();

  if(!cfg.enabled){
    mutate(d=>{
      if(d.agents?.Natasha){
        d.agents.Natasha.status='DISABLED';
        d.agents.Natasha.currentTask='Natasha is disabled.';
        d.agents.Natasha.lastHeartbeat=now();
      }
    });

    return {
      blocked:'DISABLED'
    };
  }

  if(db.agents?.Natasha?.status==='PAUSED'){
    return {
      blocked:'PAUSED'
    };
  }

  const plan=planOrganicWeek();

  mutate(d=>{
    if(d.agents?.Natasha){
      d.agents.Natasha.status='WAITING';

      d.agents.Natasha.currentTask=
        'Organic-only marketing active · Meta publishing connection pending';

      d.agents.Natasha.lastHeartbeat=now();
      d.agents.Natasha.lastError=null;
    }
  });

  return {
    ok:true,
    mode:'ORGANIC_ONLY',
    budgetR:0,
    plan,
    publishingConnected:false
  };
}
