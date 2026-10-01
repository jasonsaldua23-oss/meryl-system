export type SizeCurveScope = "current" | "historical";

export function getSizeCurveAvailability(product: any) {
  const inventory = Array.isArray(product?.inventory) ? product.inventory[0] : product?.inventory;
  const hasInventory = Boolean(inventory && typeof inventory === "object" && Object.keys(inventory).length > 0);
  const productStatus = String(product?.status ?? "unknown").trim().toLowerCase();
  const inventoryStatus = String(inventory?.inventory_status ?? productStatus).trim().toLowerCase();
  const isProductActive = productStatus === "active" || productStatus === "available";
  const isInventoryActive = inventoryStatus === "active" || inventoryStatus === "available";

  return {
    color: String(product?.color ?? "N/A"),
    hasInventory,
    productStatus,
    inventoryStatus,
    isCurrentInventory: hasInventory && isProductActive && isInventoryActive,
  };
}

export function matchesSizeCurveScope(
  product: { isCurrentInventory?: boolean; unitsPeriod?: number },
  scope: SizeCurveScope,
) {
  return scope === "current"
    ? product.isCurrentInventory === true
    : Number(product.unitsPeriod ?? 0) > 0;
}

export function sizeCurveStyleKey(product: {
  brand?: unknown;
  name?: unknown;
  category?: unknown;
  color?: unknown;
  gender?: unknown;
}) {
  return [product.brand, product.name, product.category, product.color, product.gender]
    .map((value) => String(value ?? "").trim().toLowerCase())
    .join("::");
}
