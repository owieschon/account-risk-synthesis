import { describe, it, expect } from 'vitest';
import { synthesize } from '../src/synthesize';
import { growthLockIn } from '../src/patterns/growth-lock-in';
import type { SynthesisInput, MatcherContext } from '../src/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Deterministic tenant context used throughout these tests. Values chosen
 * so that HERITAGE (26 cycles) clears gapCycleTopBand (10) and the
 * revenue-top-tier is not essential for any assertion.
 */
const ctx: MatcherContext = {
  tenantId: 'test-tenant',
  revenueTopTier: 100_000,
  gapCycleTopBand: 10,
  activeAccountCount: 500,
};

/**
 * STONEGATE TRUCK EQUIPMENT (#7403) - hero account for growth_lock_in.
 * Values grounded in the hand-authored synthesis at
 * scripts/author-hero-synthesis.ts (heritageTruckEquipment block).
 */
const heritage: SynthesisInput = {
  accountId: 'heritage-uuid',
  accountName: 'STONEGATE TRUCK EQUIPMENT',
  externalId: '7403',
  status: 'stable',
  churnProb: 0.02,
  survivalProb90d: 0.91,
  medianSurvivalDays: null,
  isAnomalous: false,
  catchCategory: null,
  topAnomalyFeatures: null,
  nGapRecoveryCycles: 26,
  revenue12mo: 117_172,
  revenue12moCurrent: 117_172,
  revenue2026Ytd: null,
  revenuePriorYear: null,
  peakRevenue12mo: 117_172,
  daysSinceLastOrder: 16,
  orders12mo: 53,
  categoriesExited: [],
  concentrationTrend: null,
  riskScore: 2,
  riskTier: 'low',
  trendPct: 54,
  parentCompanyId: null,
  childCount: 0,
  siblingRevenue: null,
  predictedRevenue12mo: null,
  forecastChangePct: null,
  componentScores: { n_gap_recovery_cycles: 26 },
};

/** At-risk account - high churn, declining; should not match. */
const atRisk: SynthesisInput = {
  ...heritage,
  accountId: 'at-risk-uuid',
  accountName: 'AT RISK ACCOUNT',
  externalId: '99001',
  status: 'declining',
  churnProb: 0.72,
  survivalProb90d: 0.22,
  riskTier: 'high',
  trendPct: -45,
  revenue12moCurrent: 20_000,
  peakRevenue12mo: 80_000,
  isAnomalous: true,
};

/** Account with too few gap-recovery cycles - below ctx.gapCycleTopBand. */
const lowCycles: SynthesisInput = {
  ...heritage,
  accountId: 'low-cycles-uuid',
  accountName: 'YOUNG STABLE ACCOUNT',
  externalId: '99002',
  nGapRecoveryCycles: 4, // ctx.gapCycleTopBand = 10
  componentScores: { n_gap_recovery_cycles: 4 },
};

/** Account with declining trend - should not match. */
const declining: SynthesisInput = {
  ...heritage,
  accountId: 'declining-uuid',
  accountName: 'DECLINING WEATHERED ACCOUNT',
  externalId: '99003',
  trendPct: -12,
};

/** Account far from peak revenue - ratio below 0.5. */
const offPeak: SynthesisInput = {
  ...heritage,
  accountId: 'off-peak-uuid',
  accountName: 'OFF PEAK ACCOUNT',
  externalId: '99004',
  revenue12moCurrent: 40_000,
  peakRevenue12mo: 200_000, // ratio 0.2
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('growth_lock_in - matches()', () => {
  it('matches HERITAGE-like fixture (26 cycles, at peak, +54% trend)', () => {
    expect(growthLockIn.matches(heritage, ctx)).toBe(true);
  });

  it('does not match an at-risk account (high churn, declining)', () => {
    expect(growthLockIn.matches(atRisk, ctx)).toBe(false);
  });

  it('does not match an account below tenant gap-cycle top band', () => {
    expect(growthLockIn.matches(lowCycles, ctx)).toBe(false);
  });

  it('does not match an account with declining trend', () => {
    expect(growthLockIn.matches(declining, ctx)).toBe(false);
  });

  it('does not match an account far from peak revenue', () => {
    expect(growthLockIn.matches(offPeak, ctx)).toBe(false);
  });

  it('does not match when survivalProb90d is missing', () => {
    expect(growthLockIn.matches({ ...heritage, survivalProb90d: null }, ctx)).toBe(false);
  });

  it('does not match when churnProb meets or exceeds 0.05 threshold', () => {
    expect(growthLockIn.matches({ ...heritage, churnProb: 0.06 }, ctx)).toBe(false);
  });

  it('does not match when riskTier is not low', () => {
    expect(growthLockIn.matches({ ...heritage, riskTier: 'medium' }, ctx)).toBe(false);
  });

  it('respects tenant-derived gap-cycle threshold (same account, different tenant)', () => {
    // Heritage has 26 cycles. If a tenant's top band is 30, heritage does not
    // clear it even though it would in the default fixture tenant.
    const strictTenant: MatcherContext = { ...ctx, gapCycleTopBand: 30 };
    expect(growthLockIn.matches(heritage, strictTenant)).toBe(false);
  });
});

describe('growth_lock_in - synthesize()', () => {
  it('produces well-formed output for HERITAGE-like fixture', () => {
    const output = growthLockIn.synthesize(heritage, ctx);
    expect(output.patternMatch).toBe('growth_lock_in');
    expect(output.diagnosis.label).toContain('STONEGATE TRUCK EQUIPMENT');
    expect(output.diagnosis.body).toContain('26 gap-recovery cycles');
    expect(output.action.urgency).toBe('medium');
    expect(output.confidence.level).toBe('high');
  });

  it('frames stakes as not-at-risk (no estimatedLoss)', () => {
    const output = growthLockIn.synthesize(heritage, ctx);
    expect(output.stakes.estimatedLoss).toBeNull();
    expect(output.stakes.lossRateSource).toBe('qualitative');
    expect(output.stakes.revenueAtStake).toBe(117_172);
  });

  it('describes the pattern as invest-story, not save-story', () => {
    const output = growthLockIn.synthesize(heritage, ctx);
    expect(output.comparative.saveLikelihood.toLowerCase()).toContain('invest story');
    expect(output.action.imperative).toContain('Invest');
  });

  it('includes the account-specific trend in the diagnosis body', () => {
    const output = growthLockIn.synthesize(heritage, ctx);
    expect(output.diagnosis.body).toContain('+54%');
  });

  it('reports all four risk layers agreeing', () => {
    const output = growthLockIn.synthesize(heritage, ctx);
    const agreeing = output.evidence.layerAssessments.filter(l => l.agrees);
    expect(agreeing.length).toBe(4);
  });
});

describe('growth_lock_in - synthesize() integration via top-level synthesize()', () => {
  it('routes HERITAGE-like input to growth_lock_in', () => {
    const output = synthesize(heritage, ctx);
    expect(output.patternMatch).toBe('growth_lock_in');
  });
});
