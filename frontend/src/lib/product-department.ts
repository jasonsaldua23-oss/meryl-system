export const PRODUCT_DEPARTMENTS = ["Men", "Women", "Unisex"] as const;

/** Keep retired or inconsistent product departments out of user-facing lists. */
export function normalizeProductDepartment(value: unknown): string {
  const raw = String(value ?? "").trim();
  const normalized = raw.toLowerCase();

  if (!normalized || normalized === "n/a" || normalized === "default") return "Unisex";
  if (["kid", "kids", "child", "children", "boy", "boys", "girl", "girls"].includes(normalized)) {
    return "Unisex";
  }
  if (["male", "man", "men", "men's", "mens"].includes(normalized)) return "Men";
  if (["female", "woman", "women", "women's", "womens", "ladies"].includes(normalized)) return "Women";
  if (normalized === "unisex") return "Unisex";

  return raw;
}
