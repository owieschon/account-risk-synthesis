/**
 * Pattern: recycler_breaking_pattern
 *
 * Matches RECYCLER accounts (≥3 gap-recovery cycles) where the current
 * silence is structurally different from past recoveries. Demo hero pattern.
 *
 * Hero account: Ridgeway Fabrication (#7404) — 9 cycles, 179 days silent, anomaly flagged.
 *
 * Historical recovery rate computed from the tenant's transaction history.
 * Loss rate: 40.8%. Data-derived, not qualitative.
 */

import type { Pattern, SynthesisInput, SynthesisOutput, MatcherContext } from '../types';
import { PATTERN_RECOVERY_RATES } from '../historical-recovery-rates';
import { PATTERN_LIBRARY_VERSION, SYNTHESIS_FUNCTION_VERSION, DEFAULT_MODEL_VERSION } from '../version';

const RECYCLER_MIN_CYCLES = 3;
const GAP_RATIO_THRESHOLD = 1.5;
const STRUCTURAL_SIGNAL_Z_THRESHOLD = 3.0;
const MIX_NARROWING_Z_THRESHOLD = 2.0;

export const STRUCTURAL_SIGNALS = new Set([
  'csr_churn_intensity',
  'csr_churn_recent',
  'sudden_silence',
  'days_since_last_backlog_order',
  'backlog_value_open',
]);

function hasStructuralAnomaly(input: SynthesisInput): boolean {
  if (!input.topAnomalyFeatures) return false;
  for (const f of input.topAnomalyFeatures) {
    if (STRUCTURAL_SIGNALS.has(f.feature) && f.z_score >= STRUCTURAL_SIGNAL_Z_THRESHOLD) {
      return true;
    }
  }
  // Mix narrowing check
  if (input.categoriesExited.length > 0) return true;
  if (input.concentrationTrend === 'increasing') return true;
  return false;
}

function getMedianGap(input: SynthesisInput): number {
  const cv = input.componentScores?.['cv_inter_order_days'] ?? 0;
  const daysSince = input.daysSinceLastOrder ?? 0;
  const orders12mo = input.orders12mo ?? 0;
  // Approximate median gap from available data
  if (orders12mo > 1) {
    return 365 / orders12mo;
  }
  return daysSince > 0 ? daysSince : 90;
}

function translateFeature(feature: string, zScore: number): string {
  const translations: Record<string, (z: number) => string> = {
    csr_churn_intensity: (z) => `Rep/CSR turnover is unusually high (${z.toFixed(1)}x normal)`,
    csr_churn_recent: (z) => `Recent rep/CSR changes are elevated (${z.toFixed(1)}x)`,
    sudden_silence: (z) => `Ordering stopped abruptly rather than trailing off (${z.toFixed(1)}x signal)`,
    dormancy_freq_interaction: (z) => `Both dormant and ordering less frequently than history (${z.toFixed(1)}x)`,
    days_since_last_backlog_order: (z) => `Backlog orders slowed before the gap (${z.toFixed(1)}x longer than usual)`,
    max_gap_ratio: (z) => `Most recent gap is ${z.toFixed(1)}x their typical pattern`,
    gap_deviation_ratio_median: (z) => `Current gap deviates ${z.toFixed(1)}x from their median interval`,
    slope_change: (z) => `Spending trend shifted direction (${z.toFixed(1)}x acceleration)`,
  };
  const fn = translations[feature];
  if (fn) return fn(zScore);
  return `${feature.replace(/_/g, ' ')} at ${zScore.toFixed(1)}x deviation`;
}

// Type classification: moment. A RECYCLER account's broken recovery cycle
// is a specific event in a specific window; the signal is the silence being
// structurally different from prior recoveries. Acting while the moment is
// open is the whole value of the pattern. Once the moment passes (either
// the account recovers or transitions to full dormancy), the opportunity
// to investigate the break is gone, regardless of whether the rep acted.
// Window: 14 days. Matches the "within 5 days" action timing plus buffer;
// re-fire on the same broken-cycle silence would produce duplicate alerts
// without new information.
const MOMENT_WINDOW_DAYS = 14;

export const recyclerBreakingPattern: Pattern = {
  name: 'recycler_breaking_pattern',
  type: 'moment',
  momentWindowDays: MOMENT_WINDOW_DAYS,

  matches(input: SynthesisInput, _ctx: MatcherContext): boolean {
    // Must be a RECYCLER (≥3 gap-recovery cycles)
    if (input.nGapRecoveryCycles < RECYCLER_MIN_CYCLES) return false;

    // Must be anomalous (GENUINE_CATCH)
    if (!input.isAnomalous || input.catchCategory !== 'GENUINE_CATCH') return false;

    // Current gap must exceed 1.5x median
    const medianGap = getMedianGap(input);
    const currentGap = input.daysSinceLastOrder ?? 0;
    if (medianGap > 0 && currentGap < medianGap * GAP_RATIO_THRESHOLD) return false;

    // At least one structural anomaly signal
    if (!hasStructuralAnomaly(input)) return false;

    return true;
  },

  synthesize(input: SynthesisInput, _ctx: MatcherContext): SynthesisOutput {
    const cycles = input.nGapRecoveryCycles;
    const daysSince = input.daysSinceLastOrder ?? 0;
    const medianGap = getMedianGap(input);
    const gapRatio = medianGap > 0 ? daysSince / medianGap : 0;
    const recoveryData = PATTERN_RECOVERY_RATES.recycler_breaking_pattern;
    const revenueAtStake = Math.max(
      input.revenue12moCurrent ?? input.revenue12mo,
      input.revenuePriorYear ?? 0,
    );
    const estimatedLoss = recoveryData.rate != null
      ? Math.round(revenueAtStake * (1 - recoveryData.rate))
      : null;

    // Build anomaly evidence
    const anomalyFeatures = (input.topAnomalyFeatures ?? []).slice(0, 3).map(f => ({
      feature: f.feature,
      narrative: translateFeature(f.feature, f.z_score),
      zScore: f.z_score,
    }));

    // Structural signals for the body text
    const structuralDetails: string[] = [];
    for (const f of input.topAnomalyFeatures ?? []) {
      if (STRUCTURAL_SIGNALS.has(f.feature) && f.z_score >= STRUCTURAL_SIGNAL_Z_THRESHOLD) {
        if (f.feature === 'csr_churn_intensity') structuralDetails.push('Rep/CSR turnover spiked');
        else if (f.feature === 'days_since_last_backlog_order') structuralDetails.push('backlog orders slowed before the gap');
        else if (f.feature === 'sudden_silence') structuralDetails.push('ordering stopped abruptly');
      }
    }
    if (input.categoriesExited.length > 0) {
      structuralDetails.push(`dropped ${input.categoriesExited.join(', ')}`);
    }

    const structuralPhrase = structuralDetails.length > 0
      ? structuralDetails.join(', ')
      : 'the pattern of silence is structurally different from past cycles';

    // Confidence
    let agreeing = 0;
    let total = 0;
    const layers: Array<SynthesisOutput['evidence']['layerAssessments'][number]> = [];

    // Anomaly detector
    total++;
    if (input.isAnomalous) {
      agreeing++;
      layers.push({ layer: 'Anomaly detector', agrees: true, summary: `GENUINE_CATCH (score ${input.componentScores?.['anomaly_score'] ?? 'N/A'})`, discountReason: null });
    }

    // Survival model
    if (input.survivalProb90d != null) {
      total++;
      if (input.survivalProb90d < 0.60) {
        agreeing++;
        layers.push({ layer: 'Survival model', agrees: true, summary: `${Math.round(input.survivalProb90d * 100)}% at 90 days`, discountReason: null });
      } else {
        layers.push({ layer: 'Survival model', agrees: false, summary: `${Math.round(input.survivalProb90d * 100)}% at 90 days`, discountReason: 'Pattern-matching against prior recoveries, which is what we think is breaking' });
      }
    }

    // Churn model
    total++;
    if (input.churnProb >= 0.15) {
      agreeing++;
      layers.push({ layer: 'Churn model', agrees: true, summary: `${Math.round(input.churnProb * 100)}% risk`, discountReason: null });
    } else {
      layers.push({ layer: 'Churn model', agrees: false, summary: `${Math.round(input.churnProb * 100)}% risk`, discountReason: 'Trained on recency signals, doesn\'t see structural changes in ordering pattern' });
    }

    // Forecast
    if (input.forecastChangePct != null) {
      total++;
      if (input.forecastChangePct < -10) {
        agreeing++;
        layers.push({ layer: 'Forecast model', agrees: true, summary: `${Math.round(input.forecastChangePct)}% projected`, discountReason: null });
      } else {
        layers.push({ layer: 'Forecast model', agrees: false, summary: `${Math.round(input.forecastChangePct)}% projected`, discountReason: null });
      }
    }

    // Mix model
    if (input.categoriesExited.length > 0) {
      total++;
      agreeing++;
      layers.push({ layer: 'Mix model', agrees: true, summary: `Dropped ${input.categoriesExited.join(', ')}`, discountReason: null });
    }

    // Ground truth
    let groundTruthNote: string | null = null;
    if (input.revenue2026Ytd != null && input.revenuePriorYear != null && input.revenuePriorYear > 0) {
      const ytdPace = input.revenue2026Ytd / (input.revenuePriorYear * (3.5 / 12));
      if (ytdPace > 0.7) {
        total++;
        groundTruthNote = `2026 YTD revenue suggests our model may be overcalling this one. Worth less concern than the model says.`;
      } else if (ytdPace < 0.3) {
        total++;
        agreeing++;
        groundTruthNote = `2026 YTD pace (${Math.round(ytdPace * 100)}% of prior year) supports the concern.`;
      }
    }

    const unknowns = total - agreeing - layers.filter(l => !l.agrees).length;
    const layerAgreement = total > 0 ? agreeing / total : 0;
    const confidenceLevel = layerAgreement >= 0.75 ? 'high' : layerAgreement >= 0.5 ? 'moderate' : 'low';

    // Save likelihood — honest framing (Principle 1): most accounts DO recover,
    // but the 41% that don't represent meaningful revenue at risk
    // NOTE: the recovery rate here is illustrative on synthetic data, not a real
    // historical measurement (acme_industrial is a synthetic pseudonym tenant).
    // In production this rate is computed per tenant from that tenant's own history.
    const saveLikelihood = recoveryData.rate != null
      ? `~${Math.round(recoveryData.rate * 100)}% illustrative recovery rate (synthetic-data baseline, N=${recoveryData.sampleSize}; per-tenant in production). Meaningful risk worth investigating; most accounts matching this pattern do come back.`
      : 'Insufficient historical data for this pattern';

    return {
      patternMatch: 'recycler_breaking_pattern',
      diagnosis: {
        label: "Quiet pattern doesn't match their normal recovery cycles.",
        body: `${input.accountName} has gone quiet ${cycles} times before — this silence is different. ${structuralPhrase.charAt(0).toUpperCase() + structuralPhrase.slice(1)}, and the most recent gap is ${gapRatio.toFixed(1)}x their typical pattern. Past recoveries followed predictable cadence; this one doesn't.`,
      },
      action: {
        imperative: `Engage with ${input.accountName} to investigate why their ordering pattern has broken from their normal recovery cycle. Pursue corrective action based on what you learn.`,
        investigationObjectives: [
          'Whether a specific competitor is being used instead',
          'Whether the buyer or procurement process has changed',
          'Whether fleet composition has shifted (less heavy-duty)',
          'Whether pricing is the issue (chrome or pipe)',
        ],
        signalsToTest: [
          { signal: 'Competitor named', indicates: 'competitive displacement — different play needed', nextStep: 'Log competitor name, model updates' },
          { signal: 'Procurement consolidation', indicates: 'structural shift — escalation may be needed', nextStep: 'Different engagement approach' },
          { signal: 'Nothing concerning', indicates: 'possible false positive', nextStep: 'Log and monitor' },
        ],
        engagementOptions: [
          { option: 'Phone call', context: 'Direct investigation, fastest signal', scope: 'individual', currentCapability: 'native' },
          { option: 'Email', context: 'Lower friction, slower feedback loop', scope: 'individual', currentCapability: 'native' },
          { option: 'In-person visit', context: 'Strongest signal, highest cost', scope: 'individual', currentCapability: 'external' },
          { option: 'CSR outreach', context: 'Relationship-level check, low pressure', scope: 'individual', currentCapability: 'external' },
        ],
        timing: 'within_5_days',
        urgency: 'high',
      },
      confidence: {
        level: confidenceLevel,
        layerAgreementSummary: `${agreeing} of ${total} signals agree`,
        unknownsSummary: unknowns > 0 ? `${unknowns} unknown${unknowns !== 1 ? 's' : ''}` : 'none',
        layerAgreement,
        dataCompleteness: 1 - (unknowns / Math.max(total, 1)),
        groundTruthAlignment: groundTruthNote && groundTruthNote.includes('overcalling') ? 0.3 : 1.0,
      },
      stakes: {
        revenueAtStake: Math.round(revenueAtStake),
        estimatedLoss,
        networkExposure: input.siblingRevenue != null ? Math.round(input.siblingRevenue + revenueAtStake) : null,
        lossRateSource: recoveryData.confidence,
      },
      blindSpots: [
        'Whether the current buyer is still the right contact',
        'Anything about the parent network (sibling location patterns)',
        'Recent Acme Industrial engagement attempts that weren\'t logged',
        'Competitor activity in this account\'s territory',
      ],
      feedbackHooks: {
        listenFors: [
          { label: 'Competitor named', inputType: 'text' },
          { label: 'Buyer changed', inputType: 'text' },
          { label: 'Procurement change', inputType: 'boolean' },
          { label: 'Pricing pressure on', inputType: 'text' },
          { label: 'Nothing concerning', inputType: 'boolean' },
        ],
      },
      comparative: {
        priorityRank: null, // Computed at batch level, not per-account
        totalFlagged: null,
        saveLikelihood,
      },
      groundTruthNote,
      evidence: {
        layerAssessments: layers,
        anomalyFeatures,
      },
      approximations: {
        medianGapIsApproximate: true, // Derived from 365/orders_12mo, not raw gap data
      },
    };
  },
};
