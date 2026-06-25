/**
 * Synthesis layer type definitions.
 */

// ---------------------------------------------------------------------------
// Tenant context: scope-level thresholds and derived context
// ---------------------------------------------------------------------------

/**
 * Tenant-scoped thresholds and derived context, computed once per
 * synthesis batch. Patterns use this instead of hardcoding absolute
 * numeric thresholds.
 */
export interface MatcherContext {
  readonly tenantId: string;
  readonly revenueTopTier: number;        // p85 of revenue_12mo across active accounts
  readonly gapCycleTopBand: number;       // p80 of n_gap_recovery_cycles across active accounts
  readonly activeAccountCount: number;    // for scale-aware decisions in future patterns
}

// ---------------------------------------------------------------------------
// Input: what the synthesis function receives
// ---------------------------------------------------------------------------

export interface SynthesisInput {
  readonly accountId: string;
  readonly accountName: string;
  readonly externalId: string;

  // Classification
  readonly status: string;
  readonly churnProb: number;
  readonly survivalProb90d: number | null;
  readonly medianSurvivalDays: number | null;

  // Anomaly detection
  readonly isAnomalous: boolean;
  readonly catchCategory: string | null;
  readonly topAnomalyFeatures: ReadonlyArray<{
    feature: string;
    z_score: number;
    direction: string;
  }> | null;

  // RECYCLER
  readonly nGapRecoveryCycles: number;

  // Revenue
  readonly revenue12mo: number;
  readonly revenue12moCurrent: number | null;
  readonly revenue2026Ytd: number | null;
  readonly revenuePriorYear: number | null;
  readonly peakRevenue12mo: number | null;

  // Activity
  readonly daysSinceLastOrder: number | null;
  readonly orders12mo: number | null;

  // Context
  readonly categoriesExited: string[];
  readonly concentrationTrend: string | null;

  // Risk
  readonly riskScore: number | null;
  readonly riskTier: string | null;
  readonly trendPct: number | null;

  // Network
  readonly parentCompanyId: string | null;
  readonly childCount: number;
  readonly siblingRevenue: number | null;

  // Forecast
  readonly predictedRevenue12mo: number | null;
  readonly forecastChangePct: number | null;

  // Component scores (raw features for evidence)
  readonly componentScores: Record<string, number> | null;
}

// ---------------------------------------------------------------------------
// Output: what the synthesis function produces
// ---------------------------------------------------------------------------

export interface SynthesisOutput {
  readonly patternMatch: string;
  readonly diagnosis: SynthesisDiagnosis;
  readonly action: SynthesisAction;
  readonly confidence: SynthesisConfidence;
  readonly stakes: SynthesisStakes;
  readonly blindSpots: string[];
  readonly feedbackHooks: SynthesisFeedbackHooks;
  readonly comparative: SynthesisComparative;
  readonly groundTruthNote: string | null;
  readonly evidence: SynthesisEvidence;
  readonly approximations: SynthesisApproximations;
}

/** Flags for approximate computations so UI can render appropriately */
export interface SynthesisApproximations {
  /** True when median gap was approximated from 365/orders_12mo rather than raw gap data */
  readonly medianGapIsApproximate: boolean;
}

export interface SynthesisDiagnosis {
  /** One-line label (observation, not hypothesis — Principle 2) */
  readonly label: string;
  /** 2-3 sentence explanation with account-specific detail */
  readonly body: string;
}

export interface SynthesisAction {
  /** Plain language: what needs to happen */
  readonly imperative: string;
  /** What to learn from engagement */
  readonly investigationObjectives: string[];
  /** What each finding would indicate, with branching */
  readonly signalsToTest: ReadonlyArray<{
    signal: string;
    indicates: string;
    nextStep: string;
  }>;
  /** Thinking aids, NOT prescriptions (Principle 5) */
  readonly engagementOptions: ReadonlyArray<{
    option: string;
    context: string;
    scope: 'individual' | 'batch_eligible';
    currentCapability: 'native' | 'external' | 'planned';
  }>;
  readonly timing: string;
  readonly urgency: 'high' | 'medium' | 'low' | 'monitor';
}

export interface SynthesisConfidence {
  readonly level: 'high' | 'moderate' | 'low';
  /** e.g., "4 of 6 signals agree" */
  readonly layerAgreementSummary: string;
  /** e.g., "2 unknowns" */
  readonly unknownsSummary: string;
  readonly layerAgreement: number;
  readonly dataCompleteness: number;
  readonly groundTruthAlignment: number;
}

export interface SynthesisStakes {
  readonly revenueAtStake: number;
  readonly estimatedLoss: number | null;
  readonly networkExposure: number | null;
  /** 'data_derived' or 'qualitative' */
  readonly lossRateSource: string;
}

export interface SynthesisFeedbackHooks {
  /** Structured options matching investigation objectives */
  readonly listenFors: ReadonlyArray<{
    label: string;
    inputType: 'text' | 'boolean';
  }>;
}

export interface SynthesisComparative {
  /** e.g., "Priority 8 of 47 flagged" */
  readonly priorityRank: number | null;
  readonly totalFlagged: number | null;
  readonly saveLikelihood: string;
}

export interface SynthesisEvidence {
  /** Which model layers agree/disagree with the pattern diagnosis */
  readonly layerAssessments: ReadonlyArray<{
    layer: string;
    agrees: boolean;
    summary: string;
    discountReason: string | null;
  }>;
  /** Top anomaly features with rep-facing translations */
  readonly anomalyFeatures: ReadonlyArray<{
    feature: string;
    narrative: string;
    zScore: number;
  }>;
}

// ---------------------------------------------------------------------------
// Pattern interface
// ---------------------------------------------------------------------------

/**
 * Type classification of a pattern.
 *
 * `type`: a persistent classification. Account enters the pattern's feature-
 *   space region and stays for multiple consecutive snapshots. Matcher fires
 *   once per account; synthesis layer suppresses re-alerts while the account
 *   remains in the pattern. Re-fires only if the account exits and re-enters.
 *   Cue displays as a standing classification ("this account is X").
 *
 * `moment`: a transient window. Account passes through the pattern's feature-
 *   space region for one or a few snapshots then moves elsewhere. Matcher
 *   fires on the triggering snapshot; synthesis layer suppresses re-fire on
 *   the same account while the prior firing is within its momentWindowDays.
 *   After the window passes, the matcher stops firing on that moment
 *   regardless of whether the rep acted (a subsequent re-entry after full
 *   exit is a new moment). Cue displays as a time-bound event ("window open").
 */
export type PatternType = 'type' | 'moment';

export interface Pattern {
  readonly name: string;
  /**
   * Classification as `type` or `moment`. Required. Affects Cue display
   * mode and re-firing behavior in the synthesis layer; see the
   * `PatternType` docstring for semantics.
   */
  readonly type: PatternType;
  /**
   * For moment patterns: days during which a prior firing suppresses re-fire,
   * and after which the moment is considered passed. Only read when
   * `type === 'moment'`. Typical values: 7-30 days; match to action timing.
   * Ignored for `type === 'type'` patterns.
   */
  readonly momentWindowDays?: number;
  matches(input: SynthesisInput, ctx: MatcherContext): boolean;
  synthesize(input: SynthesisInput, ctx: MatcherContext): SynthesisOutput;
}
