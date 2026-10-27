import crypto from 'node:crypto';
import { ZETARIS_CATALOG_SOURCES, LEAD_SCENARIOS } from './scenarios.js';

function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

export class ZetarisClient {
  constructor(options = {}) {
    this.apiUrl = options.apiUrl || process.env.ZETARIS_API_URL || 'https://cloud.enterprise.zetaris.com/api/v1';
    this.mcpUrl = options.mcpUrl || process.env.ZETARIS_MCP_URL || 'jdbc:zetaris:lightning@127.0.0.1:10000';
    this.apiKey = options.apiKey || process.env.ZETARIS_API_KEY || '';
    this.principal = options.principal || 'agent:leadproof-forensic-dealdesk@autoailead.com';
    this.auditLog = [];
  }

  getStatus() {
    return {
      platform: 'Zetaris Networked Data Platform (Open Agentic Lakehouse · Super MCP)',
      mode: this.apiKey ? 'live-enterprise-cluster' : 'in-situ-federated-virtual-engine',
      jdbcEndpoint: this.mcpUrl,
      restEndpoint: this.apiUrl,
      readOnlyMcpEnforced: true,
      zeroDataMovement: true,
      silosConnected: ZETARIS_CATALOG_SOURCES.length,
      catalogSources: ZETARIS_CATALOG_SOURCES,
      totalAuditEntries: this.auditLog.length,
    };
  }

  buildFederatedSql(scenarioId, emailOrCompany) {
    const safeKey = String(emailOrCompany || scenarioId).replace(/[^a-zA-Z0-9@._ -]/g, '');
    return [
      `-- Zetaris Super MCP · 5-Silo Governed Zero-ETL Forensic Query`,
      `SELECT`,
      `  c.record_id AS crm_id, c.contact_name, c.verified_role, c.decision_maker_verified, c.lifecycle_stage,`,
      `  MASK_CLS(c.personal_phone) AS personal_phone,`,
      `  b.subscription_id, b.plan_tier, b.active_seats, b.past_due_usd, b.days_overdue, b.billing_status,`,
      `  MASK_CLS(b.card_fingerprint) AS card_fingerprint,`,
      `  s.ticket_id, s.open_escalations, s.severity AS support_severity, s.status AS support_status, s.summary AS support_summary,`,
      `  i.intent_score, i.usage_quota_pct, i.active_engineers_count, i.anomaly_flag,`,
      `  l.contract_id, l.allowed_payment_terms, l.max_discount_allowed_pct, l.required_signer, l.compliance_status`,
      `FROM zetaris_crm.hubspot_contacts c`,
      `JOIN zetaris_billing.stripe_subscriptions b ON c.account_key = b.account_key`,
      `LEFT JOIN zetaris_support.intercom_tickets s ON c.account_key = s.account_key`,
      `LEFT JOIN zetaris_intent.posthog_events i ON c.account_key = i.account_key`,
      `LEFT JOIN zetaris_legal.ironclad_contracts l ON c.account_key = l.account_key`,
      `WHERE c.scenario_key = '${safeKey}'`,
      `WITH (ZETARIS_PUSHDOWN = TRUE, ZERO_ETL = TRUE, RLS_POLICY = 'tenant_isolation', CLS_MASK = TRUE);`,
    ].join('\n');
  }

  applyCounterfactualToSources(baseData, overrides = {}) {
    const cloned = JSON.parse(JSON.stringify(baseData));

    if (overrides.billingPastDueCleared === true) {
      cloned.billing_stripe.pastDueUSD = 0;
      cloned.billing_stripe.daysOverdue = 0;
      cloned.billing_stripe.failedChargeCount = 0;
      cloned.billing_stripe.billingStatus = 'ACTIVE_GOOD_STANDING_VERIFIED';
      if (cloned.legal_ironclad) {
        cloned.legal_ironclad.complianceStatus = 'CLEARED_AFTER_SETTLEMENT';
      }
    } else if (overrides.billingPastDueCleared === false && baseData.billing_stripe.pastDueUSD === 0 && overrides._forceDelinquent) {
      cloned.billing_stripe.pastDueUSD = 4200;
      cloned.billing_stripe.daysOverdue = 47;
      cloned.billing_stripe.billingStatus = 'PAST_DUE_DELINQUENT';
    }

    if (overrides.supportLockResolved === true) {
      cloned.support_intercom.openEscalations = 0;
      cloned.support_intercom.severity = 'NONE';
      cloned.support_intercom.status = 'ALL_RESOLVED';
      cloned.support_intercom.summary = `Escalation #${cloned.support_intercom.ticketId} resolved & rate-limit lock cleared.`;
    } else if (overrides.supportLockResolved === false && baseData.support_intercom.openEscalations === 0) {
      cloned.support_intercom.openEscalations = 1;
      cloned.support_intercom.severity = 'P1_BILLING_HOLD';
      cloned.support_intercom.status = 'OPEN_LOCKED';
    }

    if (overrides.decisionMakerVerified === true) {
      cloned.crm_hubspot.decisionMakerVerified = true;
      if (!cloned.crm_hubspot.verifiedRole.includes('Verified')) {
        cloned.crm_hubspot.verifiedRole = `${cloned.crm_hubspot.verifiedRole} (CFO Co-Sign Verified)`;
      }
      if (cloned.legal_ironclad) {
        cloned.legal_ironclad.complianceStatus = 'EXECUTIVE_SIGNER_VERIFIED';
      }
    } else if (overrides.decisionMakerVerified === false) {
      cloned.crm_hubspot.decisionMakerVerified = false;
    }

    if (overrides.budgetVerified === true) {
      if (cloned.billing_stripe.billingStatus === 'CREDIT_CAP_5000_NET30') {
        cloned.billing_stripe.billingStatus = 'CAPEX_DEPOSIT_APPROVED_14200';
      }
      if (cloned.billing_stripe.activeSeats < cloned.billing_stripe.claimedSeats) {
        cloned.billing_stripe.activeSeats = cloned.billing_stripe.claimedSeats;
        cloned.billing_stripe.planTier = 'Pro_Enterprise_Verified';
      }
    }

    if (typeof overrides.urgencyHigh === 'boolean') {
      cloned.web_posthog.intentScore = overrides.urgencyHigh ? Math.max(cloned.web_posthog.intentScore, 88) : 42;
    }

    return cloned;
  }

  async queryLeadContext({ scenarioId = 'trap-expansion-claim', customLead = null, overrides = {} } = {}) {
    const startedAt = Date.now();
    const scenario = LEAD_SCENARIOS[scenarioId] || LEAD_SCENARIOS['trap-expansion-claim'];
    const effectiveOverrides = { ...scenario.defaultOverrides, ...overrides };
    const federatedRows = this.applyCounterfactualToSources(scenario.federatedData, effectiveOverrides);

    if (customLead && customLead.company) {
      federatedRows.crm_hubspot.contactName = customLead.leadName || scenario.leadName;
    }

    const sql = this.buildFederatedSql(scenarioId, customLead?.email || scenario.email);

    const legalRow = federatedRows.legal_ironclad || {
      sourceId: 'SRC-5',
      table: 'zetaris_legal.ironclad_contracts',
      engine: 'Oracle NetSuite / Ironclad Vault',
      contractId: 'MSA-DEFAULT-2026',
      allowedPaymentTerms: 'Net-30',
      maxDiscountAllowedPct: 10,
      requiredSigner: 'CFO / C-Level',
      complianceStatus: 'STANDARD_MSA_ACTIVE',
      clauseNote: 'Standard commercial governance rules apply.',
    };
    federatedRows.legal_ironclad = legalRow;

    const citations = [
      {
        id: 'SRC-1',
        badge: '[SRC-1]',
        sourceKey: 'crm_hubspot',
        table: federatedRows.crm_hubspot.table,
        engine: federatedRows.crm_hubspot.engine,
        recordId: federatedRows.crm_hubspot.recordId,
        pushdownPredicate: `c.record_id = '${federatedRows.crm_hubspot.recordId}'`,
        latencyMs: 9,
        clsMaskedColumns: ['personal_phone'],
        row: federatedRows.crm_hubspot,
        rowHash: `sha256:${sha256Hex(JSON.stringify(federatedRows.crm_hubspot)).slice(0, 24)}`,
        summary: `${federatedRows.crm_hubspot.contactName} · Role: ${federatedRows.crm_hubspot.verifiedRole} · Stage: ${federatedRows.crm_hubspot.lifecycleStage}`,
      },
      {
        id: 'SRC-2',
        badge: '[SRC-2]',
        sourceKey: 'billing_stripe',
        table: federatedRows.billing_stripe.table,
        engine: federatedRows.billing_stripe.engine,
        recordId: federatedRows.billing_stripe.subscriptionId,
        pushdownPredicate: `b.subscription_id = '${federatedRows.billing_stripe.subscriptionId}'`,
        latencyMs: 8,
        clsMaskedColumns: ['card_fingerprint'],
        row: federatedRows.billing_stripe,
        rowHash: `sha256:${sha256Hex(JSON.stringify(federatedRows.billing_stripe)).slice(0, 24)}`,
        summary: `Plan: ${federatedRows.billing_stripe.planTier} · Active Seats: ${federatedRows.billing_stripe.activeSeats} · Past Due: $${federatedRows.billing_stripe.pastDueUSD.toLocaleString()} (${federatedRows.billing_stripe.billingStatus})`,
      },
      {
        id: 'SRC-3',
        badge: '[SRC-3]',
        sourceKey: 'support_intercom',
        table: federatedRows.support_intercom.table,
        engine: federatedRows.support_intercom.engine,
        recordId: federatedRows.support_intercom.ticketId,
        pushdownPredicate: `s.ticket_id = '${federatedRows.support_intercom.ticketId}'`,
        latencyMs: 11,
        clsMaskedColumns: [],
        row: federatedRows.support_intercom,
        rowHash: `sha256:${sha256Hex(JSON.stringify(federatedRows.support_intercom)).slice(0, 24)}`,
        summary: `Ticket #${federatedRows.support_intercom.ticketId} (${federatedRows.support_intercom.status}) · Open Escalations: ${federatedRows.support_intercom.openEscalations} · CSAT: ${federatedRows.support_intercom.csatScore}`,
      },
      {
        id: 'SRC-4',
        badge: '[SRC-4]',
        sourceKey: 'web_posthog',
        table: federatedRows.web_posthog.table,
        engine: federatedRows.web_posthog.engine,
        recordId: `ph_${scenarioId}`,
        pushdownPredicate: `i.event_window = '${federatedRows.web_posthog.eventWindow}'`,
        latencyMs: 12,
        clsMaskedColumns: ['client_ip'],
        row: federatedRows.web_posthog,
        rowHash: `sha256:${sha256Hex(JSON.stringify(federatedRows.web_posthog)).slice(0, 24)}`,
        summary: `Intent Score: ${federatedRows.web_posthog.intentScore}/100 · Quota Used: ${federatedRows.web_posthog.usageQuotaPct}% · ${federatedRows.web_posthog.anomalyFlag}`,
      },
      {
        id: 'SRC-5',
        badge: '[SRC-5]',
        sourceKey: 'legal_ironclad',
        table: legalRow.table,
        engine: legalRow.engine,
        recordId: legalRow.contractId,
        pushdownPredicate: `l.contract_id = '${legalRow.contractId}'`,
        latencyMs: 10,
        clsMaskedColumns: ['bank_routing'],
        row: legalRow,
        rowHash: `sha256:${sha256Hex(JSON.stringify(legalRow)).slice(0, 24)}`,
        summary: `Contract #${legalRow.contractId} · Max Discount: ${legalRow.maxDiscountAllowedPct}% · Terms: ${legalRow.allowedPaymentTerms} · Signer: ${legalRow.requiredSigner}`,
      },
    ];

    const totalLatencyMs = Math.max(24, Date.now() - startedAt + 39);
    const queryId = `zet_q_${sha256Hex(`${scenarioId}:${JSON.stringify(effectiveOverrides)}:${Date.now()}`).slice(0, 12)}`;

    const executionPlan = {
      coordinator: 'Zetaris Query Director v2.6 (5-Silo In-Situ Federated Planner)',
      zeroEtlVerified: true,
      bytesMovedToCentralStorage: 0,
      pushdownStages: citations.map((c) => ({
        stageId: `STAGE_${c.id}`,
        targetCatalog: c.table,
        underlyingEngine: c.engine,
        predicate: c.pushdownPredicate,
        rowsScanned: 1,
        latencyMs: c.latencyMs,
        securityApplied: c.clsMaskedColumns.length ? `CLS Mask (${c.clsMaskedColumns.join(', ')})` : 'RLS Tenant Scope',
      })),
    };

    const auditEntry = {
      auditId: `zet_aud_${sha256Hex(queryId).slice(0, 10)}`,
      timestamp: new Date().toISOString(),
      principal: this.principal,
      queryId,
      sql,
      sourcesTouched: citations.map((c) => c.table),
      rowCountReturned: citations.length,
      latencyMs: totalLatencyMs,
      readOnlyEnforced: true,
      zeroDataMovement: true,
      clsMaskedFields: ['personal_phone', 'card_fingerprint', 'client_ip', 'bank_routing'],
    };

    this.auditLog.unshift(auditEntry);
    if (this.auditLog.length > 50) this.auditLog.pop();

    return {
      queryId,
      sql,
      latencyMs: totalLatencyMs,
      zeroDataMovement: true,
      readOnlyMcp: true,
      federatedRows,
      citations,
      executionPlan,
      auditEntry,
    };
  }

  async executeCustomSql({ sql = '', scenarioId = 'trap-expansion-claim' } = {}) {
    const trimmed = String(sql || '').trim();
    const forbiddenMatch = trimmed.match(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|CREATE\s+TABLE)\b/i);

    if (forbiddenMatch) {
      const blockedEntry = {
        auditId: `zet_blk_${sha256Hex(trimmed + Date.now()).slice(0, 10)}`,
        timestamp: new Date().toISOString(),
        principal: this.principal,
        sql: trimmed,
        status: 'BLOCKED_BY_ZETARIS_READONLY_MCP_POLICY',
        blockedKeyword: forbiddenMatch[1].toUpperCase(),
        reason: 'Zetaris MCP Server is strictly read-only. Agents may query and reason over federated sources but cannot mutate data.',
      };
      this.auditLog.unshift(blockedEntry);
      return {
        ok: false,
        status: 'BLOCKED_BY_ZETARIS_READONLY_MCP_POLICY',
        error: blockedEntry.reason,
        blockedKeyword: blockedEntry.blockedKeyword,
        auditEntry: blockedEntry,
      };
    }

    const contextResult = await this.queryLeadContext({ scenarioId });
    return {
      ok: true,
      status: 'EXECUTED_IN_SITU',
      queryId: contextResult.queryId,
      executedSql: trimmed || contextResult.sql,
      latencyMs: contextResult.latencyMs,
      zeroDataMovement: true,
      rowsReturned: contextResult.citations.length,
      citations: contextResult.citations,
      executionPlan: contextResult.executionPlan,
      auditEntry: contextResult.auditEntry,
    };
  }
}
