/**
 * Synthesis layer version constants.
 *
 * Three version stamps are written to every synthesis row for traceability.
 * Bumped manually when the corresponding component changes.
 */

/** Pattern library version — bump when patterns are added, removed, or match criteria change. */
export const PATTERN_LIBRARY_VERSION = '1.0.0';

/** Synthesis function version — bump when the synthesis pipeline logic changes. */
export const SYNTHESIS_FUNCTION_VERSION = '1.0.0';

/**
 * Model version — read from the existing model metadata.
 * Not a constant here; populated at synthesis time from the model export manifest.
 * Placeholder for the type system.
 */
export const DEFAULT_MODEL_VERSION = 'v2.0-phase4';
