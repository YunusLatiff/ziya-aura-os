import crypto from 'node:crypto';
import {load,mutate} from './store.mjs';
import {snapshot,command,logEvent} from './orchestrator.mjs';
import {setLeadCycle,tick} from './scheduler.mjs';
import {setOutreachCycle,outreachStep} from './outreach.mjs';
import {setOutboundCycle,sendOneApproved} from './outbound.mjs';
import {
  runHealthScan,
  generateSteveReport,
  emailSteveReport,
  monitoringStatus
} from './monitor.mjs';
import {
  effectivePolicy,
  setAgentPolicy,
  adjustAgentPolicy,
  resetAgentPolicy,
  rollbackPolicy,
  describePolicy,
  isHighRiskPolicyChange
} from './agent-policy.mjs';
import {
  crmExecutiveContext,
  answerCrmQuestion,
  findOpportunityByName,
  changeOpportunityStage,
  markOpportunityWon,
  markOpportunityLost,
  addTask,
  CRM_SOURCES
} from './crm.mjs';

const now = () => new Date().toISOString();

const MODIFIABLE = [
  'Aura',
  'Steve',
  'Friday',
  'Ultron',
  'Vision',
  'Peter',
  'MJ',
  'Pepper'
];

const ALL = [
  ...MODIFIABLE,
  'Tony'
];

const env = (k, d = '') =>
  String(process.env[k] ?? d).trim();

const norm = s =>
  String(s || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9@.\s_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const envBool = (k, d = false) => {
  const v = env(k, d ? 'true' : 'false').toLowerCase();

  return [
    '1',
    'true',
    'yes',
    'on',
    'enabled'
  ].includes(v);
};

export function auraLlmEnabled() {
  return envBool('AURA_LLM_ENABLED', false);
}

function remember(role, content, meta = {}) {
  mutate(db => {
    db.auraConversationHistory =
      db.auraConversationHistory || [];

    db.auraConversationHistory.push({
      id: crypto.randomUUID(),
      createdAt: now(),
      role,
      content: String(content || ''),
      ...meta
    });

    db.auraConversationHistory =
      db.auraConversationHistory.slice(-80);
  });
}

export function conversationHistory(limit = 30) {
  return (
    load().auraConversationHistory || []
  ).slice(
    -Math.max(
      1,
      Math.min(
        80,
        Number(limit) || 30
      )
    )
  );
}

function setPending(action, speech) {
  mutate(db => {
    db.meta = db.meta || {};

    db.meta.auraPendingConfirmation = {
      id: crypto.randomUUID(),
      createdAt: now(),
      action,
      speech
    };
  });
}

function takePending() {
  let p = null;

  mutate(db => {
    p =
      db.meta?.auraPendingConfirmation ||
      null;

    if (db.meta) {
      delete db.meta
        .auraPendingConfirmation;
    }
  });

  return p;
}

function peekPending() {
  return (
    load().meta
      ?.auraPendingConfirmation ||
    null
  );
}

function stateSummary() {
  const s = snapshot();
  const db = load();
  const m = monitoringStatus();

  const agents =
    Object.fromEntries(
      ALL.map(a => [
        a,
        {
          status:
            db.agents?.[a]?.status,

          currentTask:
            db.agents?.[a]
              ?.currentTask,

          lastError:
            db.agents?.[a]
              ?.lastError
        }
      ])
    );

  return {
    pipeline:
      s.pipeline || {},

    crm:
      crmExecutiveContext(),

    agents,

    health: {
      health:
        m.health,

      openIncidents:
        m.openCount
    },

    leadCycle:
      !!db.meta
        ?.leadCycleEnabled,

    outreachCycle:
      !!db.meta
        ?.outreachCycleEnabled,

    outboundCycle:
      !!db.meta
        ?.outboundCycleEnabled,

    policyOverrides:
      db.agentPolicies || {}
  };
}

function directAgentName(text) {
  const n = norm(text);

  return (
    ALL.find(a =>
      new RegExp(
        `\\b${a.toLowerCase()}\\b`
      ).test(n)
    ) || null
  );
}

function fallbackSpeech(text) {
  const n = norm(text);
  const db = load();

  const crmAnswer =
    answerCrmQuestion(text);

  if (crmAnswer) {
    return crmAnswer;
  }

  if (
    /how are we|status|whats happening|what is happening|overview/.test(
      n
    )
  ) {
    const s =
      snapshot().pipeline || {};

    const m =
      monitoringStatus();

    return (
      `We have ${s.discovered || 0} leads discovered ` +
      `and ${s.approved || 0} Friday-approved. ` +
      `System health is ${m.health || 'unknown'}.`
    );
  }

  const a =
    directAgentName(text);

  if (
    a &&
    /how|status|doing|wrong|problem/.test(
      n
    )
  ) {
    const x =
      db.agents?.[a];

    return a === 'Tony'
      ? `Tony is external and protected. His recorded status is ${x?.status || 'unknown'}.`
      : `${a} is ${x?.status || 'unknown'}. ${x?.currentTask || 'No current task.'}`;
  }

  return (
    'I heard you, but I could not complete the conversational response.'
  );
}

async function ollamaInterpret(text) {
  if (!auraLlmEnabled()) {
    return {
      addressedToAura: false,
      speech: '',
      action: {
        type: 'NO_ACTION'
      },
      requiresConfirmation: false,
      llmDisabled: true
    };
  }

  const url = env(
    'AURA_OLLAMA_URL',
    'http://127.0.0.1:11434'
  );

  /*
   * Lightweight conversational model for
   * the current laptop.
   */
  const model = env(
    'AURA_OLLAMA_MODEL',
    'qwen2.5:1.5b'
  );

  const history =
    conversationHistory(12).map(
      x => ({
        role:
          x.role === 'aura'
            ? 'assistant'
            : 'user',

        content:
          x.content
      })
    );

  const system = `
You are Aura, the local supreme supervisor for Ziya Energy's multi-agent operating system.

Your conversational manner is calm, quick, natural, highly competent, subtly warm, concise and anticipatory.

Use South African English.

Do not sound like a command-line interface or chatbot.

Mild dry wit is acceptable when natural.

Never claim an action happened unless the tool result confirms it.

You supervise:
- Steve
- Friday
- Ultron
- Vision
- Peter
- MJ
- Pepper

You also have controlled read and action access to the Ziya CRM Core, which is the company's factual memory.

Always use the CRM state supplied below for company, lead, opportunity, pipeline and source questions.

Do not guess CRM facts.

Tony is ABSOLUTELY PROTECTED.

You may discuss Tony's status, but you must never:
- modify Tony
- command Tony
- pause Tony
- resume Tony
- reconfigure Tony
- overwrite Tony
- integrate into Tony
- weaken Tony's protection

You may alter runtime policies for every agent except Tony.

Policy changes are:
- versioned
- audited
- reversible

You may:
- strengthen or weaken Friday scoring
- change Vision thresholds
- change Peter thresholds
- change MJ thresholds
- change Vision/Peter/MJ sectors
- change batch sizes
- change contact requirements
- change Pepper drafting policy
- change Ultron QA thresholds

You may NOT change:
- authority hierarchy
- Tony protection
- credentials
- source code
- filesystem permissions
- security boundaries

Classify whether the utterance is actually directed to Aura.

In an open conversation session, unrelated background conversation should have addressedToAura=false.

If the user is continuing the immediately preceding Aura discussion, set addressedToAura=true even if the wake word is omitted.

Return ONLY valid JSON with this exact general shape:

{
  "addressedToAura": true,
  "speech": "natural spoken response",
  "action": {
    "type": "NO_ACTION",
    "target": null,
    "path": null,
    "value": null,
    "delta": null,
    "historyId": null
  },
  "requiresConfirmation": false
}

Allowed action.type values:

NO_ACTION
PAUSE_AGENT
RESUME_AGENT
START_LEAD_CYCLE
STOP_LEAD_CYCLE
RUN_LEAD_CYCLE_ONCE
START_OUTREACH
STOP_OUTREACH
RUN_OUTREACH_ONCE
START_OUTBOUND
STOP_OUTBOUND
SEND_ONE_APPROVED
RUN_HEALTH_SCAN
GENERATE_STEVE_REPORT
EMAIL_STEVE_REPORT
POLICY_SET
POLICY_ADJUST
POLICY_RESET
POLICY_ROLLBACK
CRM_STAGE_CHANGE
CRM_MARK_WON
CRM_MARK_LOST
CRM_ADD_TASK

For CRM actions:

action.target should contain the company or opportunity name.

CRM_STAGE_CHANGE:
action.value contains the stage.

CRM_MARK_WON:
action.value contains the source attribution.

CRM_MARK_LOST:
action.value contains the loss reason.

CRM_ADD_TASK:
action.value must be an object containing:
- title
- assignedTo
- optional dueAt
- optional priority

Marking WON or LOST always requires confirmation.

A WON deal also requires source attribution from:

${CRM_SOURCES.join(', ')}

Policy examples:

"make Friday stricter"

= POLICY_ADJUST
target Friday
path scoring.approveMinScore
delta +5

"lower Vision minimum to 90000"

= POLICY_SET
target Vision
path research.kwhMin
value 90000

"MJ should require 100 apartments"

= POLICY_SET
target MJ
path research.apartmentMinUnits
value 100

"let Pepper work on approved leads immediately"

= POLICY_SET
target Pepper
path draft.allowIndividualApprovedLeads
value true

"make Ultron stricter"

= POLICY_ADJUST
target Ultron
path qa.minScore
delta +5

"add food processing plant as a Vision search sector"

Do not attempt an unsafe partial array edit.

POLICY_SET may provide the full desired array only if confidently known.

Otherwise explain briefly and ask a short follow-up.

Starting outbound sending, disabling contact requirements, large threshold relaxations, or materially weakening QA should require confirmation.

Current system state:

${JSON.stringify(stateSummary())}
`;

  try {
    /*
     * Default is now 120 seconds instead
     * of the previous 30-second timeout.
     *
     * This can also be overridden in .env:
     *
     * AURA_OLLAMA_TIMEOUT_MS=120000
     */
    const timeoutMs =
      Math.max(
        30000,
        Number(
          env(
            'AURA_OLLAMA_TIMEOUT_MS',
            '120000'
          )
        ) || 120000
      );

    const r =
      await fetch(
        `${url.replace(/\/$/, '')}/api/chat`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json'
          },

          body:
            JSON.stringify({
              model,

              stream: false,

              /*
               * Force structured JSON
               * because Aura needs to
               * extract intent/actions
               * reliably.
               */
              format: 'json',

              messages: [
                {
                  role: 'system',
                  content: system
                },

                ...history,

                {
                  role: 'user',
                  content: text
                }
              ],

              /*
               * Tuned for lower resource
               * usage on the current PC.
               */
              options: {
                temperature: 0.2,
                num_ctx: 2048,
                num_predict: 120
              }
            }),

          signal:
            AbortSignal.timeout(
              timeoutMs
            )
        }
      );

    if (!r.ok) {
      const detail =
        await r
          .text()
          .catch(() => '');

      throw new Error(
        `Ollama HTTP ${r.status}` +
        (
          detail
            ? `: ${detail}`
            : ''
        )
      );
    }

    const j =
      await r.json();

    const raw =
      String(
        j?.message?.content ||
        ''
      ).trim();

    if (!raw) {
      throw new Error(
        'Ollama returned an empty response.'
      );
    }

    /*
     * Some models may still wrap JSON
     * inside markdown fences.
     */
    const cleaned =
      raw
        .replace(
          /^```json\s*/i,
          ''
        )
        .replace(
          /^```\s*/i,
          ''
        )
        .replace(
          /\s*```$/i,
          ''
        )
        .trim();

    let parsed;

    try {
      parsed =
        JSON.parse(cleaned);
    }
    catch (parseError) {
      throw new Error(
        'Aura could not parse Ollama JSON. ' +
        `Raw response: ${cleaned.slice(0, 500)}`
      );
    }

    /*
     * Normalise output so the rest of
     * Aura receives a predictable object.
     */
    return {
      addressedToAura:
        parsed.addressedToAura !== false,

      speech:
        String(
          parsed.speech ||
          ''
        ).trim(),

      action:
        parsed.action &&
        typeof parsed.action ===
          'object'
          ? parsed.action
          : {
              type:
                'NO_ACTION',

              target:
                null,

              path:
                null,

              value:
                null,

              delta:
                null,

              historyId:
                null
            },

      requiresConfirmation:
        Boolean(
          parsed.requiresConfirmation
        )
    };
  }
  catch (e) {
    /*
     * Very important:
     *
     * Do NOT pretend the model is offline
     * for every failure.
     *
     * The real error is printed to the
     * Aura PowerShell console.
     */
    console.error(
      '[AURA OLLAMA ERROR]',
      e?.stack || e
    );

    return {
      addressedToAura:
        true,

      speech:
        'My conversational model took too long to respond or returned an invalid response. Give me a moment and try that again.',

      action: {
        type:
          'NO_ACTION',

        target:
          null,

        path:
          null,

        value:
          null,

        delta:
          null,

        historyId:
          null
      },

      requiresConfirmation:
        false,

      llmError:
        String(
          e?.message ||
          e
        )
    };
  }
}

async function executeAction(
  action = {}
) {
  const type =
    String(
      action.type ||
      'NO_ACTION'
    );

  const target =
    action.target;

  if (
    target === 'Tony' &&
    type !== 'NO_ACTION'
  ) {
    return {
      ok: false,

      speech:
        'Tony is protected. I can report on him, but I will not modify or command him.'
    };
  }

  switch (type) {
    case 'NO_ACTION':
      return {
        ok: true
      };

    case 'PAUSE_AGENT': {
      const r =
        command(
          'Aura',
          target,
          'PAUSE',
          {}
        );

      return {
        ok:
          r.allowed,

        speech:
          r.allowed
            ? `${target} is paused.`
            : `I couldn't pause ${target}: ${r.reason}`
      };
    }

    case 'RESUME_AGENT': {
      const r =
        command(
          'Aura',
          target,
          'RESUME',
          {}
        );

      return {
        ok:
          r.allowed,

        speech:
          r.allowed
            ? `${target} is running again.`
            : `I couldn't resume ${target}: ${r.reason}`
      };
    }

    case 'START_LEAD_CYCLE':
      setLeadCycle(true);

      return {
        ok: true,
        speech:
          'Lead research is running.'
      };

    case 'STOP_LEAD_CYCLE':
      setLeadCycle(false);

      return {
        ok: true,
        speech:
          'Lead research is stopped.'
      };

    case 'RUN_LEAD_CYCLE_ONCE':
      await tick();

      return {
        ok: true,
        speech:
          'I ran one lead-research pass.'
      };

    case 'START_OUTREACH':
      setOutreachCycle(true);

      return {
        ok: true,
        speech:
          'Pepper and Ultron are running.'
      };

    case 'STOP_OUTREACH':
      setOutreachCycle(false);

      return {
        ok: true,
        speech:
          'Pepper and Ultron are paused.'
      };

    case 'RUN_OUTREACH_ONCE': {
      const r =
        await outreachStep();

      const processed =
        r?.processed ??
        r?.created ??
        0;

      return {
        ok: true,

        speech:
          `Outreach pass complete. ` +
          `${processed} item` +
          `${processed === 1 ? '' : 's'} processed.`
      };
    }

    case 'START_OUTBOUND': {
      const r =
        setOutboundCycle(true);

      return {
        ok: true,
        speech:
          'Controlled outbound sending is running.',
        data: r
      };
    }

    case 'STOP_OUTBOUND':
      setOutboundCycle(false);

      return {
        ok: true,
        speech:
          'Outbound sending is stopped.'
      };

    case 'SEND_ONE_APPROVED': {
      const r =
        await sendOneApproved();

      return r?.blocked
        ? {
            ok: false,

            speech:
              `I can't send one yet. ${r.blocked}.`
          }
        : {
            ok: true,

            speech:
              `One approved email has been sent` +
              (
                r?.companyName
                  ? ` for ${r.companyName}`
                  : ''
              ) +
              '.'
          };
    }

    case 'RUN_HEALTH_SCAN': {
      const r =
        await runHealthScan();

      return {
        ok: true,

        speech:
          `Health scan complete. We're ` +
          `${String(
            r.health ||
            'unknown'
          ).toLowerCase()}.`
      };
    }

    case 'GENERATE_STEVE_REPORT': {
      const r =
        await generateSteveReport();

      return {
        ok: true,

        speech:
          `Steve's report is ready. ` +
          `System health is ` +
          `${String(
            r.health ||
            'unknown'
          ).toLowerCase()}.`
      };
    }

    case 'EMAIL_STEVE_REPORT': {
      const r =
        await emailSteveReport(
          null
        );

      return {
        ok: true,

        speech:
          `Steve's latest report has been emailed` +
          (
            r.to
              ? ` to ${r.to}`
              : ''
          ) +
          '.'
      };
    }

    case 'POLICY_SET': {
      if (
        !MODIFIABLE.includes(
          target
        )
      ) {
        return {
          ok: false,

          speech:
            `I can't modify ` +
            `${target || 'that agent'}.`
        };
      }

      const before =
        action.path
          ?.split('.')
          .reduce(
            (o, k) =>
              o?.[k],
            effectivePolicy(
              target
            )
          );

      const high =
        isHighRiskPolicyChange(
          target,
          action.path,
          before,
          action.value
        );

      if (
        high &&
        !action.confirmed
      ) {
        return {
          ok: false,

          needsConfirmation:
            true,

          pending: {
            ...action,
            confirmed: true
          },

          speech:
            `That would materially relax ${target}'s controls. Confirm and I'll apply it.`
        };
      }

      const r =
        setAgentPolicy(
          'Aura',
          target,
          action.path,
          action.value,
          'Voice/conversational policy change'
        );

      return {
        ok: true,

        speech:
          `Done. I've updated ${target}'s ` +
          `${action.path.replaceAll('.', ' ')}.`,

        data: r
      };
    }

    case 'POLICY_ADJUST': {
      if (
        !MODIFIABLE.includes(
          target
        )
      ) {
        return {
          ok: false,

          speech:
            `I can't modify ` +
            `${target || 'that agent'}.`
        };
      }

      const before =
        action.path
          ?.split('.')
          .reduce(
            (o, k) =>
              o?.[k],
            effectivePolicy(
              target
            )
          );

      const after =
        Number(before) +
        Number(action.delta);

      const high =
        isHighRiskPolicyChange(
          target,
          action.path,
          before,
          after
        );

      if (
        high &&
        !action.confirmed
      ) {
        return {
          ok: false,

          needsConfirmation:
            true,

          pending: {
            ...action,
            confirmed: true
          },

          speech:
            `That weakens ${target}'s current guardrail. Confirm and I'll make the change.`
        };
      }

      const r =
        adjustAgentPolicy(
          'Aura',
          target,
          action.path,
          action.delta,
          'Voice/conversational policy adjustment'
        );

      const current =
        action.path
          .split('.')
          .reduce(
            (o, k) =>
              o?.[k],
            r.effective
          );

      return {
        ok: true,

        speech:
          `Done. ${target}'s ` +
          `${action.path.replaceAll('.', ' ')} ` +
          `is now ${current}.`,

        data: r
      };
    }

    case 'POLICY_RESET': {
      const r =
        resetAgentPolicy(
          'Aura',
          target,
          action.path ||
            null,
          'Voice/conversational policy reset'
        );

      return {
        ok: true,

        speech:
          `I've restored ${target}` +
          (
            action.path
              ? `'s ${action.path.replaceAll('.', ' ')}`
              : ''
          ) +
          ` to its default policy.`,

        data: r
      };
    }

    case 'POLICY_ROLLBACK': {
      const r =
        rollbackPolicy(
          'Aura',
          action.historyId
        );

      return {
        ok: true,
        speech:
          `I've rolled that policy change back.`,
        data: r
      };
    }

    case 'CRM_STAGE_CHANGE': {
      const opp =
        findOpportunityByName(
          action.target ||
          ''
        );

      if (!opp) {
        return {
          ok: false,

          speech:
            `I couldn't find that opportunity in the CRM.`
        };
      }

      const stage =
        String(
          action.value ||
          ''
        ).toUpperCase();

      const r =
        changeOpportunityStage(
          'Aura',
          opp.id,
          stage,
          {
            reason:
              'Owner voice/conversational instruction',

            ownerInstruction:
              true
          }
        );

      return {
        ok: true,

        speech:
          `Done. ` +
          `${opp.company?.name || opp.title} ` +
          `is now ` +
          `${stage.replaceAll('_', ' ').toLowerCase()}.`,

        data: r
      };
    }

    case 'CRM_MARK_WON': {
      const opp =
        findOpportunityByName(
          action.target ||
          ''
        );

      if (!opp) {
        return {
          ok: false,

          speech:
            `I couldn't find that opportunity in the CRM.`
        };
      }

      const source =
        String(
          action.value ||
          ''
        ).trim();

      if (
        !CRM_SOURCES.includes(
          source
        )
      ) {
        return {
          ok: false,

          speech:
            `I need you to tell me who originated the deal before I can mark it won.`
        };
      }

      if (!action.confirmed) {
        return {
          ok: false,

          needsConfirmation:
            true,

          pending: {
            ...action,
            confirmed:
              true
          },

          speech:
            `I found ` +
            `${opp.company?.name || opp.title}. ` +
            `Mark it won and attribute the origin to ${source}?`
        };
      }

      const r =
        markOpportunityWon(
          'Aura',
          opp.id,
          {
            source,
            verifiedBy:
              'Owner',

            reason:
              'Owner voice/conversational instruction'
          }
        );

      return {
        ok: true,

        speech:
          `Done. ` +
          `${opp.company?.name || opp.title} ` +
          `is marked won, with origin attributed to ${source}.`,

        data: r
      };
    }

    case 'CRM_MARK_LOST': {
      const opp =
        findOpportunityByName(
          action.target ||
          ''
        );

      if (!opp) {
        return {
          ok: false,

          speech:
            `I couldn't find that opportunity in the CRM.`
        };
      }

      const reason =
        String(
          action.value ||
          ''
        ).trim();

      if (!reason) {
        return {
          ok: false,

          speech:
            `What reason should I record for losing that opportunity?`
        };
      }

      if (!action.confirmed) {
        return {
          ok: false,

          needsConfirmation:
            true,

          pending: {
            ...action,
            confirmed:
              true
          },

          speech:
            `Mark ` +
            `${opp.company?.name || opp.title} ` +
            `as lost for: ${reason}?`
        };
      }

      const r =
        markOpportunityLost(
          'Aura',
          opp.id,
          {
            reason,
            ownerInstruction:
              true
          }
        );

      return {
        ok: true,

        speech:
          `Done. I've closed ` +
          `${opp.company?.name || opp.title} ` +
          `as lost and recorded the reason.`,

        data: r
      };
    }

    case 'CRM_ADD_TASK': {
      const opp =
        findOpportunityByName(
          action.target ||
          ''
        );

      if (!opp) {
        return {
          ok: false,

          speech:
            `I couldn't find that opportunity in the CRM.`
        };
      }

      const v =
        action.value ||
        {};

      if (
        !v.title ||
        !v.assignedTo
      ) {
        return {
          ok: false,

          speech:
            `I need both the task and who should handle it.`
        };
      }

      const r =
        addTask(
          'Aura',
          {
            opportunityId:
              opp.id,

            companyId:
              opp.companyId,

            title:
              v.title,

            assignedTo:
              v.assignedTo,

            dueAt:
              v.dueAt ||
              null,

            priority:
              v.priority ||
              'NORMAL'
          }
        );

      return {
        ok: true,

        speech:
          `Done. I've assigned ${v.title} to ${v.assignedTo}.`,

        data: r
      };
    }

    default:
      return {
        ok: false,

        speech:
          `I don't have permission to perform that action.`
      };
  }
}

export async function converseWithAura(
  text,
  {
    wakeDetected = false,
    conversationActive = false
  } = {}
) {
  const utterance =
    String(text || '').trim();

  if (!utterance) {
    return {
      ok: false,
      addressedToAura: false,
      speech: ''
    };
  }

  if (!auraLlmEnabled()) {
    return {
      ok: false,
      disabled: true,
      addressedToAura: false,
      speech: '',
      conversationActive: false,

      reason:
        'Conversational Aura is dormant. Set AURA_LLM_ENABLED=true when the upgraded hardware is ready.'
    };
  }

  const n =
    norm(utterance);

  const pending =
    peekPending();

  if (
    pending &&
    /^(yes|confirm|confirmed|do it|go ahead|proceed|please do)$/.test(
      n
    )
  ) {
    takePending();

    const result =
      await executeAction(
        pending.action
      );

    const speech =
      result.speech ||
      pending.speech ||
      'Done.';

    remember(
      'user',
      utterance,
      {
        wakeDetected
      }
    );

    remember(
      'aura',
      speech,
      {
        action:
          pending.action.type
      }
    );

    logEvent(
      'Aura',
      'INFO',
      'AURA_CONVERSATION',
      speech,
      {
        action:
          pending.action.type
      }
    );

    return {
      ok:
        result.ok !== false,

      addressedToAura:
        true,

      speech,

      action:
        pending.action.type,

      conversationActive:
        true
    };
  }

  if (
    pending &&
    /^(no|cancel|dont|do not|never mind|nevermind)$/.test(
      n
    )
  ) {
    takePending();

    remember(
      'user',
      utterance,
      {
        wakeDetected
      }
    );

    remember(
      'aura',
      'Cancelled.',
      {
        action:
          'CANCEL'
      }
    );

    return {
      ok: true,
      addressedToAura: true,
      speech: 'Cancelled.',
      action: 'CANCEL',
      conversationActive: true
    };
  }

  const interpreted =
    await ollamaInterpret(
      utterance
    );

  if (
    interpreted.addressedToAura ===
      false &&
    !wakeDetected
  ) {
    return {
      ok: true,
      addressedToAura: false,
      speech: '',
      ignored: true,
      conversationActive: false
    };
  }

  const action =
    interpreted.action ||
    {
      type:
        'NO_ACTION'
    };

  if (
    action.target === 'Tony' &&
    action.type !==
      'NO_ACTION'
  ) {
    const speech =
      'Tony is protected and external. I can tell you how he is doing, but I will not modify or command him.';

    remember(
      'user',
      utterance,
      {
        wakeDetected
      }
    );

    remember(
      'aura',
      speech,
      {
        action:
          'TONY_PROTECTED'
      }
    );

    return {
      ok: false,
      addressedToAura: true,
      speech,
      action:
        'TONY_PROTECTED',
      conversationActive:
        true
    };
  }

  let result = {
    ok: true
  };

  try {
    result =
      await executeAction(
        action
      );
  }
  catch (e) {
    result = {
      ok: false,

      speech:
        `I couldn't complete that. ` +
        `${String(
          e.message ||
          e
        )}`
    };
  }

  let speech =
    result.speech ||
    String(
      interpreted.speech ||
      fallbackSpeech(
        utterance
      )
    );

  if (
    result.needsConfirmation
  ) {
    setPending(
      result.pending,
      speech
    );
  }

  remember(
    'user',
    utterance,
    {
      wakeDetected
    }
  );

  remember(
    'aura',
    speech,
    {
      action:
        action.type,

      ok:
        result.ok !== false
    }
  );

  logEvent(
    'Aura',

    result.ok === false
      ? 'WARN'
      : 'INFO',

    'AURA_CONVERSATION',

    speech,

    {
      utterance,

      action:
        action.type,

      target:
        action.target ||
        null,

      path:
        action.path ||
        null
    }
  );

  return {
    ok:
      result.ok !== false,

    addressedToAura:
      true,

    speech,

    action:
      action.type,

    needsConfirmation:
      !!result.needsConfirmation,

    conversationActive:
      true,

    llmError:
      interpreted.llmError ||
      null
  };
}

export function auraConversationStatus() {
  const llmEnabled =
    auraLlmEnabled();

  const requestedAlwaysListen =
    envBool(
      'AURA_ALWAYS_LISTEN',
      false
    );

  return {
    enabled:
      llmEnabled,

    llmEnabled,

    dormant:
      !llmEnabled,

    wakeWord:
      env(
        'AURA_WAKE_WORD',
        'Aura'
      ),

    alwaysListen:
      llmEnabled &&
      requestedAlwaysListen,

    requestedAlwaysListen,

    voiceOnly:
      envBool(
        'AURA_VOICE_ONLY',
        true
      ),

    conversationWindowSeconds:
      Number(
        env(
          'AURA_CONVERSATION_WINDOW_SECONDS',
          '25'
        )
      ) || 25,

    ollamaUrl:
      env(
        'AURA_OLLAMA_URL',
        'http://127.0.0.1:11434'
      ),

    ollamaModel:
      env(
        'AURA_OLLAMA_MODEL',
        'qwen2.5:1.5b'
      ),

    pendingConfirmation:
      !!peekPending(),

    recent:
      conversationHistory(8)
  };
}

export {
  describePolicy
};