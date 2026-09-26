/**
 * Date/time helpers for sales and exchange records.
 *
 * The database stores timestamps from now() in UTC, often without a time-zone
 * marker (e.g. "2026-09-25T06:30:00"). Browsers read such strings as local
 * time, which shifted every receipt by 8 hours. Values that carry no time at all
 * ("2026-09-25") showed as 08:00:00 AM. These helpers parse database values as
 * UTC and always display them in store time (Asia/Manila), regardless of the
 * device's time zone.
 */

export const STORE_TIME_ZONE = "Asia/Manila";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const HAS_ZONE = /(Z|[+-]\d{2}(:?\d{2})?)$/i;

/** Parses a database timestamp as UTC. Returns null for empty/invalid values. */
export function parseDbTimestamp(value: unknown): Date | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let normalized = raw.replace(" ", "T");
  if (DATE_ONLY.test(normalized)) normalized = `${normalized}T00:00:00Z`;
  else if (!HAS_ZONE.test(normalized)) normalized = `${normalized}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** True when the value carries a real time of day (not a bare date / UTC midnight). */
function hasTimeOfDay(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw || DATE_ONLY.test(raw)) return false;
  const date = parseDbTimestamp(raw);
  if (!date) return false;
  return !(date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0);
}

/**
 * The moment a record happened: the first candidate with a real time of day
 * (e.g. transaction_date, then created_at), else the first parseable date.
 */
export function recordMoment(...candidates: unknown[]): Date | null {
  for (const candidate of candidates) {
    if (hasTimeOfDay(candidate)) return parseDbTimestamp(candidate);
  }
  for (const candidate of candidates) {
    const date = parseDbTimestamp(candidate);
    if (date) return date;
  }
  return null;
}

/** YYYY-MM-DD in store time. */
export function formatStoreDate(date: Date | null | undefined): string {
  if (!date) return "N/A";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** e.g. "Sep 25, 2026, 02:30:15 PM" in store time. */
export function formatStoreDateTime(date: Date | null | undefined): string {
  if (!date) return "N/A";
  return date.toLocaleString("en-US", {
    timeZone: STORE_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** YYYYMMDD in store time, for receipt numbers. */
export function storeDateDigits(date: Date | null | undefined = new Date()): string {
  return formatStoreDate(date ?? new Date()).replace(/-/g, "");
}

/**
 * YYYY-MM-DD from the device's local calendar. Use this (not toISOString,
 * which is UTC) for day/month buckets built with local Date math
 * (setHours(0,0,0,0), new Date(y, m, d)); in the Philippines toISOString moves
 * local midnight to the previous day.
 */
export function localDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/** Today's date (YYYY-MM-DD) in store time. */
export function storeToday(): string {
  return formatStoreDate(new Date());
}
