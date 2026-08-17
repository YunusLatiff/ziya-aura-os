# Aura OS v0.2.5 — Gauteng Territory + Global Registry + Search Budget

- Gauteng is now the master research territory, divided into 35 rotating nodes across Johannesburg, Ekurhuleni, Tshwane, West Rand and Sedibeng.
- Geoapify is the first-pass discovery provider. Tavily is used only as fallback/enrichment.
- Tavily `/usage` is checked and cached. Default automatic pause threshold is 90% usage or 25 remaining credits.
- Tavily HTTP 432 is treated as budget exhaustion and no longer crashes all researchers.
- Permanent `leadRegistry` is automatically migrated from all historical leads at startup.
- Duplicate checks happen before expensive enrichment and again before save.
- Friday retains a hard duplicate gate across every historical batch and every researcher.
- Duplicates are logged as `DUPLICATE_IGNORED` with original lead/batch references when available.
- Dashboard shows Tavily credit usage, registry size and duplicate counts.
- Tony remains external/read-only and is not modified.

Optional `.env` controls:

```
TAVILY_USAGE_STOP_PERCENT=90
TAVILY_CREDIT_RESERVE=25
```
