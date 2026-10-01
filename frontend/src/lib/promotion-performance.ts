import { attributeSaleLine, promotionBoundaryMs, promotionDisplayName, promotionKind } from "./promotion-rules";

export type PromotionPerformanceStatus = "Active" | "Upcoming" | "Ended" | "Inactive";

export type PromotionPerformanceRow = {
  id: string;
  name: string;
  type: "percentage" | "fixed" | "bogo" | "bundle";
  status: PromotionPerformanceStatus;
  startMs: number;
  endMs: number;
  revenue: number;
  units: number;
  contribution: number;
};

function saleTimestampMs(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return Number.NaN;
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  return new Date(hasTimezone ? raw : `${raw}Z`).getTime();
}

function isCompletedSale(sale: any) {
  const payment = Array.isArray(sale?.payment) ? sale.payment[0] : sale?.payment;
  const paymentStatus = String(payment?.payment_status ?? sale?.payment_status ?? "completed").toLowerCase();
  const saleStatus = String(sale?.sales_status ?? sale?.status ?? "completed").toLowerCase();
  return !["cancelled", "canceled", "fully returned"].includes(saleStatus) &&
    ["completed", "paid", "success", "successful"].includes(paymentStatus);
}

export function promotionPerformanceStatus(promotion: any, nowMs = Date.now()): PromotionPerformanceStatus {
  const rawStatus = String(promotion?.status ?? promotion?.promo_status ?? "").trim().toLowerCase();
  const startMs = promotionBoundaryMs(promotion?.start_date, "start");
  const endMs = promotionBoundaryMs(promotion?.end_date, "end");
  if (rawStatus === "inactive" || rawStatus === "deactivated") return "Inactive";
  if (rawStatus === "expired" || endMs < nowMs) return "Ended";
  if (startMs > nowMs) return "Upcoming";
  return "Active";
}

/** Revenue and units from sale lines that actually recorded a promotion.
 * Older rows without promo_id are attributed only when they have a discount.
 */
export function calculatePromotionPerformance(
  promotions: any[],
  sales: any[],
  productsById: Map<string, any> = new Map(),
  nowMs = Date.now(),
): PromotionPerformanceRow[] {
  const rows = promotions.map((promotion) => ({
    id: String(promotion?.promo_id ?? "").trim(),
    name: promotionDisplayName(promotion),
    type: promotionKind(promotion),
    status: promotionPerformanceStatus(promotion, nowMs),
    startMs: promotionBoundaryMs(promotion?.start_date, "start"),
    endMs: promotionBoundaryMs(promotion?.end_date, "end"),
    revenue: 0,
    units: 0,
    contribution: 0,
  })).filter((row) => row.id);
  const rowById = new Map(rows.map((row) => [row.id, row]));

  sales.forEach((sale) => {
    if (!isCompletedSale(sale)) return;
    const saleMs = saleTimestampMs(sale?.transaction_date ?? sale?.created_at);
    if (!Number.isFinite(saleMs)) return;
    const details = Array.isArray(sale?.sales_details) ? sale.sales_details : [];
    details.forEach((detail: any) => {
      const productId = String(detail?.product_id ?? "").trim();
      const joinedProduct = Array.isArray(detail?.product) ? detail.product[0] : detail?.product;
      const product = joinedProduct ?? productsById.get(productId);
      const category = Array.isArray(product?.category) ? product.category[0] : product?.category;
      const attributedId = attributeSaleLine({
        promoId: String(detail?.promo_id ?? detail?.promotion_id ?? "").trim() || null,
        discountPercent: Number(detail?.discount_applied ?? detail?.discount ?? 0),
        productNameLower: String(product?.product_name ?? detail?.product_name ?? "").trim().toLowerCase(),
        categoryLower: String(category?.category_name ?? product?.category_name ?? "").trim().toLowerCase(),
        saleMs,
      }, promotions);
      if (!attributedId) return;
      const row = rowById.get(attributedId);
      if (!row) return;
      const quantity = Number(detail?.quantity ?? 0);
      const subtotal = Number(detail?.subtotal ?? 0);
      row.units += quantity;
      row.revenue += subtotal > 0 ? subtotal : Number(detail?.price ?? 0) * quantity;
    });
  });

  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  rows.forEach((row) => {
    row.contribution = totalRevenue > 0 ? Number(((row.revenue / totalRevenue) * 100).toFixed(1)) : 0;
  });
  return rows.sort((a, b) => b.revenue - a.revenue || b.units - a.units || a.name.localeCompare(b.name));
}
