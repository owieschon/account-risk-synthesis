/**
 * Pattern: model_overcall
 *
 * Meta-pattern: matches when ground truth contradicts the model's prediction.
 * Demonstrates the system knows its limitations (Principle 1).
 *
 * Computed AFTER other patterns — overrides the primary pattern when ground
 * truth shows the account is actually on pace despite being flagged.
 */

import type { Pattern, SynthesisInput, SynthesisOutput, MatcherContext } from '../types';

const YTD_PACE_THRESHOLD = 0.7; // Account on ≥70% pace = model overcalling
const AVG_DAYS_PER_MONTH = 30.44;

/** Compute months elapsed in 2026 from actual date arithmetic. */
function monthsElapsedInYear(): number {
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const daysSinceYearStart = (now.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24);
  return daysSinceYearStart / AVG_DAYS_PER_MONTH;
}

// Type classification: type. model_overcall is a standing meta-dissonance:
// the ground truth continues to contradict the model's primary pattern call
// for as long as the YTD pace stays above threshold. Membership persists
// snapshot-over-snapshot while the disagreement holds. The rep action
// ("monitor, do not engage") is also an ongoing posture rather than a
// time-bound window. Re-firing across consecutive snapshots would produce
// redundant "we were wrong" alerts without new information.
export const modelOvercall: Pattern = {
  name: 'model_overcall',
  type: 'type',

  matches(input: SynthesisInput, _ctx: MatcherContext): boolean {
    // Need ground truth data to detect overcall
    if (input.revenue2026Ytd == null || input.revenuePriorYear == null) return false;
    if (input.revenuePriorYear <= 0) return false;

    // Account is on pace despite being flagged
    const monthsElapsed = monthsElapsedInYear();
    const expectedYtd = input.revenuePriorYear * (monthsElapsed / 12);
    const ytdPace = input.revenue2026Ytd / expectedYtd;

    return ytdPace > YTD_PACE_THRESHOLD;
  },

  synthesize(input: SynthesisInput, _ctx: MatcherContext): SynthesisOutput {
    const monthsElapsed = monthsElapsedInYear();
    const expectedYtd = (input.revenuePriorYear ?? 0) * (monthsElapsed / 12);
    const ytdPace = expectedYtd > 0 ? (input.revenue2026Ytd ?? 0) / expectedYtd : 0;
    const paceStr = `${Math.round(ytdPace * 100)}%`;

    return {
      patternMatch: 'model_overcall',
      diagnosis: {
        label: `Our model flagged ${input.accountName}, but current data suggests the call may be wrong.`,
        body: `2026 YTD revenue is at ${paceStr} of prior-year pace — on track despite the model's concern. The model was trained on data that may not reflect recent activity. Monitor rather than engage.`,
      },
      action: {
        imperative: `Monitor ${input.accountName}. Current data does not support the model's concern.`,
        investigationObjectives: [],
        signalsToTest: [],
        engagementOptions: [],
        timing: 'no_action',
        urgency: 'monitor',
      },
      confidence: {
        level: 'low',
        layerAgreementSummary: 'Ground truth contradicts model',
        unknownsSummary: 'Model may be stale',
        layerAgreement: 0,
        dataCompleteness: 0.5,
        groundTruthAlignment: 0,
      },
      stakes: {
        revenueAtStake: Math.round(input.revenue12moCurrent ?? input.revenue12mo),
        estimatedLoss: null,
        networkExposure: null,
        lossRateSource: 'qualitative',
      },
      blindSpots: [
        'Whether the model\'s original concern has resolved or is still developing',
        'Whether the 2026 YTD pace is masking a recent slowdown within the year',
      ],
      feedbackHooks: {
        listenFors: [
          { label: 'Still concerned about this account', inputType: 'boolean' },
          { label: 'Additional context', inputType: 'text' },
        ],
      },
      comparative: {
        priorityRank: null,
        totalFlagged: null,
        saveLikelihood: 'N/A — model overcall, not a loss scenario',
      },
      groundTruthNote: `2026 YTD revenue is at ${paceStr} of prior-year pace. The model's concern appears to be wrong or outdated.`,
      evidence: {
        layerAssessments: [
          { layer: 'Ground truth (2026 YTD)', agrees: false, summary: `${paceStr} pace — account is on track`, discountReason: null },
        ],
        anomalyFeatures: [],
      },
      approximations: {
        medianGapIsApproximate: false,
      },
    };
  },
};
