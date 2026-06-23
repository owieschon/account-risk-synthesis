/**
 * Pattern: top_tier_early_warning
 *
 * Matches top-tier accounts (by revenue) whose headline numbers still look
 * healthy but whose structural anomaly features have shifted meaningfully.
 * The trailing invoiced revenue hasn't caught up yet; the signal is in the
 * underlying composition (backlog, slope, churn-adjacent features).
 *
 * Hero account: RIVERSIDE TRUCK PARTS (#7401), revenue_12mo $408K, top-3 customer,
 * backlog_value_open z=9.61, revenue_slope_12mo z=8.95, revenue_12mo z=6.56.
 * The churn model says 50%, survival says 50%, trend is +6%; the anomaly
 * detector is the layer doing the work.
 *
 * Philosophy: the time to act on a major account is while the shift is still
 * subtle. Once it shows up in invoiced revenue, the relationship has already
 * moved. No historical recovery rate is meaningful because "recovery" presumes
 * a loss event, and this pattern fires before one is visible.
 */

import type { Pattern, SynthesisInput, SynthesisOutput, MatcherContext } from '../types';
import { STRUCTURAL_SIGNALS } from './recycler-breaking-pattern';

// z-scores are statistically universal (exception #2 in pattern-thresholds.md)
const STRUCTURAL_Z_THRESHOLD = 3.0;
const MIN_STRUCTURAL_ANOMALIES = 2;

// Qualitative loss rate. No historical recovery data exists for this pattern
// because it fires before a loss event is visible in invoiced revenue. The
// 50% figure mirrors the RIVERSIDE TRUCK PARTS hero's survival-model split and errs
// toward "investigate, don't assume loss."
const QUALITATIVE_LOSS_RATE = 0.5;

interface StructuralAnomaly {
  feature: string;
  zScore: number;
  direction: string;
}

function collectStructuralAnomalies(input: SynthesisInput): StructuralAnomaly[] {
  if (!input.topAnomalyFeatures) return [];
  const out: StructuralAnomaly[] = [];
  for (const f of input.topAnomalyFeatures) {
    if (STRUCTURAL_SIGNALS.has(f.feature) && f.z_score >= STRUCTURAL_Z_THRESHOLD) {
      out.push({ feature: f.feature, zScore: f.z_score, direction: f.direction });
    }
  }
  return out;
}

function translateStructuralFeature(feature: string, zScore: number): string {
  const translations: Record<string, (z: number) => string> = {
    backlog_value_open: (z) => `Open backlog value ${z.toFixed(1)}x typical. Unusually large pipeline of placed but uninvoiced orders.`,
    revenue_slope_12mo: (z) => `Revenue slope shifted ${z.toFixed(1)}x beyond normal. Trajectory change detected before it shows in trailing totals.`,
    revenue_12mo: (z) => `Revenue magnitude ${z.toFixed(1)}x normal. Confirms top-tier account size.`,
    csr_churn_intensity: (z) => `Rep/CSR turnover unusually high (${z.toFixed(1)}x normal).`,
    csr_churn_recent: (z) => `Recent rep/CSR changes elevated (${z.toFixed(1)}x).`,
    sudden_silence: (z) => `Ordering stopped abruptly rather than trailing off (${z.toFixed(1)}x signal).`,
    days_since_last_backlog_order: (z) => `Backlog orders slowed before the current gap (${z.toFixed(1)}x longer than usual).`,
  };
  const fn = translations[feature];
  if (fn) return fn(zScore);
  return `${feature.replace(/_/g, ' ')} at ${zScore.toFixed(1)}x deviation.`;
}

// Type classification: moment. The early-warning window is the gap between
// the structural anomaly firing and the trailing invoiced revenue catching
// up to reflect it. Once invoiced revenue moves, the relationship has
// already shifted and the "act while the signal is still subtle" framing
// no longer applies: a different pattern (recycler_breaking_pattern, or
// eventually dormancy) is the appropriate read. Window: 30 days. Top-tier
// accounts deserve a longer reflection window than medium accounts; the
// 30-day horizon matches "within 10 days" action timing plus generous
// buffer for account-planning workflows.
const MOMENT_WINDOW_DAYS = 30;

export const topTierEarlyWarning: Pattern = {
  name: 'top_tier_early_warning',
  type: 'moment',
  momentWindowDays: MOMENT_WINDOW_DAYS,

  matches(input: SynthesisInput, ctx: MatcherContext): boolean {
    // Must be flagged by the anomaly detector. This is the layer doing the
    // work; other layers may disagree.
    if (!input.isAnomalous) return false;

    // Top-tier accounts that have already churned aren't "early warning";
    // they're a different story.
    if (input.status === 'churned') return false;

    // Revenue must exist and clear the tenant-derived top-tier threshold
    // (p85 of the active-account revenue distribution, per
    // .claude/rules/pattern-thresholds.md).
    if (input.revenue12mo == null) return false;
    if (input.revenue12mo < ctx.revenueTopTier) return false;

    // Require at least 2 structural anomalies at z >= 3. Structural signals
    // shift before trailing invoiced revenue moves; two of them lining up
    // is the "something is changing" floor.
    const structurals = collectStructuralAnomalies(input);
    if (structurals.length < MIN_STRUCTURAL_ANOMALIES) return false;

    return true;
  },

  synthesize(input: SynthesisInput, _ctx: MatcherContext): SynthesisOutput {
    const structurals = collectStructuralAnomalies(input);
    const revenue = input.revenue12moCurrent ?? input.revenue12mo;
    const churnPct = Math.round(input.churnProb * 100);
    const survivalPct = input.survivalProb90d != null ? Math.round(input.survivalProb90d * 100) : null;
    const trendPct = input.trendPct;

    // Describe the anomalies for the body text. Top 3 so the narrative stays
    // readable; anything beyond that is captured in evidence.anomalyFeatures.
    const featureNarratives = structurals
      .slice(0, 3)
      .map((s) => `${humanizeFeature(s.feature)} ${s.zScore.toFixed(1)} standard deviations from normal`);
    const featuresPhrase = featureNarratives.length > 1
      ? `${featureNarratives.slice(0, -1).join(', ')}, and ${featureNarratives[featureNarratives.length - 1]}`
      : featureNarratives[0] ?? 'multiple structural features outside their normal range';

    const trendPhrase = trendPct != null
      ? `a ${formatTrend(trendPct)} trailing trend on invoiced revenue`
      : 'steady trailing invoiced revenue';

    // Body text structure: trailing metrics look fine, but the anomaly layer
    // is pointing somewhere. Mirrors the RIVERSIDE TRUCK PARTS hero's framing.
    const body = `${input.accountName} sits in the top tier of the book at ${formatMoney(revenue)} trailing revenue. On the surface, ${trendPhrase} tells a healthy story. Beneath it, the anomaly detector is firing: ${featuresPhrase}. The churn model reads ${churnPct}%${survivalPct != null ? ` and survival splits ${survivalPct}% at 90 days` : ''}. The trailing layers and the structural layer are not agreeing yet, which is itself the signal.`;

    // Investigation objectives derived from which features fired. Each
    // structural signal maps to a specific hypothesis worth checking.
    const investigationObjectives = buildInvestigationObjectives(structurals, input);

    // Loss rate is qualitative (no historical data for this pattern) and
    // conservative (50% mirrors the hero survival split).
    const estimatedLoss = Math.round(revenue * QUALITATIVE_LOSS_RATE);

    return {
      patternMatch: 'top_tier_early_warning',
      diagnosis: {
        label: `${input.accountName}: top-tier account showing structural anomalies before trailing revenue moves.`,
        body,
      },
      action: {
        imperative: `Investigate ${input.accountName} before the shift becomes visible in invoiced revenue. The time to act on a major account is when the signal is still subtle.`,
        investigationObjectives,
        signalsToTest: [
          {
            signal: 'Large backlog reflects a consolidated bulk order',
            indicates: 'possible competitive pressure driving bundling, or a one-time procurement event',
            nextStep: 'Escalate to pricing review; confirm whether a competitor is bidding the account',
          },
          {
            signal: 'Order composition narrowing (fewer SKUs per order, different categories)',
            indicates: 'customer may be sourcing some lines elsewhere',
            nextStep: 'Outside sales visit; understand what they are buying from whom',
          },
          {
            signal: 'New buyer, procurement process change, or ownership event',
            indicates: 'relationship reset required; prior rapport doesn\'t transfer',
            nextStep: 'Formal reintroduction and account-planning session',
          },
          {
            signal: 'No detectable change in customer-side factors',
            indicates: 'anomaly may resolve; continue monitoring',
            nextStep: 'Log findings; revisit in 30 days',
          },
        ],
        engagementOptions: [
          { option: 'Phone call', context: 'Fastest read on what changed; rep with the relationship should lead', scope: 'individual', currentCapability: 'native' },
          { option: 'In-person visit', context: 'Top-tier account warrants face time; strongest signal on structural shifts', scope: 'individual', currentCapability: 'external' },
          { option: 'Account planning session', context: 'Formal mapping of the account\'s trajectory against capability expansion', scope: 'individual', currentCapability: 'external' },
        ],
        timing: 'within_10_days',
        urgency: 'high',
      },
      confidence: buildConfidence(input, structurals),
      stakes: {
        revenueAtStake: Math.round(revenue),
        estimatedLoss,
        networkExposure: input.siblingRevenue != null ? Math.round(input.siblingRevenue + revenue) : null,
        // Qualitative, per pattern definition: no historical recovery rate
        // exists for "top-tier account with structural anomaly but no loss
        // event visible yet."
        lossRateSource: 'qualitative',
      },
      blindSpots: [
        'Whether the structural anomaly reflects a one-time procurement bundling event or a new baseline',
        'Whether a competitor has been bidding (not visible in tenant-side data alone)',
        'Changes on the customer side: ownership, sourcing strategy, fleet composition, buyer turnover',
        'Whether the anomaly features will normalize when invoiced revenue catches up to the backlog',
      ],
      feedbackHooks: {
        listenFors: [
          { label: 'Competitor named', inputType: 'text' },
          { label: 'Procurement or buyer change', inputType: 'boolean' },
          { label: 'Order composition shift observed', inputType: 'text' },
          { label: 'Customer-side operational change', inputType: 'text' },
          { label: 'Nothing concerning detected', inputType: 'boolean' },
        ],
      },
      comparative: {
        priorityRank: null,
        totalFlagged: null,
        saveLikelihood: 'Early-warning catches on top-tier accounts have a high return on investigation. Historical base-rate data on this pattern is thin; prioritize based on stakes, not on a derived recovery rate.',
      },
      groundTruthNote: null,
      evidence: {
        layerAssessments: buildLayerAssessments(input, structurals),
        anomalyFeatures: structurals.slice(0, 3).map((s) => ({
          feature: s.feature,
          narrative: translateStructuralFeature(s.feature, s.zScore),
          zScore: s.zScore,
        })),
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

function buildInvestigationObjectives(
  structurals: StructuralAnomaly[],
  _input: SynthesisInput,
): string[] {
  const objectives: string[] = [];
  const firedSet = new Set(structurals.map((s) => s.feature));

  if (firedSet.has('backlog_value_open')) {
    objectives.push('Why the open-backlog spike coincides with the other structural signals (one-time bundling vs a new pattern)');
  }
  if (firedSet.has('revenue_slope_12mo') || firedSet.has('sudden_silence')) {
    objectives.push('Whether the order composition is shifting (product mix, SKU diversity, average size per order)');
  }
  if (firedSet.has('csr_churn_intensity') || firedSet.has('csr_churn_recent')) {
    objectives.push('Whether rep/CSR turnover on either side has broken the working relationship');
  }
  if (firedSet.has('days_since_last_backlog_order')) {
    objectives.push('Why backlog orders slowed before the current gap opened');
  }

  // Always include the relational/competitive checks.
  objectives.push('Whether the buyer contact, procurement process, or ownership on the customer side has changed');
  objectives.push('Whether a specific competitor has approached the account');

  // Cap at 5 for readability; the most-specific ones (data-driven) come first.
  return objectives.slice(0, 5);
}

function buildConfidence(
  input: SynthesisInput,
  structurals: StructuralAnomaly[],
): SynthesisOutput['confidence'] {
  // Three layers to reason about: anomaly detector, churn model, survival
  // model. For this pattern, the anomaly detector is always agreeing (it's
  // what triggered the match). Churn and survival typically don't agree
  // yet; that's the pattern's definition. We report the split honestly.
  const layers = [
    { name: 'anomaly', agrees: true },
    { name: 'churn', agrees: input.churnProb >= 0.3 },
    { name: 'survival', agrees: input.survivalProb90d != null && input.survivalProb90d < 0.7 },
  ];
  const total = layers.length;
  const agreeing = layers.filter((l) => l.agrees).length;

  // Confidence is moderate when the anomaly layer is leading and the trailing
  // layers are ambiguous or disagreeing. That is the definition of "early
  // warning." Only bump to high when multiple structural anomalies are very
  // extreme and another layer corroborates.
  const peakZ = structurals.reduce((max, s) => Math.max(max, s.zScore), 0);
  const multiStructuralStrong = structurals.length >= 3 && peakZ >= 6;
  const level: 'high' | 'moderate' | 'low' =
    multiStructuralStrong && agreeing >= 2 ? 'high'
    : agreeing >= 1 ? 'moderate'
    : 'low';

  return {
    level,
    layerAgreementSummary: `${agreeing} of ${total} risk layers agree on the anomaly`,
    unknownsSummary: 'Direction of the shift (competitive, operational, or relationship) is unknown until investigation',
    layerAgreement: agreeing / total,
    dataCompleteness: input.survivalProb90d != null ? 1.0 : 0.67,
    groundTruthAlignment: 1.0,
  };
}

function buildLayerAssessments(
  input: SynthesisInput,
  structurals: StructuralAnomaly[],
): SynthesisOutput['evidence']['layerAssessments'] {
  const layers: Array<SynthesisOutput['evidence']['layerAssessments'][number]> = [];
  const peakZ = structurals.reduce((max, s) => Math.max(max, s.zScore), 0);

  layers.push({
    layer: 'Anomaly detector',
    agrees: true,
    summary: structurals.length >= 2
      ? `${structurals.length} structural signals firing, peak z=${peakZ.toFixed(1)}`
      : 'GENUINE_CATCH on structural features',
    discountReason: null,
  });

  const churnPct = Math.round(input.churnProb * 100);
  layers.push({
    layer: 'Churn model',
    agrees: input.churnProb >= 0.3,
    summary: `${churnPct}% churn probability`,
    discountReason: input.churnProb < 0.3
      ? 'Trained on recency/frequency signals; does not see structural changes in backlog or mix'
      : null,
  });

  if (input.survivalProb90d != null) {
    const survivalPct = Math.round(input.survivalProb90d * 100);
    layers.push({
      layer: 'Survival model',
      agrees: input.survivalProb90d < 0.7,
      summary: `${survivalPct}% at 90 days`,
      discountReason: input.survivalProb90d >= 0.7
        ? 'Pattern-matches against prior recoveries; structural shift may not resemble past gaps'
        : null,
    });
  }

  if (input.trendPct != null) {
    layers.push({
      layer: 'Revenue trend',
      agrees: input.trendPct < 0,
      summary: `${formatTrend(input.trendPct)} trailing trend`,
      discountReason: input.trendPct >= 0
        ? 'Trailing metrics lag structural shifts; this is the gap the anomaly layer covers'
        : null,
    });
  }

  return layers;
}

function humanizeFeature(feature: string): string {
  const map: Record<string, string> = {
    backlog_value_open: 'open-backlog value',
    revenue_slope_12mo: 'revenue slope',
    revenue_12mo: 'revenue magnitude',
    csr_churn_intensity: 'rep/CSR turnover intensity',
    csr_churn_recent: 'recent rep/CSR turnover',
    sudden_silence: 'order-cadence break',
    days_since_last_backlog_order: 'backlog-order cadence',
  };
  return map[feature] ?? feature.replace(/_/g, ' ');
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
