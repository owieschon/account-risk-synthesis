# account-risk-synthesis

Picture a Tuesday-morning call list with twelve red flags on it. The rep works down the list, dials the third account, and the buyer answers a little puzzled — orders are up, nothing's wrong, the model was reading stale data. That call just cost more trust than the other eleven will earn back. I spent years on the distribution side watching that exact mistake burn rep credibility, so when I built the risk layer for a B2B revenue system, I refused to let a single model score be the thing a rep acts on.

This is the piece that turns raw, sometimes-disagreeing signals — a churn model, a survival model, an anomaly detector — into one readable briefing per account. The signals propose. They never get to be the final word.

## The part that matters: the model can be overruled

After a risk pattern fires, a meta-check called `model_overcall` looks at the account's own ground-truth revenue: if 2026 YTD is running above ~70% of the pace prior-year revenue would predict for this point in the year, it **replaces** the alarm with an explicit *"the model flagged this, but the data doesn't back it — monitor, don't engage"* diagnosis. Deterministic ground truth gets to veto the prediction. That's the whole stance: the LLM-or-model layer narrates and proposes at the edges; a tested, auditable rule decides what the rep is actually told.

Two more invariants enforce it:

- **Every account produces an output.** The pattern library is ordered most-specific-first, the first match wins, and `unclassifiable` always matches as the floor — there's no silent gap, no account that quietly falls through.
- **Every briefing says what it can't see.** `blindSpots` is a required field on every output, alongside per-layer evidence agreement/disagreement and a confidence object. The briefing states what it is *not* claiming.

## How it's built

Each pattern is a TypeScript module with an explicit `matches()` predicate and a `synthesize()` function — diagnosis as code, not a prompt you hope the model honors. Thresholds aren't hardcoded dollars; they're computed from each tenant's own distribution (p85 revenue, p80 gap-cycle, via `percentile_cont`), so a pattern means the same thing for a small customer and a large one. `matcher-context.ts` takes a duck-typed query client and imports no DB driver, which is why there are **zero runtime dependencies**.

```bash
npm install
npm test          # 99 tests, 4 files
npm run typecheck # tsc --noEmit, clean
```

No database, no API keys, no network. Dev dependencies are only `typescript` and `vitest`.

Architecture and the pattern-ordering rationale: [ARCHITECTURE.md](ARCHITECTURE.md). Honest self-audit (what's tested, what isn't, and the synthetic-data posture): [AUDIT.md](AUDIT.md).

## Status

Public, sanitized version of a real system. Every account in the tests is synthetic — invented IDs and figures chosen to exercise each matcher, not derived from any customer. The illustrative recovery rate in `historical-recovery-rates.ts` (0.592, N=1409) is labeled in code as a synthetic placeholder for the loss-math shape, not an empirical measurement; in a real deployment those rates are computed per tenant.

## License

MIT — see [LICENSE](LICENSE).
