/**
 * Tenant context computation.
 *
 * Computes per-tenant thresholds (revenue top tier, gap-cycle top band) once
 * per synthesis batch. Patterns reference these derived values instead of
 * hardcoding absolute numeric thresholds, so a tenant whose "top tier" is
 * $500K and another whose "top tier" is $5M both get pattern matches grounded
 * in their own distribution rather than a single Acme-Industrial-derived constant.
 *
 * See .claude/rules/pattern-thresholds.md for the broader policy.
 *
 * The caller provides the pg client; no DB credentials are imported here.
 */

import type { MatcherContext } from './types';

/**
 * Minimal pg client shape we need. Accepting a duck-typed interface lets
 * callers pass either a pg.Pool, pg.Client, or pg.PoolClient without the
 * synthesis package taking a hard dependency on pg.
 */
export interface PgQueryClient {
  query: <T = unknown>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
}

interface MatcherContextRow {
  revenue_top_tier: string | number | null;
  gap_cycle_top_band: string | number | null;
  active_account_count: string | number | null;
}

/**
 * Compute the tenant context for a given tenant.
 *
 * Single SQL query that aggregates over active accounts (status != 'churned')
 * joined to each account's latest churn prediction. Percentiles are computed
 * at the DB level via percentile_cont so we avoid pulling the full
 * distribution into application memory.
 *
 * Returns zeroed defaults when no rows match (brand-new tenant, empty import).
 * This keeps the type contract simple; patterns that care about "enough data
 * to trust the threshold" can branch on activeAccountCount.
 */
export async function computeMatcherContext(
  client: PgQueryClient,
  tenantId: string,
): Promise<MatcherContext> {
  const result = await client.query<MatcherContextRow>(
    `SELECT
       percentile_cont(0.85) WITHIN GROUP (ORDER BY revenue_12mo) AS revenue_top_tier,
       -- Do NOT coalesce a missing prediction to 0: that would seed the
       -- percentile population with zeros for every account lacking a churn
       -- prediction (LEFT JOIN miss) and drag the band down. Leaving the value
       -- NULL drops those accounts from the population -- percentile_cont
       -- ignores NULLs -- so the band reflects only accounts that actually
       -- have a gap-recovery-cycle score.
       percentile_cont(0.80) WITHIN GROUP (ORDER BY (p.component_scores->>'n_gap_recovery_cycles')::int) AS gap_cycle_top_band,
       COUNT(*) AS active_account_count
     FROM accounts a
     LEFT JOIN LATERAL (
       SELECT component_scores FROM predictions
       WHERE account_id = a.id AND prediction_type = 'churn'
       ORDER BY predicted_at DESC LIMIT 1
     ) p ON true
     WHERE a.tenant_id = $1 AND a.status != 'churned' AND a.revenue_12mo IS NOT NULL`,
    [tenantId],
  );

  const row = result.rows[0];

  return {
    tenantId,
    revenueTopTier: toFiniteNumber(row?.revenue_top_tier, 0),
    gapCycleTopBand: toFiniteNumber(row?.gap_cycle_top_band, 0),
    activeAccountCount: toFiniteNumber(row?.active_account_count, 0),
  };
}

function toFiniteNumber(value: string | number | null | undefined, fallback: number): number {
  if (value == null) return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
