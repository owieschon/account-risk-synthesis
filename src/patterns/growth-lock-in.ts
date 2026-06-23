/**
 * Pattern: growth_lock_in
 *
 * Stable, low-risk accounts on a clear growth trajectory near their own peak
 * revenue, with a pattern history that shows they have weathered many past
 * gap-recovery cycles and are now in sustained growth. Not at risk; the
 * question is whether to invest in deepening the relationship before the
 * trajectory attracts competitive attention.
 *
 * Hero account: STONEGATE TRUCK EQUIPMENT (#7403): 26 gap-recovery cycles,
 * at peak revenue, +54% trailing trend, clean risk layers.
 *
 * This is an invest-story pattern, not a save-story pattern. No historical
 * recovery rate applies because there is no risk event to recover from.
 */

import type { Pattern, SynthesisInput, SynthesisOutput, MatcherContext } from '../types';

const CHURN_THRESHOLD = 0.05;
const SURVIVAL_THRESHOLD = 0.85;
// trendPct > 30 is the "strong YoY growth" bar for the distribution-industry
// ICP per the standing pattern-thresholds rule (industry-invariant ratio with
// a note to revisit if the ICP ever widens beyond distribution).
const STRONG_GROWTH_TREND_PCT = 30;
// Peak-proximity ratio: account is currently within 25% of its own peak
// revenue (self-referential baseline, per pattern-thresholds rule).
const PEAK_PROXIMITY_THRESHOLD = 0.75;

// Type classification: type. Accounts that match growth_lock_in describe a
// stable phenotype: weathered cycle history, near-peak revenue, clean risk
// layers, sustained growth trend. Membership persists across multiple
// consecutive snapshots as long as the growth trajectory holds; the rep
// action ("invest in the relationship") is an ongoing posture, not a time-
// bound window. Re-alerts should not re-fire across every snapshot while
// the account remains in the pattern.
export const growthLockIn: Pattern = {
  name: 'growth_lock_in',
  type: 'type',

  matches(input: SynthesisInput, ctx: MatcherContext): boolean {
    if (input.status !== 'stable') return false;
    if (input.riskTier !== 'low') return false;
    if (input.churnProb >= CHURN_THRESHOLD) return false;

    if (input.survivalProb90d == null || input.survivalProb90d <= SURVIVAL_THRESHOLD) return false;

    if (input.trendPct == null || input.trendPct <= STRONG_GROWTH_TREND_PCT) return false;

    if (input.revenue12moCurrent == null || input.peakRevenue12mo == null || input.peakRevenue12mo <= 0) {
      return false;
    }
    const peakRatio = input.revenue12moCurrent / input.peakRevenue12mo;
    if (peakRatio <= PEAK_PROXIMITY_THRESHOLD) return false;

    // Derived threshold: gap-cycle top band is p80 of tenant's active-account
    // distribution. Accounts in the top 20% of historical gap-recovery cycles
    // are the "weathered" RECYCLER population this pattern targets.
    if (input.nGapRecoveryCycles < ctx.gapCycleTopBand) return false;

    return true;
  },

  synthesize(input: SynthesisInput, _ctx: MatcherContext): SynthesisOutput {
    const currentRev = input.revenue12moCurrent ?? input.revenue12mo;
    const peakRev = input.peakRevenue12mo ?? currentRev;
    const cycles = input.nGapRecoveryCycles;
    const trend = input.trendPct ?? 0;
    const survivalPct = input.survivalProb90d != null ? Math.round(input.survivalProb90d * 100) : null;
    const churnPct = Math.round(input.churnProb * 100);

    const peakPhrase = peakRev > 0 && currentRev >= peakRev
      ? `at its peak revenue of ${formatMoney(currentRev)}`
      : `within reach of its ${formatMoney(peakRev)} peak (current ${formatMoney(currentRev)})`;

    return {
      patternMatch: 'growth_lock_in',
      diagnosis: {
        label: `${input.accountName} is on a clear growth trajectory. Not at risk; the question is whether to invest.`,
        body: `${input.accountName} is ${peakPhrase} with a ${formatTrend(trend)} trailing trend. All risk layers agree: ${churnPct}% churn probability${survivalPct != null ? `, ${survivalPct}% 90-day survival` : ''}, no anomaly firing. The pattern history shows ${cycles} gap-recovery cycles; this was historically a stop-start account that has stabilized into sustained growth. The opportunity isn't defense; it's deepening the relationship while the trajectory is positive and before the competition notices.`,
      },
      action: {
        imperative: `Invest in the ${input.accountName} relationship now. Understand what's driving the growth, confirm you are the primary supplier, and identify the next layer of expansion.`,
        investigationObjectives: [
          `What's driving the ${formatTrend(trend)} growth: customer-side expansion, market share capture, or share-of-wallet increase`,
          'Whether the account has a single buyer or whether the relationship has breadth across their organization',
          'Whether there are adjacent product categories the account is not yet buying that they could be',
          'Whether a formal account plan or pricing tier adjustment would accelerate the trajectory',
        ],
        signalsToTest: [
          {
            signal: "Customer's own business is expanding",
            indicates: 'growth is durable; invest in deeper relationship',
            nextStep: 'Schedule account planning session; map their expansion to your capability',
          },
          {
            signal: 'Share is being gained against a specific competitor',
            indicates: 'there is a displacement story to learn from; may be replicable',
            nextStep: 'Debrief with rep; document the displacement factors for use elsewhere',
          },
          {
            signal: 'Narrow buyer relationship (one person)',
            indicates: 'growth is fragile; single point of failure on the customer side',
            nextStep: 'Request introductions to others in the procurement or operations team',
          },
          {
            signal: 'No clear driver surfaced',
            indicates: "organic momentum; don't disrupt it",
            nextStep: 'Maintain current cadence; revisit in 90 days',
          },
        ],
        engagementOptions: [
          { option: 'Phone call', context: 'Conversational check-in on their growth', scope: 'individual', currentCapability: 'native' },
          { option: 'In-person visit', context: 'Growing accounts benefit from face time; reinforces the partnership', scope: 'individual', currentCapability: 'external' },
          { option: 'Account planning session', context: "Formal mapping of the account's trajectory to capability expansion", scope: 'individual', currentCapability: 'external' },
        ],
        timing: 'within_21_days',
        urgency: 'medium',
      },
      confidence: {
        level: 'high',
        layerAgreementSummary: 'All risk layers agree: stable, growing, no risk signals',
        unknownsSummary: 'Upside ceiling is unknown; could be a mid-tier that has found its level, or a future top-tier customer',
        layerAgreement: 1.0,
        dataCompleteness: 1.0,
        groundTruthAlignment: 1.0,
      },
      stakes: {
        revenueAtStake: Math.round(currentRev),
        estimatedLoss: null, // Not a save story; no expected loss
        networkExposure: input.siblingRevenue != null ? Math.round(input.siblingRevenue + currentRev) : null,
        lossRateSource: 'qualitative',
      },
      blindSpots: [
        'Whether the growth is customer-driven (their business expanding) or supplier-driven (share capture)',
        'Whether the relationship is broad (multiple contacts) or narrow (one buyer)',
        'Whether competitors are aware of the trajectory and are actively pursuing the account',
        'What the realistic ceiling is: a mid-tier account at its level, or a future top-tier customer',
      ],
      feedbackHooks: {
        listenFors: [
          { label: "Customer's business expanding", inputType: 'boolean' },
          { label: 'Buyer breadth within customer', inputType: 'text' },
          { label: 'Competitor pressure detected', inputType: 'boolean' },
          { label: 'Adjacent product opportunity identified', inputType: 'text' },
          { label: 'Appropriate ceiling estimate', inputType: 'text' },
        ],
      },
      comparative: {
        priorityRank: null,
        totalFlagged: null,
        saveLikelihood: 'Not a save story; an invest story. Accounts on this trajectory that get attention typically outperform accounts that are left to run on momentum.',
      },
      groundTruthNote: null,
      evidence: {
        layerAssessments: [
          { layer: 'Churn model', agrees: true, summary: `${churnPct}% churn probability, strong stability`, discountReason: null },
          { layer: 'Survival model', agrees: true, summary: survivalPct != null ? `${survivalPct}% at 90 days` : 'Survival data available', discountReason: null },
          { layer: 'Anomaly detector', agrees: true, summary: 'No anomaly detected, clean pattern', discountReason: null },
          { layer: 'Revenue trend', agrees: true, summary: `${formatTrend(trend)} trailing trend; ${currentRev >= peakRev ? 'at peak revenue' : 'near peak revenue'}`, discountReason: null },
        ],
        anomalyFeatures: [],
      },
      approximations: {
        medianGapIsApproximate: false,
      },
    };
  },
};

function formatMoney(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '$0';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

function formatTrend(pct: number): string {
  const rounded = Math.round(pct);
  return `${rounded >= 0 ? '+' : ''}${rounded}%`;
}
