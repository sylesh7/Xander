# Xander — Frontend Build Spec

**Companion doc:** `backendwiring.md` (endpoint reference — written next).
This doc says **what to build**. That one says **how to call it**.
Where a page needs an endpoint, this doc names it; the shapes live in the wiring doc.

**Stack:** Next 15 (App Router) · React 19 · Tailwind v4 · TypeScript
**Location:** `Xander/frontend` — the existing landing page stays at `/`, the product lives under new route groups.

---

# 0. Read this first — three rules that will save you a day

### Rule 1 — There are THREE auth models. Getting this wrong makes everything 401 for no visible reason.

| Surface | Header(s) | Notes |
|---|---|---|
| `/v2/*` (console) | `X-API-Key: <key>` | The operator desk |
| `/x402/*` | **none** | The payment *is* the auth |
| `/v2/control/*` | `Authorization: Bearer <token>` **+** `X-Device-Id: <id>` | **The API key is rejected here.** Different credential entirely. |
| V1 (`/screen-claim`, `/world/*`, `/receipts/*`) | `X-API-Key: <key>` | Legacy claim gate, still live |

Build **two** API clients, not one. `lib/api/console.ts` and `lib/api/authority.ts`. Never share a header builder between them.

### Rule 2 — `null` means UNKNOWN. It does **not** mean zero.

The entire product exists to avoid guessing. A trust dimension comes back as `null` when there is no evidence to measure it, and rendering that as `0`, an empty bar, or a green tick is **a correctness bug, not a styling choice**.

```
value === null && state === 'UNKNOWN'         → render "UNKNOWN" in --color-bolt, dashed border
value === null && state === 'NOT_APPLICABLE'  → render "N/A" in --color-faint, no bar
value === 0                                    → a real, measured zero. Render the number.
```

There is a shared `<Measure>` component below that encodes this. **Use it everywhere a number can be null.** Never `value ?? 0`. Never `value || '—'`.

### Rule 3 — A refusal is a first-class result, not an error toast.

`BLOCK`, `LIMIT`, `REVIEW`, `CHALLENGE`, `BLOCKED_UNENFORCEABLE`, 402, 403, 429 are all **the product working**. They get designed screens with reasons and next actions, not a red "something went wrong". Only 5xx is an error.

---

# 1. Design system

The landing template already defines the whole palette and type scale. **Do not invent tokens.** Everything below already exists in `app/globals.css`.

## 1.1 Typography

| Token | Face | Use in the product |
|---|---|---|
| `--font-shout` | **Anton** | Page titles, big numbers, band labels. Uppercase, tight tracking. |
| `--font-noir` | **Bodoni Moda** | Section headers, pull-quotes, the "dossier" feel. Sparingly. |
| `--font-tele` | **Courier Prime** | **The workhorse.** All data: addresses, hashes, ids, amounts, timestamps, status codes, reason codes, JSON. Uppercase + `tracking-widest` for labels. |
| `--font-body` | Avenir Next / Futura | Prose, descriptions, help text. |

**The voice:** this is a **classified case file**, not a SaaS dashboard. Labels are `Courier Prime`, uppercase, letter-spaced, small. Values are large and confident. Whitespace is generous. Rules (`--color-rule`) are hairlines, not shadows.

Tailwind classes already available: `font-shout`, `font-noir`, `font-tele`, `font-body`.

## 1.2 Palette

Light / dark pairs, already wired to `data-theme`:

| Token | Light | Dark | Meaning in Xander |
|---|---|---|---|
| `paper` | `#ece4d0` | `#0d0b08` | Surface |
| `ink` | `#171310` | `#ece4d0` | Text |
| `rule` | `#c6bda4` | `#2a2620` | Hairlines, table borders |
| `dim` | `#56514a` | `#c9c2b4` | Secondary text |
| `faint` | `#5d5a4f` | `#aaa7b3` | Tertiary, `N/A`, disabled |
| `field` | `#837a61` | `#64605a` | Input borders, chrome |
| **`signal`** | `#b32408` | `#ff3b12` | **Danger** |
| **`acid`** | `#4d6300` | `#c6ff3d` | **Confirmed / allowed** |
| **`amber`** | `#b06414` | `#ffb347` | **Caution / pending** |
| **`bolt`** | `#0e3fbf` | `#4e8dff` | **Unknown / informational** |

Classes: `text-signal`, `bg-acid`, `border-rule`, etc.

## 1.3 The semantic map — memorise this

Every status in the product maps to exactly one of four colours. **Never introduce a fifth.**

| Colour | Trust band | Decision | Execution | Incident | Capability |
|---|---|---|---|---|---|
| **acid** | `VERIFIED_LOW`, `ESTABLISHED_LOW` | `ALLOW` | `EXECUTED_AS_AUTHORIZED` | `RESOLVED`, `FALSE_POSITIVE` | `ACTIVE` |
| **amber** | `UNCERTAIN` | `LIMIT`, `CHALLENGE` | — | `INVESTIGATING`, `MITIGATED` | `SUSPENDED`, `ATTENUATED_GRANT` |
| **signal** | `HIGH_RISK`, `CRITICAL` | `BLOCK` | `FAILED` | `OPEN` @ HIGH/CRITICAL | `REVOKED` |
| **bolt** | `INSUFFICIENT_EVIDENCE` | `REVIEW` | `BLOCKED_UNENFORCEABLE`, `NOT_EXECUTED` | `OPEN` @ LOW/MEDIUM | `EXPIRED` |

Put this in `lib/semantics.ts` as one exported map. Every badge reads from it. No component decides its own colour.

## 1.4 Components to add

The template has **no app primitives** — you're adding them. Recommended:

- **shadcn/ui** (copy-in, not a dependency) — `button`, `table`, `badge`, `dialog`, `sheet`, `tabs`, `tooltip`, `sonner` (toast), `command`, `skeleton`, `separator`, `scroll-area`.
  Restyle each to the tokens above: square corners or `rounded-none`, hairline `border-rule`, `font-tele` uppercase labels. **Strip the default rounded-lg/shadow look** — it fights the noir aesthetic.
- **`lucide-react`** `^1.45.0` — icons.
- **`recharts`** `^3.10.1` — trust radar + sparklines only.
- **`@mediapipe/tasks-vision`** `^1.0.1` — hand landmarks (§7).
- **`@worldcoin/idkit-core`** `^4.2.4` + **`qrcode`** `^1.5.4` — World Selfie Check. **Use these exact packages** — this combination is already proven end to end against a real phone; the React `@worldcoin/idkit` widget is *not* what was tested.

## 1.5 Icon vocabulary (lucide)

Fixed mapping — one concept, one icon, everywhere.

| Concept | Icon | | Concept | Icon |
|---|---|---|---|---|
| Actor | `user-round` | | Agent | `bot` |
| Trust | `gauge` | | Evidence | `database` |
| The Graph | `share-2` | | Substreams (live) | `radio` |
| Capability | `key-round` | | Enforcement | `shield-check` |
| Intent | `file-signature` | | Receipt | `receipt-text` |
| Incident | `siren` | | Investigation | `search-check` |
| Counter-evidence | `scale` | | Payment / x402 | `coins` |
| ENS identity | `badge-check` | | On-chain tx | `link-2` |
| Freeze | `snowflake` | | Revoke | `ban` |
| Approve | `check` | | Deny | `x` |
| Limit | `chevrons-down-up` | | Operator | `user-cog` |
| Liveness | `hand` | | World ID | `scan-face` |
| Policy | `scale-3d` | | System health | `activity` |
| UNKNOWN | `circle-help` | | Workflow | `workflow` |

Icons are `16px` inline with `font-tele` labels, `20px` in nav, stroke `1.5`. Never coloured except to carry semantic state.

---

# 2. Information architecture

```
/                             landing page (EXISTS — leave alone)

/console                      operator desk        [X-API-Key]
  /console                      overview
  /console/evidence             The Graph explorer
  /console/actors/[id]          actor trust dossier
  /console/agents               agent roster
  /console/agents/new           onboarding wizard  ← World + MediaPipe
  /console/agents/[id]          agent dossier
  /console/intents              decision log
  /console/intents/[id]         decision + execution
  /console/incidents            incident queue
  /console/incidents/[id]       incident dossier
  /console/commerce             x402 agent commerce
  /console/policy               policy rules (read-only)
  /console/system               health, dependencies, reconciliation

/authority                    remote authority     [Bearer + X-Device-Id]  MOBILE-FIRST
  /authority/login              open a device session
  /authority                    pending queue + decide  ← SCOPED TO 2 SCREENS
  /authority/actions/[id]       decide (can be inline on the queue instead)

  DEFERRED — build only if time allows:
  /authority/agents/[id]        mobile agent view
  /authority/audit              audit trail
```

Two **separate** route groups with **separate layouts and separate API clients**. `/authority` is designed phone-first (single column, thumb-reachable actions, 44px minimum targets). `/console` is desktop-first.

---

# 3. Shared components

Build these once in `components/xander/`.

### `<Measure value state basis label />`
**The most important component in the app.** Renders a trust dimension or any nullable number.

```
KNOWN          → big Anton number + a hairline bar + basis text
UNKNOWN        → "UNKNOWN" in font-tele, text-bolt, dashed border, circle-help icon
NOT_APPLICABLE → "N/A" in text-faint, no bar
```
Always shows `basis` (the backend's one-line explanation) as `font-tele text-xs text-dim` underneath. **Never** falls back to 0.

### `<StatusBadge kind value />`
`kind` ∈ `band | decision | execution | incident | capability | payment`. Reads `lib/semantics.ts`. Square, `border`, `font-tele`, uppercase, `tracking-widest`, `text-[11px]`, `px-2 py-0.5`. No fill except on `signal`.

### `<Mono>` / `<Address>` / `<TxLink>` / `<Hash>`
`font-tele`. `<Address>` truncates `0x1234…abcd` with click-to-copy. `<TxLink>` links to `sepolia.basescan.org` (Base Sepolia) or `sepolia.etherscan.io` (Sepolia) — **pick by the CAIP-2 / chain field, never hardcode**. `<Hash>` truncates to 10 chars with a tooltip.

### `<ProvenanceChip source deployment block />`
Every evidence row carries provenance. Small `font-tele` chip: `TOKEN-API · #25961294` / `SUBGRAPH · Qm… · #25961294` / `SUBSTREAMS · cursor`. Icon `database` / `share-2` / `radio`.

### `<ReasonPanel code summary />`
The designed refusal. Large `font-shout` outcome, `font-tele` reason code, `font-body` explanation, then **what the user can do next**. Used on every BLOCK / REVIEW / 402 / 403 / 429.

### `<EmptyState icon title body action />`
Noir voice: *"NO EVIDENCE ON FILE"*, not "No data yet 🙁".

### `<DataTable>`
Hairline `border-rule`, no zebra striping, `font-tele` uppercase headers at `text-[11px]`, generous row height (`h-14`), whole row clickable where it navigates.

### `<Timeline items />`
Vertical hairline with square nodes. Node colour from semantics. Used for trust history, agent lifecycle, incident timeline, workflow history.

### `<LiveBadge />`
Pulsing `acid` dot + `font-tele` "LIVE". For anything polling.

---

# 4. `/console` — the operator desk

## 4.0 Shell (`/console/layout.tsx`)

**Left rail** (72px collapsed / 240px expanded): logo, then nav — Overview, Evidence, Agents, Intents, Incidents, Commerce, Policy, System. Active item marked with a 2px `ink` left bar, not a filled pill.

**Top bar:** breadcrumb (`font-tele`, uppercase), global `⌘K` command palette, theme toggle (template already supports `data-theme`), and a **connection pill** — polls system health, shows `acid` when ready / `signal` when not.

**API key:** a one-time modal on first load storing to `localStorage`. This is a dev/demo console — say so in the modal. Never put the key in a URL.

---

## 4.1 `/console` — Overview

**Purpose:** the state of the runtime in one screen.

**Regions**
1. **Header** — "TRUST RUNTIME" in Anton, `<LiveBadge/>`, timestamp.
2. **Four stat tiles** (`font-shout`, huge): Active Agents · Live Capabilities · Open Incidents · Decisions (24h). Each tile has a sparkline and links to its list.
3. **Trust band distribution** — horizontal stacked bar across the six bands, semantic colours, counts in `font-tele`. Clicking a segment filters the agent roster.
4. **Recent decisions** — last 10, compact `<DataTable>`: time · actor · action · `<StatusBadge kind="decision">` · reason code. Row → `/console/intents/[id]`.
5. **Open incidents** — severity-sorted, `siren` icon, `<StatusBadge kind="incident">`. Row → `/console/incidents/[id]`.
6. **Evidence pipeline strip** — four small cards: Token API · Subgraphs · Substreams · MCP. Each shows reachable/unreachable + last block or cursor. This is the **Graph presence on the home screen** — it should read as the foundation, not a footnote.

**Endpoints:** `GET /v2/incidents`, `GET /health`, `GET /ready`. *(An aggregate stats endpoint does not exist — derive client-side from the lists, or note it as a backend ask.)*

**States:** skeleton tiles on load · `<EmptyState>` per region · if `/ready` is 503 show a persistent `signal` banner naming the dependency **and what it degrades to**.

---

## 4.2 `/console/evidence` — The Graph Evidence Explorer

**Purpose:** the opening screen of the demo. Prove the trust engine is grounded in real indexed chain data.

**Regions**
1. **Wallet input** — big `font-tele` address field + "PULL EVIDENCE". Paste-friendly, validates `0x` + 40 hex.
2. **Source strip** — four cards, one per Graph product, each showing live status:
   - `database` **Token API** — balances + transfers fetched
   - `share-2` **Standardized Subgraphs** — protocol, deployment id, block, `pinned-match`
   - `radio` **Substreams** — chain, cursor block, `<LiveBadge/>` when advancing
   - `search-check` **Subgraph MCP** — tool count, SSE connected
3. **Evidence table** — the payoff. Columns: time · chain · event · protocol · counterparty · amount · **`<ProvenanceChip>`**. Every single row shows where it came from. Sortable, filterable by source.
4. **Derived signals panel** — the features extracted from this evidence (funding correlation, timing, shared counterparty…), each with its value and confidence, rendered with `<Measure>`.
5. **"OPEN TRUST DOSSIER →"** button → `/console/actors/[id]`.

**Buttons:** `PULL EVIDENCE` · `REFRESH` (re-runs live fetch) · per-source `RETRY` · `COPY EVIDENCE IDS`.

**Endpoints:** `GET /wallets/:address/risk`, `GET /clusters/:id/evidence`, `POST /v2/actors` (to get an actorId), `GET /v2/actors/:id/trust`.

**The point of this page:** every number in Xander traces to a row here. Make that visible — hovering a derived signal should highlight the evidence rows it used.

**States:** unknown wallet → `<EmptyState>` "NO EVIDENCE ON FILE — this wallet is unmeasurable, and unmeasurable is not safe." · a source failing → that card goes `signal` and names its degradation, **the page still renders**.

---

## 4.3 `/console/actors/[id]` — Actor trust dossier

**Purpose:** everything Xander believes about one actor, and why.

**Regions**
1. **Identity header** — actor id, type, status, linked wallets (`<Address>` each), created.
2. **The band** — enormous `font-shout` band name in its semantic colour, with the engine + policy version in `font-tele` beneath. This is the headline number of the whole product.
3. **Trust vector** — Recharts radar, 7 axes. **Null dimensions render as a gap in the polygon, not a zero point** — a zeroed axis would draw a shape that claims a measurement nobody made. Beside it, seven `<Measure>` rows.
4. **Drift** — sparkline of band over time + the delta since last snapshot.
5. **Capabilities** — table: action · status · amount limit · frequency · expiry · lease. `<StatusBadge kind="capability">`.
6. **Enforcement boundaries** — per capability, one row per adapter (`local`, `ens-eac`) showing `enforceable: true / false / null`. **Null renders as UNKNOWN in bolt, never as a red cross** — "we could not check" is not "denied".
7. **Trust history** — `<Timeline>` of snapshots + signals, newest first, each with its source.

**Buttons:** `REBUILD TRUST` (live refresh, warns it costs Graph quota) · `VIEW EVIDENCE` → 4.2 · `COPY ACTOR ID`.

**Endpoints:** `GET /v2/actors/:id`, `/trust`, `/trust/history`, `/capabilities`, `/enforcement`.

---

## 4.4 `/console/agents` — Agent roster

Table: name · `<StatusBadge>` (7 lifecycle states) · ENS name (`badge-check` if minted) · trust band · capability count · open incidents · last active.

**Buttons:** `+ CREATE AGENT` → 4.5 · row → 4.6 · quick `snowflake` freeze on hover (confirm dialog).

Filters: status, band, has-ENS, has-incidents.

**Endpoint:** `GET /v2/agents`.

---

## 4.5 `/console/agents/new` — Onboarding wizard ⭐

**Purpose:** the human-backed agent creation flow. This is demo screens 1–4 and the most important build in the app.

A 4-step wizard. **Progress rail on the left**, each step showing its state. Steps do not unlock until the previous one genuinely completes — never let the UI run ahead of the backend.

---

### Step 1 — Identity

Fields: **Name** (required) · **Wallet** (0x, or "use existing actor") · **Agent URI** (optional) · **ENS label** (optional, `a-z0-9-`, 3–63).

Live preview: `<label>.xander.eth` in `font-tele`.

⚠️ Under the ENS field, in `amber`: *"Minting is a real Sepolia transaction and costs gas. Leave blank to create the agent without an on-chain identity."*

**Button:** `CREATE AGENT` → `POST /v2/agents`.

**Result:** agent appears as `DRAFT` with **zero capabilities**. Show that explicitly — an empty capability table with the caption *"NO AUTHORITY. A name is not an authorisation."* That line is the whole thesis of the product; put it on screen.

---

### Step 2 — World ID Selfie Check

Uses the **proven** `@worldcoin/idkit-core` + `qrcode` flow (this is exactly what worked against a real phone — do not substitute the React widget).

1. `POST /screen-claim` → get a claim + a `CHALLENGE` decision
2. `POST /world/rp-signature` → real ECDSA signature from the backend
3. Build the IDKit request client-side with `IDKit` + `selfieCheckLegacy`
4. Render the returned URL as a **QR code** (large, high contrast, `paper` on `ink`)
5. Poll the World bridge
6. On proof → `POST /world/verify`

**UI:** a large square QR with the `scan-face` icon and *"SCAN WITH WORLD APP"* in Anton. Below: a live status list (`font-tele`) that logs each real step as it happens — this transparency is the demo.

**Buttons:** `START SELFIE CHECK` · `CANCEL` · `RETRY`.

**States:** waiting (pulsing) · scanned (amber) · verified (acid, big tick) · **credential unavailable** → this is a *real* World-side answer, not a bug. Say so in `<ReasonPanel>`.

---

### Step 3 — Active liveness (MediaPipe) ⭐ **see §7 for the full component spec**

Camera on. Backend issues a random target (1–5 fingers). User holds up that many. Client extracts 21 hand landmarks per frame and posts **only the landmark coordinates** — never imagery.

**Buttons:** `ENABLE CAMERA` · `BEGIN CHALLENGE` · `SUBMIT` · `RETRY`.

**Endpoints:** `POST /v2/verification/liveness/start` → `POST /v2/verification/liveness/complete`.

---

### Step 4 — Assurance & capabilities

Sends both proofs: `POST /v2/agents/:id/verify` with `worldChallengeId` + `livenessChallengeId`.

**Result screen — the payoff. Show all four:**
1. **Status** `DRAFT → ACTIVE` (animate the transition)
2. **Assurance lease** — `WORLD_PLUS_ACTIVE` (longer) vs `WORLD_ONLY` (shorter). Show the expiry and say *why* it's longer: a credential proves someone was verified once; a fresh liveness proof says someone is present now.
3. **ENS identity** — the minted name, token id, `<TxLink>`, and the **EAC roles now granted on-chain**.
4. **Capability envelope** — the granted table, and **explicitly show what was NOT granted**: `BORROW ✗` `TRANSFER ✗` in `faint` with the caption *"Nothing that moves value was granted on verification alone."*

**Buttons:** `GO TO AGENT →` · `CREATE ANOTHER`.

---

## 4.6 `/console/agents/[id]` — Agent dossier

Tabbed. Header: name, `<StatusBadge>`, ENS, and the lifecycle actions.

| Tab | Content |
|---|---|
| **Overview** | status, actor link, trust band, assurance lease w/ countdown, config |
| **Identity** | ENS name/token/expiry/owner + on-chain roles read live; ERC-8004 identity, reputation, validation — **UNKNOWN when unregistered, never 0** |
| **Capabilities** | the envelope + enforcement boundaries per adapter |
| **Evidence** | the agent's actor evidence (reuse 4.2's table) |
| **Incidents** | incidents for this agent |
| **Timeline** | full lifecycle: created → verified → granted → frozen → … each with tx links |

**Buttons (danger zone, `signal` bordered):**
- `snowflake` **FREEZE** → `POST /v2/agents/:id/freeze` — dialog must state: *"This is a capability state transition, not a flag. An ENS-backed agent's on-chain roles will be revoked in a real transaction."* Requires a typed reason.
- **UNFREEZE** → `/unfreeze` — will 409 if the assurance lease has lapsed. Design that refusal.
- `ban` **REVOKE** → `/revoke` — terminal. Require typing the agent name to confirm.

Each shows the resulting `<TxLink>` on success.

---

## 4.7 `/console/intents` + `/[id]` — Decisions & execution

**List:** time · actor · action type · amount · `<StatusBadge kind="decision">` · reason code · execution status. Filter by result/action/actor.

**Detail — laid out as a decision record:**
1. **The ask** — action, amount, target, resource, expiry countdown.
2. **The answer** — huge `font-shout` result + `<ReasonPanel>`. For `LIMIT`, show requested vs granted side by side — *"reduce, don't refuse"* is the product's signature move and should be visually obvious.
3. **What it rested on** — trust snapshot link, policy version, the **matched rule** (priority + name), risk score, confidence.
4. **Evidence lineage** — the evidence ids cited, expandable to rows.
5. **Capability granted** — if any.
6. **Receipt** — evidence hash, payload hash, execution status, adapters that proved it, tx hash, executed-at.
7. **Execute panel** — the Phase 8 gate.

**Button:** `EXECUTE` → `POST /v2/intents/:id/execute`.
- 200 → `EXECUTED_AS_AUTHORIZED` + the boundaries that confirmed it
- 409 → `BLOCKED_UNENFORCEABLE` + `<ReasonPanel>`. **This is the demo moment** — state plainly *"The executor was never called."*

---

## 4.8 `/console/incidents` + `/[id]` — Security operations

**Queue:** severity-sorted. type · `<StatusBadge>` · severity · actor/agent · source · opened · mitigation. `siren` icon; CRITICAL rows get a `signal` left border.

**Buttons:** `+ OPEN INCIDENT` (manual) · row → detail.

**Detail — the richest page in the app:**

1. **Header** — type, severity, status, opened/closed, source.
2. **Containment banner** — if contained pre-investigation, an `amber` band: *"CONTAINED BEFORE INVESTIGATION — capability suspended on severity alone, before anything was known."* This ordering is a deliberate design decision; surface it.
3. **Investigation — two columns, side by side.** The centrepiece:
   - **SUPPORTING** (`signal` header) — evidence for the hypothesis
   - **CONTRADICTING** (`acid` header) — the counter-evidence findings, each with `kind`, plain-English detail, weight, and its evidence rows
   Between them, a **doubt gauge** (0–1). **Null doubt renders UNKNOWN, not 0** — "no evidence to check" is not "nothing exculpatory found".
4. **Recommendation vs decision** — two cards side by side:
   - *AI recommended:* e.g. `ALLOW`
   - *Policy applied:* e.g. `RESTRICT`
   When they disagree, a `signal` strip between them: **"AI DE-ESCALATION IGNORED — the investigator may tighten a decision, never loosen it."** This is the single best screen in the product for explaining the safety model.
5. **Workflow** — Temporal run id, phase, `<Timeline>` of history.
6. **Timeline** — opened → contained → investigated → mitigated → resolved.

**Buttons:** `INVESTIGATE` · `MITIGATE` (optional AI recommendation dropdown) · `RESOLVE` (requires a root cause — **the form must not submit empty**; an incident closed with no cause taught nobody anything) · `MARK FALSE POSITIVE` (offers `RESTORE AUTHORITY`, only legal here).

---

## 4.9 `/console/commerce` — x402

Three regions:

1. **Resource card** — from `GET /x402/info`: price, asset, network (CAIP-2), payTo, and **facilitator supported yes/no** with the protocol version. Show `x402 v2` explicitly.
2. **Live purchase demo** — pick a payer wallet → `TRY REQUEST`:
   - unpaid → **402** with the decoded `PAYMENT-REQUIRED` header rendered as a readable card + the remaining allowance for that trust band
   - `SIGN & PAY` → EIP-3009 signature → retry with `PAYMENT-SIGNATURE` → 200 + `<TxLink>` + the served report
   - a refused agent → **403 and NO price quoted**. Caption it: *"A 402 is an invitation to pay. We do not invite payment from an agent we have refused."*
3. **Payment ledger** — `GET /x402/payments/:actorId`: status · trust band · amount · network · tx · reason. **Includes refusals** — that's the point.

Also show the **rate ladder** as a small table (band → requests/window) sourced from the policy page, so "same resource, different rate per trust" is visible.

---

## 4.10 `/console/policy` — Policy rules (read-only)

The whole authorization model as one table, ordered by priority: priority · name · action type · trust bands · conditions · effect · limits · TTL.

Header states the version (`v2-1.1`) and: **"Ordering is the policy. First match by ascending priority wins."**

Group visually: 10–29 hard stops · 30–49 high-value · 50–59 API & commerce · 60–69 claims · 90+ catch-alls. Highlight the x402 ladder (52–56).

*(No endpoint exposes this yet — either add one or ship it as a static mirror of the seed file. Flag it in the wiring doc as a backend ask.)*

---

## 4.11 `/console/system` — Health & hardening

1. **Readiness** — `GET /ready`. Per dependency: name, up/down, and **its degradation policy** (`HOLD_FOR_REVIEW`, `DEGRADE_TO_UNKNOWN`…). A down dependency shows what it means, not just that it's down.
2. **Dependency matrix** — all 12, split into *authorization-critical* (7) vs *safe to lose* (5), each with its rationale. This is a genuinely impressive screen for a security demo.
3. **Enforcement reconciliation** — drift table: kind · agent · action · urgent. `CHAIN_EXCESS` rows in `signal`. `REPAIR` button is **dry-run by default** with an explicit `--apply` style confirm.
4. **Retention** — per-table policy + what would be pruned. Dry-run only from the UI.
5. **Provenance health** — from `/health`.

---

# 5. `/authority` — Remote Authority (mobile-first)

**Different credential, different layout, different mental model.** This is a *human authority plane*, not a phone-shaped dashboard. Single column, large type, one decision per screen, thumb-reachable actions.

## 5.1 `/authority/login`

Fields: **Operator ID** · **Secret** · device id (auto-generated once, persisted to `localStorage`, shown read-only).

**Button:** `OPEN SESSION` → `POST /v2/control/sessions` → store `{token, expiresAt}`.

Show the session expiry as a **live countdown** in the header from here on. Short sessions are a feature — say so: *"Sessions are short by design. A stolen device stops being an authority plane on its own."*

**States:** wrong credentials → a single generic message (the backend deliberately doesn't distinguish bad-id from bad-secret; don't leak it in the UI either).

## 5.2 `/authority` — Pending queue

Cards, not a table. Each: severity stripe, summary in `font-noir`, subject, **expiry countdown**, and the legal answers as buttons.

Poll every 10s with `<LiveBadge/>`. `<EmptyState>`: *"NOTHING AWAITING YOU."*

## 5.3 `/authority/actions/[id]` — Decide

One screen, one decision.

1. **The ask** — large, `font-noir`.
2. **Context** — agent, trust band, amount, evidence summary. `VIEW EVIDENCE` expands.
3. **The three actions**, full-width, stacked:
   - `check` **APPROVE** (acid)
   - `chevrons-down-up` **LIMIT** (amber) — reveals an amount field
   - `x` **DENY** (signal)
4. **Reason** — free text, required on DENY and LIMIT.
5. If `requiresStepUp` → a **World step-up** block gates the buttons until a passed proof exists.

**Critical implementation detail:** every decision must send back the `bindingHash` from the pending action **and** a fresh single-use `nonce` (generate with `crypto.randomUUID()`). Do not cache or reuse either.

**States:** success → confirmation with what actually changed (capabilities affected, whether the workflow was signalled) · 409 binding mismatch → *"This action changed. Reload before deciding."* · 409 replay → *"Already submitted."* · expired → *"This action expired unanswered. Expiry is a refusal."*

## 5.4 / 5.5 — DEFERRED

`/authority/agents/[id]` (mobile agent view) and `/authority/audit` (audit trail) are **not needed for the demo**. The endpoints exist (`GET /v2/control/agents/:id`, `/evidence`, `/audit`) — build them only if there is time left after MediaPipe.

Note that **FREEZE is already reachable from the decision screen** (5.3) because an incident-raised action offers it, so cutting 5.4 does not cut the freeze moment.

---

# 6. Cross-cutting behaviour

**Polling:** overview 30s · incidents 15s · pending actions 10s · evidence on demand. Pause when the tab is hidden. Never poll `/v2/actors/:id/trust` on a timer — it can trigger a live Graph refresh and burn quota; use `?fresh=false` for background reads and make the live rebuild an explicit button.

**Optimistic updates:** none. Every action here changes real authority, sometimes on-chain. Wait for the response.

**Long operations:** ENS mint, freeze, revoke and x402 settlement are real transactions taking 5–60s. Use a determinate-feeling progress state with the actual step being performed, never a bare spinner.

**Errors:**
| Status | Treatment |
|---|---|
| 400 | inline field errors |
| 401 | re-auth modal (console) / bounce to login (authority) |
| 402 | **not an error** — the payment card |
| 403 | `<ReasonPanel>` — a refusal with a reason |
| 404 | `<EmptyState>` |
| 409 | `<ReasonPanel>` — a state conflict, explain what changed |
| 429 | `<ReasonPanel>` — show when to retry |
| 5xx | the only real error toast |

**Accessibility:** the QR needs a copyable URL fallback. The liveness challenge needs a text description for screen readers and a documented alternative path (World-only assurance, shorter lease). Never rely on colour alone — every badge has a text label.

---

# 7. ⭐ MediaPipe active liveness — full component spec

**This is the piece that does not exist yet and is required for the demo.** The backend half is complete and tested; nothing captures frames.

## 7.1 What it is and why it works this way

The backend issues a random challenge (*"hold up N fingers"*, N ∈ 1–5). The client runs MediaPipe Hand Landmarker in the browser, extracts **21 landmark coordinates per frame**, and posts the coordinate sequence. The server re-derives the finger count geometrically and decides.

**The camera image never leaves the browser.** Only `{x, y, z?}` coordinates are transmitted. This is a privacy requirement (spec §28) and a hard constraint: sending a frame, a data URL, or a crop is a spec violation, not an optimisation.

## 7.2 Package & model

```
npm i @mediapipe/tasks-vision@^1.0.1
```
Model: `hand_landmarker.task` — **self-host it in `/public/models/`**. Do not hotlink a CDN; a demo that dies because a third-party CDN blipped is an avoidable failure.

```ts
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision'

const vision = await FilesetResolver.forVisionTasks('/wasm')   // self-hosted wasm too
const landmarker = await HandLandmarker.createFromOptions(vision, {
  baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' },
  runningMode: 'VIDEO',
  numHands: 1,
})
```

## 7.3 The 21 landmarks

Index order is fixed by MediaPipe and the backend depends on it exactly:

```
0  WRIST
1  THUMB_CMC     2  THUMB_MCP     3  THUMB_IP      4  THUMB_TIP
5  INDEX_MCP     6  INDEX_PIP     7  INDEX_DIP     8  INDEX_TIP
9  MIDDLE_MCP   10  MIDDLE_PIP   11  MIDDLE_DIP   12  MIDDLE_TIP
13 RING_MCP     14  RING_PIP     15  RING_DIP     16  RING_TIP
17 PINKY_MCP    18  PINKY_PIP    19  PINKY_DIP    20  PINKY_TIP
```

**Send all 21, in this order, every frame.** The backend validates `.length(21)` and rejects otherwise. Do not filter, reorder, or drop low-confidence points.

## 7.4 The contract

**Start** → `POST /v2/verification/liveness/start`
```jsonc
{ "actorId": "...", "agentId": "...", "sessionBinding": "<8-200 chars>" }
```
Returns `{ challengeId, nonce, target, instruction, expiresAt }`.
- `target` — how many fingers (1–5)
- `instruction` — pre-written copy, e.g. *"Hold up exactly 3 fingers to the camera."* **Display it verbatim.**
- `expiresAt` — **120 seconds.** Show a countdown.

**Complete** → `POST /v2/verification/liveness/complete`
```jsonc
{
  "challengeId": "...",
  "nonce": "...",                 // echoed exactly from start
  "sessionBinding": "...",        // MUST be byte-identical to start
  "cvVersion": "mediapipe-tasks-vision@1.0.1",
  "frames": [
    { "tMs": 0,   "landmarks": [ {"x":0.51,"y":0.88,"z":0.0}, /* …21 total… */ ] },
    { "tMs": 100, "landmarks": [ /* 21 */ ] }
  ]
}
```
- `frames`: **1–600**. Target ~16–40 frames over ~2–4s at 10Hz.
- `tMs`: milliseconds from capture start, monotonically increasing.
- `x`,`y` normalised 0–1 (MediaPipe's native output — **do not scale to pixels**). `z` optional, pass it through.

Returns `{ challengeId, passed, reason?, failureCode? }`. **Always HTTP 200** — a rejected proof is a valid answer to a valid request, not a client error. Branch on `passed`, never on status.

## 7.5 Capture behaviour that matters

**Start closed, then transition.** The backend wants to see a *change*, not a static pose — a held-up photograph produces a constant landmark set. Guide the user: *"Make a fist… now show 3 fingers."* Capture across the transition, roughly the first quarter closed then the target held.

**Single use.** A `challengeId` cannot be resubmitted — retry means calling `/start` again for a fresh challenge and nonce.

**`sessionBinding`** — generate once per attempt (`crypto.randomUUID()`), 8–200 chars, and send the **identical** string to both endpoints. A mismatch is a rejection.

## 7.6 UI

**Layout:** centred camera view, `4:3`, `border-rule` hairline, `paper` letterbox.

**Overlay:** draw the skeleton on a `<canvas>` above the video — 21 points as small squares, bones as hairlines. Colour by state: `bolt` while searching, `amber` while counting, `acid` when the target is held. **This overlay is the demo.** It makes "the machine is watching geometry, not a photo" legible in one glance.

**The instruction** — huge, Anton, the backend's exact string. A large live finger count beside it.

**Progress** — a hairline bar for frames captured, plus the expiry countdown in `font-tele`.

**Privacy line, always visible**, in `font-tele text-dim`:
> `LANDMARKS ONLY · NO IMAGE LEAVES THIS DEVICE`

Not decoration — it is the truthful description of what the component does, and it is exactly what a judge or a security reviewer will want to see.

**Buttons:** `ENABLE CAMERA` (triggers the permission prompt on an explicit click, never on mount) · `BEGIN CHALLENGE` · `SUBMIT` (auto-fires when enough frames are held) · `RETRY` (full restart from `/start`).

**States**
| State | Treatment |
|---|---|
| permission not asked | explain first, then the button |
| permission denied | `<ReasonPanel>` + the World-only fallback (shorter lease) |
| no camera | same fallback |
| model loading | skeleton + "LOADING VISION MODEL" |
| searching | `bolt`, "SHOW YOUR HAND" |
| counting | `amber`, live count vs target |
| holding | `acid`, progress filling |
| expired | offer `RETRY` (new challenge) |
| submitting | disable everything, real progress |
| passed | big acid tick → step 4 |
| failed | show `reason` + `failureCode` verbatim, then `RETRY` |

## 7.7 Non-negotiables

1. **Never transmit imagery.** No frames, no data URLs, no crops, no thumbnails. Landmarks only.
2. **Never synthesise landmarks.** If detection fails, capture fewer frames and let the backend reject. Fabricating points to "help it pass" defeats the entire mechanism.
3. **Never reuse a `challengeId` or `nonce`.**
4. **Never scale coordinates.** Ship MediaPipe's normalised 0–1 values.
5. **Do not gate on your own client-side count.** Show it for feedback; the server's verdict is the only one that counts. A client that pre-judges is a client an attacker can patch.

---

# 8. Build order

Ship in this order — each stage is demoable on its own.

| # | Stage | Delivers |
|---|---|---|
| 1 | Shell, design tokens, `<Measure>`, `<StatusBadge>`, `lib/semantics.ts`, two API clients | the foundation everything else assumes |
| 2 | `/console/evidence` + `/console/actors/[id]` | **The Graph story** — demo screen 0 |
| 3 | `/console/agents` + `/console/agents/[id]` | the roster |
| 4 | **MediaPipe component (§7)** standalone | the missing piece — build and test it in isolation first |
| 5 | `/console/agents/new` full wizard | **demo screens 1–4** |
| 6 | `/console/intents` + execution gate | **demo screen 6** |
| 7 | `/console/incidents` | **demo screens 8–9** |
| 8 | `/authority` login + queue + decide (2 screens) | **demo screen 10** — mobile freeze |
| 9 | `/console/commerce` | **demo screen 7** |
| 10 | `/console/policy`, `/console/system`, overview polish | depth for judges |

**Stage 4 is the critical path.** It's the only genuinely new capability; everything else is calling endpoints that already work and are tested. Build it standalone against a hardcoded actor id before wiring it into the wizard.

---

# 9. Open items for the backend

Flag these rather than working around them:

1. **No aggregate stats endpoint** for the overview tiles — currently derived client-side from lists.
2. **No policy-rules endpoint** — `/console/policy` needs one, or ships as a static mirror.
3. **No push channel** — `/authority` polls. Fine for the demo; a real product wants push.
4. ~~Nothing raises pending actions automatically~~ — **FIXED.** A `HIGH` or `CRITICAL` incident now raises a pending action automatically (one per incident, `allowed: [APPROVE, LIMIT, FREEZE]`, none for `LOW`). The phone lights up on its own; no manual POST in the demo. *(A parked authorization workflow still does not raise one — deliberately out of scope, the incident path is the one the demo uses.)*
5. **No pagination** on list endpoints — they cap at 50/100. Fine for the demo, needs cursors for real use.
6. **Self-host the MediaPipe wasm + model** — add `/public/wasm` and `/public/models` to the build.
