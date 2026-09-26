import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBreakdownSlots, storeHourSlots } from "../app/components/ReportsAnalytics";

const NOW = new Date(2026, 8, 26, 14, 30, 0); // Sat, Sep 26, 2026 2:30 PM local

describe("Sales Breakdown periods", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("daily: store hours 7:30 AM - 7:30 PM in 12 hourly slots, plus off-hours catch-alls", () => {
    const { slots, unit, rangeLabel } = buildBreakdownSlots("daily", undefined, undefined, NOW);
    expect(unit).toBe("hour");
    const storeSlots = slots.filter((slot) => !slot.offHours);
    expect(storeSlots).toHaveLength(12);
    expect(storeSlots[0].label).toBe("7:30 AM – 8:30 AM");
    expect(storeSlots[0].start).toEqual(new Date(2026, 8, 26, 7, 30));
    expect(storeSlots[11].label).toBe("6:30 PM – 7:30 PM");
    expect(storeSlots[11].end).toEqual(new Date(2026, 8, 26, 19, 29, 59, 999));
    expect(rangeLabel).toBe("Store hours 7:30 AM – 7:30 PM, Sep 26, 2026");
    // The whole calendar day is covered, so no sale is lost.
    expect(slots[0].start).toEqual(new Date(2026, 8, 26, 0, 0));
    expect(slots[slots.length - 1].end).toEqual(new Date(2026, 8, 26, 23, 59, 59, 999));
    slots.slice(1).forEach((slot, i) => expect(slot.start.getTime()).toBe(slots[i].end.getTime() + 1));
  });

  it("weekly: 26 Sunday-start weeks ending with this week", () => {
    const { slots, unit } = buildBreakdownSlots("weekly", undefined, undefined, NOW);
    expect(unit).toBe("week");
    expect(slots).toHaveLength(26);
    expect(slots[25].start).toEqual(new Date(2026, 8, 20)); // Sun Sep 20
    expect(slots[25].end).toEqual(new Date(2026, 8, 26, 23, 59, 59, 999));
    expect(slots[0].start).toEqual(new Date(2026, 2, 29)); // 25 weeks earlier
    slots.forEach((slot) => expect(slot.start.getDay()).toBe(0));
    slots.slice(1).forEach((slot, i) => expect(slot.start.getTime()).toBe(slots[i].end.getTime() + 1));
  });

  it("monthly: January to December of this year", () => {
    const { slots, rangeLabel } = buildBreakdownSlots("monthly", undefined, undefined, NOW);
    expect(slots.map((s) => s.label)).toEqual([
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ]);
    expect(slots[1].end).toEqual(new Date(2026, 1, 28, 23, 59, 59, 999));
    expect(rangeLabel).toBe("January – December 2026");
  });

  it("quarterly: Q1-Q4 of this year", () => {
    const { slots } = buildBreakdownSlots("quarterly", undefined, undefined, NOW);
    expect(slots.map((s) => s.label)).toEqual(["Q1 (Jan – Mar)", "Q2 (Apr – Jun)", "Q3 (Jul – Sep)", "Q4 (Oct – Dec)"]);
    expect(slots[3].end).toEqual(new Date(2026, 11, 31, 23, 59, 59, 999));
  });

  it("annually: the last 5 years", () => {
    const { slots } = buildBreakdownSlots("annually", undefined, undefined, NOW);
    expect(slots.map((s) => s.label)).toEqual(["2022", "2023", "2024", "2025", "2026"]);
  });

  it("custom 1 day: store hours of that day (like Daily)", () => {
    const { slots, unit, rangeLabel } = buildBreakdownSlots("custom", "2026-08-23", "2026-08-23", NOW);
    expect(unit).toBe("hour");
    const storeSlots = slots.filter((slot) => !slot.offHours);
    expect(storeSlots).toHaveLength(12);
    expect(storeSlots[0].label).toBe("7:30 AM – 8:30 AM");
    expect(rangeLabel).toBe("Store hours 7:30 AM – 7:30 PM, Aug 23, 2026");
  });

  it("custom 3 days: store hours of each day, labelled with the date", () => {
    const { slots, unit } = buildBreakdownSlots("custom", "2026-08-23", "2026-08-25", NOW);
    expect(unit).toBe("hour");
    const storeSlots = slots.filter((slot) => !slot.offHours);
    expect(storeSlots).toHaveLength(36);
    expect(storeSlots[0].label).toBe("Aug 23 · 7:30 AM – 8:30 AM");
    expect(storeSlots[12].label).toBe("Aug 24 · 7:30 AM – 8:30 AM");
    expect(storeSlots[35].label).toBe("Aug 25 · 6:30 PM – 7:30 PM");
    // Every minute of the three days is covered exactly once (off-hours rows included).
    expect(slots[0].start).toEqual(new Date(2026, 7, 23));
    expect(slots[slots.length - 1].end).toEqual(new Date(2026, 7, 25, 23, 59, 59, 999));
    slots.slice(1).forEach((slot, i) => expect(slot.start.getTime()).toBe(slots[i].end.getTime() + 1));
  });

  it("custom 4+ days: one row per day", () => {
    const { slots, unit } = buildBreakdownSlots("custom", "2026-08-23", "2026-08-26", NOW);
    expect(unit).toBe("day");
    expect(slots).toHaveLength(4);
  });

  it("chart store-hour periods skip the overnight hours and stop at the given time", () => {
    const slots = storeHourSlots(new Date(2026, 7, 23, 7, 30), new Date(2026, 7, 24, 10, 0));
    expect(slots).toHaveLength(12 + 3); // all of Aug 23, then 7:30, 8:30, 9:30 on Aug 24
    expect(slots[11].start).toEqual(new Date(2026, 7, 23, 18, 30));
    expect(slots[12].start).toEqual(new Date(2026, 7, 24, 7, 30));
  });

  it("custom: one row per day, clipped to the range", () => {
    const { slots, unit } = buildBreakdownSlots("custom", "2026-09-01", "2026-09-10", NOW);
    expect(unit).toBe("day");
    expect(slots).toHaveLength(10);
    expect(slots[0].start).toEqual(new Date(2026, 8, 1));
    expect(slots[9].end).toEqual(new Date(2026, 8, 10, 23, 59, 59, 999));
  });

  it("custom: long ranges switch to months", () => {
    const { slots, unit } = buildBreakdownSlots("custom", "2026-01-15", "2026-09-10", NOW);
    expect(unit).toBe("month");
    expect(slots).toHaveLength(9);
    expect(slots[0].start).toEqual(new Date(2026, 0, 15));
    expect(slots[8].end).toEqual(new Date(2026, 8, 10, 23, 59, 59, 999));
  });
});
