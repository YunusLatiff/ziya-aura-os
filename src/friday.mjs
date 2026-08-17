import {isProbableDuplicate} from './lead-intelligence.mjs';
import {findRegistryDuplicate} from './lead-registry.mjs';
import {effectivePolicy} from './agent-policy.mjs';

/*
 * IMMUTABLE BUSINESS MANDATES
 *
 * Aura may strengthen operating rules, but may not weaken these
 * fundamental qualification boundaries.
 *
 * Tony is completely unrelated to this module and remains protected.
 */
const HARD_MANDATES = Object.freeze({
  Vision: Object.freeze({
    allowedTypes: Object.freeze([
      'FACTORY',
      'MANUFACTURING',
      'WAREHOUSE'
    ]),
    kwhMin: 100000
  }),

  Peter: Object.freeze({
    allowedTypes: Object.freeze([
      'RETAIL',
      'SHOPPING_CENTRE',
      'OFFICE_PARK',
      'COMMERCIAL'
    ]),
    kwhMin: 3500,
    kwhMax: 99999
  }),

  MJ: Object.freeze({
    allowedTypes: Object.freeze([
      'ESTATE',
      'APARTMENT_COMPLEX'
    ]),
    apartmentMinUnits: 70
  })
});

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function effectiveResearchRules(agent) {
  const hard = HARD_MANDATES[agent];

  if (!hard) {
    return null;
  }

  const runtime =
    effectivePolicy(agent)?.research || {};

  /*
   * Runtime policy may make requirements STRICTER,
   * but never weaker than the immutable mandate.
   */

  if (agent === 'Vision') {
    return {
      ...runtime,

      allowedTypes:
        Array.isArray(runtime.allowedTypes)
          ? runtime.allowedTypes.filter(type =>
              hard.allowedTypes.includes(type)
            )
          : [...hard.allowedTypes],

      kwhMin: Math.max(
        hard.kwhMin,
        numberOr(runtime.kwhMin, hard.kwhMin)
      ),

      requireAddress:
        runtime.requireAddress !== false,

      requireContact:
        runtime.requireContact !== false,

      minUsageConfidence:
        runtime.minUsageConfidence || 'MEDIUM'
    };
  }

  if (agent === 'Peter') {
    return {
      ...runtime,

      allowedTypes:
        Array.isArray(runtime.allowedTypes)
          ? runtime.allowedTypes.filter(type =>
              hard.allowedTypes.includes(type)
            )
          : [...hard.allowedTypes],

      kwhMin: Math.max(
        hard.kwhMin,
        numberOr(runtime.kwhMin, hard.kwhMin)
      ),

      kwhMax: Math.min(
        hard.kwhMax,
        numberOr(runtime.kwhMax, hard.kwhMax)
      ),

      requireAddress:
        runtime.requireAddress !== false,

      requireContact:
        runtime.requireContact !== false,

      minUsageConfidence:
        runtime.minUsageConfidence || 'MEDIUM'
    };
  }

  if (agent === 'MJ') {
    return {
      ...runtime,

      allowedTypes:
        Array.isArray(runtime.allowedTypes)
          ? runtime.allowedTypes.filter(type =>
              hard.allowedTypes.includes(type)
            )
          : [...hard.allowedTypes],

      apartmentMinUnits: Math.max(
        hard.apartmentMinUnits,
        numberOr(
          runtime.apartmentMinUnits,
          hard.apartmentMinUnits
        )
      ),

      requireAddress:
        runtime.requireAddress !== false,

      requireContact:
        runtime.requireContact !== false,

      minUsageConfidence:
        runtime.minUsageConfidence || 'MEDIUM'
    };
  }

  return null;
}

function hardMandateViolations(lead) {
  const hard = HARD_MANDATES[lead.agent];

  if (!hard) {
    return ['Unknown researcher mandate.'];
  }

  const violations = [];

  /*
   * Facility type is always a hard boundary.
   */
  if (!hard.allowedTypes.includes(lead.facilityType)) {
    violations.push(
      `Facility type ${lead.facilityType || 'UNKNOWN'} is outside ${lead.agent}'s immutable mandate.`
    );
  }

  /*
   * Lead integrity failures are always hard rejects.
   */
  if (lead.integrityStatus === 'FAIL') {
    violations.push(
      `Lead integrity failed: ${(lead.integrityReasons || []).join('; ')}`
    );
  }

  /*
   * Vision:
   * Never permit a lower estimated usage below 100,000 kWh/month.
   */
  if (lead.agent === 'Vision') {
    if (
      !Number.isFinite(lead.estimatedKwhMin) ||
      lead.estimatedKwhMin < hard.kwhMin
    ) {
      violations.push(
        `Evidence-supported lower usage estimate is below ${hard.kwhMin.toLocaleString()} kWh/month.`
      );
    }
  }

  /*
   * Peter:
   * The full estimated range must remain inside
   * 3,500–99,999 kWh/month.
   */
  if (lead.agent === 'Peter') {
    if (
      !Number.isFinite(lead.estimatedKwhMin) ||
      !Number.isFinite(lead.estimatedKwhMax) ||
      lead.estimatedKwhMin < hard.kwhMin ||
      lead.estimatedKwhMax > hard.kwhMax
    ) {
      violations.push(
        `Estimated usage band is outside the immutable ${hard.kwhMin.toLocaleString()}–${hard.kwhMax.toLocaleString()} kWh/month mandate.`
      );
    }
  }

  /*
   * MJ:
   * Apartment complexes may never qualify below 70 units.
   */
  if (
    lead.agent === 'MJ' &&
    lead.facilityType === 'APARTMENT_COMPLEX'
  ) {
    if (
      !Number.isFinite(lead.unitCount) ||
      lead.unitCount < hard.apartmentMinUnits
    ) {
      violations.push(
        `Apartment complex does not have evidence for at least ${hard.apartmentMinUnits} apartments/units.`
      );
    }
  }

  return violations;
}

export function reviewLead(
  lead,
  allLeads = [],
  registry = []
) {
  const reasons = [];

  const research =
    effectiveResearchRules(lead.agent);

  const scoring =
    effectivePolicy('Friday')?.scoring || {};

  if (!research) {
    return {
      status: 'REJECTED',
      score: 0,
      reasons: ['Unknown researcher profile.']
    };
  }

  /*
   * GLOBAL DUPLICATE GATE
   */
  const registryDuplicate =
    findRegistryDuplicate(
      lead,
      registry,
      lead.id
    );

  const historicalDuplicate =
    allLeads.find(
      x =>
        x.id !== lead.id &&
        isProbableDuplicate(lead, x)
    );

  const duplicate =
    registryDuplicate?.entry ||
    historicalDuplicate;

  if (duplicate) {
    const firstBatch =
      duplicate.firstBatchNumber ??
      allLeads.find(
        x => x.id === duplicate.id
      )?.batchNumber ??
      '?';

    return {
      status: 'DUPLICATE_IGNORED',
      score: 0,
      reasons: [
        `Already pulled previously${
          duplicate.companyName
            ? `: ${duplicate.companyName}`
            : ''
        }${
          firstBatch !== '?'
            ? ` (batch #${firstBatch})`
            : ''
        }.`
      ],
      duplicateOf:
        duplicate.firstLeadId ||
        duplicate.id ||
        null
    };
  }

  /*
   * IMMUTABLE HARD-CONSTRAINT GATE
   *
   * This executes BEFORE Friday's adjustable scoring.
   */
  const hardViolations =
    hardMandateViolations(lead);

  if (hardViolations.length) {
    return {
      status: 'REJECTED',
      score: 0,
      reasons: hardViolations
    };
  }

  const evidence =
    Array.isArray(lead.evidence)
      ? lead.evidence.filter(
          e => e?.url || e?.detail
        )
      : [];

  /*
   * SOFT / GOVERNABLE QUALITY RULES
   */

  if (!lead.companyName) {
    reasons.push(
      'Company name missing.'
    );
  }

  if (
    research.requireAddress !== false &&
    !lead.address
  ) {
    reasons.push(
      'Physical address missing.'
    );
  }

  if (
    !lead.website &&
    !evidence.length
  ) {
    reasons.push(
      'No verifiable public source attached.'
    );
  }

  /*
   * Runtime allowed-types may be STRICTER
   * than the immutable mandate.
   */
  if (
    !research.allowedTypes?.includes(
      lead.facilityType
    )
  ) {
    reasons.push(
      `Facility type ${lead.facilityType || 'UNKNOWN'} is outside ${lead.agent}'s current operating policy.`
    );
  }

  const minimumEvidence =
    numberOr(
      scoring.minEvidence,
      1
    );

  if (
    evidence.length <
    minimumEvidence
  ) {
    reasons.push(
      `Evidence count is below Friday's minimum of ${minimumEvidence}.`
    );
  }

  const confidenceOrder = {
    LOW: 1,
    MEDIUM: 2,
    HIGH: 3
  };

  const minConfidence =
    research.minUsageConfidence ||
    'MEDIUM';

  /*
   * STRONGER RUNTIME THRESHOLDS
   */

  if (lead.agent === 'Vision') {
    if (
      lead.estimatedKwhMin <
      research.kwhMin
    ) {
      reasons.push(
        `Lead passes Vision's immutable mandate but is below the current operating minimum of ${Number(research.kwhMin).toLocaleString()} kWh/month.`
      );
    }

    if (
      (confidenceOrder[
        lead.usageConfidence
      ] || 0) <
      (confidenceOrder[
        minConfidence
      ] || 2)
    ) {
      reasons.push(
        'Usage confidence is too low; obtain stronger facility scale or operating evidence.'
      );
    }
  }

  if (lead.agent === 'Peter') {
    if (
      lead.estimatedKwhMin <
        research.kwhMin ||
      lead.estimatedKwhMax >
        research.kwhMax
    ) {
      reasons.push(
        `Lead passes Peter's immutable mandate but is outside the current operating range of ${Number(research.kwhMin).toLocaleString()}–${Number(research.kwhMax).toLocaleString()} kWh/month.`
      );
    }

    if (
      (confidenceOrder[
        lead.usageConfidence
      ] || 0) <
      (confidenceOrder[
        minConfidence
      ] || 2)
    ) {
      reasons.push(
        'Usage confidence is too low; obtain stronger facility scale evidence.'
      );
    }
  }

  if (lead.agent === 'MJ') {
    if (
      lead.facilityType ===
        'APARTMENT_COMPLEX' &&
      lead.unitCount <
        research.apartmentMinUnits
    ) {
      reasons.push(
        `Apartment complex passes MJ's immutable mandate but is below the current operating minimum of ${Number(research.apartmentMinUnits)} units.`
      );
    }

    if (
      (confidenceOrder[
        lead.usageConfidence
      ] || 0) <
      (confidenceOrder[
        minConfidence
      ] || 2)
    ) {
      reasons.push(
        'Property evidence is too weak to verify the estate or apartment complex.'
      );
    }
  }

  if (
    research.requireContact !== false &&
    scoring.requireContact !== false &&
    !(
      lead.contactNumber ||
      lead.email
    )
  ) {
    reasons.push(
      'No direct business contact number or email found.'
    );
  }

  /*
   * GOVERNABLE FRIDAY SCORING
   */
  let score =
    100 -
    reasons.length *
      numberOr(
        scoring.reasonPenalty,
        18
      );

  if (!lead.email) {
    score -= numberOr(
      scoring.missingEmailPenalty,
      5
    );
  }

  if (!lead.contactNumber) {
    score -= numberOr(
      scoring.missingPhonePenalty,
      5
    );
  }

  if (!lead.contactPerson) {
    score -= numberOr(
      scoring.missingContactPersonPenalty,
      7
    );
  }

  if (evidence.length < 2) {
    score -= numberOr(
      scoring.lowEvidencePenalty,
      8
    );
  }

  score =
    Math.max(
      0,
      Math.min(
        100,
        score
      )
    );

  const approveMinScore =
    numberOr(
      scoring.approveMinScore,
      85
    );

  const reworkMinScore =
    numberOr(
      scoring.reworkMinScore,
      50
    );

  /*
   * Soft failures are either REWORK or REJECTED
   * depending on Friday's current quality thresholds.
   */
  if (
    reasons.length ||
    score < approveMinScore
  ) {
    if (
      score <
      reworkMinScore
    ) {
      return {
        status: 'REJECTED',
        score,
        reasons: [
          ...reasons,
          `Friday score ${score} is below the rework floor of ${reworkMinScore}.`
        ]
      };
    }

    return {
      status: 'REWORK',
      score,
      reasons:
        reasons.length
          ? reasons
          : [
              `Friday score ${score} is below the approval threshold of ${approveMinScore}.`
            ]
    };
  }

  return {
    status: 'APPROVED',
    score,
    reasons: []
  };
}

export function reviewBatch(
  batch,
  leads
) {
  const mine =
    leads.filter(
      l =>
        l.batchId ===
        batch.id
    );

  const approved =
    mine.filter(
      l =>
        l.fridayStatus ===
        'APPROVED'
    ).length;

  const rework =
    mine.filter(
      l =>
        l.fridayStatus ===
        'REWORK'
    ).length;

  const rejected =
    mine.filter(
      l =>
        l.fridayStatus ===
        'REJECTED'
    ).length;

  const duplicates =
    mine.filter(
      l =>
        l.fridayStatus ===
        'DUPLICATE_IGNORED'
    ).length;

  const target =
    Number(
      batch.targetSize ||
      10
    );

  return {
    approved,
    rework,
    rejected,
    duplicates,
    total: mine.length,
    complete:
      approved >= target,
    replacementsNeeded:
      Math.max(
        0,
        target - approved
      )
  };
}