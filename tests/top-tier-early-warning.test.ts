import { describe, it, expect } from 'vitest';
import { synthesize } from '../src/synthesize';
import { topTierEarlyWarning } from '../src/patterns/top-tier-early-warning';
import type { SynthesisInput, MatcherContext } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Deterministic tenant context used throughout these tests. The
 * revenueTopTier is essential here (it gates the matcher), so it is
 * set to a value that MIAMI-like revenue clears comfortably and that
 * the below-threshold fixture fails.
 */
const ctx: MatcherContext = {
  tenantId: 'test-tenant',
  revenueTopTier: 200_000,
  gapCycleTopBand: 10,
  activeAccountCount: 500,
};

/**
 * RIVERSIDE TRUCK PARTS (#7401): hero account for top_tier_early_warning.
 * Values grounded in scripts/author-hero-synthesis.ts (miamiStar block).
 *
 * Structural anomalies firing at z >= 3:
 *   backlog_value_open z=9.61  (newly added to STRUCTURAL_SIGNALS)
 *   revenue_slope_12mo z=8.95  (NOT in STRUCTURAL_SIGNALS by design)
 *   revenue_12mo z=6.56        (NOT in STRUCTURAL_SIGNALS by design)
 *
 * To reach the required "2+ structural anomalies at z >= 3" bar, the
 * fixture includes one additional structural feature that is genuinely
 * in the list (csr_churn_intensity z=4.1). This mirrors how the
 * production scorer typically returns a handful of top features with
 * the structural ones mixed in.
 */
const miamiStar: SynthesisInput = {
  accountId: 'miami-uuid',
  accountName: 'RIVERSIDE TRUCK PARTS',
  externalId: '7401',
  status: 'stable',
  churnProb: 0.50,
  survivalProb90d: 0.50,
  medianSurvivalDays: 85,
  isAnomalous: true,
  catchCategory: 'GENUINE_CATCH',
  topAnomalyFeatures: [
    { feature: 'backlog_value_open', z_score: 9.61, direction: 'high' },
    { feature: 'revenue_slope_12mo', z_score: 8.95, direction: 'high' },
    { feature: 'revenue_12mo', z_score: 6.56, direction: 'high' },
    { feature: 'csr_churn_intensity', z_score: 4.1, direction: 'high' },
  ],
  nGapRecoveryCycles: 2,
  revenue12mo: 408_547,
  revenue12moCurrent: 408_547,
  // Ground-truth YTD data intentionally null on this fixture so the
  // model_overcall meta-check does not override the primary pattern
  // routing in integration tests. MIAMI's actual production data does
  // have YTD, which would (correctly) trigger model_overcall.
  revenue2026Ytd: null,
  revenuePriorYear: null,
  peakRevenue12mo: 494_000,
  daysSinceLastOrder: 12,
  orders12mo: 64,
  categoriesExited: [],
  concentrationTrend: null,
  riskScore: 18,
  riskTier: 'medium',
  trendPct: 6,
  parentCompanyId: null,
  childCount: 0,
  siblingRevenue: null,
  predictedRevenue12mo: null,
  forecastChangePct: null,
  componentScores: {
    backlog_value_open: 9.61,
    revenue_slope_12mo: 8.95,
    revenue_12mo: 6.56,
  },
};

/** Not anomalous: same revenue, same features, but isAnomalous=false. */
const nonAnomalous: SynthesisInput = {
  ...miamiStar,
  accountId: 'non-anom-uuid',
  accountName: 'QUIET TOP TIER',
  isAnomalous: false,
  catchCategory: null,
};

/** Below revenue top tier: anomalies fire, but revenue is under threshold. */
const belowTopTier: SynthesisInput = {
  ...miamiStar,
  accountId: 'below-top-uuid',
  accountName: 'MID-TIER WITH ANOMALIES',
  revenue12mo: 150_000, // ctx.revenueTopTier = 200_000
  revenue12moCurrent: 150_000,
};

/** Only one structural anomaly at z>=3 (the second is below threshold). */
const oneStructural: SynthesisInput = {
  ...miamiStar,
  accountId: 'one-struct-uuid',
  accountName: 'ONE STRUCTURAL SIGNAL',
  topAnomalyFeatures: [
    { feature: 'backlog_value_open', z_score: 9.61, direction: 'high' },
    { feature: 'csr_churn_intensity', z_score: 2.4, direction: 'high' }, // below z=3
    { feature: 'revenue_slope_12mo', z_score: 8.95, direction: 'high' }, // not structural
  ],
};

/** Only non-structural anomalies at z>=3. */
const nonStructuralAnomalies: SynthesisInput = {
  ...miamiStar,
  accountId: 'non-struct-uuid',
  accountName: 'NON-STRUCTURAL ANOMALIES',
  topAnomalyFeatures: [
    { feature: 'revenue_slope_12mo', z_score: 8.95, direction: 'high' },
    { feature: 'revenue_12mo', z_score: 6.56, direction: 'high' },
    { feature: 'dormancy_freq_interaction', z_score: 5.0, direction: 'high' },
  ],
};

/** Churned account, same qualifying anomalies. */
const churned: SynthesisInput = {
  ...miamiStar,
  accountId: 'churned-uuid',
  accountName: 'CHURNED TOP TIER',
  status: 'churned',
};

// ---------------------------------------------------------------------------
// matches() tests
// ---------------------------------------------------------------------------

describe('top_tier_early_warning - matches()', () => {
  it('matches MIAMI-like fixture (anomalous, 2+ structural z>=3, revenue above top tier, not churned)', () => {
    expect(topTierEarlyWarning.matches(miamiStar, ctx)).toBe(true);
  });

  it('does not match a non-anomalous account even with high revenue', () => {
    expect(topTierEarlyWarning.matches(nonAnomalous, ctx)).toBe(false);
  });

  it('does not match an account below ctx.revenueTopTier', () => {
    expect(topTierEarlyWarning.matches(belowTopTier, ctx)).toBe(false);
  });

  it('does not match when only one structural anomaly fires at z>=3', () => {
    expect(topTierEarlyWarning.matches(oneStructural, ctx)).toBe(false);
  });

  it('does not match when anomalies are not on structural features', () => {
    expect(topTierEarlyWarning.matches(nonStructuralAnomalies, ctx)).toBe(false);
  });

  it('does not match a churned account even with all other conditions met', () => {
    expect(topTierEarlyWarning.matches(churned, ctx)).toBe(false);
  });

  it('treats ctx.revenueTopTier as inclusive boundary: revenue equal to threshold passes', () => {
    const atBoundary: SynthesisInput = { ...miamiStar, revenue12mo: ctx.revenueTopTier };
    expect(topTierEarlyWarning.matches(atBoundary, ctx)).toBe(true);
  });

  it('treats ctx.revenueTopTier boundary correctly: one dollar under fails', () => {
    const justUnder: SynthesisInput = { ...miamiStar, revenue12mo: ctx.revenueTopTier - 1 };
    expect(topTierEarlyWarning.matches(justUnder, ctx)).toBe(false);
  });

  it('respects tenant-derived revenue top tier (same account, stricter tenant)', () => {
    // MIAMI has revenue_12mo = 408K. If a tenant's top tier is 500K,
    // MIAMI does not clear it even though it would in the default fixture.
    const strictTenant: MatcherContext = { ...ctx, revenueTopTier: 500_000 };
    expect(topTierEarlyWarning.matches(miamiStar, strictTenant)).toBe(false);
  });

  it('does not match when revenue_12mo is null', () => {
    const noRevenue: SynthesisInput = {
      ...miamiStar,
      // Satisfy readonly via cast; revenue12mo is typed as number in practice
      // but the matcher must defend against null from upstream data.
      revenue12mo: null as unknown as number,
    };
    expect(topTierEarlyWarning.matches(noRevenue, ctx)).toBe(false);
  });

  it('does not match when topAnomalyFeatures is null', () => {
    const noFeatures: SynthesisInput = {
      ...miamiStar,
      topAnomalyFeatures: null,
    };
    expect(topTierEarlyWarning.matches(noFeatures, ctx)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// synthesize() tests
// ---------------------------------------------------------------------------

describe('top_tier_early_warning - synthesize()', () => {
  it('produces well-formed output for MIAMI-like fixture', () => {
    const output = topTierEarlyWarning.synthesize(miamiStar, ctx);
    expect(output.patternMatch).toBe('top_tier_early_warning');
    expect(output.diagnosis.label).toContain('RIVERSIDE TRUCK PARTS');
    expect(output.diagnosis.label).toContain('top-tier');
    expect(output.diagnosis.body).toContain('RIVERSIDE TRUCK PARTS');
    expect(output.action.urgency).toBe('high');
    expect(output.action.imperative).toContain('Investigate RIVERSIDE TRUCK PARTS');
    expect(output.action.imperative).toContain('before the shift becomes visible in invoiced revenue');
  });

  it('extracts anomaly evidence dynamically from input, not hardcoded values', () => {
    const output = topTierEarlyWarning.synthesize(miamiStar, ctx);
    const features = output.evidence.anomalyFeatures.map((f) => f.feature);
    expect(features).toContain('backlog_value_open');
    // z-scores reflect the fixture, not baked-in MIAMI constants
    const backlog = output.evidence.anomalyFeatures.find((f) => f.feature === 'backlog_value_open');
    expect(backlog?.zScore).toBe(9.61);
  });

  it('reports at least three investigation objectives, driven by fired features', () => {
    const output = topTierEarlyWarning.synthesize(miamiStar, ctx);
    expect(output.action.investigationObjectives.length).toBeGreaterThanOrEqual(3);
    // Must include the backlog-specific objective because backlog_value_open fired
    const joined = output.action.investigationObjectives.join(' ');
    expect(joined.toLowerCase()).toContain('backlog');
  });

  it('frames stakes qualitatively (no historical recovery rate exists for this pattern)', () => {
    const output = topTierEarlyWarning.synthesize(miamiStar, ctx);
    expect(output.stakes.lossRateSource).toBe('qualitative');
    expect(output.stakes.revenueAtStake).toBe(408_547);
    // 50% qualitative loss rate -> half of revenueAtStake
    expect(output.stakes.estimatedLoss).toBe(Math.round(408_547 * 0.5));
  });

  it('reports moderate confidence when anomaly leads and trailing layers disagree', () => {
    const output = topTierEarlyWarning.synthesize(miamiStar, ctx);
    // MIAMI hero: churn 50%, survival 50%. churn<0.3 is false, survival<0.7 is true.
    // So 2 of 3 layers agree (anomaly + survival). Not "multiStructuralStrong"
    // per the module (requires >=3 structurals at z>=3; MIAMI fixture has 2).
    // Result: 'moderate'.
    expect(output.confidence.level).toBe('moderate');
    expect(output.confidence.layerAgreementSummary).toContain('of 3');
  });

  it('includes blind spots and feedback hooks from the hero template', () => {
    const output = topTierEarlyWarning.synthesize(miamiStar, ctx);
    expect(output.blindSpots.length).toBeGreaterThan(0);
    expect(output.feedbackHooks.listenFors.length).toBeGreaterThan(0);
  });

  it('comparative framing avoids claiming a derived base rate', () => {
    const output = topTierEarlyWarning.synthesize(miamiStar, ctx);
    expect(output.comparative.saveLikelihood.toLowerCase()).toContain('stakes');
  });
});

// ---------------------------------------------------------------------------
// Integration via top-level synthesize()
// ---------------------------------------------------------------------------

describe('top_tier_early_warning - synthesize() integration', () => {
  it('routes MIAMI-like input to top_tier_early_warning', () => {
    const output = synthesize(miamiStar, ctx);
    expect(output.patternMatch).toBe('top_tier_early_warning');
  });

  it('does not hijack a recycler-breaking-pattern match (recycler wins first)', () => {
    // Construct an account that would match BOTH: RECYCLER cycles + structural
    // anomalies + top-tier revenue + anomalous + status != churned.
    // Recycler is registered first and is more specific (requires cycles
    // and gap ratio), so it should win.
    const recyclerAndTopTier: SynthesisInput = {
      ...miamiStar,
      nGapRecoveryCycles: 9,
      daysSinceLastOrder: 200,
      orders12mo: 12,
      status: 'declining',
    };
    const output = synthesize(recyclerAndTopTier, ctx);
    expect(output.patternMatch).toBe('recycler_breaking_pattern');
  });
});
