/**
 * Pattern: unflagged_stable
 *
 * Baseline for accounts performing normally. Most accounts match this.
 * For top-50 by revenue: relationship maintenance cadence reminder.
 * For others: no action.
 */

import type { Pattern, SynthesisInput, SynthesisOutput, MatcherContext } from '../types';

const SURVIVAL_THRESHOLD = 0.75;
const CHURN_THRESHOLD = 0.10;
const TOP_N_MAINTENANCE = 50;

// Type classification: type. "Performing normally" is the canonical
// persistent classification: most accounts live in this pattern most of
// the time and will stay there for many consecutive snapshots.
export const unflaggedStable: Pattern = {
  name: 'unflagged_stable',
  type: 'type',

  matches(input: SynthesisInput, _ctx: MatcherContext): boolean {
    if (input.status !== 'stable') return false;
    if (input.isAnomalous) return false;
    if (input.survivalProb90d != null && input.survivalProb90d <= SURVIVAL_THRESHOLD) return false;
    if (input.churnProb >= CHURN_THRESHOLD) return false;
    if (input.categoriesExited.length > 0) return false;
    if (input.concentrationTrend === 'increasing') return false;
    return true;
  },

  synthesize(input: SynthesisInput, _ctx: MatcherContext): SynthesisOutput {
    const rev = input.revenue12moCurrent ?? input.revenue12mo;

    return {
      patternMatch: 'unflagged_stable',
      diagnosis: {
        label: `${input.accountName} is performing normally. No concerns.`,
        body: 'All signals are within expected ranges. No action needed.',
      },
      action: {
        imperative: 'No action needed. Standard relationship maintenance.',
        investigationObjectives: [],
        signalsToTest: [],
        engagementOptions: [],
        timing: 'scheduled_cadence',
        urgency: 'low',
      },
      confidence: {
        level: 'high',
        layerAgreementSummary: 'All signals normal',
        unknownsSummary: 'none',
        layerAgreement: 1.0,
        dataCompleteness: 1.0,
        groundTruthAlignment: 1.0,
      },
      stakes: {
        revenueAtStake: Math.round(rev),
        estimatedLoss: null,
        networkExposure: null,
        lossRateSource: 'qualitative',
      },
      blindSpots: [],
      feedbackHooks: {
        listenFors: [],
      },
      comparative: {
        priorityRank: null,
        totalFlagged: null,
        saveLikelihood: 'N/A — not flagged',
      },
      groundTruthNote: null,
      evidence: {
        layerAssessments: [],
        anomalyFeatures: [],
      },
      approximations: {
        medianGapIsApproximate: false,
      },
    };
  },
};
