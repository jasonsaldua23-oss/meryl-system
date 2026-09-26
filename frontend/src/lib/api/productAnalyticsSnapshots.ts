import { supabase } from "../supabase";
import { BACKEND_BASE, getBackendAuthHeaders } from "../auth-context";

const FLASK_API_BASE = BACKEND_BASE;

export type ProductAnalyticsSnapshot = {
  snapshot_id: string;
  product_id: string;
  period_key: "daily" | "weekly" | "monthly" | "quarterly" | "annually" | "custom";
  period_start?: string;
  period_end?: string;
  window_scope?: string | null;
  units_sold: number;
  revenue: number;
  average_unit_price: number;
  stock_quantity: number;
  turnover_ratio: number;
  movement_label: "fast" | "steady" | "slow" | "dead_stock";
  brand?: string | null;
  size_label?: string | null;
  category_name?: string | null;
  rank_position?: number | null;
  computed_at: string;
};

export type ProductAnalyticsDimension = {
  dimension_snapshot_id: string;
  period_key: string;
  period_start?: string;
  period_end?: string;
  window_scope?: string | null;
  dimension_type: "brand" | "size" | "category";
  dimension_value: string;
  units: number;
  revenue: number;
  share_percent: number;
  rank_position: number;
  computed_at: string;
};

export type ProductAnalyticsRecommendation = {
  recommendation_id: string;
  product_id: string;
  period_key: string;
  period_start?: string;
  period_end?: string;
  window_scope?: string | null;
  recommendation_type: "markdown" | "bundle_or_bogo" | "restock_before_promoting";
  title: string;
  message: string;
  severity: "low" | "medium" | "high";
  suggested_discount_min?: number | null;
  suggested_discount_max?: number | null;
  status: "open" | "applied" | "dismissed";
  computed_at: string;
};

export const productAnalyticsSnapshotsApi = {
  fetch: async (
    period: "daily" | "weekly" | "monthly" | "quarterly" | "annually" | "custom" = "monthly",
    options?: { start_date?: string; end_date?: string },
  ) => {
    const params = new URLSearchParams({ period });
    if (options?.start_date) params.set("start_date", options.start_date);
    if (options?.end_date) params.set("end_date", options.end_date);

    // 1. Attempt to fetch from Flask analytics microservice if available
    try {
      const response = await fetch(`${FLASK_API_BASE}/api/analytics/product/snapshots?${params.toString()}`, {
        method: "GET",
        credentials: "include",
        headers: await getBackendAuthHeaders(),
      });
      if (response.ok) {
        const result = await response.json().catch(() => ({}));
        if (result?.ok) {
          return result as {
            ok: true;
            period: string;
            snapshots: ProductAnalyticsSnapshot[];
            dimensions: ProductAnalyticsDimension[];
            recommendations: ProductAnalyticsRecommendation[];
          };
        }
      }
    } catch {
      // Backend unavailable; seamlessly query Supabase directly
    }

    // 2. Direct Supabase fallback
    try {
      let snapQuery = supabase.from("analytics_product_snapshot").select("*").eq("period_key", period);
      let dimQuery = supabase.from("analytics_dimension_snapshot").select("*").eq("period_key", period);
      let recQuery = supabase.from("analytics_recommendation").select("*, product:product(product_id, product_name, brand, size, color, category_id)").eq("period_key", period);

      if (options?.start_date && options?.end_date) {
        snapQuery = snapQuery.eq("period_start", options.start_date).eq("period_end", options.end_date);
        dimQuery = dimQuery.eq("period_start", options.start_date).eq("period_end", options.end_date);
        recQuery = recQuery.eq("period_start", options.start_date).eq("period_end", options.end_date);
      }

      const [snapRes, dimRes, recRes] = await Promise.all([
        snapQuery.order("rank_position", { ascending: true }).order("units_sold", { ascending: false }),
        dimQuery.order("rank_position", { ascending: true }),
        recQuery,
      ]);

      return {
        ok: true as const,
        period,
        snapshots: ((snapRes.data as any[]) || []) as ProductAnalyticsSnapshot[],
        dimensions: ((dimRes.data as any[]) || []) as ProductAnalyticsDimension[],
        recommendations: ((recRes.data as any[]) || []) as ProductAnalyticsRecommendation[],
      };
    } catch {
      return {
        ok: true as const,
        period,
        snapshots: [],
        dimensions: [],
        recommendations: [],
      };
    }
  },

  rebuild: async (periods?: string[], options?: { start_date?: string; end_date?: string }) => {
    try {
      const response = await fetch(`${FLASK_API_BASE}/api/analytics/product/rebuild`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getBackendAuthHeaders()) },
        credentials: "include",
        body: JSON.stringify({
          periods,
          start_date: options?.start_date || undefined,
          end_date: options?.end_date || undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result?.ok !== false) {
        return result as {
          ok: true;
          snapshots_written: number;
          dimension_rows_written: number;
          recommendations_written: number;
          periods: string[];
          computed_at: string;
        };
      }
    } catch {
      // Backend offline or unreachable
    }

    return {
      ok: true as const,
      snapshots_written: 0,
      dimension_rows_written: 0,
      recommendations_written: 0,
      periods: periods || [],
      computed_at: new Date().toISOString(),
    };
  },
};
