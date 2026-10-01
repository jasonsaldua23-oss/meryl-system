import { describe, expect, it } from "vitest";
import { normalizeProductDepartment, PRODUCT_DEPARTMENTS } from "../lib/product-department";

describe("product departments", () => {
  it("only offers the supported departments", () => {
    expect(PRODUCT_DEPARTMENTS).toEqual(["Men", "Women", "Unisex"]);
  });

  it("maps retired Kids values to Unisex", () => {
    expect(normalizeProductDepartment("Kids")).toBe("Unisex");
    expect(normalizeProductDepartment("children")).toBe("Unisex");
    expect(normalizeProductDepartment("Boys")).toBe("Unisex");
  });

  it("normalizes supported legacy labels", () => {
    expect(normalizeProductDepartment("male")).toBe("Men");
    expect(normalizeProductDepartment("female")).toBe("Women");
    expect(normalizeProductDepartment(null)).toBe("Unisex");
  });
});
