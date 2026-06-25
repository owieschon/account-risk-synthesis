/**
 * Synthesis function — integrates model outputs into a single briefing per account.
 *
 * Runs the pattern library against the account, selects the best-matching pattern,
 * and produces a SynthesisOutput. The output is stored in account_synthesis and
 * rendered by the UI.
 */

import type { SynthesisInput, SynthesisOutput, Pattern, MatcherContext, PatternType } from './types';
import { recyclerBreakingPattern } from './patterns/recycler-breaking-pattern';
import { topTierEarlyWarning } from './patterns/top-tier-early-warning';
import { growthLockIn } from './patterns/growth-lock-in';
import { silentWinback } from './patterns/silent-winback';
import { modelOvercall } from './patterns/model-overcall';
import { unflaggedStable } from './patterns/unflagged-stable';
import { unclassifiable } from './patterns/unclassifiable';

// ---------------------------------------------------------------------------
// Pattern library — ordered by specificity (most specific first)
// ---------------------------------------------------------------------------

const PATTERN_LIBRARY: readonly Pattern[] = [
  // Most specific patterns first
  recyclerBreakingPattern,
  // top_tier_early_warning: top-tier account (by revenue p85) showing
  // structural anomalies before trailing invoiced revenue moves. Placed
  // after recycler_breaking_pattern because recycler is more specific
  // (requires cycle history + current gap > 1.5x median); an account
  // that matches both should be handled as a recycler. Placed before
  // growth_lock_in because top_tier_early_warning requires isAnomalous
  // while growth_lock_in matches only clean (non-anomalous) stable
  // accounts, so they are mutually exclusive on isAnomalous anyway.
  topTierEarlyWarning,
  // growth_lock_in: more specific than unflagged_stable (requires growth
  // trajectory, peak proximity, and weathered-cycle history) but less
  // specific than recycler_breaking_pattern (which requires an active
  // anomaly). An account cannot match both: growth_lock_in requires
  // !isAnomalous implicitly via riskTier='low' + no structural anomaly
  // expectation; recycler_breaking_pattern requires isAnomalous.
  growthLockIn,
  // silent_winback: quietly fading accounts that every risk layer missed.
  // Sits in the blind spot between churn_model, survival, and anomaly.
  // Placed after growth_lock_in (mutually exclusive on trajectory: growth
  // requires +trend near peak, silent_winback requires declining trend and
  // drop from peak) and before unflagged_stable. Ordering ahead of
  // unflagged_stable is defensive: the two are already mutually exclusive
  // on status (unflagged_stable requires status='stable' while
  // silent_winback rejects only 'churned'/'dormant' and is specifically
  // designed for 'declining'), but the specificity-first convention keeps
  // the library readable: "something is wrong, quietly" is a more specific
  // read than "nothing is wrong" and so is placed first.
  silentWinback,
  // model_overcall is a meta-check — runs after the primary pattern matches
  // (handled separately in synthesize())
  // Baseline
  unflaggedStable,
  // Fallback (always matches)
  unclassifiable,
];

// ---------------------------------------------------------------------------
// Main synthesis function
// ---------------------------------------------------------------------------

export function synthesize(input: SynthesisInput, ctx: MatcherContext): SynthesisOutput {
  // Stage 1: Pattern matching — find the first matching pattern
  let matchedPattern: Pattern | null = null;
  for (const pattern of PATTERN_LIBRARY) {
    if (pattern.name === 'model_overcall') continue; // Meta-check, handled below
    if (pattern.matches(input, ctx)) {
      matchedPattern = pattern;
      break;
    }
  }

  if (!matchedPattern) {
    matchedPattern = unclassifiable;
  }

  // Stage 2: Generate synthesis from the matched pattern
  let output = matchedPattern.synthesize(input, ctx);

  // Stage 3: Meta-check — does model_overcall override the primary pattern?
  // model_overcall checks if ground truth contradicts the prediction.
  // Only applies to non-stable patterns (stable accounts can't be "overcalled").
  if (
    matchedPattern.name !== 'unflagged_stable' &&
    matchedPattern.name !== 'unclassifiable' &&
    modelOvercall.matches(input, ctx)
  ) {
    output = modelOvercall.synthesize(input, ctx);
  }

  return output;
}

// ---------------------------------------------------------------------------
// Pattern metadata lookup
// ---------------------------------------------------------------------------

/**
 * Look up the type/moment classification and moment-window for a pattern by
 * its name. Used by the db/API layer to surface pattern metadata to the
 * Cue UI without making the db package depend on the full synthesis runtime.
 * Returns null for unknown pattern names.
 */
export function getPatternMetadata(
  patternName: string,
): { type: PatternType; momentWindowDays: number | null } | null {
  const pattern = PATTERN_LIBRARY.find((p) => p.name === patternName) ?? (
    patternName === 'model_overcall' ? modelOvercall : null
  );
  if (!pattern) return null;
  return {
    type: pattern.type,
    momentWindowDays: pattern.momentWindowDays ?? null,
  };
}
