/**
 * Pattern: silent_winback
 *
 * The blind-spot pattern. An account that is quietly fading from its own
 * historical peak while every risk layer looks calm: the churn model sees
 * low probability, the survival model says they will come back, the anomaly
 * detector finds no single extreme feature. The signal is the trajectory
 * across all of them.
 *
 * Hero account: VALLEYVIEW TRUCK PARTS (#7402). Peak 12-month revenue was
 * ~$87K; current 12-month revenue is ~$34K (39% of peak, a 61% drop).
 * 3 orders in the trailing 12 months. Churn prob ~2%, survival ~99% at
 * 90 days, isAnomalous=false. status=declining, risk_tier=low.
 *
 * Philosophy: silent-winback accounts sit in the gap between the other
 * three risk layers. The pattern is a pre-churn diagnosis: catch the
 * relationship before dormancy sets in, while a conversation can still
 * change the trajectory.
 *
 * Order-cadence data availability note + over-catch risk. The standing
 * pattern-thresholds rule envisions an
 * `orders_12mo_current / orders_12mo_peak < 0.5` condition for this
 * pattern. `SynthesisInput` currently carries only `orders12mo` (current);
 * no historical-peak order-cadence field exists anywhere in the pipeline
 * (verified: not in SynthesisInput, not in the accounts table, not
 * computed). Adding it requires pipeline work against the events table,
 * not a simple SynthesisInput field addition.
 *
 * The missing condition was meant to distinguish "quietly fading" from
 * "revenue down for other reasons." Without it, this matcher may
 * over-catch accounts whose revenue dropped from peak due to price
 * changes, category mix shift, or the loss of a single large account
 * line, rather than true silent-fade of the relationship. The remaining
 * conditions (revenue ratio, declining trend, all four risk layers
 * quiet) are consistent with silent fade but do not rule out those
 * alternative causes. Step C's coverage re-run is where over-catch will
 * show up if it is happening: if silent_winback catches significantly
 * more than the hero-example cohort size suggests, the order-cadence
 * addition becomes a near-term priority rather than a future
 * opportunity.
 */

import type { Pattern, SynthesisInput, SynthesisOutput, MatcherContext } from '../types';

// Universal probability floors (exception #1 in pattern-thresholds.md).
// "The churn model is not alarmed" and "the survival model says they come
// back." If either layer IS alarmed, the account belongs to a different
// pattern (churn_model territory or recycler_breaking_pattern).
const CHURN_NOT_ALARMED = 0.3;
const SURVIVAL_LIKELY_RETURN = 0.5;

// Account-relative ratio. Current 12-month revenue is at or below ~55% of
// the account's own historical peak 12-month revenue. Self-referential; no
// tenant norm needed. Hero is at 0.39.
const PEAK_DROP_RATIO = 0.55;

// Industry-invariant trend bar (exception #3 in pattern-thresholds.md).
// A 20-point trailing-revenue drop is the "clearly declining" bar for the
// distribution-industry ICP. Distinguishes silent winback from merely-lower-
// than-peak accounts that have stabilized at a new (lower) level. Revisit
// if the ICP widens beyond distribution.
const DECLINING_TREND_PCT = -20;

// Qualitative loss rate for stakes math. Silent-winback accounts that do
// not get re-engaged tend to drift into dormancy within 6 to 12 months.
// No production base-rate data yet; the 50% figure is conservative and
// mirrors the "half of the relationship is already gone" framing.
const QUALITATIVE_LOSS_RATE = 0.5;

// Type classification: moment. Silent-winback is the reference moment
// pattern in .claude/rules/pattern-type-vs-moment.md: most accounts pass
// through the pattern for one or a few snapshots on their trajectory from
// stable to dormant, and the value of the Cue is acting within that window.
// An account that "lives in" silent-winback for many snapshots is not
// actually silent-winback; it has already crossed into dormancy.
// Window: 21 days. Matches "within 14 days" action timing plus buffer.
const MOMENT_WINDOW_DAYS = 21;

export const silentWinback: Pattern = {
  name: 'silent_winback',
  type: 'moment',
  momentWindowDays: MOMENT_WINDOW_DAYS,

  matches(input: SynthesisInput, _ctx: MatcherContext): boolean {
    // Churned accounts are already gone. Dormant accounts have already
    // failed the retention bar. Neither is "silent winback" territory.
    if (input.status === 'churned') return false;
    if (input.status === 'dormant') return false;

    // The churn model is not alarmed about this account. If it were, the
    // account routes to a churn-focused pattern instead.
    if (input.churnProb >= CHURN_NOT_ALARMED) return false;

    // The survival model says the account is more likely than not to
    // return. Strict greater-than keeps the boundary clean.
    if (input.survivalProb90d == null) return false;
    if (input.survivalProb90d <= SURVIVAL_LIKELY_RETURN) return false;

    // The anomaly detector has not fired. This is the pattern's defining
    // characteristic: no single feature is extreme enough for the scorer
    // to catch it.
    if (input.isAnomalous) return false;

    // Peak-to-current revenue ratio must be clearly below peak. Uses the
    // account's own history as the baseline (ui-design.md Rule 2 +
    // pattern-thresholds.md account-relative ratio).
    if (input.revenue12moCurrent == null) return false;
    if (input.peakRevenue12mo == null || input.peakRevenue12mo <= 0) return false;
    const peakRatio = input.revenue12moCurrent / input.peakRevenue12mo;
    if (peakRatio >= PEAK_DROP_RATIO) return false;

    // Revenue trend is clearly negative. Distinguishes a declining account
    // from one that found its floor at a lower level and is stable there.
    if (input.trendPct == null) return false;
    if (input.trendPct >= DECLINING_TREND_PCT) return false;

    return true;
  },

  synthesize(input: SynthesisInput, _ctx: MatcherContext): SynthesisOutput {
    const currentRev = input.revenue12moCurrent ?? input.revenue12mo;
    const peakRev = input.peakRevenue12mo ?? currentRev;
    const dropPct = peakRev > 0 ? Math.round((1 - currentRev / peakRev) * 100) : 0;
    const churnPct = Math.round(input.churnProb * 100);
    const survivalPct = input.survivalProb90d != null ? Math.round(input.survivalProb90d * 100) : null;
    const trendPct = input.trendPct ?? 0;
    const orders = input.orders12mo;
    const gapDays = input.daysSinceLastOrder;

    const ordersPhrase = orders != null && orders > 0
      ? `${orders} orders in the trailing 12 months`
      : 'order cadence has quieted materially';
    const gapPhrase = gapDays != null
      ? ` and ${gapDays} days since the last order`
      : '';

    const body = `${input.accountName} is at ${formatMoney(currentRev)} trailing revenue, down ${dropPct}% from its ${formatMoney(peakRev)} peak. The churn model reads ${churnPct}%, not alarmed${survivalPct != null ? `; the survival model says ${survivalPct}% chance they come back at 90 days` : ''}; the anomaly detector is not firing. The trajectory is the signal: ${ordersPhrase}${gapPhrase}, on a ${formatTrend(trendPct)} trailing trend. No single layer sees a problem because the decline was gradual, and the drop across them is what this pattern catches.`;

    // Estimated loss is the gap back to peak. This is what is potentially
    // recoverable if re-engagement lands.
    const recoverableGap = Math.max(0, Math.round(peakRev - currentRev));
    const estimatedLoss = Math.max(recoverableGap, Math.round(currentRev * QUALITATIVE_LOSS_RATE));

    return {
      patternMatch: 'silent_winback',
      diagnosis: {
        label: `${input.accountName} slipped from ${formatMoney(peakRev)} peak to ${formatMoney(currentRev)}. No risk layer alarmed.`,
        body,
      },
      action: {
        imperative: `Reach out to ${input.accountName} before the dormancy pattern sets in. The decline is slow enough that no single layer is alarming, but the trajectory is clear.`,
        investigationObjectives: [
          'Whether the buyer relationship is still intact: same contact, same role, same procurement process',
          'What drove the trajectory change: consolidation, competitive displacement, fleet reduction, or operational shift on the customer side',
          `Whether ${formatMoney(currentRev)} is the new floor or a way-station on the decline path`,
          'What would bring them back to their historical range: product availability, pricing, service, or all three',
        ],
        signalsToTest: [
          {
            signal: 'Buyer is still active, just buying less',
            indicates: 'relationship intact; product or pricing competition is the story',
            nextStep: 'Quote review; assess what they are buying elsewhere',
          },
          {
            signal: 'Business has consolidated or contracted',
            indicates: 'structural shift on customer side; expectations should be reset',
            nextStep: 'Account tier re-classification; right-size the relationship',
          },
          {
            signal: 'New buyer or procurement process',
            indicates: 'relationship reset required; prior rapport does not transfer',
            nextStep: 'Formal reintroduction and account plan',
          },
          {
            signal: 'No response to outreach',
            indicates: 'relationship may already be effectively over',
            nextStep: 'One more attempt via a different channel; then reclassify',
          },
        ],
        engagementOptions: [
          { option: 'Phone call', context: 'Direct check-in from the rep who holds the relationship is the fastest read', scope: 'individual', currentCapability: 'native' },
          { option: 'Email', context: 'Lower friction if phone does not connect', scope: 'individual', currentCapability: 'native' },
          { option: 'In-person visit', context: 'Strongest signal but costly; warranted if the account was strategic at its peak', scope: 'individual', currentCapability: 'external' },
        ],
        timing: 'within_14_days',
        urgency: 'medium',
      },
      confidence: buildConfidence(input, dropPct),
      stakes: {
        // Revenue at stake is current run rate. Peak represents what was
        // there; current is what is actively being lost if silence becomes
        // full dormancy.
        revenueAtStake: Math.round(currentRev),
        estimatedLoss,
        networkExposure: input.siblingRevenue != null ? Math.round(input.siblingRevenue + currentRev) : null,
        // Qualitative: no production base rate exists yet for silent-winback
        // recovery. The gap-to-peak framing anchors the stakes without
        // claiming a derived recovery rate.
        lossRateSource: 'qualitative',
      },
      blindSpots: [
        'Whether this rep has already had this conversation recently (contact logging may be incomplete)',
        'Whether a competitor replaced us specifically, or whether the customer\'s own volume dropped',
        'Fleet composition, consolidation, or ownership changes on the customer side',
        'Whether account reclassification is warranted or whether winback is realistic',
      ],
      feedbackHooks: {
        listenFors: [
          { label: 'Buyer same or changed', inputType: 'text' },
          { label: 'Competitor named', inputType: 'text' },
          { label: 'Customer volume or fleet contracted', inputType: 'boolean' },
          { label: 'Product availability gap', inputType: 'boolean' },
          { label: 'No response to outreach', inputType: 'boolean' },
        ],
      },
      comparative: {
        priorityRank: null,
        totalFlagged: null,
        saveLikelihood: 'Winback stories like this are underexplored in current data. Base rate unknown; act based on magnitude (gap to peak) rather than statistical expectation.',
      },
      groundTruthNote: null,
      evidence: {
        layerAssessments: buildLayerAssessments(input, currentRev, peakRev, dropPct),
        anomalyFeatures: [],
      },
      approximations: {
        medianGapIsApproximate: false,
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildConfidence(
  input: SynthesisInput,
  dropPct: number,
): SynthesisOutput['confidence'] {
  // The four model/analytic layers reasoned about:
  //   1. Churn model:  expected to NOT flag (that is why we are here).
  //   2. Survival:     expected to NOT flag (they say return likely).
  //   3. Anomaly:      expected to NOT flag (no single feature extreme).
  //   4. Peak-to-current trajectory: the layer carrying the diagnosis.
  //
  // For silent_winback specifically, "layer agreement" reads inverted: the
  // first three layers agreeing-with-pattern means they agree-they-missed-it.
  // The trajectory layer is always the one doing the work.

  const churnQuiet = input.churnProb < CHURN_NOT_ALARMED;
  const survivalQuiet = input.survivalProb90d != null && input.survivalProb90d > SURVIVAL_LIKELY_RETURN;
  const anomalyQuiet = !input.isAnomalous;
  const trajectoryClear = dropPct >= Math.round((1 - PEAK_DROP_RATIO) * 100);

  const quietLayers = [churnQuiet, survivalQuiet, anomalyQuiet].filter(Boolean).length;
  const total = 4;
  // Agreement == all 3 quiet layers stayed quiet AND trajectory is clear.
  const agreeingWithPattern = quietLayers + (trajectoryClear ? 1 : 0);

  // High confidence when all four layers agree cleanly (three quiet +
  // trajectory clear). Moderate when three of four line up. Low otherwise.
  const level: 'high' | 'moderate' | 'low' =
    agreeingWithPattern === 4 ? 'high'
    : agreeingWithPattern === 3 ? 'moderate'
    : 'low';

  return {
    level,
    layerAgreementSummary: 'Trajectory is clear; current-state layers see no alarm',
    unknownsSummary: 'Individual churn/survival layers cannot see trajectory; this diagnosis rests on peak-to-current magnitude',
    layerAgreement: agreeingWithPattern / total,
    dataCompleteness: input.survivalProb90d != null ? 1.0 : 0.75,
    groundTruthAlignment: 1.0,
  };
}

function buildLayerAssessments(
  input: SynthesisInput,
  currentRev: number,
  peakRev: number,
  dropPct: number,
): SynthesisOutput['evidence']['layerAssessments'] {
  const churnPct = Math.round(input.churnProb * 100);
  const survivalPct = input.survivalProb90d != null ? Math.round(input.survivalProb90d * 100) : null;

  const layers: SynthesisOutput['evidence']['layerAssessments'] = [
    {
      layer: 'Churn model',
      agrees: false,
      summary: `${churnPct}% churn probability, not alarmed`,
      discountReason: 'Churn model is trained on binary outcomes; it does not see gradual relationship decay',
    },
    {
      layer: 'Survival model',
      agrees: false,
      summary: survivalPct != null ? `${survivalPct}% at 90 days; they will order something` : 'Survival not alarmed',
      discountReason: 'Survival looks at next-order probability, not revenue magnitude of the relationship',
    },
    {
      layer: 'Anomaly detector',
      agrees: false,
      summary: 'Not flagged',
      discountReason: 'No individual feature is extreme; the signal is the trajectory across all of them',
    },
    {
      layer: 'Peak-to-current trajectory',
      agrees: true,
      summary: `${formatMoney(peakRev)} peak to ${formatMoney(currentRev)} current, down ${dropPct}%`,
      discountReason: null,
    },
  ];

  return layers;
}

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
