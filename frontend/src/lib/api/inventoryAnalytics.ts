import { BACKEND_BASE, getBackendAuthHeaders } from "../auth-context";

export interface InventoryProduct {
  product_id: string;
  product_name: string;
  category: string;
  size: string;
  cost_price: number;
  current_stock: number;
  reorder_level: number;
  units_sold_30d: number;
  total_sales_amount_30d: number;
  avg_daily_sales: number;
  turnover_ratio: number;
  days_of_stock: number;
  last_sale_date: string;
  velocity_class: "high_velocity" | "medium_velocity" | "slow_mover" | "dead_stock";
  velocity_label: string;
  velocity_tone: string;
  action: string | null;
  action_tone: string | null;
}

export interface CategoryMetrics {
  name: string;
  product_count: number;
  total_units: number;
  total_sales: number;
  avg_turnover: number;
}

export interface InventoryTurnoverContext {
  all_products: InventoryProduct[];
  high_velocity_products: InventoryProduct[];
  medium_velocity_products: InventoryProduct[];
  slow_moving_products: InventoryProduct[];
  dead_stock_products: InventoryProduct[];
  category_breakdown: CategoryMetrics[];
  total_products: number;
  total_dead_stock: number;
  total_slow_movers: number;
  products_needing_action: number;
  avg_turnover_ratio: number;
  best_turnover_product: InventoryProduct | null;
  report_date: string;
  analysis_period: string;
}

const FLASK_API_BASE = BACKEND_BASE;

export const inventoryAnalyticsApi = {
  /**
   * Fetch inventory turnover analytics from Flask backend
   */
  fetchTurnoverAnalytics: async (): Promise<InventoryTurnoverContext> => {
    try {
      const response = await fetch(`${FLASK_API_BASE}/api/analytics/inventory-turnover`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(await getBackendAuthHeaders()),
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch inventory turnover analytics: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error("Error fetching inventory turnover analytics:", error);
      throw error;
    }
  },
};
