# Aura OS v0.7.0 — Phase 7: Tony Observatory

Phase 7 adds protected, read-only observability for the standalone Tony assessment agent.

Aura may observe:
- whether a Tony runtime process is present;
- Tony's local workflow state from `data/state.json`;
- counts of completed, needs-review and failed jobs;
- active/latest assessment status;
- Tony runtime log tail and last activity time;
- pending/failed diagnostic file counts;
- completed assessment PDF counts and the latest completed proposal.

Aura may NOT:
- start, stop, pause, resume or restart Tony;
- write to Tony's project folder;
- alter Tony's source code, state, configuration or workflow;
- read Tony's `.env`, mailbox password, Pushover credentials or other secrets;
- send commands to Tony through Aura OS;
- weaken Tony's protected/external status.

The observer writes only to Aura's own `data/aura.json` cache and audit log.

## Configuration

Run from the active Aura folder:

```powershell
.\configure-tony-observer.ps1
```

The script edits Aura's `.env` only. It does not modify Tony.

Default settings for this installation:

```text
TONY_MONITOR_ENABLED=true
TONY_MONITOR_ROOT=C:\Users\yunus\OneDrive\Ziya Energy\Design Software\Agents\Tony-Ziya-Assessment-Agent-v0.4-Direct-Mail
TONY_COMPLETED_ROOT=C:\Users\yunus\OneDrive\Ziya Energy\Automated Assessment
TONY_MONITOR_INTERVAL_SECONDS=20
```

The monitor also auto-detects a nested Tony project folder if the ZIP was extracted with an extra directory level.
