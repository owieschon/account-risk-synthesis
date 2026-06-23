import { describe, it, expect } from 'vitest';
import { synthesize, getPatternMetadata } from '../src/synthesize';
import { recyclerBreakingPattern } from '../src/patterns/recycler-breaking-pattern';
import { modelOvercall } from '../src/patterns/model-overcall';
import { unflaggedStable } from '../src/patterns/unflagged-stable';
import { growthLockIn } from '../src/patterns/growth-lock-in';
import { silentWinback } from '../src/patterns/silent-winback';
import { topTierEarlyWarning } from '../src/patterns/top-tier-early-warning';
import { unclassifiable } from '../src/patterns/unclassifiable';
import type { SynthesisInput, MatcherContext } from '../src/types';

// Deterministic fixture — not derived from prod data; just plausible values
// so matchers that read ctx do not coincidentally fire or fail.
const ctx: MatcherContext = {
  tenantId: 'test-tenant',
  revenueTopTier: 100_000,
  gapCycleTopBand: 10,
  activeAccountCount: 500,
};

// ---------------------------------------------------------------------------
// Test fixtures — synthetic accounts. Names, IDs, and figures are invented to
// exercise each matcher; they are not derived from any real customer data.
// ---------------------------------------------------------------------------

/** Ridgeway Fabrication (#7404) — synthetic fixture for recycler_breaking_pattern */
const recyclerFixture: SynthesisInput = {
  accountId: '00000000-0000-4000-8000-000000007404',
  accountName: 'RIDGEWAY FABRICATION, INC.',
  externalId: '7404',
  status: 'declining',
  churnProb: 0.0114,
  survivalProb90d: 0.9813,
  medianSurvivalDays: null,
  isAnomalous: true,
  catchCategory: 'GENUINE_CATCH',
  topAnomalyFeatures: [
    { feature: 'dormancy_freq_interaction', z_score: 8.3, direction: 'high' },
    { feature: 'sudden_silence', z_score: 6.5, direction: 'high' },
    { feature: 'slope_change', z_score: 6.3, direction: 'high' },
  ],
  nGapRecoveryCycles: 9,
  revenue12mo: 34170,
  revenue12moCurrent: 37376,
  revenue2026Ytd: 3700,
  revenuePriorYear: 47544,
  peakRevenue12mo: 47544,
  daysSinceLastOrder: 179,
  orders12mo: 12,
  categoriesExited: [],
  concentrationTrend: null,
  riskScore: 43,
  riskTier: 'medium',
  trendPct: 133,
  parentCompanyId: null,
  childCount: 0,
  siblingRevenue: null,
  predictedRevenue12mo: null,
  forecastChangePct: null,
  componentScores: {
    dormancy_freq_interaction: 8.3,
    sudden_silence: 6.5,
    slope_change: 6.3,
  },
};

/** Sutphen (#25348) — should match model_overcall (54% pace, model flagged) */
const sutphen: SynthesisInput = {
  accountId: 'some-uuid',
  accountName: 'SUTPHEN CORPORATION',
  externalId: '25348',
  status: 'stable',
  churnProb: 0.0161,
  survivalProb90d: 0.4702,
  medianSurvivalDays: 85,
  isAnomalous: true,
  catchCategory: 'GENUINE_CATCH',
  topAnomalyFeatures: [
    { feature: 'csr_churn_intensity', z_score: 4.6, direction: 'high' },
    { feature: 'days_since_last_backlog_order', z_score: 4.3, direction: 'high' },
    { feature: 'max_gap_ratio', z_score: 2.5, direction: 'high' },
  ],
  nGapRecoveryCycles: 4,
  revenue12mo: 54312,
  revenue12moCurrent: 60534,
  revenue2026Ytd: 26317,
  revenuePriorYear: 48306,
  peakRevenue12mo: 57000,
  daysSinceLastOrder: 63,
  orders12mo: 20,
  categoriesExited: ['OTHER'],
  concentrationTrend: null,
  riskScore: 2,
  riskTier: 'low',
  trendPct: 0,
  parentCompanyId: null,
  childCount: 0,
  siblingRevenue: null,
  predictedRevenue12mo: 55000,
  forecastChangePct: 4.9,
  componentScores: {},
};

/** A stable, healthy, non-anomalous account */
const stableAccount: SynthesisInput = {
  accountId: 'stable-uuid',
  accountName: 'HEALTHY PARTS INC.',
  externalId: '12345',
  status: 'stable',
  churnProb: 0.02,
  survivalProb90d: 0.92,
  medianSurvivalDays: null,
  isAnomalous: false,
  catchCategory: null,
  topAnomalyFeatures: null,
  nGapRecoveryCycles: 1,
  revenue12mo: 80000,
  revenue12moCurrent: 82000,
  revenue2026Ytd: 25000,
  revenuePriorYear: 78000,
  peakRevenue12mo: 85000,
  daysSinceLastOrder: 14,
  orders12mo: 24,
  categoriesExited: [],
  concentrationTrend: null,
  riskScore: 2,
  riskTier: 'low',
  trendPct: 5,
  parentCompanyId: null,
  childCount: 0,
  siblingRevenue: null,
  predictedRevenue12mo: 84000,
  forecastChangePct: 5,
  componentScores: {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recycler_breaking_pattern', () => {
  it('matches Ridgeway Fabrication (9 cycles, anomalous, structural signals)', () => {
    expect(recyclerBreakingPattern.matches(recyclerFixture, ctx)).toBe(true);
  });

  it('does not match accounts with < 3 gap recovery cycles', () => {
    expect(recyclerBreakingPattern.matches({ ...recyclerFixture, nGapRecoveryCycles: 2 }, ctx)).toBe(false);
  });

  it('does not match non-anomalous accounts', () => {
    expect(recyclerBreakingPattern.matches({ ...recyclerFixture, isAnomalous: false }, ctx)).toBe(false);
  });

  it('does not match accounts without GENUINE_CATCH category', () => {
    expect(recyclerBreakingPattern.matches({ ...recyclerFixture, catchCategory: 'POSITIVE_OUTLIER' }, ctx)).toBe(false);
  });

  it('produces diagnosis with observation, not hypothesis', () => {
    const output = recyclerBreakingPattern.synthesize(recyclerFixture, ctx);
    expect(output.diagnosis.label).toContain("doesn't match their normal recovery cycles");
    // Should NOT say "losing share to a competitor" (that's a hypothesis)
    expect(output.diagnosis.label).not.toContain('competitor');
    expect(output.diagnosis.body).not.toContain('losing share');
  });

  it('computes data-derived estimated loss', () => {
    const output = recyclerBreakingPattern.synthesize(recyclerFixture, ctx);
    expect(output.stakes.estimatedLoss).not.toBeNull();
    expect(output.stakes.lossRateSource).toBe('data_derived');
    // ~$47K * 0.408 = ~$19K
    expect(output.stakes.estimatedLoss!).toBeGreaterThan(15000);
    expect(output.stakes.estimatedLoss!).toBeLessThan(25000);
  });

  it('includes channel-agnostic engagement options, not prescriptions', () => {
    const output = recyclerBreakingPattern.synthesize(recyclerFixture, ctx);
    expect(output.action.engagementOptions.length).toBeGreaterThan(0);
    // Should not prescribe a specific channel
    expect(output.action.imperative).toContain('Engage with');
    expect(output.action.imperative).not.toContain('Call');
    expect(output.action.imperative).not.toContain('Email');
  });
});

describe('model_overcall', () => {
  it('matches Sutphen (54% pace despite being flagged)', () => {
    expect(modelOvercall.matches(sutphen, ctx)).toBe(true);
  });

  it('does not match Ridgeway Fabrication (8% pace, model is correct)', () => {
    expect(modelOvercall.matches(recyclerFixture, ctx)).toBe(false);
  });

  it('does not match when no ground truth data available', () => {
    expect(modelOvercall.matches({ ...sutphen, revenue2026Ytd: null }, ctx)).toBe(false);
  });

  it('produces low confidence and monitor urgency', () => {
    const output = modelOvercall.synthesize(sutphen, ctx);
    expect(output.confidence.level).toBe('low');
    expect(output.action.urgency).toBe('monitor');
  });

  it('acknowledges the model was wrong (Principle 1)', () => {
    const output = modelOvercall.synthesize(sutphen, ctx);
    expect(output.diagnosis.label).toContain('may be wrong');
    expect(output.groundTruthNote).toContain('wrong or outdated');
  });
});

describe('unflagged_stable', () => {
  it('matches a healthy, non-anomalous stable account', () => {
    expect(unflaggedStable.matches(stableAccount, ctx)).toBe(true);
  });

  it('does not match anomalous accounts', () => {
    expect(unflaggedStable.matches({ ...stableAccount, isAnomalous: true }, ctx)).toBe(false);
  });

  it('does not match non-stable accounts', () => {
    expect(unflaggedStable.matches({ ...stableAccount, status: 'declining' }, ctx)).toBe(false);
  });

  it('does not match accounts with low survival', () => {
    expect(unflaggedStable.matches({ ...stableAccount, survivalProb90d: 0.50 }, ctx)).toBe(false);
  });

  it('does not match accounts with category exits', () => {
    expect(unflaggedStable.matches({ ...stableAccount, categoriesExited: ['OTHER'] }, ctx)).toBe(false);
  });

  it('produces no action and high confidence', () => {
    const output = unflaggedStable.synthesize(stableAccount, ctx);
    expect(output.confidence.level).toBe('high');
    expect(output.action.urgency).toBe('low');
  });
});

describe('synthesize() integration', () => {
  it('Ridgeway Fabrication → recycler_breaking_pattern', () => {
    const output = synthesize(recyclerFixture, ctx);
    expect(output.patternMatch).toBe('recycler_breaking_pattern');
  });

  it('Sutphen → model_overcall (overrides recycler_breaking_pattern)', () => {
    const output = synthesize(sutphen, ctx);
    // Sutphen matches recycler_breaking_pattern (4 cycles, anomalous, structural)
    // BUT model_overcall fires because 2026 YTD is at 54% pace
    expect(output.patternMatch).toBe('model_overcall');
  });

  it('Stable account → unflagged_stable', () => {
    const output = synthesize(stableAccount, ctx);
    expect(output.patternMatch).toBe('unflagged_stable');
  });

  it('patterns are mutually exclusive in output (one pattern per account)', () => {
    const oxOutput = synthesize(recyclerFixture, ctx);
    const sutOutput = synthesize(sutphen, ctx);
    const stabOutput = synthesize(stableAccount, ctx);

    // Each should have exactly one pattern
    expect(oxOutput.patternMatch).toBe('recycler_breaking_pattern');
    expect(sutOutput.patternMatch).toBe('model_overcall');
    expect(stabOutput.patternMatch).toBe('unflagged_stable');
  });
});

// ---------------------------------------------------------------------------
// Pattern type/moment classification
// ---------------------------------------------------------------------------

describe('pattern type/moment classification', () => {
  it('all moment patterns set momentWindowDays', () => {
    const moments = [recyclerBreakingPattern, topTierEarlyWarning, silentWinback];
    for (const p of moments) {
      expect(p.type).toBe('moment');
      expect(p.momentWindowDays).toBeGreaterThan(0);
    }
  });

  it('type patterns do not require momentWindowDays', () => {
    const types = [growthLockIn, modelOvercall, unflaggedStable, unclassifiable];
    for (const p of types) {
      expect(p.type).toBe('type');
    }
  });

  it('getPatternMetadata surfaces type for type patterns', () => {
    const meta = getPatternMetadata('growth_lock_in');
    expect(meta).not.toBeNull();
    expect(meta!.type).toBe('type');
    expect(meta!.momentWindowDays).toBeNull();
  });

  it('getPatternMetadata surfaces type and window for moment patterns', () => {
    const meta = getPatternMetadata('silent_winback');
    expect(meta).not.toBeNull();
    expect(meta!.type).toBe('moment');
    expect(meta!.momentWindowDays).toBeGreaterThan(0);
  });

  it('getPatternMetadata resolves model_overcall (meta-pattern not in main library iterator)', () => {
    const meta = getPatternMetadata('model_overcall');
    expect(meta).not.toBeNull();
    expect(meta!.type).toBe('type');
  });

  it('getPatternMetadata returns null for unknown pattern names', () => {
    expect(getPatternMetadata('not_a_real_pattern')).toBeNull();
  });

  it('recycler_breaking_pattern is moment (transient broken-cycle window)', () => {
    expect(recyclerBreakingPattern.type).toBe('moment');
  });

  it('top_tier_early_warning is moment (act before trailing revenue catches up)', () => {
    expect(topTierEarlyWarning.type).toBe('moment');
  });

  it('silent_winback is moment (reference case in pattern-type-vs-moment rule)', () => {
    expect(silentWinback.type).toBe('moment');
  });

  it('growth_lock_in is type (persistent growth phenotype)', () => {
    expect(growthLockIn.type).toBe('type');
  });

  it('model_overcall is type (standing meta-dissonance)', () => {
    expect(modelOvercall.type).toBe('type');
  });

  it('unflagged_stable is type (persistent healthy classification)', () => {
    expect(unflaggedStable.type).toBe('type');
  });

  it('unclassifiable is type (persistent fallback)', () => {
    expect(unclassifiable.type).toBe('type');
  });
});
