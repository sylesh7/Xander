# Risk Model

**Required by** Backend-Suganthan.md Phase 8.3.

---

## Read this first

**The weights below are a configurable demo policy, not a validated model.**

They were chosen to be reasonable and explainable. They were **not** fitted
against labelled Sybil data, and no precision or recall figure exists for them.
Say this out loud in the pitch. Claiming a tuned model would be the one
dishonest thing in an otherwise fully auditable system — and it is unnecessary,
because the defensible claim is stronger: _every number is a row you can inspect,
and every decision replays exactly._

What is genuinely defensible:

- the score is deterministic arithmetic, not a black box
- every weight and threshold is a database row, not a constant
- every decision pins the exact policy version that produced it
- every feature cites the evidence rows behind it
- retuning the weights cannot silently rewrite past decisions

---

## The score

```
score = Σ weightᵢ × featureᵢ
```

That is the whole thing. No hidden terms, no learned interactions.

### Seed weights (PolicyVersion 1.0)

| Feature                        | Weight   | What it measures                                             |
| ------------------------------ | -------- | ------------------------------------------------------------ |
| `FUNDING_CORRELATION`          | 0.25     | Does this set share a funder, inside a tight window?         |
| `TIMING_CORRELATION`           | 0.15     | Did these wallets first act at suspiciously similar times?   |
| `WALLET_AGE_SIMILARITY`        | 0.15     | Were they first seen at similar block heights?               |
| `SHARED_COUNTERPARTY`          | 0.15     | Do they touch the same addresses? (Jaccard)                  |
| `PROTOCOL_BEHAVIOR_SIMILARITY` | 0.15     | Do they walk the same protocol path in the same order? (LCS) |
| `RESERVE`                      | 0.15     | Unallocated headroom — always contributes 0                  |
| **Total**                      | **1.00** |                                                              |

Funding correlation carries the most weight because a shared funder inside a
tight window is the hardest signal to produce accidentally. The other four are
weighted equally: there is no evidence to justify ranking them, and inventing a
ranking would be false precision.

### Why nothing ever scores 1.0

`RESERVE` is real, unallocated weight. Its feature value is always 0, so **the
maximum achievable score is 0.85**.

It is stored as an actual `RiskWeight` row rather than being implicit, for two
reasons: the table genuinely sums to 1.0 so validation is honest rather than
special-cased, and "why does nothing score 1.0?" is answerable by looking at a
row instead of reading the source.

`BLOCK` starts at 0.7, so the top band is comfortably reachable.

### Policy bands (PolicyVersion 1.0)

| Band        | Range         | Meaning                                       |
| ----------- | ------------- | --------------------------------------------- |
| `ALLOW`     | `[0, 0.35)`   | Claim proceeds. No World challenge is issued. |
| `CHALLENGE` | `[0.35, 0.7)` | Escalate to World Selfie Check.               |
| `BLOCK`     | `[0.7, 1.0]`  | Refuse the claim.                             |

Ranges are half-open so exactly one band owns any given score; the top band is
closed at 1.0 so a maximum score matches something. Validation rejects any set
of thresholds with a gap or an overlap — a gap lets a claim fall through with no
band, and an overlap makes the decision depend on row ordering.

---

## Robust statistics

Any comparison of a value against "the rest of the set" uses **median and MAD**,
never mean and standard deviation.

This is a correctness fix, not a preference. Consider a campaign where 70% of
participants are one Sybil ring, all scoring 0.9 on funding correlation, and the
honest 30% score 0.05:

- **Mean/stddev**: the mean is ~0.65, so an attacker at 0.9 is well under one
  standard deviation from average — _unremarkable_. The honest users become the
  outliers. **The detector inverts.**
- **Median/MAD**: the median is 0.9 because the ring _is_ the majority, MAD is
  0, and the honest answer comes back as "this population has no usable spread"
  rather than a confident claim that the attacker is normal.

There is a test named `THE CONTAMINATION CASE` asserting exactly this.

**The baseline never changes the score.** It is reported alongside the raw value
for the Evidence Receipt, so an investigator can ask "was 0.6 high _for this
campaign_?". Folding it into the score would make a decision depend on which
other claims happened to be in flight at the time.

---

## Confidence

`value` and `confidence` answer different questions and must not be conflated.

- `value` — how strong the signal is
- `confidence` — how much evidence produced it

A feature computed from 2 of 20 wallets can produce a confident-looking number
from almost nothing. Confidence is therefore derived from **coverage**, never
from the value. A score of 0 with LOW confidence means "we found nothing and
barely looked"; 0 with HIGH confidence means "we looked hard and they are
genuinely unrelated". Those must be distinguishable, and there is a test for it.

Overall confidence is weighted by influence: a LOW-confidence feature carrying
25% of the weight drags the result down far more than one carrying 5%. A plain
minimum would let a barely-weighted feature veto a well-evidenced decision; a
plain average would let a heavily-weighted guess hide behind several
well-evidenced trivia.

### One known weakness, surfaced rather than hidden

Short event sequences inflate `PROTOCOL_BEHAVIOR_SIMILARITY`. Drawn from a
seven-value event vocabulary, two wallets with two events each that both open
with a transfer score 0.5 by coincidence alone.

The formula is fixed by the spec, so the correction lives in confidence:
sequences under 4 events downgrade it one level and attach the note _"similarity
is weakly evidenced"_. The value stays as specified and the weakness appears on
the receipt instead of quietly inflating a score.

---

## Policy versioning

The live `RiskWeight` / `RiskThreshold` tables are the **editing** surface. The
active `PolicyVersion` is the **deciding** surface.

Scoring always reads the snapshot, so an operator halfway through editing
weights cannot produce a decision from a half-changed policy. Activating a new
version deactivates the old one in the same transaction — two active versions
would make "which policy decided this?" unanswerable.

A version is never overwritten: receipts already reference it. Retuning means
bumping to a new version, which leaves every past decision replayable against
the policy that actually made it.

---

## Verified behaviour

Run end to end against real Postgres on 2026-09-08:

```
=== COORDINATED RING (5 wallets) ===
  clusters formed : 1 (density 1.00, HIGH)
    FUNDING_CORRELATION            1.000 x 0.25 = 0.250  [HIGH]
    TIMING_CORRELATION             0.976 x 0.15 = 0.146  [HIGH]
    WALLET_AGE_SIMILARITY          1.000 x 0.15 = 0.150  [HIGH]
    SHARED_COUNTERPARTY            1.000 x 0.15 = 0.150  [HIGH]
    PROTOCOL_BEHAVIOR_SIMILARITY   1.000 x 0.15 = 0.150  [HIGH]
  SCORE           : 0.8465
  DECISION        : BLOCK

=== CLEAN WALLETS (5 wallets) ===
  clusters formed : 0
    FUNDING_CORRELATION            0.000 x 0.25 = 0.000  [HIGH]
    TIMING_CORRELATION             0.000 x 0.15 = 0.000  [HIGH]
    WALLET_AGE_SIMILARITY          0.000 x 0.15 = 0.000  [HIGH]
    SHARED_COUNTERPARTY            0.000 x 0.15 = 0.000  [HIGH]
    PROTOCOL_BEHAVIOR_SIMILARITY   0.550 x 0.15 = 0.083  [HIGH]
  SCORE           : 0.0825
  DECISION        : ALLOW
```

Separately, six **real** Compound V2 accounts pulled live from the gateway
produced 0 edges, 0 clusters and near-zero features — a true negative on real
data, which is the harder half to get right.
