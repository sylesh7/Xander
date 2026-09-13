# World Selfie Check — developer feedback

**Track:** World, Selfie Check ($3,500 pool, up to 3 teams at ~$1,166 each)
**Submitted by:** Xander (`backend/src/world/*`, `frontend/`)
**Written by:** Sylesh, the person who actually wired this integration

This is the qualification-requirement feedback document for the Selfie Check track. Everything below happened while building a real, working integration — not a review written from the docs alone. Where something is a direct quote (an error body, a doc comment, a type definition), it's marked as such rather than paraphrased, because the whole point of this document is to be checkable.

For the app itself: Selfie Check gates the escalation step in Xander's risk engine — a wallet only sees it once a deterministic, evidence-based risk score actually crosses a threshold — and, in the later "V2" layer, backs an agent's `AssuranceLease` (the thing that lets an AI agent hold any authority at all). Full flow and code pointers are in the [main README](Readme.md#world-id--selfie-check-as-a-selective-signal). A real phone running the real World App completed a real Selfie Check that this backend accepted end to end on 2026-09-09.

---

## 1. SelfieCheck docs and integration flow

The RP-signature model itself is well-designed and the docs communicate it fine: sign server-side with a secret key that never reaches the client, hand the client a signed request config, let IDKit take it from there. No complaints about the *shape* of the flow.

Where the docs fell short was the exact contract of the client SDK types, which cost real debugging time on two separate bugs:

- **`app_id` is not documented as a distinct, required field from `rp_id`.** The real `IDKitRequestConfig` type (from the installed `@worldcoin/idkit-core@4.2.4` package, `node_modules/@worldcoin/idkit-core/dist/index.d.ts`) requires `app_id: \`app_${string}\`` with no `?` — a hard requirement, not an alternate spelling of `rp_id` used interchangeably the way it appears to be on the verify endpoint. Nothing in the docs we could find called this out; we only found it by reading the shipped type definitions directly. Our first request-config builder never returned `app_id` at all, which meant the client SDK couldn't construct a request — a hard, silent stop before any user-facing flow even started.
- **`allow_legacy_proofs: true` is required, but the reason lives in a doc *comment* inside the SDK, not in the integration guide.** `selfieCheckLegacy`'s own doc comment says it "only returns World ID 3.0 proofs" — which is what tipped us off that we needed this flag. This should be front-and-center in the public integration docs for anyone doing Selfie Check specifically, not something you find by reading source.
- **The response shape for a completed proof is under-documented.** Every real `IDKitResult` variant (V3, V4, session) carries `nullifier` and `signal_hash` **inside `responses[0]`**, never at the top level. We originally read the top level only, which meant a *genuinely successful* proof would have thrown "Verified proof carried no nullifier" on every real attempt — invisible in our own tests because our hand-written fixtures happened to put the fields where our (wrong) code expected them. This is exactly the kind of mismatch integration docs exist to prevent, and it wasn't caught until we stopped trusting our assumptions and read the actual type definitions.
- **The backend verify endpoint's response shape (success and error) is not documented anywhere we could confirm.** We ended up writing tolerant parsing that checks both a flat shape and a `responses[0]`-nested shape, on both the request payload and World's own verify response, because we could not find an authoritative reference for either.

## 2. Developer Portal navigation, search, product discovery, and debugging guidance

- **Selfie Check feature-flag access is a manual, email-based approval step** (`developers@toolsforhumanity.com`), not something self-serve in the portal. This was, in our own project tracking, "the long pole, and it is a human-approval step, not a coding one" — it blocked live verification for days while everything else (RP signing, request-config building, backend verify logic) was already done and waiting. A visible request-status indicator in the portal itself (pending / granted / denied) would have saved us from repeatedly re-checking email and guessing whether the request had even been received.
- We did not find in-portal debugging tooling that would have shortened the two bug hunts described above — e.g. a portal-side request/response inspector for a specific `action`/`rp_id`, or a way to replay a captured proof against different environments from the UI rather than curl. Everything we debugged, we debugged from raw HTTP responses.
- Search/discovery for "what does a Selfie Check proof actually look like once verified" specifically (as opposed to World ID's other verification levels) was hard — most results we found while researching were about Orb/Device verification levels, not Selfie Check's own proof shape.

## 3. Sandbox App states, proof flows, test users, errors, and edge cases

This is where we hit the single most expensive piece of confusion in the entire integration, so it gets its own subsection.

### Simulator/staging vs. real device/production — undocumented, and it silently produces a proof that looks valid

World's simulator tool (the one referenced by the spec/docs path we were following) issues proofs against the `staging` environment. That became our default (`environment: 'staging'`) everywhere, including the frontend, because it was the **confirmed, documented** path for testing before real device access was granted.

**A real phone running the real World App does not generate `staging` proofs — it generates `production` proofs, unconditionally.** Nothing we found in the docs states this distinction up front, or warns that a real-device test will silently fail if your app is still configured for the simulator's environment. We only discovered it by capturing a real, valid proof from a real phone and replaying it directly against `developer.world.org`, which returned:

```json
{"code":"environment_mismatch","detail":"This proof was generated for the production environment, but this request uses staging..."}
```

That error message, once triggered, is clear and actionable — full credit for that. The problem is entirely upstream of it: there is no signal *before* you plug in a real device that "the environment your docs told you to use for testing is not the environment a real device will produce," so a team following the documented simulator-first path will hit this exact wall the first time they test with an actual phone, with no warning. We'd flag "simulator/sandbox proofs and real-device proofs are scoped to different environments, and a real device is always `production`" as a one-line addition that would have saved us a full debugging cycle.

### Rejection bodies carry useful detail that isn't obviously part of the "expected" response shape

A rejected verification returns a body with `detail`/`code`/`error`/`message` fields (which one appears seems to vary), but nothing in the integration guide walks through this — we initially discarded a rejection down to a bare HTTP status code (`"World rejected the proof (400)"`), which is technically correct but threw away the one piece of information (the `environment_mismatch` detail above) that actually explained what was wrong. Once we started extracting and surfacing the full body, debugging got dramatically faster. Worth documenting as the expected shape for a rejected `/verify` call.

### The success/error response shape mismatch between what a client expects and what the API returns

Our own backend's error response is `{ status, challengeId, reason }` — no `message` key — which is unremarkable on its own, but it's representative of a broader pattern we ran into with World's API too: several places return meaningful detail under a field name other than `message`, and a naive client (ours included, at first) that only checks `.message` silently shows a useless one-line summary instead of the real reason. Not strictly a World bug, but a documentation gap: an explicit "here are all the field names that might carry the actual reason, check all of them" note would help every integrator, not just us.

### The uniqueness signal's shape is still unconfirmed

Even after a live, successful, real-device verification, we could not confirm from World's response or docs whether the uniqueness signal is returned as a threshold-able number or a boolean. We deliberately left it unweighted in our policy engine rather than guess — but this remains an open question for us, and probably for other teams doing risk/fairness/eligibility scoring specifically (the exact use case this track is asking for), since a scoring system needs to know the real type to use the signal correctly.

### What test users / sandbox states we didn't get to exercise

We never found a documented way to exercise "verified" as a *sandbox* outcome without a real device once we moved past the simulator stage — everything past that point required a real phone and a real biometric check. For a track explicitly asking for risk/eligibility/fairness/continuity/abuse-prevention framing, being able to generate a range of sandboxed outcomes (verified, rejected-for-reason-X, replayed-nullifier) without needing a physical device each time would make it much easier to build and test the downstream decision logic this track cares about.

## 4. What was confusing, missing, broken, or hard to test — summary

| # | Issue | Where it cost us time |
|---|---|---|
| 1 | `app_id` undocumented as a separate required field from `rp_id` | Request construction failed outright until fixed |
| 2 | `allow_legacy_proofs` requirement only discoverable via an SDK doc comment | Silent, un-signaled requirement |
| 3 | `nullifier`/`signal_hash` nested under `responses[0]`, not top-level, undocumented | Every real proof would have failed verification silently |
| 4 | No documented backend verify request/response shape | Had to write defensive, "tolerant of either" parsing |
| 5 | **Simulator (`staging`) vs. real device (`production`) environment split, undocumented** | The single largest source of confusion — a real phone's proof is unconditionally rejected by an app still configured for the documented simulator path |
| 6 | Rejection-body detail fields not documented as the way to get the real reason | Early error handling hid the actual, actionable cause |
| 7 | Uniqueness-signal return type (number vs. boolean) unconfirmed even post-verification | Left unweighted in our scoring rather than risk a wrong assumption |
| 8 | Selfie Check feature-flag access is manual/email-only, no visible status | Multi-day blind wait with no portal-side confirmation |
| 9 | No sandbox path for varied verified/rejected/edge-case outcomes without a physical device | Hard to build and test downstream risk/eligibility logic against realistic failure modes |

### What worked well, for balance

- The RP-signature model (sign server-side, never expose the signing key) is a genuinely good design for exactly the kind of backend-gated escalation this track asks for, and needed no workarounds.
- The documented 90-day proof-validity window was accurate and matched our implementation with no surprises.
- Once the real request/response shapes were understood (via the SDK's own type definitions), the flow itself — request, scan, proof, verify — worked reliably and reproducibly across multiple real runs.
- The `environment_mismatch` error, once triggered, was specific and immediately actionable — the gap is entirely that nothing warns you about the simulator/production split *before* you hit it.

---

All items above are drawn directly from `backend/docs/PROGRESS-SYLESH.md` (Phases 16–19) and the live-verification runs on 2026-09-09, cross-checked against `backend/src/world/*` and `frontend/lib/api/*` at the time of writing, rather than written from memory or general impression.
