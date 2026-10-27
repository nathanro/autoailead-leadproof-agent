import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const indexHtml = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const deckHtml = fs.readFileSync(path.join(ROOT, 'public/deck.html'), 'utf8');
const deckPdfB64 = fs.readFileSync(path.join(ROOT, 'public/deck.pdf')).toString('base64');
const screenshotAppB64 = fs.readFileSync(path.join(ROOT, 'public/screenshot-live-app.png')).toString('base64');

const scenariosSrc = fs.readFileSync(path.join(ROOT, 'src/scenarios.js'), 'utf8');
const zetarisSrc = fs
  .readFileSync(path.join(ROOT, 'src/zetarisClient.js'), 'utf8')
  .replace(/import\s+.*?from\s+['"].*?['"];?\n?/g, '');
const meterlessSrc = fs
  .readFileSync(path.join(ROOT, 'src/meterlessClient.js'), 'utf8')
  .replace(/import\s+crypto\s+from\s+['"]node:crypto['"];?\n?/g, '');
const engineSrc = fs
  .readFileSync(path.join(ROOT, 'src/leadProofEngine.js'), 'utf8')
  .replace(/import\s+.*?from\s+['"]\.\/scenarios\.js['"];?\n?/g, '');

const workerCode = `// Auto-generated Cloudflare Worker bundle for LeadProof Agent (openagent.autoailead.com)
import crypto from 'node:crypto';

const INDEX_HTML = ${JSON.stringify(indexHtml)};
const DECK_HTML = ${JSON.stringify(deckHtml)};
const DECK_PDF_B64 = ${JSON.stringify(deckPdfB64)};
const SCREENSHOT_APP_B64 = ${JSON.stringify(screenshotAppB64)};

function b64ToUint8Array(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

${scenariosSrc}

${zetarisSrc}

${meterlessSrc}

${engineSrc}

let globalServices = null;
function getServices(env) {
  if (env && env.META_API_KEY) {
    globalThis.process = globalThis.process || { env: {} };
    globalThis.process.env = globalThis.process.env || {};
    globalThis.process.env.META_API_KEY = env.META_API_KEY;
  }
  if (!globalServices) {
    const zetaris = new ZetarisClient();
    const meterless = new MeterlessClient();
    const engine = new LeadProofEngine({ zetarisClient: zetaris, meterlessClient: meterless });
    globalServices = { zetaris, meterless, engine };
    engine.evaluateLead({ scenarioId: 'trap-expansion-claim' }).catch(() => {});
  }
  return globalServices;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, meterless-app, meterless-scope',
    };

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const sendJson = (status, payload) =>
      new Response(JSON.stringify(payload, null, 2), {
        status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        },
      });

    const services = getServices(env);
    const { zetaris, meterless, engine } = services;

    if (pathname.startsWith('/api/')) {
      let body = {};
      if (method === 'POST') {
        try {
          body = await request.json();
        } catch (_) {
          body = {};
        }
      }

      if (method === 'GET' && pathname === '/api/health') {
        return sendJson(200, {
          status: 'ok',
          service: 'autoailead-leadproof-agent',
          runtime: 'cloudflare-workers-edge',
          hackathon: 'Open Agent Hackathon 2026 (GenAI Works)',
          track: 'Track 02 — The Agent That Can Explain Why',
          liveAiConfigured: Boolean(engine.getMetaApiKey()),
          liveAiStats: {
            callsCount: engine.liveAiCallsCount,
            spendUSD: engine.liveAiSpendUSD,
          },
          zetaris: zetaris.getStatus(),
          meterless: meterless.getSummary(),
          scenariosAvailable: Object.keys(LEAD_SCENARIOS),
        });
      }

      if (method === 'GET' && pathname === '/api/scenarios') {
        const scenarios = Object.values(LEAD_SCENARIOS).map((s) => ({
          id: s.id,
          badge: s.badge,
          badgeTone: s.badgeTone,
          title: s.title,
          vertical: s.vertical,
          channel: s.channel,
          leadName: s.leadName,
          leadRole: s.leadRole,
          company: s.company,
          email: s.email,
          dealValueUSD: s.dealValueUSD,
          requestedDiscountPct: s.requestedDiscountPct || 0,
          requestedTerms: s.requestedTerms || 'Net-30',
          incomingMessage: s.incomingMessage,
          leadClaims: s.leadClaims,
          naiveLlmTrap: s.naiveLlmTrap,
          defaultOverrides: s.defaultOverrides,
        }));
        return sendJson(200, {
          status: 'ok',
          defaultScenarioId: 'trap-expansion-claim',
          catalogSources: ZETARIS_CATALOG_SOURCES,
          scenarios,
        });
      }

      if (method === 'POST' && pathname === '/api/evaluate') {
        const evaluation = await engine.evaluateLead({
          scenarioId: body.scenarioId || 'trap-expansion-claim',
          customLead: body.customLead || null,
          overrides: body.overrides || {},
          isCounterfactual: Boolean(body.isCounterfactual),
          liveAi: Boolean(body.liveAi),
        });
        return sendJson(200, evaluation);
      }

      if (method === 'POST' && pathname === '/api/closer/objection') {
        const res = await engine.handleObjectionAndQuote({
          scenarioId: body.scenarioId || 'trap-expansion-claim',
          objectionType: body.objectionType || 'competitor_price',
          customObjection: body.customObjection || '',
          overrides: body.overrides || {},
          liveAi: Boolean(body.liveAi),
        });
        return sendJson(200, res);
      }

      if (method === 'POST' && pathname === '/api/closer/checkout') {
        const res = await engine.closeDealCheckout({
          scenarioId: body.scenarioId || 'trap-expansion-claim',
          quoteId: body.quoteId || 'qt_live',
          amountPaidUSD: body.amountPaidUSD || 1500,
          finalContractPriceUSD: body.finalContractPriceUSD || 24000,
          company: body.company || 'Apex Logistics Corp',
        });
        return sendJson(200, res);
      }

      if (method === 'POST' && pathname === '/api/forensic-ask') {
        const res = await engine.askForensicQuestion({
          scenarioId: body.scenarioId || 'trap-expansion-claim',
          question: body.question || '',
          overrides: body.overrides || {},
        });
        return sendJson(200, res);
      }

      if (method === 'POST' && pathname === '/api/counterfactual') {
        const scenarioId = body.scenarioId || 'trap-expansion-claim';
        const customLead = body.customLead || null;
        const overrides = body.overrides || {};
        const baseline = await engine.evaluateLead({ scenarioId, customLead, overrides: {}, isCounterfactual: false });
        const simulated = await engine.evaluateLead({ scenarioId, customLead, overrides, isCounterfactual: true });
        return sendJson(200, {
          status: 'ok',
          scenarioId,
          verdictFlipped: baseline.decision.verdict !== simulated.decision.verdict,
          scoreDelta: simulated.decision.score - baseline.decision.score,
          baseline: {
            verdict: baseline.decision.verdict,
            score: baseline.decision.score,
            conflictCount: baseline.decision.conflictCount,
            marginProtectedUSD: baseline.dealDeskEconomics.marginProtectedUSD,
          },
          simulated,
        });
      }

      if (method === 'POST' && pathname === '/api/zetaris/query') {
        const result = await zetaris.executeCustomSql({
          sql: body.sql || '',
          scenarioId: body.scenarioId || 'trap-expansion-claim',
        });
        return sendJson(result.ok ? 200 : 403, result);
      }

      if (method === 'GET' && pathname === '/api/meterless/ledger') {
        return sendJson(200, {
          status: 'ok',
          summary: meterless.getSummary(),
        });
      }

      if (method === 'POST' && pathname === '/api/meterless/feedback') {
        const res = meterless.applyMemoryFeedback(body.memoryId || 'mem-policy-1', body.rating || 'helpful');
        return sendJson(res.ok ? 200 : 404, res);
      }

      return sendJson(404, { error: 'Not found', path: pathname });
    }

    if (pathname === '/favicon.ico') {
      return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="system-ui,sans-serif" font-weight="800" font-size="28">LP</text></svg>', {
        status: 200,
        headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
      });
    }

    if (pathname === '/' || pathname === '/index.html') {
      return new Response(INDEX_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
      });
    }

    if (pathname === '/deck' || pathname === '/deck/' || pathname === '/deck.html') {
      return new Response(DECK_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
      });
    }

    if (pathname === '/deck.pdf' || pathname === '/LeadProof-Agent-Deck.pdf') {
      return new Response(b64ToUint8Array(DECK_PDF_B64), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="LeadProof-Agent-Deck.pdf"',
          'Cache-Control': 'public, max-age=300',
        },
      });
    }

    if (pathname === '/screenshot-live-app.png') {
      return new Response(b64ToUint8Array(SCREENSHOT_APP_B64), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' },
      });
    }

    return new Response('404 Not Found', { status: 404 });
  },
};
`;

fs.writeFileSync(path.join(ROOT, 'worker.js'), workerCode);
console.log('Generated worker.js successfully. Size:', (workerCode.length / 1024).toFixed(1), 'KB');
