# Open Agent Hackathon 2026 — Ready-to-Paste Submission Package
**Submission Portal:** `https://hackathon.genai.works/submissions`  
**Hard Deadline:** Today Tuesday Oct 27, 2026 at 17:45 CDMX (23:45 UTC)  
**Bonus $10,000 Zetaris Demo Challenge Upload (Due Thu Oct 29, 17:45 CDMX):** `https://www.dropbox.com/scl/fo/xvv3sj5bdk622i56k5j19/AKi8lHTh63XEx8896HTNTds?rlkey=402k4lda7feylyrwqnkfymfjt&st=e9pzur2i&dl=0` (File naming: `AUTOAI-LEAD_271026.mp4`)

---

## 1. Core Submission Fields

- **Project Name:**  
  `LeadProof Agent — Autonomous Revenue Deal Desk & Explainable Forensic Verifier`

- **Selected Track:**  
  `Track 02 — The Agent That Can Explain Why`

- **One-Line Tagline:**  
  `The autonomous revenue & deal-desk agent that catches buyer bluffs and billing traps across 5 data silos via Zetaris Federated SQL and Meterless H-MEM—proving every verdict with cryptographic citations and real-time counterfactuals.`

- **Live Production Demo URL:**  
  `https://openagent.autoailead.com`

- **Public GitHub Repository URL:**  
  `https://github.com/nathanro/autoailead-leadproof-agent`

- **Slide Deck URL (Rule 06.2):**  
  - Interactive Web Deck: `https://openagent.autoailead.com/deck`  
  - Direct PDF Download: `https://openagent.autoailead.com/deck.pdf` (also local file `/workspace/hackathons/open-agent/LeadProof-Agent-Deck.pdf`)

- **One-Sentence Zetaris Demo Challenge Statement (Required for the $10,000 Zetaris Prize Pool):**  
  > **In one sentence, why did you think it was amazing?**  
  > *“Combining Zetaris’s zero-ETL federated SQL with Meterless’s H-MEM and Scout execution contracts let our agent catch a $27,900 procurement discount bluff ($22,940 net margin saved after enforcing the 8% MSA cap) across 5 data silos in 39 milliseconds without moving a single byte of customer PII into an LLM prompt.”*

---

## 2. Short & Long Project Descriptions

### Short Description (150 words)
Standard AI sales and reception agents trust whatever a prospect types in chat—scoring a delinquent 3-seat trial 95/100 when they claim "50 active seats" to unlock Enterprise API keys, or panicking when Procurement threatens to churn and giving away a 45% discount ($27,900 discount bluff → $22,940 net margin saved after enforcing the 8% MSA cap) on an account whose engineers are at 98.4% capacity.

**LeadProof Agent** solves this for B2B Deal Desks and high-ticket local service businesses (dental implant clinics, commercial HVAC). Every incoming lead or renewal request triggers a governed **5-silo Zetaris Federated SQL join** (Snowflake CRM, PostgreSQL Stripe Billing, Intercom Support, S3/Iceberg PostHog Telemetry, and Oracle/Ironclad Legal MSA) plus **Meterless H-MEM & Scout Intent** contract verification. Every decision includes clickable `[SRC-1]`–`[SRC-5]` citations, cross-silo deception alerts, an interactive **"What Would Change My Mind?" Counterfactual Simulator**, live AI forensic interrogation (`muse-spark-1.3`), and a ready-to-send WhatsApp/Email reply draft.

### Long Description / Full Technical Write-Up (Rule 06.4)

#### A. How Zetaris Was Integrated & What Was Unique
Rather than using Zetaris as a basic single-table lookup, we built a **5-Silo Cross-Platform Deception & Shadow-Usage Forensic Engine (`src/zetarisClient.js`)**:
1. **Zero-ETL Federated Joins Across 5 Silos:** A single governed query joins `zetaris_crm.hubspot_contacts` (Snowflake DWH), `zetaris_billing.stripe_subscriptions` (PostgreSQL), `zetaris_support.intercom_tickets` (Intercom REST), `zetaris_intent.posthog_events` (AWS S3/Iceberg), and `zetaris_legal.ironclad_contracts` (Oracle/Ironclad) with `ZERO_ETL = TRUE` and `bytesMovedToCentralStorage: 0`.
2. **Column-Level Security (`MASK_CLS`) & Read-Only MCP Enforcement:** Sensitive fields (`personal_phone`, `card_fingerprint`, `client_ip`, `bank_routing`) are masked in-situ before reaching the agent. Our live SQL inspector (`/api/zetaris/query`) enforces Zetaris's read-only MCP policy, blocking any `UPDATE/DELETE/DROP` statement with `HTTP 403 BLOCKED_BY_ZETARIS_READONLY_MCP_POLICY` and logging the attempt to the structured audit trail.
3. **Cryptographic Row Provenance & Counterfactual Pushdown:** Every federated row returns a `sha256` digest and pushdown predicate. Clicking any `[SRC-1]`–`[SRC-5]` badge in the Proof Tree highlights the exact federated row and SQL predicate.

#### B. How Meterless Was Integrated & What Was Unique
We integrated **Meterless (`src/meterlessClient.js`)** across all three layers of its open architecture:
1. **Meterless Runtime Contract v4 (`normalizeMeterlessUrl`):** Normalizes any pasted URL to `<host>/v1` without ever producing `/v1/v1`, sends `meterless-app: leadproof-agent` and `meterless-scope: user`, and routes across `meterless/deep` (when cross-silo conflicts are detected) and `meterless/auto`.
2. **Canonical H-MEM Engine (`engines/hmem/AGENTS.md`):** Implements the exact hybrid retrieval ranking formula (`clamp01(0.35·semantic + 0.20·keyword + 0.10·tag + 0.10·domain + 0.15·entity + 0.05·layer + 0.05·recency − 0.20·superseded) × confidence`), interactive confidence adaptation (`👍 Helpful +0.05`, `👎 Not Helpful -0.03`, `⚠️ Wrong -0.20 + review`), and the 17-action append-only `TrustLedgerService`.
3. **Canonical Scout Intent Engine (`engines/scout-intent/AGENTS.md`):** Runs the 5-stage pipeline (`Sense → Interpret → Guard → Route → Recommend`) and issues an immutable `hmac-sha256` signed `ExecutionContract` with a 5-layer guard stack before any Zetaris query executes.
4. **Outcome ROI & Margin Protection Circuit Breaker:** Tracks *Verified Margin Protected ($22,940–$28,200 per deal)* and *Hallucinations Blocked* against outcome unit cost (`$0.0018` cloud equivalent / `$0.00` on local Nightshift hotspot).

#### C. How Cursor & Live AI / NVIDIA Models Contribute
- **Built with Cursor:** Engineered end-to-end in Cursor using multi-file agentic workflows, automated Node.js test verification (`npm test`), and zero-downtime Cloudflare Worker edge deployment.
- **Live AI & NVIDIA Nemotron Compatibility:** Integrates live `muse-spark-1.3` structured JSON synthesis and live `"Ask Why"` forensic interrogation on the edge (`https://openagent.autoailead.com`), with native OpenAI-compatible routing for `nvidia/llama-3.3-nemotron-super-49b-v1` and Meterless local hotspots.
- **Pre-Existing Context Disclosure (Rule 05.4):** AutoAI Lead (`https://autoailead.com`) is our existing SaaS domain; 100% of the **LeadProof Agent** codebase (`autoailead-leadproof-agent`) was built from scratch during the Oct 22–27, 2026 hackathon build window.

---

## 3. 90-Second Demo Video Script (For Main Submission + $10k Zetaris Challenge)

- **0:00 – 0:18 | The Hook & The Trap (Show `https://openagent.autoailead.com` Light Mode Split View):**  
  *"Hi, I’m Nathan from AutoAI Lead. Most AI sales agents are gullible: if a prospect messages on WhatsApp claiming they have 50 active Pro seats with zero billing issues and demands Enterprise API keys today, a standard LLM scores it 95 out of 100 and leaks production credentials. Watch what happens when we run **LeadProof Agent** on that exact request."*
- **0:18 – 0:42 | Zetaris 5-Silo Federated Proof & The Shadow-Usage Bluff:**  
  *"In 39 milliseconds—with zero ETL—LeadProof executes a 5-silo federated SQL join through **Zetaris Super MCP** across Snowflake CRM, Postgres Stripe Billing, Intercom Support, S3/Iceberg PostHog Telemetry, and Ironclad Legal contracts. It catches that Apex Logistics only has 3 trial seats, owes $4,200 overdue (`[SRC-2]`), and has 14 blocked API key rotation attempts (`[SRC-4]`), scoring it 14/100 (`HOLD`) and protecting $28,200. Now click Tab 2: **Vanguard FinTech** threatens to cancel unless we give them a 45% discount, claiming 'low engineering usage.' Zetaris queries Iceberg telemetry in-situ and proves 33 engineers are at 98.4% quota saturation (`[SRC-4]`) while the MSA caps discounts at 8% (`[SRC-5]`)—saving $22,940 in gross margin!"*
- **0:42 – 1:05 | Interactive Counterfactual Simulator & Live AI Interrogation:**  
  *"Because LeadProof is built for Track 02—The Agent That Can Explain Why—every `[SRC-1]` to `[SRC-5]` badge is clickable, and our **Counterfactual Simulator** shows exactly what would change the agent's mind. Watch as I click **'✨ 1-Click Flip to Fast-Track'** or drag the discount slider down to 8%: the score jumps to 98/100 in real time and rewrites the WhatsApp/Email counter-offer! I can also click **'Ask Why'** to interrogate our live AI engine grounded in those 5 Zetaris rows."*
- **1:05 – 1:30 | Meterless H-MEM + Scout Intent + Why Zetaris Was Amazing (40s Segment for $10k Challenge):**  
  *"Under the hood, **Meterless Scout Intent** issues an HMAC-SHA256 signed execution contract before any query runs, while **Meterless H-MEM** ranks long-term policy invariants and adapts confidence live when I click 👍 Helpful (`+0.05`). Why did I think building with Zetaris was amazing? Because what usually takes weeks of brittle ETL pipelines across Stripe, HubSpot, PostHog, and Legal took one governed, read-only federated SQL layer with built-in Column-Level Security (`MASK_CLS`)—letting our agent catch a $27,900 buyer bluff ($22,940 net margin saved after 8% MSA cap) in 39 milliseconds without moving a single byte of customer PII."*
