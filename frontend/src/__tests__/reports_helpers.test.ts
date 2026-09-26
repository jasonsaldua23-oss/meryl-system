import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareSizes, comparisonText, money, paymentLabel, rangeWindow } from "../app/components/ReportsAnalytics";

describe("rangeWindow comparisons are like-for-like", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 26, 14, 0, 0)); // Sep 26, 2026 2:00 PM local
  });
  afterEach(() => vi.useRealTimers());

  it("monthly: compares Sep 1-26 with Aug 1-26, not all of August", () => {
    const { start, previousStart, previousEnd } = rangeWindow("monthly");
    expect(start).toEqual(new Date(2026, 8, 1));
    expect(previousStart).toEqual(new Date(2026, 7, 1));
    expect(previousEnd).toEqual(new Date(2026, 7, 26, 14, 0, 0));
  });

  it("daily: compares today so far with yesterday up to the same time", () => {
    const { previousStart, previousEnd } = rangeWindow("daily");
    expect(previousStart).toEqual(new Date(2026, 8, 25));
    expect(previousEnd).toEqual(new Date(2026, 8, 25, 14, 0, 0));
  });

  it("past custom range: compares the full previous span", () => {
    const { start, now, previousStart, previousEnd } = rangeWindow("custom", "2026-08-01", "2026-08-10");
    expect(start).toEqual(new Date(2026, 7, 1));
    expect(now).toEqual(new Date(2026, 7, 10, 23, 59, 59, 999));
    expect(previousStart).toEqual(new Date(2026, 6, 22));
    expect(previousEnd.getTime()).toBe(start.getTime() - 1);
  });

  it("previous period never overlaps the current one (Mar 31 vs February)", () => {
    vi.setSystemTime(new Date(2026, 2, 31, 12, 0, 0));
    const { start, previousEnd } = rangeWindow("monthly");
    expect(previousEnd.getTime()).toBeLessThan(start.getTime());
  });
});

describe("report formatting helpers", () => {
  it("shows exact money with separators", () => {
    expect(money(1819.5)).toBe("PHP 1,819.50");
    expect(money(200000)).toBe("PHP 200,000.00");
  });

  it("does not claim +100% when the previous period had no sales", () => {
    expect(comparisonText(500, 0)).toBe("New — no sales last period");
    expect(comparisonText(0, 0)).toBe("No sales in either period");
    expect(comparisonText(150, 100)).toBe("+50.0% vs same point last period");
  });

  it("sorts sizes numerically", () => {
    expect(["10", "7", "Size 9", "Standard", "8.5"].sort(compareSizes)).toEqual(["7", "8.5", "Size 9", "10", "Standard"]);
  });

  it("labels legacy 'online' payments as GCash", () => {
    expect(paymentLabel("online")).toBe("GCash");
    expect(paymentLabel("gcash")).toBe("GCash");
    expect(paymentLabel("cash")).toBe("Cash");
  });
});
