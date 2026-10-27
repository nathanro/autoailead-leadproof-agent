import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoreServices, handleApiRequest } from '../src/server.js';
import { normalizeMeterlessUrl } from '../src/meterlessClient.js';

test('Meterless URL normalizer follows Contract v4 without producing /v1/v1', () => {
  assert.equal(normalizeMeterlessUrl('127.0.0.1:8088'), 'http://127.0.0.1:8088/v1');
  assert.equal(normalizeMeterlessUrl('http://127.0.0.1:8088/v1'), 'http://127.0.0.1:8088/v1');
  assert.equal(normalizeMeterlessUrl('http://127.0.0.1:8088/v1/chat/completions'), 'http://127.0.0.1:8088/v1');
  assert.equal(normalizeMeterlessUrl('http://localhost:8090/healthz'), 'http://localhost:8090/v1');
});

test('GET /api/health and GET /api/scenarios return 5 Zetaris silos and 5 pre-loaded scenarios', async () => {
  const services = createCoreServices();
  const health = await handleApiRequest({ method: 'GET', pathname: '/api/health', services });
  assert.equal(health.status, 200);
  assert.equal(health.payload.status, 'ok');
  assert.equal(health.payload.zetaris.readOnlyMcpEnforced, true);
  assert.equal(health.payload.zetaris.silosConnected, 5);

  const scenarios = await handleApiRequest({ method: 'GET', pathname: '/api/scenarios', services });
  assert.equal(scenarios.status, 200);
  assert.equal(scenarios.payload.scenarios.length, 5);
  assert.equal(scenarios.payload.catalogSources.length, 5);
});

test('POST /api/evaluate catches Billing Conflict Trap andPOST /api/counterfactual flips verdict to QUALIFIED_FAST_TRACK', async () => {
  const services = createCoreServices();

  // 1. Default trap case should be blocked due to $4,200 overdue & P1 support lock
  const trapRes = await handleApiRequest({
    method: 'POST',
    pathname: '/api/evaluate',
    body: { scenarioId: 'trap-expansion-claim' },
    services,
  });
  assert.equal(trapRes.status, 200);
  assert.equal(trapRes.payload.decision.verdict, 'HOLD_CONFLICT_DETECTED');
  assert.equal(trapRes.payload.decision.hallucinationBlocked, true);
  assert.ok(trapRes.payload.conflicts.length >= 3);
  assert.equal(trapRes.payload.citations.length, 5);
  assert.ok(trapRes.payload.dealDeskEconomics.marginProtectedUSD >= 24000);

  // 2. Counterfactual simulation: clearing billing, resolving support lock, verifying signer & budget, and setting 0% discount flips to QUALIFIED_FAST_TRACK
  const cfRes = await handleApiRequest({
    method: 'POST',
    pathname: '/api/counterfactual',
    body: {
      scenarioId: 'trap-expansion-claim',
      overrides: {
        billingPastDueCleared: true,
        supportLockResolved: true,
        decisionMakerVerified: true,
        budgetVerified: true,
        urgencyHigh: true,
        proposedDiscountPct: 0,
      },
    },
    services,
  });
  assert.equal(cfRes.status, 200);
  assert.equal(cfRes.payload.verdictFlipped, true);
  assert.equal(cfRes.payload.simulated.decision.verdict, 'QUALIFIED_FAST_TRACK');
  assert.ok(cfRes.payload.scoreDelta > 30);
});

test('Shadow-Usage Procurement Bluff scenario detects 98.4% engineering saturation and blocks 45% discount give-away', async () => {
  const services = createCoreServices();
  const bluffRes = await handleApiRequest({
    method: 'POST',
    pathname: '/api/evaluate',
    body: {
      scenarioId: 'shadow-discount-bluff',
      overrides: { proposedDiscountPct: 45 },
    },
    services,
  });
  assert.equal(bluffRes.status, 200);
  assert.ok(bluffRes.payload.conflicts.some((c) => c.conflictId === 'CONF-SHADOW-USAGE-BLUFF'));
});

test('POST /api/zetaris/query enforces read-only MCP governance and blocks SQL mutations', async () => {
  const services = createCoreServices();

  const validQuery = await handleApiRequest({
    method: 'POST',
    pathname: '/api/zetaris/query',
    body: {
      scenarioId: 'b2b-saas-expansion',
      sql: 'SELECT * FROM zetaris_crm.hubspot_contacts JOIN zetaris_billing.stripe_subscriptions USING (account_key);',
    },
    services,
  });
  assert.equal(validQuery.status, 200);
  assert.equal(validQuery.payload.ok, true);
  assert.equal(validQuery.payload.zeroDataMovement, true);
  assert.equal(validQuery.payload.rowsReturned, 5);

  const blockedMutation = await handleApiRequest({
    method: 'POST',
    pathname: '/api/zetaris/query',
    body: {
      scenarioId: 'trap-expansion-claim',
      sql: 'UPDATE zetaris_billing.stripe_subscriptions SET past_due_usd = 0 WHERE subscription_id = "sub_1";',
    },
    services,
  });
  assert.equal(blockedMutation.status, 403);
  assert.equal(blockedMutation.payload.ok, false);
  assert.equal(blockedMutation.payload.status, 'BLOCKED_BY_ZETARIS_READONLY_MCP_POLICY');
});

test('POST /api/meterless/feedback applies canonical H-MEM confidence deltas and logs to TrustLedgerService', async () => {
  const services = createCoreServices();
  const fbRes = await handleApiRequest({
    method: 'POST',
    pathname: '/api/meterless/feedback',
    body: { memoryId: 'mem-apex-2', rating: 'helpful' },
    services,
  });
  assert.equal(fbRes.status, 200);
  assert.equal(fbRes.payload.ok, true);
  assert.ok(fbRes.payload.newConfidence >= fbRes.payload.previousConfidence);
  assert.equal(fbRes.payload.auditEntry.action, 'feedback');
});

test('POST /api/closer/objection and POST /api/closer/checkout complete full-cycle objection rebuttal & payment close', async () => {
  const services = createCoreServices();
  const objRes = await handleApiRequest({
    method: 'POST',
    pathname: '/api/closer/objection',
    body: { scenarioId: 'shadow-discount-bluff', objectionType: 'competitor_price' },
    services,
  });
  assert.equal(objRes.status, 200);
  assert.equal(objRes.payload.ok, true);
  assert.ok(objRes.payload.checkoutOffer.finalContractPriceUSD > 0);

  const payRes = await handleApiRequest({
    method: 'POST',
    pathname: '/api/closer/checkout',
    body: {
      scenarioId: 'shadow-discount-bluff',
      quoteId: objRes.payload.quoteId,
      amountPaidUSD: objRes.payload.checkoutOffer.dueTodayUSD,
      finalContractPriceUSD: objRes.payload.checkoutOffer.finalContractPriceUSD,
      company: 'Vanguard FinTech Holdings',
    },
    services,
  });
  assert.equal(payRes.status, 200);
  assert.equal(payRes.payload.status, 'DEAL_CLOSED_AND_PAID');
  assert.ok(payRes.payload.meterlessReceipt.outcomes.includes('deal_closed_revenue'));
});

test('Dynamic claim extraction parses edited seat/discount claims and enforces 0% MSA floor on Apex Logistics', async () => {
  const services = createCoreServices();

  // 1. Verify 0% MSA floor on Apex Logistics closer quote (not 8%)
  const apexCloser = await handleApiRequest({
    method: 'POST',
    pathname: '/api/closer/objection',
    body: { scenarioId: 'trap-expansion-claim', objectionType: 'competitor_price' },
    services,
  });
  assert.equal(apexCloser.status, 200);
  assert.equal(apexCloser.payload.checkoutOffer.authorizedDiscountPct, 0);
  assert.equal(apexCloser.payload.checkoutOffer.finalContractPriceUSD, 24000);

  // 2. Editing message to "3 active Pro seats" clears CONF-SEAT-DECEPTION and marks claim_seats as verified
  const threeSeatsRes = await handleApiRequest({
    method: 'POST',
    pathname: '/api/evaluate',
    body: {
      scenarioId: 'trap-expansion-claim',
      customLead: {
        incomingMessage: 'We have 3 active Pro seats on our sandbox and want to discuss upgrading.',
      },
    },
    services,
  });
  assert.equal(threeSeatsRes.status, 200);
  assert.equal(
    threeSeatsRes.payload.conflicts.some((c) => c.conflictId === 'CONF-SEAT-DECEPTION'),
    false
  );
  const seatClaim3 = threeSeatsRes.payload.evaluatedClaims.find((c) => c.id === 'claim_seats');
  assert.equal(seatClaim3.status, 'verified');
  assert.equal(seatClaim3.claimedValue, '3 Pro seats active');

  // 3. Editing message to "200 active Pro seats" triggers CONF-SEAT-DECEPTION with 200 seats
  const twoHundredSeatsRes = await handleApiRequest({
    method: 'POST',
    pathname: '/api/evaluate',
    body: {
      scenarioId: 'trap-expansion-claim',
      customLead: {
        incomingMessage: 'We already run 200 active Pro seats with zero billing issues and want a 25% discount.',
      },
    },
    services,
  });
  assert.equal(twoHundredSeatsRes.status, 200);
  const seatConflict = twoHundredSeatsRes.payload.conflicts.find((c) => c.conflictId === 'CONF-SEAT-DECEPTION');
  assert.ok(seatConflict);
  assert.ok(seatConflict.claimInMessage.includes('200'));
  const seatClaim200 = twoHundredSeatsRes.payload.evaluatedClaims.find((c) => c.id === 'claim_seats');
  assert.equal(seatClaim200.status, 'contradicted');
  assert.equal(seatClaim200.claimedValue, '200 Pro seats active');
  assert.equal(twoHundredSeatsRes.payload.dealDeskEconomics.proposedDiscountPct, 25);
});
