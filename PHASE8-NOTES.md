# Aura OS v0.8.0 — Production Hardening

Phase 8 turns the completed Phase 1–7 system into a supervised Windows runtime.

## Production behavior

1. `start-aura.ps1` ensures Tony is running before/alongside Aura. Tony is launched externally through his existing `start-tony.ps1`; Tony's files are not edited.
2. A single-instance watchdog checks Aura and Tony, restarts crashed processes, validates Aura state and creates rotating state backups.
3. Windows logon autostart is available through `install-ziya-autostart.ps1`.
4. Aura state corruption recovery preserves the corrupt copy before restoring the latest verified backup.
5. Interrupted outbound `SENDING` reservations become `DELIVERY_UNKNOWN` instead of being blindly resent. They remain blocked until manually verified with `resolve-outbound-recovery.ps1`.
6. Phase 6.2 conversational LLM dormancy is unchanged.

## Tony boundary

The owner has explicitly authorized the production launcher/watchdog to START or RESTART Tony. This is infrastructure lifecycle management only. Aura's internal agent-governance layer remains unable to edit Tony's rules, code, configuration, credentials, calculations or workflow.
