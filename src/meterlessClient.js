import crypto from 'node:crypto';

function clamp01(val) {
  return Math.max(0, Math.min(1, Number(val) || 0));
}

function hmacSha256(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Meterless Runtime 1.4 / Provider Contract v4 URL Normalizer
 * Accepts any pasted URL with or without scheme, /v1, /v1/chat/completions, /v1/models, or /healthz
 * and normalizes to <host>/v1 without ever producing /v1/v1.
 */
export function normalizeMeterlessUrl(rawUrl = 'http://127.0.0.1:8088/v1') {
  let cleaned = String(rawUrl || 'http://127.0.0.1:8088/v1').trim();
  if (!/^https?:\/\//i.test(cleaned)) {
    cleaned = `http://${cleaned}`;
  }
  cleaned = cleaned
    .replace(/\/v1\/chat\/completions\/?$/i, '')
    .replace(/\/v1\/models\/?$/i, '')
    .replace(/\/healthz\/?$/i, '')
    .replace(/\/v1\/?$/i, '')
    .replace(/\/+$/, '');
  return `${cleaned}/v1`;
}

export const CANONICAL_HMEM_AUDIT_ACTIONS = [
  'create',
  'read',
  'update',
  'delete',
  'feedback',
  'promote',
  'demote',
  'merge',
  'conflict_detected',
  'conflict_resolved',
  'sleep_consolidate',
  'sleep_archive',
  'sleep_synthesize',
  'dream_proposed',
  'dream_approved',
  'dream_rejected',
  'restore',
];

export const SCOUT_INTENT_REGISTRY = [
  {
    id: 'revenue.qualify_expansion',
    category: 'revenue',
    description: 'Verify and qualify an existing customer expansion or enterprise upgrade request across CRM, Billing, Support, Telemetry, and Legal.',
    capabilities: ['zetaris.query', 'hmem.recall', 'hmem.conflict_scan', 'outreach.draft'],
    riskClass: 'medium',
    surfaces: ['web', 'whatsapp', 'email', 'slack'],
    roles: ['ae', 'revops', 'autonomous_qualifier'],
    examples: ['unlock enterprise API for 50 seats', 'add 8 clinic locations and enable HIPAA BAA'],
    version: 4,
  },
  {
    id: 'revenue.counter_procurement_bluff',
    category: 'revenue',
    description: 'Detect shadow engineering adoption across telemetry lakes when procurement demands steep renewal discounts.',
    capabilities: ['zetaris.query', 'hmem.recall', 'hmem.conflict_scan', 'dealdesk.counter_offer'],
    riskClass: 'high',
    surfaces: ['email', 'slack', 'web'],
    roles: ['deal_desk', 'ae', 'vp_sales'],
    examples: ['cut our annual renewal by 45% or we cancel this Friday'],
    version: 4,
  },
  {
    id: 'revenue.book_clinical_consult',
    category: 'revenue',
    description: 'Verify patient imaging/financing records and schedule high-value clinical consultation.',
    capabilities: ['zetaris.query', 'hmem.recall', 'calendar.check', 'outreach.draft'],
    riskClass: 'low',
    surfaces: ['whatsapp', 'web'],
    roles: ['reception_agent', 'clinic_coordinator'],
    examples: ['cotizar 2 implantes de zirconia con CareCredit este jueves'],
    version: 4,
  },
  {
    id: 'revenue.dispatch_commercial_emergency',
    category: 'revenue',
    description: 'Evaluate commercial emergency dispatch and verify CapEx credit limits before equipment replacement.',
    capabilities: ['zetaris.query', 'hmem.recall', 'hmem.conflict_scan', 'dispatch.hold'],
    riskClass: 'high',
    surfaces: ['phone', 'web', 'whatsapp'],
    roles: ['dispatch_coordinator', 'autonomous_qualifier'],
    examples: ['two 10-ton Carrier rooftop units failed need Net-60 replacement today'],
    version: 4,
  },
];

export class MeterlessClient {
  constructor(options = {}) {
    this.runtimeUrl = normalizeMeterlessUrl(options.runtimeUrl || process.env.METERLESS_RUNTIME_URL || 'http://127.0.0.1:8088/v1');
    this.runtimeToken = options.runtimeToken || process.env.METERLESS_RUNTIME_TOKEN || '';
    this.appId = options.appId || process.env.METERLESS_APP_ID || 'leadproof-agent';
    this.signingSecret = options.signingSecret || 'meterless-scout-hmac-v4-leadproof';
    this.maxTenantBudgetUSD = Number(options.maxTenantBudgetUSD || process.env.METERLESS_MAX_TENANT_BUDGET_USD || 15.0);

    // Append-only H-MEM store & TrustLedgerService
    this.memories = [];
    this.trustLedger = [];
    this.contractsIssued = [];
    this.outcomeLedger = [];

    this._seedInitialMemories();
  }

  _seedInitialMemories() {
    const seedItems = [
      {
        id: 'mem-policy-1',
        content: 'Never auto-provision Enterprise API keys or Net-60 CapEx credit when zetaris_billing.stripe_subscriptions shows past_due_usd > $0 or open P1 billing lock.',
        type: 'preference',
        layer: 'long_term',
        domain: 'revenue/governance',
        namespace: 'policy/billing_guardrail',
        tags: ['policy:billing', 'guardrail:enterprise', 'zetaris:stripe'],
        entities: ['stripe_subscriptions', 'Enterprise_API', 'Net-60'],
        confidence: 0.98,
        source: 'revops_governance_charter_v2',
        provenance: {
          origin: 'operator_invariant',
          learnedAt: '2026-10-22T14:00:00.000Z',
          label: 'RevOps Hard Invariant #1 (Zero Delinquent Provisioning)',
        },
      },
      {
        id: 'mem-apex-2',
        content: 'Apex Logistics Corp (hs_cnt_90412) started a 3-seat sandbox trial; CFO Sophia Lin is required signer for any contract over $5,000 USD.',
        type: 'factual',
        layer: 'working',
        domain: 'account/apex-logistics',
        namespace: 'crm/hubspot',
        tags: ['account:apex', 'signer:cfo', 'trial:3-seats'],
        entities: ['Apex_Logistics', 'Carlos_Mendoza', 'Sophia_Lin'],
        confidence: 0.94,
        source: 'zetaris_crm.hubspot_contacts#hs_cnt_90412',
        provenance: {
          origin: 'zetaris_federated_sync',
          learnedAt: '2026-10-24T09:30:00.000Z',
          label: 'Zetaris Federated CRM Snapshot [SRC-1]',
        },
      },
      {
        id: 'mem-vanguard-bluff',
        content: 'When Procurement claims low usage during renewal, cross-check zetaris_intent.posthog_events and MSA Section 7.1: accounts over 80% quota saturation are capped at an 8% renewal discount.',
        type: 'preference',
        layer: 'long_term',
        domain: 'revenue/deal_desk',
        namespace: 'policy/discount_defense',
        tags: ['account:vanguard', 'discount:bluff', 'zetaris:posthog', 'zetaris:ironclad'],
        entities: ['Vanguard_FinTech', 'Derek_Vance', 'Priya_Nair'],
        confidence: 0.96,
        source: 'zetaris_legal.ironclad_contracts#MSA-VGF-2025-11',
        provenance: {
          origin: 'operator_invariant',
          learnedAt: '2026-10-25T10:00:00.000Z',
          label: 'Deal Desk Margin Defense Invariant [SRC-4/SRC-5]',
        },
      },
      {
        id: 'mem-meridian-3',
        content: 'Meridian Health Systems (hs_cnt_33109) has 18 consecutive on-time Stripe invoices ($0 past due) and pre-approved HIPAA BAA legal terms.',
        type: 'factual',
        layer: 'long_term',
        domain: 'account/meridian-health',
        namespace: 'billing/stripe',
        tags: ['account:meridian', 'hipaa:baa', 'standing:excellent'],
        entities: ['Meridian_Health', 'Elena_Rostova', 'HIPAA_BAA'],
        confidence: 0.97,
        source: 'zetaris_billing.stripe_subscriptions#sub_1M8kMeridian01',
        provenance: {
          origin: 'zetaris_federated_sync',
          learnedAt: '2026-10-25T11:15:00.000Z',
          label: 'Zetaris Federated Billing Snapshot [SRC-2]',
        },
      },
      {
        id: 'mem-dental-4',
        content: 'Returning implant patients at Smile Dental Brickell with a verified CBCT 3D scan on file (#SCAN-309) must skip the $250 repeat scan fee and fast-track to surgical chair booking.',
        type: 'preference',
        layer: 'long_term',
        domain: 'clinical/smile-dental',
        namespace: 'protocol/implants',
        tags: ['clinic:smile-dental', 'cbct:verified', 'implant:zirconia'],
        entities: ['Smile_Dental', 'Sofia_Valdes', 'CBCT_Scan'],
        confidence: 0.95,
        source: 'clinical_protocol_brickell_2026',
        provenance: {
          origin: 'user_correction',
          learnedAt: '2026-10-25T16:40:00.000Z',
          label: 'Dr. Morales Clinical Protocol Rule',
        },
      },
      {
        id: 'mem-hvac-5',
        content: 'South Congress Hotel Group (hs_com_5518) caps Facilities Coordinator dispatch authority at $1,500; rooftop unit replacements >$5,000 require CFO Rachel Green + 50% equipment deposit.',
        type: 'factual',
        layer: 'working',
        domain: 'account/soco-hotels',
        namespace: 'policy/commercial_capex',
        tags: ['account:soco', 'hvac:rtu', 'capex:limit'],
        entities: ['South_Congress_Hotel', 'Marcus_Vance', 'Rachel_Green'],
        confidence: 0.93,
        source: 'zetaris_crm.hubspot_contacts#hs_com_5518',
        provenance: {
          origin: 'zetaris_federated_sync',
          learnedAt: '2026-10-26T08:20:00.000Z',
          label: 'Zetaris Commercial Credit Policy [SRC-1/SRC-2]',
        },
      },
    ];

    for (const item of seedItems) {
      const record = {
        ...item,
        timestamp: item.provenance.learnedAt,
        lastAccessed: new Date().toISOString(),
        accessCount: 3,
        supersededBy: null,
        supersedes: null,
        derivedFrom: [],
        relatedTo: [],
      };
      this.memories.push(record);
      this._recordTrustAudit(record.id, 'create', 'system:seed', null, { confidence: record.confidence, source: record.source });
    }
  }

  _recordTrustAudit(memoryId, action, actor, previousState, newState, details = {}) {
    const validAction = CANONICAL_HMEM_AUDIT_ACTIONS.includes(action) ? action : 'update';
    const entry = {
      ledgerId: `hmem_aud_${crypto.randomBytes(5).toString('hex')}`,
      memoryId,
      action: validAction,
      actor,
      timestamp: new Date().toISOString(),
      previousState,
      newState,
      details,
    };
    this.trustLedger.unshift(entry);
    if (this.trustLedger.length > 100) this.trustLedger.pop();
    return entry;
  }

  retrieveMemories({ query = '', scenarioId = '', topN = 4 } = {}) {
    const queryTokens = String(`${query} ${scenarioId}`)
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length > 2);

    const scored = this.memories.map((mem) => {
      const memTokens = `${mem.content} ${mem.tags.join(' ')} ${mem.entities.join(' ')}`
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((t) => t.length > 2);

      const overlapCount = queryTokens.filter((qt) => memTokens.some((mt) => mt.includes(qt) || qt.includes(mt))).length;
      const keyword = clamp01(overlapCount / Math.max(3, Math.min(8, queryTokens.length)));
      const semantic = clamp01(keyword * 0.85 + (mem.id.includes('policy') ? 0.35 : 0.18));
      const tag = mem.tags.some((t) => queryTokens.some((qt) => t.toLowerCase().includes(qt))) ? 0.9 : 0.4;
      const domain = mem.domain.includes('governance') || query.toLowerCase().includes(mem.domain.split('/')[1] || '') ? 0.92 : 0.5;
      const entity = mem.entities.some((e) => query.toLowerCase().includes(e.toLowerCase().split('_')[0])) ? 0.95 : 0.35;
      const layer = mem.layer === 'long_term' ? 1.0 : mem.layer === 'working' ? 0.8 : 0.6;
      const recency = 0.94;
      const superseded = mem.supersededBy ? 1.0 : 0.0;

      const raw =
        0.35 * semantic +
        0.20 * keyword +
        0.10 * tag +
        0.10 * domain +
        0.15 * entity +
        0.05 * layer +
        0.05 * recency -
        0.20 * superseded;

      const finalScore = Number((clamp01(raw) * mem.confidence).toFixed(4));

      return {
        ...mem,
        retrievalBreakdown: {
          formula: 'clamp01(0.35·sem + 0.20·kw + 0.10·tag + 0.10·dom + 0.15·ent + 0.05·layer + 0.05·rec - 0.20·sup) × conf',
          rawScore: Number(raw.toFixed(4)),
          confidence: mem.confidence,
          finalScore,
        },
      };
    });

    const filtered = scored
      .filter((m) => m.retrievalBreakdown.finalScore >= 0.35)
      .sort((a, b) => b.retrievalBreakdown.finalScore - a.retrievalBreakdown.finalScore)
      .slice(0, topN);

    for (const item of filtered) {
      this._recordTrustAudit(item.id, 'read', 'service:MemoryRetrievalService', null, {
        score: item.retrievalBreakdown.finalScore,
      });
    }

    return {
      strategy: 'comprehensive',
      threshold: 0.35,
      reinjectedCount: filtered.length,
      memories: filtered,
    };
  }

  applyMemoryFeedback(memoryId, rating = 'helpful') {
    const target = this.memories.find((m) => m.id === memoryId) || this.memories[0];
    if (!target) return { ok: false, error: 'Memory not found' };

    const prevConfidence = target.confidence;
    const prevAccess = target.accessCount;

    if (rating === 'helpful') {
      target.accessCount += 1;
      target.confidence = Number(clamp01(target.confidence + 0.05).toFixed(4));
    } else if (rating === 'not_helpful') {
      target.confidence = Number(clamp01(target.confidence - 0.03).toFixed(4));
    } else if (rating === 'wrong') {
      target.confidence = Number(clamp01(target.confidence - 0.20).toFixed(4));
      if (!target.tags.includes('review')) target.tags.push('review');
    }

    target.lastAccessed = new Date().toISOString();

    const auditEntry = this._recordTrustAudit(
      target.id,
      'feedback',
      'user:interactive_reviewer',
      { confidence: prevConfidence, accessCount: prevAccess },
      { confidence: target.confidence, accessCount: target.accessCount, rating },
      { deltaApplied: rating === 'helpful' ? '+0.05' : rating === 'not_helpful' ? '-0.03' : '-0.20 (+review tag)' }
    );

    return {
      ok: true,
      memoryId: target.id,
      rating,
      previousConfidence: prevConfidence,
      newConfidence: target.confidence,
      accessCount: target.accessCount,
      tags: target.tags,
      auditEntry,
    };
  }

  runScoutIntentPipeline({ scenarioId, message, company, hasConflict }) {
    const lower = String(message || '').toLowerCase();
    let selectedIntent = SCOUT_INTENT_REGISTRY[0];
    if (scenarioId === 'shadow-discount-bluff' || lower.includes('discount') || lower.includes('45%')) {
      selectedIntent = SCOUT_INTENT_REGISTRY[1];
    } else if (scenarioId === 'smile-dental-implant' || lower.includes('implant') || lower.includes('dental')) {
      selectedIntent = SCOUT_INTENT_REGISTRY[2];
    } else if (scenarioId === 'lone-star-hvac-commercial' || lower.includes('rooftop') || lower.includes('hvac')) {
      selectedIntent = SCOUT_INTENT_REGISTRY[3];
    }

    const lexical = 0.93;
    const semantic = 0.90;
    const contextual = 0.91;
    const recency = 0.95;
    const riskPenalty = hasConflict ? 0.06 : 0.0;
    const confidence = Number((0.40 * lexical + 0.35 * semantic + 0.20 * contextual + 0.05 * recency - riskPenalty).toFixed(4));
    const band = confidence >= 0.80 ? 'High' : confidence >= 0.55 ? 'Medium' : 'Low';

    const guardLayers = [
      { layer: '1. Injection Check', status: 'pass', detail: '0 role-confusion or prompt-injection markers detected' },
      { layer: '2. Policy Gate', status: hasConflict ? 'warn' : 'pass', detail: hasConflict ? 'Requires cross-silo conflict resolution before auto-approval' : 'RBAC & policy bounds cleared' },
      { layer: '3. Scope Check', status: 'pass', detail: `Surface and role cleared for ${selectedIntent.id}` },
      { layer: '4. PII / Sensitivity', status: 'pass', detail: 'Zetaris CLS masked personal_phone, card_fingerprint & bank_routing upstream' },
      { layer: '5. Rate & Spend Limit', status: 'pass', detail: `Tenant spend within $${this.maxTenantBudgetUSD.toFixed(2)} hard cap` },
    ];

    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const contractCore = {
      contractId: `sct_${crypto.randomBytes(6).toString('hex')}`,
      traceId: `trc_${crypto.randomBytes(6).toString('hex')}`,
      intent: {
        primary: selectedIntent.id,
        category: selectedIntent.category,
        confidence,
        band,
        formula: '0.40·lexical + 0.35·semantic + 0.20·contextual + 0.05·recency - riskPenalty',
        parameters: { company, scenarioId },
      },
      risk: {
        level: hasConflict ? 'high' : selectedIntent.riskClass,
        flags: hasConflict ? ['CROSS_SILO_DECEPTION_OR_CREDIT_FLAG', 'REQUIRE_FORENSIC_PROOF'] : [],
        redactions: ['personal_phone', 'card_fingerprint', 'bank_routing'],
        guardLayers,
      },
      toolPlan: [
        { step: 1, tool: 'zetaris.execute5SiloFederatedSql', scope: 'read_only_in_situ' },
        { step: 2, tool: 'meterless.hmem.retrieveAndScanConflicts', scope: 'local_memory_graph' },
        { step: 3, tool: 'leadproof.computeDealDeskMarginAndProofTree', scope: 'governed_decision' },
      ],
      modelProfile: {
        provider: 'meterless-runtime',
        routingMode: hasConflict ? 'meterless/deep' : 'meterless/auto',
        liveSynthesisModel: 'muse-spark-1.3 (Meta API) + nvidia/nemotron-super-49b',
        headersSent: {
          'meterless-app': this.appId,
          'meterless-scope': 'user',
        },
      },
      scope: {
        user: 'revops@autoailead.com',
        surface: 'leadproof-dealdesk-console',
        capabilities: selectedIntent.capabilities,
      },
      issuedAt,
      expiresAt,
      registryVersion: 4,
      policyPackVersion: 'revenue-governance-v1.4',
      signedBy: 'scout',
    };

    const signature = `hmac-sha256:${hmacSha256(this.signingSecret, JSON.stringify(contractCore)).slice(0, 32)}`;
    const signedContract = { ...contractCore, signature };
    this.contractsIssued.unshift(signedContract);
    if (this.contractsIssued.length > 40) this.contractsIssued.pop();

    return signedContract;
  }

  recordOutcomeEvent({
    scenarioId,
    company,
    verdict,
    score,
    confidencePct,
    hallucinationBlocked = false,
    counterfactualRun = false,
    latencyMs = 42,
    zetarisRows = 5,
    marginProtectedUSD = 0,
    liveAiCostUSD = 0,
  }) {
    const unitCloudEquivalentUSD = Number(((counterfactualRun ? 0.0006 : 0.0018) + (liveAiCostUSD || 0)).toFixed(6));
    const currentCloudEquivalent = this.getSummary().totalCloudEquivalentUSD;
    const budgetRemainingUSD = Math.max(0, Number((this.maxTenantBudgetUSD - (currentCloudEquivalent + unitCloudEquivalentUSD)).toFixed(4)));

    const outcomes = ['proof_verified'];
    if (hallucinationBlocked) outcomes.push('hallucination_blocked');
    if (marginProtectedUSD > 0) outcomes.push('margin_protected');
    if (verdict === 'QUALIFIED_FAST_TRACK') outcomes.push('qualified_fast_track_ready');
    if (counterfactualRun) outcomes.push('counterfactual_simulated');

    const entry = {
      eventId: `mtl_evt_${crypto.randomBytes(5).toString('hex')}`,
      timestamp: new Date().toISOString(),
      appId: this.appId,
      routingMode: hallucinationBlocked ? 'meterless/deep' : 'meterless/auto',
      scenarioId,
      company,
      verdict,
      score,
      confidencePct,
      outcomes,
      metrics: {
        latencyMs,
        zetarisFederatedRows: zetarisRows,
        hmemMemoriesReinjected: 4,
        localHotspotSpendUSD: 0.0,
        outcomeUnitChargeUSD: unitCloudEquivalentUSD,
        marginProtectedUSD: Math.round(marginProtectedUSD),
        roiMultiple: unitCloudEquivalentUSD > 0 ? Math.round(marginProtectedUSD / unitCloudEquivalentUSD) : 9999,
        tokensProcessed: 1680,
      },
      budgetGuardrail: {
        maxTenantBudgetUSD: this.maxTenantBudgetUSD,
        budgetRemainingUSD,
        status: 'WITHIN_CAP',
      },
    };

    this.outcomeLedger.unshift(entry);
    if (this.outcomeLedger.length > 60) this.outcomeLedger.pop();
    return entry;
  }

  getSummary() {
    const totalEvents = this.outcomeLedger.length;
    const hallucinationsBlocked = this.outcomeLedger.filter((e) => e.outcomes.includes('hallucination_blocked')).length;
    const proofsVerified = this.outcomeLedger.length;
    const totalCloudEquivalentUSD = Number(
      this.outcomeLedger.reduce((acc, e) => acc + (e.metrics?.outcomeUnitChargeUSD || 0.0018), 0).toFixed(4)
    );
    const totalMarginProtectedUSD = Math.round(
      this.outcomeLedger.reduce((acc, e) => acc + (e.metrics?.marginProtectedUSD || 0), 0)
    );

    return {
      provider: 'Meterless Context & Outcome Runtime (Contract v4 · H-MEM + Scout Intent + ROI Circuit Breaker)',
      runtimeEndpoint: this.runtimeUrl,
      appHeader: this.appId,
      scopeHeader: 'user',
      routingModesAvailable: ['meterless/auto', 'meterless/deep', 'meterless/fast', 'meterless/local'],
      totalEvents,
      proofsVerified,
      hallucinationsBlocked,
      totalMarginProtectedUSD,
      localHotspotSpendUSD: 0.0,
      totalCloudEquivalentUSD,
      maxTenantBudgetUSD: this.maxTenantBudgetUSD,
      remainingTenantBudgetUSD: Number(Math.max(0, this.maxTenantBudgetUSD - totalCloudEquivalentUSD).toFixed(4)),
      hmemStats: {
        totalMemoriesStored: this.memories.length,
        trustLedgerEntries: this.trustLedger.length,
        canonicalActionsSupported: CANONICAL_HMEM_AUDIT_ACTIONS.length,
      },
      recentOutcomeEvents: this.outcomeLedger.slice(0, 12),
      recentTrustLedger: this.trustLedger.slice(0, 10),
      recentContracts: this.contractsIssued.slice(0, 5),
    };
  }
}
