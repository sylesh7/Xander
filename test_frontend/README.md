# Xander — World ID Selfie Check tester

A basic, single-page dev/QA tool for exercising Xander's real Claim Gate API
and World ID Selfie Check flow end to end. Every button makes a real network
call — nothing here is mocked or simulated.

```
/screen-claim → /world/rp-signature → IDKit (real WASM signing) →
World's real bridge → /world/verify → /claim/finalize → /receipts/:id
```

## What this actually proves, verified live on 2026-09-09

A real phone, with a real World App, completed a real Selfie Check against
this tool end to end:

1. Real `POST /screen-claim` → real `CHALLENGE` decision.
2. Real `POST /world/rp-signature` → a genuine ECDSA signature.
3. Real `@worldcoin/idkit-core` WASM signing → a genuine, redeemable
   `https://.../verify?...&c=<code>&a=<app_id>` link.
4. **A real phone scanned it and completed the biometric check** — World App
   returned a genuine `protocol_version: "3.0"` proof with a real merkle root,
   nullifier, and proof bytes. This confirms Selfie Check preview access
   (Phase 13 in `Backend-Sylesh.md`) is granted for this app; that gate is
   cleared.
5. Real `POST /world/verify` → World's own endpoint accepted the proof once
   the environment setting matched (see below).

## Real bugs this page's construction found and fixed

Building this against the *actual installed* `@worldcoin/idkit-core` types,
and then testing with a real phone, surfaced defects a spec-reading pass alone
could not have caught:

1. **`app_id` was missing from the backend's IDKit config.** The real
   `IDKitRequestConfig` type requires it as a separate, mandatory field from
   `rp_id` — a request cannot be constructed without it. Fixed in
   `backend/src/world/idkit-request-config.ts` (`requireWorldAppId()` added to
   `backend/src/config/env.ts`).
2. **`extractProofFields` read the wrong response shape.** A real IDKit result
   nests `nullifier`/`signal_hash` inside `responses[0]`, not at the top
   level — confirmed against the real type definitions and against
   `selfieCheckLegacy`'s own doc comment ("only returns World ID 3.0 proofs").
   The original code would have thrown "no nullifier" on every genuine
   successful proof. Fixed in `backend/src/world/idkit-verify.ts`.
3. **World's rejection reason was discarded down to just a status code.**
   `verifyWorldProof`'s `REJECTED` outcome reported only `"World rejected the
   proof (400)"`, dropping World's own `detail` field entirely. Against a
   *genuinely valid* proof this hid the actual, actionable reason. Fixed to
   surface `detail`/`code`/`error`/`message` from World's response body.
4. **The frontend's own error handling hid the same detail a second time.**
   `/world/verify`'s non-2xx body is `{ status, challengeId, reason }` — no
   `message` key — but the frontend only ever checked `.message`, so it showed
   a useless `"400: HTTP 400"` no matter what the backend actually said. Fixed
   in `src/api.ts` to check `message`/`reason`/`error` and to render the full
   response body, not just a one-line summary (`showError` in `src/main.ts`).
5. **The default World environment was wrong for a real device.** A real
   phone's real World App generates **production**-environment proofs. This
   page defaulted to `staging` (Section 13.3's confirmed path for World's
   *simulator* tool, `simulator.worldcoin.org` — not a real device). World's
   own verify endpoint rejected an otherwise-valid, genuine proof with:
   > `environment_mismatch`: "This proof was generated for the production
   > environment, but this request uses staging. Set environment to
   > 'production' or generate a new staging proof."

   Confirmed by replaying the exact real proof directly against
   `developer.world.org` outside the app. Default changed to `production`.

See `backend/docs/API-CONTRACT.md`, "Building the real IDKit request from
these two responses," for the exact field mapping (`sig` → `signature` is the
one every integration gets wrong first).

## If you hit a 409 on Step 4

`/screen-claim` is idempotent per `{wallet, campaignId}` — replaying an
already-decided claim returns its **original** challenge, which may have since
resolved or expired (e.g. from an earlier test run). Step 2's card has a
**"POST /world/challenge (re-issue)"** button for exactly this: it gets a
fresh challenge for the same claim, then clears the stale RP signature/proof
so you redo Steps 2–3 cleanly. Simpler alternative: change the **Campaign ID**
field to start a brand-new claim.

## Running it

```bash
# 1. Backend must be running with real World + Graph credentials in .env
cd backend
npm run infra:up && npm run db:migrate && npm run db:seed
npm run dev                    # http://localhost:3000

# 2. This frontend, in a separate terminal
cd frontend
npm install
npm run dev                    # http://localhost:5173
```

Open `http://localhost:5173`. The **Backend base URL** field defaults to
`/api`, which Vite's dev server proxies to `http://localhost:3000` (see
`vite.config.ts`) — this avoids needing to add CORS middleware to the backend
just for a local test page. Point it at the real backend URL directly if not
using the Vite dev server (e.g. after `npm run build` + `npm run preview`).

Enter your `BACKEND_API_KEY` (from `backend/.env`) into the **X-API-Key**
field. The **Wallet** field is pre-filled with a real seeded wallet
(`FIXTURE_CHALLENGE_WALLET`, `backend/src/claim/fixtures.ts`) whose cluster
reliably scores into the CHALLENGE band, so the first click gets you straight
to a real Selfie Check prompt instead of a dead-end ALLOW.

Then work through the steps in order — each one is gated until the previous
one succeeds, matching the real ordering rule (`POST /world/rp-signature`
*must* happen before IDKit opens). The **Activity log** at the bottom shows
the raw request/response JSON for every call, timestamped — this is the actual
debugging surface, not decoration.

## A real Vite dev-mode gotcha, already fixed here

`@worldcoin/idkit-core` loads a genuine 870KB WASM module via
`new URL('idkit_wasm_bg.wasm', import.meta.url)`. Under Vite's default
dev-mode dependency pre-bundling, that reference resolves to a path Vite's
dev server has nothing to serve, which silently falls back to serving
`index.html` — the browser then tries to `WebAssembly.instantiate()` an HTML
page and fails with a byte-level error (`expected magic word ... found 3c 21
64 6f`, i.e. the bytes of `<!do`). Found by running the real page in a real
browser, not by inspection. Fixed via `optimizeDeps.exclude` in
`vite.config.ts`, which makes Vite serve the package as native ESM straight
from `node_modules` instead. `npm run build` (Rollup) was never affected —
this is dev-server-only.

## What this is not

This is a debug/QA tool for a local backend, not a production frontend. The
API key is entered into a form field and kept in `localStorage` for
convenience across reloads — do not point it at a production `BACKEND_API_KEY`
or deploy this page publicly as-is.
