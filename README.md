# Aura OS v0.2.2 — Phase 2 / Tavily + Geoapify

Aura OS is Ziya Energy's standalone multi-agent lead-generation operating system.

## Tony protection — non-negotiable
Tony remains separate and protected. Aura OS must never modify, patch, move, rename, configure, overwrite or command Tony. Tony may only be represented as external/read-only telemetry.

## Phase 2 agents
- Vision — industrial lead generation
- Peter — retail/commercial lead generation
- MJ — estates/apartment lead generation
- Friday — deterministic lead quality control and 10-lead batch approval

## Research providers
### Tavily Search API — primary
Configure `TAVILY_API_KEY`. Aura OS calls Tavily Search directly over HTTPS and uses `search_depth=basic` to minimise credit consumption.

### Geoapify — optional/recommended
Configure `GEOAPIFY_API_KEY`. Aura uses Geoapify's geocoding/place IDs for business and address validation and, where available, Place Details for website, phone, email and building information. Contact data is only used when Geoapify/OpenStreetMap actually provides it; Aura does not invent missing contact information.

Automated LinkedIn crawling/login remains disabled.

## Windows setup
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\setup-aura.ps1
.\configure-aura.ps1
.\start-aura.ps1
```

Dashboard: `http://localhost:4310`

## Lead-cycle rule
Each Vision/Peter/MJ batch must reach 10 Friday-approved leads. Rejected/rework leads must be replaced before the batch advances. Approved batches are queued as Ready for Pepper; Pepper is not activated in Phase 2.
