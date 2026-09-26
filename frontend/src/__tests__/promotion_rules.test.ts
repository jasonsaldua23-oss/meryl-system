import { describe, expect, it } from "vitest";
import { isPromotionLive, promotionBoundaryMs, promotionTargetMatches } from "../lib/promotion-rules";

// Promotion times are store wall-clock times stored with a meaningless "+00:00".
const at = (y: number, m: number, d: number, hh = 0, mm = 0) => new Date(y, m - 1, d, hh, mm).getTime();

describe("promotion window", () => {
  const evening = { status: "active", start_date: "2026-09-26T17:00:00+00:00", end_date: "2026-09-26T21:00:00+00:00" };

  it("reads stored times as local wall-clock times", () => {
    expect(promotionBoundaryMs("2026-09-26T17:00:00+00:00", "start")).toBe(at(2026, 9, 26, 17, 0));
    expect(promotionBoundaryMs("2026-09-26", "end")).toBe(new Date(2026, 8, 26, 23, 59, 59, 999).getTime());
  });

  it("a 5 PM - 9 PM promo is not live in the morning (POS used to check dates only)", () => {
    expect(isPromotionLive(evening, at(2026, 9, 26, 10, 0))).toBe(false);
    expect(isPromotionLive(evening, at(2026, 9, 26, 17, 0))).toBe(true);
    expect(isPromotionLive(evening, at(2026, 9, 26, 21, 1))).toBe(false);
  });

  it("an 'active' promo does not start before its start time", () => {
    expect(isPromotionLive({ ...evening, start_date: "2026-10-01T08:00:00+00:00", end_date: "2026-10-07T20:00:00+00:00" }, at(2026, 9, 26, 12))).toBe(false);
  });

  it("a promo switched off by staff never applies, even inside its window", () => {
    expect(isPromotionLive({ ...evening, status: "inactive" }, at(2026, 9, 26, 18))).toBe(false);
  });

  it("an expired status with a still-open window follows the window (status is refreshed on save)", () => {
    expect(isPromotionLive({ ...evening, status: "expired" }, at(2026, 9, 26, 22))).toBe(false);
  });
});

describe("promotion targets", () => {
  const productInCategory = { appliesToAll: false, categories: ["basketball shoes"], products: ["kobe 6"] };

  it("listed products are the target; the category only narrows them", () => {
    expect(promotionTargetMatches(productInCategory, "kobe 6", "basketball shoes")).toBe(true);
    // Previously true at the POS: every basketball shoe got the Kobe 6 discount.
    expect(promotionTargetMatches(productInCategory, "lebron 21", "basketball shoes")).toBe(false);
  });

  it("categories alone target the whole category", () => {
    const categoryOnly = { appliesToAll: false, categories: ["running shoes"], products: [] };
    expect(promotionTargetMatches(categoryOnly, "pegasus 41", "running shoes")).toBe(true);
    expect(promotionTargetMatches(categoryOnly, "kobe 6", "basketball shoes")).toBe(false);
  });

  it("all products", () => {
    expect(promotionTargetMatches({ appliesToAll: true, categories: [], products: [] }, "anything", "any")).toBe(true);
  });
});
