export const BATCH_SIZE = 10;
export const RESEARCHERS = ['Vision','Peter','MJ'];

export const COMMON_EXCLUDED_DOMAINS = [
  'linkedin.com','facebook.com','instagram.com','x.com','twitter.com','youtube.com','tiktok.com',
  'indeed.com','za.indeed.com','pnet.co.za','careers24.com','glassdoor.com','joblife.co.za','adzuna.co.za',
  'tripadvisor.com','tripadvisor.co.za','wikipedia.org','yelp.com','foursquare.com',
  'property24.com','privateproperty.co.za','gumtree.co.za','mapquest.com',
  'aeroleads.com','simplyhired.com','rocketreach.co','apollo.io',
  'zoominfo.com','lusha.com','signalhire.com','contactout.com',
  'yellowpages.co.za','brabys.com','snupit.co.za','cylex.net.za'
];

export const RESEARCH_PROFILES = {
  Vision: {
    sectors: [
      'food manufacturer','packaging manufacturer','plastics manufacturer','steel manufacturer',
      'chemical manufacturer','automotive components manufacturer','industrial manufacturing plant',
      'cold storage facility','large distribution centre warehouse'
    ],
    allowedTypes: ['FACTORY','MANUFACTURING','WAREHOUSE'],
    kwhMin: 100000,
    kwhMax: null,
    description: 'Operating factories, manufacturing plants and large warehouses with evidence-supported estimated usage of at least 100,000 kWh/month.'
  },
  Peter: {
    sectors: [
      'shopping centre','retail centre','supermarket','office park','commercial office building','business park'
    ],
    allowedTypes: ['RETAIL','SHOPPING_CENTRE','OFFICE_PARK','COMMERCIAL'],
    kwhMin: 3500,
    kwhMax: 99999,
    description: 'Operating retail and commercial facilities with evidence-supported estimated usage between 3,500 and 99,999 kWh/month.'
  },
  MJ: {
    sectors: [
      'residential estate','sectional title estate','apartment complex','apartment building','residential development apartments'
    ],
    allowedTypes: ['ESTATE','APARTMENT_COMPLEX'],
    kwhMin: null,
    kwhMax: null,
    apartmentMinUnits: 70,
    description: 'Residential estates and apartment complexes; apartment complexes require at least 70 verified or strongly evidenced units.'
  }
};

// Gauteng is the master territory. Agents rotate through deliberately smaller nodes
// instead of repeatedly searching overlapping Johannesburg/Pretoria/Midrand queries.
export const GAUTENG_TERRITORY_NODES = [
  'Sandton Gauteng South Africa','Randburg Gauteng South Africa','Roodepoort Gauteng South Africa',
  'Johannesburg South Gauteng South Africa','Johannesburg East Gauteng South Africa','City Deep Johannesburg Gauteng South Africa',
  'Midrand Gauteng South Africa','Waterfall Midrand Gauteng South Africa','Kyalami Midrand Gauteng South Africa',
  'Germiston Gauteng South Africa','Wadeville Germiston Gauteng South Africa','Alrode Alberton Gauteng South Africa',
  'Boksburg Gauteng South Africa','Jet Park Boksburg Gauteng South Africa','Benoni Gauteng South Africa',
  'Kempton Park Gauteng South Africa','Isando Gauteng South Africa','Spartan Kempton Park Gauteng South Africa',
  'Edenvale Gauteng South Africa','Longmeadow Gauteng South Africa','Springs Gauteng South Africa',
  'Brakpan Gauteng South Africa','Nigel Gauteng South Africa','Centurion Gauteng South Africa',
  'Pretoria East Gauteng South Africa','Pretoria North Gauteng South Africa','Silverton Pretoria Gauteng South Africa',
  'Waltloo Pretoria Gauteng South Africa','Rosslyn Pretoria Gauteng South Africa','Akasia Pretoria Gauteng South Africa',
  'Krugersdorp Gauteng South Africa','Randfontein Gauteng South Africa','Meyerton Gauteng South Africa',
  'Vereeniging Gauteng South Africa','Vanderbijlpark Gauteng South Africa'
];

export const DEFAULT_REGIONS = GAUTENG_TERRITORY_NODES;

