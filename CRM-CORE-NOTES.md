# Aura OS v0.8.5 — Ziya CRM Core

This platform upgrade adds the CRM foundation required before Phase 9 Natasha and Phase 10 Wanda.

## Core design
- CRM is the factual company memory; Aura is the executive interface.
- Existing Vision/Peter/MJ leads are automatically migrated and continuously reconciled into CRM records.
- Friday reviews, Pepper drafts/sends and Tony Observer status are published into the CRM timeline.
- Every company has a stable CRM identity; each company may have multiple opportunities/sites in future.
- Owner-verified WON attribution is mandatory and supports Natasha, Vision, Peter, MJ, Pepper, External Channel Partner, Direct/Organic, Referral and Other.
- Tony has zero direct CRM access. Only TonyObserver may publish observed status/proposal metadata.
- Agent publication permissions are enforced by CRM actor/type rules.
- CRM activity/audit events are append-only in normal CRM APIs.
- CRM state is stored separately at data/crm.json and included in production watchdog backup/recovery.

## Dashboard theme
The CRM dashboard follows the Ziya Energy website palette and typography:
- Gold #c7a35d
- Charcoal #151619 / #111214
- Paper #fafaf7
- Grey #707277
- Mist #e6e5df
- Serif headings (Georgia) and clean sans-serif body copy

## Aura CRM intelligence
Even while the heavy conversational LLM remains dormant, the deterministic Aura command interface can answer questions such as:
- How many projects are in the pipeline?
- How is our lead database looking?
- What is the pipeline value?
- Who is performing best?
- How is Pepper performing?
- How many proposals are ready?

When the conversational model is re-enabled later, the full CRM executive context is injected into Aura's system state and CRM actions can be interpreted naturally.
