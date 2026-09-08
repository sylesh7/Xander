---
name: xander-backend
description: Architecture rules and ownership boundaries for the Xander backend. Use whenever writing, reviewing, or planning code in backend/ — risk scoring, clustering, evidence normalization, the Prisma schema, env config, the Suganthan/Sylesh interface seam, or any file under src/. Also use when asked "what phase am I on", when adding a protocol/chain/weight, or when a change touches prisma/schema.prisma, prisma/seed.ts, .env.example, src/config/env.ts, or src/server.ts.
---

# Xander — backend engineering rules

Two-person backend, 25 phases. Specs are `Backend-Suganthan.md` (Phases 1–12,
Evidence & Risk Engine) and `Backend-Sylesh.md` (Phases 13–25, Decision,
Escalation & API) at the repo root. Code lives in `backend/`.

**Before implementing a phase, read that phase's section in the spec.** The specs
carry verified endpoint shapes, formulas, and acceptance tests. Do not work from
memory or from this skill alone.

## The six non-negotiable rules (Section 0.2)

These are correctness requirements, not style preferences. A change that breaks
one of them is wrong even if it passes tests.

1. **No hardcoded protocol/deployment data.** Every DeFi protocol, chain, and
   risk weight is a row in a table, never a `switch` or an `if (protocol === 'aave')`.
   Adding protocol #10 must be an `INSERT`. If you are about to write a protocol
   name as a string literal in `src/`, stop — it belongs in `DeploymentRegistryEntry`.
2. **No fabricated SDKs.** If a package name is not confirmed in the spec or in
   live docs, write a thin typed wrapper over the documented REST/GraphQL
   interface. That wrapper is the permanent solution, not a placeholder. Never
   invent an import.
3. **Every risk decision carries provenance** — source, deployment, block,
   observed-at. Every subgraph query requests `_meta { block { number } deployment }`.
4. **Failure means `PENDING_REVIEW`, never a confident invented decision.** A
   stale or failed Graph query holds the claim. It never defaults to `ALLOW`.
5. **Deterministic core, AI at the edges.** The score is auditable arithmetic.
   The LLM investigates and explains; it never writes `Claim.riskDecision`.
6. **The cluster is the unit of analysis, not the wallet.** A wallet's risk is
   inherited from its cluster.

## Ownership — do not cross these lines

| Area | Owner |
|---|---|
| `src/graph/`, `src/evidence/`, `src/behavior-graph/`, `src/risk/`, `src/provenance/` | Suganthan (Phases 1–12) |
| `src/cache/`, `src/mcp/`, `src/world/`, `src/policy/`, `src/claim/`, `src/server.ts` | Sylesh (Phases 13–25) |
| `src/interfaces/evidence-risk-api.ts` | Suganthan writes it, Sylesh consumes it |
| `src/config/env.ts`, `prisma/`, `.env.example`, `docker-compose.yml` | Shared — append in your own marked section |

Sylesh's code imports **only** from `src/interfaces/evidence-risk-api.ts`. If
something is needed that the interface does not expose, that is a conversation
between the two people, not a deep import.

## Hard constraints in this codebase

- **`process.env` is banned outside `src/config/env.ts`.** ESLint enforces this
  via `no-restricted-properties`. Add new settings to the zod schema in `env.ts`
  *and* to `.env.example`. Never read `process.env` at a call site.
- **`prisma/schema.prisma` is locked** to Section 0.4 of the specs. Changing a
  model requires editing Section 0.4 in *both* markdown files in the same sitting
  and telling the other person before running `prisma migrate dev`. Whoever
  migrates first owns that migration file.
- **Block numbers are strings or `BigInt`, never `number`** — they exceed
  `Number.MAX_SAFE_INTEGER`.
- **On-chain amounts are strings, never floats** (`EvidenceEvent.amount`).
- **World ID nullifiers** are 256-bit ints returned as `0x`-hex. Convert to
  decimal before storing in `VerificationChallenge.nullifier`
  (`Decimal @db.Decimal(78, 0)`) — Postgres has no native 256-bit int.
- **Every tunable is config.** Thresholds, windows, normalizers and lookback
  hops live in `env.ts` or a table, never as inline numbers in a formula.
- **Use median/MAD, not mean/stddev**, for any campaign-level baseline. If most
  participants are coordinated attackers, a mean normalizes the attack into
  looking normal. This is a real contamination bug, not a style choice.
- **Writes are idempotent.** Re-fetching the same window must be a no-op, not a
  duplicate row. Claims use `upsert` against `@@unique([wallet, campaignId])`,
  never check-then-insert.

## Language to get right

Say **"medium-assurance uniqueness signal"** for what World Selfie Check
returns. Never "Sybil score" — that phrase appears nowhere in World's docs and
is wrong in the pitch, the code comments, and the README.

Also keep distinct: the **nullifier** (stops the same proof being reused for the
same action — your job) versus the **uniqueness signal** (World's own claim about
whether this person has been seen before — their job). They are not the same thing.

## Working practice

- Run `npm run typecheck && npm run lint && npm test` before declaring a phase done.
- Each phase in the spec has an explicit **acceptance test**. Satisfy it literally
  and report the actual output, not a claim that it passes.
- Update `backend/docs/PROGRESS-SUGANTHAN.md` when a phase completes.
- Feature extractors are pure functions `(walletSet, evidenceWindow) => { value, confidence, sourceEvidenceIds }`,
  independently unit-testable with fabricated `EvidenceEvent` rows and no network.
- Phases 5–8 need no credentials. If Graph access is pending, build those.
