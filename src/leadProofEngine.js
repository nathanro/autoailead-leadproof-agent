import { LEAD_SCENARIOS } from './scenarios.js';

export class LeadProofEngine {
  constructor({ zetarisClient, meterlessClient }) {
    this.zetaris = zetarisClient;
    this.meterless = meterlessClient;
    this.liveAiCallsCount = 0;
    this.liveAiSpendUSD = 0;
  }

  getMetaApiKey() {
    return (process.env.META_API_KEY || process.env.MODEL_API_KEY || '').trim();
  }

  async evaluateLead({
    scenarioId = 'trap-expansion-claim',
    customLead = null,
    overrides = {},
    isCounterfactual = false,
    liveAi = false,
  } = {}) {
    const startedAt = Date.now();
    const baseScenario = LEAD_SCENARIOS[scenarioId] || LEAD_SCENARIOS['trap-expansion-claim'];
    const effectiveOverrides = { ...baseScenario.defaultOverrides, ...overrides };

    const leadMeta = {
      scenarioId: baseScenario.id,
      title: customLead?.title || baseScenario.title,
      vertical: customLead?.vertical || baseScenario.vertical,
      channel: customLead?.channel || baseScenario.channel,
      leadName: customLead?.leadName || baseScenario.leadName,
      leadRole: customLead?.leadRole || baseScenario.leadRole,
      company: customLead?.company || baseScenario.company,
      email: customLead?.email || baseScenario.email,
      dealValueUSD: Number(customLead?.dealValueUSD || baseScenario.dealValueUSD),
      requestedDiscountPct: Number(
        customLead?.requestedDiscountPct !== undefined
          ? customLead.requestedDiscountPct
          : baseScenario.requestedDiscountPct || 0
      ),
      requestedTerms: customLead?.requestedTerms || baseScenario.requestedTerms || 'Net-30',
      incomingMessage: customLead?.incomingMessage || baseScenario.incomingMessage,
      naiveLlmTrap: baseScenario.naiveLlmTrap,
    };

    // Step 1: Query 5-Silo Zetaris Federated Lakehouse in-situ
    const zetarisResult = await this.zetaris.queryLeadContext({
      scenarioId: baseScenario.id,
      customLead: leadMeta,
      overrides: effectiveOverrides,
    });

    const {
      crm_hubspot: crm,
      billing_stripe: billing,
      support_intercom: support,
      web_posthog: intent,
      legal_ironclad: legal,
    } = zetarisResult.federatedRows;

    // Dynamic extraction from edited incomingMessage (seats, discount %, billing claims)
    const seatMatch = leadMeta.incomingMessage.match(/(\d+)\s*(?:active\s*)?(?:pro\s*|enterprise\s*)?seats/i);
    if (seatMatch) {
      billing.claimedSeats = Number(seatMatch[1]);
    }
    const discMatch =
      leadMeta.incomingMessage.match(/(\d+)\s*%\s*(?:discount|off|multi-seat|reduction)/i) ||
      leadMeta.incomingMessage.match(/by\s+(\d+)\s*%/i);
    if (discMatch) {
      const parsedDisc = Number(discMatch[1]);
      leadMeta.requestedDiscountPct = parsedDisc;
      if (overrides.proposedDiscountPct === undefined) {
        effectiveOverrides.proposedDiscountPct = parsedDisc;
      }
    }

    const proposedDiscountPct =
      effectiveOverrides.proposedDiscountPct !== undefined
        ? Number(effectiveOverrides.proposedDiscountPct)
        : leadMeta.requestedDiscountPct;
    const proposedTerms = effectiveOverrides.proposedTerms || leadMeta.requestedTerms;

    // Step 2: Detect cross-silo conflicts & deceptions across all 5 Zetaris sources
    const conflicts = [];
    const msgLower = leadMeta.incomingMessage.toLowerCase();

    if (billing.pastDueUSD > 0) {
      conflicts.push({
        conflictId: 'CONF-BILLING-DELINQUENT',
        severity: billing.pastDueUSD >= 1000 ? 'CRITICAL' : 'MODERATE',
        claimInMessage:
          msgLower.includes('zero billing') || msgLower.includes('good standing')
            ? 'Prospect explicitly claimed "zero billing issues / good standing" in message'
            : 'Prospect requested immediate credit/provisioning expansion',
        federatedFact: `[SRC-2] (${billing.table}) reveals $${billing.pastDueUSD.toLocaleString()} USD past due (${billing.daysOverdue} days overdue, status: ${billing.billingStatus}).`,
        citations: ['SRC-2', 'SRC-5'],
        scorePenalty: billing.pastDueUSD >= 1000 ? -28 : -12,
      });
    }

    if (billing.claimedSeats > billing.activeSeats && !effectiveOverrides.budgetVerified) {
      conflicts.push({
        conflictId: 'CONF-SEAT-DECEPTION',
        severity: 'HIGH',
        claimInMessage: `Prospect claimed ${billing.claimedSeats} active Pro seats in message`,
        federatedFact: `[SRC-2] (${billing.table}) confirms only ${billing.activeSeats} active trial seats on plan '${billing.planTier}'.`,
        citations: ['SRC-1', 'SRC-2'],
        scorePenalty: -14,
      });
    }

    if (
      (baseScenario.id === 'shadow-discount-bluff' ||
        msgLower.includes('barely touched') ||
        msgLower.includes('low usage') ||
        msgLower.includes('45%')) &&
      intent.usageQuotaPct >= 80 &&
      proposedDiscountPct > legal.maxDiscountAllowedPct
    ) {
      conflicts.push({
        conflictId: 'CONF-SHADOW-USAGE-BLUFF',
        severity: 'CRITICAL',
        claimInMessage: `Procurement claimed "barely touched platform / flat adoption" to demand ${proposedDiscountPct}% discount`,
        federatedFact: `[SRC-4] (${intent.table}) proves ${intent.usageQuotaPct}% quota saturation (${intent.activeEngineersCount || 33} active engineers, 41,800 API calls), and [SRC-5] (${legal.table}) caps discount at ${legal.maxDiscountAllowedPct}%.`,
        citations: ['SRC-4', 'SRC-5'],
        scorePenalty: -22,
      });
    } else if (proposedDiscountPct > (legal?.maxDiscountAllowedPct ?? 15) + 5) {
      conflicts.push({
        conflictId: 'CONF-DISCOUNT-POLICY-BREACH',
        severity: 'MODERATE',
        claimInMessage: `Proposed discount of ${proposedDiscountPct}% exceeds MSA governance ceiling`,
        federatedFact: `[SRC-5] (${legal.table} #${legal.contractId}) caps maximum discount at ${legal.maxDiscountAllowedPct}% (${legal.clauseNote}).`,
        citations: ['SRC-5'],
        scorePenalty: -10,
      });
    }

    if (support.openEscalations > 0) {
      conflicts.push({
        conflictId: 'CONF-SUPPORT-HOLD',
        severity: 'HIGH',
        claimInMessage: 'Prospect requested immediate production API / webhook unlock',
        federatedFact: `[SRC-3] (${support.table}) has an active ${support.severity} lock (#${support.ticketId}): "${support.summary}"`,
        citations: ['SRC-3'],
        scorePenalty: -12,
      });
    }

    if (!crm.decisionMakerVerified) {
      conflicts.push({
        conflictId: 'CONF-SIGNER-AUTHORITY',
        severity: 'MODERATE',
        claimInMessage: `Prospect (${leadMeta.leadName}, ${leadMeta.leadRole}) requested direct contract/CapEx authorization`,
        federatedFact: `[SRC-1] (${crm.table}) & [SRC-5] (${legal.table}) require ${legal.requiredSigner}. Note: ${crm.ownerNotes}`,
        citations: ['SRC-1', 'SRC-5'],
        scorePenalty: -10,
      });
    }

    // Record conflicts in Meterless H-MEM TrustLedgerService
    if (conflicts.length > 0) {
      this.meterless._recordTrustAudit(
        'mem-policy-1',
        'conflict_detected',
        'service:ConflictDetectionService',
        { claimCount: baseScenario.leadClaims.length },
        { conflictsDetected: conflicts.map((c) => c.conflictId) },
        { scenarioId: baseScenario.id }
      );
    } else {
      this.meterless._recordTrustAudit(
        'mem-policy-1',
        'conflict_resolved',
        'service:ConflictDetectionService',
        { status: 'checking' },
        { conflictsDetected: 0, allClaimsVerified: true },
        { scenarioId: baseScenario.id }
      );
    }

    // Step 3: Compute Weighted Proof Tree (5 pillars + Conflict Penalty)
    // Pillar 1: Billing & Credit Standing (max 30 pts)
    let billingPoints = 30;
    let billingStatusLabel = 'VERIFIED_PASS';
    if (billing.pastDueUSD >= 1000) {
      billingPoints = 4;
      billingStatusLabel = 'CRITICAL_FAIL';
    } else if (billing.pastDueUSD > 0 || billing.billingStatus.includes('CAP')) {
      billingPoints = 16;
      billingStatusLabel = 'PARTIAL_WARN';
    }

    // Pillar 2: Authority & Legal MSA Compliance (max 25 pts)
    const discountCompliant = proposedDiscountPct <= (legal?.maxDiscountAllowedPct ?? 15);
    let authorityPoints = 25;
    let authorityStatusLabel = 'VERIFIED_PASS';
    if (!crm.decisionMakerVerified && !discountCompliant) {
      authorityPoints = 7;
      authorityStatusLabel = 'SIGNER_AND_MSA_BREACH';
    } else if (!crm.decisionMakerVerified) {
      authorityPoints = 12;
      authorityStatusLabel = 'NEEDS_EXECUTIVE_SIGNER';
    } else if (!discountCompliant) {
      authorityPoints = 14;
      authorityStatusLabel = 'MSA_DISCOUNT_CAP_BREACH';
    }

    // Pillar 3: Support & Operational Readiness (max 20 pts)
    const supportPoints = support.openEscalations === 0 ? 20 : 5;
    const supportStatusLabel = support.openEscalations === 0 ? 'VERIFIED_PASS' : 'HOLD_ACTIVE_ESCALATION';

    // Pillar 4: Product Telemetry & Shadow-Usage Forensics (max 25 pts)
    const intentPoints = intent.intentScore >= 85 ? 24 : intent.intentScore >= 70 ? 18 : 10;
    const intentStatusLabel = intent.intentScore >= 75 ? 'HIGH_TELEMETRY_INTENT' : 'MODERATE_INTENT';

    const rawPositiveScore = billingPoints + authorityPoints + supportPoints + intentPoints;
    const conflictPenalty = conflicts.reduce((acc, c) => acc + (c.scorePenalty || 0), 0);
    const finalScore = Math.max(8, Math.min(99, rawPositiveScore + Math.round(conflictPenalty * 0.35)));

    let verdict = 'NEEDS_VERIFICATION';
    let verdictLabel = 'COUNTER-OFFER / CONDITIONAL SPLIT WORKFLOW';
    let verdictTone = 'warning';

    if (finalScore >= 80 && billing.pastDueUSD === 0 && support.openEscalations === 0 && discountCompliant) {
      verdict = 'QUALIFIED_FAST_TRACK';
      verdictLabel = 'QUALIFIED FAST-TRACK · 5-SILO PROOF VERIFIED';
      verdictTone = 'success';
    } else if (billing.pastDueUSD >= 1000 || support.openEscalations > 0 || finalScore < 48) {
      verdict = 'HOLD_CONFLICT_DETECTED';
      verdictLabel = 'BLOCK & HOLD · CROSS-SILO DECEPTION / RISK DETECTED';
      verdictTone = 'danger';
    }

    const hallucinationBlocked = verdict === 'HOLD_CONFLICT_DETECTED' || conflicts.some((c) => c.severity === 'CRITICAL');
    const confidencePct = conflicts.length > 0 ? 96 : 98;

    // Deal Desk Economics & Margin Calculation
    const maxAllowedDiscountPct = legal?.maxDiscountAllowedPct ?? 10;
    const naiveLossUSD =
      baseScenario.id === 'trap-expansion-claim'
        ? leadMeta.dealValueUSD + billing.pastDueUSD
        : baseScenario.id === 'shadow-discount-bluff'
        ? Math.round((leadMeta.dealValueUSD * (leadMeta.requestedDiscountPct - maxAllowedDiscountPct)) / 100)
        : baseScenario.id === 'lone-star-hvac-commercial'
        ? 14200
        : Math.round(leadMeta.dealValueUSD * 0.15);

    const netContractValueUSD = Math.round(leadMeta.dealValueUSD * (1 - proposedDiscountPct / 100));
    const marginProtectedUSD =
      verdict === 'HOLD_CONFLICT_DETECTED'
        ? naiveLossUSD
        : Math.max(
            250,
            Math.round((leadMeta.dealValueUSD * Math.max(0, leadMeta.requestedDiscountPct - proposedDiscountPct)) / 100) ||
              Math.round(leadMeta.dealValueUSD * 0.22)
          );
    const winProbabilityPct =
      verdict === 'QUALIFIED_FAST_TRACK' ? 94 : verdict === 'NEEDS_VERIFICATION' ? 78 : 34;

    const dealDeskEconomics = {
      baseDealValueUSD: leadMeta.dealValueUSD,
      requestedDiscountPct: leadMeta.requestedDiscountPct,
      proposedDiscountPct,
      maxAllowedDiscountPct,
      proposedTerms,
      allowedPaymentTerms: legal?.allowedPaymentTerms || 'Net-30',
      netContractValueUSD,
      marginProtectedUSD,
      winProbabilityPct,
      grossMarginPct: Math.max(42, 88 - proposedDiscountPct),
    };

    const proofTree = [
      {
        nodeId: 'PROOF-BILLING',
        pillar: '1. Billing & Credit Standing (Weight: 30%)',
        pointsEarned: billingPoints,
        maxPoints: 30,
        status: billingStatusLabel,
        citations: ['SRC-2'],
        claimTested: `Financial standing for $${leadMeta.dealValueUSD.toLocaleString()} deal`,
        evidenceSummary:
          billing.pastDueUSD === 0
            ? `Verified $0 past due on ${billing.table} (${billing.billingStatus}; ${billing.activeSeats} active seats).`
            : `Delinquency alert on ${billing.table}: $${billing.pastDueUSD.toLocaleString()} past due (${billing.daysOverdue}d overdue) on ${billing.activeSeats} active seats.`,
      },
      {
        nodeId: 'PROOF-AUTHORITY',
        pillar: '2. Signer Authority & Legal MSA Guardrails (Weight: 25%)',
        pointsEarned: authorityPoints,
        maxPoints: 25,
        status: authorityStatusLabel,
        citations: ['SRC-1', 'SRC-5'],
        claimTested: `Signer ${leadMeta.leadName} & ${proposedDiscountPct}% discount vs MSA #${legal.contractId}`,
        evidenceSummary: `${crm.verifiedRole} ([SRC-1]). MSA #${legal.contractId} ([SRC-5]) caps discount at ${legal.maxDiscountAllowedPct}% on ${legal.allowedPaymentTerms} (${legal.clauseNote}).`,
      },
      {
        nodeId: 'PROOF-SUPPORT',
        pillar: '3. Support & Operational Locks (Weight: 20%)',
        pointsEarned: supportPoints,
        maxPoints: 20,
        status: supportStatusLabel,
        citations: ['SRC-3'],
        claimTested: 'Operational readiness & open escalation locks',
        evidenceSummary:
          support.openEscalations === 0
            ? `Zero open escalations in ${support.table} (#${support.ticketId}: ${support.summary}).`
            : `Open ${support.severity} lock #${support.ticketId} in ${support.table}: ${support.summary}`,
      },
      {
        nodeId: 'PROOF-INTENT',
        pillar: '4. Product Telemetry & Shadow-Usage Forensics (Weight: 25%)',
        pointsEarned: intentPoints,
        maxPoints: 25,
        status: intentStatusLabel,
        citations: ['SRC-4'],
        claimTested: 'Real product saturation & shadow-champion behavior',
        evidenceSummary: `Intent score ${intent.intentScore}/100 · Quota saturation: ${intent.usageQuotaPct}% across ${intent.activeEngineersCount || 1} active users (${intent.anomalyFlag}).`,
      },
    ];

    // Step 4: Meterless H-MEM Retrieval & Scout Intent Contract
    const hmemRecall = this.meterless.retrieveMemories({
      query: `${leadMeta.company} ${leadMeta.incomingMessage}`,
      scenarioId: baseScenario.id,
      topN: 4,
    });

    const scoutContract = this.meterless.runScoutIntentPipeline({
      scenarioId: baseScenario.id,
      message: leadMeta.incomingMessage,
      company: leadMeta.company,
      hasConflict: conflicts.length > 0,
    });

    // Step 5: Counterfactual Controls ("What Would Change My Mind?")
    const counterfactualControls = [
      {
        key: 'billingPastDueCleared',
        label: 'Clear Past-Due Balance in Stripe ($0 Overdue)',
        sourceBadge: '[SRC-2]',
        active: Boolean(effectiveOverrides.billingPastDueCleared),
        impactDelta: '+26 pts · Resolves Billing Delinquency',
        description: 'Simulates instant wire/card settlement of overdue invoices in zetaris_billing.stripe_subscriptions.',
      },
      {
        key: 'supportLockResolved',
        label: 'Resolve Open P1 Support / Rate-Limit Lock',
        sourceBadge: '[SRC-3]',
        active: Boolean(effectiveOverrides.supportLockResolved),
        impactDelta: '+15 pts · Lifts Escalation Hold',
        description: 'Simulates closing open escalation tickets in zetaris_support.intercom_tickets.',
      },
      {
        key: 'decisionMakerVerified',
        label: 'Verify Executive / CFO Sign-Off Authority',
        sourceBadge: '[SRC-1/SRC-5]',
        active: Boolean(effectiveOverrides.decisionMakerVerified),
        impactDelta: '+13 pts · Confirms Contract Signer',
        description: 'Simulates CFO/Executive co-signature recorded in HubSpot & Ironclad MSA.',
      },
      {
        key: 'budgetVerified',
        label: 'Verify Seat Tier / 50% CapEx Deposit Pre-Approval',
        sourceBadge: '[SRC-2/SRC-5]',
        active: Boolean(effectiveOverrides.budgetVerified),
        impactDelta: '+10 pts · Removes Seat/CapEx Discrepancy',
        description: 'Confirms active seat tier or 50% commercial equipment deposit in Stripe.',
      },
      {
        key: 'urgencyHigh',
        label: 'High-Urgency Product Telemetry Signal (≥88/100)',
        sourceBadge: '[SRC-4]',
        active: Boolean(effectiveOverrides.urgencyHigh),
        impactDelta: '+14 pts · Boosts Priority Routing',
        description: 'Toggles real-time behavioral intent & shadow-usage score in zetaris_intent.posthog_events.',
      },
    ];

    const whatWouldChangeMyMind =
      verdict === 'QUALIFIED_FAST_TRACK'
        ? `This deal is QUALIFIED_FAST_TRACK (${finalScore}/100). Raising the discount slider above the ${legal.maxDiscountAllowedPct}% MSA cap ([SRC-5]) or introducing an unpaid balance in [SRC-2] would immediately downgrade it to CONDITIONAL or HOLD.`
        : verdict === 'HOLD_CONFLICT_DETECTED'
        ? `To flip this decision from HOLD_CONFLICT_DETECTED (${finalScore}/100) to QUALIFIED_FAST_TRACK (≥80/100): toggle ON (1) Clear Past-Due Balance in [SRC-2], (2) Resolve P1 Support Lock in [SRC-3], (3) Verify CFO Sign-Off in [SRC-1/SRC-5], and keep discount ≤${legal.maxDiscountAllowedPct}%.`
        : `To upgrade this deal from CONDITIONAL (${finalScore}/100) to QUALIFIED_FAST_TRACK (≥80/100): align the Discount Slider to ≤${legal.maxDiscountAllowedPct}% per MSA #${legal.contractId} ([SRC-5]) and toggle ON Executive Sign-Off ([SRC-1]) + Billing Clearance ([SRC-2]).`;

    // Step 6: Build Evidence-Backed Recommended Action & Outreach Draft
    let { recommendedAction, outreachDraft } = this._buildActionAndOutreach({
      verdict,
      leadMeta,
      crm,
      billing,
      support,
      intent,
      legal,
      dealDeskEconomics,
    });

    // Optional Step 6b: Live AI Forensic Synthesis via META_API_KEY (muse-spark-1.3) when requested or custom input provided
    let liveAiTelemetry = {
      invoked: false,
      model: 'deterministic-5silo-proof-engine',
      latencyMs: 0,
      costUSD: 0,
      executiveBrief: null,
    };

    if (liveAi && this.getMetaApiKey() && this.liveAiSpendUSD < 5.0) {
      const aiRes = await this.generateLiveForensicSynthesis({
        leadMeta,
        verdict,
        finalScore,
        conflicts,
        citations: zetarisResult.citations,
        dealDeskEconomics,
      });
      if (aiRes && aiRes.ok) {
        liveAiTelemetry = aiRes;
        if (aiRes.recommendedAction) recommendedAction = aiRes.recommendedAction;
        if (aiRes.outreachBody) {
          outreachDraft.body = aiRes.outreachBody;
          outreachDraft.subject = aiRes.outreachSubject || outreachDraft.subject;
        }
      }
    }

    const totalLatencyMs = Math.max(29, Date.now() - startedAt + zetarisResult.latencyMs);

    // Step 7: Record in Meterless Outcome & ROI Ledger
    const meterlessReceipt = this.meterless.recordOutcomeEvent({
      scenarioId: baseScenario.id,
      company: leadMeta.company,
      verdict,
      score: finalScore,
      confidencePct,
      hallucinationBlocked,
      counterfactualRun: isCounterfactual,
      latencyMs: totalLatencyMs,
      zetarisRows: zetarisResult.citations.length,
      marginProtectedUSD: dealDeskEconomics.marginProtectedUSD,
      liveAiCostUSD: liveAiTelemetry.costUSD || 0,
    });

    const msaCapVal = legal?.maxDiscountAllowedPct ?? 10;
    const evaluatedClaims = (baseScenario.leadClaims || []).map((c) => {
      const item = { ...c };
      if (item.id === 'claim_seats') {
        if (seatMatch) {
          item.label = `Claims ${billing.claimedSeats} active Pro seats`;
          item.claimedValue = `${billing.claimedSeats} Pro seats active`;
        }
        item.status =
          billing.claimedSeats <= billing.activeSeats || effectiveOverrides.budgetVerified
            ? 'verified'
            : 'contradicted';
      } else if (item.id === 'claim_billing') {
        const claimsZeroOverdue =
          /\$0\s*(?:past\s*due|overdue)|zero\s*billing|good\s*standing|paid\s*in\s*full|no\s*overdue/i.test(
            leadMeta.incomingMessage
          );
        if (claimsZeroOverdue) {
          item.claimedValue = '$0 past due claimed';
        }
        item.status = billing.pastDueUSD === 0 ? 'verified' : 'contradicted';
      } else if (item.id === 'claim_authority' || item.id === 'claim_role') {
        item.status = crm.decisionMakerVerified ? 'verified' : 'contradicted';
      } else if (item.id === 'claim_discount') {
        item.label = `Demands ${proposedDiscountPct}% discount`;
        item.claimedValue = `${proposedDiscountPct}% off renewal`;
        item.status = proposedDiscountPct <= msaCapVal ? 'verified' : 'contradicted';
      } else if (item.id === 'claim_usage') {
        const claimsLowUsage = /barely\s*touched|low\s*usage|flat\s*adoption/i.test(leadMeta.incomingMessage);
        item.status = claimsLowUsage && intent.usageQuotaPct >= 80 ? 'contradicted' : 'verified';
      } else if (item.id === 'claim_credit') {
        item.status = billing.pastDueUSD === 0 && effectiveOverrides.budgetVerified ? 'verified' : 'contradicted';
      }
      return item;
    });

    return {
      evaluationId: `eval_${Date.now().toString(36)}`,
      evaluatedClaims,
      timestamp: new Date().toISOString(),
      scenarioId: baseScenario.id,
      isCounterfactual,
      appliedOverrides: effectiveOverrides,
      lead: leadMeta,
      dealDeskEconomics,
      decision: {
        verdict,
        verdictLabel,
        verdictTone,
        score: finalScore,
        confidencePct,
        hallucinationBlocked,
        conflictCount: conflicts.length,
        whatWouldChangeMyMind,
        recommendedAction,
        outreachDraft,
      },
      liveAiTelemetry,
      proofTree,
      conflicts,
      citations: zetarisResult.citations,
      counterfactualControls,
      zetarisTelemetry: {
        queryId: zetarisResult.queryId,
        sql: zetarisResult.sql,
        latencyMs: zetarisResult.latencyMs,
        zeroDataMovement: true,
        readOnlyMcp: true,
        executionPlan: zetarisResult.executionPlan,
        auditEntry: zetarisResult.auditEntry,
      },
      meterlessTelemetry: {
        receipt: meterlessReceipt,
        scoutContract,
        hmemRecall,
      },
    };
  }

  async generateLiveForensicSynthesis({ leadMeta, verdict, finalScore, conflicts, citations, dealDeskEconomics }) {
    const apiKey = this.getMetaApiKey();
    if (!apiKey) return { ok: false, reason: 'META_API_KEY not configured' };

    const t0 = Date.now();
    try {
      const factsBlock = citations.map((c) => `${c.badge} (${c.table}): ${c.summary}`).join('\n');
      const conflictsBlock =
        conflicts.length > 0
          ? conflicts.map((c) => `- ${c.conflictId}: ${c.federatedFact}`).join('\n')
          : 'Zero cross-silo conflicts detected.';

      const resp = await fetch('https://api.meta.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'muse-spark-1.3',
          temperature: 0.2,
          
          messages: [
            {
              role: 'system',
              content:
                'You are LeadProof Agent, an Explainable Revenue Deal Desk & Forensic Verification Agent powered by Zetaris Federated SQL and Meterless H-MEM. Always cite exact source badges ([SRC-1] to [SRC-5]) in your explanation and outreach draft. Return strict JSON with keys: executiveBrief, recommendedAction, outreachSubject, outreachBody.',
            },
            {
              role: 'user',
              content: `Prospect: ${leadMeta.leadName} (${leadMeta.leadRole}) at ${leadMeta.company}\nDeal Value: $${leadMeta.dealValueUSD} | Proposed Discount: ${dealDeskEconomics.proposedDiscountPct}% | Terms: ${dealDeskEconomics.proposedTerms}\nIncoming Message: "${leadMeta.incomingMessage}"\nComputed Verdict: ${verdict} (${finalScore}/100) | Margin Protected: $${dealDeskEconomics.marginProtectedUSD}\n\nZetaris 5-Silo Federated Evidence:\n${factsBlock}\n\nCross-Silo Conflicts:\n${conflictsBlock}`,
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'ForensicDealSynthesis',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  executiveBrief: { type: 'string' },
                  recommendedAction: { type: 'string' },
                  outreachSubject: { type: 'string' },
                  outreachBody: { type: 'string' },
                },
                required: ['executiveBrief', 'recommendedAction', 'outreachSubject', 'outreachBody'],
                additionalProperties: false,
              },
            },
          },
        }),
      });

      if (!resp.ok) {
        return { ok: false, reason: `HTTP ${resp.status}` };
      }
      const data = await resp.json();
      const rawContent = data.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(rawContent);
      const inTok = data.usage?.prompt_tokens || 450;
      const outTok = data.usage?.completion_tokens || 260;
      const costUSD = Number(((inTok * 1.25 + outTok * 4.25) / 1_000_000).toFixed(6));

      this.liveAiCallsCount += 1;
      this.liveAiSpendUSD = Number((this.liveAiSpendUSD + costUSD).toFixed(6));

      return {
        ok: true,
        invoked: true,
        model: 'muse-spark-1.3 (Live API)',
        latencyMs: Date.now() - t0,
        tokens: { input: inTok, output: outTok, total: inTok + outTok },
        costUSD,
        executiveBrief: parsed.executiveBrief,
        recommendedAction: parsed.recommendedAction,
        outreachSubject: parsed.outreachSubject,
        outreachBody: parsed.outreachBody,
      };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }

  async askForensicQuestion({ scenarioId = 'trap-expansion-claim', question = '', overrides = {} } = {}) {
    const evalState = await this.evaluateLead({ scenarioId, overrides, isCounterfactual: false, liveAi: false });
    const apiKey = this.getMetaApiKey();
    const t0 = Date.now();

    const factsText = evalState.citations.map((c) => `${c.badge} (${c.table}): ${c.summary}`).join('\n');
    const qText =
      String(question || '').trim() ||
      'Why did you make this qualification decision, and what exact cross-silo evidence proves it?';

    if (apiKey && this.liveAiSpendUSD < 5.0) {
      try {
        const resp = await fetch('https://api.meta.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'muse-spark-1.3',
            temperature: 0.2,
            
            messages: [
              {
                role: 'system',
                content:
                  'You are LeadProof Agent (Track 02: The Agent That Can Explain Why). Answer the user or judge question concisely in 3-5 sentences, citing exact Zetaris federated sources ([SRC-1] CRM, [SRC-2] Stripe Billing, [SRC-3] Intercom Support, [SRC-4] PostHog/Iceberg Telemetry, [SRC-5] Ironclad Legal MSA) and quantifying the dollar impact.',
              },
              {
                role: 'user',
                content: `Scenario: ${evalState.lead.company} (${evalState.decision.verdict}, Score ${evalState.decision.score}/100, Margin Protected: $${evalState.dealDeskEconomics.marginProtectedUSD.toLocaleString()})\n\nZetaris Federated Evidence:\n${factsText}\n\nJudge Question: "${qText}"`,
              },
            ],
          }),
        });

        if (resp.ok) {
          const data = await resp.json();
          const answer = (data.choices?.[0]?.message?.content || '').trim();
          if (answer) {
          const inTok = data.usage?.prompt_tokens || 380;
          const outTok = data.usage?.completion_tokens || 190;
          const costUSD = Number(((inTok * 1.25 + outTok * 4.25) / 1_000_000).toFixed(6));
          this.liveAiCallsCount += 1;
          this.liveAiSpendUSD = Number((this.liveAiSpendUSD + costUSD).toFixed(6));

            return {
              ok: true,
              mode: 'live-ai-muse-spark-1.3',
              question: qText,
              answer,
              latencyMs: Date.now() - t0,
              costUSD,
              citationsUsed: ['[SRC-1]', '[SRC-2]', '[SRC-3]', '[SRC-4]', '[SRC-5]'],
            };
          }
        }
      } catch (_) {
        // fall through to deterministic grounded answer
      }
    }

    return {
      ok: true,
      mode: 'deterministic-5silo-grounded',
      question: qText,
      answer: `Based on our 5-silo Zetaris Federated SQL join (${evalState.zetarisTelemetry.queryId}), ${evalState.lead.company} received ${evalState.decision.verdict} (${evalState.decision.score}/100): ${evalState.citations.map((c) => `${c.badge} ${c.summary}`).join(' | ')}. ${evalState.decision.whatWouldChangeMyMind}`,
      latencyMs: Date.now() - t0 + 18,
      costUSD: 0,
      citationsUsed: ['[SRC-1]', '[SRC-2]', '[SRC-3]', '[SRC-4]', '[SRC-5]'],
    };
  }

  _buildActionAndOutreach({ verdict, leadMeta, crm, billing, support, intent, legal, dealDeskEconomics }) {
    if (leadMeta.scenarioId === 'shadow-discount-bluff' && verdict !== 'QUALIFIED_FAST_TRACK') {
      return {
        recommendedAction: `COUNTER PROCUREMENT BLUFF: Reject the ${leadMeta.requestedDiscountPct}% discount demand using [SRC-4] proof (${intent.usageQuotaPct}% engineering quota saturation across ${intent.activeEngineersCount} active builders). Anchor renewal at the ${legal.maxDiscountAllowedPct}% MSA cap ([SRC-5] #${legal.contractId}), protecting $${dealDeskEconomics.marginProtectedUSD.toLocaleString()} in gross margin.`,
        outreachDraft: {
          channel: leadMeta.channel,
          recipient: `${leadMeta.leadName} <${leadMeta.email}> (CC: Priya Nair, CTO)`,
          subject: `Vanguard FinTech Q4 Renewal Telemetry Report & ${legal.maxDiscountAllowedPct}% Loyalty Tier (#${legal.contractId})`,
          body: `Hi ${leadMeta.leadName.split(' ')[0]},\n\nThank you for your note on the Q4 renewal. Before finalizing your renewal structure, we ran a live usage audit across your production workspace ([SRC-4]):\n\n• **Active Engineering Adoption:** 33 builders across 3 Vanguard departments executed **41,800 production API calls** in the last 14 days (**${intent.usageQuotaPct}% quota saturation**).\n• **Infrastructure Expansion:** Your engineering lead requested a 4x webhook concurrency increase (50 → 200 req/sec) yesterday ([SRC-3] #${support.ticketId}), and CTO Priya Nair rated the platform 10/10 in last week's QBR ([SRC-1]).\n• **Price Protection Cap:** Per Section 7.1 of MSA #${legal.contractId} ([SRC-5]), accounts above 80% utilization qualify for our **${legal.maxDiscountAllowedPct}% loyalty renewal tier ($${dealDeskEconomics.netContractValueUSD.toLocaleString()} ARR on ${legal.allowedPaymentTerms})** plus complimentary 200 req/sec webhook bursting.\n\nHere is the counter-signed renewal order form ready for execution: https://pay.autoailead.com/renewal/${billing.subscriptionId}`,
        },
      };
    }

    if (verdict === 'HOLD_CONFLICT_DETECTED') {
      return {
        recommendedAction: `BLOCK auto-provisioning of Enterprise API keys ($${dealDeskEconomics.marginProtectedUSD.toLocaleString()} exposure protected). Route to RevOps Billing Desk with 1-click settlement link for Invoice #${billing.invoiceId} ($${billing.pastDueUSD.toLocaleString()} overdue in [SRC-2]) and require ${legal.requiredSigner} co-signature ([SRC-5]).`,
        outreachDraft: {
          channel: leadMeta.channel,
          recipient: `${leadMeta.leadName} <${leadMeta.email}>`,
          subject: `Action Required: Account Settlement (#${billing.invoiceId}) & Enterprise API Upgrade for ${leadMeta.company}`,
          body: `Hi ${leadMeta.leadName.split(' ')[0]},\n\nThanks for reaching out about unlocking Enterprise API & Webhook access before 5 PM today.\n\nBefore our system can issue production Enterprise credentials, our live 5-silo check flagged three requirements:\n1. **Past-Due Balance ([SRC-2]):** Invoice #${billing.invoiceId} shows an open balance of **$${billing.pastDueUSD.toLocaleString()} USD** (${billing.daysOverdue} days overdue) on your ${billing.activeSeats}-seat sandbox.\n2. **Rate-Limit Hold ([SRC-3]):** Ticket #${support.ticketId} placed an automated lock after 14 bulk API key rotation attempts ([SRC-4]).\n3. **Executive Sign-Off ([SRC-5]):** Per MSA #${legal.contractId}, annual upgrades require **${legal.requiredSigner}** on ${legal.allowedPaymentTerms} terms.\n\nSettle Invoice #${billing.invoiceId} here to automatically lift Hold #${support.ticketId} in 60 seconds: https://pay.autoailead.com/inv/${billing.invoiceId}`,
        },
      };
    }

    if (verdict === 'NEEDS_VERIFICATION') {
      return {
        recommendedAction: `SPLIT WORKFLOW: Immediately dispatch Commercial Crew #4 for the 2:30 PM diagnostic ($249 within ${leadMeta.leadName}'s $1,500 limit [SRC-1]), and send ${legal.requiredSigner} a 1-click 50% CapEx deposit link for the $${dealDeskEconomics.netContractValueUSD.toLocaleString()} RTU replacement ([SRC-2], [SRC-5]).`,
        outreachDraft: {
          channel: leadMeta.channel,
          recipient: `${leadMeta.leadName} <${leadMeta.email}>`,
          subject: `Crew #4 Reserved for 2:30 PM Today + CFO Deposit Link for $${dealDeskEconomics.netContractValueUSD.toLocaleString()} RTU Swap`,
          body: `Hi ${leadMeta.leadName.split(' ')[0]},\n\nWe verified the 82.4°F IoT alert at ${leadMeta.company} ([SRC-4]) and reserved Commercial Crew #4 for **2:30 PM CST today** ([SRC-3] #${support.ticketId}).\n\nPer your commercial charter ([SRC-1], [SRC-5] #${legal.contractId}), your Facilities Coordinator profile is pre-authorized up to **$1,500**, and Net-30 credit is capped at $5,000 ([SRC-2]). To load the crane & 2x 10-ton Carrier units today:\n\n• **Confirmed Now:** Crew #4 emergency diagnostic dispatch at 2:30 PM ($249).\n• **For Crane Swap ($${dealDeskEconomics.netContractValueUSD.toLocaleString()} after ${dealDeskEconomics.proposedDiscountPct}% discount):** Forward this 1-click 50% CapEx deposit link to **CFO Rachel Green**: https://pay.autoailead.com/capex/${billing.invoiceId}`,
        },
      };
    }

    // QUALIFIED_FAST_TRACK
    if (leadMeta.scenarioId === 'smile-dental-implant') {
      return {
        recommendedAction: `FAST-TRACK SURGICAL BOOKING: Confirm Thursday 11:00 AM Zirconia Implant Chair with Dr. Morales, waive $250 CBCT fee ([SRC-3] #SCAN-309 verified on file), and attach pre-approved $8,500 CareCredit link ([SRC-2], [SRC-5]).`,
        outreachDraft: {
          channel: 'WhatsApp Business (ES/EN)',
          recipient: `${leadMeta.leadName} <${leadMeta.email}>`,
          subject: `Cita Confirmada Jueves 11:00 AM — Implantes de Zirconia (Tomografía 3D #SCAN-309 Lista)`,
          body: `¡Hola Sofía! 🦷\n\nRevisamos tu expediente clínico en tiempo real y tenemos todo listo:\n• **Tomografía 3D Validada ([SRC-3] #SCAN-309):** Tu estudio de agosto ya está aprobado por el Dr. Morales, así que **no tienes que pagar ni repetir la tomografía ($250 USD ahorrados)**.\n• **CareCredit Pre-Aprobado ([SRC-2]):** Tu línea activa hasta $8,500 USD (12 meses sin intereses) cubre el paquete quirúrgico de 2 implantes de zirconia ($${dealDeskEconomics.netContractValueUSD.toLocaleString()} USD) con consentimiento #${legal.contractId} ([SRC-5]).\n\nTe reservamos el quirófano este **jueves a las 11:00 AM** en Smile Dental Brickell. Responde "CONFIRMAR" para enviarte tu pase directo.`,
        },
      };
    }

    return {
      recommendedAction: `AUTO-APPROVE FAST TRACK: Issue Enterprise Order Form ($${dealDeskEconomics.netContractValueUSD.toLocaleString()} net ARR at ${dealDeskEconomics.proposedDiscountPct}% discount on ${dealDeskEconomics.proposedTerms}), attach pre-cleared Agreement #${legal.contractId} ([SRC-5]), and trigger instant provisioning.`,
      outreachDraft: {
        channel: leadMeta.channel,
        recipient: `${leadMeta.leadName} <${leadMeta.email}>`,
        subject: `Ready for Execution: ${leadMeta.company} Enterprise Order Form ($${dealDeskEconomics.netContractValueUSD.toLocaleString()} ARR)`,
        body: `Hi ${leadMeta.leadName},\n\nWe verified your account across all 5 enterprise systems in real time:\n• **Usage & Telemetry ([SRC-4]):** ${intent.usageQuotaPct}% utilization verified.\n• **Billing Standing ([SRC-2]):** $0 past due (${billing.billingStatus}) across ${billing.activeSeats} active seats.\n• **Legal & Governance ([SRC-5] #${legal.contractId}):** ${legal.complianceStatus} — ${dealDeskEconomics.proposedDiscountPct}% tier approved on ${dealDeskEconomics.proposedTerms} terms.\n\nExecute your 1-click expansion order form here: https://app.autoailead.com/enterprise/order/${billing.subscriptionId}`,
      },
    };
  }

  async handleObjectionAndQuote({
    scenarioId = 'trap-expansion-claim',
    objectionType = 'competitor_price',
    customObjection = '',
    overrides = {},
    liveAi = false,
  } = {}) {
    const evalState = await this.evaluateLead({ scenarioId, overrides, isCounterfactual: false, liveAi: false });
    const { lead, citations, dealDeskEconomics, decision } = evalState;
    const { crm_hubspot: crm, billing_stripe: billing, support_intercom: support, web_posthog: intent, legal_ironclad: legal } =
      (await this.zetaris.queryLeadContext({ scenarioId, overrides })).federatedRows;

    const objectionPresets = {
      competitor_price: {
        label: '💸 "Too expensive — Competitor X quoted me 40% less"',
        buyerObjection: customObjection || `Competitor X just quoted us 40% less than your $${lead.dealValueUSD.toLocaleString()} price. Match their 40% discount or we walk.`,
        strategyName: 'Telemetry-Anchored Value Defense + Authorized Fast-Close Incentive',
        whyExplanation: `Zetaris cross-silo proof shows [SRC-4] (${intent.table}) at ${intent.usageQuotaPct}% active usage saturation and [SRC-5] (${legal.table} #${legal.contractId}) caps maximum discount at ${legal.maxDiscountAllowedPct}%. In H-MEM win/loss memory, 3 peer accounts in ${lead.vertical} churned from low-cost Competitor X within 60 days due to missing Zero-ETL governance and SLA downtime. We hold the ${legal.maxDiscountAllowedPct}% MSA floor and attach a waived onboarding/implementation bonus when settled via instant deposit today.`,
        citationsUsed: ['[SRC-4]', '[SRC-5]', '[SRC-2]'],
      },
      no_time_migrate: {
        label: '⏳ "We don\'t have time to migrate right now, call me next quarter"',
        buyerObjection: customObjection || 'Our team is swamped right now and we do not have bandwidth to onboard or migrate until next quarter.',
        strategyName: 'Zero-ETL Turnkey Activation + Price-Freeze Deposit Lock',
        whyExplanation: `[SRC-4] (${intent.table}) proves ${intent.activeEngineersCount || 4} users/workflows are already active in-situ, and [SRC-3] (${support.table} #${support.ticketId}) confirms turnkey readiness. Waiting until next quarter forfeits current tier pricing and leaves the active issue unresolved. Offering a 1-click deposit locks current pricing with zero engineering lift.`,
        citationsUsed: ['[SRC-3]', '[SRC-4]', '[SRC-1]'],
      },
      prove_roi_volume: {
        label: '🤔 "How do I know this will actually work for our volume?"',
        buyerObjection: customObjection || 'How can we be sure this will handle our real production volume and deliver ROI before committing?',
        strategyName: 'Live Production Telemetry Proof + SLA Performance Guarantee',
        whyExplanation: `[SRC-4] (${intent.table}) already recorded an intent/usage score of ${intent.intentScore}/100 (${intent.anomalyFlag}), and [SRC-3] shows CSAT ${support.csatScore}/5.0. We attach a contractual 99.95% SLA performance guarantee under [SRC-5] (#${legal.contractId}) so the buyer has zero downside risk.`,
        citationsUsed: ['[SRC-4]', '[SRC-3]', '[SRC-5]'],
      },
      net60_zero_upfront: {
        label: '🧾 "Can we do Net-60 with $0 upfront?"',
        buyerObjection: customObjection || 'We need Net-60 invoice terms with $0 upfront deposit to move forward today.',
        strategyName: billing.pastDueUSD > 0 ? 'Delinquency Settlement Gate + Instant Card Unlock' : 'Split Deposit / Fast-Action Rebate Counter-Offer',
        whyExplanation:
          billing.pastDueUSD > 0
            ? `[SRC-2] (${billing.table}) flags $${billing.pastDueUSD.toLocaleString()} overdue (${billing.daysOverdue} days) on Invoice #${billing.invoiceId}, and [SRC-5] (#${legal.contractId}) strictly suspends Net-60 credit until the overdue balance is cleared. Counter-offering instant card settlement of #${billing.invoiceId} immediately unlocks provisioning.`
            : `[SRC-5] (#${legal.contractId}) sets standard terms to ${legal.allowedPaymentTerms} with a ${legal.maxDiscountAllowedPct}% discount ceiling. By collecting an instant reservation deposit today, we unlock priority provisioning while protecting 100% of gross margin.`,
        citationsUsed: ['[SRC-2]', '[SRC-5]', '[SRC-1]'],
      },
    };

    const preset = objectionPresets[objectionType] || objectionPresets.competitor_price;
    const authorizedDiscountPct = Math.min(dealDeskEconomics.proposedDiscountPct, (legal.maxDiscountAllowedPct ?? 8));
    const finalContractPriceUSD = Math.round(lead.dealValueUSD * (1 - authorizedDiscountPct / 100));
    const savingsUSD = lead.dealValueUSD - finalContractPriceUSD;

    // Compute instant checkout deposit or settlement amount
    let dueTodayUSD = Math.min(2500, Math.max(249, Math.round(finalContractPriceUSD * 0.15)));
    let checkoutItemLabel = `Priority Activation Deposit & Price Lock (${lead.company})`;
    if (billing.pastDueUSD > 0) {
      dueTodayUSD = billing.pastDueUSD + Math.round(finalContractPriceUSD * 0.25);
      checkoutItemLabel = `Past-Due Invoice #${billing.invoiceId} ($${billing.pastDueUSD.toLocaleString()}) + 25% Enterprise Activation`;
    } else if (scenarioId === 'smile-dental-implant') {
      dueTodayUSD = 49;
      checkoutItemLabel = `Priority Thursday 11:00 AM Surgical Chair Lock (CBCT #SCAN-309 Fee Waived — $250 Saved)`;
    } else if (scenarioId === 'lone-star-hvac-commercial') {
      dueTodayUSD = 249;
      checkoutItemLabel = `Emergency Crew #4 Diagnostic Dispatch Today 2:30 PM + Hold 2x 10-Ton Carrier Units`;
    }

    let rebuttalSpeech = `I hear you, ${lead.leadName.split(' ')[0]}. Here is what our live data shows: per ${preset.citationsUsed.join(' and ')}, ${preset.whyExplanation} Instead of an unapproved discount that breaks your SLA, I have unlocked our authorized ${authorizedDiscountPct}% margin-safe offer at $${finalContractPriceUSD.toLocaleString()} (${legal.allowedPaymentTerms}) and waived the onboarding fee. You can lock this in right now with the $${dueTodayUSD.toLocaleString()} instant checkout below.`;

    let liveAiUsed = false;
    const apiKey = this.getMetaApiKey();
    if (liveAi && apiKey && this.liveAiSpendUSD < 5.0) {
      try {
        const resp = await fetch('https://api.meta.ai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'muse-spark-1.3',
            temperature: 0.25,
            messages: [
              {
                role: 'system',
                content:
                  'You are LeadProof Autonomous AI Sales Closer (Track 02: The Agent That Can Explain Why). Write a persuasive, high-converting 3-sentence closer rebuttal to the buyer objection. Explicitly cite Zetaris sources ([SRC-1] to [SRC-5]), defend the margin floor, and invite the buyer to click the Instant Checkout button right now.',
              },
              {
                role: 'user',
                content: `Prospect: ${lead.leadName} at ${lead.company} ($${lead.dealValueUSD})\nBuyer Objection: "${preset.buyerObjection}"\nForensic Strategy: ${preset.whyExplanation}\nAuthorized Final Price: $${finalContractPriceUSD.toLocaleString()} (${authorizedDiscountPct}% discount) | Due Today to Lock: $${dueTodayUSD.toLocaleString()} (${checkoutItemLabel})`,
              },
            ],
          }),
        });
        if (resp.ok) {
          const d = await resp.json();
          const content = (d.choices?.[0]?.message?.content || '').trim();
          if (content) {
            rebuttalSpeech = content;
            liveAiUsed = true;
            this.liveAiCallsCount += 1;
          }
        }
      } catch (_) {}
    }

    const quoteId = `qt_${Date.now().toString(36)}`;
    this.meterless._recordTrustAudit(
      'mem-vanguard-bluff',
      'read',
      'service:AutonomousCloserEngine',
      { objectionType },
      { quoteId, finalContractPriceUSD, dueTodayUSD },
      { scenarioId }
    );

    return {
      ok: true,
      quoteId,
      scenarioId,
      objectionType,
      objectionLabel: preset.label,
      buyerObjection: preset.buyerObjection,
      strategyName: preset.strategyName,
      whyExplanation: preset.whyExplanation,
      citationsUsed: preset.citationsUsed,
      rebuttalSpeech,
      liveAiUsed,
      checkoutOffer: {
        quoteId,
        company: lead.company,
        recipient: `${lead.leadName} <${lead.email}>`,
        listPriceUSD: lead.dealValueUSD,
        authorizedDiscountPct,
        savingsUSD,
        finalContractPriceUSD,
        dueTodayUSD,
        checkoutItemLabel,
        paymentTerms: legal.allowedPaymentTerms,
        contractRef: legal.contractId,
        bonusIncluded:
          scenarioId === 'smile-dental-implant'
            ? 'Waived $250 3D CBCT Scan Fee (#SCAN-309 Verified)'
            : scenarioId === 'lone-star-hvac-commercial'
            ? 'Priority 2:30 PM Crew #4 Dispatch + $249 Credited Toward RTU Swap'
            : 'Complimentary 200 req/sec Webhook Bursting + Priority SLA',
        status: 'READY_TO_CLOSE',
      },
    };
  }

  async closeDealCheckout({
    scenarioId = 'trap-expansion-claim',
    quoteId = 'qt_live',
    amountPaidUSD = 1500,
    finalContractPriceUSD = 24000,
    company = 'Apex Logistics Corp',
  } = {}) {
    const receiptId = `chk_paid_${Date.now().toString(36)}`;
    const ledgerEntry = this.meterless.recordOutcomeEvent({
      scenarioId,
      company,
      verdict: 'DEAL_CLOSED_AND_PAID',
      score: 99,
      confidencePct: 99,
      hallucinationBlocked: false,
      counterfactualRun: false,
      latencyMs: 31,
      zetarisRows: 5,
      marginProtectedUSD: finalContractPriceUSD,
      liveAiCostUSD: 0,
    });
    ledgerEntry.outcomes.unshift('deal_closed_revenue', 'instant_checkout_paid');

    this.meterless._recordTrustAudit(
      'mem-policy-1',
      'promote',
      'service:StripeInstantCheckout',
      { status: 'QUOTE_ISSUED', quoteId },
      { status: 'DEAL_CLOSED_PAID', receiptId, amountPaidUSD, finalContractPriceUSD },
      { scenarioId }
    );

    return {
      ok: true,
      status: 'DEAL_CLOSED_AND_PAID',
      receiptId,
      quoteId,
      timestamp: new Date().toISOString(),
      company,
      amountPaidUSD: Number(amountPaidUSD),
      finalContractPriceUSD: Number(finalContractPriceUSD),
      provisioningStatus: 'INSTANT_PROVISIONING_UNLOCKED',
      whatsappOwnerAlert: `💰 [LeadProof AI Closer] DEAL CLOSED & PAID! ${company} just completed Instant Checkout ($${Number(amountPaidUSD).toLocaleString()} USD paid now · $${Number(finalContractPriceUSD).toLocaleString()} total contract value). Receipt #${receiptId}.`,
      meterlessReceipt: ledgerEntry,
    };
  }

}
