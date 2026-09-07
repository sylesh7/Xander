# Backend-Suganthan — Progress

**Track:** Evidence & Risk Engine, Phases 1–12 of 25
**Spec:** `../../Backend-Suganthan.md`
**Sponsor track:** The Graph (Token API, Standardized Subgraphs, Substreams). No World surface in this track.

Update this file at the end of each phase. Sylesh reads it to know what they can rely on.

---

## Status board

| Phase | Scope                                               | Status                                          |
| ----- | --------------------------------------------------- | ----------------------------------------------- |
| 1     | Access & credentials (Graph) + local infra          | 🟡 Partial — infra done, credentials pending    |
| 2     | Repo scaffold + shared schema + env config          | ✅ **Done**                                     |
| 3     | Token API client                                    | ⬜ Not started — blocked on 1.1                 |
| 4     | Standardized Subgraphs client + Deployment Registry | ⬜ Not started — blocked on 1.2 / 1.3           |
| 5     | Evidence Normalizer                                 | ⬜ Not started — _no credentials needed_        |
| 6     | Behavior Graph & Clustering                         | ⬜ Not started — _no credentials needed_        |
| 7     | Risk Engine: feature extractors                     | ⬜ Not started — _no credentials needed_        |
| 8     | Robust baselines, scoring, policy bands             | ⬜ Not started — _no credentials needed_        |
| 9     | Substreams Rust module                              | ⬜ Not started — **long pole, start early**     |
| 10    | Substreams Node bridge + cache invalidation         | ⬜ Not started — blocked on 9                   |
| 11    | Provenance & freshness guarantees                   | ⬜ Not started                                  |
| 12    | Testing, seed data, Sylesh interface                | 🟡 Partial — interface stubbed early, see below |

---

## ✅ Phase 2 — Done

Everything below is built, running, and verified on this machine.

### Delivered

| File                                      | What it is                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                            | Node 20+, ESM, scripts for dev/build/test/lint/db/infra                                                                                   |
| `tsconfig.json`                           | TypeScript **strict**, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters`, `verbatimModuleSyntax` |
| `eslint.config.js`                        | ESLint 9 flat config + typescript-eslint                                                                                                  |
| `.prettierrc`                             | Formatting                                                                                                                                |
| `prisma/schema.prisma`                    | **The locked shared schema**, all 11 models                                                                                               |
| `prisma/seed.ts`                          | Skeleton with a section per person                                                                                                        |
| `docker-compose.yml`                      | `postgres:16` + `redis:7`, both healthchecked                                                                                             |
| `.env.example`                            | Both tracks' variables, sectioned                                                                                                         |
| `src/config/env.ts`                       | zod-validated env — the only file that may read `process.env`                                                                             |
| `src/lib/logger.ts`                       | pino                                                                                                                                      |
| `src/lib/prisma.ts`                       | Single `PrismaClient`                                                                                                                     |
| `src/server.ts`                           | Bare Express + `/health` (**Sylesh owns this from Phase 22**)                                                                             |
| `src/interfaces/evidence-risk-api.ts`     | The seam with Sylesh — typed, signatures final                                                                                            |
| `src/interfaces/stub-fixtures.ts`         | Deterministic stub responses; deleted at Phase 12                                                                                         |
| `test/env.test.ts`, `test/health.test.ts` | vitest + supertest                                                                                                                        |

### Verified, not assumed

```
npm run typecheck        clean
npm run lint             clean
npm test                 4/4 passing
docker compose up -d     postgres ready, redis PONG
prisma migrate dev       migration 20260907054526_init_shared_schema applied
psql \dt                 11 models + _prisma_migrations present
npm run db:seed          runs clean
GET /health              -> {"ok":true}
```

That covers the Phase 2 acceptance test in the spec: _"`prisma migrate dev` runs clean against the schema in 0.4; `npm run dev` boots a bare Express server and `/health` returns `{ ok: true }`."_

### Three decisions I had to make (the spec was ambiguous)

1. **Schema path is `backend/prisma/schema.prisma`.** The spec gives three different paths: Section 0.4 says `db/prisma/schema.prisma`, the Section 0.5 tree shows it nested under `src/`, and Phase 12 (plus Sylesh's Phase 23) both say `prisma/seed.ts`. Only the seed path is consistent across both documents, so the schema sits next to it. This also matches Prisma's own convention. **Sylesh: `prisma/schema.prisma` is the real location.**

2. **`generator` and `datasource` blocks were added.** Section 0.4 starts at the first `model`, so it isn't a runnable schema on its own. Everything from `model DeploymentRegistryEntry` down was extracted programmatically from the markdown rather than retyped, so it is byte-identical to the spec.

3. **`.env` loads via Node's native `--env-file`**, not a `dotenv` dependency. Node 20.6+ supports it natively, and it parses the spec's inline `# Phase 1 — …` comments correctly.

### One thing worth knowing

`env.ts` being "the only file that reads `process.env`" is **mechanically enforced**, not a convention. ESLint's `no-restricted-properties` bans `process.env` repo-wide and whitelists exactly one file. This is verified — a scratch file using `process.env` fails lint with a message pointing at Section 0.2.

---

## 🟡 Phase 1 — What's left (only Suganthan can do these)

| #   | Item                                                      | Status                                                     |
| --- | --------------------------------------------------------- | ---------------------------------------------------------- |
| 1.1 | Graph Market account + Token API JWT                      | ⬜ **Blocking Phase 3**                                    |
| 1.2 | Gateway API key from Subgraph Studio                      | ⬜ **Blocking Phase 4** — also hand to Sylesh for Phase 15 |
| 1.3 | Deployment IDs (`Qm…`) for 2–3 protocols                  | ⬜ **Blocking Phase 4**                                    |
| 1.4 | Local Postgres + Redis                                    | ✅ Done                                                    |
| 1.5 | Confirm Start Fresh vs. Continuity on the live prize page | ⬜                                                         |

**Acceptance test still outstanding:** a `curl` against `https://token-api.thegraph.com/v1/evm/balances?network=mainnet&address=<real address>` with the bearer token returns real data, not a 401.

---

## Recommended order from here

The spec numbers phases 1→12, but that isn't the fastest safe path, because **half this track needs no credentials at all**:

1. **Fire off Phase 1.1–1.3 now** — account signups have real latency.
2. **While waiting, build 5 → 6 → 7 → 8** against synthetic fixtures. The normalizer, clustering and all five feature extractors are pure functions testable with fabricated `EvidenceEvent` rows; they never touch the network.
3. **Start Phase 9 (Substreams/Rust) early and in parallel.** The spec is blunt that it's days, not hours, if Rust/protobuf/WASM are new. The scaffold removes guesswork, not the learning curve.
4. **Phases 3 and 4** the moment credentials land.
5. **Phases 10 → 11 → 12** to close out.

Phase 12's interface file was pulled forward into Phase 2 deliberately — see `EVIDENCE-RISK-INTERFACE.md`.
