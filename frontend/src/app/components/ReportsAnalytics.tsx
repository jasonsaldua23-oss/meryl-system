import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { BarChart3, TrendingUp, Coins, Package, Calendar, Download, FileText, Trophy, Medal, Sparkles, Layers, Tag, UserCheck, CreditCard, Grid, FileSpreadsheet, Search, ShoppingBag, ArrowUpRight, ChevronLeft, ChevronRight, X, Filter } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, ReferenceLine, ReferenceDot } from 'recharts';
import { toast } from 'sonner';
import { useProducts, usePromotions, useSales } from '../../lib/hooks';
import { attributeSaleLine, promotionBoundaryMs, promotionDisplayName, promotionKind } from '../../lib/promotion-rules';
import { shortId } from './ui/utils';
import { localDateKey as localDayKey, parseDbTimestamp } from '../../lib/datetime';
import { useAuth } from '../../lib/auth-context';

function isCompletedSale(sale: any) {
  const payment = Array.isArray(sale.payment) ? sale.payment[0] : sale.payment;
  const status = String(payment?.payment_status ?? '').toLowerCase();
  return ['completed', 'paid', 'success', 'successful'].includes(status);
}

function saleDate(sale: any) {
  return parseDbTimestamp(sale.transaction_date ?? sale.created_at);
}

/** Exact peso amount for figures, tables and exports (e.g. PHP 1,819.50). */
export function money(value: number) {
  const amount = Number(value) || 0;
  return `PHP ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Short peso amount for chart axes only (e.g. PHP 1.8K). */
function moneyCompact(value: number) {
  const amount = Number(value) || 0;
  const abs = Math.abs(amount);
  if (abs >= 1000000) return `PHP ${(amount / 1000000).toFixed(1)}M`;
  if (abs >= 1000) return `PHP ${(amount / 1000).toFixed(1)}K`;
  return `PHP ${amount.toFixed(0)}`;
}

function moneyWhole(value: number) {
  return `PHP ${Math.round(value).toLocaleString()}`;
}

function percentChange(current: number, previous: number) {
  if (!previous && !current) return 0;
  if (!previous) return 100;
  return ((current - previous) / previous) * 100;
}

/** Payment method label. The legacy backend stored GCash as "online". */
export function paymentLabel(raw: unknown) {
  const value = String(raw ?? '').toLowerCase();
  if (value.includes('gcash') || value.includes('online') || value.includes('e-wallet')) return 'GCash';
  if (value.includes('card')) return 'Card';
  return 'Cash';
}

/** Receipt number in the same format printed by the POS (RCP-YYYYMMDD-XXXX). */
function receiptNumberFor(sale: any, date: Date) {
  const rawId = String(sale.receipt_number ?? sale.sales_id ?? sale.id ?? '').trim();
  if (/^(RCP|SLS|TXN)-/.test(rawId)) return rawId;
  const suffix = rawId.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || '0001';
  return `RCP-${localDayKey(date).replace(/-/g, '')}-${suffix}`;
}

/** Numeric shoe-size order (7, 8, 9, 10...), with non-numeric labels after, alphabetically. */
export function compareSizes(a: string, b: string) {
  const numA = parseFloat(String(a).replace(/[^\d.]/g, ''));
  const numB = parseFloat(String(b).replace(/[^\d.]/g, ''));
  const aIsNum = !Number.isNaN(numA);
  const bIsNum = !Number.isNaN(numB);
  if (aIsNum && bIsNum) return numA - numB;
  if (aIsNum) return -1;
  if (bIsNum) return 1;
  return String(a).localeCompare(String(b));
}

/** "+12.5% vs last period", or plain wording when there is nothing to compare against. */
export function comparisonText(current: number, previous: number) {
  if (!previous && !current) return 'No sales in either period';
  if (!previous) return 'New — no sales last period';
  const change = percentChange(current, previous);
  return `${change >= 0 ? '+' : ''}${change.toFixed(1)}% vs same point last period`;
}

type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually' | 'custom';

/** Parses a YYYY-MM-DD date input as a local calendar day (new Date() would read it as UTC). */
function parseLocalDateInput(value?: string) {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/**
 * Adds previousEnd so comparisons are like-for-like: when the current period is
 * still in progress (e.g. Sep 1-26 of "this month"), it is compared with the
 * same elapsed span of the previous period (Aug 1-26), not the whole of August.
 */
export function rangeWindow(timeRange: ReportPeriod, customStartDate?: string, customEndDate?: string) {
  const window = baseRangeWindow(timeRange, customStartDate, customEndDate);
  const elapsedEnd = new Date(Math.min(Date.now(), window.now.getTime()));
  const elapsedMs = Math.max(0, elapsedEnd.getTime() - window.start.getTime());
  const previousEnd = new Date(Math.min(window.previousStart.getTime() + elapsedMs, window.start.getTime() - 1));
  return { ...window, previousEnd };
}

function baseRangeWindow(timeRange: ReportPeriod, customStartDate?: string, customEndDate?: string) {
  const now = new Date();

  if (timeRange === 'custom') {
    const parsedStart = parseLocalDateInput(customStartDate);
    const parsedEnd = parseLocalDateInput(customEndDate);
    const start = parsedStart && !Number.isNaN(parsedStart.getTime()) ? parsedStart : new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = parsedEnd && !Number.isNaN(parsedEnd.getTime()) ? parsedEnd : now;
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    const safeStart = start <= end ? start : end;
    const safeEnd = end >= start ? end : start;
    // Whole calendar days in the range (Aug 1-10 = 10). The end is 23:59:59.999,
    // so compare day starts; ceil() here counted one extra day.
    const endDay = new Date(safeEnd.getFullYear(), safeEnd.getMonth(), safeEnd.getDate());
    const days = Math.max(1, Math.round((endDay.getTime() - safeStart.getTime()) / 86400000) + 1);
    const previousStart = new Date(safeStart);
    previousStart.setDate(safeStart.getDate() - days);
    return { now: safeEnd, start: safeStart, previousStart, days };
  }

  if (timeRange === 'daily') {
    // Within this day (today)
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const previousStart = new Date(start);
    previousStart.setDate(previousStart.getDate() - 1);
    return { now: end, start, previousStart, days: 1 };
  }

  if (timeRange === 'weekly') {
    // Within this week (last 7 days ending today)
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    const previousStart = new Date(start);
    previousStart.setDate(previousStart.getDate() - 7);
    return { now: end, start, previousStart, days: 7 };
  }

  if (timeRange === 'monthly') {
    // Within this month (1st of month to end of month)
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
    return { now: end, start, previousStart, days };
  }

  if (timeRange === 'quarterly') {
    // Within this quarter
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
    const start = new Date(now.getFullYear(), quarterMonth, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), quarterMonth + 3, 0, 23, 59, 59, 999);
    const previousStart = new Date(now.getFullYear(), quarterMonth - 3, 1, 0, 0, 0, 0);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
    return { now: end, start, previousStart, days };
  }

  if (timeRange === 'annually') {
    // Within this calendar year (Jan 1 to Dec 31)
    const start = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    const previousStart = new Date(now.getFullYear() - 1, 0, 1, 0, 0, 0, 0);
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000));
    return { now: end, start, previousStart, days };
  }

  const days = 30;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(now.getDate() - (days - 1));
  const previousStart = new Date(start);
  previousStart.setDate(start.getDate() - days);
  return { now, start, previousStart, days };
}

function formatDateRange(start: Date, end: Date) {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  if (start.toDateString() === end.toDateString()) {
    const today = new Date();
    if (start.toDateString() === today.toDateString()) {
      return `${start.toLocaleDateString('en-US', options)} (Today)`;
    }
    return start.toLocaleDateString('en-US', options);
  }
  return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
}

function getDepartmentColor(deptName: string): string {
  const lower = String(deptName ?? '').trim().toLowerCase();
  // Check women first since 'women' contains 'men'
  if (lower.includes('women') || lower === "women's" || lower === 'female') return '#ef4444'; // Red
  if (lower.includes('men') || lower === "men's" || lower === 'male') return '#3b82f6'; // Blue
  if (lower.includes('unisex')) return '#a855f7'; // Vibrant Purple (perfect blend of Blue & Red)
  if (lower.includes('kid') || lower.includes('child') || lower.includes('youth') || lower.includes('infant')) return '#f59e0b'; // Amber Gold
  return '#10b981'; // Emerald
}

function getPaymentMethodColor(methodName: string): string {
  const lower = String(methodName ?? '').trim().toLowerCase();
  if (lower.includes('gcash')) return '#0066ff'; // Iconic Electric GCash Blue
  if (lower.includes('cash')) return '#10b981'; // Vibrant Cash Emerald Green
  if (lower.includes('card') || lower.includes('credit') || lower.includes('debit')) return '#f59e0b'; // Warm Amber Gold
  if (lower.includes('maya') || lower.includes('paymaya')) return '#8b5cf6'; // Vivid Maya Purple
  if (lower.includes('bank') || lower.includes('transfer')) return '#ec4899'; // Hot Pink / Rose
  return '#06b6d4'; // Fallback Cyan
}

const darkChartTooltipProps = {
  contentStyle: {
    backgroundColor: '#16161C',
    border: '1px solid rgba(255, 255, 255, 0.2)',
    borderRadius: '10px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
    padding: '8px 12px',
    color: '#FFFFFF',
  },
  labelStyle: { color: '#FFFFFF', fontWeight: 600, fontSize: 12, marginBottom: 2 },
  itemStyle: { color: '#FFFFFF', fontSize: 12, fontWeight: 500 },
};

function ChartWhiteTooltip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;

  if (payload.length === 1) {
    const item = payload[0];
    const name = String(item.name || item.payload?.name || label || '').trim();
    const value = item.value;
    const rawData = item.payload;
    const color = item.fill || item.color || rawData?.fill || '#facc15';

    let displayVal = '';
    if (rawData?.share !== undefined && rawData?.revenue !== undefined) {
      displayVal = `${money(Number(rawData.revenue))} (${rawData.share}%)`;
    } else if (String(name).toLowerCase().includes('revenue') || String(item.dataKey).toLowerCase().includes('revenue')) {
      displayVal = money(Number(value));
    } else if (typeof value === 'number') {
      displayVal = value.toLocaleString();
      if (String(item.dataKey).toLowerCase().includes('sales') || String(name).toLowerCase().includes('sold') || String(name).toLowerCase().includes('pairs')) {
        displayVal += ' pairs';
      }
    } else {
      displayVal = String(value);
    }

    return (
      <div
        style={{
          backgroundColor: '#12121a',
          border: '1px solid rgba(255, 255, 255, 0.3)',
          borderRadius: '10px',
          padding: '8px 12px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.85)',
          color: '#FFFFFF',
          fontSize: '12px',
          fontWeight: 500,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: '#FFFFFF' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: color,
              flexShrink: 0,
            }}
          />
          <span style={{ color: '#FFFFFF', fontWeight: 600 }}>{name}</span>
          <span style={{ color: '#A1A1AA' }}>:</span>
          <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{displayVal}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: '#12121a',
        border: '1px solid rgba(255, 255, 255, 0.3)',
        borderRadius: '10px',
        padding: '8px 12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.85)',
        color: '#FFFFFF',
        fontSize: '12px',
        fontWeight: 500,
      }}
    >
      {label && (
        <div
          style={{
            color: '#FFFFFF',
            fontWeight: 700,
            fontSize: '12px',
            marginBottom: '6px',
            borderBottom: '1px solid #282838',
            paddingBottom: '4px',
          }}
        >
          {label}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {payload.map((item: any, idx: number) => {
          const name = String(item.name || item.dataKey || '').trim();
          const value = item.value;
          const color = item.fill || item.color || '#facc15';
          const isRev = name.toLowerCase().includes('revenue') || String(item.dataKey).toLowerCase().includes('revenue');
          const displayVal = typeof value === 'number'
            ? (isRev ? money(value) : `${value.toLocaleString()} pairs`)
            : value;

          return (
            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#FFFFFF' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, flexShrink: 0 }} />
              <span style={{ color: '#FFFFFF', fontWeight: 500 }}>{name}:</span>
              <span style={{ color: '#FFFFFF', fontWeight: 700 }}>{displayVal}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Store operating hours: the Daily view runs 7:30 AM - 7:30 PM in hourly steps. */
export const STORE_HOURS = { open: { hour: 7, minute: 30 }, close: { hour: 19, minute: 30 } };

function storeOpening(day: Date) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), STORE_HOURS.open.hour, STORE_HOURS.open.minute);
}

function storeClosing(day: Date) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), STORE_HOURS.close.hour, STORE_HOURS.close.minute);
}

/** e.g. "7:30 AM" (minutes shown only when not on the hour). */
function clockLabel(date: Date) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", ...(date.getMinutes() ? { minute: "2-digit" } : {}) });
}

/** Longest range (in days) shown hour by hour; longer ranges get one point per day. */
export const HOURLY_MAX_DAYS = 3;

/**
 * Hourly store-hour periods (7:30-8:30 AM ... 6:30-7:30 PM) for every day from
 * `from` to `to`, skipping the overnight hours. Only periods starting by `to`.
 */
export function storeHourSlots(from: Date, to: Date) {
  const slots: Array<{ start: Date; end: Date; day: Date }> = [];
  for (let day = startOfDay(from); day <= to; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    const closing = storeClosing(day);
    for (let start = storeOpening(day); start < closing && start <= to; start = new Date(start.getTime() + 3600000)) {
      slots.push({ start, end: new Date(Math.min(start.getTime() + 3600000, closing.getTime()) - 1), day });
    }
  }
  return slots;
}

type TrendBucketMode = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';

function startOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function weekStartSunday(date: Date) {
  const copy = startOfDay(date);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

/**
 * Detail level for a custom range, used by both the chart and the Sales Breakdown:
 * 1-3 days -> store hours, up to a month -> days, up to 3 months -> weeks,
 * up to 2 years -> months, longer -> years.
 */
export function customGranularity(days: number): TrendBucketMode {
  if (days <= HOURLY_MAX_DAYS) return 'hourly';
  if (days <= 31) return 'daily';
  if (days <= 92) return 'weekly';
  if (days <= 731) return 'monthly';
  return 'annually';
}

function trendBucketMode(timeRange: ReportPeriod, days: number): TrendBucketMode {
  if (timeRange === 'daily') return 'daily';
  if (timeRange === 'weekly') return 'weekly';
  if (timeRange === 'monthly') return 'monthly';
  if (timeRange === 'quarterly') return 'quarterly';
  if (timeRange === 'annually') return 'annually';
  return customGranularity(days);
}

function bucketStartForDate(date: Date, mode: TrendBucketMode) {
  if (mode === 'hourly') {
    const offset = STORE_HOURS.open.minute;
    const aligned = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), offset);
    return aligned > date ? new Date(aligned.getTime() - 3600000) : aligned;
  }
  const copy = startOfDay(date);
  if (mode === 'weekly') return weekStartSunday(copy);
  if (mode === 'monthly') return new Date(copy.getFullYear(), copy.getMonth(), 1);
  if (mode === 'quarterly') return new Date(copy.getFullYear(), Math.floor(copy.getMonth() / 3) * 3, 1);
  if (mode === 'annually') return new Date(copy.getFullYear(), 0, 1);
  return copy;
}

function nextBucketStart(date: Date, mode: TrendBucketMode) {
  const next = new Date(date);
  if (mode === 'hourly') next.setHours(next.getHours() + 1);
  else if (mode === 'weekly') next.setDate(next.getDate() + 7);
  else if (mode === 'monthly') next.setMonth(next.getMonth() + 1);
  else if (mode === 'quarterly') next.setMonth(next.getMonth() + 3);
  else if (mode === 'annually') next.setFullYear(next.getFullYear() + 1);
  else next.setDate(next.getDate() + 1);
  return next;
}

function trendBucketLabel(bucket: Date, mode: TrendBucketMode) {
  if (mode === 'hourly') return clockLabel(bucket);
  if (mode === 'weekly') {
    const end = new Date(bucket);
    end.setDate(bucket.getDate() + 6);
    return `${bucket.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  if (mode === 'monthly') return bucket.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  if (mode === 'quarterly') return `Q${Math.floor(bucket.getMonth() / 3) + 1} ${bucket.getFullYear()}`;
  if (mode === 'annually') return String(bucket.getFullYear());
  return bucket.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function endOfDay(date: Date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function salesTrendFrame(timeRange: ReportPeriod, customStartDate?: string, customEndDate?: string) {
  const frame = salesTrendFrameUncapped(timeRange, customStartDate, customEndDate);
  // Never chart periods that have not happened yet (they would plot as zero sales):
  // stop at the current hour for hourly charts, at today otherwise.
  const now = new Date();
  const cap = frame.mode === 'hourly' ? now : endOfDay(now);
  return { ...frame, end: frame.end > cap ? cap : frame.end };
}

function salesTrendFrameUncapped(timeRange: ReportPeriod, customStartDate?: string, customEndDate?: string) {
  const window = rangeWindow(timeRange, customStartDate, customEndDate);
  const baseEnd = window.now;

  if (timeRange === 'daily') {
    // One day: chart store hours (7:30 AM - 7:30 PM) hour by hour.
    return { start: storeOpening(window.start), end: new Date(storeClosing(window.start).getTime() - 1), mode: 'hourly' as TrendBucketMode };
  }

  if (timeRange === 'weekly') {
    return { start: window.start, end: window.now, mode: 'daily' as TrendBucketMode };
  }

  if (timeRange === 'monthly') {
    return { start: window.start, end: window.now, mode: 'daily' as TrendBucketMode };
  }

  if (timeRange === 'quarterly') {
    return { start: window.start, end: window.now, mode: 'weekly' as TrendBucketMode };
  }

  if (timeRange === 'annually') {
    return { start: window.start, end: window.now, mode: 'monthly' as TrendBucketMode };
  }

  if (timeRange === 'custom' && window.days <= HOURLY_MAX_DAYS) {
    // 1-3 day ranges: store hours of each day, hour by hour.
    return { start: storeOpening(window.start), end: new Date(storeClosing(startOfDay(window.now)).getTime() - 1), mode: 'hourly' as TrendBucketMode };
  }

  return {
    start: window.start,
    end: window.now,
    mode: trendBucketMode(timeRange, window.days),
  };
}

/**
 * Fixed periods for the Sales Breakdown (see the comment on salesBreakdown).
 * Pure so it can be tested; sales are filled in by the caller.
 */
export function buildBreakdownSlots(
  timeRange: ReportPeriod,
  customStartDate?: string,
  customEndDate?: string,
  now: Date = new Date(),
) {
  const window = rangeWindow(timeRange, customStartDate, customEndDate);
  type Slot = { label: string; start: Date; end: Date; offHours: boolean; pairs: number; gross: number; discount: number; net: number; transactions: number };
  const slots: Slot[] = [];
  const addSlot = (start: Date, end: Date, label: string, offHours = false) =>
    slots.push({ label, start, end, offHours, pairs: 0, gross: 0, discount: 0, net: 0, transactions: 0 });
  const shortDate = (date: Date, withYear = false) =>
    date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
  const year = now.getFullYear();
  let rangeLabel = '';
  let unit = 'period';

  const addDays = (from: Date, to: Date) => {
    for (let day = startOfDay(from); day <= to; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
      addSlot(day, endOfDay(day), shortDate(day, true));
    }
  };
  const addMonths = (from: Date, to: Date, withYear: boolean) => {
    for (let month = new Date(from.getFullYear(), from.getMonth(), 1); month <= to; month = new Date(month.getFullYear(), month.getMonth() + 1, 1)) {
      addSlot(month, new Date(month.getFullYear(), month.getMonth() + 1, 1, 0, 0, 0, -1),
        month.toLocaleDateString('en-US', withYear ? { month: 'long', year: 'numeric' } : { month: 'long' }));
    }
  };

  // One day: "Before opening", the hourly store-hour slots, then "After closing".
  // Off-hours rows keep early/late sales and are shown only when they have any.
  const addStoreHoursDay = (day: Date, withDate: boolean) => {
    const opening = storeOpening(day);
    const closing = storeClosing(day);
    const prefix = withDate ? `${shortDate(day)} · ` : '';
    addSlot(day, new Date(opening.getTime() - 1), `${prefix}Before opening (before ${clockLabel(opening)})`, true);
    storeHourSlots(day, endOfDay(day)).forEach(({ start, end }) => {
      addSlot(start, end, `${prefix}${clockLabel(start)} – ${clockLabel(new Date(end.getTime() + 1))}`);
    });
    addSlot(closing, endOfDay(day), `${prefix}After closing (after ${clockLabel(closing)})`, true);
  };

  if (timeRange === 'daily') {
    const day = startOfDay(window.start);
    addStoreHoursDay(day, false);
    rangeLabel = `Store hours ${clockLabel(storeOpening(day))} – ${clockLabel(storeClosing(day))}, ${shortDate(day, true)}`;
    unit = 'hour';
  } else if (timeRange === 'weekly') {
    const thisWeek = weekStartSunday(now);
    for (let back = 25; back >= 0; back -= 1) {
      const start = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - back * 7);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7, 0, 0, 0, -1);
      addSlot(start, end, `${shortDate(start)} – ${shortDate(end, start.getFullYear() !== end.getFullYear() || back === 0)}`);
    }
    rangeLabel = `Last 26 weeks (${shortDate(slots[0].start, true)} – ${shortDate(slots[slots.length - 1].end, true)})`;
    unit = 'week';
  } else if (timeRange === 'monthly') {
    addMonths(new Date(year, 0, 1), new Date(year, 11, 31), false);
    rangeLabel = `January – December ${year}`;
    unit = 'month';
  } else if (timeRange === 'quarterly') {
    for (let quarter = 0; quarter < 4; quarter += 1) {
      const start = new Date(year, quarter * 3, 1);
      const end = new Date(year, quarter * 3 + 3, 1, 0, 0, 0, -1);
      addSlot(start, end, `Q${quarter + 1} (${start.toLocaleDateString('en-US', { month: 'short' })} – ${end.toLocaleDateString('en-US', { month: 'short' })})`);
    }
    rangeLabel = `Q1 – Q4 ${year}`;
    unit = 'quarter';
  } else if (timeRange === 'annually') {
    for (let y = year - 4; y <= year; y += 1) {
      addSlot(new Date(y, 0, 1), new Date(y + 1, 0, 1, 0, 0, 0, -1), String(y));
    }
    rangeLabel = `${year - 4} – ${year}`;
    unit = 'year';
  } else if (window.days <= HOURLY_MAX_DAYS) {
    // Short custom ranges (1-3 days): store hours of each day, hour by hour.
    const multiDay = window.days > 1;
    for (let day = startOfDay(window.start); day <= window.now; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
      addStoreHoursDay(day, multiDay);
    }
    const firstDay = startOfDay(window.start);
    rangeLabel = `Store hours ${clockLabel(storeOpening(firstDay))} – ${clockLabel(storeClosing(firstDay))}, ${
      multiDay ? `${shortDate(firstDay)} – ${shortDate(window.now, true)}` : shortDate(firstDay, true)
    }`;
    unit = 'hour';
  } else {
    const granularity = customGranularity(window.days);
    if (granularity === 'daily') {
      addDays(window.start, window.now);
      unit = 'day';
    } else if (granularity === 'weekly') {
      for (let start = weekStartSunday(window.start); start <= window.now; start = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)) {
        const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7, 0, 0, 0, -1);
        addSlot(start, end, `${shortDate(start)} – ${shortDate(end, start.getFullYear() !== end.getFullYear())}`);
      }
      unit = 'week';
    } else if (granularity === 'monthly') {
      addMonths(window.start, window.now, true);
      unit = 'month';
    } else {
      for (let y = window.start.getFullYear(); y <= window.now.getFullYear(); y += 1) {
        addSlot(new Date(y, 0, 1), new Date(y + 1, 0, 1, 0, 0, 0, -1), String(y));
      }
      unit = 'year';
    }
    // Custom ranges start/end mid-period: clip the first and last slot to the range,
    // and relabel clipped weeks/months so the label says exactly what is covered.
    if (slots.length) {
      const relabel = (slot: Slot) => {
        if (unit === 'week') {
          slot.label = startOfDay(slot.start).getTime() === startOfDay(slot.end).getTime()
            ? shortDate(slot.start)
            : `${shortDate(slot.start)} – ${shortDate(slot.end, slot.start.getFullYear() !== slot.end.getFullYear())}`;
        }
        if (unit === 'month') slot.label = `${slot.label} (${shortDate(slot.start)} – ${shortDate(slot.end)})`;
      };
      const clipped = new Set<Slot>();
      const first = slots[0];
      if (window.start > first.start) {
        first.start = window.start;
        clipped.add(first);
      }
      const last = slots[slots.length - 1];
      if (window.now < last.end) {
        last.end = window.now;
        clipped.add(last);
      }
      clipped.forEach(relabel);
    }
    rangeLabel = formatDateRange(window.start, window.now);
  }

  return { slots, rangeLabel, unit };
}

export function ReportsAnalytics() {
  const [timeRange, setTimeRange] = useState<ReportPeriod>('monthly');
  const [reportType, setReportType] = useState('overview');
  const [trendMetric, setTrendMetric] = useState<'revenue' | 'pairs'>('revenue');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [showComparison, setShowComparison] = useState(true);
  const [topDimensionTab, setTopDimensionTab] = useState<'products' | 'brand' | 'size' | 'variant' | 'category' | 'gender' | 'payment' | 'grid'>('products');
  const [topSortBy, setTopSortBy] = useState<'units' | 'revenue'>('units');
  const [shoeSearchQuery, setShoeSearchQuery] = useState('');
  const [selectedShoeName, setSelectedShoeName] = useState('');
  const [brandFilter, setBrandFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [departmentFilter, setDepartmentFilter] = useState('all');
  const [sizeFilter, setSizeFilter] = useState('all');
  const [variantFilter, setVariantFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState<'all' | 'critical' | 'reorder' | 'optimal' | 'overstock'>('all');
  const [inventorySearchQuery, setInventorySearchQuery] = useState('');
  const [inventoryBrandFilter, setInventoryBrandFilter] = useState('all');
  const [inventoryCategoryFilter, setInventoryCategoryFilter] = useState('all');
  const [inventoryDeptFilter, setInventoryDeptFilter] = useState('all');
  const [inventorySizeFilter, setInventorySizeFilter] = useState('all');
  const [inventoryCurrentPage, setInventoryCurrentPage] = useState(1);
  const [inventoryPageSize, setInventoryPageSize] = useState(25);
  const [drilldownSection, setDrilldownSection] = useState<'all' | 'shoe' | 'brands' | 'categories' | 'departments' | 'sizes' | 'variants' | 'payments'>('all');
  const { user } = useAuth();
  const salesQuery = useSales();
  const productsQuery = useProducts();
  const promotionsQuery = usePromotions();

  const salesRows = ((salesQuery.data as any[]) ?? []).filter(isCompletedSale);
  const productRows = (productsQuery.data as any[]) ?? [];

  const productLookup = useMemo(() => {
    const map = new Map<string, any>();
    productRows.forEach((product: any) => map.set(String(product.product_id ?? ''), product));
    return map;
  }, [productRows]);

  const stockBySku = useMemo(() => {
    const map = new Map<string, number>();
    productRows.forEach((product: any) => {
      const inventory = Array.isArray(product.inventory) ? product.inventory[0] : product.inventory;
      const onHand = Number(inventory?.stock_quantity ?? product.stock ?? 0);
      const reserved = Number(inventory?.reserved_quantity ?? inventory?.held_stock ?? product.reserved_stock ?? 0);
      map.set(String(product.product_id ?? ''), Math.max(0, onHand - reserved));
    });
    return map;
  }, [productRows]);

  const currentMetrics = useMemo(() => {
    const { now, start, previousStart, previousEnd: compareEnd } = rangeWindow(timeRange, customStartDate, customEndDate);

    const current = salesRows.filter((sale) => {
      const date = saleDate(sale);
      return date && date >= start && date <= now;
    });
    const previous = salesRows.filter((sale) => {
      const date = saleDate(sale);
      return date && date >= previousStart && date <= compareEnd;
    });
    const summarize = (rows: any[]) => {
      const customers = new Set<string>();
      let revenue = 0;
      let units = 0;
      let totalCost = 0;
      rows.forEach((sale) => {
        revenue += Number(sale.total_amount ?? 0);
        customers.add(sale.customer_id ? String(sale.customer_id) : `walk-in:${String(sale.sales_id ?? Math.random())}`);
        const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
        details.forEach((detail: any) => {
          const qty = Number(detail.quantity ?? 0);
          units += qty;
          const prod = productLookup.get(String(detail.product_id ?? '')) ?? detail.product;
          const cost = Number(prod?.cost_price ?? detail.cost_price ?? 0);
          totalCost += cost * qty;
        });
      });
      const grossProfit = Math.max(0, revenue - totalCost);
      const margin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
      const aov = rows.length > 0 ? revenue / rows.length : 0;
      return { revenue, units, customers: customers.size, transactions: rows.length, grossProfit, margin, aov };
    };
    return { current: summarize(current), previous: summarize(previous) };
  }, [customEndDate, customStartDate, productLookup, salesRows, timeRange]);

  const filteredSalesTrends = useMemo(() => {
    const { end, mode, start } = salesTrendFrame(timeRange, customStartDate, customEndDate);
    const grouped = new Map<string, { sales: number; revenue: number; customers: Set<string>; firstDate: Date }>();
    const seed = (bucket: Date) =>
      grouped.set(String(bucket.getTime()), { sales: 0, revenue: 0, customers: new Set<string>(), firstDate: bucket });

    if (mode === 'hourly') {
      // Store hours of each day only, so nights do not plot as zero sales.
      storeHourSlots(start, end).forEach((slot) => seed(slot.start));
    } else {
      for (let cursor = bucketStartForDate(start, mode); cursor <= end; cursor = nextBucketStart(cursor, mode)) {
        seed(new Date(cursor));
      }
    }
    const multiDay = startOfDay(start).getTime() !== startOfDay(end).getTime();

    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > end) return;
      const bucket = bucketStartForDate(date, mode);
      const key = String(bucket.getTime());
      // Hourly charts cover store hours only; off-hours sales are listed in the Sales Breakdown.
      if (mode === 'hourly' && !grouped.has(key)) return;
      const prev = grouped.get(key) ?? { sales: 0, revenue: 0, customers: new Set<string>(), firstDate: bucket };
      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        prev.sales += Number(detail.quantity ?? 0);
      });
      prev.revenue += Number(sale.total_amount ?? 0);
      // Walk-in sales have no customer record; each one is still a customer served.
      prev.customers.add(sale.customer_id ? String(sale.customer_id) : `walk-in:${String(sale.sales_id ?? Math.random())}`);
      grouped.set(key, prev);
    });
    return Array.from(grouped.entries())
      .map(([, agg], idx) => ({
        id: `flt-${idx}`,
        date: mode === 'hourly' && multiDay
          ? `${agg.firstDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${clockLabel(agg.firstDate)}`
          : trendBucketLabel(agg.firstDate, mode),
        sortDate: agg.firstDate.getTime(),
        sales: Math.round(agg.sales),
        revenue: Math.round(agg.revenue),
        customers: agg.customers.size,
      }))
      .sort((a, b) => a.sortDate - b.sortDate);
  }, [customEndDate, customStartDate, salesRows, timeRange]);

  const topRankings = useMemo(() => {
    const { now, start } = rangeWindow(timeRange, customStartDate, customEndDate);

    const byProduct = new Map<string, { key: string; name: string; subtitle?: string; sales: number; revenue: number; cost: number; margin: number }>();
    const byBrand = new Map<string, { key: string; name: string; subtitle?: string; sales: number; revenue: number }>();
    const bySize = new Map<string, { key: string; name: string; subtitle?: string; sales: number; revenue: number }>();
    const byVariant = new Map<string, { key: string; name: string; subtitle?: string; sales: number; revenue: number }>();
    const byCategory = new Map<string, { key: string; name: string; subtitle?: string; sales: number; revenue: number }>();
    const byGender = new Map<string, { key: string; name: string; subtitle?: string; sales: number; revenue: number }>();
    const byPayment = new Map<string, { key: string; name: string; subtitle?: string; sales: number; revenue: number }>();

    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > now) return;

      // Payment method
      const payment = Array.isArray(sale.payment) ? sale.payment[0] : sale.payment;
      const rawPayMethod = String(payment?.payment_method ?? sale.payment_method ?? 'Cash').toLowerCase();
      const payMethodLabel = paymentLabel(rawPayMethod);
      const saleRevenue = Number(sale.total_amount ?? 0);
      const prevPay = byPayment.get(payMethodLabel) ?? { key: payMethodLabel, name: payMethodLabel, subtitle: 'Payment Method', sales: 0, revenue: 0 };
      prevPay.sales += 1;
      prevPay.revenue += saleRevenue;
      byPayment.set(payMethodLabel, prevPay);

      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const product = productLookup.get(String(detail.product_id ?? '')) ?? detail.product;
        const qty = Number(detail.quantity ?? 0);
        const revenue = Number(detail.subtotal ?? (Number(detail.price ?? 0) * qty));
        const cost = Number(product?.cost_price ?? 0) * qty;

        // 1. Shoe Model / Product
        const productName = String(product?.product_name ?? detail.product?.product_name ?? 'Unknown Shoe').trim();
        const brandName = String(product?.brand ?? 'Meryl Shoes').trim();
        const categoryName = String(product?.category?.[0]?.category_name ?? product?.category?.category_name ?? 'Footwear').trim();
        const prevProd = byProduct.get(productName) ?? {
          key: productName,
          name: productName,
          subtitle: `${brandName} • ${categoryName}`,
          sales: 0,
          revenue: 0,
          cost: 0,
          margin: 0,
        };
        prevProd.sales += qty;
        prevProd.revenue += revenue;
        // Margin must use the cost of every pair sold, not just this line's.
        prevProd.cost += cost;
        prevProd.margin = prevProd.revenue > 0 ? Math.max(0, Math.round(((prevProd.revenue - prevProd.cost) / prevProd.revenue) * 100)) : 0;
        byProduct.set(productName, prevProd);

        // 2. Brand
        const prevBrand = byBrand.get(brandName) ?? { key: brandName, name: brandName, subtitle: 'Shoe Brand', sales: 0, revenue: 0 };
        prevBrand.sales += qty;
        prevBrand.revenue += revenue;
        byBrand.set(brandName, prevBrand);

        // 3. Size
        const rawSize = String(product?.size ?? '').trim();
        const sizeLabel = rawSize ? `Size ${rawSize}` : 'Standard';
        const prevSize = bySize.get(sizeLabel) ?? { key: sizeLabel, name: sizeLabel, subtitle: 'Shoe Size', sales: 0, revenue: 0 };
        prevSize.sales += qty;
        prevSize.revenue += revenue;
        bySize.set(sizeLabel, prevSize);

        // 4. Variant / Colorway
        const rawColor = String(product?.color ?? '').trim();
        const variantLabel = rawColor || 'Standard Color';
        const prevVariant = byVariant.get(variantLabel) ?? { key: variantLabel, name: variantLabel, subtitle: 'Color / Style', sales: 0, revenue: 0 };
        prevVariant.sales += qty;
        prevVariant.revenue += revenue;
        byVariant.set(variantLabel, prevVariant);

        // 5. Category
        const prevCat = byCategory.get(categoryName) ?? { key: categoryName, name: categoryName, subtitle: 'Category', sales: 0, revenue: 0 };
        prevCat.sales += qty;
        prevCat.revenue += revenue;
        byCategory.set(categoryName, prevCat);

        // 6. Gender
        const rawGender = String(product?.gender ?? '').trim();
        const genderLabel = !rawGender || rawGender.toLowerCase() === 'n/a' ? 'Unisex' : rawGender;
        const prevGender = byGender.get(genderLabel) ?? { key: genderLabel, name: genderLabel, subtitle: 'Department', sales: 0, revenue: 0 };
        prevGender.sales += qty;
        prevGender.revenue += revenue;
        byGender.set(genderLabel, prevGender);
      });
    });

    const rank = (map: Map<string, any>) => {
      const all = Array.from(map.values());
      const maxSales = Math.max(1, ...all.map((item) => item.sales));
      const maxRevenue = Math.max(1, ...all.map((item) => item.revenue));
      return {
        byUnits: [...all].sort((a, b) => b.sales - a.sales || b.revenue - a.revenue).slice(0, 5).map((item, idx) => ({
          ...item,
          rank: idx + 1,
          share: Math.round((item.sales / maxSales) * 100),
        })),
        byRevenue: [...all].sort((a, b) => b.revenue - a.revenue || b.sales - a.sales).slice(0, 5).map((item, idx) => ({
          ...item,
          rank: idx + 1,
          share: Math.round((item.revenue / maxRevenue) * 100),
        })),
      };
    };

    return {
      products: rank(byProduct),
      brand: rank(byBrand),
      size: rank(bySize),
      variant: rank(byVariant),
      category: rank(byCategory),
      gender: rank(byGender),
      payment: rank(byPayment),
    };
  }, [customEndDate, customStartDate, productLookup, salesRows, timeRange]);

  const topProducts = useMemo(() => {
    return topRankings.products.byRevenue.map((p) => ({
      id: p.key,
      name: p.name,
      sales: p.sales,
      revenue: p.revenue,
      margin: p.margin ?? 0,
    }));
  }, [topRankings]);

  const topBrands = useMemo(() => {
    return topRankings.brand.byRevenue.map((b) => ({
      name: b.name,
      sales: b.sales,
      revenue: b.revenue,
    }));
  }, [topRankings]);

  const topSizes = useMemo(() => {
    return topRankings.size.byUnits.map((s) => ({
      name: s.name.replace(/^Size\s*/i, ''),
      sales: s.sales,
      revenue: s.revenue,
    }));
  }, [topRankings]);

  const allShoeModels = useMemo(() => {
    const names = new Set<string>();
    productRows.forEach((p: any) => {
      const name = String(p.product_name ?? '').trim();
      if (name) names.add(name);
    });
    salesRows.forEach((s: any) => {
      const details = Array.isArray(s.sales_details) ? s.sales_details : [];
      details.forEach((d: any) => {
        const prod = productLookup.get(String(d.product_id ?? '')) ?? d.product;
        const name = String(prod?.product_name ?? d.product_name ?? '').trim();
        if (name) names.add(name);
      });
    });
    return Array.from(names).sort();
  }, [productLookup, productRows, salesRows]);

  const allBrands = useMemo(() => {
    const brands = new Set<string>();
    productRows.forEach((p: any) => {
      const b = String(p.brand ?? '').trim();
      if (b) brands.add(b);
    });
    return Array.from(brands).sort();
  }, [productRows]);

  const allCategories = useMemo(() => {
    const cats = new Set<string>();
    productRows.forEach((p: any) => {
      const c = String(p.category?.[0]?.category_name ?? p.category?.category_name ?? p.category_name ?? '').trim();
      if (c) cats.add(c);
    });
    return Array.from(cats).sort();
  }, [productRows]);

  const activeShoeName = useMemo(() => {
    if (selectedShoeName) return selectedShoeName;
    if (shoeSearchQuery.trim()) {
      const q = shoeSearchQuery.trim().toLowerCase();
      const found = allShoeModels.find((name) => name.toLowerCase().includes(q));
      if (found) return found;
    }
    if (topRankings.products.byRevenue[0]?.name) {
      return topRankings.products.byRevenue[0].name;
    }
    return allShoeModels[0] ?? '';
  }, [allShoeModels, selectedShoeName, shoeSearchQuery, topRankings.products.byRevenue]);

  const shoeDetailReport = useMemo(() => {
    if (!activeShoeName) return null;
    const { now, start } = rangeWindow(timeRange, customStartDate, customEndDate);

    // Match the model exactly ("Kobe 6" must not pull in "Kobe 6 Protro"); fall back
    // to a partial match only when no product has exactly this name.
    const target = activeShoeName.toLowerCase();
    const exactMatches = productRows.filter((p: any) => String(p.product_name ?? '').trim().toLowerCase() === target);
    const useExactMatch = exactMatches.length > 0;
    const isSelectedModel = (name: string) => (useExactMatch ? name === target : name.includes(target));
    const matchingProducts = useExactMatch
      ? exactMatches
      : productRows.filter((p: any) => String(p.product_name ?? '').trim().toLowerCase().includes(target));

    const sampleProduct = matchingProducts[0];
    const brand = String(sampleProduct?.brand ?? 'Meryl Shoes').trim();
    const category = String(sampleProduct?.category?.[0]?.category_name ?? sampleProduct?.category?.category_name ?? 'Footwear').trim();
    const department = String(sampleProduct?.gender ?? 'Unisex').trim();
    // Selling price lives on the inventory row (srp), not on product.
    const sampleInventory = Array.isArray(sampleProduct?.inventory) ? sampleProduct.inventory[0] : sampleProduct?.inventory;
    const basePrice = Number(sampleInventory?.srp ?? sampleProduct?.price ?? sampleProduct?.cost_price ?? 0);
    const costPrice = Number(sampleProduct?.cost_price ?? 0);

    let totalStock = 0;
    const stockBySize = new Map<string, number>();
    matchingProducts.forEach((p: any) => {
      const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
      const onHand = Number(inv?.stock_quantity ?? p.stock ?? 0);
      const reserved = Number(inv?.reserved_quantity ?? inv?.held_stock ?? p.reserved_stock ?? 0);
      const available = Math.max(0, onHand - reserved);
      totalStock += available;
      const sizeStr = String(p.size ?? 'Standard').trim();
      stockBySize.set(sizeStr, (stockBySize.get(sizeStr) ?? 0) + available);
    });

    let totalPairs = 0;
    let totalRevenue = 0;
    let totalCost = 0;
    const sizesSold = new Map<string, { size: string; pairs: number; revenue: number }>();
    const variantsSold = new Map<string, { color: string; pairs: number; revenue: number }>();
    const transactions: Array<{
      date: Date;
      saleId: string;
      customer: string;
      size: string;
      color: string;
      qty: number;
      price: number;
      subtotal: number;
      payment: string;
    }> = [];

    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > now) return;

      const saleId = receiptNumberFor(sale, date);
      const customer = String(sale.customer_name ?? sale.customer?.name ?? 'Walk-in Customer');
      const payment = Array.isArray(sale.payment) ? sale.payment[0] : sale.payment;
      const rawPay = String(payment?.payment_method ?? sale.payment_method ?? 'Cash').toLowerCase();
      const payLabel = paymentLabel(rawPay);

      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const prod = productLookup.get(String(detail.product_id ?? '')) ?? detail.product;
        const prodName = String(prod?.product_name ?? detail.product_name ?? '').trim().toLowerCase();
        if (!isSelectedModel(prodName)) return;

        const qty = Number(detail.quantity ?? 0);
        const price = Number(detail.price ?? basePrice);
        const subtotal = Number(detail.subtotal ?? price * qty);
        const cost = Number(prod?.cost_price ?? costPrice) * qty;
        const sizeStr = String(prod?.size ?? detail.size ?? 'Standard').trim();
        const colorStr = String(prod?.color ?? detail.color ?? 'Standard Color').trim();

        totalPairs += qty;
        totalRevenue += subtotal;
        totalCost += cost;

        const prevSize = sizesSold.get(sizeStr) ?? { size: sizeStr, pairs: 0, revenue: 0 };
        prevSize.pairs += qty;
        prevSize.revenue += subtotal;
        sizesSold.set(sizeStr, prevSize);

        const prevVar = variantsSold.get(colorStr) ?? { color: colorStr, pairs: 0, revenue: 0 };
        prevVar.pairs += qty;
        prevVar.revenue += subtotal;
        variantsSold.set(colorStr, prevVar);

        transactions.push({
          date,
          saleId,
          customer,
          size: sizeStr,
          color: colorStr,
          qty,
          price,
          subtotal,
          payment: payLabel,
        });
      });
    });

    const profit = Math.max(0, totalRevenue - totalCost);
    const margin = totalRevenue > 0 ? Math.round((profit / totalRevenue) * 100) : (basePrice > 0 && costPrice > 0 ? Math.round(((basePrice - costPrice) / basePrice) * 100) : 0);
    const avgPrice = totalPairs > 0 ? Math.round(totalRevenue / totalPairs) : basePrice;

    const allSizesSet = new Set([...Array.from(stockBySize.keys()), ...Array.from(sizesSold.keys())]);
    const sizeBreakdown = Array.from(allSizesSet).sort(compareSizes).map((sz) => {
      const sold = sizesSold.get(sz) ?? { pairs: 0, revenue: 0 };
      const stock = stockBySize.get(sz) ?? 0;
      return {
        size: sz,
        pairs: sold.pairs,
        revenue: sold.revenue,
        stock,
        status: stock === 0 ? 'Out of Stock' : stock <= 3 ? 'Low Stock' : 'In Stock',
      };
    });

    const variantBreakdown = Array.from(variantsSold.values()).sort((a, b) => b.pairs - a.pairs);

    return {
      name: activeShoeName,
      brand,
      category,
      department,
      basePrice,
      costPrice,
      totalPairs,
      totalRevenue,
      profit,
      margin,
      avgPrice,
      totalStock,
      sizeBreakdown,
      variantBreakdown,
      transactions: transactions.sort((a, b) => b.date.getTime() - a.date.getTime()),
    };
  }, [activeShoeName, customEndDate, customStartDate, productLookup, productRows, salesRows, timeRange]);

  const brandDetailReport = useMemo(() => {
    const { now, start } = rangeWindow(timeRange, customStartDate, customEndDate);
    const activeBrand = brandFilter;

    const brandMap = new Map<string, {
      name: string;
      sales: number;
      revenue: number;
      cost: number;
      models: Map<string, { name: string; sales: number; revenue: number; stock: number; category: string; department: string }>;
      sizes: Map<string, number>;
      departments: Map<string, number>;
    }>();

    const brandStock = new Map<string, number>();
    productRows.forEach((p: any) => {
      const b = String(p.brand ?? 'Meryl Shoes').trim();
      const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
      const onHand = Number(inv?.stock_quantity ?? p.stock ?? 0);
      const reserved = Number(inv?.reserved_quantity ?? inv?.held_stock ?? p.reserved_stock ?? 0);
      brandStock.set(b, (brandStock.get(b) ?? 0) + Math.max(0, onHand - reserved));
    });

    let storeTotalRev = 0;
    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > now) return;

      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const prod = productLookup.get(String(detail.product_id ?? '')) ?? detail.product;
        const brand = String(prod?.brand ?? 'Meryl Shoes').trim();
        const prodName = String(prod?.product_name ?? detail.product_name ?? 'Unknown Shoe').trim();
        const cat = String(prod?.category?.[0]?.category_name ?? prod?.category?.category_name ?? 'Footwear').trim();
        const rawGender = String(prod?.gender ?? '').trim();
        const dept = !rawGender || rawGender.toLowerCase() === 'n/a' ? 'Unisex' : rawGender;
        const sizeStr = String(prod?.size ?? detail.size ?? 'Standard').trim();

        const qty = Number(detail.quantity ?? 0);
        const subtotal = Number(detail.subtotal ?? (Number(detail.price ?? 0) * qty));
        const cost = Number(prod?.cost_price ?? 0) * qty;
        storeTotalRev += subtotal;

        const br = brandMap.get(brand) ?? {
          name: brand,
          sales: 0,
          revenue: 0,
          cost: 0,
          models: new Map(),
          sizes: new Map(),
          departments: new Map(),
        };
        br.sales += qty;
        br.revenue += subtotal;
        br.cost += cost;

        const prevM = br.models.get(prodName) ?? {
          name: prodName,
          sales: 0,
          revenue: 0,
          stock: stockBySku.get(String(prod?.product_id ?? '')) ?? 0,
          category: cat,
          department: dept,
        };
        prevM.sales += qty;
        prevM.revenue += subtotal;
        br.models.set(prodName, prevM);

        br.sizes.set(sizeStr, (br.sizes.get(sizeStr) ?? 0) + qty);
        br.departments.set(dept, (br.departments.get(dept) ?? 0) + qty);
        brandMap.set(brand, br);
      });
    });

    const allBrandsList = Array.from(brandMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((b, idx) => ({
        ...b,
        rank: idx + 1,
        share: storeTotalRev > 0 ? Number(((b.revenue / storeTotalRev) * 100).toFixed(1)) : 0,
        margin: b.revenue > 0 ? Math.max(0, Math.round(((b.revenue - b.cost) / b.revenue) * 100)) : 0,
        avgPrice: b.sales > 0 ? Math.round(b.revenue / b.sales) : 0,
        stock: brandStock.get(b.name) ?? 0,
      }));

    const selectedBrandData = activeBrand !== 'all' ? brandMap.get(activeBrand) : null;
    const selectedBrandModels = selectedBrandData
      ? Array.from(selectedBrandData.models.values())
          .sort((a, b) => b.revenue - a.revenue)
          .map((m, idx) => ({
            ...m,
            rank: idx + 1,
            share: selectedBrandData.revenue > 0 ? Number(((m.revenue / selectedBrandData.revenue) * 100).toFixed(1)) : 0,
          }))
      : [];

    const selectedBrandSizes = selectedBrandData
      ? Array.from(selectedBrandData.sizes.entries())
          .map(([size, pairs]) => ({ size, pairs }))
          .sort((a, b) => b.pairs - a.pairs)
      : [];

    const selectedBrandDepts = selectedBrandData
      ? Array.from(selectedBrandData.departments.entries())
          .map(([dept, pairs]) => ({ dept, pairs }))
          .sort((a, b) => b.pairs - a.pairs)
      : [];

    return {
      activeBrand,
      allBrandsList,
      selectedBrandData: selectedBrandData
        ? {
            ...selectedBrandData,
            stock: brandStock.get(activeBrand) ?? 0,
            storeShare: storeTotalRev > 0 ? Number(((selectedBrandData.revenue / storeTotalRev) * 100).toFixed(1)) : 0,
            margin: selectedBrandData.revenue > 0 ? Math.max(0, Math.round(((selectedBrandData.revenue - selectedBrandData.cost) / selectedBrandData.revenue) * 100)) : 0,
          }
        : null,
      selectedBrandModels,
      selectedBrandSizes,
      selectedBrandDepts,
    };
  }, [brandFilter, customEndDate, customStartDate, productLookup, productRows, salesRows, stockBySku, timeRange]);

  const categoryDetailReport = useMemo(() => {
    const { now, start } = rangeWindow(timeRange, customStartDate, customEndDate);
    const catMap = new Map<string, { name: string; sales: number; revenue: number; models: Map<string, number>; brands: Map<string, number> }>();
    let totalRev = 0;

    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > now) return;

      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const prod = productLookup.get(String(detail.product_id ?? '')) ?? detail.product;
        const cat = String(prod?.category?.[0]?.category_name ?? prod?.category?.category_name ?? 'Footwear').trim();
        const brand = String(prod?.brand ?? 'Meryl Shoes').trim();
        const prodName = String(prod?.product_name ?? detail.product_name ?? 'Unknown Shoe').trim();
        const qty = Number(detail.quantity ?? 0);
        const subtotal = Number(detail.subtotal ?? (Number(detail.price ?? 0) * qty));
        totalRev += subtotal;

        const c = catMap.get(cat) ?? { name: cat, sales: 0, revenue: 0, models: new Map(), brands: new Map() };
        c.sales += qty;
        c.revenue += subtotal;
        c.models.set(prodName, (c.models.get(prodName) ?? 0) + qty);
        c.brands.set(brand, (c.brands.get(brand) ?? 0) + qty);
        catMap.set(cat, c);
      });
    });

    const allCategoriesList = Array.from(catMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((c, idx) => ({
        ...c,
        rank: idx + 1,
        share: totalRev > 0 ? Number(((c.revenue / totalRev) * 100).toFixed(1)) : 0,
        avgPrice: c.sales > 0 ? Math.round(c.revenue / c.sales) : 0,
      }));

    const selectedCat = categoryFilter !== 'all' ? catMap.get(categoryFilter) : null;
    const selectedCatModels = selectedCat
      ? Array.from(selectedCat.models.entries()).map(([name, pairs]) => ({ name, pairs })).sort((a, b) => b.pairs - a.pairs)
      : [];
    const selectedCatBrands = selectedCat
      ? Array.from(selectedCat.brands.entries()).map(([name, pairs]) => ({ name, pairs })).sort((a, b) => b.pairs - a.pairs)
      : [];

    return {
      allCategoriesList,
      selectedCat: selectedCat ? {
        ...selectedCat,
        storeShare: totalRev > 0 ? Number(((selectedCat.revenue / totalRev) * 100).toFixed(1)) : 0,
      } : null,
      selectedCatModels,
      selectedCatBrands,
    };
  }, [categoryFilter, customEndDate, customStartDate, productLookup, salesRows, timeRange]);

  const departmentDetailReport = useMemo(() => {
    const { now, start } = rangeWindow(timeRange, customStartDate, customEndDate);
    const deptMap = new Map<string, { name: string; sales: number; revenue: number; models: Map<string, number>; brands: Map<string, number> }>();
    let totalRev = 0;

    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > now) return;

      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const prod = productLookup.get(String(detail.product_id ?? '')) ?? detail.product;
        const rawGender = String(prod?.gender ?? '').trim();
        const dept = !rawGender || rawGender.toLowerCase() === 'n/a' ? 'Unisex' : rawGender;
        const brand = String(prod?.brand ?? 'Meryl Shoes').trim();
        const prodName = String(prod?.product_name ?? detail.product_name ?? 'Unknown Shoe').trim();
        const qty = Number(detail.quantity ?? 0);
        const subtotal = Number(detail.subtotal ?? (Number(detail.price ?? 0) * qty));
        totalRev += subtotal;

        const d = deptMap.get(dept) ?? { name: dept, sales: 0, revenue: 0, models: new Map(), brands: new Map() };
        d.sales += qty;
        d.revenue += subtotal;
        d.models.set(prodName, (d.models.get(prodName) ?? 0) + qty);
        d.brands.set(brand, (d.brands.get(brand) ?? 0) + qty);
        deptMap.set(dept, d);
      });
    });

    const allDeptsList = Array.from(deptMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((d, idx) => ({
        ...d,
        rank: idx + 1,
        share: totalRev > 0 ? Number(((d.revenue / totalRev) * 100).toFixed(1)) : 0,
        avgPrice: d.sales > 0 ? Math.round(d.revenue / d.sales) : 0,
      }));

    const selectedDept = departmentFilter !== 'all' ? deptMap.get(departmentFilter) : null;
    const selectedDeptModels = selectedDept
      ? Array.from(selectedDept.models.entries()).map(([name, pairs]) => ({ name, pairs })).sort((a, b) => b.pairs - a.pairs)
      : [];
    const selectedDeptBrands = selectedDept
      ? Array.from(selectedDept.brands.entries()).map(([name, pairs]) => ({ name, pairs })).sort((a, b) => b.pairs - a.pairs)
      : [];

    return {
      allDeptsList,
      selectedDept: selectedDept ? {
        ...selectedDept,
        storeShare: totalRev > 0 ? Number(((selectedDept.revenue / totalRev) * 100).toFixed(1)) : 0,
      } : null,
      selectedDeptModels,
      selectedDeptBrands,
    };
  }, [customEndDate, customStartDate, departmentFilter, productLookup, salesRows, timeRange]);

  const sizeDetailReport = useMemo(() => {
    const { now, start } = rangeWindow(timeRange, customStartDate, customEndDate);
    const sizeMap = new Map<string, { name: string; sales: number; revenue: number; models: Map<string, number>; brands: Map<string, number> }>();
    let totalRev = 0;
    let totalUnits = 0;

    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > now) return;

      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const prod = productLookup.get(String(detail.product_id ?? '')) ?? detail.product;
        const rawSize = String(prod?.size ?? detail.size ?? '').trim();
        const size = rawSize ? `Size ${rawSize}` : 'Standard';
        const brand = String(prod?.brand ?? 'Meryl Shoes').trim();
        const prodName = String(prod?.product_name ?? detail.product_name ?? 'Unknown Shoe').trim();
        const qty = Number(detail.quantity ?? 0);
        const subtotal = Number(detail.subtotal ?? (Number(detail.price ?? 0) * qty));
        totalRev += subtotal;
        totalUnits += qty;

        const s = sizeMap.get(size) ?? { name: size, sales: 0, revenue: 0, models: new Map(), brands: new Map() };
        s.sales += qty;
        s.revenue += subtotal;
        s.models.set(prodName, (s.models.get(prodName) ?? 0) + qty);
        s.brands.set(brand, (s.brands.get(brand) ?? 0) + qty);
        sizeMap.set(size, s);
      });
    });

    const allSizesList = Array.from(sizeMap.values())
      .sort((a, b) => b.sales - a.sales || b.revenue - a.revenue)
      .map((s, idx) => ({
        ...s,
        rank: idx + 1,
        share: totalRev > 0 ? Number(((s.revenue / totalRev) * 100).toFixed(1)) : 0,
        unitShare: totalUnits > 0 ? Number(((s.sales / totalUnits) * 100).toFixed(1)) : 0,
        avgPrice: s.sales > 0 ? Math.round(s.revenue / s.sales) : 0,
      }));

    const selectedSz = sizeFilter !== 'all' ? sizeMap.get(sizeFilter) : null;
    const selectedSzModels = selectedSz
      ? Array.from(selectedSz.models.entries()).map(([name, pairs]) => ({ name, pairs })).sort((a, b) => b.pairs - a.pairs)
      : [];

    return {
      allSizesList,
      selectedSz: selectedSz ? {
        ...selectedSz,
        unitShare: totalUnits > 0 ? Number(((selectedSz.sales / totalUnits) * 100).toFixed(1)) : 0,
      } : null,
      selectedSzModels,
    };
  }, [customEndDate, customStartDate, productLookup, salesRows, sizeFilter, timeRange]);

  const variantDetailReport = useMemo(() => {
    const { now, start } = rangeWindow(timeRange, customStartDate, customEndDate);
    const varMap = new Map<string, { name: string; sales: number; revenue: number; models: Map<string, number> }>();
    let totalRev = 0;
    let totalUnits = 0;

    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > now) return;

      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const prod = productLookup.get(String(detail.product_id ?? '')) ?? detail.product;
        const rawColor = String(prod?.color ?? detail.color ?? '').trim();
        const color = rawColor || 'Standard Color';
        const prodName = String(prod?.product_name ?? detail.product_name ?? 'Unknown Shoe').trim();
        const qty = Number(detail.quantity ?? 0);
        const subtotal = Number(detail.subtotal ?? (Number(detail.price ?? 0) * qty));
        totalRev += subtotal;
        totalUnits += qty;

        const v = varMap.get(color) ?? { name: color, sales: 0, revenue: 0, models: new Map() };
        v.sales += qty;
        v.revenue += subtotal;
        v.models.set(prodName, (v.models.get(prodName) ?? 0) + qty);
        varMap.set(color, v);
      });
    });

    const allVariantsList = Array.from(varMap.values())
      .sort((a, b) => b.sales - a.sales || b.revenue - a.revenue)
      .map((v, idx) => ({
        ...v,
        rank: idx + 1,
        share: totalRev > 0 ? Number(((v.revenue / totalRev) * 100).toFixed(1)) : 0,
        unitShare: totalUnits > 0 ? Number(((v.sales / totalUnits) * 100).toFixed(1)) : 0,
        avgPrice: v.sales > 0 ? Math.round(v.revenue / v.sales) : 0,
      }));

    const selectedVr = variantFilter !== 'all' ? varMap.get(variantFilter) : null;
    const selectedVrModels = selectedVr
      ? Array.from(selectedVr.models.entries()).map(([name, pairs]) => ({ name, pairs })).sort((a, b) => b.pairs - a.pairs)
      : [];

    return {
      allVariantsList,
      selectedVr: selectedVr ? {
        ...selectedVr,
        unitShare: totalUnits > 0 ? Number(((selectedVr.sales / totalUnits) * 100).toFixed(1)) : 0,
      } : null,
      selectedVrModels,
    };
  }, [customEndDate, customStartDate, productLookup, salesRows, timeRange, variantFilter]);

  const paymentDetailReport = useMemo(() => {
    const { now, start } = rangeWindow(timeRange, customStartDate, customEndDate);
    const payMap = new Map<string, { name: string; count: number; revenue: number; transactions: Array<{ date: Date; saleId: string; customer: string; total: number }> }>();
    let totalRev = 0;
    let totalTx = 0;

    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > now) return;

      const saleId = receiptNumberFor(sale, date);
      const customer = String(sale.customer_name ?? sale.customer?.name ?? 'Walk-in Customer');
      const payment = Array.isArray(sale.payment) ? sale.payment[0] : sale.payment;
      const rawPay = String(payment?.payment_method ?? sale.payment_method ?? 'Cash').toLowerCase();
      const payLabel = paymentLabel(rawPay);
      const totalAmount = Number(sale.total_amount ?? 0);
      totalRev += totalAmount;
      totalTx += 1;

      const p = payMap.get(payLabel) ?? { name: payLabel, count: 0, revenue: 0, transactions: [] };
      p.count += 1;
      p.revenue += totalAmount;
      p.transactions.push({ date, saleId, customer, total: totalAmount });
      payMap.set(payLabel, p);
    });

    const allPaymentsList = Array.from(payMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .map((p, idx) => ({
        ...p,
        rank: idx + 1,
        share: totalRev > 0 ? Number(((p.revenue / totalRev) * 100).toFixed(1)) : 0,
        txnShare: totalTx > 0 ? Number(((p.count / totalTx) * 100).toFixed(1)) : 0,
        avgTx: p.count > 0 ? Math.round(p.revenue / p.count) : 0,
      }));

    return {
      allPaymentsList,
      totalRevenue: totalRev,
      totalTransactions: totalTx,
    };
  }, [customEndDate, customStartDate, salesRows, timeRange]);

  const revenueByCategory = useMemo(() => {
    const { now, start, previousStart, previousEnd } = rangeWindow(timeRange, customStartDate, customEndDate);
    const current = new Map<string, number>();
    const previous = new Map<string, number>();
    const addSale = (sale: any, target: Map<string, number>) => {
      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const product = productLookup.get(String(detail.product_id ?? ''));
        const category = String(product?.category?.[0]?.category_name ?? product?.category?.category_name ?? 'Uncategorized');
        target.set(category, (target.get(category) ?? 0) + Number(detail.subtotal ?? 0));
      });
    };
    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date) return;
      if (date >= start && date <= now) addSale(sale, current);
      if (date >= previousStart && date <= previousEnd) addSale(sale, previous);
    });
    const total = Array.from(current.values()).reduce((sum, value) => sum + value, 0);
    return Array.from(current.entries())
      .map(([category, revenue], index) => {
        const prevRevenue = previous.get(category) ?? 0;
        return {
          id: `rc${index}`,
          category,
          revenue,
          percentage: total > 0 ? Math.round((revenue / total) * 100) : 0,
          growth: Number(percentChange(revenue, prevRevenue).toFixed(1)),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);
  }, [customEndDate, customStartDate, productLookup, salesRows, timeRange]);

  const categoryDistribution = useMemo(() => {
    const colors = ['#fef08a', '#facc15', '#fde047', '#fef9c3', '#fefce8', '#fcd34d'];
    const rows = revenueByCategory.map((item, index) => ({
      id: `cd${index}`,
      name: item.category,
      value: item.percentage,
      color: colors[index % colors.length],
    }));
    return rows.length ? rows : [{ id: 'cd-empty', name: 'No Sales', value: 100, color: '#fef9c3' }];
  }, [revenueByCategory]);

  // Sales Breakdown lays out fixed periods first (so periods without sales are
  // still listed), then fills them with sales:
  //   Daily -> each hour of the day      Weekly -> each of the last 26 weeks
  //   Monthly -> January-December        Quarterly -> Q1-Q4 of this year
  //   Annually -> the last 5 years       Custom -> each day (months/years if long)
  // Periods that have not started yet are marked upcoming instead of showing 0.
  const salesBreakdown = useMemo(() => {
    const now = new Date();
    const { slots, rangeLabel, unit } = buildBreakdownSlots(timeRange, customStartDate, customEndDate, now);

    const first = slots[0]?.start;
    const last = slots[slots.length - 1]?.end;
    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || !first || !last || date < first || date > last) return;
      const slot = slots.find((item) => date >= item.start && date <= item.end);
      if (!slot) return;
      slot.transactions += 1;
      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const qty = Number(detail.quantity ?? 0);
        const price = Number(detail.price ?? 0);
        const subtotal = Number(detail.subtotal ?? price * qty);
        const gross = price * qty;
        slot.pairs += qty;
        slot.gross += gross;
        slot.discount += Math.max(0, gross - subtotal);
        slot.net += subtotal;
      });
    });

    // Off-hours rows (before opening / after closing) appear only when they have sales.
    const rows = slots.filter((slot) => !slot.offHours || slot.transactions > 0).map((slot, index) => ({
      id: `breakdown-${index}`,
      date: slot.label,
      pairs: slot.pairs,
      gross: slot.gross,
      discount: slot.discount,
      net: slot.net,
      transactions: slot.transactions,
      hasSales: slot.transactions > 0,
      upcoming: slot.start > now,
    }));
    return { rows, rangeLabel, unit };
  }, [customEndDate, customStartDate, salesRows, timeRange]);

  const salesBreakdownRows = salesBreakdown.rows;

  const inventoryAnalytics = useMemo(() => {
    let totalStock = 0;
    let totalRetailValue = 0;
    let totalCostValue = 0;
    let outOfStockCount = 0;
    let criticalCount = 0;
    let reorderCount = 0;
    let optimalCount = 0;
    let overstockCount = 0;

    const brandStockMap = new Map<string, { name: string; pairs: number; value: number }>();
    const sizeStockMap = new Map<string, { name: string; pairs: number }>();

    const allRows = productRows.map((product: any) => {
      const inventory = Array.isArray(product.inventory) ? product.inventory[0] : product.inventory;
      const onHand = Number(inventory?.stock_quantity ?? product.stock ?? 0);
      const reserved = Number(inventory?.reserved_quantity ?? inventory?.held_stock ?? product.reserved_stock ?? 0);
      const stock = Math.max(0, onHand - reserved);
      const reorder = Number(inventory?.reorder_level ?? product.reorder_level ?? 10);

      // Price resolution: check inventory.srp, cost_price, unit_price, price
      const rawCostPrice = Number(product.cost_price ?? product.cost ?? 0);
      const rawUnitPrice = Number(inventory?.srp ?? product.unit_price ?? product.price ?? (rawCostPrice > 0 ? rawCostPrice : 0));
      const unitPrice = rawUnitPrice > 0 ? rawUnitPrice : (rawCostPrice > 0 ? rawCostPrice : 0);
      const costPrice = rawCostPrice > 0 ? rawCostPrice : (unitPrice > 0 ? unitPrice * 0.7 : 0);

      const brand = String(product.brand ?? 'Other').trim();
      const rawProductName = String(product.product_name ?? 'Product').trim();
      // Remove duplicate brand prefix if present (e.g. "Venus Venus Street Runner")
      const brandRegex = new RegExp(`^${brand}\\s*`, 'i');
      const modelName = rawProductName.replace(brandRegex, '').trim() || rawProductName;
      const name = `${brand} ${modelName}`.trim();

      const categoryObj = Array.isArray(product.category) ? product.category[0] : product.category;
      const category = String(categoryObj?.category_name ?? product.category_name ?? product.category ?? 'Footwear').trim();
      const department = String(product.gender ?? product.department ?? 'Unisex').trim();
      const size = String(product.size ?? 'N/A').trim();
      const color = String(product.color ?? 'N/A').trim();
      const rawSku = String(product.sku ?? product.product_id ?? '').trim();
      const sku = shortId(rawSku);
      const itemId = sku;

      const retailVal = stock * unitPrice;
      const costVal = stock * costPrice;

      totalStock += stock;
      totalRetailValue += retailVal;
      totalCostValue += costVal;

      let status = 'Optimal';
      if (stock === 0) {
        status = 'Out of Stock';
        outOfStockCount++;
      } else if (stock <= Math.max(2, Math.floor(reorder * 0.4))) {
        status = 'Critical';
        criticalCount++;
      } else if (stock <= reorder) {
        status = 'Reorder Required';
        reorderCount++;
      } else if (stock >= reorder * 3) {
        status = 'Overstock';
        overstockCount++;
      } else {
        status = 'Optimal';
        optimalCount++;
      }

      // Brand aggregation
      const brandEntry = brandStockMap.get(brand) ?? { name: brand, pairs: 0, value: 0 };
      brandEntry.pairs += stock;
      brandEntry.value += retailVal;
      brandStockMap.set(brand, brandEntry);

      // Size aggregation
      if (size && size !== 'N/A') {
        const sizeEntry = sizeStockMap.get(size) ?? { name: size, pairs: 0 };
        sizeEntry.pairs += stock;
        sizeStockMap.set(size, sizeEntry);
      }

      return {
        id: String(product.product_id ?? ''),
        sku,
        rawSku,
        itemId,
        name,
        modelName,
        brand,
        category,
        department,
        size,
        color,
        stock,
        reorder,
        unitPrice,
        costPrice,
        stockValue: retailVal,
        status,
      };
    });

    const totalProducts = productRows.length;
    const healthDistribution = [
      { name: 'Optimal Stock', count: optimalCount, color: '#10b981', share: totalProducts ? Math.round((optimalCount / totalProducts) * 100) : 0 },
      { name: 'Reorder Needed', count: reorderCount, color: '#f59e0b', share: totalProducts ? Math.round((reorderCount / totalProducts) * 100) : 0 },
      { name: 'Critical / Out', count: outOfStockCount + criticalCount, color: '#ef4444', share: totalProducts ? Math.round(((outOfStockCount + criticalCount) / totalProducts) * 100) : 0 },
      { name: 'Overstock', count: overstockCount, color: '#3b82f6', share: totalProducts ? Math.round((overstockCount / totalProducts) * 100) : 0 },
    ].filter((item) => item.count > 0);

    const brandList = Array.from(brandStockMap.values()).sort((a, b) => b.value - a.value).slice(0, 8);
    const sizeList = Array.from(sizeStockMap.values()).sort((a, b) => {
      const numA = parseFloat(a.name);
      const numB = parseFloat(b.name);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.name.localeCompare(b.name);
    });

    const brands = Array.from(new Set(allRows.map((r) => r.brand).filter(Boolean))).sort();
    const categories = Array.from(new Set(allRows.map((r) => r.category).filter(Boolean))).sort();
    const departments = Array.from(new Set(allRows.map((r) => r.department).filter(Boolean))).sort();
    const sizes = Array.from(new Set(allRows.map((r) => r.size).filter((s) => s && s !== 'N/A'))).sort((a, b) => {
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.localeCompare(b);
    });

    return {
      totalStock,
      totalRetailValue,
      totalCostValue,
      outOfStockCount,
      criticalCount,
      reorderCount,
      optimalCount,
      overstockCount,
      allRows,
      healthDistribution,
      brandList,
      sizeList,
      brands,
      categories,
      departments,
      sizes,
    };
  }, [productRows]);

  const inventoryStatusRows = useMemo(() => {
    return inventoryAnalytics.allRows.filter((item) => {
      // 1. Urgency status filter
      if (inventoryStatusFilter === 'critical') {
        if (item.status !== 'Critical' && item.status !== 'Out of Stock') return false;
      } else if (inventoryStatusFilter === 'reorder') {
        if (item.status !== 'Reorder Required') return false;
      } else if (inventoryStatusFilter === 'optimal') {
        if (item.status !== 'Optimal') return false;
      } else if (inventoryStatusFilter === 'overstock') {
        if (item.status !== 'Overstock') return false;
      }

      // 2. Brand filter
      if (inventoryBrandFilter !== 'all' && item.brand.toLowerCase() !== inventoryBrandFilter.toLowerCase()) {
        return false;
      }

      // 3. Category filter
      if (inventoryCategoryFilter !== 'all' && item.category.toLowerCase() !== inventoryCategoryFilter.toLowerCase()) {
        return false;
      }

      // 4. Department filter
      if (inventoryDeptFilter !== 'all' && item.department.toLowerCase() !== inventoryDeptFilter.toLowerCase()) {
        return false;
      }

      // 5. Size filter
      if (inventorySizeFilter !== 'all' && item.size.toLowerCase() !== inventorySizeFilter.toLowerCase()) {
        return false;
      }

      // 6. Search query filter
      if (inventorySearchQuery) {
        const q = inventorySearchQuery.toLowerCase().trim();
        const match =
          item.name.toLowerCase().includes(q) ||
          item.brand.toLowerCase().includes(q) ||
          item.modelName.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.department.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q) ||
          item.rawSku.toLowerCase().includes(q) ||
          item.itemId.toLowerCase().includes(q) ||
          item.color.toLowerCase().includes(q) ||
          item.size.toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
  }, [
    inventoryAnalytics.allRows,
    inventoryBrandFilter,
    inventoryCategoryFilter,
    inventoryDeptFilter,
    inventorySearchQuery,
    inventorySizeFilter,
    inventoryStatusFilter,
  ]);

  const totalInventoryPages = Math.max(1, Math.ceil(inventoryStatusRows.length / inventoryPageSize));
  const safeInventoryPage = Math.min(Math.max(1, inventoryCurrentPage), totalInventoryPages);

  const paginatedInventoryRows = useMemo(() => {
    const start = (safeInventoryPage - 1) * inventoryPageSize;
    return inventoryStatusRows.slice(start, start + inventoryPageSize);
  }, [inventoryStatusRows, safeInventoryPage, inventoryPageSize]);

  const isInventoryFiltering =
    inventoryStatusFilter !== 'all' ||
    inventoryBrandFilter !== 'all' ||
    inventoryCategoryFilter !== 'all' ||
    inventoryDeptFilter !== 'all' ||
    inventorySizeFilter !== 'all' ||
    Boolean(inventorySearchQuery.trim());

  const handleClearAllInventoryFilters = () => {
    setInventoryStatusFilter('all');
    setInventoryBrandFilter('all');
    setInventoryCategoryFilter('all');
    setInventoryDeptFilter('all');
    setInventorySizeFilter('all');
    setInventorySearchQuery('');
    setInventoryCurrentPage(1);
  };

  const businessSummary = useMemo(() => {
    const { now, start } = rangeWindow(timeRange, customStartDate, customEndDate);
    const brandSales = new Map<string, number>();
    const sizeSales = new Map<string, number>();
    let grossRevenue = 0;
    let discounts = 0;

    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > now) return;
      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const product = productLookup.get(String(detail.product_id ?? '')) ?? detail.product;
        const qty = Number(detail.quantity ?? 0);
        const brand = String(product?.brand ?? 'N/A');
        const size = String(product?.size ?? 'N/A');
        const gross = Number(detail.price ?? 0) * qty;
        const subtotal = Number(detail.subtotal ?? gross);
        brandSales.set(brand, (brandSales.get(brand) ?? 0) + qty);
        sizeSales.set(size, (sizeSales.get(size) ?? 0) + qty);
        grossRevenue += gross;
        discounts += Math.max(0, gross - subtotal);
      });
    });

    const bestBrand = Array.from(brandSales.entries()).sort((a, b) => b[1] - a[1])[0];
    const bestSize = Array.from(sizeSales.entries()).sort((a, b) => b[1] - a[1])[0];
    const atv = currentMetrics.current.transactions
      ? currentMetrics.current.revenue / currentMetrics.current.transactions
      : 0;
    const discountRate = grossRevenue > 0 ? (discounts / grossRevenue) * 100 : 0;

    return {
      period: formatDateRange(start, now),
      store: 'Araneta Ave, Bacolod, 6100 Negros Occidental',
      preparedBy: user?.name || user?.username || 'Store Manager',
      atv,
      bestBrandName: bestBrand?.[0] ?? 'N/A',
      bestBrandUnits: bestBrand?.[1] ?? 0,
      bestBrand: bestBrand ? `${bestBrand[0]} (${bestBrand[1]} pairs)` : 'N/A',
      bestSize: bestSize ? `${bestSize[0]} (${bestSize[1]} pairs)` : 'N/A',
      grossRevenue,
      discounts,
      discountRate,
      netSales: Math.max(0, grossRevenue - discounts),
    };
  }, [currentMetrics, customEndDate, customStartDate, productLookup, salesRows, timeRange, user?.name, user?.username]);

  /**
   * Promotional performance report (manuscript Use Case 10 goal; Figure 10
   * "evaluating promotion performance"; Table 29 target_sales_goal).
   * Sales in the selected period per promotion, plus progress of the whole
   * campaign toward its target sales goal.
   */
  const promotionReport = useMemo(() => {
    const promos = ((promotionsQuery.data as any[]) ?? []).filter((row) => row?.promo_id);
    const { now, start } = rangeWindow(timeRange, customStartDate, customEndDate);
    type Stat = { sales: Set<string>; pairs: number; net: number; gross: number; discount: number; campaignNet: number };
    const stats = new Map<string, Stat>();
    const statFor = (id: string) => {
      const existing = stats.get(id);
      if (existing) return existing;
      const created: Stat = { sales: new Set(), pairs: 0, net: 0, gross: 0, discount: 0, campaignNet: 0 };
      stats.set(id, created);
      return created;
    };

    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date) return;
      const inRange = date >= start && date <= now;
      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const product = productLookup.get(String(detail.product_id ?? '')) ?? detail.product;
        const qty = Number(detail.quantity ?? 0);
        const gross = Number(detail.price ?? 0) * qty;
        const net = Number(detail.subtotal ?? gross);
        const discountPercent = Number(detail.discount_applied ?? 0) || (gross > 0 ? ((gross - net) / gross) * 100 : 0);
        const promoId = attributeSaleLine(
          {
            promoId: detail.promo_id ? String(detail.promo_id) : null,
            discountPercent,
            productNameLower: String(product?.product_name ?? '').trim().toLowerCase(),
            categoryLower: String(product?.category?.[0]?.category_name ?? product?.category?.category_name ?? '').trim().toLowerCase(),
            saleMs: date.getTime(),
          },
          promos,
        );
        if (!promoId) return;
        const stat = statFor(promoId);
        stat.campaignNet += net;
        if (!inRange) return;
        stat.sales.add(String(sale.sales_id ?? ''));
        stat.pairs += qty;
        stat.net += net;
        stat.gross += gross;
        stat.discount += Math.max(0, gross - net);
      });
    });

    const nowMs = Date.now();
    const dateLabel = (ms: number) =>
      Number.isFinite(ms) ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
    const rows = promos
      .map((row) => {
        const startMs = promotionBoundaryMs(row.start_date, 'start');
        const endMs = promotionBoundaryMs(row.end_date, 'end');
        const stat = stats.get(String(row.promo_id));
        const overlaps = startMs <= now.getTime() && endMs >= start.getTime();
        if (!overlaps && !stat?.sales.size) return null;
        const kind = promotionKind(row);
        const value = Number(row.discount_value ?? 0);
        const rawStatus = String(row.status ?? '').toLowerCase();
        const status = rawStatus === 'inactive' || rawStatus === 'deactivated'
          ? 'Paused'
          : endMs < nowMs ? 'Ended' : startMs > nowMs ? 'Upcoming' : 'Active';
        const goal = Number(row.target_sales_goal ?? 0);
        const campaignNet = stat?.campaignNet ?? 0;
        return {
          id: String(row.promo_id),
          name: promotionDisplayName(row),
          offer: kind === 'percentage' ? `${value}% off` : kind === 'fixed' ? `PHP ${value.toLocaleString()} off` : kind === 'bogo' ? 'Buy 1 Get 1' : `Bundle ${value >= 5 ? value : 10}%`,
          window: `${dateLabel(startMs)} – ${dateLabel(endMs)}`,
          status,
          transactions: stat?.sales.size ?? 0,
          pairs: stat?.pairs ?? 0,
          net: stat?.net ?? 0,
          discount: stat?.discount ?? 0,
          goal,
          campaignNet,
          progress: goal > 0 ? (campaignNet / goal) * 100 : 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));

    return {
      rows,
      totalNet: rows.reduce((sum, row) => sum + row.net, 0),
      totalDiscount: rows.reduce((sum, row) => sum + row.discount, 0),
      totalPairs: rows.reduce((sum, row) => sum + row.pairs, 0),
      metGoal: rows.filter((row) => row.goal > 0 && row.progress >= 100).length,
      withGoal: rows.filter((row) => row.goal > 0).length,
    };
  }, [customEndDate, customStartDate, productLookup, promotionsQuery.data, salesRows, timeRange]);

  /**
   * Suggested actions for the selected period, derived from sales and stock:
   * what to restock, what is not moving, and where revenue is going.
   */
  const suggestions = useMemo(() => {
    type Suggestion = { tone: 'urgent' | 'warning' | 'info' | 'good'; title: string; detail: string };
    const items: Suggestion[] = [];
    const { now, start } = rangeWindow(timeRange, customStartDate, customEndDate);
    const today = endOfDay(new Date());
    const effectiveEnd = now < today ? now : today;
    const periodDays = Math.max(1, Math.round((startOfDay(effectiveEnd).getTime() - startOfDay(start).getTime()) / 86400000) + 1);

    const unitsSold = new Map<string, number>();
    const salesDays = new Set<string>();
    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > effectiveEnd) return;
      salesDays.add(localDayKey(date));
      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const id = String(detail.product_id ?? '');
        unitsSold.set(id, (unitsSold.get(id) ?? 0) + Number(detail.quantity ?? 0));
      });
    });
    const describe = (row: { name: string; color: string; size: string }) =>
      [row.name, row.color !== 'N/A' ? row.color : '', row.size !== 'N/A' ? `Size ${row.size}` : ''].filter(Boolean).join(' · ');

    // 1. Selling items that are running out.
    const restock = inventoryAnalytics.allRows
      .filter((row) => (row.status === 'Out of Stock' || row.status === 'Critical' || row.status === 'Reorder Required') && (unitsSold.get(row.id) ?? 0) > 0)
      .sort((a, b) => (unitsSold.get(b.id) ?? 0) - (unitsSold.get(a.id) ?? 0) || a.stock - b.stock)
      .slice(0, 3);
    restock.forEach((row) => {
      items.push({
        tone: row.stock === 0 ? 'urgent' : 'warning',
        title: row.stock === 0 ? `Restock now: ${describe(row)}` : `Reorder soon: ${describe(row)}`,
        detail: `${row.stock} left (reorder at ${row.reorder}) after selling ${unitsSold.get(row.id)} this period.`,
      });
    });

    // 2. Stock that is not moving.
    if (periodDays >= 7) {
      const idle = inventoryAnalytics.allRows.filter((row) => row.stock >= Math.max(5, row.reorder * 2) && !(unitsSold.get(row.id) ?? 0));
      if (idle.length) {
        const idleValue = idle.reduce((sum, row) => sum + row.stockValue, 0);
        const examples = [...idle].sort((a, b) => b.stockValue - a.stockValue).slice(0, 2).map(describe).join('; ');
        items.push({
          tone: 'info',
          title: `${idle.length} stocked item${idle.length === 1 ? '' : 's'} had no sales this period`,
          detail: `${money(idleValue)} of inventory is not moving (e.g. ${examples}). Consider a promotion or display change.`,
        });
      }
    }

    // 3. Revenue direction vs the same point last period.
    const { revenue, transactions } = currentMetrics.current;
    const previousRevenue = currentMetrics.previous.revenue;
    if (previousRevenue > 0) {
      const change = percentChange(revenue, previousRevenue);
      if (change <= -20) {
        items.push({ tone: 'warning', title: `Revenue is down ${Math.abs(change).toFixed(0)}% vs the same point last period`, detail: `${money(revenue)} now vs ${money(previousRevenue)} then. Check stock-outs and consider a promotion.` });
      } else if (change >= 20) {
        items.push({ tone: 'good', title: `Revenue is up ${change.toFixed(0)}% vs the same point last period`, detail: `${money(revenue)} now vs ${money(previousRevenue)} then. Make sure best sellers stay in stock.` });
      }
    }

    // 4. Best seller and best size to prioritize when reordering.
    const bestProduct = topRankings.products.byUnits[0];
    if (bestProduct && bestProduct.sales > 0) {
      const share = revenue > 0 ? Math.round((bestProduct.revenue / revenue) * 100) : 0;
      items.push({ tone: 'good', title: `Best seller: ${bestProduct.name}`, detail: `${bestProduct.sales} pairs sold${share ? `, ${share}% of revenue` : ''}. Keep its popular sizes in stock.` });
    }
    const bestSize = topRankings.size.byUnits[0];
    if (bestSize && bestSize.sales > 0) {
      items.push({ tone: 'info', title: `${bestSize.name} is the most requested size`, detail: `${bestSize.sales} pairs sold. Prioritize it when reordering.` });
    }

    // 5. Discounts eating into sales.
    if (businessSummary.discountRate >= 15) {
      items.push({ tone: 'warning', title: `Discounts took ${businessSummary.discountRate.toFixed(0)}% of gross sales`, detail: `${money(businessSummary.discounts)} given away. Review which promotions are still worth running.` });
    }

    // 6. Days without sales.
    if (periodDays >= 7) {
      const quietDays = periodDays - salesDays.size;
      if (quietDays > 0) {
        items.push({ tone: 'info', title: `${quietDays} of ${periodDays} days had no sales`, detail: 'See Reports → Sales for the day-by-day list; quiet days may suit promotions or staff scheduling.' });
      }
    }

    if (!transactions) {
      items.unshift({ tone: 'info', title: 'No completed sales in this period', detail: 'Pick a longer date range to get sales-based suggestions.' });
    }

    const order = { urgent: 0, warning: 1, good: 2, info: 3 } as const;
    return items.sort((a, b) => order[a.tone] - order[b.tone]).slice(0, 7);
  }, [businessSummary, currentMetrics, customEndDate, customStartDate, inventoryAnalytics.allRows, salesRows, timeRange, topRankings]);

  const summarizeSkuTurnover = (unitsBySku: Map<string, number>, periodDays: number) => {
    let units = 0;
    let avgInventory = 0;
    unitsBySku.forEach((soldUnits, sku) => {
      const endingStock = stockBySku.get(sku) ?? 0;
      const beginningStock = endingStock + soldUnits;
      units += soldUnits;
      avgInventory += (beginningStock + endingStock) / 2;
    });
    const turnover = avgInventory > 0 ? Number((units / avgInventory).toFixed(2)) : 0;
    const avgDays = turnover > 0 ? Math.max(1, Math.round(periodDays / turnover)) : 0;
    return { units, avgInventory, turnover, avgDays };
  };

  const inventoryTurnover = useMemo(() => {
    const { end, mode, start } = salesTrendFrame(timeRange, customStartDate, customEndDate);
    const buckets: Array<{ start: Date; end: Date; unitsBySku: Map<string, number> }> = [];

    let cursor = bucketStartForDate(start, mode);
    while (cursor <= end) {
      const periodStart = new Date(cursor);
      const nextStart = nextBucketStart(periodStart, mode);
      const periodEnd = new Date(nextStart);
      periodEnd.setMilliseconds(periodEnd.getMilliseconds() - 1);
      buckets.push({
        start: periodStart < start ? new Date(start) : periodStart,
        end: periodEnd > end ? new Date(end) : periodEnd,
        unitsBySku: new Map<string, number>(),
      });
      cursor = nextStart;
    }

    salesRows.forEach((sale) => {
      const date = saleDate(sale);
      if (!date || date < start || date > end) return;
      const bucket = buckets.find((item) => date >= item.start && date <= item.end);
      if (!bucket) return;
      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const sku = String(detail.product_id ?? '');
        bucket.unitsBySku.set(sku, (bucket.unitsBySku.get(sku) ?? 0) + Number(detail.quantity ?? 0));
      });
    });

    return buckets.map((bucket, index) => {
      const bucketSpanDays = Math.max(1, Math.ceil((bucket.end.getTime() - bucket.start.getTime()) / 86400000) + 1);
      const { units, turnover, avgDays } = summarizeSkuTurnover(bucket.unitsBySku, bucketSpanDays);
      return {
        id: `it${index}`,
        month: trendBucketLabel(bucket.start, mode),
        units,
        turnover,
        avgDays,
      };
    });
  }, [customEndDate, customStartDate, salesRows, stockBySku, timeRange]);

  const handleExportReport = () => {
    const reportNames: Record<string, string> = {
      overview: 'Executive Overview Report',
      sales: 'Sales Breakdown Report',
      rankings: 'Top 5 Product Rankings',
      specific_category_all: 'Specific & Category Performance Report (All-in-One)',
      products: `Shoe Model Report - ${shoeDetailReport?.name || 'All Models'}`,
      brands: `Brand Performance Report - ${brandFilter === 'all' ? 'All Brands' : brandFilter}`,
      categories: `Category Report - ${categoryFilter === 'all' ? 'All Categories' : categoryFilter}`,
      departments: `Department Report - ${departmentFilter === 'all' ? 'All Departments' : departmentFilter}`,
      sizes: `Size Distribution Report - ${sizeFilter === 'all' ? 'All Sizes' : sizeFilter}`,
      variants: `Variant Color Report - ${variantFilter === 'all' ? 'All Colors' : variantFilter}`,
      payments: 'Payment Method Report',
      promotions: 'Promotion Performance Report',
      revenue: 'Revenue by Category Report',
      inventory: 'Inventory & Stock Report',
    };
    const generatedAt = new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
    const sanitize = (value: unknown) => String(value ?? '')
      .normalize('NFKD')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const pdfEscape = (value: unknown) => sanitize(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    const pages: string[][] = [[]];
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 40;
    let y = pageHeight - margin;
    const current = () => pages[pages.length - 1];
    const add = (command: string) => current().push(command);
    const ensureSpace = (height: number) => {
      if (y - height >= margin) return;
      pages.push([]);
      y = pageHeight - margin;
      drawHeader(false);
    };
    const text = (value: unknown, x: number, textY: number, size = 10, bold = false, color = '0 0 0') => {
      add(`q ${color} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${textY} Td (${pdfEscape(value)}) Tj ET Q`);
    };
    const rect = (x: number, rectY: number, width: number, height: number, fill = '1 1 1', stroke = '0.85 0.85 0.85') => {
      add(`q ${fill} rg ${stroke} RG ${x} ${rectY} ${width} ${height} re B Q`);
    };
    const line = (x1: number, y1: number, x2: number, y2: number, color = '0.96 0.78 0.08') => {
      add(`q ${color} RG 2 w ${x1} ${y1} m ${x2} ${y2} l S Q`);
    };
    const truncate = (value: unknown, max: number) => {
      const clean = sanitize(value);
      return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean;
    };
    const maxCharsForWidth = (width: number, size = 10) => Math.max(4, Math.floor(width / (size * 0.56)));
    const wrapText = (value: unknown, maxChars: number, maxLines = 2) => {
      const clean = sanitize(value);
      if (!clean) return [''];
      const words = clean.split(' ');
      const lines: string[] = [];
      let currentLine = '';

      words.forEach((word) => {
        const nextLine = currentLine ? `${currentLine} ${word}` : word;
        if (nextLine.length <= maxChars) {
          currentLine = nextLine;
          return;
        }
        if (currentLine) lines.push(currentLine);
        currentLine = word.length > maxChars ? truncate(word, maxChars) : word;
      });
      if (currentLine) lines.push(currentLine);

      if (lines.length <= maxLines) return lines;
      const visible = lines.slice(0, maxLines);
      visible[maxLines - 1] = truncate(visible[maxLines - 1], maxChars);
      return visible;
    };
    const drawHeader = (full = true) => {
      if (full) {
        text('MERYL SHOES', margin, y, 10, true, '0.55 0.42 0');
        y -= 22;
        text(reportNames[reportType] ?? 'Meryl Shoes Report', margin, y, 24, true);
        y -= 16;
        text('Araneta Ave, Bacolod, 6100 Negros Occidental', margin, y, 10, false, '0.25 0.25 0.25');
        y -= 18;
      } else {
        text(reportNames[reportType] ?? 'Meryl Shoes Report', margin, y, 10, true, '0.35 0.35 0.35');
        y -= 18;
      }
      line(margin, y, pageWidth - margin, y);
      y -= 18;
    };
    const drawMetric = (label: string, value: string, x: number, metricY: number, width: number) => {
      rect(x, metricY - 52, width, 52, '0.98 0.98 0.98');
      text(truncate(label.toUpperCase(), maxCharsForWidth(width - 16, 7)), x + 8, metricY - 18, 7, true, '0.45 0.45 0.45');
      const lines = wrapText(value, maxCharsForWidth(width - 16, 12), 2);
      const valueSize = lines.length > 1 ? 10 : 13;
      lines.forEach((lineValue, index) => {
        text(lineValue, x + 8, metricY - 35 - (index * 12), valueSize, true);
      });
    };
    const drawMetricGrid = (items: Array<[string, string]>) => {
      ensureSpace(70);
      const gap = 8;
      const width = (pageWidth - margin * 2 - gap * 3) / 4;
      const top = y;
      items.slice(0, 4).forEach(([label, value], index) => {
        drawMetric(label, value, margin + index * (width + gap), top, width);
      });
      y -= 68;
    };
    const drawTitle = (title: string) => {
      ensureSpace(30);
      text(title, margin, y, 14, true);
      y -= 14;
    };
    const drawTable = (headers: string[], rows: Array<Array<unknown>>, widths?: number[]) => {
      const tableWidth = pageWidth - margin * 2;
      const columnWidths = widths ?? headers.map(() => tableWidth / headers.length);
      const rowHeight = 23;
      ensureSpace(rowHeight * 2);
      rect(margin, y - rowHeight, tableWidth, rowHeight, '0.12 0.12 0.15', '0.12 0.12 0.15');
      let x = margin;
      headers.forEach((header, index) => {
        text(truncate(header, maxCharsForWidth((columnWidths[index] ?? 60) - 10, 8)), x + 5, y - 15, 8, true, '1 1 1');
        x += columnWidths[index];
      });
      y -= rowHeight;
      const bodyRows = rows.length ? rows : [['No records found for this date range.']];
      bodyRows.forEach((row) => {
        ensureSpace(rowHeight + 4);
        rect(margin, y - rowHeight, tableWidth, rowHeight, '1 1 1');
        let cellX = margin;
        if (row.length === 1) {
          text(row[0], cellX + 5, y - 15, 8, false, '0.4 0.4 0.4');
        } else {
          row.forEach((cell, index) => {
            text(truncate(cell, maxCharsForWidth((columnWidths[index] ?? 60) - 10, 8)), cellX + 5, y - 15, 8);
            cellX += columnWidths[index] ?? 60;
          });
        }
        y -= rowHeight;
      });
      y -= 16;
    };

    drawHeader();
    drawMetricGrid([
      ['Date Range', selectedRangeLabel],
      ['Revenue', money(currentMetrics.current.revenue)],
      ['Units Sold', currentMetrics.current.units.toLocaleString()],
      ['Generated', generatedAt],
    ]);
    drawMetricGrid([
      ['Inventory Turnover', `${latestTurnover.toFixed(2)}x`],
      ['Avg Days to Sell', String(latestAvgDays || 0)],
      ['Transactions', currentMetrics.current.transactions.toLocaleString()],
      ['Report Type', reportNames[reportType] ?? 'Report'],
    ]);

    if (reportType === 'overview') {
      drawTitle('Executive Snapshot');
      drawTable(['Summary Item', 'Value'], [
        ['Average Transaction Value', money(businessSummary.atv)],
        ['Discount Pressure', `${businessSummary.discountRate.toFixed(1)}% (${money(businessSummary.discounts)})`],
        ['Best Brand', `${businessSummary.bestBrandName} (${businessSummary.bestBrandUnits} pairs)`],
        ['Top Product', topProducts[0] ? `${topProducts[0].name} (${topProducts[0].sales} units)` : 'N/A'],
        ['Gross Sales Before Discounts', money(businessSummary.grossRevenue)],
        ['Net After Discounts', money(businessSummary.netSales)],
      ], [250, 265]);
      if (suggestions.length) {
        drawTitle('Suggested Actions');
        // Title and detail on separate rows; PDF table cells truncate rather than wrap.
        drawTable(['Priority', 'Suggestion'], suggestions.flatMap((item) => [
          [{ urgent: 'Urgent', warning: 'Attention', good: 'Opportunity', info: 'Insight' }[item.tone], item.title],
          ['', item.detail],
        ]), [90, 425]);
      }
      drawTitle('Sales Trend');
      drawTable(['Period', 'Units Sold', 'Revenue', 'Customers'], filteredSalesTrends.map((row) => [row.date, row.sales, money(row.revenue), row.customers]));
    } else if (reportType === 'sales') {
      drawTitle(`Sales Breakdown - ${salesBreakdown.rangeLabel}`);
      drawTable(['Period', 'Transactions', 'Pairs Sold', 'Gross Revenue', 'Discount', 'Net Sales'], salesBreakdownRows.filter((row) => !row.upcoming).map((row) => [row.date, row.transactions, row.pairs, money(row.gross), money(row.discount), money(row.net)]), [125, 70, 65, 90, 75, 90]);
    } else if (reportType === 'rankings') {
      drawTitle('Top 5 Shoe Models');
      drawTable(['Rank', 'Shoe Model', 'Pairs', 'Revenue'], topRankings.products.byRevenue.map((row) => [`#${row.rank}`, row.name, `${row.sales}`, money(row.revenue)]), [40, 240, 65, 170]);
      drawTitle('Top 5 Brands');
      drawTable(['Rank', 'Brand', 'Pairs', 'Revenue'], topRankings.brand.byRevenue.map((row) => [`#${row.rank}`, row.name, `${row.sales}`, money(row.revenue)]), [40, 240, 65, 170]);
      drawTitle('Top 5 Sizes');
      drawTable(['Rank', 'Size', 'Pairs', 'Revenue'], topRankings.size.byUnits.map((row) => [`#${row.rank}`, row.name, `${row.sales}`, money(row.revenue)]), [40, 240, 65, 170]);
      drawTitle('Top 5 Variants (Colors)');
      drawTable(['Rank', 'Variant / Color', 'Pairs', 'Revenue'], topRankings.variant.byRevenue.map((row) => [`#${row.rank}`, row.name, `${row.sales}`, money(row.revenue)]), [40, 240, 65, 170]);
      drawTitle('Top 5 Departments');
      drawTable(['Rank', 'Department', 'Pairs', 'Revenue'], topRankings.gender.byRevenue.map((row) => [`#${row.rank}`, row.name, `${row.sales}`, money(row.revenue)]), [40, 240, 65, 170]);
      drawTitle('Top 5 Payment Methods');
      drawTable(['Rank', 'Payment Method', 'Transactions', 'Revenue'], topRankings.payment.byRevenue.map((row) => [`#${row.rank}`, row.name, `${row.sales}`, money(row.revenue)]), [40, 240, 65, 170]);
    } else if (reportType === 'products') {
      if (shoeDetailReport) {
        drawTitle(`Shoe Model: ${shoeDetailReport.name}`);
        drawTable(['Property', 'Details'], [
          ['Brand', shoeDetailReport.brand],
          ['Category', shoeDetailReport.category],
          ['Department', shoeDetailReport.department],
          ['Selling Price', money(shoeDetailReport.basePrice)],
          ['Pairs Sold (in period)', `${shoeDetailReport.totalPairs} pairs`],
          ['Gross Revenue', money(shoeDetailReport.totalRevenue)],
          ['Estimated Profit', `${money(shoeDetailReport.profit)} (${shoeDetailReport.margin}% margin)`],
          ['Total Available Stock', `${shoeDetailReport.totalStock} pairs on hand`],
        ], [200, 315]);
        drawTitle('Size Performance for this Model');
        drawTable(['Size', 'Pairs Sold', 'Revenue', 'Available Stock', 'Stock Status'], shoeDetailReport.sizeBreakdown.map((s) => [s.size, String(s.pairs), money(s.revenue), String(s.stock), s.status]), [70, 90, 140, 110, 105]);
        if (shoeDetailReport.variantBreakdown.length > 0) {
          drawTitle('Colorways / Variants for this Model');
          drawTable(['Colorway / Style', 'Pairs Sold', 'Revenue'], shoeDetailReport.variantBreakdown.map((v) => [v.color, String(v.pairs), money(v.revenue)]), [220, 145, 150]);
        }
      }
    } else if (reportType === 'specific_category_all') {
      drawTitle('Specific Shoe Model Performance');
      if (shoeDetailReport) {
        drawTable(['Metric', 'Value'], [
          ['Selected Shoe Model', shoeDetailReport.name],
          ['Brand / Category / Dept', `${shoeDetailReport.brand} • ${shoeDetailReport.category} • ${shoeDetailReport.department}`],
          ['Pairs Sold & Revenue', `${shoeDetailReport.totalPairs} pairs • ${money(shoeDetailReport.totalRevenue)}`],
          ['Profit & Gross Margin', `${money(shoeDetailReport.profit)} (${shoeDetailReport.margin}% margin)`],
          ['Current Stock on Hand', `${shoeDetailReport.totalStock} pairs`],
        ], [200, 315]);
        drawTitle('Shoe Size Breakdown');
        drawTable(['Size (EU)', 'Pairs Sold', 'Revenue', 'Stock', 'Status'], shoeDetailReport.sizeBreakdown.map((s) => [s.size, String(s.pairs), money(s.revenue), String(s.stock), s.status]), [70, 90, 140, 105, 110]);
      }

      ensureSpace(40);
      drawTitle('Brand Performance Comparison');
      drawTable(['Rank', 'Brand', 'Pairs Sold', 'Total Revenue', 'Revenue Share', 'Stock'], brandDetailReport.allBrandsList.map((b) => [`#${b.rank}`, b.name, String(b.sales), money(b.revenue), `${b.share}%`, String(b.stock)]), [40, 160, 75, 95, 75, 70]);

      ensureSpace(40);
      drawTitle('Category Performance');
      drawTable(['Rank', 'Category', 'Pairs Sold', 'Revenue', 'Revenue Share', 'Avg Price'], categoryDetailReport.allCategoriesList.map((c) => [`#${c.rank}`, c.name, String(c.sales), money(c.revenue), `${c.share}%`, money(c.avgPrice)]), [40, 160, 75, 95, 75, 70]);

      ensureSpace(40);
      drawTitle('Department Performance');
      drawTable(['Rank', 'Department', 'Pairs Sold', 'Revenue', 'Revenue Share', 'Avg Price'], departmentDetailReport.allDeptsList.map((d) => [`#${d.rank}`, d.name, String(d.sales), money(d.revenue), `${d.share}%`, money(d.avgPrice)]), [40, 160, 75, 95, 75, 70]);

      ensureSpace(40);
      drawTitle('Size Distribution Performance');
      drawTable(['Rank', 'Shoe Size', 'Pairs Sold', 'Revenue', 'Volume Share', 'Avg Price'], sizeDetailReport.allSizesList.map((s) => [`#${s.rank}`, s.name, String(s.sales), money(s.revenue), `${s.unitShare}%`, money(s.avgPrice)]), [40, 160, 75, 95, 75, 70]);

      ensureSpace(40);
      drawTitle('Variant & Colorway Performance');
      drawTable(['Rank', 'Variant / Color', 'Pairs Sold', 'Revenue', 'Revenue Share', 'Avg Price'], variantDetailReport.allVariantsList.map((v) => [`#${v.rank}`, v.name, String(v.sales), money(v.revenue), `${v.share}%`, money(v.avgPrice)]), [40, 160, 75, 95, 75, 70]);

      ensureSpace(40);
      drawTitle('Payment Method Performance');
      drawTable(['Rank', 'Payment Method', 'Transactions', 'Total Collected', 'Txn Share', 'Revenue Share'], paymentDetailReport.allPaymentsList.map((p) => [`#${p.rank}`, p.name, String(p.count), money(p.revenue), `${p.txnShare}%`, `${p.share}%`]), [40, 150, 80, 95, 75, 75]);
    } else if (reportType === 'brands') {
      if (brandDetailReport.activeBrand !== 'all' && brandDetailReport.selectedBrandData) {
        drawTitle(`Brand Performance: ${brandDetailReport.activeBrand}`);
        drawTable(['Metric', 'Value'], [
          ['Total Pairs Sold', `${brandDetailReport.selectedBrandData.sales} pairs`],
          ['Total Revenue', money(brandDetailReport.selectedBrandData.revenue)],
          ['Share of Store Revenue', `${brandDetailReport.selectedBrandData.storeShare}%`],
          ['Available Stock on Hand', `${brandDetailReport.selectedBrandData.stock} pairs`],
        ], [250, 265]);
        drawTitle('Shoe Models Under This Brand');
        drawTable(['Rank', 'Shoe Model', 'Category', 'Pairs Sold', 'Revenue', 'Share'], brandDetailReport.selectedBrandModels.map((m) => [`#${m.rank}`, m.name, m.category, String(m.sales), money(m.revenue), `${m.share}%`]), [40, 180, 100, 65, 80, 50]);
      } else {
        drawTitle('All Brand Performance Comparison');
        drawTable(['Rank', 'Brand', 'Pairs Sold', 'Total Revenue', 'Revenue Share', 'Stock'], brandDetailReport.allBrandsList.map((b) => [`#${b.rank}`, b.name, String(b.sales), money(b.revenue), `${b.share}%`, String(b.stock)]), [40, 160, 75, 95, 75, 70]);
      }
    } else if (reportType === 'categories') {
      drawTitle('Category Performance');
      drawTable(['Rank', 'Category', 'Pairs Sold', 'Revenue', 'Revenue Share', 'Avg Price'], categoryDetailReport.allCategoriesList.map((c) => [`#${c.rank}`, c.name, String(c.sales), money(c.revenue), `${c.share}%`, money(c.avgPrice)]), [40, 160, 75, 95, 75, 70]);
    } else if (reportType === 'departments') {
      drawTitle('Department Performance');
      drawTable(['Rank', 'Department', 'Pairs Sold', 'Revenue', 'Revenue Share', 'Avg Price'], departmentDetailReport.allDeptsList.map((d) => [`#${d.rank}`, d.name, String(d.sales), money(d.revenue), `${d.share}%`, money(d.avgPrice)]), [40, 160, 75, 95, 75, 70]);
    } else if (reportType === 'sizes') {
      drawTitle('Size Distribution Performance');
      drawTable(['Rank', 'Shoe Size', 'Pairs Sold', 'Revenue', 'Volume Share', 'Avg Price'], sizeDetailReport.allSizesList.map((s) => [`#${s.rank}`, s.name, String(s.sales), money(s.revenue), `${s.unitShare}%`, money(s.avgPrice)]), [40, 160, 75, 95, 75, 70]);
    } else if (reportType === 'variants') {
      drawTitle('Variant & Colorway Performance');
      drawTable(['Rank', 'Variant / Color', 'Pairs Sold', 'Revenue', 'Revenue Share', 'Avg Price'], variantDetailReport.allVariantsList.map((v) => [`#${v.rank}`, v.name, String(v.sales), money(v.revenue), `${v.share}%`, money(v.avgPrice)]), [40, 160, 75, 95, 75, 70]);
    } else if (reportType === 'payments') {
      drawTitle('Payment Method Performance');
      drawTable(['Rank', 'Payment Method', 'Transactions', 'Total Collected', 'Txn Share', 'Revenue Share'], paymentDetailReport.allPaymentsList.map((p) => [`#${p.rank}`, p.name, String(p.count), money(p.revenue), `${p.txnShare}%`, `${p.share}%`]), [40, 150, 80, 95, 75, 75]);
    } else if (reportType === 'promotions') {
      drawTitle('Promotion Performance');
      drawTable(['Summary', 'Value'], [
        ['Promotions in period', String(promotionReport.rows.length)],
        ['Sales from promotions', money(promotionReport.totalNet)],
        ['Discounts given', money(promotionReport.totalDiscount)],
        ['Met sales goal', `${promotionReport.metGoal} of ${promotionReport.withGoal}`],
      ], [250, 265]);
      drawTable(
        ['Promotion', 'Status', 'Txns', 'Pairs', 'Net Sales', 'Discount', 'Goal'],
        promotionReport.rows.map((row) => [row.name, row.status, String(row.transactions), String(row.pairs), money(row.net), money(row.discount), row.goal > 0 ? `${row.progress.toFixed(0)}%` : '-']),
        [140, 55, 40, 40, 85, 80, 75],
      );
    } else if (reportType === 'revenue') {
      drawTitle('Revenue by Category');
      drawTable(['Category', 'Revenue', 'Share', 'Growth'], revenueByCategory.map((row) => [row.category, money(row.revenue), `${row.percentage}%`, `${row.growth}%`]));
    } else if (reportType === 'inventory') {
      drawTitle('Inventory Health & Valuation Snapshot');
      drawTable(['Metric', 'Value'], [
        ['Total Retail Valuation', money(inventoryAnalytics.totalRetailValue)],
        ['Total Wholesale Cost Basis', money(inventoryAnalytics.totalCostValue)],
        ['Total In-Stock Pairs', `${inventoryAnalytics.totalStock.toLocaleString()} pairs`],
        ['Out of Stock / Critical', `${inventoryAnalytics.outOfStockCount + inventoryAnalytics.criticalCount} models`],
        ['Reorder Needed', `${inventoryAnalytics.reorderCount} models`],
        ['Optimal Stock Level', `${inventoryAnalytics.optimalCount} models`],
        ['Overstock Level', `${inventoryAnalytics.overstockCount} models`],
      ], [250, 265]);

      ensureSpace(40);
      drawTitle('Stock Valuation by Brand');
      drawTable(['Brand', 'Pairs in Stock', 'Retail Valuation'], inventoryAnalytics.brandList.slice(0, 8).map((b) => [b.name, `${b.pairs} pairs`, money(b.value)]), [180, 140, 195]);

      ensureSpace(40);
      drawTitle('Actionable Restock Priority List');
      drawTable(['SKU', 'Brand & Shoe Model', 'Size', 'Color', 'Stock', 'Reorder', 'Status'], inventoryStatusRows.slice(0, 30).map((row) => [row.sku, row.name, row.size, row.color, String(row.stock), String(row.reorder), row.status]), [75, 190, 45, 65, 45, 45, 50]);
    }

    pages.forEach((page, index) => {
      page.push(`BT /F1 8 Tf ${margin} 24 Td (Prepared by Store Manager) Tj ET`);
      page.push(`BT /F1 8 Tf ${pageWidth - margin - 68} 24 Td (Page ${index + 1} of ${pages.length}) Tj ET`);
    });

    const objects: string[] = [
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    ];
    const pageObjectNumbers: number[] = [];
    pages.forEach((page) => {
      const stream = page.join('\n');
      const contentObject = objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      const pageObject = objects.push(`<< /Type /Page /Parent PAGES_REF /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 1 0 R /F2 2 0 R >> >> /Contents ${contentObject} 0 R >>`);
      pageObjectNumbers.push(pageObject);
    });
    const pagesObject = objects.push(`<< /Type /Pages /Kids [${pageObjectNumbers.map((num) => `${num} 0 R`).join(' ')}] /Count ${pageObjectNumbers.length} >>`);
    const catalogObject = objects.push(`<< /Type /Catalog /Pages ${pagesObject} 0 R >>`);
    const resolvedObjects = objects.map((object) => object.replace(/PAGES_REF/g, `${pagesObject} 0 R`));
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [0];
    resolvedObjects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${resolvedObjects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${resolvedObjects.length + 1} /Root ${catalogObject} 0 R >>\nstartxref\n${xref}\n%%EOF`;

    const blob = new Blob([pdf], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const filename = `${(reportNames[reportType] ?? 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${timeRange}.pdf`;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast.success('PDF report downloaded.');
  };

  const inventoryPeriodMetrics = useMemo(() => {
    const { now, start, previousStart, previousEnd: compareEnd, days } = rangeWindow(timeRange, customStartDate, customEndDate);
    const collectUnitsBySku = (from: Date, to: Date) => {
      const unitsBySku = new Map<string, number>();
      salesRows.forEach((sale) => {
        const date = saleDate(sale);
        if (!date || date < from || date > to) return;
        const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
        details.forEach((detail: any) => {
          const sku = String(detail.product_id ?? '');
          unitsBySku.set(sku, (unitsBySku.get(sku) ?? 0) + Number(detail.quantity ?? 0));
        });
      });
      return unitsBySku;
    };

    return {
      current: summarizeSkuTurnover(collectUnitsBySku(start, now), days),
      previous: summarizeSkuTurnover(collectUnitsBySku(previousStart, compareEnd), days),
    };
  }, [customEndDate, customStartDate, salesRows, stockBySku, timeRange]);

  const revenueChange = percentChange(currentMetrics.current.revenue, currentMetrics.previous.revenue);
  const unitsChange = percentChange(currentMetrics.current.units, currentMetrics.previous.units);
  const profitChange = percentChange(currentMetrics.current.grossProfit, currentMetrics.previous.grossProfit);
  const aovChange = percentChange(currentMetrics.current.aov, currentMetrics.previous.aov);
  const selectedWindow = rangeWindow(timeRange, customStartDate, customEndDate);
  const latestTurnover = inventoryPeriodMetrics.current.turnover;
  const previousTurnover = inventoryPeriodMetrics.previous.turnover;
  const latestAvgDays = inventoryPeriodMetrics.current.avgDays;
  const previousAvgDays = inventoryPeriodMetrics.previous.avgDays;
  const turnoverChange = percentChange(latestTurnover, previousTurnover);
  const avgDaysChange = previousAvgDays ? previousAvgDays - latestAvgDays : 0;
  const selectedRangeLabel = formatDateRange(selectedWindow.start, selectedWindow.now);

  const handleExportCSV = () => {
    try {
      const reportNames: Record<string, string> = {
        overview: 'Executive Overview Report',
        sales: 'Sales Breakdown Report',
        rankings: 'Top 5 Product Rankings',
        specific_category_all: 'Specific & Category Performance Report (All-in-One)',
        products: `Shoe Model Report - ${shoeDetailReport?.name || 'All Models'}`,
        brands: `Brand Performance Report - ${brandFilter === 'all' ? 'All Brands' : brandFilter}`,
        categories: `Category Report - ${categoryFilter === 'all' ? 'All Categories' : categoryFilter}`,
        departments: `Department Report - ${departmentFilter === 'all' ? 'All Departments' : departmentFilter}`,
        sizes: `Size Distribution Report - ${sizeFilter === 'all' ? 'All Sizes' : sizeFilter}`,
        variants: `Variant Color Report - ${variantFilter === 'all' ? 'All Colors' : variantFilter}`,
        payments: 'Payment Method Report',
        promotions: 'Promotion Performance Report',
        revenue: 'Revenue by Category Report',
        inventory: 'Inventory & Stock Report',
      };

      const csvEscape = (val: unknown) => {
        if (val === null || val === undefined) return '';
        const str = String(val).trim();
        if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const formatRow = (row: unknown[]) => row.map(csvEscape).join(',');

      const lines: string[] = [];
      const title = reportNames[reportType] ?? 'Meryl Shoes Business Report';
      const timestamp = new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

      // Safe KPI metrics computation
      const curRev = Number(currentMetrics.current?.revenue ?? 0);
      const prevRev = Number(currentMetrics.previous?.revenue ?? 0);
      const curUnits = Number(currentMetrics.current?.units ?? 0);
      const prevUnits = Number(currentMetrics.previous?.units ?? 0);
      const curTx = Number(currentMetrics.current?.transactions ?? 0);
      const prevTx = Number(currentMetrics.previous?.transactions ?? 0);
      const curAov = curTx > 0 ? curRev / curTx : 0;
      const prevAov = prevTx > 0 ? prevRev / prevTx : 0;

      // Metadata Header
      lines.push(formatRow(['MERYL SHOES ENTERPRISE SYSTEM']));
      lines.push(formatRow([title]));
      lines.push(formatRow(['Branch', 'Araneta Ave, Bacolod, 6100 Negros Occidental']));
      lines.push(formatRow(['Date Range', selectedRangeLabel]));
      lines.push(formatRow(['Report Period Preset', String(timeRange).toUpperCase()]));
      lines.push(formatRow(['Generated At', timestamp]));
      lines.push(formatRow(['Prepared By', 'Store Manager']));
      lines.push('');

      // Section 1: Executive KPI Metrics
      lines.push(formatRow(['=== EXECUTIVE KEY PERFORMANCE INDICATORS ===']));
      lines.push(formatRow(['Metric', 'Current Period', 'Previous Period', 'Growth Rate']));
      lines.push(formatRow(['Total Revenue (PHP)', curRev.toFixed(2), prevRev.toFixed(2), `${revenueChange.toFixed(1)}%`]));
      lines.push(formatRow(['Units Sold', curUnits, prevUnits, `${unitsChange.toFixed(1)}%`]));
      lines.push(formatRow(['Completed Transactions', curTx, prevTx, `${percentChange(curTx, prevTx).toFixed(1)}%`]));
      lines.push(formatRow(['Average Order Value (PHP)', curAov.toFixed(2), prevAov.toFixed(2), `${percentChange(curAov, prevAov).toFixed(1)}%`]));
      lines.push('');

      // Section 2: Report-Specific Data
      if (reportType === 'sales') {
        lines.push(formatRow([`=== SALES BREAKDOWN: ${salesBreakdown.rangeLabel} ===`]));
        lines.push(formatRow(['Period', 'Transactions', 'Pairs Sold', 'Gross Revenue (PHP)', 'Discount Applied (PHP)', 'Net Sales (PHP)']));
        salesBreakdownRows.filter((r) => !r.upcoming).forEach((r) => {
          lines.push(formatRow([r.date, r.transactions, r.pairs, r.gross.toFixed(2), r.discount.toFixed(2), r.net.toFixed(2)]));
        });
        lines.push('');
      }

      if (reportType === 'overview' && suggestions.length) {
        lines.push(formatRow(['=== SUGGESTED ACTIONS ===']));
        lines.push(formatRow(['Priority', 'Suggestion', 'Details']));
        suggestions.forEach((item) => {
          lines.push(formatRow([
            { urgent: 'Urgent', warning: 'Attention', good: 'Opportunity', info: 'Insight' }[item.tone],
            item.title,
            item.detail,
          ]));
        });
        lines.push('');
      }

      if (reportType === 'overview' || reportType === 'rankings') {
        lines.push(formatRow(['=== TOP SELLING BRANDS ===']));
        lines.push(formatRow(['Rank', 'Brand Name', 'Pairs Sold', 'Gross Revenue (PHP)']));
        const brandRankings = topRankings.brand?.byRevenue ?? [];
        brandRankings.forEach((b: any) => {
          lines.push(formatRow([`#${b.rank ?? 1}`, b.name ?? 'N/A', b.sales ?? 0, Number(b.revenue ?? 0).toFixed(2)]));
        });
        lines.push('');

        lines.push(formatRow(['=== TOP SELLING SHOE MODELS ===']));
        lines.push(formatRow(['Rank', 'Shoe Model', 'Pairs Sold', 'Gross Revenue (PHP)']));
        const productRankings = topRankings.products?.byRevenue ?? [];
        productRankings.forEach((p: any) => {
          lines.push(formatRow([`#${p.rank ?? 1}`, p.name ?? 'N/A', p.sales ?? 0, Number(p.revenue ?? 0).toFixed(2)]));
        });
        lines.push('');

        lines.push(formatRow(['=== TOP SIZES ===']));
        lines.push(formatRow(['Rank', 'Size', 'Pairs Sold', 'Gross Revenue (PHP)']));
        (topRankings.size?.byUnits ?? []).forEach((s: any) => {
          lines.push(formatRow([`#${s.rank ?? 1}`, s.name ?? 'N/A', s.sales ?? 0, Number(s.revenue ?? 0).toFixed(2)]));
        });
        lines.push('');

        lines.push(formatRow(['=== TOP PRODUCT VARIANTS / COLORWAYS ===']));
        lines.push(formatRow(['Rank', 'Variant / Color', 'Pairs Sold', 'Gross Revenue (PHP)']));
        const variantRankings = topRankings.variant?.byRevenue ?? [];
        variantRankings.forEach((v: any) => {
          lines.push(formatRow([`#${v.rank ?? 1}`, v.name ?? 'N/A', v.sales ?? 0, Number(v.revenue ?? 0).toFixed(2)]));
        });
        lines.push('');
      }

      if (reportType === 'products' && shoeDetailReport) {
        lines.push(formatRow([`=== SPECIFIC SHOE MODEL REPORT: ${shoeDetailReport.name.toUpperCase()} ===`]));
        lines.push(formatRow(['Property', 'Value']));
        lines.push(formatRow(['Brand', shoeDetailReport.brand]));
        lines.push(formatRow(['Category', shoeDetailReport.category]));
        lines.push(formatRow(['Department', shoeDetailReport.department]));
        lines.push(formatRow(['Base Price (PHP)', shoeDetailReport.basePrice.toFixed(2)]));
        lines.push(formatRow(['Cost Price (PHP)', shoeDetailReport.costPrice.toFixed(2)]));
        lines.push(formatRow(['Total Pairs Sold', shoeDetailReport.totalPairs]));
        lines.push(formatRow(['Total Revenue (PHP)', shoeDetailReport.totalRevenue.toFixed(2)]));
        lines.push(formatRow(['Estimated Profit (PHP)', shoeDetailReport.profit.toFixed(2)]));
        lines.push(formatRow(['Profit Margin (%)', `${shoeDetailReport.margin}%`]));
        lines.push(formatRow(['Total Stock on Hand', shoeDetailReport.totalStock]));
        lines.push('');

        lines.push(formatRow(['=== SIZE BREAKDOWN FOR THIS MODEL ===']));
        lines.push(formatRow(['Size', 'Pairs Sold', 'Revenue (PHP)', 'Available Stock', 'Stock Status']));
        shoeDetailReport.sizeBreakdown.forEach((s) => {
          lines.push(formatRow([s.size, s.pairs, s.revenue.toFixed(2), s.stock, s.status]));
        });
        lines.push('');

        if (shoeDetailReport.variantBreakdown.length > 0) {
          lines.push(formatRow(['=== VARIANT / COLOR BREAKDOWN FOR THIS MODEL ===']));
          lines.push(formatRow(['Color / Style', 'Pairs Sold', 'Revenue (PHP)']));
          shoeDetailReport.variantBreakdown.forEach((v) => {
            lines.push(formatRow([v.color, v.pairs, v.revenue.toFixed(2)]));
          });
          lines.push('');
        }

        if (shoeDetailReport.transactions.length > 0) {
          lines.push(formatRow(['=== RECENT SALES TRANSACTIONS ===']));
          lines.push(formatRow(['Date', 'Sale ID', 'Customer', 'Size', 'Color', 'Quantity', 'Unit Price (PHP)', 'Subtotal (PHP)', 'Payment Method']));
          shoeDetailReport.transactions.forEach((tx) => {
            lines.push(formatRow([
              localDayKey(tx.date),
              tx.saleId,
              tx.customer,
              tx.size,
              tx.color,
              tx.qty,
              tx.price.toFixed(2),
              tx.subtotal.toFixed(2),
              tx.payment,
            ]));
          });
          lines.push('');
        }
      }

      if (reportType === 'specific_category_all') {
        if (shoeDetailReport) {
          lines.push(formatRow(['=== SPECIFIC SHOE MODEL PERFORMANCE ===']));
          lines.push(formatRow(['Model Name', shoeDetailReport.name]));
          lines.push(formatRow(['Brand', shoeDetailReport.brand]));
          lines.push(formatRow(['Category', shoeDetailReport.category]));
          lines.push(formatRow(['Department', shoeDetailReport.department]));
          lines.push(formatRow(['Retail Price (PHP)', shoeDetailReport.basePrice.toFixed(2)]));
          lines.push(formatRow(['Cost Price (PHP)', shoeDetailReport.costPrice.toFixed(2)]));
          lines.push(formatRow(['Gross Margin (%)', `${shoeDetailReport.margin}%`]));
          lines.push(formatRow(['Total Stock on Hand', shoeDetailReport.totalStock]));
          lines.push(formatRow(['Pairs Sold in Period', shoeDetailReport.totalPairs]));
          lines.push(formatRow(['Gross Revenue (PHP)', shoeDetailReport.totalRevenue.toFixed(2)]));
          lines.push(formatRow(['Estimated Profit (PHP)', shoeDetailReport.profit.toFixed(2)]));
          lines.push('');
          lines.push(formatRow(['--- Size Breakdown for this Shoe ---']));
          lines.push(formatRow(['Size (EU)', 'Pairs Sold', 'Revenue (PHP)', 'In Stock', 'Status']));
          shoeDetailReport.sizeBreakdown.forEach((s) => {
            lines.push(formatRow([s.size, s.pairs, s.revenue.toFixed(2), s.stock, s.status]));
          });
          lines.push('');
        }

        lines.push(formatRow(['=== ALL BRANDS PERFORMANCE ===']));
        lines.push(formatRow(['Rank', 'Brand Name', 'Pairs Sold', 'Gross Revenue (PHP)', 'Revenue Share (%)', 'Profit Margin (%)', 'Avg Price (PHP)', 'Stock on Hand']));
        brandDetailReport.allBrandsList.forEach((b) => {
          lines.push(formatRow([`#${b.rank}`, b.name, b.sales, b.revenue.toFixed(2), `${b.share}%`, `${b.margin}%`, b.avgPrice.toFixed(2), b.stock]));
        });
        lines.push('');

        lines.push(formatRow(['=== CATEGORY PERFORMANCE REPORT ===']));
        lines.push(formatRow(['Rank', 'Category', 'Pairs Sold', 'Revenue (PHP)', 'Revenue Share (%)', 'Average Price (PHP)']));
        categoryDetailReport.allCategoriesList.forEach((c) => {
          lines.push(formatRow([`#${c.rank}`, c.name, c.sales, c.revenue.toFixed(2), `${c.share}%`, c.avgPrice.toFixed(2)]));
        });
        lines.push('');

        lines.push(formatRow(['=== DEPARTMENT PERFORMANCE REPORT ===']));
        lines.push(formatRow(['Rank', 'Department', 'Pairs Sold', 'Revenue (PHP)', 'Revenue Share (%)', 'Average Price (PHP)']));
        departmentDetailReport.allDeptsList.forEach((d) => {
          lines.push(formatRow([`#${d.rank}`, d.name, d.sales, d.revenue.toFixed(2), `${d.share}%`, d.avgPrice.toFixed(2)]));
        });
        lines.push('');

        lines.push(formatRow(['=== SIZE DISTRIBUTION REPORT ===']));
        lines.push(formatRow(['Rank', 'Shoe Size', 'Pairs Sold', 'Revenue (PHP)', 'Volume Share (%)', 'Revenue Share (%)', 'Average Price (PHP)']));
        sizeDetailReport.allSizesList.forEach((s) => {
          lines.push(formatRow([`#${s.rank}`, s.name, s.sales, s.revenue.toFixed(2), `${s.unitShare}%`, `${s.share}%`, s.avgPrice.toFixed(2)]));
        });
        lines.push('');

        lines.push(formatRow(['=== VARIANT & COLORWAY REPORT ===']));
        lines.push(formatRow(['Rank', 'Variant / Color', 'Pairs Sold', 'Revenue (PHP)', 'Volume Share (%)', 'Revenue Share (%)', 'Average Price (PHP)']));
        variantDetailReport.allVariantsList.forEach((v) => {
          lines.push(formatRow([`#${v.rank}`, v.name, v.sales, v.revenue.toFixed(2), `${v.unitShare}%`, `${v.share}%`, v.avgPrice.toFixed(2)]));
        });
        lines.push('');

        lines.push(formatRow(['=== PAYMENT METHOD REPORT ===']));
        lines.push(formatRow(['Rank', 'Payment Method', 'Transaction Count', 'Total Collected (PHP)', 'Transaction Share (%)', 'Volume Share (%)', 'Average Ticket (PHP)']));
        paymentDetailReport.allPaymentsList.forEach((p) => {
          lines.push(formatRow([`#${p.rank}`, p.name, p.count, p.revenue.toFixed(2), `${p.txnShare}%`, `${p.share}%`, p.avgTx.toFixed(2)]));
        });
        lines.push('');
      }

      if (reportType === 'brands') {
        if (brandDetailReport.activeBrand !== 'all' && brandDetailReport.selectedBrandData) {
          lines.push(formatRow([`=== BRAND PERFORMANCE: ${brandDetailReport.activeBrand.toUpperCase()} ===`]));
          lines.push(formatRow(['Total Pairs Sold', brandDetailReport.selectedBrandData.sales]));
          lines.push(formatRow(['Total Revenue (PHP)', brandDetailReport.selectedBrandData.revenue.toFixed(2)]));
          lines.push(formatRow(['Store Revenue Share (%)', `${brandDetailReport.selectedBrandData.storeShare}%`]));
          lines.push(formatRow(['Stock on Hand', brandDetailReport.selectedBrandData.stock]));
          lines.push('');

          lines.push(formatRow(['=== SHOE MODELS UNDER THIS BRAND ===']));
          lines.push(formatRow(['Rank', 'Shoe Model', 'Category', 'Department', 'Pairs Sold', 'Revenue (PHP)', 'Brand Share (%)', 'Stock on Hand']));
          brandDetailReport.selectedBrandModels.forEach((m) => {
            lines.push(formatRow([`#${m.rank}`, m.name, m.category, m.department, m.sales, m.revenue.toFixed(2), `${m.share}%`, m.stock]));
          });
          lines.push('');
        } else {
          lines.push(formatRow(['=== ALL BRANDS PERFORMANCE ===']));
          lines.push(formatRow(['Rank', 'Brand Name', 'Pairs Sold', 'Gross Revenue (PHP)', 'Revenue Share (%)', 'Profit Margin (%)', 'Avg Price (PHP)', 'Stock on Hand']));
          brandDetailReport.allBrandsList.forEach((b) => {
            lines.push(formatRow([`#${b.rank}`, b.name, b.sales, b.revenue.toFixed(2), `${b.share}%`, `${b.margin}%`, b.avgPrice.toFixed(2), b.stock]));
          });
          lines.push('');
        }
      }

      if (reportType === 'categories') {
        lines.push(formatRow(['=== CATEGORY PERFORMANCE REPORT ===']));
        lines.push(formatRow(['Rank', 'Category', 'Pairs Sold', 'Revenue (PHP)', 'Revenue Share (%)', 'Average Price (PHP)']));
        categoryDetailReport.allCategoriesList.forEach((c) => {
          lines.push(formatRow([`#${c.rank}`, c.name, c.sales, c.revenue.toFixed(2), `${c.share}%`, c.avgPrice.toFixed(2)]));
        });
        lines.push('');
      }

      if (reportType === 'departments') {
        lines.push(formatRow(['=== DEPARTMENT PERFORMANCE REPORT ===']));
        lines.push(formatRow(['Rank', 'Department', 'Pairs Sold', 'Revenue (PHP)', 'Revenue Share (%)', 'Average Price (PHP)']));
        departmentDetailReport.allDeptsList.forEach((d) => {
          lines.push(formatRow([`#${d.rank}`, d.name, d.sales, d.revenue.toFixed(2), `${d.share}%`, d.avgPrice.toFixed(2)]));
        });
        lines.push('');
      }

      if (reportType === 'sizes') {
        lines.push(formatRow(['=== SIZE DISTRIBUTION REPORT ===']));
        lines.push(formatRow(['Rank', 'Shoe Size', 'Pairs Sold', 'Revenue (PHP)', 'Volume Share (%)', 'Revenue Share (%)', 'Average Price (PHP)']));
        sizeDetailReport.allSizesList.forEach((s) => {
          lines.push(formatRow([`#${s.rank}`, s.name, s.sales, s.revenue.toFixed(2), `${s.unitShare}%`, `${s.share}%`, s.avgPrice.toFixed(2)]));
        });
        lines.push('');
      }

      if (reportType === 'variants') {
        lines.push(formatRow(['=== VARIANT & COLORWAY REPORT ===']));
        lines.push(formatRow(['Rank', 'Variant / Color', 'Pairs Sold', 'Revenue (PHP)', 'Volume Share (%)', 'Revenue Share (%)', 'Average Price (PHP)']));
        variantDetailReport.allVariantsList.forEach((v) => {
          lines.push(formatRow([`#${v.rank}`, v.name, v.sales, v.revenue.toFixed(2), `${v.unitShare}%`, `${v.share}%`, v.avgPrice.toFixed(2)]));
        });
        lines.push('');
      }

      if (reportType === 'payments') {
        lines.push(formatRow(['=== PAYMENT METHOD REPORT ===']));
        lines.push(formatRow(['Rank', 'Payment Method', 'Transaction Count', 'Total Collected (PHP)', 'Transaction Share (%)', 'Volume Share (%)', 'Average Ticket (PHP)']));
        paymentDetailReport.allPaymentsList.forEach((p) => {
          lines.push(formatRow([`#${p.rank}`, p.name, p.count, p.revenue.toFixed(2), `${p.txnShare}%`, `${p.share}%`, p.avgTx.toFixed(2)]));
        });
        lines.push('');
      }

      if (reportType === 'promotions') {
        lines.push(formatRow(['=== PROMOTION PERFORMANCE ===']));
        lines.push(formatRow(['Promotion', 'Offer', 'Window', 'Status', 'Transactions', 'Pairs', 'Net Sales (PHP)', 'Discount Given (PHP)', 'Target Sales Goal (PHP)', 'Campaign Sales (PHP)', 'Goal Progress (%)']));
        promotionReport.rows.forEach((row) => {
          lines.push(formatRow([row.name, row.offer, row.window, row.status, row.transactions, row.pairs, row.net.toFixed(2), row.discount.toFixed(2), row.goal.toFixed(2), row.campaignNet.toFixed(2), row.goal > 0 ? row.progress.toFixed(1) : '']));
        });
        lines.push('');
      }

      if (reportType === 'revenue') {
        lines.push(formatRow(['=== REVENUE BY PRODUCT CATEGORY ===']));
        lines.push(formatRow(['Category', 'Gross Revenue (PHP)', 'Revenue Share (%)', 'Growth (%)']));
        (revenueByCategory ?? []).forEach((cat: any) => {
          lines.push(formatRow([cat.category ?? 'Uncategorized', Number(cat.revenue ?? 0).toFixed(2), `${cat.percentage ?? 0}%`, `${cat.growth ?? 0}%`]));
        });
        lines.push('');
      }

      if (reportType === 'inventory') {
        lines.push(formatRow(['=== INVENTORY & STOCK VALUATION SUMMARY ===']));
        lines.push(formatRow(['Metric', 'Value']));
        lines.push(formatRow(['Total Retail Stock Valuation (PHP)', inventoryAnalytics.totalRetailValue.toFixed(2)]));
        lines.push(formatRow(['Total Wholesale Cost Valuation (PHP)', inventoryAnalytics.totalCostValue.toFixed(2)]));
        lines.push(formatRow(['Total In-Stock Units (Pairs)', inventoryAnalytics.totalStock]));
        lines.push(formatRow(['Out of Stock Models', inventoryAnalytics.outOfStockCount]));
        lines.push(formatRow(['Critical Low Stock Models', inventoryAnalytics.criticalCount]));
        lines.push(formatRow(['Reorder Required Models', inventoryAnalytics.reorderCount]));
        lines.push(formatRow(['Optimal Stock Models', inventoryAnalytics.optimalCount]));
        lines.push(formatRow(['Overstock Models', inventoryAnalytics.overstockCount]));
        lines.push('');

        lines.push(formatRow(['=== STOCK VALUATION & PAIRS BY BRAND ===']));
        lines.push(formatRow(['Brand Name', 'In-Stock Pairs', 'Stock Valuation (PHP)']));
        inventoryAnalytics.brandList.forEach((b) => {
          lines.push(formatRow([b.name, b.pairs, b.value.toFixed(2)]));
        });
        lines.push('');

        lines.push(formatRow(['=== FOOTWEAR SIZE RUN AVAILABILITY ===']));
        lines.push(formatRow(['Size (EU)', 'In-Stock Pairs']));
        inventoryAnalytics.sizeList.forEach((s) => {
          lines.push(formatRow([s.name, s.pairs]));
        });
        lines.push('');

        lines.push(formatRow(['=== INVENTORY AND STOCK STATUS ===']));
        lines.push(formatRow(['SKU', 'Brand & Model', 'Size', 'Color', 'Available Stock', 'Reorder Point', 'Unit Price (PHP)', 'Stock Valuation (PHP)', 'Stock Status']));
        (inventoryStatusRows ?? []).forEach((item: any) => {
          lines.push(formatRow([item.sku ?? item.rawSku ?? 'N/A', item.name ?? 'N/A', item.size ?? 'N/A', item.color ?? 'N/A', item.stock ?? 0, item.reorder ?? 0, (item.unitPrice ?? 0).toFixed(2), (item.stockValue ?? 0).toFixed(2), item.status ?? 'N/A']));
        });
        lines.push('');
      }

      // Add UTF-8 BOM so Excel opens accented characters and symbols properly
      const csvContent = '\uFEFF' + lines.join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const filename = `${(reportNames[reportType] ?? 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${timeRange}.csv`;
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success('CSV report spreadsheet downloaded successfully.');
    } catch (err: any) {
      console.error('Failed to export CSV report:', err);
      toast.error(`CSV Export failed: ${err?.message ?? 'Unknown error'}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex flex-wrap justify-between items-end gap-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-yellow-200/70">Date Range</span>
            <Select
              value={timeRange}
              onValueChange={(value) => {
                setTimeRange(value as ReportPeriod);
                if (value === 'custom' && !customStartDate && !customEndDate) {
                  const now = new Date();
                  const past = new Date();
                  past.setDate(now.getDate() - 30);
                  setCustomStartDate(localDayKey(past));
                  setCustomEndDate(localDayKey(now));
                }
              }}
            >
              <SelectTrigger className="w-44 bg-[#0b0b0f] border-[#24242d] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0b0b0f] border-[#24242d] text-white">
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="annually">Annually</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {timeRange === 'custom' && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-yellow-200/70">From Date</span>
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="h-9 rounded-md border border-[#24242d] bg-[#0b0b0f] px-3 text-sm text-white focus:border-yellow-400/70 focus:outline-none [color-scheme:dark]"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase tracking-wide text-yellow-200/70">To Date</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="h-9 rounded-md border border-[#24242d] bg-[#0b0b0f] px-3 text-sm text-white focus:border-yellow-400/70 focus:outline-none [color-scheme:dark]"
                />
              </div>
            </>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-yellow-200/70">Report Type</span>
            <Select
              value={
                ['products', 'brands', 'categories', 'departments', 'sizes', 'variants', 'payments', 'specific_category_all'].includes(reportType)
                  ? 'specific_category_all'
                  : reportType
              }
              onValueChange={(val) => {
                setReportType(val);
                if (val === 'specific_category_all') {
                  setDrilldownSection('all');
                }
              }}
            >
              <SelectTrigger className="w-64 bg-[#0b0b0f] border-[#24242d] text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-[#0b0b0f] border-[#24242d] text-white">
                <SelectItem value="overview">Executive Overview</SelectItem>
                <SelectItem value="sales">Sales Breakdown Report</SelectItem>
                <SelectItem value="rankings">Top 5 Product Rankings</SelectItem>
                <SelectItem value="specific_category_all">Specific & Category Reports (All-in-One)</SelectItem>
                <SelectItem value="revenue">Revenue by Category Report</SelectItem>
                <SelectItem value="promotions">Promotion Performance Report</SelectItem>
                <SelectItem value="inventory">Inventory & Stock Report</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-9 items-center gap-2 rounded-md border border-[#24242d] bg-[#0b0b0f] px-3 text-sm text-white">
            <input
              type="checkbox"
              checked={showComparison}
              onChange={(e) => setShowComparison(e.target.checked)}
              className="accent-yellow-400"
            />
            Compare
          </label>
          <Button
            type="button"
            onClick={handleExportReport}
            className="h-9 bg-yellow-400 text-black hover:bg-yellow-500 cursor-pointer"
          >
            <Download className="w-4 h-4 mr-2" />
            Export PDF
          </Button>
          <Button
            type="button"
            onClick={handleExportCSV}
            variant="outline"
            className="h-9 border-yellow-400/40 text-yellow-400 hover:bg-yellow-400/10 hover:text-yellow-300 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>
      <div className="rounded-md border border-[#24242d] bg-[#07070a] px-4 py-2 text-sm text-yellow-200">
        Showing {selectedRangeLabel}
      </div>

      {/* Key Performance Indicators */}
      {reportType === 'inventory' ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Total Stock Valuation</p>
                  <p className="text-2xl text-yellow-300 font-bold">{money(inventoryAnalytics.totalRetailValue)}</p>
                  <p className="text-xs text-zinc-400 mt-1">Cost: {money(inventoryAnalytics.totalCostValue)} • {productRows.length} SKUs</p>
                </div>
                <Coins className="h-8 w-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Total In-Stock Units</p>
                  <p className="text-2xl text-white font-bold">{inventoryAnalytics.totalStock.toLocaleString()} pairs</p>
                  <p className="text-xs text-zinc-400 mt-1">Available in warehouse & store</p>
                </div>
                <Package className="h-8 w-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Reorder Required</p>
                  <p className="text-2xl text-yellow-400 font-bold">{inventoryAnalytics.reorderCount} models</p>
                  <p className="text-xs text-yellow-500/80 mt-1">At or below reorder threshold</p>
                </div>
                <TrendingUp className="h-8 w-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Out of Stock / Critical</p>
                  <p className="text-2xl text-red-400 font-bold">{inventoryAnalytics.outOfStockCount + inventoryAnalytics.criticalCount} models</p>
                  <p className="text-xs text-red-400/80 mt-1">{inventoryAnalytics.outOfStockCount} depleted • {inventoryAnalytics.criticalCount} critical low</p>
                </div>
                <Tag className="h-8 w-8 text-red-400" />
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Total Revenue</p>
                  <p className="text-2xl text-white">{money(currentMetrics.current.revenue)}</p>
                  {showComparison && <p className={`text-xs mt-1 ${revenueChange >= 0 ? 'text-green-400' : 'text-red-300'}`}>
                    {comparisonText(currentMetrics.current.revenue, currentMetrics.previous.revenue)}
                  </p>}
                </div>
                <Coins className="h-8 w-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Units Sold</p>
                  <p className="text-2xl text-white">{currentMetrics.current.units.toLocaleString()}</p>
                  {showComparison && <p className={`text-xs mt-1 ${unitsChange >= 0 ? 'text-green-400' : 'text-red-300'}`}>
                    {comparisonText(currentMetrics.current.units, currentMetrics.previous.units)}
                  </p>}
                </div>
                <Package className="h-8 w-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Gross Profit</p>
                  <p className="text-2xl text-white">{money(currentMetrics.current.grossProfit)}</p>
                  {showComparison ? (
                    <p className={`text-xs mt-1 ${profitChange >= 0 ? 'text-green-400' : 'text-red-300'}`}>
                      {currentMetrics.previous.grossProfit
                        ? `${profitChange >= 0 ? '+' : ''}${profitChange.toFixed(1)}%`
                        : 'New'} • {currentMetrics.current.margin.toFixed(1)}% margin
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-400 mt-1">{currentMetrics.current.margin.toFixed(1)}% gross profit margin</p>
                  )}
                </div>
                <TrendingUp className="h-8 w-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-white/70">Avg Order Value (AOV)</p>
                  <p className="text-2xl text-white">{money(currentMetrics.current.aov)}</p>
                  {showComparison ? (
                    <p className={`text-xs mt-1 ${aovChange >= 0 ? 'text-green-400' : 'text-red-300'}`}>
                      {comparisonText(currentMetrics.current.aov, currentMetrics.previous.aov)}
                    </p>
                  ) : (
                    <p className="text-xs text-zinc-400 mt-1">{currentMetrics.current.transactions.toLocaleString()} completed orders</p>
                  )}
                </div>
                <ShoppingBag className="h-8 w-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Selected Report Section */}
      {reportType === 'overview' && (
        <div className="space-y-4">
          <Card className="bg-[#0b0b0f] border-[#24242d] overflow-hidden">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-yellow-300 flex items-center gap-2">
                    <FileText className="w-5 h-5" />
                    Executive Snapshot
                  </CardTitle>
                  <p className="mt-2 text-sm text-white/55">
                    {businessSummary.period} - {businessSummary.store}
                  </p>
                </div>
                <Badge className="bg-yellow-400 text-black">
                  Prepared by {businessSummary.preparedBy}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="rounded-lg border border-[#24242d] bg-[#07070a] p-5">
                  <p className="text-xs uppercase tracking-wide text-yellow-200/70">Average Transaction Value</p>
                  <p className="mt-2 text-3xl text-white">{money(businessSummary.atv)}</p>
                  <p className="mt-2 text-xs text-white/55">
                    {currentMetrics.current.transactions.toLocaleString()} completed transactions
                  </p>
                </div>
                <div className="rounded-lg border border-[#24242d] bg-[#07070a] p-5">
                  <p className="text-xs uppercase tracking-wide text-yellow-200/70">Discount Pressure</p>
                  <p className="mt-2 text-3xl text-white">{businessSummary.discountRate.toFixed(1)}%</p>
                  <p className="mt-2 text-xs text-white/55">
                    {money(businessSummary.discounts)} discount impact
                  </p>
                </div>
                <div className="rounded-lg border border-[#24242d] bg-[#07070a] p-5">
                  <p className="text-xs uppercase tracking-wide text-yellow-200/70">Best Brand</p>
                  <p className="mt-2 text-3xl text-white">{businessSummary.bestBrandName}</p>
                  <p className="mt-2 text-xs text-white/55">
                    {businessSummary.bestBrandUnits} pairs sold
                  </p>
                </div>
                <div className="rounded-lg border border-[#24242d] bg-[#07070a] p-5">
                  <p className="text-xs uppercase tracking-wide text-yellow-200/70">Top Product</p>
                  <p className="mt-2 text-3xl text-white">{topProducts[0]?.name ?? 'N/A'}</p>
                  <p className="mt-2 text-xs text-white/55">
                    {topProducts[0] ? `${topProducts[0].sales} units sold` : 'No product sales yet'}
                  </p>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-4 rounded-lg border border-[#24242d] bg-[#07070a] p-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-yellow-200/60">Gross Sales Before Discounts</p>
                  <p className="mt-1 text-white">{money(businessSummary.grossRevenue)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-yellow-200/60">Best Size</p>
                  <p className="mt-1 text-white">{businessSummary.bestSize}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-yellow-200/60">Net After Discounts</p>
                  <p className="mt-1 text-white">{money(businessSummary.netSales)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardHeader>
              <CardTitle className="text-yellow-300 flex items-center gap-2">
                <Sparkles className="w-5 h-5" />
                Suggested Actions
              </CardTitle>
              <p className="mt-1 text-sm text-white/55">Based on sales and stock for {selectedRangeLabel}.</p>
            </CardHeader>
            <CardContent className="pt-0">
              {suggestions.length ? (
                <ul className="divide-y divide-[#24242d] rounded-lg border border-[#24242d] bg-[#07070a]">
                  {suggestions.map((item, index) => {
                    const tone = {
                      urgent: { dot: 'bg-red-500', label: 'Urgent', text: 'text-red-300' },
                      warning: { dot: 'bg-amber-400', label: 'Attention', text: 'text-amber-300' },
                      good: { dot: 'bg-emerald-400', label: 'Opportunity', text: 'text-emerald-300' },
                      info: { dot: 'bg-sky-400', label: 'Insight', text: 'text-sky-300' },
                    }[item.tone];
                    return (
                      <li key={index} className="flex gap-3 px-4 py-3">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-white">
                            <span className={`mr-2 text-[10px] font-bold uppercase tracking-wider ${tone.text}`}>{tone.label}</span>
                            {item.title}
                          </p>
                          <p className="mt-0.5 text-xs text-white/60">{item.detail}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-lg border border-[#24242d] bg-[#07070a] px-4 py-3 text-sm text-white/60">
                  Nothing needs attention for this period.
                </p>
              )}
            </CardContent>
          </Card>

          {(() => {
            // One measure per chart (no dual axis): revenue or pairs, chosen by the toggle.
            const isRevenue = trendMetric === 'revenue';
            const valueOf = (row: (typeof filteredSalesTrends)[number]) => (isRevenue ? row.revenue : row.sales);
            const formatValue = (value: number) => (isRevenue ? money(value) : `${value.toLocaleString()} pair${value === 1 ? '' : 's'}`);
            const bucketMode = salesTrendFrame(timeRange, customStartDate, customEndDate).mode;
            const bucketNoun = { hourly: 'hour', daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', annually: 'year' }[bucketMode];
            const points = filteredSalesTrends;
            const total = points.reduce((sum, row) => sum + valueOf(row), 0);
            const average = points.length ? total / points.length : 0;
            const peak = points.reduce<(typeof points)[number] | null>((best, row) => (!best || valueOf(row) > valueOf(best) ? row : best), null);
            const emptyBuckets = points.filter((row) => row.revenue === 0 && row.sales === 0).length;
            const showDots = points.length <= 31;
            // Multi-day hourly charts: mark where each new day's store hours begin.
            const dayStarts = bucketMode === 'hourly' ? points.filter((row, index) => index > 0 && row.date.includes(' · ') && row.date.split(' · ')[0] !== points[index - 1].date.split(' · ')[0]) : [];
            // Axis/label amounts: ₱200K, ₱28.5K (no trailing ".0").
            const shortAmount = (value: number) =>
              isRevenue ? moneyCompact(value).replace('PHP ', '₱').replace('.0K', 'K').replace('.0M', 'M') : Math.round(value).toLocaleString();
            // Keep the peak label inside the plot when the peak is the first or last point.
            const peakIndex = peak ? points.indexOf(peak) : -1;
            const peakLabelPosition = peakIndex === 0 ? 'right' : peakIndex === points.length - 1 ? 'left' : 'top';
            // Four even, round steps with ~10% headroom above the peak (e.g. 0, 60K, 120K, 180K, 240K).
            const peakValue = peak ? valueOf(peak) : 0;
            const rawStep = Math.max(peakValue * 1.1, isRevenue ? 100 : 4) / 4;
            const magnitude = 10 ** Math.floor(Math.log10(rawStep));
            const niceStep = ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((n) => n * magnitude >= rawStep) ?? 10) * magnitude;
            const step = isRevenue ? niceStep : Math.max(1, Math.ceil(niceStep));
            const yTicks = [0, step, step * 2, step * 3, step * 4];

            const TrendTooltip = ({ active, payload, label }: any) => {
              if (!active || !payload?.length) return null;
              const row = payload[0].payload;
              return (
                <div className="rounded-xl border border-white/15 bg-[#16161C] px-3.5 py-2.5 text-xs shadow-2xl">
                  <p className="mb-1.5 text-[13px] font-semibold text-white">{label}</p>
                  {row.revenue === 0 && row.sales === 0 ? (
                    <p className="text-white/50">No sales</p>
                  ) : (
                    <div className="space-y-0.5 text-white/80">
                      <p className="flex justify-between gap-6"><span className="text-white/55">Revenue</span><span className="font-semibold text-white">{money(row.revenue)}</span></p>
                      <p className="flex justify-between gap-6"><span className="text-white/55">Pairs sold</span><span className="font-semibold text-white">{row.sales.toLocaleString()}</span></p>
                      <p className="flex justify-between gap-6"><span className="text-white/55">Customers</span><span className="font-semibold text-white">{row.customers.toLocaleString()}</span></p>
                    </div>
                  )}
                </div>
              );
            };

            return (
              <Card className="bg-[#0b0b0f] border-[#24242d]">
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-yellow-300 flex items-center gap-2">
                        <TrendingUp className="w-5 h-5" />
                        Sales Performance Over Time
                      </CardTitle>
                      <p className="mt-1 text-sm text-white/55">
                        {isRevenue ? 'Revenue' : 'Pairs sold'} per {bucketNoun}
                        {bucketMode === 'hourly' ? ` · store hours ${clockLabel(storeOpening(new Date()))} – ${clockLabel(storeClosing(new Date()))}` : ''} · {selectedRangeLabel}
                      </p>
                    </div>
                    <div className="inline-flex rounded-lg border border-[#24242d] bg-[#07070a] p-0.5" role="group" aria-label="Chart measure">
                      {([['revenue', 'Revenue'], ['pairs', 'Pairs sold']] as const).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setTrendMetric(id)}
                          aria-pressed={trendMetric === id}
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                            trendMetric === id ? 'bg-yellow-400 text-red-950' : 'text-white/65 hover:text-yellow-200'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      { label: `Total ${isRevenue ? 'revenue' : 'pairs'}`, value: formatValue(total) },
                      { label: `Average per ${bucketNoun}`, value: isRevenue ? money(average) : `${average.toFixed(1)} pairs` },
                      { label: `Best ${bucketNoun}`, value: peak && valueOf(peak) > 0 ? `${peak.date} · ${formatValue(valueOf(peak))}` : '—' },
                      { label: `${bucketNoun[0].toUpperCase()}${bucketNoun.slice(1)}s with no sales`, value: `${emptyBuckets} of ${points.length}` },
                    ].map((stat) => (
                      <div key={stat.label} className="rounded-lg border border-[#24242d] bg-[#07070a] px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-white/45">{stat.label}</p>
                        <p className="mt-0.5 truncate text-sm font-semibold text-white" title={stat.value}>{stat.value}</p>
                      </div>
                    ))}
                  </div>
                </CardHeader>
                <CardContent className="rounded-b-lg bg-[#07070a] pt-4">
                  <div className="mb-2 flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-xs text-white/65">
                    <span className="inline-flex items-center gap-2">
                      <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="#facc15" strokeWidth="2" /></svg>
                      {isRevenue ? 'Revenue' : 'Pairs sold'} per {bucketNoun}
                    </span>
                    {average > 0 && (
                      <span className="inline-flex items-center gap-2">
                        <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke="#6b7280" strokeWidth="1.5" strokeDasharray="4 4" /></svg>
                        Average ({isRevenue ? money(average) : `${average.toFixed(1)} pairs`})
                      </span>
                    )}
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={points} margin={{ top: 24, right: 24, left: 4, bottom: 8 }}>
                      <CartesianGrid stroke="#1c1c24" vertical={false} />
                      <XAxis
                        dataKey="date"
                        axisLine={{ stroke: '#2a2a33' }}
                        tickLine={false}
                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                        minTickGap={20}
                        tickMargin={8}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                        allowDecimals={false}
                        tickFormatter={(value) => shortAmount(Number(value))}
                        domain={[0, yTicks[4]]}
                        ticks={yTicks}
                        width={56}
                      />
                      {dayStarts.map((row) => (
                        <ReferenceLine key={`day-${row.id}`} x={row.date} stroke="#3a3a46" strokeDasharray="2 4" />
                      ))}
                      <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#facc15', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.4 }} />
                      {average > 0 && (
                        <ReferenceLine
                          y={average}
                          stroke="#6b7280"
                          strokeDasharray="4 4"
                        />
                      )}
                      <Line
                        type="linear"
                        dataKey={isRevenue ? 'revenue' : 'sales'}
                        stroke="#facc15"
                        strokeWidth={2}
                        dot={showDots ? { r: 4, fill: '#07070a', stroke: '#facc15', strokeWidth: 2 } : false}
                        activeDot={{ r: 6, fill: '#facc15', stroke: '#07070a', strokeWidth: 2 }}
                        name={isRevenue ? 'Revenue' : 'Pairs sold'}
                        isAnimationActive={false}
                      />
                      {peak && valueOf(peak) > 0 && (
                        <ReferenceDot
                          x={peak.date}
                          y={valueOf(peak)}
                          r={0}
                          label={{
                            value: `Peak ${shortAmount(valueOf(peak))}`,
                            position: peakLabelPosition,
                            offset: 10,
                            fill: '#e5e7eb',
                            fontSize: 11,
                            fontWeight: 600,
                          }}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            );
          })()}
        </div>
      )}

      {reportType === 'sales' && (
        <div className="space-y-4">
          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-yellow-300 flex items-center gap-2">
                  <TrendingUp className="w-5 h-5" />
                  Sales Breakdown
                </CardTitle>
                <p className="mt-1 text-sm text-white/55">{salesBreakdown.rangeLabel}</p>
              </div>
              {(() => {
                const elapsed = salesBreakdownRows.filter((row) => !row.upcoming);
                const withSales = elapsed.filter((row) => row.hasSales).length;
                return (
                  <p className="text-xs text-white/55">
                    {withSales} of {elapsed.length} {salesBreakdown.unit}s had sales
                  </p>
                );
              })()}
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table className="overflow-hidden rounded-lg border border-[#24242d] bg-[#07070a]">
                  <TableHeader className="bg-[#0b0b0f]">
                    <TableRow className="border-[#24242d] hover:bg-[#0b0b0f]">
                      <TableHead className="text-yellow-300">Period</TableHead>
                      <TableHead className="text-yellow-300 text-center">Transactions</TableHead>
                      <TableHead className="text-yellow-300 text-center">Pairs Sold</TableHead>
                      <TableHead className="text-yellow-300 text-center">Gross Revenue</TableHead>
                      <TableHead className="text-yellow-300 text-center">Discount Applied</TableHead>
                      <TableHead className="text-yellow-300 text-center">Net Sales</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salesBreakdownRows.map((row) => {
                      if (row.hasSales) {
                        return (
                          <TableRow key={row.id} className="border-[#24242d] bg-[#07070a] hover:bg-white/[0.03]">
                            <TableCell className="text-yellow-200">{row.date}</TableCell>
                            <TableCell className="text-yellow-200 text-center">{row.transactions}</TableCell>
                            <TableCell className="text-yellow-200 text-center">{row.pairs}</TableCell>
                            <TableCell className="text-yellow-200 text-center">{money(row.gross)}</TableCell>
                            <TableCell className="text-yellow-200 text-center">{money(row.discount)}</TableCell>
                            <TableCell className="text-yellow-300 text-center">{money(row.net)}</TableCell>
                          </TableRow>
                        );
                      }
                      const tag = row.upcoming ? 'Upcoming' : 'No sales';
                      const blank = row.upcoming ? '—' : null;
                      return (
                        <TableRow key={row.id} className="border-[#24242d] bg-[#07070a] hover:bg-white/[0.02]">
                          <TableCell className="text-white/40">
                            {row.date}
                            <span className="ml-2 rounded border border-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/40">{tag}</span>
                          </TableCell>
                          <TableCell className="text-white/30 text-center">{blank ?? 0}</TableCell>
                          <TableCell className="text-white/30 text-center">{blank ?? 0}</TableCell>
                          <TableCell className="text-white/30 text-center">{blank ?? money(0)}</TableCell>
                          <TableCell className="text-white/30 text-center">{blank ?? money(0)}</TableCell>
                          <TableCell className="text-white/30 text-center">{blank ?? money(0)}</TableCell>
                        </TableRow>
                      );
                    })}
                    {!salesBreakdownRows.length && (
                      <TableRow className="border-[#24242d] bg-[#07070a]">
                        <TableCell colSpan={6} className="text-center text-yellow-200 py-6">No periods in this date range.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {reportType === 'rankings' && (
        <div className="space-y-4">
          {/* TOP 5 PRODUCT RANKINGS */}
          <Card className="bg-[#0b0b0f] border-[#24242d] shadow-xl overflow-hidden">
            <CardHeader className="border-b border-[#1f1f2b] pb-4 bg-[#0e0e14]">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-yellow-300 flex items-center gap-2.5 text-lg font-bold">
                    <BarChart3 className="w-5 h-5 text-yellow-400" />
                    Top 5 Product Rankings
                  </CardTitle>
                  <p className="mt-1 text-xs text-zinc-400">
                    Performance rankings across brand, size, variant, category, department, and payment method • {selectedRangeLabel}
                  </p>
                </div>

                {/* Controls: Timeframe Quick-Pills + Metric Toggle */}
                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Timeframe Quick-Pills */}
                  <div className="flex items-center bg-[#151520] border border-[#2b2b3b] rounded-xl p-1 shadow-inner">
                    {(['daily', 'weekly', 'monthly', 'quarterly', 'annually'] as const).map((period) => (
                      <button
                        key={period}
                        type="button"
                        onClick={() => setTimeRange(period)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-all ${
                          timeRange === period
                            ? 'bg-yellow-400 text-red-950 font-bold shadow'
                            : 'text-zinc-400 hover:text-white'
                        }`}
                      >
                        {period}
                      </button>
                    ))}
                  </div>

                  {/* Metric Switcher */}
                  <div className="flex items-center bg-[#151520] border border-[#2b2b3b] rounded-xl p-1 shadow-inner">
                    <button
                      type="button"
                      onClick={() => setTopSortBy('units')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                        topSortBy === 'units'
                          ? 'bg-yellow-400 text-red-950 font-bold shadow'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Pairs Sold
                    </button>
                    <button
                      type="button"
                      onClick={() => setTopSortBy('revenue')}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                        topSortBy === 'revenue'
                          ? 'bg-yellow-400 text-red-950 font-bold shadow'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Revenue (PHP)
                    </button>
                  </div>
                </div>
              </div>

              {/* Dimension Navigation Tabs */}
              <div className="flex items-center gap-1.5 pt-3 overflow-x-auto [scrollbar-width:none]">
                {[
                  { id: 'products', label: 'Shoe Models', icon: Package },
                  { id: 'brand', label: 'Brand', icon: Tag },
                  { id: 'size', label: 'Size', icon: Layers },
                  { id: 'variant', label: 'Variant (Color)', icon: Sparkles },
                  { id: 'category', label: 'Category', icon: BarChart3 },
                  { id: 'gender', label: 'Department', icon: UserCheck },
                  { id: 'payment', label: 'Payment Method', icon: CreditCard },
                  { id: 'grid', label: 'All Dimensions (Grid)', icon: Grid },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = topDimensionTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setTopDimensionTab(tab.id as any)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                        isActive
                          ? 'bg-yellow-400/15 text-yellow-300 border border-yellow-400/40 font-bold'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </CardHeader>

            <CardContent className="p-5">
              {topDimensionTab !== 'grid' ? (
                // SINGLE DIMENSION FORMAL VIEW
                <div className="space-y-2.5">
                  {(() => {
                    const currentList =
                      topSortBy === 'units'
                        ? (topRankings as any)[topDimensionTab]?.byUnits ?? []
                        : (topRankings as any)[topDimensionTab]?.byRevenue ?? [];

                    if (!currentList.length) {
                      return (
                        <div className="py-12 text-center text-zinc-400 text-sm">
                          No sales recorded for this period ({selectedRangeLabel}).
                        </div>
                      );
                    }

                    return currentList.map((item: any) => (
                      <div
                        key={item.key}
                        className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border bg-[#101017] border-[#222230] hover:border-[#333346] transition-colors"
                      >
                        <div className="flex items-center gap-3.5">
                          {/* Formal Numeric Rank Badge */}
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs bg-[#161622] text-zinc-300 border border-[#2a2a3c] shrink-0">
                            {item.rank}
                          </div>

                          <div>
                            <p className="text-yellow-100 font-semibold text-sm">
                              {item.name}
                            </p>
                            {item.subtitle && (
                              <p className="text-xs text-zinc-400 mt-0.5">{item.subtitle}</p>
                            )}
                          </div>
                        </div>

                        <div className="mt-2.5 sm:mt-0 flex items-center gap-6 sm:justify-end">
                          {/* Relative Share Bar */}
                          <div className="w-28 sm:w-36 hidden md:block">
                            <div className="flex justify-between text-[11px] text-zinc-400 mb-1">
                              <span>Share</span>
                              <span>{item.share}%</span>
                            </div>
                            <div className="w-full bg-[#1e1e2c] h-1.5 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-yellow-400/80"
                                style={{ width: `${item.share}%` }}
                              />
                            </div>
                          </div>

                          {/* Metric Numbers */}
                          <div className="text-right min-w-[120px]">
                            <p className="text-yellow-300 font-semibold text-sm">
                              {money(item.revenue)}
                            </p>
                            <p className="text-xs text-zinc-400">
                              {item.sales.toLocaleString()} {topDimensionTab === 'payment' ? 'transactions' : 'pairs'}
                            </p>
                          </div>
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                // FORMAL GRID VIEW: ALL DIMENSIONS SIDE-BY-SIDE
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {[
                    { title: 'Shoe Models', list: topSortBy === 'units' ? topRankings.products.byUnits : topRankings.products.byRevenue, icon: Package },
                    { title: 'Brand', list: topSortBy === 'units' ? topRankings.brand.byUnits : topRankings.brand.byRevenue, icon: Tag },
                    { title: 'Size', list: topSortBy === 'units' ? topRankings.size.byUnits : topRankings.size.byRevenue, icon: Layers },
                    { title: 'Variant (Color)', list: topSortBy === 'units' ? topRankings.variant.byUnits : topRankings.variant.byRevenue, icon: Sparkles },
                    { title: 'Category', list: topSortBy === 'units' ? topRankings.category.byUnits : topRankings.category.byRevenue, icon: BarChart3 },
                    { title: 'Department', list: topSortBy === 'units' ? topRankings.gender.byUnits : topRankings.gender.byRevenue, icon: UserCheck },
                  ].map((dim) => {
                    const DimIcon = dim.icon;
                    return (
                      <div key={dim.title} className="bg-[#101018] border border-[#222232] rounded-xl p-4 space-y-3">
                        <div className="flex items-center justify-between border-b border-[#1f1f2e] pb-2">
                          <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5">
                            <DimIcon className="w-3.5 h-3.5 text-yellow-400" />
                            Top 5 {dim.title}
                          </h4>
                          <span className="text-[10px] text-zinc-400">
                            {topSortBy === 'units' ? 'by units' : 'by revenue'}
                          </span>
                        </div>

                        <div className="space-y-2">
                          {dim.list.map((item: any) => (
                            <div key={item.key} className="flex items-center justify-between text-xs py-1.5 border-b border-[#181824] last:border-0">
                              <div className="flex items-center gap-2 overflow-hidden pr-2">
                                <span className="w-5 h-5 rounded flex items-center justify-center font-medium text-[11px] bg-[#161622] text-zinc-400 border border-[#262638] shrink-0">
                                  {item.rank}
                                </span>
                                <span className="text-zinc-200 truncate font-medium">{item.name}</span>
                              </div>
                              <div className="text-right shrink-0">
                                <span className="text-yellow-300 font-semibold">
                                  {topSortBy === 'units' ? `${item.sales} pairs` : money(item.revenue)}
                                </span>
                              </div>
                            </div>
                          ))}
                          {!dim.list.length && (
                            <p className="text-xs text-zinc-500 py-3 text-center">No sales recorded.</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {(reportType === 'specific_category_all' ||
        ['products', 'brands', 'categories', 'departments', 'sizes', 'variants', 'payments'].includes(reportType)) && (
        <div className="space-y-6">
          {/* Main Top Header & Filter Pills */}
          <Card className="bg-[#0b0b0f] border-[#24242d] shadow-xl overflow-hidden">
            <CardHeader className="border-b border-[#1f1f2b] pb-4 bg-[#0e0e14]">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-yellow-300 flex items-center gap-2.5 text-lg font-bold">
                    <Layers className="w-5 h-5 text-yellow-400" />
                    Specific & Category Performance Reports
                  </CardTitle>
                  <p className="mt-1 text-xs text-zinc-400">
                    Comprehensive shoe models, brand performance, categories, departments, sizes, variants, and payment channels in one page • {selectedRangeLabel}
                  </p>
                </div>

                {/* Controls: Timeframe Quick-Pills */}
                <div className="flex items-center bg-[#151520] border border-[#2b2b3b] rounded-xl p-1 shadow-inner shrink-0">
                  {(['daily', 'weekly', 'monthly', 'quarterly', 'annually'] as const).map((period) => (
                    <button
                      key={period}
                      type="button"
                      onClick={() => setTimeRange(period)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold capitalize transition-all ${
                        timeRange === period
                          ? 'bg-yellow-400 text-red-950 font-bold shadow'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {period}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sub-Section Filter / Jump Tabs */}
              <div className="flex items-center gap-1.5 pt-3 overflow-x-auto [scrollbar-width:none]">
                {[
                  { id: 'all', label: 'All In One Page', icon: Layers },
                  { id: 'shoe', label: 'Shoe Model Drilldown', icon: Package },
                  { id: 'brands', label: 'Brand Performance', icon: Tag },
                  { id: 'categories', label: 'Categories', icon: BarChart3 },
                  { id: 'departments', label: 'Departments', icon: UserCheck },
                  { id: 'sizes', label: 'Size Distribution', icon: Layers },
                  { id: 'variants', label: 'Variant (Color)', icon: Sparkles },
                  { id: 'payments', label: 'Payment Methods', icon: CreditCard },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const isActive = drilldownSection === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDrilldownSection(tab.id as any)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                        isActive
                          ? 'bg-yellow-400/15 text-yellow-300 border border-yellow-400/40 font-bold'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 border border-transparent'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </CardHeader>
          </Card>

          {/* SECTION 1: SPECIFIC SHOE DRILLDOWN */}
          {(drilldownSection === 'all' || drilldownSection === 'shoe') && (
            <Card className="bg-[#0b0b0f] border-[#24242d] shadow-xl">
            <CardHeader className="border-b border-[#1f1f2b] pb-4 bg-[#0e0e14]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-yellow-300 flex items-center gap-2.5 text-lg font-bold">
                    <Package className="w-5 h-5 text-yellow-400" />
                    Specific Shoe Model Performance Report
                  </CardTitle>
                  <p className="mt-1 text-xs text-zinc-400">
                    Deep performance analytics, sizes sold, and stock metrics for any shoe model • {selectedRangeLabel}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative w-64">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-zinc-400" />
                    <input
                      type="text"
                      value={shoeSearchQuery}
                      onChange={(e) => {
                        setShoeSearchQuery(e.target.value);
                        setSelectedShoeName('');
                      }}
                      placeholder="Search shoe (e.g. LeBron 20)..."
                      className="h-9 w-full rounded-lg border border-[#2b2b3b] bg-[#151520] pl-9 pr-3 text-xs text-white placeholder:text-zinc-500 focus:border-yellow-400 focus:outline-none"
                    />
                  </div>
                  <Select
                    value={activeShoeName}
                    onValueChange={(val) => {
                      setSelectedShoeName(val);
                      setShoeSearchQuery('');
                    }}
                  >
                    <SelectTrigger className="w-56 h-9 bg-[#151520] border-[#2b2b3b] text-white text-xs">
                      <SelectValue placeholder="Select shoe model" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#12121a] border-[#2b2b3b] text-white max-h-60">
                      {allShoeModels.map((shoe) => (
                        <SelectItem key={shoe} value={shoe} className="text-xs">
                          {shoe}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {shoeDetailReport ? (
                <div className="space-y-6">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-xl border bg-[#101017] border-[#222230]">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-yellow-400 text-black font-semibold text-xs">
                          {shoeDetailReport.brand}
                        </Badge>
                        <Badge variant="outline" className="border-zinc-700 text-zinc-300 text-xs">
                          {shoeDetailReport.category}
                        </Badge>
                        <Badge variant="outline" className="border-zinc-700 text-zinc-300 text-xs">
                          {shoeDetailReport.department}
                        </Badge>
                      </div>
                      <h3 className="text-xl font-bold text-white mt-2">{shoeDetailReport.name}</h3>
                      <p className="text-xs text-zinc-400 mt-1">
                        Retail Price: <span className="text-yellow-300 font-semibold">{money(shoeDetailReport.basePrice)}</span> • Cost Price: <span className="text-zinc-300">{money(shoeDetailReport.costPrice)}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-xs text-zinc-400 uppercase tracking-wider">Gross Margin</p>
                        <p className="text-lg font-bold text-green-400">{shoeDetailReport.margin}%</p>
                      </div>
                      <div className="text-right border-l border-zinc-800 pl-6">
                        <p className="text-xs text-zinc-400 uppercase tracking-wider">Total Stock on Hand</p>
                        <p className="text-lg font-bold text-yellow-300">{shoeDetailReport.totalStock} pairs</p>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Pairs Sold ({selectedRangeLabel})</p>
                      <p className="mt-2 text-2xl font-bold text-white">{shoeDetailReport.totalPairs.toLocaleString()}</p>
                      <p className="mt-1 text-xs text-zinc-400">Total units transferred</p>
                    </div>
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Gross Revenue</p>
                      <p className="mt-2 text-2xl font-bold text-yellow-300">{money(shoeDetailReport.totalRevenue)}</p>
                      <p className="mt-1 text-xs text-zinc-400">Avg ticket {money(shoeDetailReport.avgPrice)}</p>
                    </div>
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Estimated Profit</p>
                      <p className="mt-2 text-2xl font-bold text-green-400">{money(shoeDetailReport.profit)}</p>
                      <p className="mt-1 text-xs text-zinc-400">{shoeDetailReport.margin}% profit margin</p>
                    </div>
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Stock Availability</p>
                      <p className="mt-2 text-2xl font-bold text-white">{shoeDetailReport.totalStock} pairs</p>
                      <p className="mt-1 text-xs text-zinc-400">Across {shoeDetailReport.sizeBreakdown.length} size variants</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                      <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5 border-b border-[#1f1f2e] pb-2">
                        <Layers className="w-4 h-4 text-yellow-400" />
                        Size Distribution & Availability
                      </h4>
                      <Table>
                        <TableHeader className="bg-[#161622]">
                          <TableRow className="border-[#222232]">
                            <TableHead className="text-yellow-300 text-xs">Size (EU)</TableHead>
                            <TableHead className="text-yellow-300 text-xs text-center">Pairs Sold</TableHead>
                            <TableHead className="text-yellow-300 text-xs text-center">Revenue</TableHead>
                            <TableHead className="text-yellow-300 text-xs text-center">In Stock</TableHead>
                            <TableHead className="text-yellow-300 text-xs text-right">Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {shoeDetailReport.sizeBreakdown.map((row) => (
                            <TableRow key={row.size} className="border-[#1e1e2c] hover:bg-white/[0.03]">
                              <TableCell className="text-white font-medium text-xs">{row.size}</TableCell>
                              <TableCell className="text-zinc-300 text-xs text-center font-semibold">{row.pairs}</TableCell>
                              <TableCell className="text-yellow-300 text-xs text-center">{money(row.revenue)}</TableCell>
                              <TableCell className="text-zinc-300 text-xs text-center">{row.stock}</TableCell>
                              <TableCell className="text-right">
                                <Badge className={row.status === 'Out of Stock' ? 'bg-red-950 text-red-300 text-[10px]' : row.status === 'Low Stock' ? 'bg-amber-950 text-amber-300 text-[10px]' : 'bg-green-950 text-green-300 text-[10px]'}>
                                  {row.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                          {!shoeDetailReport.sizeBreakdown.length && (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center text-zinc-500 py-4 text-xs">No size data available.</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>

                    <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                      <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5 border-b border-[#1f1f2e] pb-2">
                        <Sparkles className="w-4 h-4 text-yellow-400" />
                        Colorway / Variant Sales
                      </h4>
                      <Table>
                        <TableHeader className="bg-[#161622]">
                          <TableRow className="border-[#222232]">
                            <TableHead className="text-yellow-300 text-xs">Variant / Color</TableHead>
                            <TableHead className="text-yellow-300 text-xs text-center">Pairs Sold</TableHead>
                            <TableHead className="text-yellow-300 text-xs text-right">Revenue</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {shoeDetailReport.variantBreakdown.map((v) => (
                            <TableRow key={v.color} className="border-[#1e1e2c] hover:bg-white/[0.03]">
                              <TableCell className="text-white font-medium text-xs">{v.color}</TableCell>
                              <TableCell className="text-zinc-300 text-xs text-center font-semibold">{v.pairs}</TableCell>
                              <TableCell className="text-yellow-300 text-xs text-right font-semibold">{money(v.revenue)}</TableCell>
                            </TableRow>
                          ))}
                          {!shoeDetailReport.variantBreakdown.length && (
                            <TableRow>
                              <TableCell colSpan={3} className="text-center text-zinc-500 py-4 text-xs">No variant sales recorded in this period.</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                    <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5 border-b border-[#1f1f2e] pb-2">
                      <ShoppingBag className="w-4 h-4 text-yellow-400" />
                      Recent Sales Transactions for this Shoe
                    </h4>
                    <Table>
                      <TableHeader className="bg-[#161622]">
                        <TableRow className="border-[#222232]">
                          <TableHead className="text-yellow-300 text-xs">Date</TableHead>
                          <TableHead className="text-yellow-300 text-xs">Receipt / Sale ID</TableHead>
                          <TableHead className="text-yellow-300 text-xs">Customer</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Size</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Color</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Qty</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Total Paid</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-right">Payment</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {shoeDetailReport.transactions.slice(0, 15).map((tx, idx) => (
                          <TableRow key={`${tx.saleId}-${idx}`} className="border-[#1e1e2c] hover:bg-white/[0.03]">
                            <TableCell className="text-zinc-300 text-xs">{tx.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</TableCell>
                            <TableCell className="text-yellow-200 font-mono text-xs">{tx.saleId}</TableCell>
                            <TableCell className="text-white text-xs">{tx.customer}</TableCell>
                            <TableCell className="text-zinc-300 text-xs text-center">{tx.size}</TableCell>
                            <TableCell className="text-zinc-400 text-xs text-center">{tx.color}</TableCell>
                            <TableCell className="text-zinc-200 text-xs text-center font-bold">{tx.qty}</TableCell>
                            <TableCell className="text-yellow-300 text-xs text-center font-semibold">{money(tx.subtotal)}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant="outline" className="border-yellow-400/30 text-yellow-300 text-[10px]">
                                {tx.payment}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                        {!shoeDetailReport.transactions.length && (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center text-zinc-500 py-6 text-xs">No transactions recorded for this shoe in {selectedRangeLabel}.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-zinc-400 text-sm">
                  No shoe model selected or matching search. Try searching &quot;LeBron 20&quot; or selecting from the dropdown.
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {/* SECTION 2: BRAND PERFORMANCE */}
          {(drilldownSection === 'all' || drilldownSection === 'brands') && (
            <Card className="bg-[#0b0b0f] border-[#24242d] shadow-xl">
            <CardHeader className="border-b border-[#1f1f2b] pb-4 bg-[#0e0e14]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-yellow-300 flex items-center gap-2.5 text-lg font-bold">
                    <Tag className="w-5 h-5 text-yellow-400" />
                    Brand Performance Report
                  </CardTitle>
                  <p className="mt-1 text-xs text-zinc-400">
                    Comprehensive brand analytics, shoe models sold, and market share • {selectedRangeLabel}
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xs text-zinc-400">Filter Brand:</span>
                  <Select value={brandFilter} onValueChange={setBrandFilter}>
                    <SelectTrigger className="w-48 h-9 bg-[#151520] border-[#2b2b3b] text-white text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#12121a] border-[#2b2b3b] text-white max-h-60">
                      <SelectItem value="all" className="text-xs font-semibold text-yellow-300">
                        All Brands (Overview)
                      </SelectItem>
                      {allBrands.map((b) => (
                        <SelectItem key={b} value={b} className="text-xs">
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {brandFilter !== 'all' && brandDetailReport.selectedBrandData ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Total Pairs Sold</p>
                      <p className="mt-2 text-2xl font-bold text-white">{brandDetailReport.selectedBrandData.sales.toLocaleString()}</p>
                      <p className="mt-1 text-xs text-zinc-400">Across all {brandDetailReport.selectedBrandModels.length} models</p>
                    </div>
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Gross Revenue</p>
                      <p className="mt-2 text-2xl font-bold text-yellow-300">{money(brandDetailReport.selectedBrandData.revenue)}</p>
                      <p className="mt-1 text-xs text-zinc-400">{brandDetailReport.selectedBrandData.storeShare}% of total store revenue</p>
                    </div>
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Profit Margin</p>
                      <p className="mt-2 text-2xl font-bold text-green-400">{brandDetailReport.selectedBrandData.margin}%</p>
                      <p className="mt-1 text-xs text-zinc-400">Gross profit margin</p>
                    </div>
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Stock on Hand</p>
                      <p className="mt-2 text-2xl font-bold text-white">{brandDetailReport.selectedBrandData.stock} pairs</p>
                      <p className="mt-1 text-xs text-zinc-400">Available inventory</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                    <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5 border-b border-[#1f1f2e] pb-2">
                      <Package className="w-4 h-4 text-yellow-400" />
                      Shoe Models Under {brandDetailReport.activeBrand}
                    </h4>
                    <Table>
                      <TableHeader className="bg-[#161622]">
                        <TableRow className="border-[#222232]">
                          <TableHead className="text-yellow-300 text-xs w-16">Rank</TableHead>
                          <TableHead className="text-yellow-300 text-xs">Shoe Model</TableHead>
                          <TableHead className="text-yellow-300 text-xs">Category</TableHead>
                          <TableHead className="text-yellow-300 text-xs">Department</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Pairs Sold</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Revenue</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Brand Share</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-right">In Stock</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {brandDetailReport.selectedBrandModels.map((m) => (
                          <TableRow key={m.name} className="border-[#1e1e2c] hover:bg-white/[0.03]">
                            <TableCell className="text-zinc-400 font-bold text-xs">#{m.rank}</TableCell>
                            <TableCell className="text-white font-medium text-xs">{m.name}</TableCell>
                            <TableCell className="text-zinc-300 text-xs">{m.category}</TableCell>
                            <TableCell className="text-zinc-400 text-xs">{m.department}</TableCell>
                            <TableCell className="text-zinc-200 font-bold text-xs text-center">{m.sales}</TableCell>
                            <TableCell className="text-yellow-300 font-semibold text-xs text-center">{money(m.revenue)}</TableCell>
                            <TableCell className="text-zinc-300 text-xs text-center">{m.share}%</TableCell>
                            <TableCell className="text-zinc-300 text-xs text-right">{m.stock} pairs</TableCell>
                          </TableRow>
                        ))}
                        {!brandDetailReport.selectedBrandModels.length && (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center text-zinc-500 py-6 text-xs">No models sold for {brandDetailReport.activeBrand} in this date range.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                      <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5 border-b border-[#1f1f2e] pb-2">
                        <Layers className="w-4 h-4 text-yellow-400" />
                        Sizes Sold for {brandDetailReport.activeBrand}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {brandDetailReport.selectedBrandSizes.map((s) => (
                          <div key={s.size} className="rounded-lg border border-[#28283a] bg-[#141420] px-3 py-1.5 text-xs">
                            <span className="text-zinc-400 mr-2">{s.size}:</span>
                            <span className="text-yellow-300 font-bold">{s.pairs} pairs</span>
                          </div>
                        ))}
                        {!brandDetailReport.selectedBrandSizes.length && (
                          <p className="text-xs text-zinc-500">No size sales recorded.</p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                      <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5 border-b border-[#1f1f2e] pb-2">
                        <UserCheck className="w-4 h-4 text-yellow-400" />
                        Department Split for {brandDetailReport.activeBrand}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        {brandDetailReport.selectedBrandDepts.map((d) => (
                          <div key={d.dept} className="rounded-lg border border-[#28283a] bg-[#141420] px-3 py-1.5 text-xs">
                            <span className="text-zinc-400 mr-2">{d.dept}:</span>
                            <span className="text-yellow-300 font-bold">{d.pairs} pairs</span>
                          </div>
                        ))}
                        {!brandDetailReport.selectedBrandDepts.length && (
                          <p className="text-xs text-zinc-500">No department sales recorded.</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Active Brands</p>
                      <p className="mt-2 text-2xl font-bold text-white">{brandDetailReport.allBrandsList.length}</p>
                      <p className="mt-1 text-xs text-zinc-400">Brands with sales in period</p>
                    </div>
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Top Brand by Volume</p>
                      <p className="mt-2 text-2xl font-bold text-yellow-300">{brandDetailReport.allBrandsList[0]?.name ?? 'N/A'}</p>
                      <p className="mt-1 text-xs text-zinc-400">{brandDetailReport.allBrandsList[0]?.sales ?? 0} pairs sold</p>
                    </div>
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Top Brand Revenue</p>
                      <p className="mt-2 text-2xl font-bold text-green-400">{money(brandDetailReport.allBrandsList[0]?.revenue ?? 0)}</p>
                      <p className="mt-1 text-xs text-zinc-400">{brandDetailReport.allBrandsList[0]?.share ?? 0}% market share</p>
                    </div>
                    <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                      <p className="text-xs uppercase tracking-wide text-yellow-200/70">Total Brand Revenue</p>
                      <p className="mt-2 text-2xl font-bold text-white">{money(brandDetailReport.allBrandsList.reduce((sum, b) => sum + b.revenue, 0))}</p>
                      <p className="mt-1 text-xs text-zinc-400">All brands combined</p>
                    </div>
                  </div>

                  {brandDetailReport.allBrandsList.length > 0 && (
                    <div className="rounded-xl border border-[#222232] bg-[#101018] p-4">
                      <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold mb-3 flex items-center gap-1.5">
                        <BarChart3 className="w-4 h-4 text-yellow-400" />
                        Brand Market Share & Volume Comparison
                      </h4>
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={brandDetailReport.allBrandsList} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#24242d" vertical={false} />
                          <XAxis dataKey="name" stroke="#a1a1aa" fontSize={11} />
                          <YAxis yAxisId="left" stroke="#facc15" fontSize={11} tickFormatter={(v) => moneyCompact(Number(v))} />
                          <YAxis yAxisId="right" orientation="right" stroke="#38bdf8" fontSize={11} />
                          <Tooltip content={<ChartWhiteTooltip />} />
                          <Legend wrapperStyle={{ fontSize: '11px', color: '#facc15' }} />
                          <Bar yAxisId="left" dataKey="revenue" fill="#facc15" name="Revenue (PHP)" radius={[4, 4, 0, 0]} />
                          <Bar yAxisId="right" dataKey="sales" fill="#38bdf8" name="Pairs Sold" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                    <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold flex items-center gap-1.5 border-b border-[#1f1f2e] pb-2">
                      <Tag className="w-4 h-4 text-yellow-400" />
                      All Brands Ranking & Performance (Click any brand to view drilldown)
                    </h4>
                    <Table>
                      <TableHeader className="bg-[#161622]">
                        <TableRow className="border-[#222232]">
                          <TableHead className="text-yellow-300 text-xs w-16">Rank</TableHead>
                          <TableHead className="text-yellow-300 text-xs">Brand Name</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Pairs Sold</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Gross Revenue</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Revenue Share</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Profit Margin</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-center">Avg Price</TableHead>
                          <TableHead className="text-yellow-300 text-xs text-right">In Stock</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {brandDetailReport.allBrandsList.map((b) => (
                          <TableRow
                            key={b.name}
                            onClick={() => setBrandFilter(b.name)}
                            className="border-[#1e1e2c] hover:bg-yellow-400/5 cursor-pointer transition-colors"
                          >
                            <TableCell className="text-zinc-400 font-bold text-xs">#{b.rank}</TableCell>
                            <TableCell className="text-yellow-100 font-semibold text-xs flex items-center gap-1.5">
                              {b.name}
                              <ArrowUpRight className="w-3 h-3 text-yellow-400 opacity-60" />
                            </TableCell>
                            <TableCell className="text-zinc-200 font-bold text-xs text-center">{b.sales}</TableCell>
                            <TableCell className="text-yellow-300 font-semibold text-xs text-center">{money(b.revenue)}</TableCell>
                            <TableCell className="text-zinc-300 text-xs text-center font-medium">{b.share}%</TableCell>
                            <TableCell className="text-green-400 text-xs text-center font-medium">{b.margin}%</TableCell>
                            <TableCell className="text-zinc-300 text-xs text-center">{money(b.avgPrice)}</TableCell>
                            <TableCell className="text-zinc-300 text-xs text-right">{b.stock} pairs</TableCell>
                          </TableRow>
                        ))}
                        {!brandDetailReport.allBrandsList.length && (
                          <TableRow>
                            <TableCell colSpan={8} className="text-center text-zinc-500 py-6 text-xs">No brand sales recorded for this date range.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
          )}

          {/* SECTION 3: CATEGORIES & DEPARTMENTS */}
          {(drilldownSection === 'all' || drilldownSection === 'categories' || drilldownSection === 'departments') && (
            <div className={`grid grid-cols-1 ${drilldownSection === 'all' ? 'xl:grid-cols-2' : ''} gap-4`}>
              {(drilldownSection === 'all' || drilldownSection === 'categories') && (
                <Card className="bg-[#0b0b0f] border-[#24242d] shadow-xl">
            <CardHeader className="border-b border-[#1f1f2b] pb-4 bg-[#0e0e14]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-yellow-300 flex items-center gap-2.5 text-lg font-bold">
                    <BarChart3 className="w-5 h-5 text-yellow-400" />
                    Category Performance Report
                  </CardTitle>
                  <p className="mt-1 text-xs text-zinc-400">
                    Category demand, shoe models, and revenue breakdown • {selectedRangeLabel}
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xs text-zinc-400">Filter Category:</span>
                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-48 h-9 bg-[#151520] border-[#2b2b3b] text-white text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#12121a] border-[#2b2b3b] text-white max-h-60">
                      <SelectItem value="all" className="text-xs font-semibold text-yellow-300">
                        All Categories
                      </SelectItem>
                      {allCategories.map((c) => (
                        <SelectItem key={c} value={c} className="text-xs">
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {categoryDetailReport.allCategoriesList.length > 0 && (
                <div className="rounded-xl border border-[#222232] bg-[#101018] p-4">
                  <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold mb-2 flex items-center gap-1.5">
                    <BarChart3 className="w-4 h-4 text-yellow-400" />
                    Category Revenue Comparison
                  </h4>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={categoryDetailReport.allCategoriesList} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#24242d" vertical={false} />
                      <XAxis dataKey="name" stroke="#a1a1aa" fontSize={11} />
                      <YAxis stroke="#facc15" fontSize={11} tickFormatter={(v) => moneyCompact(Number(v))} />
                      <Tooltip content={<ChartWhiteTooltip />} />
                      <Bar dataKey="revenue" fill="#facc15" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                <Table>
                  <TableHeader className="bg-[#161622]">
                    <TableRow className="border-[#222232]">
                      <TableHead className="text-yellow-300 text-xs w-16">Rank</TableHead>
                      <TableHead className="text-yellow-300 text-xs">Category</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Pairs Sold</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Gross Revenue</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Revenue Share</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-right">Avg Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {categoryDetailReport.allCategoriesList.map((c) => (
                      <TableRow key={c.name} className="border-[#1e1e2c] hover:bg-white/[0.03]">
                        <TableCell className="text-zinc-400 font-bold text-xs">#{c.rank}</TableCell>
                        <TableCell className="text-white font-medium text-xs">{c.name}</TableCell>
                        <TableCell className="text-zinc-200 font-bold text-xs text-center">{c.sales}</TableCell>
                        <TableCell className="text-yellow-300 font-semibold text-xs text-center">{money(c.revenue)}</TableCell>
                        <TableCell className="text-zinc-300 text-xs text-center">{c.share}%</TableCell>
                        <TableCell className="text-zinc-300 text-xs text-right">{money(c.avgPrice)}</TableCell>
                      </TableRow>
                    ))}
                    {!categoryDetailReport.allCategoriesList.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-zinc-500 py-6 text-xs">No category sales recorded for this date range.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          )}

          {(drilldownSection === 'all' || drilldownSection === 'departments') && (
            <Card className="bg-[#0b0b0f] border-[#24242d] shadow-xl">
            <CardHeader className="border-b border-[#1f1f2b] pb-4 bg-[#0e0e14]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-yellow-300 flex items-center gap-2.5 text-lg font-bold">
                    <UserCheck className="w-5 h-5 text-yellow-400" />
                    Department Performance Report
                  </CardTitle>
                  <p className="mt-1 text-xs text-zinc-400">
                    Men&apos;s, Women&apos;s, Unisex, and Kids footwear department analytics • {selectedRangeLabel}
                  </p>
                </div>
                <div className="flex items-center gap-2.5">
                  <span className="text-xs text-zinc-400">Department:</span>
                  <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
                    <SelectTrigger className="w-48 h-9 bg-[#151520] border-[#2b2b3b] text-white text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-[#12121a] border-[#2b2b3b] text-white">
                      <SelectItem value="all" className="text-xs font-semibold text-yellow-300">All Departments</SelectItem>
                      <SelectItem value="Men" className="text-xs">Men</SelectItem>
                      <SelectItem value="Women" className="text-xs">Women</SelectItem>
                      <SelectItem value="Unisex" className="text-xs">Unisex</SelectItem>
                      <SelectItem value="Kids" className="text-xs">Kids</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {departmentDetailReport.allDeptsList.length > 0 && (
                <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 flex flex-col items-center">
                  <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold mb-1 w-full text-left flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-yellow-400" />
                    Department Revenue Share
                  </h4>
                  <ResponsiveContainer width="100%" height={170}>
                    <PieChart>
                      <Pie
                        data={departmentDetailReport.allDeptsList}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={70}
                        paddingAngle={3}
                        dataKey="revenue"
                        nameKey="name"
                      >
                        {departmentDetailReport.allDeptsList.map((entry) => (
                          <Cell key={entry.name} fill={getDepartmentColor(entry.name)} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartWhiteTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap items-center justify-center gap-2.5 text-xs text-zinc-300 mt-2">
                    {departmentDetailReport.allDeptsList.map((entry) => {
                      const color = getDepartmentColor(entry.name);
                      return (
                        <span
                          key={entry.name}
                          className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#161622] border border-[#2b2b3d] shadow-sm"
                        >
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-white font-medium">{entry.name}</span>
                          <span className="text-yellow-300 font-semibold">({entry.share}%)</span>
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                <Table>
                  <TableHeader className="bg-[#161622]">
                    <TableRow className="border-[#222232]">
                      <TableHead className="text-yellow-300 text-xs w-16">Rank</TableHead>
                      <TableHead className="text-yellow-300 text-xs">Department</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Pairs Sold</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Gross Revenue</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Revenue Share</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-right">Avg Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {departmentDetailReport.allDeptsList.map((d) => (
                      <TableRow key={d.name} className="border-[#1e1e2c] hover:bg-white/[0.03]">
                        <TableCell className="text-zinc-400 font-bold text-xs">#{d.rank}</TableCell>
                        <TableCell className="text-white font-medium text-xs">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getDepartmentColor(d.name) }} />
                            {d.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-zinc-200 font-bold text-xs text-center">{d.sales}</TableCell>
                        <TableCell className="text-yellow-300 font-semibold text-xs text-center">{money(d.revenue)}</TableCell>
                        <TableCell className="text-zinc-300 text-xs text-center">{d.share}%</TableCell>
                        <TableCell className="text-zinc-300 text-xs text-right">{money(d.avgPrice)}</TableCell>
                      </TableRow>
                    ))}
                    {!departmentDetailReport.allDeptsList.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-zinc-500 py-6 text-xs">No department sales recorded for this date range.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          )}
        </div>
      )}

      {/* SECTION 4: SIZES & VARIANTS */}
      {(drilldownSection === 'all' || drilldownSection === 'sizes' || drilldownSection === 'variants') && (
        <div className={`grid grid-cols-1 ${drilldownSection === 'all' ? 'xl:grid-cols-2' : ''} gap-4`}>
          {(drilldownSection === 'all' || drilldownSection === 'sizes') && (
            <Card className="bg-[#0b0b0f] border-[#24242d] shadow-xl">
            <CardHeader className="border-b border-[#1f1f2b] pb-4 bg-[#0e0e14]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-yellow-300 flex items-center gap-2.5 text-lg font-bold">
                    <Layers className="w-5 h-5 text-yellow-400" />
                    Size Distribution Performance Report
                  </CardTitle>
                  <p className="mt-1 text-xs text-zinc-400">
                    Footwear sizing distribution, volume curve, and customer demand • {selectedRangeLabel}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {sizeDetailReport.allSizesList.length > 0 && (
                <div className="rounded-xl border border-[#222232] bg-[#101018] p-4">
                  <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold mb-2 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-yellow-400" />
                    Footwear Sizing Demand Curve (EU Sizes)
                  </h4>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={[...sizeDetailReport.allSizesList].sort((a, b) => compareSizes(a.name, b.name))} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#24242d" vertical={false} />
                      <XAxis dataKey="name" stroke="#a1a1aa" fontSize={11} label={{ value: 'Size (EU)', position: 'insideBottom', offset: -2, fill: '#71717a', fontSize: 10 }} />
                      <YAxis stroke="#facc15" fontSize={11} allowDecimals={false} />
                      <Tooltip content={<ChartWhiteTooltip />} />
                      <Bar dataKey="sales" fill="#facc15" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                <Table>
                  <TableHeader className="bg-[#161622]">
                    <TableRow className="border-[#222232]">
                      <TableHead className="text-yellow-300 text-xs w-16">Rank</TableHead>
                      <TableHead className="text-yellow-300 text-xs">Shoe Size (EU)</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Pairs Sold</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Gross Revenue</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Volume Share</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-right">Avg Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sizeDetailReport.allSizesList.map((s) => (
                      <TableRow key={s.name} className="border-[#1e1e2c] hover:bg-white/[0.03]">
                        <TableCell className="text-zinc-400 font-bold text-xs">#{s.rank}</TableCell>
                        <TableCell className="text-white font-medium text-xs">{s.name}</TableCell>
                        <TableCell className="text-zinc-200 font-bold text-xs text-center">{s.sales}</TableCell>
                        <TableCell className="text-yellow-300 font-semibold text-xs text-center">{money(s.revenue)}</TableCell>
                        <TableCell className="text-zinc-300 text-xs text-center">{s.unitShare}%</TableCell>
                        <TableCell className="text-zinc-300 text-xs text-right">{money(s.avgPrice)}</TableCell>
                      </TableRow>
                    ))}
                    {!sizeDetailReport.allSizesList.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-zinc-500 py-6 text-xs">No size sales recorded for this date range.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          )}

          {(drilldownSection === 'all' || drilldownSection === 'variants') && (
            <Card className="bg-[#0b0b0f] border-[#24242d] shadow-xl">
            <CardHeader className="border-b border-[#1f1f2b] pb-4 bg-[#0e0e14]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-yellow-300 flex items-center gap-2.5 text-lg font-bold">
                    <Sparkles className="w-5 h-5 text-yellow-400" />
                    Variant & Colorway Report
                  </CardTitle>
                  <p className="mt-1 text-xs text-zinc-400">
                    Product colorway styles, visual finishes, and demand breakdown • {selectedRangeLabel}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-4">
              {variantDetailReport.allVariantsList.length > 0 && (
                <div className="rounded-xl border border-[#222232] bg-[#101018] p-4">
                  <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold mb-2 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-yellow-400" />
                    Colorway Popularity (Units Sold)
                  </h4>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={variantDetailReport.allVariantsList.slice(0, 8)} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#24242d" vertical={false} />
                      <XAxis dataKey="name" stroke="#a1a1aa" fontSize={10} />
                      <YAxis stroke="#a855f7" fontSize={11} allowDecimals={false} />
                      <Tooltip content={<ChartWhiteTooltip />} />
                      <Bar dataKey="sales" fill="#a855f7" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                <Table>
                  <TableHeader className="bg-[#161622]">
                    <TableRow className="border-[#222232]">
                      <TableHead className="text-yellow-300 text-xs w-16">Rank</TableHead>
                      <TableHead className="text-yellow-300 text-xs">Variant / Colorway</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Pairs Sold</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Gross Revenue</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Volume Share</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-right">Avg Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {variantDetailReport.allVariantsList.map((v) => (
                      <TableRow key={v.name} className="border-[#1e1e2c] hover:bg-white/[0.03]">
                        <TableCell className="text-zinc-400 font-bold text-xs">#{v.rank}</TableCell>
                        <TableCell className="text-white font-medium text-xs">{v.name}</TableCell>
                        <TableCell className="text-zinc-200 font-bold text-xs text-center">{v.sales}</TableCell>
                        <TableCell className="text-yellow-300 font-semibold text-xs text-center">{money(v.revenue)}</TableCell>
                        <TableCell className="text-zinc-300 text-xs text-center">{v.unitShare}%</TableCell>
                        <TableCell className="text-zinc-300 text-xs text-right">{money(v.avgPrice)}</TableCell>
                      </TableRow>
                    ))}
                    {!variantDetailReport.allVariantsList.length && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-zinc-500 py-6 text-xs">No variant sales recorded for this date range.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          )}
        </div>
      )}

      {/* SECTION 5: PAYMENT METHODS */}
      {(drilldownSection === 'all' || drilldownSection === 'payments') && (
        <Card className="bg-[#0b0b0f] border-[#24242d] shadow-xl">
            <CardHeader className="border-b border-[#1f1f2b] pb-4 bg-[#0e0e14]">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-yellow-300 flex items-center gap-2.5 text-lg font-bold">
                    <CreditCard className="w-5 h-5 text-yellow-400" />
                    Payment Method Performance Report
                  </CardTitle>
                  <p className="mt-1 text-xs text-zinc-400">
                    Payment channel breakdown, Cash vs GCash volume, and transaction velocity • {selectedRangeLabel}
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-5 space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                  <p className="text-xs uppercase tracking-wide text-yellow-200/70">Total Transactions</p>
                  <p className="mt-2 text-2xl font-bold text-white">{paymentDetailReport.totalTransactions.toLocaleString()}</p>
                  <p className="mt-1 text-xs text-zinc-400">Completed payments</p>
                </div>
                <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                  <p className="text-xs uppercase tracking-wide text-yellow-200/70">Total Collected</p>
                  <p className="mt-2 text-2xl font-bold text-yellow-300">{money(paymentDetailReport.totalRevenue)}</p>
                  <p className="mt-1 text-xs text-zinc-400">Gross funds captured</p>
                </div>
                <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                  <p className="text-xs uppercase tracking-wide text-yellow-200/70">Primary Channel</p>
                  <p className="mt-2 text-2xl font-bold text-green-400">{paymentDetailReport.allPaymentsList[0]?.name ?? 'N/A'}</p>
                  <p className="mt-1 text-xs text-zinc-400">{paymentDetailReport.allPaymentsList[0]?.share ?? 0}% of revenue</p>
                </div>
                <div className="rounded-xl border border-[#24242d] bg-[#07070a] p-4">
                  <p className="text-xs uppercase tracking-wide text-yellow-200/70">Average Ticket</p>
                  <p className="mt-2 text-2xl font-bold text-white">{money(paymentDetailReport.totalTransactions > 0 ? paymentDetailReport.totalRevenue / paymentDetailReport.totalTransactions : 0)}</p>
                  <p className="mt-1 text-xs text-zinc-400">Per payment transaction</p>
                </div>
              </div>

              {paymentDetailReport.allPaymentsList.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl border border-[#222232] bg-[#101018] p-4 items-center">
                  <div>
                    <h4 className="text-xs uppercase tracking-wider text-yellow-300 font-semibold mb-2 flex items-center gap-1.5">
                      <CreditCard className="w-4 h-4 text-yellow-400" />
                      Payment Method Share (Revenue)
                    </h4>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie
                          data={paymentDetailReport.allPaymentsList}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={70}
                          paddingAngle={4}
                          dataKey="revenue"
                          nameKey="name"
                        >
                          {paymentDetailReport.allPaymentsList.map((entry) => (
                            <Cell key={entry.name} fill={getPaymentMethodColor(entry.name)} />
                          ))}
                        </Pie>
                        <Tooltip content={<ChartWhiteTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-2.5">
                    {paymentDetailReport.allPaymentsList.map((entry) => {
                      const payColor = getPaymentMethodColor(entry.name);
                      return (
                        <div
                          key={entry.name}
                          className="p-3 rounded-xl border border-[#242436] bg-[#13131e] flex items-center justify-between shadow-sm transition-all hover:border-[#383852]"
                          style={{ borderLeft: `5px solid ${payColor}` }}
                        >
                          <div className="flex items-center gap-3">
                            <span className="w-3.5 h-3.5 rounded-full shrink-0 shadow-md ring-2 ring-white/10" style={{ backgroundColor: payColor }} />
                            <div>
                              <span className="text-xs font-bold text-white block">{entry.name}</span>
                              <span className="text-[11px] text-zinc-400 block">{entry.share}% revenue share</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-xs text-yellow-300 font-bold">{money(entry.revenue)}</span>
                            <span className="text-[10px] text-zinc-400 block">{entry.count} transactions • {entry.txnShare}% volume</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-[#222232] bg-[#101018] p-4 space-y-3">
                <Table>
                  <TableHeader className="bg-[#161622]">
                    <TableRow className="border-[#222232]">
                      <TableHead className="text-yellow-300 text-xs w-16">Rank</TableHead>
                      <TableHead className="text-yellow-300 text-xs">Payment Method</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Transactions</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Total Volume</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Transaction Share</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Revenue Share</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-right">Avg Ticket Size</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paymentDetailReport.allPaymentsList.map((p) => (
                      <TableRow key={p.name} className="border-[#1e1e2c] hover:bg-white/[0.03]">
                        <TableCell className="text-zinc-400 font-bold text-xs">#{p.rank}</TableCell>
                        <TableCell className="text-white font-medium text-xs">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: getPaymentMethodColor(p.name) }} />
                            {p.name}
                          </span>
                        </TableCell>
                        <TableCell className="text-zinc-200 font-bold text-xs text-center">{p.count}</TableCell>
                        <TableCell className="text-yellow-300 font-semibold text-xs text-center">{money(p.revenue)}</TableCell>
                        <TableCell className="text-zinc-300 text-xs text-center">{p.txnShare}%</TableCell>
                        <TableCell className="text-zinc-300 text-xs text-center font-semibold">{p.share}%</TableCell>
                        <TableCell className="text-zinc-300 text-xs text-right">{money(p.avgTx)}</TableCell>
                      </TableRow>
                    ))}
                    {!paymentDetailReport.allPaymentsList.length && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-zinc-500 py-6 text-xs">No payment transactions found for this date range.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          )}
        </div>
      )}

      {reportType === 'promotions' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: 'Promotions in period', value: String(promotionReport.rows.length) },
              { label: 'Sales from promotions', value: money(promotionReport.totalNet) },
              { label: 'Discounts given', value: money(promotionReport.totalDiscount) },
              { label: 'Met sales goal', value: `${promotionReport.metGoal} of ${promotionReport.withGoal}` },
            ].map((stat) => (
              <Card key={stat.label} className="bg-[#0b0b0f] border-[#24242d]">
                <CardContent className="pt-5">
                  <p className="text-xs uppercase tracking-wide text-white/50">{stat.label}</p>
                  <p className="mt-1 text-xl font-semibold text-white">{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardHeader>
              <CardTitle className="text-yellow-300 flex items-center gap-2">
                <Tag className="w-5 h-5" />
                Promotion Performance
              </CardTitle>
              <p className="mt-1 text-sm text-white/55">
                Sales and discounts in {selectedRangeLabel}. Goal progress counts every sale during the whole campaign.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table className="rounded-lg border border-[#24242d] bg-[#07070a]">
                  <TableHeader className="bg-[#0b0b0f]">
                    <TableRow className="border-[#24242d] hover:bg-[#0b0b0f]">
                      <TableHead className="text-yellow-300">Promotion</TableHead>
                      <TableHead className="text-yellow-300">Status</TableHead>
                      <TableHead className="text-yellow-300 text-center">Transactions</TableHead>
                      <TableHead className="text-yellow-300 text-center">Pairs</TableHead>
                      <TableHead className="text-yellow-300 text-right">Net Sales</TableHead>
                      <TableHead className="text-yellow-300 text-right">Discount Given</TableHead>
                      <TableHead className="text-yellow-300 min-w-[180px]">Goal Progress</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {promotionReport.rows.map((row) => (
                      <TableRow key={row.id} className="border-[#24242d] bg-[#07070a] hover:bg-white/[0.03]">
                        <TableCell>
                          <p className="font-medium text-white">{row.name}</p>
                          <p className="text-xs text-white/50">{row.offer} · {row.window}</p>
                        </TableCell>
                        <TableCell className="text-white/80">{row.status}</TableCell>
                        <TableCell className="text-center text-white/80">{row.transactions}</TableCell>
                        <TableCell className="text-center text-white/80">{row.pairs}</TableCell>
                        <TableCell className="text-right text-yellow-200">{money(row.net)}</TableCell>
                        <TableCell className="text-right text-white/80">{money(row.discount)}</TableCell>
                        <TableCell>
                          {row.goal > 0 ? (
                            <div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-[#24242d]">
                                <div className="h-full rounded-full bg-yellow-400" style={{ width: `${Math.min(100, row.progress)}%` }} />
                              </div>
                              <p className="mt-1 text-xs text-white/60">
                                {row.progress.toFixed(0)}% · {money(row.campaignNet)} of {money(row.goal)}
                              </p>
                            </div>
                          ) : (
                            <span className="text-xs text-white/40">No goal set</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!promotionReport.rows.length && (
                      <TableRow className="border-[#24242d] bg-[#07070a]">
                        <TableCell colSpan={7} className="py-6 text-center text-white/60">No promotions ran in this period.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {reportType === 'revenue' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="bg-[#0b0b0f] border-[#24242d]">
              <CardHeader><CardTitle className="text-yellow-300">Revenue by Category</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={revenueByCategory}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#24242d" />
                    <XAxis dataKey="category" stroke="#fef08a" />
                    <YAxis stroke="#fef08a" tickFormatter={(value) => Math.round(Number(value)).toLocaleString()} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#16161C', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', padding: '10px 14px', color: '#FFFFFF' }}
                      labelStyle={{ color: '#FFFFFF', fontWeight: 600, fontSize: 13, marginBottom: 4 }}
                      itemStyle={{ color: '#FFFFFF', fontSize: 12, fontWeight: 500 }}
                      formatter={(value, name) => [moneyWhole(Number(value)), name]}
                    />
                    <Legend wrapperStyle={{ color: '#fef08a' }} />
                    <Bar dataKey="revenue" fill="#fef08a" name="Revenue (PHP)" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card className="bg-[#0b0b0f] border-[#24242d]">
              <CardHeader><CardTitle className="text-yellow-300">Category Distribution</CardTitle></CardHeader>
              <CardContent className="flex justify-center">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie data={categoryDistribution} cx="50%" cy="50%" labelLine={false} label={({ name, value }) => `${name} ${value}%`} outerRadius={100} dataKey="value">
                      {categoryDistribution.map((entry) => <Cell key={entry.id} fill={entry.color} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#16161C', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', padding: '10px 14px', color: '#FFFFFF' }}
                      labelStyle={{ color: '#FFFFFF', fontWeight: 600, fontSize: 13, marginBottom: 4 }}
                      itemStyle={{ color: '#FFFFFF', fontSize: 12, fontWeight: 500 }}
                      formatter={(value, name) => [`${Math.round(Number(value))}%`, name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <Card className="bg-[#0b0b0f] border-[#24242d]">
            <CardHeader><CardTitle className="text-yellow-300">Category Performance Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {revenueByCategory.map((category) => (
                <div key={category.id} className="border-b border-[#24242d] pb-3">
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-yellow-200">{category.category}</p>
                    <div className="flex items-center gap-3">
                      <Badge className="bg-yellow-400 text-black">{category.percentage}% of total</Badge>
                      <Badge className={category.growth > 0 ? 'bg-green-600 text-white' : 'bg-red-900 text-yellow-200'}>{category.growth > 0 ? '+' : ''}{category.growth.toFixed(1)}%</Badge>
                    </div>
                  </div>
                  <p className="text-yellow-300 text-lg">{money(category.revenue)}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {reportType === 'inventory' && (
        <div className="space-y-5">
          {/* Charts Row: Stock Health Donut & Inventory Valuation by Brand */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Stock Health Donut */}
            <Card className="lg:col-span-4 bg-[#0b0b0f] border-[#24242d] shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-yellow-300 flex items-center gap-2 text-base font-bold">
                  <Package className="w-5 h-5 text-yellow-400" />
                  Stock Health Breakdown
                </CardTitle>
                <p className="text-xs text-zinc-400">Inventory status & availability ratio across all footwear models</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="h-[210px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={inventoryAnalytics.healthDistribution}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={78}
                        paddingAngle={3}
                        dataKey="count"
                        nameKey="name"
                      >
                        {inventoryAnalytics.healthDistribution.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartWhiteTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {inventoryAnalytics.healthDistribution.map((h) => (
                    <div
                      key={h.name}
                      onClick={() => {
                        if (h.name === 'Optimal Stock') setInventoryStatusFilter(inventoryStatusFilter === 'optimal' ? 'all' : 'optimal');
                        else if (h.name === 'Reorder Needed') setInventoryStatusFilter(inventoryStatusFilter === 'reorder' ? 'all' : 'reorder');
                        else if (h.name.includes('Critical') || h.name.includes('Out')) setInventoryStatusFilter(inventoryStatusFilter === 'critical' ? 'all' : 'critical');
                        else if (h.name === 'Overstock') setInventoryStatusFilter(inventoryStatusFilter === 'overstock' ? 'all' : 'overstock');
                      }}
                      className="p-2.5 rounded-lg border border-[#222230] bg-[#12121c] flex items-center justify-between cursor-pointer hover:border-white/20 transition-all"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: h.color }} />
                        <span className="text-xs text-white font-medium truncate">{h.name}</span>
                      </div>
                      <span className="text-xs font-bold text-yellow-300 ml-1">{h.count}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Inventory Valuation & Pairs by Brand */}
            <Card className="lg:col-span-8 bg-[#0b0b0f] border-[#24242d] shadow-lg">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-yellow-300 flex items-center gap-2 text-base font-bold">
                      <BarChart3 className="w-5 h-5 text-yellow-400" />
                      Stock Valuation & Pairs by Brand
                    </CardTitle>
                    <p className="text-xs text-zinc-400">Total capital valuation and physical pairs on hand by footwear maker</p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-zinc-300">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-yellow-400" /> Capital (PHP)</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-sky-400" /> Pairs on Hand</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-[270px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={inventoryAnalytics.brandList} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#24242d" vertical={false} />
                      <XAxis dataKey="name" stroke="#a1a1aa" fontSize={11} />
                      <YAxis yAxisId="left" stroke="#facc15" fontSize={11} tickFormatter={(v) => moneyCompact(Number(v))} />
                      <YAxis yAxisId="right" orientation="right" stroke="#38bdf8" fontSize={11} />
                      <Tooltip content={<ChartWhiteTooltip />} />
                      <Bar yAxisId="left" dataKey="value" fill="#facc15" name="Stock Value (PHP)" radius={[4, 4, 0, 0]} />
                      <Bar yAxisId="right" dataKey="pairs" fill="#38bdf8" name="In-Stock Pairs" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Footwear Size Run Availability Curve */}
          {inventoryAnalytics.sizeList.length > 0 && (
            <Card className="bg-[#0b0b0f] border-[#24242d] shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-yellow-300 flex items-center gap-2 text-base font-bold">
                  <Layers className="w-5 h-5 text-yellow-400" />
                  Footwear Size Run Availability (Stock across EU Sizes)
                </CardTitle>
                <p className="text-xs text-zinc-400">Total pairs in stock across sizes — detect and prevent broken size runs (missing core sizes 41, 42, 43)</p>
              </CardHeader>
              <CardContent>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={inventoryAnalytics.sizeList} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#24242d" vertical={false} />
                      <XAxis dataKey="name" stroke="#a1a1aa" fontSize={11} label={{ value: 'Size (EU)', position: 'insideBottom', offset: -2, fill: '#71717a', fontSize: 10 }} />
                      <YAxis stroke="#facc15" fontSize={11} allowDecimals={false} />
                      <Tooltip content={<ChartWhiteTooltip />} />
                      <Bar dataKey="pairs" fill="#10b981" name="Pairs in Stock" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Actionable Inventory & Stock Status Table */}
          <Card className="bg-[#0b0b0f] border-[#24242d] shadow-xl">
            <CardHeader className="border-b border-[#1f1f2b] pb-4 bg-[#0e0e14] space-y-3.5">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-yellow-300 flex items-center gap-2 text-lg font-bold">
                    <Package className="w-5 h-5 text-yellow-400" />
                    Inventory Stock Status & Restock Priority List
                  </CardTitle>
                  <p className="mt-1 text-xs text-zinc-400">
                    Showing {inventoryStatusRows.length} of {productRows.length} inventory items • Filter by urgency, brand, category, or size
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input
                      type="text"
                      value={inventorySearchQuery}
                      onChange={(e) => {
                        setInventorySearchQuery(e.target.value);
                        setInventoryCurrentPage(1);
                      }}
                      placeholder="Search model, brand, SKU..."
                      className="pl-8 pr-7 py-1.5 rounded-lg border border-[#2b2b3b] bg-[#141420] text-white text-xs placeholder:text-zinc-500 focus:outline-none focus:border-yellow-400 w-56"
                    />
                    {inventorySearchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setInventorySearchQuery('');
                          setInventoryCurrentPage(1);
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Multi-Dimensional Filters: Brand, Category, Department, Size (like the other pages) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
                {/* Brand Filter */}
                <div className="relative">
                  <select
                    value={inventoryBrandFilter}
                    onChange={(e) => {
                      setInventoryBrandFilter(e.target.value);
                      setInventoryCurrentPage(1);
                    }}
                    className="h-8 w-full appearance-none rounded-lg border border-[#2b2b3b] bg-[#141420] px-2.5 pr-6 text-xs text-white focus:border-yellow-400 focus:outline-none"
                  >
                    <option value="all">All Brands ({inventoryAnalytics.brands.length})</option>
                    {inventoryAnalytics.brands.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400">⌄</span>
                </div>

                {/* Category Filter */}
                <div className="relative">
                  <select
                    value={inventoryCategoryFilter}
                    onChange={(e) => {
                      setInventoryCategoryFilter(e.target.value);
                      setInventoryCurrentPage(1);
                    }}
                    className="h-8 w-full appearance-none rounded-lg border border-[#2b2b3b] bg-[#141420] px-2.5 pr-6 text-xs text-white focus:border-yellow-400 focus:outline-none"
                  >
                    <option value="all">All Categories ({inventoryAnalytics.categories.length})</option>
                    {inventoryAnalytics.categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400">⌄</span>
                </div>

                {/* Department (Gender) Filter */}
                <div className="relative">
                  <select
                    value={inventoryDeptFilter}
                    onChange={(e) => {
                      setInventoryDeptFilter(e.target.value);
                      setInventoryCurrentPage(1);
                    }}
                    className="h-8 w-full appearance-none rounded-lg border border-[#2b2b3b] bg-[#141420] px-2.5 pr-6 text-xs text-white focus:border-yellow-400 focus:outline-none"
                  >
                    <option value="all">All Departments ({inventoryAnalytics.departments.length})</option>
                    {inventoryAnalytics.departments.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400">⌄</span>
                </div>

                {/* Size Filter */}
                <div className="relative">
                  <select
                    value={inventorySizeFilter}
                    onChange={(e) => {
                      setInventorySizeFilter(e.target.value);
                      setInventoryCurrentPage(1);
                    }}
                    className="h-8 w-full appearance-none rounded-lg border border-[#2b2b3b] bg-[#141420] px-2.5 pr-6 text-xs text-white focus:border-yellow-400 focus:outline-none"
                  >
                    <option value="all">All Sizes ({inventoryAnalytics.sizes.length})</option>
                    {inventoryAnalytics.sizes.map((s) => (
                      <option key={s} value={s}>Size {s}</option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-zinc-400">⌄</span>
                </div>
              </div>

              {/* Status Filter Tabs */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={() => {
                    setInventoryStatusFilter('all');
                    setInventoryCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    inventoryStatusFilter === 'all'
                      ? 'bg-yellow-400 text-black shadow-md'
                      : 'bg-[#161622] text-zinc-300 border border-[#242436] hover:bg-white/[0.05]'
                  }`}
                >
                  All Items ({inventoryAnalytics.allRows.length})
                </button>
                <button
                  onClick={() => {
                    setInventoryStatusFilter('critical');
                    setInventoryCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    inventoryStatusFilter === 'critical'
                      ? 'bg-red-600 text-white shadow-md'
                      : 'bg-[#161622] text-red-300 border border-[#242436] hover:bg-red-950/30'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  Critical & Out of Stock ({inventoryAnalytics.outOfStockCount + inventoryAnalytics.criticalCount})
                </button>
                <button
                  onClick={() => {
                    setInventoryStatusFilter('reorder');
                    setInventoryCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    inventoryStatusFilter === 'reorder'
                      ? 'bg-amber-500 text-black shadow-md'
                      : 'bg-[#161622] text-yellow-300 border border-[#242436] hover:bg-amber-950/30'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  Needs Reorder ({inventoryAnalytics.reorderCount})
                </button>
                <button
                  onClick={() => {
                    setInventoryStatusFilter('optimal');
                    setInventoryCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    inventoryStatusFilter === 'optimal'
                      ? 'bg-green-600 text-white shadow-md'
                      : 'bg-[#161622] text-green-300 border border-[#242436] hover:bg-green-950/30'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  Healthy Stock ({inventoryAnalytics.optimalCount})
                </button>
                <button
                  onClick={() => {
                    setInventoryStatusFilter('overstock');
                    setInventoryCurrentPage(1);
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                    inventoryStatusFilter === 'overstock'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'bg-[#161622] text-blue-300 border border-[#242436] hover:bg-blue-950/30'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  Overstock ({inventoryAnalytics.overstockCount})
                </button>
              </div>

              {/* Active Filters Pill Bar */}
              {isInventoryFiltering && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1e1e2c]">
                  <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                    <Filter className="w-3 h-3 text-yellow-400" /> Active Filters:
                  </span>
                  {inventorySearchQuery && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-yellow-400/10 border border-yellow-400/30 px-2 py-0.5 text-[11px] text-yellow-300">
                      Search: "{inventorySearchQuery}"
                      <button type="button" onClick={() => { setInventorySearchQuery(''); setInventoryCurrentPage(1); }} className="hover:text-white">×</button>
                    </span>
                  )}
                  {inventoryBrandFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-yellow-400/10 border border-yellow-400/30 px-2 py-0.5 text-[11px] text-yellow-300">
                      Brand: {inventoryBrandFilter}
                      <button type="button" onClick={() => { setInventoryBrandFilter('all'); setInventoryCurrentPage(1); }} className="hover:text-white">×</button>
                    </span>
                  )}
                  {inventoryCategoryFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-yellow-400/10 border border-yellow-400/30 px-2 py-0.5 text-[11px] text-yellow-300">
                      Category: {inventoryCategoryFilter}
                      <button type="button" onClick={() => { setInventoryCategoryFilter('all'); setInventoryCurrentPage(1); }} className="hover:text-white">×</button>
                    </span>
                  )}
                  {inventoryDeptFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-yellow-400/10 border border-yellow-400/30 px-2 py-0.5 text-[11px] text-yellow-300">
                      Dept: {inventoryDeptFilter}
                      <button type="button" onClick={() => { setInventoryDeptFilter('all'); setInventoryCurrentPage(1); }} className="hover:text-white">×</button>
                    </span>
                  )}
                  {inventorySizeFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-yellow-400/10 border border-yellow-400/30 px-2 py-0.5 text-[11px] text-yellow-300">
                      Size: {inventorySizeFilter}
                      <button type="button" onClick={() => { setInventorySizeFilter('all'); setInventoryCurrentPage(1); }} className="hover:text-white">×</button>
                    </span>
                  )}
                  {inventoryStatusFilter !== 'all' && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-yellow-400/10 border border-yellow-400/30 px-2 py-0.5 text-[11px] text-yellow-300 capitalize">
                      Status: {inventoryStatusFilter}
                      <button type="button" onClick={() => { setInventoryStatusFilter('all'); setInventoryCurrentPage(1); }} className="hover:text-white">×</button>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={handleClearAllInventoryFilters}
                    className="ml-auto text-[11px] font-medium text-red-400 underline hover:text-red-300 cursor-pointer"
                  >
                    Clear all filters
                  </button>
                </div>
              )}
            </CardHeader>

            <CardContent className="p-4 space-y-4">
              <div className="overflow-x-auto rounded-lg border border-[#222232] bg-[#0c0c14]">
                <Table>
                  <TableHeader className="bg-[#141420]">
                    <TableRow className="border-[#222232]">
                      <TableHead className="text-yellow-300 text-xs text-center whitespace-nowrap">SKU</TableHead>
                      <TableHead className="text-yellow-300 text-xs">Brand & Shoe Model</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Category</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Size</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Color</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">In Stock</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Reorder Point</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-right">Unit Price</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-right">Stock Valuation</TableHead>
                      <TableHead className="text-yellow-300 text-xs text-center">Stock Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedInventoryRows.map((row) => {
                      const isOutOfStock = row.stock === 0;
                      const isCritical = row.status === 'Critical';
                      const isReorder = row.status === 'Reorder Required';
                      const isOverstock = row.status === 'Overstock';

                      return (
                        <TableRow key={row.id} className="border-[#1e1e2c] hover:bg-white/[0.03]">
                          <TableCell className="font-mono text-yellow-200 text-xs text-center whitespace-nowrap" title={row.rawSku}>{row.sku}</TableCell>
                          <TableCell className="text-white font-medium text-xs">
                            <span className="font-bold text-yellow-300">{row.brand}</span> {row.modelName}
                          </TableCell>
                          <TableCell className="text-zinc-400 text-xs text-center">{row.category}</TableCell>
                          <TableCell className="text-zinc-200 text-xs text-center font-semibold">{row.size}</TableCell>
                          <TableCell className="text-zinc-300 text-xs text-center">{row.color}</TableCell>
                          <TableCell className={`text-xs text-center font-bold ${
                            isOutOfStock ? 'text-red-400' : isCritical ? 'text-red-300' : isReorder ? 'text-yellow-300' : isOverstock ? 'text-blue-300' : 'text-green-400'
                          }`}>
                            {row.stock} pairs
                          </TableCell>
                          <TableCell className="text-zinc-400 text-xs text-center">{row.reorder}</TableCell>
                          <TableCell className="text-zinc-300 text-xs text-right">{money(row.unitPrice)}</TableCell>
                          <TableCell className="text-yellow-300 font-semibold text-xs text-right">{money(row.stockValue)}</TableCell>
                          <TableCell className="text-center">
                            <Badge className={
                              isOutOfStock ? 'bg-red-950 text-red-300 border border-red-800' :
                              isCritical ? 'bg-red-900/60 text-red-200 border border-red-700' :
                              isReorder ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40' :
                              isOverstock ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' :
                              'bg-green-500/20 text-green-300 border border-green-500/40'
                            }>
                              {row.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!inventoryStatusRows.length && (
                      <TableRow>
                        <TableCell colSpan={10} className="text-center text-zinc-500 py-8 text-xs">
                          No inventory items match the selected filters.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination Controls Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                {/* Left: Page Size Selector & Record Count */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">Show:</span>
                    <select
                      value={inventoryPageSize}
                      onChange={(e) => {
                        setInventoryPageSize(Number(e.target.value));
                        setInventoryCurrentPage(1);
                      }}
                      className="h-8 rounded-lg border border-[#2b2b36] bg-[#141420] px-2 text-xs font-semibold text-white outline-none focus:border-yellow-400"
                    >
                      <option value={10}>10 items</option>
                      <option value={15}>15 items</option>
                      <option value={25}>25 items</option>
                      <option value={50}>50 items</option>
                      <option value={100}>100 items</option>
                    </select>
                  </div>
                  <span className="text-xs text-zinc-400">
                    Showing{' '}
                    <strong className="text-white">
                      {inventoryStatusRows.length > 0 ? (safeInventoryPage - 1) * inventoryPageSize + 1 : 0}
                    </strong>{' '}
                    to{' '}
                    <strong className="text-white">
                      {Math.min(safeInventoryPage * inventoryPageSize, inventoryStatusRows.length)}
                    </strong>{' '}
                    of <strong className="text-yellow-400">{inventoryStatusRows.length}</strong> items
                  </span>
                </div>

                {/* Right: Page Navigation Prev / Page Numbers / Next */}
                {totalInventoryPages > 1 && (
                  <div className="flex items-center gap-1.5 self-end sm:self-auto">
                    <button
                      type="button"
                      onClick={() => setInventoryCurrentPage((prev) => Math.max(1, prev - 1))}
                      disabled={safeInventoryPage <= 1}
                      className="flex h-8 items-center gap-1 rounded-lg border border-[#2b2b36] bg-white/[0.03] px-2.5 text-xs font-semibold text-white/70 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      <span>Prev</span>
                    </button>

                    <div className="flex items-center gap-1">
                      {Array.from({ length: totalInventoryPages }, (_, i) => i + 1)
                        .filter((page) => {
                          if (totalInventoryPages <= 7) return true;
                          if (page === 1 || page === totalInventoryPages) return true;
                          return Math.abs(page - safeInventoryPage) <= 1;
                        })
                        .map((page, idx, arr) => {
                          const prev = arr[idx - 1];
                          const hasGap = prev && page - prev > 1;
                          return (
                            <div key={page} className="flex items-center">
                              {hasGap && <span className="px-1 text-xs text-white/30">...</span>}
                              <button
                                type="button"
                                onClick={() => setInventoryCurrentPage(page)}
                                className={`h-8 min-w-[32px] rounded-lg px-2 text-xs font-semibold transition ${
                                  safeInventoryPage === page
                                    ? 'bg-yellow-400 text-black font-bold shadow'
                                    : 'border border-[#2b2b36] bg-white/[0.03] text-white/70 hover:bg-white/[0.08] hover:text-white'
                                }`}
                              >
                                {page}
                              </button>
                            </div>
                          );
                        })}
                    </div>

                    <button
                      type="button"
                      onClick={() => setInventoryCurrentPage((prev) => Math.min(totalInventoryPages, prev + 1))}
                      disabled={safeInventoryPage >= totalInventoryPages}
                      className="flex h-8 items-center gap-1 rounded-lg border border-[#2b2b36] bg-white/[0.03] px-2.5 text-xs font-semibold text-white/70 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                    >
                      <span>Next</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

    </div>
  );
}
