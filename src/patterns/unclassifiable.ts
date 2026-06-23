/**
 * Pattern: unclassifiable (fallback)
 *
 * Matches any account that doesn't fit other patterns. Explicitly low
 * confidence — doesn't pretend to know what it doesn't (Principle 1).
 */

import type { Pattern, SynthesisInput, SynthesisOutput, MatcherContext } from '../types';

// Type classification: type. The fallback persists across snapshots for as
// long as no substantive pattern matches. It is a non-classification rather
// than an event, and the UI suppresses its rendering entirely (honest
// silence, per PR #79). Typed here for consistency so downstream re-fire
// discipline can treat every pattern uniformly; the classification has no
// visible rep-facing consequence for this pattern.
export const unclassifiable: Pattern = {
  name: 'unclassifiable',
  type: 'type',

  matches(_input: SynthesisInput, _ctx: MatcherContext): boolean {
    return true; // Always matches as fallback
  },

  synthesize(input: SynthesisInput, _ctx: MatcherContext): SynthesisOutput {
    const rev = input.revenue12moCurrent ?? input.revenue12mo;

    return {
      patternMatch: 'unclassifiable',
      diagnosis: {
        label: `Mixed signals on ${input.accountName}. Reter doesn't have a confident read.`,
        body: 'The available signals don\'t fit a clear pattern. This may be an account worth reviewing manually, or it may be noise. Reter will improve its read as more data comes in.',
      },
      action: {
        imperative: 'Review manually if this account is important to your portfolio. No automated recommendation.',
        investigationObjectives: [],
        signalsToTest: [],
        engagementOptions: [],
        timing: 'at_discretion',
        urgency: 'low',
      },
      confidence: {
        level: 'low',
        layerAgreementSummary: 'Signals don\'t form a clear pattern',
        unknownsSummary: 'Pattern not recognized',
        layerAgreement: 0,
        dataCompleteness: 0.5,
        groundTruthAlignment: 0.5,
      },
      stakes: {
        revenueAtStake: Math.round(rev),
        estimatedLoss: null,
        networkExposure: null,
        lossRateSource: 'qualitative',
      },
      blindSpots: [
        'Why the signals don\'t match a known pattern — may require human context',
      ],
      feedbackHooks: {
        listenFors: [
          { label: 'What\'s actually happening with this account', inputType: 'text' },
        ],
      },
      comparative: {
        priorityRank: null,
        totalFlagged: null,
        saveLikelihood: 'Unknown — insufficient pattern match',
      },
      groundTruthNote: null,
      evidence: {
        layerAssessments: [],
        anomalyFeatures: (input.topAnomalyFeatures ?? []).slice(0, 3).map(f => ({
          feature: f.feature,
          narrative: `${f.feature.replace(/_/g, ' ')} at ${f.z_score.toFixed(1)}x deviation`,
          zScore: f.z_score,
        })),
      },
      approximations: {
        medianGapIsApproximate: false,
      },
    };
  },
};
