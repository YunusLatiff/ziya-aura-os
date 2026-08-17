# Aura OS v0.8.0 — Production Supervisor

Phase 8 hardens the existing Aura OS installation without changing Tony.

## What changes

- Starting `start-aura.ps1` now also starts Tony externally if Tony is offline.
- Duplicate Aura/Tony starts are blocked.
- A watchdog checks Aura and Tony and restarts either process after a crash.
- The watchdog validates `data/aura.json`, keeps verified rotating backups, and can recover from a corrupt state file.
- Windows Scheduled Task support starts the watchdog at user logon, including on battery power.
- Interrupted outbound records are changed from `SENDING` to `DELIVERY_UNKNOWN` after a restart instead of being blindly resent.
- `DELIVERY_UNKNOWN` continues to block duplicate outreach until manually reviewed.
- `resolve-outbound-recovery.ps1` releases an interrupted message only after you verify whether it was actually sent.

## Tony protection

The production supervisor may start or restart Tony because the owner explicitly enabled shared startup. It does not edit Tony's source, `.env`, rules, calculations, state or workflow. Aura's internal agent-governance boundary remains read-only for Tony.

## Recommended configuration

- watchdog interval: 30 seconds
- state backup: every 6 hours
- backups retained: 30
- automatic restore of corrupt Aura state: enabled
- Tony autostart: enabled
- conversational Aura LLM: remains controlled independently by Phase 6.2

## Commands

```powershell
.\configure-production.ps1
.\install-ziya-autostart.ps1
.\start-aura.ps1
.\status-ziya-system.ps1
.\backup-aura.ps1
.\resolve-outbound-recovery.ps1
.\stop-ziya-system.ps1
```
