import { describe, expect, it } from "vitest";
import { getSizeCurveAvailability, matchesSizeCurveScope, sizeCurveStyleKey } from "../lib/size-curve";

describe("product analytics size curve", () => {
  it("uses only active products with active configured inventory in the current view", () => {
    const active = getSizeCurveAvailability({
      status: "active",
      color: "Red",
      inventory: [{ inventory_id: "inv-1", inventory_status: "active", stock_quantity: 0 }],
    });
    const archived = getSizeCurveAvailability({
      status: "inactive",
      inventory: [{ inventory_id: "inv-2", inventory_status: "inactive", stock_quantity: 8 }],
    });
    const unconfigured = getSizeCurveAvailability({ status: "active", inventory: [] });

    expect(matchesSizeCurveScope({ ...active, unitsPeriod: 0 }, "current")).toBe(true);
    expect(matchesSizeCurveScope({ ...archived, unitsPeriod: 4 }, "current")).toBe(false);
    expect(matchesSizeCurveScope({ ...unconfigured, unitsPeriod: 4 }, "current")).toBe(false);
  });

  it("includes sold archived products only in the historical view", () => {
    expect(matchesSizeCurveScope({ isCurrentInventory: false, unitsPeriod: 3 }, "historical")).toBe(true);
    expect(matchesSizeCurveScope({ isCurrentInventory: true, unitsPeriod: 0 }, "historical")).toBe(false);
  });

  it("keeps colors and departments in separate style rows", () => {
    const base = { brand: "Nike", name: "Air Force 1", category: "Casual Shoes" };
    expect(sizeCurveStyleKey({ ...base, color: "White", gender: "Women" }))
      .not.toBe(sizeCurveStyleKey({ ...base, color: "Black", gender: "Women" }));
    expect(sizeCurveStyleKey({ ...base, color: "White", gender: "Women" }))
      .not.toBe(sizeCurveStyleKey({ ...base, color: "White", gender: "Men" }));
  });
});
