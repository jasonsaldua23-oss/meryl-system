import { describe, expect, it } from "vitest";
import { formatStoreDate, formatStoreDateTime, localDateKey, parseDbTimestamp, recordMoment, storeDateDigits } from "../lib/datetime";

describe("localDateKey", () => {
  it("keeps local midnight on its own calendar day (toISOString would move it back in UTC+8)", () => {
    expect(localDateKey(new Date(2026, 8, 25, 0, 0, 0))).toBe("2026-09-25");
    expect(localDateKey(new Date(2026, 8, 25, 23, 59, 59))).toBe("2026-09-25");
    expect(localDateKey(new Date(2026, 9, 1))).toBe("2026-10-01");
  });

  it("parses date-only database values instead of dropping them", () => {
    expect(parseDbTimestamp("2026-09-25")).not.toBeNull();
  });
});

describe("parseDbTimestamp", () => {
  it("treats timestamps without a zone as UTC (Postgres now())", () => {
    expect(parseDbTimestamp("2026-09-25T06:30:15")?.toISOString()).toBe("2026-09-25T06:30:15.000Z");
    expect(parseDbTimestamp("2026-09-25 06:30:15.123456")?.toISOString()).toBe("2026-09-25T06:30:15.123Z");
  });

  it("keeps explicit zones", () => {
    expect(parseDbTimestamp("2026-09-25T06:30:15+00:00")?.toISOString()).toBe("2026-09-25T06:30:15.000Z");
    expect(parseDbTimestamp("2026-09-25T14:30:15+08:00")?.toISOString()).toBe("2026-09-25T06:30:15.000Z");
  });

  it("returns null for empty or invalid values", () => {
    expect(parseDbTimestamp(null)).toBeNull();
    expect(parseDbTimestamp("not a date")).toBeNull();
  });
});

describe("store time formatting (Asia/Manila)", () => {
  it("shows the real purchase time instead of a shifted one", () => {
    // Sale rung up at 2:30:15 PM in Bacolod = 06:30:15 UTC.
    expect(formatStoreDateTime(parseDbTimestamp("2026-09-25T06:30:15"))).toBe("Sep 25, 2026, 02:30:15 PM");
  });

  it("uses the Manila calendar date for early-morning sales", () => {
    // 7:15 AM on Sep 26 in Manila is still Sep 25 in UTC.
    const moment = parseDbTimestamp("2026-09-25T23:15:00Z");
    expect(formatStoreDate(moment)).toBe("2026-09-26");
    expect(storeDateDigits(moment)).toBe("20260926");
  });
});

describe("recordMoment", () => {
  it("falls back to created_at when the transaction date has no time (the 08:00:00 AM bug)", () => {
    const moment = recordMoment("2026-09-25", "2026-09-25T06:30:15");
    expect(formatStoreDateTime(moment)).toBe("Sep 25, 2026, 02:30:15 PM");
  });

  it("prefers the transaction timestamp when it has a time", () => {
    const moment = recordMoment("2026-09-25T06:30:15", "2026-09-25T09:00:00");
    expect(moment?.toISOString()).toBe("2026-09-25T06:30:15.000Z");
  });

  it("still returns the date when no candidate has a time", () => {
    expect(formatStoreDate(recordMoment("2026-09-25", null))).toBe("2026-09-25");
  });
});
