const MAIL=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/ig;
const PHONE=/(?:\+27|0)\s?(?:\d[\s()-]?){8,11}\d/g;

export function cleanCompanyName(s=''){
  return String(s)
    .replace(/\s*[|–—-]\s*(home|contact|about|official site|south africa).*$/i,'')
    .replace(/<[^>]+>/g,'')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,160);
}

export function domainOf(url=''){
  try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'')}catch{return ''}
}

export function canonicalEntityName(s=''){
  return cleanCompanyName(s)
    .toLowerCase()
    .replace(/\b(pty|ltd|limited|cc|inc|holdings|group|south africa|sa)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function canonicalAddress(s=''){
  return String(s)
    .toLowerCase()
    .replace(/\b(south africa|gauteng|city of johannesburg metropolitan municipality|city of tshwane metropolitan municipality|city of ekurhuleni metropolitan municipality)\b/g,' ')
    .replace(/\b(road|rd|street|st|avenue|ave|drive|dr|boulevard|blvd)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

export function entityTokens(s=''){
  return canonicalEntityName(s)
    .split(' ')
    .filter(x=>x.length>=4 && !['company','centre','center','estate','retail','office','park','manufacturing','manufacturer','factory','industrial','shopping','apartments','apartment'].includes(x));
}

export function sameEntity(a,b){
  const an=canonicalEntityName(a?.companyName||a?.title||a||'');
  const bn=canonicalEntityName(b?.companyName||b?.title||b||'');
  if(!an||!bn) return false;
  if(an===bn) return true;
  const at=new Set(an.split(' ').filter(x=>x.length>=4));
  const bt=new Set(bn.split(' ').filter(x=>x.length>=4));
  if(!at.size||!bt.size) return false;
  const common=[...at].filter(x=>bt.has(x)).length;
  const ratio=common/Math.min(at.size,bt.size);
  return common>=2 && ratio>=0.66;
}

export function dedupeKey(lead){
  const name=canonicalEntityName(lead.companyName||'');
  const address=canonicalAddress(lead.address||'').split(' ').slice(0,10).join(' ');
  const place=String(lead.placeId||'').trim();
  return `${name}|${place||address}`;
}

function distanceM(a,b){
  const lat1=Number(a?.lat),lon1=Number(a?.lon),lat2=Number(b?.lat),lon2=Number(b?.lon);
  if(![lat1,lon1,lat2,lon2].every(Number.isFinite)) return Infinity;
  const R=6371000,rad=x=>x*Math.PI/180;
  const dLat=rad(lat2-lat1),dLon=rad(lon2-lon1);
  const h=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

export function isProbableDuplicate(lead,other){
  if(!lead||!other||lead.id===other.id) return false;
  if(lead.placeId&&other.placeId&&lead.placeId===other.placeId) return true;
  const sameName=sameEntity(lead,other);
  if(!sameName) return false;
  const a1=canonicalAddress(lead.address||''),a2=canonicalAddress(other.address||'');
  if(a1&&a2){
    const s1=new Set(a1.split(' ').filter(x=>x.length>=3));
    const s2=new Set(a2.split(' ').filter(x=>x.length>=3));
    const common=[...s1].filter(x=>s2.has(x)).length;
    const exactName=canonicalEntityName(lead.companyName||'')===canonicalEntityName(other.companyName||'');
    if(common>=2||(exactName&&common>=1)||a1.includes(a2)||a2.includes(a1)) return true;
  }
  if(distanceM(lead,other)<=300) return true;
  const d1=domainOf(lead.website||''),d2=domainOf(other.website||'');
  if(d1&&d2&&d1===d2&&canonicalEntityName(lead.companyName||'')===canonicalEntityName(other.companyName||'')) return true;
  return false;
}

export function extractContacts(text=''){
  const emails=[...new Set(String(text).match(MAIL)||[])]
    .filter(e=>!/(example\.com|wixpress|sentry|cloudflare)/i.test(e))
    .slice(0,8);
  const phones=[...new Set((String(text).match(PHONE)||[]).map(x=>x.replace(/\s+/g,' ').trim()))].slice(0,8);
  return {emails,phones};
}

export function sourceMatchesEntity(result,companyName,website=''){
  const resultDomain=domainOf(result?.url||'');
  const companyDomain=domainOf(website||'');
  if(companyDomain&&resultDomain&&companyDomain===resultDomain) return true;
  const hay=`${result?.title||''} ${result?.description||''}`.toLowerCase();
  const tokens=entityTokens(companyName);
  if(!tokens.length) return false;
  const hits=tokens.filter(t=>hay.includes(t)).length;
  return hits>=Math.min(2,tokens.length);
}

function num(s){return Number(String(s||'').replace(/,/g,''))}

export function extractFacilitySignals(text=''){
  const t=String(text).toLowerCase();
  const areas=[]; let m;
  const re=/(\d{1,3}(?:[ ,]\d{3})+|\d{4,6})\s*(?:m2|m²|sqm|square metres?|square meters?)/ig;
  while((m=re.exec(text))) areas.push(num(m[1]));
  const units=[];
  const ur=/(\d{2,4})\s*(?:apartments?|units?|flats?)/ig;
  while((m=ur.exec(text))) units.push(num(m[1]));
  return {
    areaM2:areas.length?Math.max(...areas):null,
    unitCount:units.length?Math.max(...units):null,
    coldStorage:/cold storage|cold chain|refrigerat|freezer|chiller/.test(t),
    manufacturing:/manufactur|factory|production plant|processing plant|fabricat|assembly plant|industrial plant/.test(t),
    warehouse:/warehouse|distribution cent(?:re|er)|logistics hub|fulfilment|fulfillment/.test(t),
    shopping:/shopping cent(?:re|er)|shopping mall|retail centre|retail center|mall/.test(t),
    retail:/supermarket|retail store|retailer|shopping centre|shopping center|retail centre|retail center/.test(t),
    office:/office park|office complex|business park|commercial office|office building/.test(t),
    commercial:/commercial building|commercial property|business park|office building|retail property/.test(t),
    estate:/residential estate|security estate|lifestyle estate|gated estate|sectional title|housing estate|homeowners association|hoa/.test(t),
    apartment:/apartment complex|apartment building|apartments|flats|residential development|residential complex/.test(t),
    longHours:/24\s*\/\s*7|24 hours|three shifts|3 shifts|round-the-clock|round the clock/.test(t),
    largeScale:/large|major|industrial|plant|campus|distribution centre|distribution center|national distribution|high capacity|production facility/.test(t)
  };
}

export function classifyLead(agent,text='',placeTypes=[]){
  const s=extractFacilitySignals(text+' '+placeTypes.join(' '));
  if(agent==='Vision'){
    if(s.manufacturing) return {facilityType:'MANUFACTURING',signals:s};
    if(s.warehouse||s.coldStorage) return {facilityType:'WAREHOUSE',signals:s};
    return {facilityType:'UNKNOWN',signals:s};
  }
  if(agent==='Peter'){
    if(s.shopping) return {facilityType:'SHOPPING_CENTRE',signals:s};
    if(s.office) return {facilityType:'OFFICE_PARK',signals:s};
    if(s.retail) return {facilityType:'RETAIL',signals:s};
    if(s.commercial) return {facilityType:'COMMERCIAL',signals:s};
    return {facilityType:'UNKNOWN',signals:s};
  }
  if(agent==='MJ'){
    if(s.apartment) return {facilityType:'APARTMENT_COMPLEX',signals:s};
    if(s.estate) return {facilityType:'ESTATE',signals:s};
    return {facilityType:'UNKNOWN',signals:s};
  }
  return {facilityType:'UNKNOWN',signals:s};
}

export function estimateUsage(agent,facilityType,signals={}){
  if(agent==='MJ'){
    return {min:null,max:null,confidence:signals.unitCount?'HIGH':(signals.estate?'MEDIUM':'LOW'),method:'Unit-count/property-type qualification; kWh band not required.'};
  }
  const area=signals.areaM2;
  let intensity;
  if(agent==='Vision'){
    intensity=facilityType==='WAREHOUSE'?(signals.coldStorage?[18,35]:[6,14]):[12,28];
    if(area){
      return {min:Math.round(area*intensity[0]),max:Math.round(area*intensity[1]),confidence:'HIGH',method:`Publicly evidenced area ${area.toLocaleString()} m² × ${intensity[0]}–${intensity[1]} kWh/m²/month heuristic.`};
    }
    let min=signals.coldStorage?150000:signals.manufacturing?120000:signals.warehouse?70000:0;
    let max=signals.coldStorage?500000:signals.manufacturing?400000:signals.warehouse?180000:0;
    if(signals.longHours){min=Math.round(min*1.2);max=Math.round(max*1.25)}
    const confidence=(signals.coldStorage||signals.manufacturing)&&(signals.longHours||signals.largeScale)?'MEDIUM':'LOW';
    return {min,max,confidence,method:'Facility-type heuristic; requires supporting scale or operating evidence.'};
  }
  intensity=facilityType==='SHOPPING_CENTRE'?[7,14]:facilityType==='OFFICE_PARK'?[4,9]:facilityType==='RETAIL'?[5,12]:[4,12];
  if(area){
    return {min:Math.round(area*intensity[0]),max:Math.round(area*intensity[1]),confidence:'HIGH',method:`Publicly evidenced area ${area.toLocaleString()} m² × ${intensity[0]}–${intensity[1]} kWh/m²/month heuristic.`};
  }
  const bands=facilityType==='SHOPPING_CENTRE'?[18000,90000]:facilityType==='OFFICE_PARK'?[8000,65000]:facilityType==='RETAIL'?[5000,45000]:facilityType==='COMMERCIAL'?[5000,70000]:[0,0];
  const confidence=(signals.largeScale||signals.shopping||signals.office||signals.retail)?'MEDIUM':'LOW';
  return {min:bands[0],max:bands[1],confidence,method:'Facility-type heuristic based on verified facility category; area evidence preferred.'};
}
