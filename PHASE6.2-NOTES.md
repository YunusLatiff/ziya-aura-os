# Aura OS v0.6.2 — Hardware-Safe Dormant Conversational Aura

This patch preserves the full Phase 6.1 conversational/governance implementation while disabling its resource-intensive local conversational layer by default.

## New feature flag

- `AURA_LLM_ENABLED=false` — hard-off switch for conversational Ollama inference.
- `AURA_ALWAYS_LISTEN=false` — continuous microphone recognition remains off while dormant.

When dormant, Aura OS does **not**:

- call the Ollama API;
- load or keep `qwen3:8b` warm on Aura's behalf;
- start continuous browser speech recognition;
- open conversational sessions.

All other Aura OS phases continue to operate normally. Agent governance code remains installed and is available again when Conversational Aura is re-enabled.

## Future activation

On upgraded hardware, run:

```powershell
.\enable-conversational-aura.ps1
```

Restart Aura OS. The saved Ollama model, URL, wake word and conversation-window settings are preserved.

To disable again:

```powershell
.\disable-conversational-aura.ps1
```

Tony remains protected, external and unmodified.
