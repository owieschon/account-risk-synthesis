/**
 * Baseline recovery rates used by the synthesis layer.
 *
 * IMPORTANT (portfolio repo honesty): the numbers below are **illustrative,
 * on synthetic data**. `acme_industrial` is an approved synthetic pseudonym
 * tenant — there is no real Acme Industrial transaction history in this repo,
 * so the recycler rate (0.592, N=1409) is NOT a real-world data-derived fact.
 * Read it as a plausible placeholder that demonstrates the loss-math shape. In
 * a real production deployment these rates would be computed per tenant from
 * that tenant's own posted-invoice history.
 *
 * Methodology (as it WOULD be computed in production): for each pattern,
 * identify accounts matching the pattern criteria retrospectively, then check
 * whether the account recovered (placed ≥2 orders within 180 days after the
 * pattern-triggering gap).
 *
 * Note on the `confidence` field: it is an internal signal-quality enum
 * ('data_derived' = a numeric rate is present, sample ≥ 30; 'qualitative' =
 * no usable rate, use qualitative framing). On synthetic data even a
 * 'data_derived' rate is illustrative, not an empirical claim about a real
 * customer.
 */

export interface PatternRecoveryRate {
  /** Recovery rate (0-1). Null if insufficient data. */
  readonly rate: number | null;
  /** Number of historical accounts matching the pattern. */
  readonly sampleSize: number;
  /** 'data_derived' if sample ≥ 30, 'qualitative' otherwise. */
  readonly confidence: 'data_derived' | 'qualitative';
  /** When this analysis was run. */
  readonly computedAt: string;
  /** Human-readable methodology note. */
  readonly methodology: string;
}

export const PATTERN_RECOVERY_RATES: Record<string, PatternRecoveryRate> = {
  /**
   * recycler_breaking_pattern: RECYCLER accounts (≥3 gap-recovery cycles,
   * ≥10 lifetime orders) experiencing their worst-ever gap.
   *
   * ILLUSTRATIVE rate on synthetic data (see file header) — not a real Acme
   * Industrial historical measurement. The figures below describe the shape the
   * production analysis WOULD produce, not an empirical result from this repo.
   *
   * Illustrative baseline: most such accounts recover within 180 days, and the
   * rate is roughly stable across gap severity (~57-59% whether the gap is 2x,
   * 5x, or 10x the account's median), implying gap magnitude does not materially
   * change recovery odds for RECYCLER accounts.
   *
   * Under this illustrative rate, ~41% of the time the "breaking" gap would be
   * terminal. Revenue at risk uses (1 - rate) as the loss rate.
   *
   * NOTE: This rate is for the worst-ever gap only, which is the most
   * conservative frame. The per-gap recovery rate across all qualifying
   * gaps is higher (~85-90%) because most gaps are not the worst.
   *
   * METHODOLOGY CHOICES (documented for future review):
   *
   * 1. "Worst-ever-gap per account" vs. "most recent qualifying gap":
   *    Chose worst-ever because it answers "when this account hits its
   *    all-time worst silence, what happens?" — the most conservative frame.
   *    Most-recent-qualifying-gap would be more diagnostic of current behavior
   *    but introduces temporal bias: recent gaps have less time to resolve
   *    (right-censoring). For a v1 baseline rate, worst-ever is more
   *    defensible. v1.5 could add most-recent as a secondary rate.
   *
   * 2. "≥2 orders within 180d" vs. "any order within 180d":
   *    A single post-gap order could be a closeout shipment, warranty
   *    fulfillment, or one-off reorder — not genuine recovery. Requiring
   *    ≥2 orders ensures the account resumed a pattern, not just placed
   *    one transaction. This is stricter and produces a lower recovery rate
   *    (a stricter, lower rate than counting any single order). The stricter definition is more
   *    useful for rep decision-making: "this account actually came back"
   *    vs "this account placed one more order."
   */
  recycler_breaking_pattern: {
    rate: 0.592, // illustrative, on synthetic data — not a real measurement
    sampleSize: 1409, // illustrative sample size, synthetic
    // 'data_derived' here = "a numeric rate is present" (internal signal-quality
    // enum), NOT a claim that 0.592 is an empirical real-world fact. On synthetic
    // data it is illustrative. See file header.
    confidence: 'data_derived',
    computedAt: '2026-04-15',
    methodology:
      'ILLUSTRATIVE on synthetic data (acme_industrial is a synthetic pseudonym). ' +
      'In production this would be computed by identifying RECYCLER accounts ' +
      "(>=3 gap-recovery cycles, >=10 orders) from the tenant's own transaction " +
      'history, finding each account\'s worst-ever gap, and checking whether they ' +
      'placed >=2 orders within 180 days after the post-gap order.',
  },

  /**
   * model_overcall: No recovery rate applicable — this pattern indicates
   * the model was wrong, not that the account is at risk.
   */
  model_overcall: {
    rate: null,
    sampleSize: 0,
    confidence: 'qualitative',
    computedAt: '2026-04-15',
    methodology: 'N/A — model_overcall is a meta-pattern indicating ground truth contradicts prediction.',
  },

  /**
   * unflagged_stable: No recovery rate applicable — these accounts are
   * performing normally. No risk event to recover from.
   */
  unflagged_stable: {
    rate: null,
    sampleSize: 0,
    confidence: 'qualitative',
    computedAt: '2026-04-15',
    methodology: 'N/A — unflagged_stable accounts have no risk event.',
  },

  /**
   * growth_lock_in: No recovery rate applicable. growth_lock_in is an
   * invest story, not a save story. There is no risk event to recover from.
   */
  growth_lock_in: {
    rate: null,
    sampleSize: 0,
    confidence: 'qualitative',
    computedAt: '2026-04-19',
    methodology: 'N/A: growth_lock_in is an invest-story pattern, not a loss scenario.',
  },

  /**
   * unclassifiable: Insufficient pattern definition for historical analysis.
   * Qualitative framing used in synthesis.
   */
  unclassifiable: {
    rate: null,
    sampleSize: 0,
    confidence: 'qualitative',
    computedAt: '2026-04-15',
    methodology: 'N/A — unclassifiable is a fallback for accounts that don\'t match any pattern.',
  },
};
