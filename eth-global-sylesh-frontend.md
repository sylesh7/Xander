# SYBIL SHIELD — FRONTEND BUILD DOC
## Page-by-page raw structure, mapped to the locked backend

No colors, no CSS, no design tokens — that's your template's job. This is: which raw components exist on each page, what data they need, and exactly which backend call fills them, so wiring is a copy-paste job once your template skin is on.

Two personas, two flows. **Claimant Flow** (pages 1–4) is "Campaign Mode" — the live demo path a wallet actually goes through to claim. **Operator Flow** (pages 5–8) is "Investigation Mode" — the judge/protocol-operator view that proves the system isn't hardcoded to one wallet.

---

## 0. Shared conventions (apply to every page)

- **API base URL** — one env var (`NEXT_PUBLIC_API_BASE_URL` or equivalent), never hardcoded per-page.
- **Auth header** — every request to the backend sends `X-API-Key` (Backend-Sylesh Phase 22). Store it server-side (a Next.js route handler / BFF layer) rather than shipping it to the browser if you can — the key protects quota-bound Graph/World calls.
- **Decision enum** — every screen that shows a claim outcome uses the same four values, always: `ALLOW`, `CHALLENGE`, `BLOCK`, `PENDING_REVIEW`. Build one shared "Decision Badge" component (below) rather than four different ad-hoc labels across pages.
- **Every page needs three states minimum**: loading, error (backend unreachable / non-2xx), and empty (valid response, no data yet — e.g. a wallet with no evidence). Don't skip empty state — a wallet with zero history is a real, common case, not an edge case.
- **⚠️ One backend gap to flag before you build pages 5 and 6**: the locked API surface (Backend-Sylesh Phase 22) has `GET /clusters/:id` and `GET /wallets/:address/risk` (single-item lookups) but **no list endpoint** for "all claims in a campaign" or "all flagged clusters in a campaign." The operator dashboard (page 5) and a cluster browser need one. Recommended addition to hand back to Sylesh: `GET /campaigns/:id/claims` and `GET /campaigns/:id/clusters`, both paginated. Until that exists, page 5 can only show the single campaign summary, not a browsable list — build the page shell now, wire the list once the endpoint exists.

---

## Shared components (built once, reused across pages)

- **Nav Bar** — product name/logo, a mode indicator (Claimant / Operator, if both flows live in one app), wallet-connect status on the claimant side.
- **Wallet Connect widget** — standard connect button + connected-address display. Whatever your template already has for this is almost certainly enough; nothing product-specific here.
- **Decision Badge** — one component, four states (`ALLOW` / `CHALLENGE` / `BLOCK` / `PENDING_REVIEW`). This is product-specific — your template won't have it prebuilt.
- **Provenance Footer** — small strip showing `source type`, `deployment id`, `block number`, `observed at`. Used under every piece of evidence anywhere in the app (cluster evidence, evidence receipt). Product-specific, build once, reuse everywhere — this is the "why should I trust this number" element and it appears a lot.
- **Feature Breakdown List/Table** — rows of `{ feature name, value }` (`FUNDING_CORRELATION`, `TIMING_CORRELATION`, etc.). Used on Cluster Detail and Evidence Receipt. Product-specific.
- **Countdown Timer** — a simple "expires in Xs" display, driven by a Unix timestamp. Used once, on the World Verification page.
- **Status Poller** — a small hook/utility, not a visual component: polls a `GET` endpoint on an interval until a terminal state, used on both the Verification page (World proof status) and Cluster Detail (investigation status). Build it once, parameterize the endpoint.

---

## CLAIMANT FLOW — Campaign Mode

### Page 1 — Campaign Landing
**Route:** `/campaign/[campaignId]`
**Purpose:** entry point. A claimant lands here, connects a wallet, starts a claim.

**On the page:**
- Nav Bar
- Campaign info card — name, description, claim-window status. Populated from `GET /campaigns/:id`.
- Campaign stats strip (optional, only if `GET /campaigns/:id` returns aggregate counts — allowed/challenged/blocked totals)
- Wallet Connect widget
- "Start Claim" button — disabled until wallet connected, routes to Page 2

**Backend calls:** `GET /campaigns/:id` on load.
**States:** loading campaign, campaign not found, wallet not connected, ready to claim.

---

### Page 2 — Claim Screening
**Route:** `/campaign/[campaignId]/claim`
**Purpose:** fires the actual risk check, shows the immediate outcome, routes onward.

**On the page:**
- Nav Bar
- Connected wallet address card
- "Screen My Claim" trigger (either an explicit button, or auto-fires on mount — your call, not a backend constraint)
- Loading state while the check runs
- Decision Badge once resolved
- Risk summary card — score, confidence, cluster id — **only rendered for `CHALLENGE`/`BLOCK`/`PENDING_REVIEW`.** For `ALLOW`, skip straight to a success state with no friction; showing risk internals to a clean wallet defeats the "frictionless for legitimate users" point of the whole product.
- Continue button, routes by decision: `ALLOW` → Page 4 (result), `CHALLENGE` → Page 3 (verification), `BLOCK` → Page 4 (result, blocked state), `PENDING_REVIEW` → a plain "under review, check back shortly" holding state (no retry loop needed here — it's a manual/backend-side follow-up case, not something the claimant can resolve by clicking again)

**Backend calls:** `POST /screen-claim` — body `{ wallet, campaignId }`, response `{ decision, clusterId, riskScore, requiredAssurance, evidenceReceiptId }`.
**States:** idle, submitting, `ALLOW`, `CHALLENGE`, `BLOCK`, `PENDING_REVIEW`, error.

---

### Page 3 — World Verification
**Route:** `/campaign/[campaignId]/verify`
**Purpose:** the Selfie Check escalation. Only ever reached from a `CHALLENGE` decision.

**On the page:**
- Nav Bar
- Short explanation card ("additional verification needed" — keep the copy generic here, don't try to render the raw feature list on this screen, that's what the Evidence Receipt is for)
- QR code display area — renders the `connectorURI` the IDKit request returns, for desktop/cross-device scanning
- "Open in World App" deep-link button — same `connectorURI`, for mobile-native handoff
- Invite-code fallback display — a 6-character code, if you're using IDKit's invite-code mode instead of/alongside QR (confirmed real alternative flow, useful if QR scanning is awkward in a demo setting)
- Countdown Timer, driven by the request's `expiresAt`
- Status Poller output — a plain status line: waiting for connection / awaiting confirmation in World App / verifying / success / failed
- "Cancel / Restart" action — re-triggers `POST /world/challenge` if the window expired

**Backend/SDK calls, in order:**
1. `POST /world/rp-signature` on mount — body `{ action }`, response `{ sig, nonce, created_at, expires_at }`. **This must complete before the IDKit widget can even build a request** — don't render the QR/button until this resolves.
2. Client-side IDKit call using that signature (`@worldcoin/idkit` React widget or `idkit-core` directly), requesting the `selfieCheckLegacy` preset, `signal` = the wallet address.
3. Poll for completion (IDKit's own polling, or your Status Poller wrapping it).
4. On completion, `POST /world/verify` — body `{ rp_id, idkitResponse, claimId }`.
5. `POST /claim/finalize` once verification resolves.
6. Route to Page 4 with the final decision.

**States:** fetching RP signature, awaiting scan/connection, awaiting confirmation, verifying with backend, success, failed/rejected, expired.

---

### Page 4 — Claim Result
**Route:** `/campaign/[campaignId]/result`
**Purpose:** final outcome screen, terminal state of the claimant flow.

**On the page:**
- Nav Bar
- Large status card — claimed / blocked / under review — driven by whatever decision state got passed in from Page 2 or Page 3
- Claim reference id
- "View Evidence Receipt" link → Page 8, using the `evidenceReceiptId` carried from Page 2's response
- "Back to Campaign" link → Page 1

**Backend calls:** none new — this page just renders state handed off from the previous step.
**States:** allowed/success, blocked, under review, error (missing/invalid claim reference).

---

## OPERATOR FLOW — Investigation Mode

### Page 5 — Operator Dashboard
**Route:** `/operator/campaigns/[campaignId]`
**Purpose:** protocol-operator's view of a campaign's health. This is the page that needs the backend list-endpoint addition flagged in Section 0.

**On the page:**
- Nav Bar (operator context)
- Campaign summary card — from `GET /campaigns/:id`
- Recent claims table — wallet, decision, timestamp, link to receipt *(needs `GET /campaigns/:id/claims`, not yet in the locked API — build the table shell now, wire once it exists)*
- Flagged clusters table — cluster id, risk score, wallet count, link to Page 6 *(needs `GET /campaigns/:id/clusters`, same caveat)*
- Search bar — free-text search by wallet address or cluster id, routes to Page 6 or Page 7

**Backend calls:** `GET /campaigns/:id`, plus the two flagged additions.
**States:** loading, no claims yet (empty), populated.

---

### Page 6 — Cluster Detail
**Route:** `/operator/clusters/[clusterId]`
**Purpose:** the core explainability screen — "why is this cluster flagged."

**On the page:**
- Nav Bar
- Cluster summary card — cluster id, confidence, risk score, wallet count
- Member wallet list — each entry links to Page 7
- Feature Breakdown List — from `GET /clusters/:id`
- Evidence source list — from `GET /clusters/:id/evidence`, each item with its own Provenance Footer
- "Investigate with AI" button — triggers `POST /investigations`
- Investigation result panel — polls `GET /investigations/:id`, shows the agent's explanation once ready. Keep this visually separate from the deterministic Feature Breakdown above it — the product's core safety property is that this panel *explains*, it never *decides*, and the page layout should make that boundary obvious, not just the copy.

**Backend calls:** `GET /clusters/:id`, `GET /clusters/:id/evidence`, `POST /investigations` (body `{ clusterId }`), `GET /investigations/:id` (poll).
**States:** loading, investigation not started, investigation running, investigation complete, investigation failed/timeout.

---

### Page 7 — Wallet Risk Lookup
**Route:** `/operator/wallets/[address]`
**Purpose:** standalone risk lookup for any wallet — the "type an address, see what we know" tool.

**On the page:**
- Nav Bar
- Address search input
- Wallet risk summary card — score, confidence
- "View Cluster" link → Page 6, only shown if the wallet is clustered
- Empty state for a wallet with no evidence yet (a real, common case — not an error)

**Backend calls:** `GET /wallets/:address/risk`.
**States:** idle/search, loading, found + clustered, found + clean, not found/no evidence.

---

### Page 8 — Evidence Receipt
**Route:** `/receipts/[receiptId]`
**Purpose:** the reproducible "why" artifact. Linked from both flows — Page 4 (claimant) and Page 5/6 (operator) — so it needs to read fine as a standalone, shareable page, not just as a drill-down.

**On the page:**
- Nav Bar
- Decision summary card — decision, risk score, confidence, **policy version** (this is the field that makes the receipt reproducible even after weights get retuned later — don't drop it from the display)
- Feature Breakdown List
- Evidence source list, each with a Provenance Footer
- World verification summary block — challenge id, status, required assurance — only rendered if the claim actually escalated to World
- Created-at timestamp

**Backend calls:** `GET /receipts/:id`.
**States:** loading, found, not found.

---

## Suggested build order (matched to backend phase completion, not arbitrary)

1. **Page 1 + Page 2** — buildable as soon as Backend-Sylesh Phase 22's `POST /screen-claim` and Backend-Suganthan Phase 8 (scoring) are live. This is your fastest path to an end-to-end demo of the frictionless-`ALLOW` path.
2. **Page 4** — trivial once Page 2 exists, build it right after.
3. **Page 8 (Evidence Receipt)** — as soon as Backend-Sylesh Phase 21 exists. Worth building early even though it's "operator flow" — it's the single best page for showing judges the product actually reasons about evidence, and it has zero World dependency.
4. **Page 3 (World Verification)** — gate this on Backend-Sylesh Phase 16–19 all being done together (RP signature, request contract, verify, wallet binding). Don't start it until all four exist; a half-wired World flow is worse for demo rehearsal than not having it yet.
5. **Page 6 + Page 7** — as soon as Backend-Suganthan's cluster/risk endpoints and Backend-Sylesh's MCP investigation (Phase 15) are live.
6. **Page 5** — last, and only fully functional once the two flagged list endpoints (Section 0) exist on the backend.
