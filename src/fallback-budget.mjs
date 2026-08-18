import { load, mutate } from './store.mjs';

const DEFAULT_TIMEZONE = 'Africa/Johannesburg';

function env(name, fallback=''){
  return String(process.env[name] ?? fallback).trim();
}

function envInt(name, fallback, min=0, max=100000){
  const n = Number(process.env[name]);
  if(!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function timezone(){
  return env('PROVIDER_FALLBACK_TIMEZONE', DEFAULT_TIMEZONE) || DEFAULT_TIMEZONE;
}

function dayKey(value=new Date()){
  const d = value instanceof Date ? value : new Date(value);

  if(Number.isNaN(d.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA',{
    timeZone: timezone(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(d);

  const map = Object.fromEntries(
    parts.map(x => [x.type, x.value])
  );

  return `${map.year}-${map.month}-${map.day}`;
}

function providerConfig(provider){
  const p = String(provider || '').toUpperCase();

  if(p === 'TAVILY'){
    return {
      provider: p,
      mode: env('TAVILY_MODE','FALLBACK_ONLY').toUpperCase(),
      limit: envInt('TAVILY_MAX_FALLBACKS_PER_DAY',5,0,1000)
    };
  }

  if(p === 'GEOAPIFY'){
    return {
      provider: p,
      mode: env('GEOAPIFY_MODE','FALLBACK_ONLY').toUpperCase(),
      limit: envInt('GEOAPIFY_MAX_FALLBACKS_PER_DAY',10,0,1000)
    };
  }

  return {
    provider: p,
    mode: 'DISABLED',
    limit: 0
  };
}

export function fallbackStatus(provider, db=load()){
  const cfg = providerConfig(provider);
  const day = dayKey();

  const key = `${day}:${cfg.provider}`;

  const used = Number(
    db?.providerFallbackUsage?.[key]?.count || 0
  );

  const disabled =
    ['DISABLED','OFF','NEVER'].includes(cfg.mode);

  return {
    provider: cfg.provider,
    mode: cfg.mode,
    day,
    timezone: timezone(),
    used,
    limit: cfg.limit,
    remaining: Math.max(0, cfg.limit - used),
    allowed: !disabled && cfg.limit > 0 && used < cfg.limit
  };
}

export function fallbackAllowed(provider, db=load()){
  return fallbackStatus(provider, db).allowed;
}

export function reserveFallback(provider, reason=''){
  let result = {
    allowed: false,
    provider: String(provider || '').toUpperCase()
  };

  mutate(db => {
    const status = fallbackStatus(provider, db);

    if(!status.allowed){
      result = status;
      return;
    }

    db.providerFallbackUsage =
      db.providerFallbackUsage || {};

    const key = `${status.day}:${status.provider}`;

    const row =
      db.providerFallbackUsage[key] ||
      {
        provider: status.provider,
        day: status.day,
        count: 0,
        createdAt: new Date().toISOString()
      };

    row.count = Number(row.count || 0) + 1;
    row.updatedAt = new Date().toISOString();

    if(reason){
      row.lastReason = String(reason).slice(0,250);
    }

    db.providerFallbackUsage[key] = row;

    result = {
      ...status,
      allowed: true,
      used: row.count,
      remaining: Math.max(0, status.limit - row.count)
    };
  });

  return result;
}
