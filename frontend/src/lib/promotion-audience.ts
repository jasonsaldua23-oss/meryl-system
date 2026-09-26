/**
 * Promotion email audience (manuscript Use Case 9, Scenario 1, Step 2: "filters
 * target customer cohorts by gender, age bracket, or VIP status").
 *
 * The customer table has no VIP field, so VIP is derived from purchase history:
 * a customer with at least VIP_MIN_PURCHASES completed purchases.
 */

export const VIP_MIN_PURCHASES = 3;

export const AGE_BRACKETS = [
  { id: "all", label: "All ages", min: 0, max: Infinity },
  { id: "under-18", label: "Under 18", min: 0, max: 17 },
  { id: "18-24", label: "18 – 24", min: 18, max: 24 },
  { id: "25-34", label: "25 – 34", min: 25, max: 34 },
  { id: "35-44", label: "35 – 44", min: 35, max: 44 },
  { id: "45-54", label: "45 – 54", min: 45, max: 54 },
  { id: "55+", label: "55 and over", min: 55, max: Infinity },
] as const;

export type AgeBracketId = (typeof AGE_BRACKETS)[number]["id"];
export type GenderFilter = "all" | "male" | "female";
export type AudienceFilters = { gender: GenderFilter; ageBracket: AgeBracketId; vipOnly: boolean };

export type AudienceCustomer = {
  customer_id: string;
  name: string;
  email: string;
  gender: string;
  age: number | null;
  purchases: number;
  isVip: boolean;
};

function customerAge(row: any, now: Date): number | null {
  const birth = String(row?.birth_date ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(birth)) {
    const [y, m, d] = birth.split("-").map(Number);
    let age = now.getFullYear() - y;
    if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age -= 1;
    return age >= 0 ? age : null;
  }
  const stored = Number(row?.age);
  return Number.isFinite(stored) && stored > 0 ? stored : null;
}

function normalizeGender(value: unknown) {
  const g = String(value ?? "").trim().toLowerCase();
  if (["m", "male", "man", "men"].includes(g)) return "male";
  if (["f", "female", "woman", "women"].includes(g)) return "female";
  return g;
}

function isCompletedSale(sale: any) {
  const payment = Array.isArray(sale?.payment) ? sale.payment[0] : sale?.payment;
  const status = String(payment?.payment_status ?? "").toLowerCase();
  return ["completed", "paid", "success", "successful"].includes(status);
}

/** Active customers with their derived age, gender and VIP status. */
export function buildAudience(customerRows: any[], salesRows: any[], now = new Date()): AudienceCustomer[] {
  const purchases = new Map<string, number>();
  salesRows.forEach((sale) => {
    const id = String(sale?.customer_id ?? "").trim();
    if (!id || !isCompletedSale(sale)) return;
    purchases.set(id, (purchases.get(id) ?? 0) + 1);
  });
  return customerRows
    .filter((row) => String(row?.status ?? "active").toLowerCase() === "active")
    .map((row) => {
      const id = String(row?.customer_id ?? "");
      const count = purchases.get(id) ?? 0;
      return {
        customer_id: id,
        name: String(row?.name ?? row?.customer_name ?? "Customer"),
        email: String(row?.email ?? "").trim(),
        gender: normalizeGender(row?.gender),
        age: customerAge(row, now),
        purchases: count,
        isVip: count >= VIP_MIN_PURCHASES,
      };
    });
}

/**
 * Customers matching the filters. Walk-in placeholder addresses (@walkin.local)
 * and customers without an email cannot receive the promotion.
 */
export function selectAudience(audience: AudienceCustomer[], filters: AudienceFilters) {
  const bracket = AGE_BRACKETS.find((b) => b.id === filters.ageBracket) ?? AGE_BRACKETS[0];
  const matching = audience.filter((c) => {
    if (filters.gender !== "all" && c.gender !== filters.gender) return false;
    if (bracket.id !== "all" && (c.age === null || c.age < bracket.min || c.age > bracket.max)) return false;
    if (filters.vipOnly && !c.isVip) return false;
    return true;
  });
  const reachable = (c: AudienceCustomer) => /.+@.+\..+/.test(c.email) && !c.email.toLowerCase().endsWith("@walkin.local");
  return {
    recipients: matching.filter(reachable),
    withoutEmail: matching.filter((c) => !reachable(c)).length,
  };
}
