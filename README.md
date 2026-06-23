# account-risk-synthesis

Pattern-as-code account diagnosis. Given a single account-state object (model
scores, anomaly flags, revenue history, network shape), it matches the account
against an **ordered pattern library** and emits a three-beat narrative:

1. **Headline** — a one-line observation of what the account is doing
   (`diagnosis.label` / `diagnosis.body`).
2. **Recommended action** — what to do about it, with investigation
   objectives and channel-agnostic engagement options (`action`).
3. **What it cannot see** — the blind spots and unknowns the diagnosis is
   built on top of, so the reader knows what the synthesis is *not* claiming
   (`blindSpots`, plus the per-layer agreement/disagreement in `evidence` and
   `confidence`).

The point is that the diagnosis is **code, not a prompt**: each pattern is a
small, testable TypeScript module with an explicit `matches()` predicate and a
`synthesize()` function. The library is ordered most-specific-first, the first
matching pattern wins, and a fallback always matches so every account gets an
output.

## What's in the box

`synthesize(input, ctx)` walks the pattern library in this order:

| Pattern | What it reads as |
| --- | --- |
| `recycler_breaking_pattern` | An account that normally goes quiet and comes back, but this silence looks structurally different from its past recoveries. |
| `top_tier_early_warning` | A high-revenue account showing structural anomalies before trailing invoiced revenue moves. |
| `growth_lock_in` | A growing account near its peak — an invest story, not a save story. |
| `silent_winback` | A quietly fading account that every individual risk layer missed. |
| `unflagged_stable` | Nothing is wrong; the account is performing normally. |
| `unclassifiable` | Fallback — always matches so there is always an output. |

`model_overcall` runs as a meta-check *after* the primary pattern: if the
account's own ground-truth revenue pace contradicts a risk prediction, the
output is replaced with a "the model may be wrong here" diagnosis instead.

Per-tenant thresholds (`MatcherContext`) are computed from the tenant's own
distribution (e.g. the p85 revenue cutoff) rather than hardcoded absolute
dollar amounts, so patterns mean the same thing for a small and a large
customer. `matcher-context.ts` shows the SQL that would produce that context in
a real deployment; it takes a duck-typed query client and imports no database
driver.

## Run it

```bash
npm install
npm test
```

No database, no API keys, no network. The only dependencies are dev tools
(`typescript`, `vitest`); there are **zero runtime dependencies**.

If your environment blocks `npx`, run the binary directly after install:

```bash
node_modules/.bin/vitest run
```

**99 tests** across 4 files cover the matcher predicates and the shape of the
synthesized output for each pattern.

## A note on the data

Every account in the tests is **synthetic** — invented names, IDs, and figures
chosen to exercise each matcher. They are not derived from any real customer.
The illustrative recovery rate in `historical-recovery-rates.ts` (and its
sample size) is a placeholder that demonstrates the loss-math shape; it is
documented in that file as such and is **not** an empirical measurement. In a
real deployment those rates would be computed per tenant from that tenant's own
posted-invoice history.

## Where this came from

This module was extracted from a larger private B2B revenue-intelligence
system. That system layers a churn model, a survival model, and an anomaly
detector over a distributor's order history; the synthesis layer here is the
piece that turns those raw, sometimes-disagreeing signals into a single
readable briefing per account. The design intent — surface the disagreement and
the blind spots rather than hiding them behind one score — is a design choice,
described here as a design choice, not a benchmarked result.

## License

MIT
