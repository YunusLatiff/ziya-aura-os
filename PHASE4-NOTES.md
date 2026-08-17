# Aura OS v0.4.0 — Phase 4 Controlled Outbound

Phase 4 adds SMTP sending without modifying Tony.

Hard gates:
- Friday-approved lead only.
- Pepper draft must have status APPROVED from Ultron.
- Valid recipient email required.
- Do-not-contact entries are excluded.
- A lead/email already SENT or SENDING is never queued again.
- OUTBOUND_ENABLED must explicitly be true.
- Daily send cap and minimum spacing are enforced.
- A message is persisted as SENDING before SMTP transmission. A crash during SENDING does not auto-resend it.
- Sent and failed messages are retained in a permanent outbound ledger.

The configure-outbound.ps1 script defaults OUTBOUND_ENABLED=false. Run a controlled test, then explicitly enable it.
