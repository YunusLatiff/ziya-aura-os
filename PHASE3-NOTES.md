# Aura OS v0.3.0 — Phase 3

## Pepper
- Consumes only leads from batches where Friday has achieved the complete approved batch and `readyForPepper=true`.
- Creates one grounded B2B cold-outreach draft per approved lead.
- Uses only facts already present in the Friday-approved lead record.
- Does not invent savings percentages, ROI, system sizes, electricity usage or operational facts.

## Ultron
- Reviews every Pepper draft before it can be marked approved.
- Checks tone, length, grounding, unsupported quantified claims, spam language, CTA quality, company personalization and recipient-name integrity.
- If a draft fails, returns rectification instructions to Pepper.
- Pepper revises, then Ultron re-reviews.
- Second failure becomes `ULTRON_REJECTED` for Aura/human review.

## Safety / control
- `APPROVED` means approved by Ultron for future Phase 4 sending.
- v0.3.0 contains no SMTP/Gmail send action and cannot send these drafts.
- Tony remains external/read-only and untouched.
