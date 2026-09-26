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
