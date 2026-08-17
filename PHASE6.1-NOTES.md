# Aura OS v0.6.1 — Conversational Aura + Agent Governance

## Conversational voice
- Always-listening browser speech recognition while the Aura dashboard is open.
- Wake word defaults to `Aura`.
- After wake-up, a configurable conversation window keeps follow-up dialogue open without repeating the wake word.
- Aura replies through speech synthesis; normal conversational replies are no longer rendered as chat text.
- Speech recognition is paused while Aura speaks to reduce self-trigger feedback.
- Background utterances outside an active session are ignored unless the wake word is heard.
- During an open conversation, the local conversational model classifies whether a follow-up is actually addressed to Aura.
- Local Ollama is used for natural-language interpretation and conversational continuity. Default model: `qwen3:8b`.

## Agent governance
Aura may change runtime policies for Aura, Steve, Friday, Ultron, Vision, Peter, MJ and Pepper.
Examples include:
- Vision minimum kWh, sectors, batch size, required contact/address, candidate count.
- Peter kWh band and research rules.
- MJ minimum apartment-unit requirement and research rules.
- Friday approval/rework thresholds and scoring penalties.
- Pepper individual-approved-lead drafting and tone policy.
- Ultron QA word limits, score threshold, exclamation limit and strictness.

Every policy change is persisted, versioned in `agentPolicyHistory`, audited and reversible.

## Immutable guardrails
Aura cannot modify Tony, Tony's authority/protection state, the hierarchy authority fields, credentials, source code or filesystem/security boundaries through the runtime policy layer.
High-risk policy relaxations require conversational confirmation.

## Browser note
Browsers may require one initial microphone permission grant. After permission is granted, Aura restarts continuous listening automatically while the dashboard remains open.
