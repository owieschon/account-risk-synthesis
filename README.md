# account-risk-synthesis

A rep opens Tuesday's call list and the third red flag is wrong. The account it says is slipping just placed a normal order — the model was reading stale history. The rep dials anyway, the buyer is puzzled, and that one bad call costs more trust than the eleven good ones will earn back. The other failure is quieter: an account that fades from an $87K-a-year peak to $34K so gradually that the churn model, the survival model, and the anomaly detector each look at it and see nothing. No single layer is alarmed; the decline is the agreement between them.

This is the layer that decides what the rep actually hears. It takes the signals that disagree — a churn probability, a survival probability, an anomaly flag, the account's own revenue trajectory — and turns them into one briefing per account. The signals propose. A tested rule decides.

## The decision is code, not a prompt

`synthesize()` ([`src/synthesize.ts`](src/synthesize.ts)) walks an **ordered, most-specific-first** library of pattern modules and stops at the first match:

| order | pattern | the read |
|------:|---------|----------|
| 1 | `recycler_breaking_pattern` | a serial gap-recoverer (≥3 cycles) whose current silence is structurally unlike past recoveries |
| 2 | `top_tier_early_warning` | a top-tier account (revenue p85) whose structure has shifted before invoiced revenue moves |
| 3 | `growth_lock_in` | a stable, near-peak account on a strong growth trend — an invest story, not a save story |
| 4 | `silent_winback` | quietly fading from its own peak while every risk layer stays calm |
| 5 | `unflagged_stable` | performing normally; most accounts land here |
| 6 | `unclassifiable` | the floor — always matches, so no account falls through silently |

Each pattern is a TypeScript module exporting an explicit `matches(input, ctx)` predicate and a `synthesize(input, ctx)` that emits the briefing. The ordering is the contract: `recycler_breaking_pattern` is checked before `top_tier_early_warning` because it is the more specific read, and the rationale for every adjacent pair is written into the library inline. First match wins, every time.

## Ground truth can veto the model

After a risk pattern matches, a meta-check — `model_overcall` ([`src/patterns/model-overcall.ts`](src/patterns/model-overcall.ts)) — looks at the account's own posted revenue. If 2026 YTD is running above ~70% of the pace prior-year revenue predicts for this point in the year, it **replaces** the alarm with an explicit *"the model flagged this, but the data doesn't back it — monitor, don't engage."* It only fires against non-stable, non-fallback patterns: a stable account can't be overcalled. Deterministic ground truth gets the last word over the model's concern. That is the whole stance — the model narrates at the edges; an auditable rule decides what the rep is told.

## Every briefing names its own blind spots

`blindSpots: string[]` is a required field on every `SynthesisOutput` ([`src/types.ts`](src/types.ts)) — alongside a confidence object, per-layer evidence (which signal agreed, which dissented, and why it was discounted), and a `groundTruthNote`. The output states what it is *not* claiming. `silent_winback`, for instance, ships four blind spots, including whether the rep already had this conversation and whether a competitor displaced us or the customer's own volume simply dropped.

## Per-tenant, not per-Acme

Thresholds aren't hardcoded dollars. `matcher-context.ts` ([`src/matcher-context.ts`](src/matcher-context.ts)) computes them once per batch from the tenant's own distribution — p85 of `revenue_12mo`, p80 of gap-recovery cycles — via a single `percentile_cont` query. So "top tier" means the same thing whether a tenant's top tier is $500K or $5M. The function takes a duck-typed query client and imports no `pg` driver, which is why this package has **zero runtime dependencies**.

## Run it

```bash
npm install
npm test          # 99 tests across 4 files — no DB, no keys, no network
npm run typecheck # tsc --noEmit
```

The only dev dependencies are `typescript` and `vitest`.

## Status

A clean, extractable slice of a larger system ([Reter](https://github.com/owieschon/reter)): the synthesis engine on its own, no database, no agent runtime. Every account in the tests is synthetic — invented IDs and figures built to exercise each matcher, not customer data. The illustrative recovery rate in [`src/historical-recovery-rates.ts`](src/historical-recovery-rates.ts) (0.592, N=1409) is labeled in code as a synthetic placeholder for the loss-math shape, not an empirical measurement; in production these rates are computed per tenant from posted-invoice history.

## License

Apache-2.0 — see [LICENSE](LICENSE).
