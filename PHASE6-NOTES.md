# Aura OS v0.6.0 — Phase 6

Phase 6 adds a local Aura text + voice command interface to the existing dashboard.

## Capabilities
- Type commands directly to Aura.
- Voice recognition via the browser Web Speech API when supported.
- Spoken Aura replies via browser speech synthesis.
- Permission-gated commands for agent pause/resume and workflow controls.
- Lead-cycle, outreach, outbound, health-scan and Steve-report commands.
- Status, incident and approved-lead/draft queries.
- Persistent Aura command history in `aura.json`.
- Tony remains protected: status queries are allowed; commands/modification remain blocked.

## Important
Voice recognition availability depends on the browser/OS. Text commands always work. No external AI API is required for Phase 6.
