/**
 * Shared promotion rules for the Promotions page and the POS.
 *
 * Time convention: promotion start/end are entered as store wall-clock times
 * ("2026-09-26T17:00") and stored as-is in the timestamptz columns, so the
 * database returns them as "2026-09-26T17:00:00+00:00". The wall-clock part
 * (first 16 characters) is the intended local time; the "+00:00" is not a real
 * offset. Every consumer must read them the same way, which these helpers do.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Milliseconds for a promotion boundary, read as local wall-clock time. */
export function promotionBoundaryMs(value: unknown, boundary: "start" | "end"): number {
  const raw = String(value ?? "").trim();
  if (!raw) return boundary === "start" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  let local: Date;
  if (DATE_ONLY.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    local = boundary === "start" ? new Date(y, m - 1, d) : new Date(y, m - 1, d, 23, 59, 59, 999);
  } else {
    const match = raw.replace(" ", "T").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
    if (!match) return boundary === "start" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    const [, y, m, d, hh, mm] = match.map(Number);
    local = new Date(y, m - 1, d, hh, mm, boundary === "end" ? 59 : 0, boundary === "end" ? 999 : 0);
  }
  return local.getTime();
}

/**
 * Whether a promotion should apply right now. "inactive"/"deactivated" means it
 * was switched off by staff; otherwise the start/end window decides, so a
 * scheduled promotion starts and ends on time without anyone touching it.
 */
export function isPromotionLive(row: { status?: unknown; start_date?: unknown; end_date?: unknown }, nowMs = Date.now()) {
  const status = String(row.status ?? "").trim().toLowerCase();
  if (status === "inactive" || status === "deactivated") return false;
  return promotionBoundaryMs(row.start_date, "start") <= nowMs && nowMs <= promotionBoundaryMs(row.end_date, "end");
}

/**
 * Whether a product falls under a promotion's target. Listed products are the
 * target (a listed category only narrows them); with categories alone, the
 * whole category is the target; with neither, everything is.
 */
export function promotionTargetMatches(
  target: { appliesToAll: boolean; categories: string[]; products: string[] },
  productNameLower: string,
  categoryLower: string,
) {
  if (target.products.length > 0) {
    if (!target.products.includes(productNameLower)) return false;
    return target.categories.length === 0 || target.categories.includes(categoryLower);
  }
  if (target.categories.length > 0) return target.categories.includes(categoryLower);
  return target.appliesToAll;
}

export type PromotionTarget = { appliesToAll: boolean; categories: string[]; products: string[] };

/** Parses "Categories: A, B | Products: X, Y" / "All Products" (lower-cased). */
export function parsePromotionTarget(rawValue: unknown): PromotionTarget {
  const raw = String(rawValue ?? "").trim();
  const categories: string[] = [];
  const products: string[] = [];
  if (raw && raw.toLowerCase() !== "all products") {
    raw.split("|").forEach((segment) => {
      const value = segment.trim();
      const lower = value.toLowerCase();
      const list = (text: string) => text.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
      if (lower.startsWith("categories:")) categories.push(...list(value.slice("categories:".length)));
      else if (lower.startsWith("products:")) products.push(...list(value.slice("products:".length)));
      else if (lower.endsWith(" category")) categories.push(lower.slice(0, -" category".length).trim());
      else if (value) products.push(lower);
    });
  }
  return { appliesToAll: !categories.length && !products.length, categories, products };
}

/** A promotion row's target: its target_products text, else its linked products, else everything. */
export function promotionTargetFromRow(row: any): PromotionTarget {
  if (String(row?.target_products ?? "").trim()) return parsePromotionTarget(row.target_products);
  const links = Array.isArray(row?.promo_product) ? row.promo_product : [];
  const names = links
    .map((link: any) => (Array.isArray(link?.product) ? link.product[0] : link?.product)?.product_name)
    .filter(Boolean)
    .map((name: string) => String(name).trim().toLowerCase());
  return names.length ? { appliesToAll: false, categories: [], products: names } : { appliesToAll: true, categories: [], products: [] };
}

const TYPE_MARKERS = ["__TYPE_BUNDLE__", "__TYPE_BOGO__"];

export function promotionDisplayName(row: any) {
  return TYPE_MARKERS.reduce((name, marker) => name.replace(marker, ""), String(row?.promo_name ?? "Promotion")).trim();
}

export function promotionKind(row: any): "percentage" | "fixed" | "bogo" | "bundle" {
  const name = String(row?.promo_name ?? "");
  if (name.includes("__TYPE_BOGO__")) return "bogo";
  if (name.includes("__TYPE_BUNDLE__")) return "bundle";
  const type = String(row?.discount_type ?? "").toLowerCase();
  if (type.includes("bogo")) return "bogo";
  if (type.includes("bundle")) return "bundle";
  return type.includes("fixed") ? "fixed" : "percentage";
}

/**
 * Which promotion a sale line belongs to. Lines record their promo_id when the
 * POS applied one; older discounted lines without it are matched to the
 * promotion that was running for that product at the time (most specific wins).
 */
export function attributeSaleLine(
  line: { promoId?: string | null; discountPercent: number; productNameLower: string; categoryLower: string; saleMs: number },
  promotions: any[],
): string | null {
  if (line.promoId) return line.promoId;
  if (!(line.discountPercent > 0)) return null;
  let best: { id: string; score: number; value: number } | null = null;
  promotions.forEach((row) => {
    const start = promotionBoundaryMs(row.start_date, "start");
    const end = promotionBoundaryMs(row.end_date, "end");
    if (line.saleMs < start || line.saleMs > end) return;
    const target = promotionTargetFromRow(row);
    if (!promotionTargetMatches(target, line.productNameLower, line.categoryLower)) return;
    const score = target.products.length ? 3 : target.categories.length ? 2 : 1;
    const value = Number(row.discount_value ?? 0);
    if (!best || score > best.score || (score === best.score && value > best.value)) {
      best = { id: String(row.promo_id), score, value };
    }
  });
  return best ? (best as { id: string }).id : null;
}
