import { describe, expect, it } from "vitest";
import { calculatePromotionPerformance, promotionPerformanceStatus } from "../lib/promotion-performance";

const localTime = (y: number, m: number, d: number, hour = 0) => new Date(y, m - 1, d, hour).getTime();
const promotions = [
  { promo_id: "active", promo_name: "Active Sale", status: "active", start_date: "2026-09-01T00:00", end_date: "2026-10-31T23:59", target_products: "Products: Kobe 6", discount_type: "percentage", discount_value: 15 },
  { promo_id: "off", promo_name: "Paused Sale", status: "inactive", start_date: "2026-09-01T00:00", end_date: "2026-10-31T23:59", target_products: "All Products", discount_type: "percentage", discount_value: 10 },
];

describe("promotion performance", () => {
  it("does not classify inactive as active", () => {
    expect(promotionPerformanceStatus(promotions[1], localTime(2026, 10, 2, 12))).toBe("Inactive");
  });

  it("counts explicit promo lines and excludes ordinary target sales", () => {
    const sales = [{
      transaction_date: "2026-10-01T12:00:00+08:00",
      payment: { payment_status: "completed" },
      sales_details: [
        { product_id: "kobe", promo_id: "active", quantity: 2, price: 1000, subtotal: 1700, discount_applied: 15 },
        { product_id: "kobe", quantity: 1, price: 1000, subtotal: 1000, discount_applied: 0 },
      ],
    }];
    const products = new Map([["kobe", { product_name: "Kobe 6", category: { category_name: "Basketball Shoes" } }]]);
    const rows = calculatePromotionPerformance(promotions, sales, products, localTime(2026, 10, 2, 12));
    expect(rows.find((row) => row.id === "active")).toMatchObject({ revenue: 1700, units: 2, contribution: 100 });
    expect(rows.find((row) => row.id === "off")).toMatchObject({ revenue: 0, units: 0, status: "Inactive" });
  });

  it("attributes discounted legacy lines but ignores incomplete sales", () => {
    const detail = { product_id: "kobe", quantity: 1, price: 1000, subtotal: 850, discount_applied: 15 };
    const sales = [
      { transaction_date: "2026-10-01T12:00:00+08:00", payment: { payment_status: "completed" }, sales_details: [detail] },
      { transaction_date: "2026-10-01T12:00:00+08:00", payment: { payment_status: "failed" }, sales_details: [detail] },
    ];
    const products = new Map([["kobe", { product_name: "Kobe 6", category: { category_name: "Basketball Shoes" } }]]);
    expect(calculatePromotionPerformance(promotions, sales, products)[0]).toMatchObject({ id: "active", revenue: 850, units: 1 });
  });
});
