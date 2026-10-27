import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAD_SCENARIOS, ZETARIS_CATALOG_SOURCES } from './scenarios.js';
import { ZetarisClient } from './zetarisClient.js';
import { MeterlessClient } from './meterlessClient.js';
import { LeadProofEngine } from './leadProofEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export function createCoreServices(options = {}) {
  const zetaris = new ZetarisClient(options.zetaris);
  const meterless = new MeterlessClient(options.meterless);
  const engine = new LeadProofEngine({ zetarisClient: zetaris, meterlessClient: meterless });
  return { zetaris, meterless, engine };
}

export async function handleApiRequest({ method, pathname, body = {}, services }) {
  const { zetaris, meterless, engine } = services;

  if (method === 'GET' && pathname === '/api/health') {
    return {
      status: 200,
      payload: {
        status: 'ok',
        service: 'autoailead-leadproof-agent',
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
      },
    };
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
    return {
      status: 200,
      payload: {
        status: 'ok',
        defaultScenarioId: 'trap-expansion-claim',
        catalogSources: ZETARIS_CATALOG_SOURCES,
        scenarios,
      },
    };
  }

  if (method === 'POST' && pathname === '/api/evaluate') {
    const scenarioId = body.scenarioId || 'trap-expansion-claim';
    const customLead = body.customLead || null;
    const overrides = body.overrides || {};
    const evaluation = await engine.evaluateLead({
      scenarioId,
      customLead,
      overrides,
      isCounterfactual: Boolean(body.isCounterfactual),
      liveAi: Boolean(body.liveAi),
    });
    return {
      status: 200,
      payload: evaluation,
    };
  }

  if (method === 'POST' && pathname === '/api/forensic-ask') {
    const res = await engine.askForensicQuestion({
      scenarioId: body.scenarioId || 'trap-expansion-claim',
      question: body.question || '',
      overrides: body.overrides || {},
    });
    return {
      status: 200,
      payload: res,
    };
  }

  if (method === 'POST' && pathname === '/api/counterfactual') {
    const scenarioId = body.scenarioId || 'trap-expansion-claim';
    const customLead = body.customLead || null;
    const overrides = body.overrides || {};

    const baseline = await engine.evaluateLead({
      scenarioId,
      customLead,
      overrides: {},
      isCounterfactual: false,
    });
    const simulated = await engine.evaluateLead({
      scenarioId,
      customLead,
      overrides,
      isCounterfactual: true,
    });

    return {
      status: 200,
      payload: {
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
      },
    };
  }

  if (method === 'POST' && pathname === '/api/zetaris/query') {
    const result = await zetaris.executeCustomSql({
      sql: body.sql || '',
      scenarioId: body.scenarioId || 'trap-expansion-claim',
    });
    return {
      status: result.ok ? 200 : 403,
      payload: result,
    };
  }

  if (method === 'GET' && pathname === '/api/meterless/ledger') {
    return {
      status: 200,
      payload: {
        status: 'ok',
        summary: meterless.getSummary(),
      },
    };
  }

  if (method === 'POST' && pathname === '/api/meterless/feedback') {
    const res = meterless.applyMemoryFeedback(body.memoryId || 'mem-policy-1', body.rating || 'helpful');
    return {
      status: res.ok ? 200 : 404,
      payload: res,
    };
  }

  return null;
}

export function createAppServer(options = {}) {
  const services = createCoreServices(options);
  services.engine.evaluateLead({ scenarioId: 'trap-expansion-claim' }).catch(() => {});

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    const sendJson = (status, payload) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(payload, null, 2));
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, meterless-app, meterless-scope',
      });
      return res.end();
    }

    const readJsonBody = () =>
      new Promise((resolve) => {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
          if (raw.length > 2_000_000) req.destroy();
        });
        req.on('end', () => {
          try {
            resolve(raw ? JSON.parse(raw) : {});
          } catch (_) {
            resolve({});
          }
        });
      });

    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'POST' ? await readJsonBody() : {};
      const apiResult = await handleApiRequest({
        method: req.method,
        pathname: url.pathname,
        body,
        services,
      });
      if (apiResult) {
        return sendJson(apiResult.status, apiResult.payload);
      }
      return sendJson(404, { error: 'API endpoint not found', path: url.pathname });
    }

    let relPath = url.pathname;
    if (relPath === '/' || relPath === '/index.html') relPath = '/index.html';
    else if (relPath === '/deck' || relPath === '/deck/') relPath = '/deck.html';
    else if (relPath === '/LeadProof-Agent-Deck.pdf') relPath = '/deck.pdf';

    const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(PUBLIC_DIR, safeRel);

    if (!fullPath.startsWith(PUBLIC_DIR) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
    fs.createReadStream(fullPath).pipe(res);
  });

  return { server, services };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3090);
  const { server } = createAppServer();
  server.listen(port, () => {
    console.log(`LeadProof Agent listening on http://localhost:${port}`);
  });
}
