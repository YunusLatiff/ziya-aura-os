# Aura OS v0.5.0 — Phase 5

Phase 5 adds autonomous Aura health monitoring and Steve operational reporting.

## Aura monitoring
- Detects agent ERROR states and stale WORKING heartbeats.
- Detects stalled research batches.
- Detects Tavily budget pause conditions.
- Detects recent outbound failures and messages stuck in SENDING.
- Detects SMTP/send-cycle contradictions.
- Detects high Friday rework/rejection ratios.
- Creates deduplicated incidents and automatically resolves incidents when the condition disappears.
- Tony is excluded from intervention and remains protected/external.

## Steve
- Compiles pipeline, incident and recommendation reports.
- Stores reports locally in aura.json.
- Can email the latest report using Aura's Phase 4 SMTP configuration when STEVE_EMAIL_ENABLED=true.
- Generates one scheduled report per local day after STEVE_AUTO_REPORT_HOUR.

## Default safety
STEVE_EMAIL_ENABLED is false unless explicitly enabled through configure-monitoring.ps1.
