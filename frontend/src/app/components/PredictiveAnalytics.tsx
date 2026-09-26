import { type ComponentType, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Award, BarChart3, ChevronLeft, ChevronRight, Filter, Package, RefreshCw, Search, Sparkles, TrendingUp, Users, X } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCustomers, useProducts, usePromotions, useReturns, useSales } from "../../lib/hooks";
import { productAnalyticsSnapshotsApi } from "../../lib/api";
import { localDateKey } from "../../lib/datetime";

type RevenueTrendPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "annually";
type ProductAnalyticsPeriod = RevenueTrendPeriod | "custom";
type RankingMetric = "units" | "revenue";

const revenueTrendOptions: Array<{ id: RevenueTrendPeriod; label: string }> = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "annually", label: "Annually" },
];

const customerPeriodOptions: Array<{ id: RevenueTrendPeriod; label: string }> = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "quarterly", label: "Quarterly" },
  { id: "annually", label: "Yearly" },
];

const productPeriodDays: Record<RevenueTrendPeriod, number> = {
  daily: 1,
  weekly: 7,
  monthly: 30,
  quarterly: 90,
  annually: 365,
};

function money(value: number) {
  return `PHP ${Math.round(value || 0).toLocaleString("en-PH")}`;
}

function shortMoney(value: number) {
  if (value >= 1000000) return `PHP ${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `PHP ${(value / 1000).toFixed(1)}K`;
  return money(value);
}

function shortLabel(value: string, max = 18) {
  if (!value) return "N/A";
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function toDate(value: unknown) {
  if (!value) return null;
  const raw = String(value).trim();
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const date = new Date(hasTimezone || isDateOnly ? raw : `${raw}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDay(date: Date | null) {
  if (!date) return null;
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function businessDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function getOne(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function startOfWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatShortDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getQuarter(date: Date) {
  return Math.floor(date.getMonth() / 3) + 1;
}

function getCategory(product: any) {
  const category = getOne(product?.category);
  return String(product?.category_name ?? category?.category_name ?? "Uncategorized");
}

function getInventory(product: any) {
  return getOne(product?.inventory) ?? {};
}

function getStock(product: any) {
  const inventory = getInventory(product);
  const onHand = Number(inventory?.stock_quantity ?? product?.stock_quantity ?? 0);
  const reserved = Number(inventory?.reserved_quantity ?? inventory?.held_stock ?? product?.reserved_stock ?? 0);
  return Math.max(0, onHand - reserved);
}

function getReorder(product: any) {
  const inventory = getInventory(product);
  return Number(inventory?.reorder_level ?? product?.reorder_level ?? 0);
}

function getPrice(product: any, detail?: any) {
  const inventory = getInventory(product);
  return Number(inventory?.srp ?? product?.srp ?? detail?.price ?? product?.selling_price ?? product?.unit_price ?? product?.cost_price ?? 0);
}

function isCompletedSale(sale: any) {
  const payment = getOne(sale?.payment);
  const paymentStatus = String(payment?.payment_status ?? sale?.payment_status ?? "completed").toLowerCase();
  const saleStatus = String(sale?.sales_status ?? sale?.status ?? "completed").toLowerCase();
  return !["cancelled", "canceled", "fully returned"].includes(saleStatus) &&
    ["completed", "paid", "success", "successful"].includes(paymentStatus);
}

function getSaleAmount(sale: any) {
  return Number(sale?.adjusted_total_amount ?? sale?.total_amount ?? sale?.original_total_amount ?? 0);
}

function getSaleDetailRevenue(detail: any) {
  const qty = Number(detail?.quantity ?? 0);
  const price = Number(detail?.price ?? 0);
  return Number(detail?.subtotal ?? (price * qty));
}

function parsePromotionTargets(text: unknown) {
  const raw = String(text ?? "").trim();
  if (!raw || raw.toLowerCase() === "all products") {
    return { categories: [] as string[], products: [] as string[] };
  }
  const categories: string[] = [];
  const products: string[] = [];
  raw.split("|").forEach((segment) => {
    const value = segment.trim();
    if (!value) return;
    const lower = value.toLowerCase();
    if (lower.startsWith("categories:")) {
      value.slice("categories:".length).split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => categories.push(item.toLowerCase()));
      return;
    }
    if (lower.startsWith("products:")) {
      value.slice("products:".length).split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => products.push(item.toLowerCase()));
      return;
    }
    if (lower.endsWith(" category")) {
      categories.push(value.slice(0, -" category".length).trim().toLowerCase());
      return;
    }
    products.push(lower);
  });
  return {
    categories: Array.from(new Set(categories)),
    products: Array.from(new Set(products)),
  };
}

function getCustomerGender(customer: any, fallbackProductGender?: string) {
  const raw = String(customer?.gender ?? customer?.customer_gender ?? customer?.sex ?? "").trim();
  if (raw) {
    const normalized = raw.toLowerCase();
    if (normalized === "unisex" || normalized.includes("unisex")) return "Unisex";
    if (normalized.includes("men") || normalized === "male" || normalized === "m") return "Men";
    if (normalized.includes("women") || normalized === "female" || normalized === "f") return "Women";
    if (normalized.includes("boy") || normalized.includes("girl") || normalized.includes("kid") || normalized.includes("child")) return "Kids";
    return raw;
  }
  if (fallbackProductGender) {
    const pNorm = String(fallbackProductGender).trim().toLowerCase();
    if (pNorm === "unisex" || pNorm.includes("unisex")) return "Unisex";
    if (pNorm.includes("men") || pNorm === "male" || pNorm === "m") return "Men";
    if (pNorm.includes("women") || pNorm === "female" || pNorm === "f") return "Women";
    if (pNorm.includes("boy") || pNorm.includes("girl") || pNorm.includes("kid") || pNorm.includes("child")) return "Kids";
  }
  return "";
}

function getCustomerAge(customer: any) {
  const direct = Number(customer?.age ?? customer?.customer_age);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const birthDate = toDate(customer?.birthdate ?? customer?.birth_date ?? customer?.date_of_birth);
  if (!birthDate) return null;
  const now = new Date();
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDelta = now.getMonth() - birthDate.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birthDate.getDate())) age -= 1;
  return age;
}

function getAgeRange(customer: any) {
  const existing = String(customer?.age_range ?? "").trim();
  if (existing) return existing;
  const age = getCustomerAge(customer);
  if (!age) return "Unknown Age";
  if (age <= 12) return "Kids 12 below";
  if (age <= 17) return "Teens 13-17";
  if (age <= 24) return "Young Adults 18-24";
  if (age <= 34) return "Adults 25-34";
  if (age <= 44) return "Adults 35-44";
  if (age <= 59) return "Adults 45-59";
  return "Seniors 60+";
}

function movementBadgeClass(movement: string) {
  if (movement === "Fast") return "bg-green-600 text-white";
  if (movement === "Slow") return "bg-orange-500 text-white";
  if (movement === "Dead Stock") return "bg-red-700 text-white";
  return "bg-yellow-400 text-red-950";
}

function salesVelocityColor(units: number, maxUnits: number) {
  if (maxUnits <= 0 || units <= 0) return "rgba(63, 63, 70, 0.58)";
  const intensity = Math.max(0.25, units / maxUnits);
  if (intensity >= 0.75) return "rgba(34, 197, 94, 0.92)";
  if (intensity >= 0.45) return "rgba(250, 204, 21, 0.9)";
  return "rgba(249, 115, 22, 0.88)";
}

function sortSizeLabels(a: string, b: string) {
  const aNum = Number(a);
  const bNum = Number(b);
  if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
  return a.localeCompare(b, undefined, { numeric: true });
}

function stockBadgeClass(stock: number, reorder: number) {
  if (stock <= 0) return "bg-red-700 text-white";
  if (reorder > 0 && stock <= reorder) return "bg-orange-500 text-white";
  if (reorder > 0 && stock <= reorder * 1.5) return "bg-yellow-400 text-red-950";
  return "bg-green-700 text-white";
}

function getTopKey(map: Map<string, number>) {
  return Array.from(map.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "N/A";
}

function MetricCard({
  title,
  value,
  note,
  icon: Icon,
}: {
  title: string;
  value: string;
  note: string;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Card className="bg-[#16161d] border-[#2b2b36]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/45">{title}</p>
            <p className="mt-2 text-2xl font-bold text-white">{value}</p>
            <p className="mt-1 text-xs text-white/55">{note}</p>
          </div>
          <Icon className="h-5 w-5 text-yellow-400" />
        </div>
      </CardContent>
    </Card>
  );
}

export function PredictiveAnalytics() {
  const [analyticsView, setAnalyticsView] = useState<"product" | "customer" | "sales" | "promotion">("product");
  const [revenueTrendPeriod, setRevenueTrendPeriod] = useState<RevenueTrendPeriod>("daily");
  const [salesForecastPeriod, setSalesForecastPeriod] = useState<RevenueTrendPeriod>("monthly");
  const [productAnalyticsPeriod, setProductAnalyticsPeriod] = useState<ProductAnalyticsPeriod>("monthly");
  const [customerAnalyticsPeriod, setCustomerAnalyticsPeriod] = useState<RevenueTrendPeriod>("monthly");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [topRankingPeriod, setTopRankingPeriod] = useState<RevenueTrendPeriod>("monthly");
  const [topRankingMetric, setTopRankingMetric] = useState<RankingMetric>("units");
  const [isRefreshingSnapshots, setIsRefreshingSnapshots] = useState(false);
  const [snapshotRefreshNote, setSnapshotRefreshNote] = useState<string | null>(null);
  const [productSearchTerm, setProductSearchTerm] = useState("");
  const [productCategoryFilter, setProductCategoryFilter] = useState("all");
  const [productDepartmentFilter, setProductDepartmentFilter] = useState("all");
  const [productMovementFilter, setProductMovementFilter] = useState("all");
  const [productPageSize, setProductPageSize] = useState<number>(10);
  const [productCurrentPage, setProductCurrentPage] = useState<number>(1);
  const salesQuery = useSales();
  const productsQuery = useProducts();
  const customersQuery = useCustomers();
  const promotionsQuery = usePromotions();
  const returnsQuery = useReturns();

  const sales = ((salesQuery.data as any[]) ?? []).filter(isCompletedSale);
  const products = (productsQuery.data as any[]) ?? [];
  const customers = (customersQuery.data as any[]) ?? [];
  const promotions = (promotionsQuery.data as any[]) ?? [];
  const returnsData = (returnsQuery.data as any[]) ?? [];

  const { defectiveReplacementsByProduct, totalReplacementsCount, totalDefectiveLoss, totalAvailableStock, totalReservedStock } = useMemo(() => {
    const map = new Map<string, { count: number; lossAmount: number }>();
    let count = 0;
    let loss = 0;

    const pMap = new Map(products.map((p: any) => [String(p.product_id ?? ""), p]));

    returnsData.forEach((ret: any) => {
      const details = Array.isArray(ret.return_details) ? ret.return_details : [];
      details.forEach((d: any) => {
        const pid = String(d.returned_product_id ?? d.product_id ?? "");
        if (!pid) return;
        const qty = Number(d.quantity_returned ?? d.quantity ?? 1);
        const product = pMap.get(pid);
        const unitCost = Number(product?.cost_price ?? product?.unit_price ?? product?.price ?? 0);
        const lineLoss = unitCost * qty;

        count += qty;
        loss += lineLoss;

        const existing = map.get(pid) ?? { count: 0, lossAmount: 0 };
        existing.count += qty;
        existing.lossAmount += lineLoss;
        map.set(pid, existing);
      });
    });

    let availStock = 0;
    let resStock = 0;
    products.forEach((p: any) => {
      const inv = getInventory(p);
      const onHand = Number(inv?.stock_quantity ?? p?.stock_quantity ?? 0);
      const reserved = Number(inv?.reserved_quantity ?? inv?.held_stock ?? p?.reserved_stock ?? 0);
      availStock += Math.max(0, onHand - reserved);
      resStock += reserved;
    });

    return {
      defectiveReplacementsByProduct: map,
      totalReplacementsCount: count,
      totalDefectiveLoss: loss,
      totalAvailableStock: availStock,
      totalReservedStock: resStock,
    };
  }, [returnsData, products]);

  const effectiveProductAnalyticsPeriod: RevenueTrendPeriod =
    productAnalyticsPeriod === "custom" ? "monthly" : productAnalyticsPeriod;
  const snapshotQuery = useQuery({
    queryKey: ["product-analytics-snapshots", productAnalyticsPeriod, customStartDate, customEndDate],
    queryFn: () =>
      productAnalyticsSnapshotsApi.fetch(
        productAnalyticsPeriod,
        productAnalyticsPeriod === "custom" ? { start_date: customStartDate, end_date: customEndDate } : undefined,
      ),
    staleTime: 60_000,
    retry: 1,
  });
  useEffect(() => {
    if (!snapshotRefreshNote) return;
    const timer = setTimeout(() => {
      setSnapshotRefreshNote(null);
    }, 4500);
    return () => clearTimeout(timer);
  }, [snapshotRefreshNote]);

  const handleRefreshProductAnalytics = async () => {
    try {
      setIsRefreshingSnapshots(true);
      setSnapshotRefreshNote(null);
      if (productAnalyticsPeriod === "custom" && (!customStartDate || !customEndDate)) {
        setSnapshotRefreshNote("Custom range requires both start and end dates.");
        return;
      }
      if (productAnalyticsPeriod === "custom" && customStartDate > customEndDate) {
        setSnapshotRefreshNote("Custom range is invalid: start date must be before or equal to end date.");
        return;
      }

      // Always refetch all live datasets from Supabase so all metrics, size curve heatmap, and forecasts update in real time
      await Promise.allSettled([
        salesQuery.refetch(),
        productsQuery.refetch(),
        returnsQuery.refetch(),
        customersQuery.refetch(),
        promotionsQuery.refetch(),
      ]);

      // Attempt to rebuild server-side snapshots if Flask backend is running
      let rebuiltOnServer = false;
      try {
        const rebuildRes = await productAnalyticsSnapshotsApi.rebuild(
          [productAnalyticsPeriod],
          productAnalyticsPeriod === "custom" ? { start_date: customStartDate, end_date: customEndDate } : undefined,
        );
        rebuiltOnServer = Boolean(rebuildRes && (rebuildRes as any).snapshots_written > 0);
        await snapshotQuery.refetch();
      } catch {
        // Backend offline; live Supabase calculations are active
      }

      setSnapshotRefreshNote(
        rebuiltOnServer
          ? "Product analytics and server snapshots refreshed."
          : "Product analytics refreshed from live data."
      );
    } catch {
      setSnapshotRefreshNote("Product analytics refreshed from live data.");
    } finally {
      setIsRefreshingSnapshots(false);
    }
  };

  const computedAnalytics = useMemo(() => {
    const now = new Date();
    const last30 = new Date(now);
    last30.setDate(now.getDate() - 30);
    const last90 = new Date(now);
    last90.setDate(now.getDate() - 90);
    const productPeriodStart = new Date(now);
    productPeriodStart.setDate(now.getDate() - productPeriodDays[effectiveProductAnalyticsPeriod]);
    productPeriodStart.setHours(0, 0, 0, 0);
    const customerPeriodStart = new Date(now);
    customerPeriodStart.setDate(now.getDate() - productPeriodDays[customerAnalyticsPeriod]);
    customerPeriodStart.setHours(0, 0, 0, 0);
    const productPeriodLabel =
      productAnalyticsPeriod === "custom"
        ? customStartDate && customEndDate
          ? `Custom (${customStartDate} to ${customEndDate})`
          : "Custom Range"
        : revenueTrendOptions.find((option) => option.id === productAnalyticsPeriod)?.label ?? "Monthly";
    const customerPeriodLabel = customerPeriodOptions.find((option) => option.id === customerAnalyticsPeriod)?.label ?? "Monthly";
    const topRankingPeriodStart = new Date(now);
    topRankingPeriodStart.setDate(now.getDate() - productPeriodDays[topRankingPeriod]);
    topRankingPeriodStart.setHours(0, 0, 0, 0);
    const topRankingPeriodLabel = revenueTrendOptions.find((option) => option.id === topRankingPeriod)?.label ?? "Monthly";

    const customerMap = new Map(customers.map((customer: any) => [String(customer.customer_id ?? ""), customer]));
    const productMap = new Map(products.map((product: any) => [String(product.product_id ?? ""), product]));

    const productStats = new Map<string, any>();
    const categoryStats = new Map<string, any>();
    const brandStats = new Map<string, any>();
    const sizeStats = new Map<string, any>();
    const customerSegments = new Map<string, any>();
    const genderSegments = new Map<string, any>();
    const dailySales = new Map<string, { date: Date; revenue: number; units: number }>();

    products.forEach((product: any) => {
      const id = String(product.product_id ?? "");
      if (!id) return;
      productStats.set(id, {
        id,
        name: String(product.product_name ?? "Unknown Product"),
        brand: String(product.brand ?? "N/A"),
        category: getCategory(product),
        size: String(product.size ?? "N/A"),
        gender: String(product.gender ?? "N/A"),
        stock: getStock(product),
        reorder: getReorder(product),
        price: getPrice(product),
        units30: 0,
        units90: 0,
        unitsPeriod: 0,
        revenue30: 0,
        revenue90: 0,
        revenuePeriod: 0,
      });
    });

    sales.forEach((sale: any) => {
      const date = toDate(sale.transaction_date ?? sale.created_at);
      if (!date) return;
      const in30 = date >= last30;
      const in90 = date >= last90;
      const inProductPeriod = date >= productPeriodStart;
      const inTopRankingPeriod = date >= topRankingPeriodStart;
      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      const inCustomerPeriod = date >= customerPeriodStart;
      const customer = inCustomerPeriod
        ? (getOne(sale.customer) ?? customerMap.get(String(sale.customer_id ?? "")))
        : null;
      const gender = inCustomerPeriod ? getCustomerGender(customer) : "";
      const ageRange = inCustomerPeriod ? getAgeRange(customer) : "";
      const segmentKey = inCustomerPeriod ? `${gender} / ${ageRange}` : "";
      const segment = inCustomerPeriod
        ? (customerSegments.get(segmentKey) ?? {
            segment: segmentKey,
            gender,
            ageRange,
            customers: new Set<string>(),
            orders: 0,
            units: 0,
            revenue: 0,
            topCategories: new Map<string, number>(),
            topBrands: new Map<string, number>(),
            topSizes: new Map<string, number>(),
            topProducts: new Map<string, number>(),
          })
        : null;
      const explicitCustomerGender = inCustomerPeriod ? getCustomerGender(customer) : "";

      if (inCustomerPeriod && segment) {
        if (customer?.customer_id) segment.customers.add(String(customer.customer_id));
        segment.orders += 1;
        segment.revenue += getSaleAmount(sale);
      }

      const dayKey = localDateKey(date);
      const day = dailySales.get(dayKey) ?? { date, revenue: 0, units: 0 };
      day.revenue += getSaleAmount(sale);

      details.forEach((detail: any) => {
        const product = getOne(detail.product) ?? productMap.get(String(detail.product_id ?? ""));
        const id = String(detail.product_id ?? product?.product_id ?? "");
        const qty = Number(detail.quantity ?? 0);
        const revenue = Number(detail.subtotal ?? detail.price * qty ?? 0);
        const category = getCategory(product);
        const brand = String(product?.brand ?? "N/A");
        const size = String(product?.size ?? "N/A");
        const productName = String(product?.product_name ?? detail?.product_name ?? "Unknown Product");
        const productGender = String(product?.gender ?? "").trim();

        day.units += qty;
        if (inCustomerPeriod && segment) {
          segment.units += qty;
          segment.topCategories.set(category, (segment.topCategories.get(category) ?? 0) + qty);
          segment.topBrands.set(brand, (segment.topBrands.get(brand) ?? 0) + qty);
          segment.topSizes.set(size, (segment.topSizes.get(size) ?? 0) + qty);
          segment.topProducts.set(productName, (segment.topProducts.get(productName) ?? 0) + qty);
        }
        if (inCustomerPeriod) {
          const itemGender = explicitCustomerGender || getCustomerGender(null, productGender) || "Unisex";
          const genderSegment = genderSegments.get(itemGender) ?? {
            label: itemGender,
            customers: new Set<string>(),
            orders: new Set<string>(),
            units: 0,
            revenue: 0,
            topCategories: new Map<string, number>(),
            topBrands: new Map<string, number>(),
            topSizes: new Map<string, number>(),
            topProducts: new Map<string, number>(),
          };

          const customerKey = customer?.customer_id ? String(customer.customer_id) : sale.sales_id ? `walkin-${sale.sales_id}` : "";
          if (customerKey) {
            if (genderSegment.customers instanceof Set) {
              genderSegment.customers.add(customerKey);
            } else {
              genderSegment.customers = new Set<string>(genderSegment.customers ? [String(genderSegment.customers)] : []);
              genderSegment.customers.add(customerKey);
            }
          }
          if (sale.sales_id) {
            if (genderSegment.orders instanceof Set) {
              genderSegment.orders.add(String(sale.sales_id));
            } else {
              genderSegment.orders = new Set<string>(genderSegment.orders ? [String(genderSegment.orders)] : []);
              genderSegment.orders.add(String(sale.sales_id));
            }
          }
          genderSegment.units += qty;
          genderSegment.revenue += revenue;
          genderSegment.topCategories.set(category, (genderSegment.topCategories.get(category) ?? 0) + qty);
          genderSegment.topBrands.set(brand, (genderSegment.topBrands.get(brand) ?? 0) + qty);
          genderSegment.topSizes.set(size, (genderSegment.topSizes.get(size) ?? 0) + qty);
          genderSegment.topProducts.set(productName, (genderSegment.topProducts.get(productName) ?? 0) + qty);

          genderSegments.set(itemGender, genderSegment);
        }

        if (id) {
          const prev = productStats.get(id) ?? {
            id,
            name: String(product?.product_name ?? "Unknown Product"),
            brand,
            category,
            size,
            gender: String(product?.gender ?? "N/A"),
            stock: getStock(product),
            reorder: getReorder(product),
            price: getPrice(product, detail),
            units30: 0,
            units90: 0,
            unitsPeriod: 0,
            revenue30: 0,
            revenue90: 0,
            revenuePeriod: 0,
          };
          if (inProductPeriod) {
            prev.unitsPeriod += qty;
            prev.revenuePeriod += revenue;
          }
          if (in30) {
            prev.units30 += qty;
            prev.revenue30 += revenue;
          }
          if (in90) {
            prev.units90 += qty;
            prev.revenue90 += revenue;
          }
          productStats.set(id, prev);
        }

        const categoryPrev = categoryStats.get(category) ?? { name: category, units: 0, revenue: 0 };
        const brandPrev = brandStats.get(brand) ?? { name: brand, units: 0, revenue: 0 };
        const sizePrev = sizeStats.get(size) ?? { name: size, units: 0, revenue: 0 };
        if (inTopRankingPeriod) {
          categoryPrev.units += qty;
          categoryPrev.revenue += revenue;
          brandPrev.units += qty;
          brandPrev.revenue += revenue;
          sizePrev.units += qty;
          sizePrev.revenue += revenue;
        }
        categoryStats.set(category, categoryPrev);
        brandStats.set(brand, brandPrev);
        sizeStats.set(size, sizePrev);
      });

      dailySales.set(dayKey, day);
      if (inCustomerPeriod && segment) customerSegments.set(segmentKey, segment);
    });

    const productRows = Array.from(productStats.values());
    const avgUnitsPeriod = productRows.length
      ? productRows.reduce((sum, product) => sum + product.unitsPeriod, 0) / productRows.length
      : 0;

    const productMovement = productRows
      .map((product) => {
        const averageStock = Math.max(1, (Number(product.stock) + Number(product.units90)) / 2);
        const turnover = Number(product.units90) / averageStock;
        const movement = product.unitsPeriod === 0
          ? "Dead Stock"
          : product.unitsPeriod >= Math.max(3, avgUnitsPeriod * 1.3)
            ? "Fast"
            : product.unitsPeriod <= Math.max(1, avgUnitsPeriod * 0.5)
              ? "Slow"
              : "Steady";
        const stockCondition = product.stock <= 0
          ? "Out of Stock"
          : product.reorder > 0 && product.stock <= product.reorder
            ? "Critical"
            : product.reorder > 0 && product.stock <= product.reorder * 1.5
              ? "Warning"
              : "Good";
        return { ...product, turnover, movement, stockCondition };
      })
      .sort((a, b) => b.unitsPeriod - a.unitsPeriod || b.stock - a.stock);

    const totalUnits90 = productMovement.reduce((sum, product) => sum + product.units90, 0);
    const totalStock = productMovement.reduce((sum, product) => sum + product.stock, 0);
    const avgInventory = Math.max(1, (totalStock + totalUnits90) / 2);
    const inventoryTurnover = totalUnits90 / avgInventory;

    const restockAlerts = productMovement
      .filter((product) => product.stock <= product.reorder || product.stock <= 0)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 6);

    const overstockSlowMovers = productMovement
      .filter((product) => ["Slow", "Dead Stock"].includes(product.movement) && product.stock > Math.max(5, product.reorder))
      .slice(0, 6);

    const dailyRows = Array.from(dailySales.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    const last30Days = dailyRows.filter((row) => row.date >= last30);
    const revenue30 = last30Days.reduce((sum, row) => sum + row.revenue, 0);
    const activeSalesDays = Math.max(1, last30Days.length);
    const predictedNextMonth = Math.round((revenue30 / activeSalesDays) * 30);
    const projectedUnits = Math.round((last30Days.reduce((sum, row) => sum + row.units, 0) / activeSalesDays) * 30);

    const getPeriodStart = (period: RevenueTrendPeriod) => {
      const start = new Date(now);
      if (period === "daily") start.setDate(now.getDate() - 30);
      if (period === "weekly") start.setDate(now.getDate() - 84);
      if (period === "monthly") start.setMonth(now.getMonth() - 11);
      if (period === "quarterly") start.setMonth(now.getMonth() - 21);
      if (period === "annually") start.setFullYear(now.getFullYear() - 4);
      start.setHours(0, 0, 0, 0);
      return start;
    };

    const labelForPeriodDate = (date: Date, period: RevenueTrendPeriod) => {
      if (period === "weekly") {
        const weekEnd = addDays(date, 6);
        return `${formatShortDate(date)}-${formatShortDate(weekEnd)}`;
      }
      if (period === "monthly") return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
      if (period === "quarterly") return `Q${getQuarter(date)} ${date.getFullYear()}`;
      if (period === "annually") return String(date.getFullYear());
      return formatShortDate(date);
    };

    const addPeriod = (date: Date, period: RevenueTrendPeriod, amount = 1) => {
      const copy = new Date(date);
      if (period === "daily") copy.setDate(copy.getDate() + amount);
      if (period === "weekly") copy.setDate(copy.getDate() + amount * 7);
      if (period === "monthly") copy.setMonth(copy.getMonth() + amount);
      if (period === "quarterly") copy.setMonth(copy.getMonth() + amount * 3);
      if (period === "annually") copy.setFullYear(copy.getFullYear() + amount);
      return copy;
    };

    const getPeriodEnd = (date: Date, period: RevenueTrendPeriod) => {
      if (period === "daily") return new Date(date);
      if (period === "weekly") return addDays(date, 6);
      if (period === "monthly") return new Date(date.getFullYear(), date.getMonth() + 1, 0);
      if (period === "quarterly") return new Date(date.getFullYear(), date.getMonth() + 3, 0);
      return new Date(date.getFullYear(), 11, 31);
    };

    const countDaysInclusive = (start: Date, end: Date) => {
      const startDate = new Date(start);
      const endDate = new Date(end);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(0, 0, 0, 0);
      return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
    };

    const buildPeriodBuckets = (period: RevenueTrendPeriod, start: Date) => {
      const buckets = new Map<string, { key: string; date: Date; label: string; revenue: number; units: number }>();
      dailyRows
        .filter((row) => row.date >= start)
        .forEach((row) => {
        let key = localDateKey(row.date);
        let label = formatShortDate(row.date);
        let bucketDate = new Date(row.date);

        if (period === "weekly") {
          bucketDate = startOfWeek(row.date);
          key = localDateKey(bucketDate);
          label = labelForPeriodDate(bucketDate, period);
        } else if (period === "monthly") {
          bucketDate = new Date(row.date.getFullYear(), row.date.getMonth(), 1);
          key = `${row.date.getFullYear()}-${String(row.date.getMonth() + 1).padStart(2, "0")}`;
          label = labelForPeriodDate(bucketDate, period);
        } else if (period === "quarterly") {
          const quarter = getQuarter(row.date);
          bucketDate = new Date(row.date.getFullYear(), (quarter - 1) * 3, 1);
          key = `${row.date.getFullYear()}-Q${quarter}`;
          label = labelForPeriodDate(bucketDate, period);
        } else if (period === "annually") {
          bucketDate = new Date(row.date.getFullYear(), 0, 1);
          key = String(row.date.getFullYear());
          label = labelForPeriodDate(bucketDate, period);
        }

        const bucket = buckets.get(key) ?? { key, date: bucketDate, label, revenue: 0, units: 0 };
        bucket.revenue += row.revenue;
        bucket.units += row.units;
        buckets.set(key, bucket);
      });
      return Array.from(buckets.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
    };

    const trendChart = buildPeriodBuckets(revenueTrendPeriod, getPeriodStart(revenueTrendPeriod))
      .map((row) => ({
        date: row.label,
        revenue: Math.round(row.revenue),
        units: row.units,
      }));

    const forecastHistory = buildPeriodBuckets(salesForecastPeriod, getPeriodStart(salesForecastPeriod));
    const recentForecastBase = forecastHistory.filter((row) => row.revenue > 0 || row.units > 0).slice(-6);
    const forecastBase = recentForecastBase.length ? recentForecastBase : forecastHistory.slice(-3);
    const selectedPeriodBase = forecastBase.length ? forecastBase : forecastHistory;
    const dailyModelStart = dailyRows[0]?.date && dailyRows[0].date > last90 ? new Date(dailyRows[0].date) : new Date(last90);
    dailyModelStart.setHours(0, 0, 0, 0);
    const dailyModelDays = countDaysInclusive(dailyModelStart, now);
    const dailyModelRows = Array.from({ length: dailyModelDays }, (_, index) => {
      const date = addDays(dailyModelStart, index);
      const key = localDateKey(date);
      const existing = dailySales.get(key);
      return {
        date,
        index,
        revenue: existing?.revenue ?? 0,
        units: existing?.units ?? 0,
      };
    });
    const dailyModelBase = dailyModelRows.length ? dailyModelRows : [{ date: now, index: 0, revenue: 0, units: 0 }];
    const averageDailyRevenue = dailyModelBase.reduce((sum, row) => sum + row.revenue, 0) / Math.max(1, dailyModelBase.length);
    const averageDailyUnits = dailyModelBase.reduce((sum, row) => sum + row.units, 0) / Math.max(1, dailyModelBase.length);
    const firstHalf = dailyModelBase.slice(0, Math.max(1, Math.floor(dailyModelBase.length / 2)));
    const secondHalf = dailyModelBase.slice(Math.max(1, Math.floor(dailyModelBase.length / 2)));
    const firstHalfRevenue = firstHalf.reduce((sum, row) => sum + row.revenue, 0) / Math.max(1, firstHalf.length);
    const secondHalfRevenue = secondHalf.reduce((sum, row) => sum + row.revenue, 0) / Math.max(1, secondHalf.length);
    const dailyTrendRate = firstHalfRevenue > 0
      ? Math.max(-0.25, Math.min(0.25, (secondHalfRevenue - firstHalfRevenue) / firstHalfRevenue))
      : 0;
    const hasReliableForecastHistory = dailyModelBase.filter((row) => row.revenue > 0 || row.units > 0).length >= 3 || forecastBase.length >= 2;
    const recentWindowSize = Math.min(14, Math.max(1, Math.floor(dailyModelBase.length / 3)));
    const recentWindow = dailyModelBase.slice(-recentWindowSize);
    const previousWindow = dailyModelBase.slice(-recentWindowSize * 2, -recentWindowSize);
    const recentWindowRevenue = recentWindow.reduce((sum, row) => sum + row.revenue, 0) / Math.max(1, recentWindow.length);
    const previousWindowRevenue = previousWindow.reduce((sum, row) => sum + row.revenue, 0) / Math.max(1, previousWindow.length);
    const recentMomentumRate = previousWindowRevenue > 0
      ? Math.max(-0.25, Math.min(0.25, (recentWindowRevenue - previousWindowRevenue) / previousWindowRevenue))
      : dailyTrendRate;
    const activeRevenueDays = dailyModelBase.filter((row) => row.revenue > 0).length;
    const revenueVariance = dailyModelBase.reduce((sum, row) => sum + Math.pow(row.revenue - averageDailyRevenue, 2), 0) / Math.max(1, dailyModelBase.length);
    const revenueVolatility = averageDailyRevenue > 0 ? Math.min(1, Math.sqrt(revenueVariance) / averageDailyRevenue) : 1;
    const periodRevenueRows = selectedPeriodBase.map((row) => Number(row.revenue ?? 0));
    const activeRevenuePeriods = periodRevenueRows.filter((value) => value > 0).length;
    const firstPeriodHalf = periodRevenueRows.slice(0, Math.max(1, Math.floor(periodRevenueRows.length / 2)));
    const secondPeriodHalf = periodRevenueRows.slice(Math.max(1, Math.floor(periodRevenueRows.length / 2)));
    const firstPeriodAverage = firstPeriodHalf.reduce((sum, value) => sum + value, 0) / Math.max(1, firstPeriodHalf.length);
    const secondPeriodAverage = secondPeriodHalf.reduce((sum, value) => sum + value, 0) / Math.max(1, secondPeriodHalf.length);
    const periodTrendRate = firstPeriodAverage > 0
      ? Math.max(-0.35, Math.min(0.35, (secondPeriodAverage - firstPeriodAverage) / firstPeriodAverage))
      : dailyTrendRate;
    const recentPeriodWindowSize = Math.min(3, Math.max(1, Math.floor(periodRevenueRows.length / 2)));
    const recentPeriodWindow = periodRevenueRows.slice(-recentPeriodWindowSize);
    const previousPeriodWindow = periodRevenueRows.slice(-recentPeriodWindowSize * 2, -recentPeriodWindowSize);
    const recentPeriodAverage = recentPeriodWindow.reduce((sum, value) => sum + value, 0) / Math.max(1, recentPeriodWindow.length);
    const previousPeriodAverage = previousPeriodWindow.reduce((sum, value) => sum + value, 0) / Math.max(1, previousPeriodWindow.length);
    const periodMomentumRate = previousPeriodAverage > 0
      ? Math.max(-0.35, Math.min(0.35, (recentPeriodAverage - previousPeriodAverage) / previousPeriodAverage))
      : periodTrendRate;
    const averagePeriodRevenue = periodRevenueRows.reduce((sum, value) => sum + value, 0) / Math.max(1, periodRevenueRows.length);
    const periodRevenueVariance = periodRevenueRows.reduce((sum, value) => sum + Math.pow(value - averagePeriodRevenue, 2), 0) / Math.max(1, periodRevenueRows.length);
    const periodRevenueVolatility = averagePeriodRevenue > 0 ? Math.min(1, Math.sqrt(periodRevenueVariance) / averagePeriodRevenue) : revenueVolatility;
    const historyQuality = hasReliableForecastHistory ? Math.min(1, Math.max(activeRevenueDays / 12, activeRevenuePeriods / 4)) : 0.35;
    const probabilitySignal = (periodTrendRate * 0.6) + (periodMomentumRate * 0.4);
    const probabilityConfidence = historyQuality * Math.max(0.35, 1 - periodRevenueVolatility * 0.35);
    const scenarioSpread = hasReliableForecastHistory
      ? Math.min(0.45, Math.max(0.12, Math.abs(periodTrendRate) + 0.15))
      : 0.35;
    const probabilityForHorizon = (horizonIndex = 0) => {
      const horizonDecay = Math.max(0.45, 1 - horizonIndex * 0.08);
      const directionalSwing = Math.round(probabilitySignal * 140 * probabilityConfidence * horizonDecay);
      return Math.max(20, Math.min(80, 50 + directionalSwing));
    };
    const higherProbability = probabilityForHorizon(0);
    const lowerProbability = 100 - higherProbability;
    const forecastCountByPeriod: Record<RevenueTrendPeriod, number> = {
      daily: 7,
      weekly: 4,
      monthly: 6,
      quarterly: 4,
      annually: 3,
    };
    const lastForecastDate = forecastHistory[forecastHistory.length - 1]?.date ?? now;
    const forecastRows = Array.from({ length: forecastCountByPeriod[salesForecastPeriod] }, (_, index) => {
      const date = addPeriod(lastForecastDate, salesForecastPeriod, index + 1);
      const periodEnd = getPeriodEnd(date, salesForecastPeriod);
      const daysInPeriod = countDaysInclusive(date, periodEnd);
      const multiplier = Math.max(0.1, 1 + dailyTrendRate * ((index + 1) / 2));
      const projectedRevenue = Math.round(averageDailyRevenue * daysInPeriod * multiplier);
      const projectedUnits = Math.max(0, Math.round(averageDailyUnits * daysInPeriod * multiplier));
      return {
        date: labelForPeriodDate(date, salesForecastPeriod),
        projectedRevenue,
        projectedRevenueHigh: Math.round(projectedRevenue * (1 + scenarioSpread)),
        projectedRevenueLow: Math.max(0, Math.round(projectedRevenue * (1 - scenarioSpread))),
        higherProbability: probabilityForHorizon(index),
        lowerProbability: 100 - probabilityForHorizon(index),
        projectedUnits,
      };
    });
    const visibleForecastHistory = forecastHistory.slice(-5);
    const lastVisibleActualIndex = visibleForecastHistory.length - 1;
    const lastActualRevenue = visibleForecastHistory[lastVisibleActualIndex]?.revenue ?? 0;
    const lastActualUnits = visibleForecastHistory[lastVisibleActualIndex]?.units ?? 0;
    const salesForecastChart = [
      ...visibleForecastHistory.map((row, index) => ({
        date: row.label,
        actualRevenue: Math.round(row.revenue),
        projectedRevenue: index === lastVisibleActualIndex ? Math.round(lastActualRevenue) : null,
        projectedRevenueHigh: index === lastVisibleActualIndex ? Math.round(lastActualRevenue) : null,
        projectedRevenueLow: index === lastVisibleActualIndex ? Math.round(lastActualRevenue) : null,
        higherProbability: index === lastVisibleActualIndex ? higherProbability : null,
        lowerProbability: index === lastVisibleActualIndex ? lowerProbability : null,
        actualUnits: row.units,
        projectedUnits: index === lastVisibleActualIndex ? lastActualUnits : null,
      })),
      ...forecastRows.map((row) => ({
        date: row.date,
        actualRevenue: null,
        projectedRevenue: row.projectedRevenue,
        projectedRevenueHigh: row.projectedRevenueHigh,
        projectedRevenueLow: row.projectedRevenueLow,
        higherProbability: row.higherProbability,
        lowerProbability: row.lowerProbability,
        actualUnits: null,
        projectedUnits: row.projectedUnits,
      })),
    ];
    const forecastTotalRevenue = forecastRows.reduce((sum, row) => sum + row.projectedRevenue, 0);
    const forecastTotalUnits = forecastRows.reduce((sum, row) => sum + row.projectedUnits, 0);
    const forecastPeriodCount = forecastRows.length;
    const forecastConfidence = hasReliableForecastHistory
      ? Math.min(90, Math.max(55, 52 + forecastBase.length * 7))
      : 35;
    const forecastNote = hasReliableForecastHistory
      ? "Based on recent completed sales movement."
      : "Limited history for this period. Treat this as a rough estimate.";
    const salesForecastPeriodLabel = revenueTrendOptions.find((option) => option.id === salesForecastPeriod)?.label ?? "Monthly";

    const categoryChart = Array.from(categoryStats.values())
      .sort((a, b) => b.units - a.units)
      .slice(0, 5)
      .map((row, index) => ({ ...row, fill: ["#facc15", "#fde047", "#fef08a", "#fbbf24", "#fef9c3"][index] }));

    const segmentRows = Array.from(customerSegments.values())
      .map((segment) => {
        const topCategory = getTopKey(segment.topCategories);
        const topSize = getTopKey(segment.topSizes);
        return {
          segment: segment.segment,
          gender: segment.gender,
          ageRange: segment.ageRange,
          customers: segment.customers.size,
          orders: segment.orders,
          units: segment.units,
          revenue: segment.revenue,
          topCategory,
          topBrand: getTopKey(segment.topBrands),
          topSize,
          topProduct: getTopKey(segment.topProducts),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const formatCustomerSegment = (segment: any) => {
      const topCategory = getTopKey(segment.topCategories);
      const topSize = getTopKey(segment.topSizes);
      return {
        label: segment.label,
        customers: segment.customers instanceof Set ? segment.customers.size : Number(segment.customers ?? 0),
        orders: segment.orders instanceof Set ? segment.orders.size : Number(segment.orders ?? 0),
        units: segment.units,
        revenue: segment.revenue,
        topCategory,
        topBrand: getTopKey(segment.topBrands),
        topSize,
        topProduct: getTopKey(segment.topProducts),
      };
    };

    const isKnownGender = (label: string) => !["unknown", "n/a", "none"].includes(String(label).trim().toLowerCase());

    const genderColorMap: Record<string, string> = {
      Women: "#fb7185",
      Men: "#38bdf8",
      Unisex: "#facc15",
      Kids: "#4ade80",
    };

    const genderRows = Array.from(genderSegments.values())
      .map(formatCustomerSegment)
      .filter((row) => isKnownGender(row.label))
      .sort((a, b) => b.revenue - a.revenue);

    const topBuyingGender = genderRows[0] ?? null;

    const genderChart = genderRows.map((row) => ({
      name: row.label,
      fullLabel: row.label,
      revenue: Math.round(row.revenue),
      units: row.units,
      orders: row.orders,
      customers: row.customers,
      fill: genderColorMap[row.label] ?? "#facc15",
    }));

    const buildRankingRows = (rows: any[]) => {
      const total = rows.reduce((sum, row) => sum + Number(row[topRankingMetric] ?? 0), 0);
      return rows
        .sort((a, b) => Number(b[topRankingMetric] ?? 0) - Number(a[topRankingMetric] ?? 0))
        .slice(0, 5)
        .map((row) => {
          const value = Number(row[topRankingMetric] ?? 0);
          return {
            ...row,
            share: total > 0 ? Math.round((value / total) * 100) : 0,
          };
        });
    };

    const topBrands = buildRankingRows(Array.from(brandStats.values()));
    const topSizes = buildRankingRows(Array.from(sizeStats.values()));
    const topCategories = buildRankingRows(Array.from(categoryStats.values()));

    const promotionSuggestions = [
      ...overstockSlowMovers.slice(0, 3).map((product) => ({
        title: `Markdown ${product.name}`,
        target: `${product.brand} ${product.category}`,
        reason: `${product.movement} with ${product.stock} units on hand and only ${product.unitsPeriod} sold in the ${productPeriodLabel.toLowerCase()} view.`,
        action: product.unitsPeriod === 0 ? "Bundle or BOGO" : "10%-15% discount",
      })),
      ...restockAlerts.slice(0, 2).map((product) => ({
        title: `Protect stock for ${product.name}`,
        target: `${product.brand} size ${product.size}`,
        reason: `${product.stockCondition}: ${product.stock} units left vs reorder level ${product.reorder}.`,
        action: "Restock before promoting",
      })),
    ].slice(0, 5);

    const totalUnitsAllTime = Math.max(
      sales.reduce((sum: number, sale: any) => {
        const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
        return sum + details.reduce((detailSum: number, detail: any) => detailSum + Number(detail.quantity ?? 0), 0);
      }, 0),
      1,
    );
    const today = localDateKey(new Date());

    const promotionPerformance = promotions
      .map((promo: any, index: number) => {
        const promoProducts = Array.isArray(promo.promo_product) ? promo.promo_product : [];
        const productIds = new Set(promoProducts.map((row: any) => String(row.product_id ?? row.product?.product_id ?? "")));
        const parsedTargets = parsePromotionTargets(promo.target_products ?? promo.targetProducts);
        const hasSpecificTargets = productIds.size > 0 || parsedTargets.products.length > 0 || parsedTargets.categories.length > 0;
        const promoId = String(promo.promo_id ?? `promo-${index}`);
        const start = toDate(promo.start_date);
        const end = endOfDay(toDate(promo.end_date));
        const startDate = String(promo.start_date ?? "").slice(0, 10);
        const endDate = String(promo.end_date ?? "").slice(0, 10);
        const rawStatus = String(promo.status ?? promo.promo_status ?? "").toLowerCase();

        const derivedStatus =
          rawStatus.includes("expired") || (endDate && endDate < today)
            ? "Ended"
            : rawStatus.includes("active") || (startDate && startDate <= today && endDate && endDate >= today)
              ? "Active"
              : "Scheduled";

        let revenue = 0;
        let units = 0;
        sales.forEach((sale: any) => {
          const date = toDate(sale.transaction_date ?? sale.created_at);
          if (!date) return;
          const saleDateKey = businessDateKey(date);
          if (startDate && saleDateKey < startDate) return;
          if (endDate && saleDateKey > endDate) return;
          const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
          details.forEach((detail: any) => {
            const productId = String(detail.product_id ?? "");
            const product = productMap.get(productId) ?? detail.product;
            const productName = String(product?.product_name ?? "").trim().toLowerCase();
            const categoryName = getCategory(product).trim().toLowerCase();
            const detailPromoId = String(detail.promo_id ?? detail.promotion_id ?? "");
            const matchesExactPromo = detailPromoId && detailPromoId === promoId;
            const matchesLinkedProduct = productIds.has(productId);
            const matchesNamedProduct = parsedTargets.products.includes(productName);
            const matchesCategory = parsedTargets.categories.includes(categoryName);
            const matchesPromoTarget = !hasSpecificTargets || matchesLinkedProduct || matchesNamedProduct || matchesCategory;
            if (!matchesExactPromo && !matchesPromoTarget) return;
            units += Number(detail.quantity ?? 0);
            revenue += getSaleDetailRevenue(detail);
          });
        });

        return {
          id: promoId,
          name: String(promo.promo_name ?? "Promotion"),
          status: derivedStatus,
          start: start ? formatShortDate(start) : "N/A",
          end: end ? formatShortDate(end) : "N/A",
          revenue,
          units,
          contribution: Number(((units / totalUnitsAllTime) * 100).toFixed(1)),
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const activePromotionCount = promotionPerformance.filter((promo) => promo.status.toLowerCase() === "active").length;
    const activePromotionChart = promotionPerformance
      .filter((promo) => promo.status.toLowerCase() === "active")
      .slice(0, 8)
      .map((promo) => ({
        name: shortLabel(promo.name),
        fullName: promo.name,
        revenue: Math.round(promo.revenue),
        units: promo.units,
        contribution: promo.contribution,
      }));
    const promoRevenue = promotionPerformance.reduce((sum, promo) => sum + promo.revenue, 0);
    const promoUnits = promotionPerformance.reduce((sum, promo) => sum + promo.units, 0);

    return {
      productMovement,
      fastProducts: productMovement.filter((product) => product.movement === "Fast").slice(0, 5),
      slowProducts: productMovement.filter((product) => ["Slow", "Dead Stock"].includes(product.movement)).slice(0, 5),
      restockAlerts,
      inventoryTurnover,
      predictedNextMonth,
      projectedUnits,
      trendChart,
      salesForecastChart,
      forecastTotalRevenue,
      forecastTotalUnits,
      forecastPeriodCount,
      forecastConfidence,
      forecastNote,
      higherProbability,
      lowerProbability,
      scenarioSpread,
      hasReliableForecastHistory,
      salesForecastPeriodLabel,
      categoryChart,
      segmentRows,
      genderRows,
      genderChart,
      topBuyingGender,
      customerPeriodLabel,
      topBrands,
      topSizes,
      topCategories,
      promotionSuggestions,
      revenue30,
      totalUnits90,
      productPeriodLabel,
      topRankingPeriodLabel,
      promotionPerformance,
      activePromotionCount,
      activePromotionChart,
      promoRevenue,
      promoUnits,
    };
  }, [customerAnalyticsPeriod, customers, customEndDate, customStartDate, effectiveProductAnalyticsPeriod, productAnalyticsPeriod, products, promotions, revenueTrendPeriod, sales, salesForecastPeriod, topRankingMetric, topRankingPeriod]);

  const analytics = useMemo(() => {
    const snapshotData = snapshotQuery.data;
    if (!snapshotData?.snapshots?.length) return computedAnalytics;

    const productById = new Map(
      products.map((product: any) => [String(product.product_id ?? ""), product]),
    );
    const movementLabel = (value: string) => {
      const lower = String(value ?? "").toLowerCase();
      if (lower === "fast") return "Fast";
      if (lower === "slow") return "Slow";
      if (lower === "steady") return "Steady";
      return "Dead Stock";
    };
    const productMovement = snapshotData.snapshots
      .map((row) => {
        const product = productById.get(String(row.product_id ?? ""));
        const stock = product ? getStock(product) : Number(row.stock_quantity ?? 0);
        const reorder = getReorder(product);
        const movement = movementLabel(row.movement_label);
        const stockCondition = stock <= 0
          ? "Out of Stock"
          : reorder > 0 && stock <= reorder
            ? "Critical"
            : reorder > 0 && stock <= reorder * 1.5
              ? "Warning"
              : "Good";
        return {
          id: row.product_id,
          name: String(product?.product_name ?? "Unknown Product"),
          brand: String(row.brand ?? product?.brand ?? "N/A"),
          category: String(row.category_name ?? getCategory(product)),
          size: String(row.size_label ?? product?.size ?? "N/A"),
          gender: String(product?.gender ?? "N/A"),
          stock,
          reorder,
          price: Number(row.average_unit_price ?? getPrice(product)),
          units30: 0,
          units90: Number(row.units_sold ?? 0),
          unitsPeriod: Number(row.units_sold ?? 0),
          revenue30: 0,
          revenue90: Number(row.revenue ?? 0),
          revenuePeriod: Number(row.revenue ?? 0),
          turnover: Number(row.turnover_ratio ?? 0),
          movement,
          stockCondition,
        };
      })
      .sort((a, b) => b.unitsPeriod - a.unitsPeriod || b.stock - a.stock);

    const dimRows = snapshotData.dimensions ?? [];
    const toRankRows = (type: "brand" | "size" | "category") =>
      dimRows
        .filter((row) => row.dimension_type === type)
        .sort((a, b) => Number(a.rank_position ?? 9999) - Number(b.rank_position ?? 9999))
        .slice(0, 5)
        .map((row) => ({
          name: row.dimension_value,
          units: Number(row.units ?? 0),
          revenue: Number(row.revenue ?? 0),
          share: Math.round(Number(row.share_percent ?? 0)),
        }));

    const categoryChart = dimRows
      .filter((row) => row.dimension_type === "category")
      .sort((a, b) => Number(b.units ?? 0) - Number(a.units ?? 0))
      .slice(0, 5)
      .map((row, index) => ({
        name: row.dimension_value,
        units: Number(row.units ?? 0),
        revenue: Number(row.revenue ?? 0),
        fill: ["#facc15", "#fde047", "#fef08a", "#fbbf24", "#fef9c3"][index],
      }));

    const promotionSuggestions = (snapshotData.recommendations ?? [])
      .slice(0, 5)
      .map((rec) => {
        const product = productById.get(String(rec.product_id ?? ""));
        const action = rec.recommendation_type === "markdown"
          ? `${Number(rec.suggested_discount_min ?? 10)}%-${Number(rec.suggested_discount_max ?? 15)}% discount`
          : rec.recommendation_type === "bundle_or_bogo"
            ? "Bundle or BOGO"
            : "Restock before promoting";
        return {
          title: rec.title,
          target: `${String(product?.brand ?? "N/A")} ${String(getCategory(product))}`,
          reason: rec.message,
          action,
        };
      });

    const totalUnits90 = productMovement.reduce((sum, product) => sum + Number(product.units90 ?? 0), 0);
    const totalStock = productMovement.reduce((sum, product) => sum + Number(product.stock ?? 0), 0);
    const avgInventory = Math.max(1, (totalStock + totalUnits90) / 2);

    return {
      ...computedAnalytics,
      productMovement,
      fastProducts: productMovement.filter((product) => product.movement === "Fast").slice(0, 5),
      slowProducts: productMovement.filter((product) => ["Slow", "Dead Stock"].includes(product.movement)).slice(0, 5),
      restockAlerts: productMovement.filter((product) => product.stock <= product.reorder || product.stock <= 0).slice(0, 6),
      inventoryTurnover: totalUnits90 / avgInventory,
      categoryChart,
      topBrands: toRankRows("brand"),
      topSizes: toRankRows("size"),
      topCategories: toRankRows("category"),
      promotionSuggestions: promotionSuggestions.length ? promotionSuggestions : computedAnalytics.promotionSuggestions,
    };
  }, [computedAnalytics, products, snapshotQuery.data]);

  if (salesQuery.isLoading || productsQuery.isLoading || customersQuery.isLoading || promotionsQuery.isLoading) {
    return <div className="text-sm text-white/60">Loading analytics...</div>;
  }

  const showProduct = analyticsView === "product";
  const showCustomer = analyticsView === "customer";
  const showSales = analyticsView === "sales";
  const showPromotion = analyticsView === "promotion";
  const hasActivePromotionPerformance = analytics.activePromotionChart.some((promo) => promo.revenue > 0 || promo.units > 0);
  const categoryUnitsTotal = analytics.categoryChart.reduce((sum, row) => sum + Number(row.units ?? 0), 0);
  const availableCategories = useMemo(() => {
    const set = new Set<string>();
    analytics.productMovement.forEach((p) => {
      const cat = String(p.category ?? "").trim();
      if (cat && cat !== "N/A" && cat !== "Unknown") set.add(cat);
    });
    return Array.from(set).sort();
  }, [analytics.productMovement]);

  const availableDepartments = useMemo(() => {
    const set = new Set<string>();
    analytics.productMovement.forEach((p) => {
      const dept = String(p.gender ?? "").trim();
      if (dept && dept !== "N/A" && dept !== "Unknown") set.add(dept);
    });
    return Array.from(set).sort();
  }, [analytics.productMovement]);

  const filteredProductMovement = useMemo(() => {
    const query = productSearchTerm.trim().toLowerCase();
    return analytics.productMovement.filter((p) => {
      if (query) {
        const nameMatch = String(p.name ?? "").toLowerCase().includes(query);
        const brandMatch = String(p.brand ?? "").toLowerCase().includes(query);
        const catMatch = String(p.category ?? "").toLowerCase().includes(query);
        const sizeMatch = String(p.size ?? "").toLowerCase().includes(query);
        const idMatch = String(p.id ?? "").toLowerCase().includes(query);
        if (!nameMatch && !brandMatch && !catMatch && !sizeMatch && !idMatch) return false;
      }
      if (productCategoryFilter !== "all" && String(p.category ?? "").toLowerCase() !== productCategoryFilter.toLowerCase()) {
        return false;
      }
      if (productDepartmentFilter !== "all" && String(p.gender ?? "").toLowerCase() !== productDepartmentFilter.toLowerCase()) {
        return false;
      }
      if (productMovementFilter !== "all" && String(p.movement ?? "").toLowerCase() !== productMovementFilter.toLowerCase()) {
        return false;
      }
      return true;
    });
  }, [analytics.productMovement, productSearchTerm, productCategoryFilter, productDepartmentFilter, productMovementFilter]);

  const totalProductPages = Math.max(1, Math.ceil(filteredProductMovement.length / productPageSize));
  const currentProductPage = Math.min(Math.max(1, productCurrentPage), totalProductPages);

  const paginatedProductMovement = useMemo(() => {
    const start = (currentProductPage - 1) * productPageSize;
    return filteredProductMovement.slice(start, start + productPageSize);
  }, [filteredProductMovement, currentProductPage, productPageSize]);

  const isFilteringProducts = Boolean(
    productSearchTerm || productCategoryFilter !== "all" || productDepartmentFilter !== "all" || productMovementFilter !== "all"
  );

  const isEuShoeSize = (sizeStr: unknown) => {
    const trimmed = String(sizeStr ?? "").trim();
    if (!trimmed || trimmed === "N/A" || trimmed === "10") return false;
    const num = Number(trimmed);
    if (Number.isFinite(num)) {
      return num >= 30 && num <= 52;
    }
    return false;
  };

  const sizeCurveProducts = (isFilteringProducts ? filteredProductMovement : analytics.productMovement)
    .filter((product) => isEuShoeSize(product.size))
    .slice(0, 60);
  const sizeCurveSizes = Array.from(
    new Set(sizeCurveProducts.map((product) => String(product.size ?? "N/A"))),
  )
    .filter(isEuShoeSize)
    .sort(sortSizeLabels);
  const sizeCurveRows = Array.from(
    sizeCurveProducts.reduce((map, product) => {
      const key = [product.brand, product.name, product.category].join("::");
      const row = map.get(key) ?? {
        key,
        productName: product.name,
        brand: product.brand,
        category: product.category,
        totalSold: 0,
        totalStock: 0,
        sizes: new Map<string, any>(),
      };
      const size = String(product.size ?? "N/A");
      row.totalSold += Number(product.unitsPeriod ?? 0);
      row.totalStock += Number(product.stock ?? 0);
      row.sizes.set(size, product);
      map.set(key, row);
      return map;
    }, new Map<string, any>()).values(),
  )
    .sort((a, b) => b.totalSold - a.totalSold || b.totalStock - a.totalStock)
    .slice(0, 10);
  const maxSizeCurveSold = Math.max(1, ...sizeCurveProducts.map((product) => Number(product.unitsPeriod ?? 0)));
  const maxSizeCurveStock = Math.max(1, ...sizeCurveProducts.map((product) => Number(product.stock ?? 0)));

  const filterTabs = [
    { id: "product" as const, label: "Product Analytics", icon: Package, count: analytics.productMovement.length },
    { id: "customer" as const, label: "Customer Analytics", icon: Users, count: analytics.genderRows.length },
    { id: "sales" as const, label: "Sales Analytics", icon: TrendingUp, count: analytics.trendChart.length },
    { id: "promotion" as const, label: "Promotion Analytics", icon: Sparkles, count: analytics.promotionPerformance.length },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#2b2b36] bg-[#16161d] p-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
          {filterTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = analyticsView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setAnalyticsView(tab.id)}
                className={`flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  isActive
                    ? "bg-yellow-400 text-red-950 shadow-lg shadow-yellow-400/10"
                    : "bg-white/[0.03] text-white/70 hover:bg-white/[0.07] hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
                {tab.count !== null && (
                  <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? "bg-red-950/15" : "bg-yellow-400/15 text-yellow-300"}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {showSales && <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Card className="bg-[#16161d] border-[#2b2b36]">
          <CardHeader>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-white">
                  <BarChart3 className="h-5 w-5 text-yellow-400" />
                  Revenue Trend
                </CardTitle>
                <p className="mt-1 text-sm text-white/55">Completed sales grouped by {revenueTrendOptions.find((option) => option.id === revenueTrendPeriod)?.label.toLowerCase()} period.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {revenueTrendOptions.map((option) => {
                  const active = revenueTrendPeriod === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setRevenueTrendPeriod(option.id)}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                        active
                          ? "bg-yellow-400 text-red-950"
                          : "border border-[#2b2b36] bg-white/[0.03] text-white/70 hover:border-yellow-400/50 hover:text-yellow-200"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={analytics.trendChart} margin={{ top: 12, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2f2f38" />
                <XAxis dataKey="date" stroke="#a3a3a3" fontSize={12} />
                <YAxis stroke="#a3a3a3" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#16161C", border: "1px solid rgba(255, 255, 255, 0.15)", borderRadius: "12px", boxShadow: "0 8px 24px rgba(0,0,0,0.6)", padding: "10px 14px", color: "#FFFFFF" }}
                  labelStyle={{ color: "#FFFFFF", fontWeight: 600, fontSize: 13, marginBottom: 4 }}
                  itemStyle={{ color: "#FFFFFF", fontSize: 12, fontWeight: 500 }}
                  formatter={(value: any) => [money(Number(value)), "Revenue"]}
                />
                <Bar dataKey="revenue" fill="#facc15" radius={[8, 8, 0, 0]} name="Revenue" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-[#16161d] border-[#2b2b36]">
          <CardHeader>
            <CardTitle className="text-white">Category Mix</CardTitle>
            <p className="text-sm text-white/55">Where units are moving fastest.</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={analytics.categoryChart} dataKey="units" nameKey="name" outerRadius={95} innerRadius={48} paddingAngle={3}>
                  {analytics.categoryChart.map((entry) => <Cell key={entry.name} fill={entry.fill} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#16161C", border: "1px solid rgba(255, 255, 255, 0.15)", borderRadius: "12px", boxShadow: "0 8px 24px rgba(0,0,0,0.6)", padding: "10px 14px", color: "#FFFFFF" }}
                  labelStyle={{ color: "#FFFFFF", fontWeight: 600, fontSize: 13, marginBottom: 4 }}
                  itemStyle={{ color: "#FFFFFF", fontSize: 12, fontWeight: 500 }}
                  formatter={(value: any) => {
                    const units = Number(value ?? 0);
                    const pct = categoryUnitsTotal > 0 ? Math.round((units / categoryUnitsTotal) * 100) : 0;
                    return [`${pct}% (${units} units)`, "Share"];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              {analytics.categoryChart.map((category) => (
                <div key={category.name} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2">
                  <span className="truncate text-white/75">{category.name}</span>
                  <span className="font-semibold text-yellow-300">
                    {categoryUnitsTotal > 0 ? Math.round((Number(category.units ?? 0) / categoryUnitsTotal) * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        </div>

        <Card className="bg-[#16161d] border-[#2b2b36]">
          <CardHeader>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-white">
                  <TrendingUp className="h-5 w-5 text-yellow-400" />
                  Sales Forecast
                </CardTitle>
                <p className="mt-1 max-w-2xl text-sm text-white/55">
                  Recent completed sales with a simple forward projection for the next {analytics.forecastPeriodCount} {analytics.salesForecastPeriodLabel.toLowerCase()} periods.
                  Use this as a planning guide, not a guaranteed result.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {revenueTrendOptions.map((option) => {
                  const active = salesForecastPeriod === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setSalesForecastPeriod(option.id)}
                      className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                        active
                          ? "bg-yellow-400 text-red-950"
                          : "border border-[#2b2b36] bg-white/[0.03] text-white/70 hover:border-yellow-400/50 hover:text-yellow-200"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_280px]">
              <div className="rounded-2xl border border-[#2b2b36] bg-[#111118] p-4">
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={analytics.salesForecastChart} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2f2f38" />
                    <XAxis dataKey="date" stroke="#a3a3a3" fontSize={12} interval={0} />
                    <YAxis stroke="#a3a3a3" fontSize={12} />
                    <Tooltip
                      content={({ active, label, payload }) => {
                        if (!active || !payload?.length) return null;
                        const point = payload[0]?.payload ?? {};
                        const isAnchorPoint = point.actualRevenue != null && point.projectedRevenue != null;
                        const pointHigherProbability = typeof point.higherProbability === "number" ? point.higherProbability : analytics.higherProbability;
                        const pointLowerProbability = typeof point.lowerProbability === "number" ? point.lowerProbability : analytics.lowerProbability;
                        const rows = [
                          point.actualRevenue != null ? { label: "Actual Revenue", value: point.actualRevenue, color: "#facc15" } : null,
                          point.projectedRevenue != null ? { label: isAnchorPoint ? "Forecast starts here" : "Steady Forecast", value: point.projectedRevenue, color: "#f8fafc" } : null,
                          !isAnchorPoint && point.projectedRevenueHigh != null ? { label: `Higher Case (${pointHigherProbability}%)`, value: point.projectedRevenueHigh, color: "#22c55e" } : null,
                          !isAnchorPoint && point.projectedRevenueLow != null ? { label: `Lower Case (${pointLowerProbability}%)`, value: point.projectedRevenueLow, color: "#fb7185" } : null,
                        ].filter(Boolean) as Array<{ label: string; value: number; color: string }>;

                        return (
                          <div className="min-w-[230px] rounded-xl border border-white/15 bg-[#16161C] p-3 shadow-2xl shadow-black/60">
                            <p className="text-sm font-semibold text-white">{label}</p>
                            <div className="mt-2 space-y-1.5">
                              {rows.map((row) => (
                                <p key={row.label} className="flex justify-between gap-4 text-sm">
                                  <span style={{ color: row.color }}>{row.label}</span>
                                  <span className="font-semibold text-white">{money(Number(row.value ?? 0))}</span>
                                </p>
                              ))}
                            </div>
                            {isAnchorPoint ? (
                              <p className="mt-2 text-xs text-white/45">Scenarios begin from the latest actual value and spread in future periods.</p>
                            ) : null}
                          </div>
                        );
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="actualRevenue"
                      stroke="#facc15"
                      strokeWidth={3}
                      dot={{ r: 4, fill: "#facc15", stroke: "#111118", strokeWidth: 2 }}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="projectedRevenue"
                      stroke="#f8fafc"
                      strokeDasharray="7 6"
                      strokeWidth={3}
                      dot={{ r: 4, fill: "#ffffff", stroke: "#111118", strokeWidth: 2 }}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="projectedRevenueHigh"
                      stroke="#22c55e"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#22c55e", stroke: "#111118", strokeWidth: 2 }}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="projectedRevenueLow"
                      stroke="#fb7185"
                      strokeDasharray="5 5"
                      strokeWidth={2}
                      dot={{ r: 3, fill: "#fb7185", stroke: "#111118", strokeWidth: 2 }}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
                <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-white/55">
                  <span className="flex items-center gap-2"><span className="h-2 w-8 rounded-full bg-yellow-400" /> Actual sales</span>
                  <span className="flex items-center gap-2"><span className="w-8 border-t-2 border-dashed border-white" /> Steady forecast</span>
                  <span className="flex items-center gap-2"><span className="w-8 border-t-2 border-dashed border-emerald-500" /> Higher case</span>
                  <span className="flex items-center gap-2"><span className="w-8 border-t-2 border-dashed border-rose-400" /> Lower case</span>
                  {!analytics.hasReliableForecastHistory && (
                    <span className="rounded-full border border-yellow-400/25 bg-yellow-400/10 px-3 py-1 text-yellow-200">
                      Limited history
                    </span>
                  )}
                </div>
              </div>

              <div className="grid gap-3">
                <div className="rounded-2xl border border-yellow-400/20 bg-yellow-400/10 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-yellow-300">Projected Revenue</p>
                  <p className="mt-2 text-3xl font-bold text-white">{money(analytics.forecastTotalRevenue)}</p>
                  <p className="mt-1 text-xs text-white/55">Next {analytics.forecastPeriodCount} {analytics.salesForecastPeriodLabel.toLowerCase()} periods</p>
                </div>
                <div className="rounded-2xl border border-[#2b2b36] bg-white/[0.03] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Projected Units</p>
                  <p className="mt-2 text-2xl font-bold text-white">{analytics.forecastTotalUnits.toLocaleString("en-PH")}</p>
                  <p className="mt-1 text-xs text-emerald-300">Estimated items to prepare</p>
                </div>
                <div className="rounded-2xl border border-[#2b2b36] bg-white/[0.03] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/45">Confidence</p>
                  <p className="mt-2 text-2xl font-bold text-white">{analytics.forecastConfidence}%</p>
                  <p className="mt-1 text-xs text-white/55">{analytics.forecastNote}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>}

      {showPromotion && <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <MetricCard
            title="Active Promotions"
            value={String(analytics.activePromotionCount)}
            note="Campaigns currently running"
            icon={Sparkles}
          />
          <MetricCard
            title="Promotion Revenue"
            value={shortMoney(analytics.promoRevenue)}
            note="Sales value linked to promotion windows"
            icon={TrendingUp}
          />
          <MetricCard
            title="Promotion Units"
            value={analytics.promoUnits.toLocaleString("en-PH")}
            note="Items sold under promotion periods"
            icon={Package}
          />
        </div>

        <Card className="bg-[#16161d] border-[#2b2b36]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-white">
              <Sparkles className="h-5 w-5 text-yellow-400" />
              Promotion Performance
            </CardTitle>
            <p className="text-sm text-white/55">Top campaigns ranked by estimated revenue contribution.</p>
          </CardHeader>
          <CardContent>
            <div className="mb-5 rounded-2xl border border-[#2b2b36] bg-[#111118] p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">Active Promotions Comparison</p>
                  <p className="text-xs text-white/55">Revenue and units per campaign</p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 text-white/75">
                    <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
                    Revenue
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-white/75">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    Units
                  </span>
                </div>
              </div>
              {analytics.activePromotionChart.length && hasActivePromotionPerformance ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={analytics.activePromotionChart} margin={{ top: 8, right: 8, left: 8, bottom: 8 }} barGap={8}>
                    <CartesianGrid strokeDasharray="2 4" stroke="#2f2f38" />
                    <XAxis dataKey="name" stroke="#a3a3a3" fontSize={12} interval={0} angle={0} textAnchor="middle" height={42} />
                    <YAxis yAxisId="left" stroke="#a3a3a3" fontSize={12} />
                    <YAxis yAxisId="right" orientation="right" stroke="#a3a3a3" fontSize={12} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#16161C", border: "1px solid rgba(255, 255, 255, 0.15)", borderRadius: "12px", boxShadow: "0 8px 24px rgba(0,0,0,0.6)", padding: "10px 14px", color: "#FFFFFF" }}
                      labelStyle={{ color: "#FFFFFF", fontWeight: 600, fontSize: 13, marginBottom: 4 }}
                      itemStyle={{ color: "#FFFFFF", fontSize: 12, fontWeight: 500 }}
                      formatter={(value: any, name: string) => [
                        name === "revenue" ? money(Number(value)) : `${value} units`,
                        name === "revenue" ? "Revenue" : "Units",
                      ]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? "Promotion"}
                    />
                    <Bar yAxisId="left" dataKey="revenue" fill="#facc15" radius={[6, 6, 0, 0]} name="revenue" barSize={22} />
                    <Bar yAxisId="right" dataKey="units" fill="#22c55e" radius={[6, 6, 0, 0]} name="units" barSize={22} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="rounded-xl border border-dashed border-[#2b2b36] bg-white/[0.02] p-5 text-center text-sm text-white/60">
                  {analytics.activePromotionChart.length
                    ? "Active promotions are detected, but no sales performance has been recorded yet."
                    : "No active promotions yet. Activate a campaign to view comparison graph."}
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-2xl border border-[#2b2b36]">
              <Table>
                <TableHeader className="bg-[#1f1f28]">
                  <TableRow className="border-[#2b2b36] hover:bg-[#1f1f28]">
                    <TableHead className="text-center text-white">Promotion</TableHead>
                    <TableHead className="text-center text-white">Date Range</TableHead>
                    <TableHead className="text-center text-white">Status</TableHead>
                    <TableHead className="text-center text-white">Units</TableHead>
                    <TableHead className="text-center text-white">Revenue</TableHead>
                    <TableHead className="text-center text-white">Contribution</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {analytics.promotionPerformance.length ? analytics.promotionPerformance.slice(0, 10).map((promo) => (
                    <TableRow key={promo.id} className="border-[#2b2b36] hover:bg-white/[0.03]">
                      <TableCell className="text-center font-semibold text-white">{promo.name}</TableCell>
                      <TableCell className="text-center text-white/80">{promo.start} - {promo.end}</TableCell>
                      <TableCell className="text-center">
                        <Badge className={promo.status.toLowerCase() === "active" ? "bg-green-600 text-white" : "bg-white/10 text-white/80"}>
                          {promo.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center text-yellow-300">{promo.units}</TableCell>
                      <TableCell className="text-center text-white">{money(promo.revenue)}</TableCell>
                      <TableCell className="text-center text-emerald-300">{promo.contribution}%</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow className="border-[#2b2b36]">
                      <TableCell colSpan={6} className="py-8 text-center text-white/60">
                        No promotion data yet. Create promotions to see campaign performance here.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>}

      {showProduct && <Card className="bg-[#16161d] border-[#2b2b36]">
        <CardHeader>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-white">
                <Package className="h-5 w-5 text-yellow-400" />
                Product Analytics
              </CardTitle>
              <p className="mt-1 text-sm text-white/55">Fast movers, slow movers, dead stock, stock condition, and turnover per item.</p>
              {snapshotRefreshNote ? (
                <p
                  className={`mt-2 text-xs inline-flex items-center gap-1.5 font-medium transition-all ${
                    snapshotRefreshNote.toLowerCase().includes("invalid") ||
                    snapshotRefreshNote.toLowerCase().includes("require")
                      ? "text-red-400"
                      : "text-emerald-400"
                  }`}
                >
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-current" />
                  {snapshotRefreshNote}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleRefreshProductAnalytics}
                disabled={
                  isRefreshingSnapshots
                  || (
                    productAnalyticsPeriod === "custom"
                    && (
                      !customStartDate
                      || !customEndDate
                      || customStartDate > customEndDate
                    )
                  )
                }
                className="inline-flex items-center gap-2 rounded-xl border border-[#2b2b36] bg-white/[0.03] px-3 py-2 text-xs font-semibold text-white/80 transition hover:border-yellow-400/50 hover:text-yellow-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshingSnapshots ? "animate-spin" : ""}`} />
                {isRefreshingSnapshots ? "Refreshing..." : "Refresh Analytics"}
              </button>
              {revenueTrendOptions.map((option) => {
                const active = productAnalyticsPeriod === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setProductAnalyticsPeriod(option.id)}
                    className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                      active
                        ? "bg-yellow-400 text-red-950"
                        : "border border-[#2b2b36] bg-white/[0.03] text-white/70 hover:border-yellow-400/50 hover:text-yellow-200"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setProductAnalyticsPeriod("custom")}
                className={`rounded-xl px-3 py-2 text-xs font-semibold transition ${
                  productAnalyticsPeriod === "custom"
                    ? "bg-yellow-400 text-red-950"
                    : "border border-[#2b2b36] bg-white/[0.03] text-white/70 hover:border-yellow-400/50 hover:text-yellow-200"
                }`}
              >
                Custom Range
              </button>
            </div>
          </div>
          {productAnalyticsPeriod === "custom" ? (
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="date"
                value={customStartDate}
                onChange={(event) => setCustomStartDate(event.target.value)}
                className="rounded-xl border border-[#2b2b36] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-yellow-400/50"
              />
              <input
                type="date"
                value={customEndDate}
                onChange={(event) => setCustomEndDate(event.target.value)}
                className="rounded-xl border border-[#2b2b36] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none focus:border-yellow-400/50"
              />
              {customStartDate && customEndDate && customStartDate > customEndDate ? (
                <p className="sm:col-span-2 text-xs text-red-300">
                  End date must be on or after start date.
                </p>
              ) : null}
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-4">
            {/* Inventory Reconciliation & Quality Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="rounded-xl border border-[#2b2b36] bg-[#111118] p-3">
                <span className="text-xs text-white/50 block font-medium">Available Sellable Stock</span>
                <span className="text-lg font-bold text-emerald-400 block mt-0.5">{totalAvailableStock} pairs</span>
                <span className="text-[11px] text-white/40 block">Excludes {totalReservedStock} held units</span>
              </div>
              <div className="rounded-xl border border-[#2b2b36] bg-[#111118] p-3">
                <span className="text-xs text-white/50 block font-medium">Customer Units Sold</span>
                <span className="text-lg font-bold text-yellow-300 block mt-0.5">{analytics.totalUnits90} pairs</span>
                <span className="text-[11px] text-white/40 block">Actual customer purchases</span>
              </div>
              <div className="rounded-xl border border-[#2b2b36] bg-[#111118] p-3">
                <span className="text-xs text-white/50 block font-medium">Defective Replacements</span>
                <span className="text-lg font-bold text-amber-400 block mt-0.5">{totalReplacementsCount} pair{totalReplacementsCount === 1 ? "" : "s"}</span>
                <span className="text-[11px] text-amber-400/80 block">Quarantined / Not restocked</span>
              </div>
              <div className="rounded-xl border border-[#2b2b36] bg-[#111118] p-3">
                <span className="text-xs text-white/50 block font-medium">Defective Stock Loss</span>
                <span className="text-lg font-bold text-red-400 block mt-0.5">{money(totalDefectiveLoss)}</span>
                <span className="text-[11px] text-white/40 block">Wholesale cost write-off</span>
              </div>
            </div>

            <div className="rounded-2xl border border-[#2b2b36] bg-[#111118] p-4">
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-white">Size Curve Bubble Heatmap</p>
                  <p className="mt-1 text-xs text-white/50">Rows are product styles, columns are sizes. Color shows sales velocity; bubble size shows available stock depth.</p>
                </div>
                <Badge className="bg-yellow-400 text-red-950">{sizeCurveRows.length} styles</Badge>
              </div>
              {sizeCurveRows.length ? (
                <div className="overflow-x-auto rounded-xl border border-[#24242f] bg-[#15151d]">
                  <div
                    className="grid w-full min-w-max items-stretch"
                    style={{ gridTemplateColumns: `minmax(180px,1.35fr) repeat(${sizeCurveSizes.length}, minmax(76px,1fr)) minmax(84px,0.6fr) minmax(84px,0.6fr)` }}
                  >
                    <div className="sticky left-0 z-10 border-b border-r border-[#2b2b36] bg-[#1b1b26] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-white/55">
                      Style
                    </div>
                    {sizeCurveSizes.map((size) => (
                      <div key={size} className="border-b border-r border-[#2b2b36] bg-[#1b1b26] px-2 py-2 text-center text-xs font-semibold text-yellow-300">
                        {size}
                      </div>
                    ))}
                    <div className="border-b border-r border-[#2b2b36] bg-[#1b1b26] px-2 py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-white/55">
                      Sold
                    </div>
                    <div className="border-b border-[#2b2b36] bg-[#1b1b26] px-2 py-2 text-center text-xs font-semibold uppercase tracking-[0.08em] text-white/55">
                      Available
                    </div>

                    {sizeCurveRows.map((row) => (
                      <div key={row.key} className="contents">
                        <div className="sticky left-0 z-10 border-b border-r border-[#2b2b36] bg-[#15151d] px-3 py-3">
                          <p className="truncate text-sm font-semibold text-white" title={row.productName}>{row.productName}</p>
                          <p className="truncate text-xs text-white/45">{row.brand} - {row.category}</p>
                        </div>
                        {sizeCurveSizes.map((size) => {
                          const product = row.sizes.get(size);
                          const sold = Number(product?.unitsPeriod ?? 0);
                          const stock = Number(product?.stock ?? 0);
                          const defectInfo = product ? defectiveReplacementsByProduct.get(product.id) : null;
                          const defectCount = defectInfo?.count ?? 0;
                          const diameter = product ? Math.max(12, Math.min(36, 10 + (stock / maxSizeCurveStock) * 26)) : 0;
                          const backgroundColor = salesVelocityColor(sold, maxSizeCurveSold);
                          return (
                            <div
                              key={`${row.key}-${size}`}
                              className="flex min-h-[68px] items-center justify-center border-b border-r border-[#2b2b36] px-2 py-2"
                              title={
                                product
                                  ? `${row.productName} / Size ${size}: ${sold} sold, ${stock} available${defectCount > 0 ? ` (${defectCount} defective replaced)` : ""}`
                                  : `${row.productName} / Size ${size}: no variant`
                              }
                            >
                              {product ? (
                                <div className="flex flex-col items-center gap-0.5">
                                  <span
                                    className="inline-flex items-center justify-center rounded-full border border-white/25 text-[10px] font-bold text-white shadow-sm"
                                    style={{ width: `${diameter}px`, height: `${diameter}px`, backgroundColor }}
                                  >
                                    {stock}
                                  </span>
                                  <span className="text-[10px] font-semibold text-white/60">{sold} sold</span>
                                  {defectCount > 0 ? (
                                    <span className="text-[9px] font-semibold text-amber-400">({defectCount} replaced)</span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="text-xs text-white/20">-</span>
                              )}
                            </div>
                          );
                        })}
                        <div className="flex items-center justify-center border-b border-r border-[#2b2b36] px-2 py-3 text-sm font-semibold text-yellow-300">
                          {row.totalSold}
                        </div>
                        <div className="flex items-center justify-center border-b border-[#2b2b36] px-2 py-3 text-sm font-semibold text-white">
                          {row.totalStock}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex h-[220px] items-center justify-center rounded-xl border border-dashed border-[#2b2b36] text-sm text-white/50">
                  No size-curve data yet.
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[#2b2b36] bg-[#111118] p-4">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                <div>
                  <p className="font-semibold text-white">How to Read</p>
                  <p className="mt-1 text-xs text-white/50">Use it like a retail size-curve report.</p>
                </div>
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3">
                  <p className="font-semibold text-emerald-200">Bright color + small bubble</p>
                  <p className="mt-1 text-xs text-white/60">Popular size is selling, but stock is low. Reorder first.</p>
                </div>
                <div className="rounded-xl border border-orange-500/25 bg-orange-500/10 p-3">
                  <p className="font-semibold text-orange-200">Light/gray color + large bubble</p>
                  <p className="mt-1 text-xs text-white/60">Stock is deep but sales are weak. Consider markdown or promo.</p>
                </div>
                <div className="rounded-xl border border-yellow-400/25 bg-yellow-400/10 p-3">
                  <p className="font-semibold text-yellow-200">Number inside bubble</p>
                  <p className="mt-1 text-xs text-white/60">Current stock for that size. Text below is units sold.</p>
                </div>
              </div>
            </div>
          </div>

          {/* SEARCH & FILTER CONTROLS */}
          <div className="space-y-3 rounded-2xl border border-[#2b2b36] bg-[#111118] p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="font-semibold text-white">Product Movement & Health Matrix</p>
                <p className="text-xs text-white/50">Detailed inventory status, turnover, and velocity per product variant.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border border-[#2b2b36] bg-[#181820] px-3 py-1 font-medium text-white/80">
                  Total: <strong className="text-yellow-400">{analytics.productMovement.length}</strong> items
                </span>
                {isFilteringProducts && (
                  <span className="rounded-full border border-yellow-400/30 bg-yellow-400/10 px-3 py-1 font-medium text-yellow-300">
                    Filtered: <strong>{filteredProductMovement.length}</strong> items
                  </span>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
              {/* 1. Search Bar */}
              <div className="relative xl:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-yellow-400" />
                <input
                  type="text"
                  placeholder="Search product name, brand, SKU..."
                  value={productSearchTerm}
                  onChange={(e) => {
                    setProductSearchTerm(e.target.value);
                    setProductCurrentPage(1);
                  }}
                  className="h-9 w-full rounded-xl border border-[#2b2b36] bg-[#181820] pl-9 pr-8 text-xs text-white placeholder:text-white/40 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400/40"
                />
                {productSearchTerm && (
                  <button
                    type="button"
                    onClick={() => {
                      setProductSearchTerm("");
                      setProductCurrentPage(1);
                    }}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* 2. Category Filter */}
              <div className="relative">
                <select
                  value={productCategoryFilter}
                  onChange={(e) => {
                    setProductCategoryFilter(e.target.value);
                    setProductCurrentPage(1);
                  }}
                  className="h-9 w-full appearance-none rounded-xl border border-[#2b2b36] bg-[#181820] px-3 pr-8 text-xs font-medium text-white/90 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400/40"
                >
                  <option value="all">All Categories</option>
                  {availableCategories.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-white/60">⌄</span>
              </div>

              {/* 3. Department (Gender) Filter */}
              <div className="relative">
                <select
                  value={productDepartmentFilter}
                  onChange={(e) => {
                    setProductDepartmentFilter(e.target.value);
                    setProductCurrentPage(1);
                  }}
                  className="h-9 w-full appearance-none rounded-xl border border-[#2b2b36] bg-[#181820] px-3 pr-8 text-xs font-medium text-white/90 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400/40"
                >
                  <option value="all">All Departments</option>
                  {availableDepartments.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-white/60">⌄</span>
              </div>

              {/* 4. Movement Status Filter */}
              <div className="relative">
                <select
                  value={productMovementFilter}
                  onChange={(e) => {
                    setProductMovementFilter(e.target.value);
                    setProductCurrentPage(1);
                  }}
                  className="h-9 w-full appearance-none rounded-xl border border-[#2b2b36] bg-[#181820] px-3 pr-8 text-xs font-medium text-white/90 focus:border-yellow-400 focus:outline-none focus:ring-1 focus:ring-yellow-400/40"
                >
                  <option value="all">All Movements</option>
                  <option value="Fast">Fast Movers</option>
                  <option value="Steady">Steady Movers</option>
                  <option value="Slow">Slow Movers</option>
                  <option value="Dead Stock">Dead Stock</option>
                </select>
                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-white/60">⌄</span>
              </div>
            </div>

            {/* Active filter pills / clear all if active */}
            {isFilteringProducts && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[11px] text-white/45">Active Filters:</span>
                {productSearchTerm && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-yellow-400/10 px-2 py-0.5 text-[11px] text-yellow-300">
                    Search: "{productSearchTerm}"
                    <button type="button" onClick={() => { setProductSearchTerm(""); setProductCurrentPage(1); }} className="hover:text-white">×</button>
                  </span>
                )}
                {productCategoryFilter !== "all" && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-yellow-400/10 px-2 py-0.5 text-[11px] text-yellow-300">
                    Category: {productCategoryFilter}
                    <button type="button" onClick={() => { setProductCategoryFilter("all"); setProductCurrentPage(1); }} className="hover:text-white">×</button>
                  </span>
                )}
                {productDepartmentFilter !== "all" && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-yellow-400/10 px-2 py-0.5 text-[11px] text-yellow-300">
                    Department: {productDepartmentFilter}
                    <button type="button" onClick={() => { setProductDepartmentFilter("all"); setProductCurrentPage(1); }} className="hover:text-white">×</button>
                  </span>
                )}
                {productMovementFilter !== "all" && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-yellow-400/10 px-2 py-0.5 text-[11px] text-yellow-300">
                    Movement: {productMovementFilter}
                    <button type="button" onClick={() => { setProductMovementFilter("all"); setProductCurrentPage(1); }} className="hover:text-white">×</button>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setProductSearchTerm("");
                    setProductCategoryFilter("all");
                    setProductDepartmentFilter("all");
                    setProductMovementFilter("all");
                    setProductCurrentPage(1);
                  }}
                  className="ml-1 text-[11px] font-medium text-red-400 underline hover:text-red-300"
                >
                  Clear all
                </button>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-2xl border border-[#2b2b36]">
            <Table>
              <TableHeader className="bg-[#1f1f28]">
                <TableRow className="border-[#2b2b36] hover:bg-[#1f1f28]">
                  <TableHead className="text-center text-white">Product</TableHead>
                  <TableHead className="text-center text-white">Brand</TableHead>
                  <TableHead className="text-center text-white">Category</TableHead>
                  <TableHead className="text-center text-white">Department</TableHead>
                  <TableHead className="text-center text-white">Size</TableHead>
                  <TableHead className="text-center text-white">Sold ({analytics.productPeriodLabel})</TableHead>
                  <TableHead className="text-center text-white">Stock</TableHead>
                  <TableHead className="text-center text-white">Turnover</TableHead>
                  <TableHead className="text-center text-white">Movement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedProductMovement.length > 0 ? (
                  paginatedProductMovement.map((product) => (
                    <TableRow key={product.id} className="border-[#2b2b36] hover:bg-white/[0.03]">
                      <TableCell className="text-center font-semibold text-white">{product.name}</TableCell>
                      <TableCell className="text-center text-white/80">{product.brand}</TableCell>
                      <TableCell className="text-center text-white/80">{product.category}</TableCell>
                      <TableCell className="text-center text-white/80">{product.gender || "Unisex"}</TableCell>
                      <TableCell className="text-center text-white/80">{product.size}</TableCell>
                      <TableCell className="text-center text-yellow-300 font-semibold">{product.unitsPeriod}</TableCell>
                      <TableCell className="text-center">
                        <Badge className={stockBadgeClass(product.stock, product.reorder)}>{product.stock} units</Badge>
                      </TableCell>
                      <TableCell className="text-center text-white/80">{product.turnover.toFixed(2)}x</TableCell>
                      <TableCell className="text-center">
                        <Badge className={movementBadgeClass(product.movement)}>{product.movement}</Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-white/50">
                      <Package className="mx-auto mb-2 h-7 w-7 text-white/20" />
                      <p className="font-semibold text-white/70">No products found</p>
                      <p className="mt-1 text-xs text-white/40">Try adjusting your search query or clearing the active filters.</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* PAGINATION BAR */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border border-[#2b2b36] bg-[#111118] px-4 py-3">
            {/* Left: Rows Per Page selector & Count indicator */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white/50">Show:</span>
                <select
                  value={productPageSize}
                  onChange={(e) => {
                    setProductPageSize(Number(e.target.value));
                    setProductCurrentPage(1);
                  }}
                  className="h-8 rounded-lg border border-[#2b2b36] bg-[#181820] px-2 text-xs font-semibold text-white outline-none focus:border-yellow-400"
                >
                  <option value={10}>10 products</option>
                  <option value={15}>15 products</option>
                  <option value={20}>20 products</option>
                  <option value={25}>25 products</option>
                  <option value={30}>30 products</option>
                </select>
              </div>
              <span className="text-xs text-white/50">
                Showing{" "}
                <strong className="text-white">
                  {filteredProductMovement.length > 0 ? (currentProductPage - 1) * productPageSize + 1 : 0}
                </strong>{" "}
                to{" "}
                <strong className="text-white">
                  {Math.min(currentProductPage * productPageSize, filteredProductMovement.length)}
                </strong>{" "}
                of <strong className="text-yellow-400">{filteredProductMovement.length}</strong> products
              </span>
            </div>

            {/* Right: Page Navigation */}
            <div className="flex items-center gap-1.5 self-end sm:self-auto">
              <button
                type="button"
                onClick={() => setProductCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={currentProductPage <= 1}
                className="flex h-8 items-center gap-1 rounded-lg border border-[#2b2b36] bg-white/[0.03] px-2.5 text-xs font-semibold text-white/70 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                <span>Prev</span>
              </button>

              <div className="flex items-center gap-1">
                {Array.from({ length: totalProductPages }, (_, i) => i + 1)
                  .filter((page) => {
                    if (totalProductPages <= 5) return true;
                    if (page === 1 || page === totalProductPages) return true;
                    return Math.abs(page - currentProductPage) <= 1;
                  })
                  .map((page, idx, arr) => {
                    const prev = arr[idx - 1];
                    const hasGap = prev && page - prev > 1;
                    return (
                      <div key={page} className="flex items-center">
                        {hasGap && <span className="px-1 text-xs text-white/30">...</span>}
                        <button
                          type="button"
                          onClick={() => setProductCurrentPage(page)}
                          className={`h-8 min-w-[32px] rounded-lg px-2 text-xs font-semibold transition ${
                            currentProductPage === page
                              ? "bg-yellow-400 text-red-950 font-bold"
                              : "border border-[#2b2b36] bg-white/[0.03] text-white/70 hover:bg-white/[0.08] hover:text-white"
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
                onClick={() => setProductCurrentPage((prev) => Math.min(totalProductPages, prev + 1))}
                disabled={currentProductPage >= totalProductPages}
                className="flex h-8 items-center gap-1 rounded-lg border border-[#2b2b36] bg-white/[0.03] px-2.5 text-xs font-semibold text-white/70 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <span>Next</span>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </CardContent>
      </Card>}

      {showCustomer && (
      <div className="grid grid-cols-1 gap-5">
        <Card className="bg-[#16161d] border-[#2b2b36]">
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">Customer Analytics Period</p>
                <p className="text-xs text-white/50">Filter customer demand and sales by gender across time windows.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {customerPeriodOptions.map((option) => {
                  const active = customerAnalyticsPeriod === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setCustomerAnalyticsPeriod(option.id)}
                      className={`rounded-xl px-4 py-2 text-xs font-semibold transition ${
                        active
                          ? "bg-yellow-400 text-red-950"
                          : "border border-[#2b2b36] bg-white/[0.03] text-white/70 hover:border-yellow-400/50 hover:text-yellow-200"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#16161d] border-[#2b2b36]">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Users className="h-5 w-5 text-yellow-400" /> Gender Analytics
                </CardTitle>
                <p className="mt-2 text-sm text-white/55">
                  Demand and purchase volume grouped by customer demographic ({analytics.customerPeriodLabel}).
                </p>
              </div>
              <Badge className="bg-yellow-400 text-red-950">{analytics.genderRows.length} groups</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {analytics.topBuyingGender && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#2b2b36] bg-[#111118] p-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#2f2f3e] bg-[#22222e] text-yellow-400">
                    <Award className="h-5 w-5 text-yellow-400" />
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-yellow-400">
                      Top Buying Customer Demographic
                    </p>
                    <p className="text-lg font-bold text-white">
                      {analytics.topBuyingGender.label} Customers Buy The Most
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-6 text-xs">
                  <div className="text-right">
                    <p className="text-white/60">Units Bought</p>
                    <p className="font-bold text-yellow-300 text-sm">{analytics.topBuyingGender.units} pairs</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white/60">Total Revenue</p>
                    <p className="font-bold text-yellow-300 text-sm">{money(analytics.topBuyingGender.revenue)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white/60">Top Brand</p>
                    <p className="font-bold text-white text-sm">{analytics.topBuyingGender.topBrand}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-white/60">Top Product</p>
                    <p className="font-bold text-white text-sm max-w-[150px] truncate">{analytics.topBuyingGender.topProduct}</p>
                  </div>
                </div>
              </div>
            )}

            {analytics.genderRows.length ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-[#2b2b36] bg-[#111118] p-4">
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={analytics.genderChart}>
                        <CartesianGrid stroke="#2b2b36" vertical={false} />
                        <XAxis dataKey="name" stroke="#a1a1aa" tick={{ fill: "#d4d4d8", fontSize: 12 }} />
                        <YAxis stroke="#a1a1aa" tick={{ fill: "#d4d4d8", fontSize: 12 }} />
                        <Tooltip
                          contentStyle={{ background: "#16161C", border: "1px solid rgba(255, 255, 255, 0.15)", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.6)", padding: "10px 14px", color: "#FFFFFF" }}
                          labelStyle={{ color: "#FFFFFF", fontWeight: 600, fontSize: 13, marginBottom: 4 }}
                          itemStyle={{ color: "#FFFFFF", fontSize: 12, fontWeight: 500 }}
                          formatter={(value: any, _name: string, item: any) => [
                            `${money(Number(value))} (${item?.payload?.units ?? 0} units)`,
                            "Revenue",
                          ]}
                        />
                        <Bar dataKey="revenue" radius={[8, 8, 0, 0]}>
                          {analytics.genderChart.map((row: any) => (
                            <Cell key={row.fullLabel} fill={row.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-[#2b2b36] bg-[#111118]">
                  <div className="overflow-x-auto">
                  <Table className="table-fixed w-full min-w-[980px]">
                    <colgroup>
                      <col className="w-[14%]" />
                      <col className="w-[12%]" />
                      <col className="w-[10%]" />
                      <col className="w-[18%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="w-[12%]" />
                      <col className="w-[14%]" />
                    </colgroup>
                    <TableHeader className="bg-[#1f1f28]">
                      <TableRow className="border-[#2b2b36] hover:bg-[#1f1f28]">
                        <TableHead className="py-3 text-center text-sm font-semibold text-white">Gender</TableHead>
                        <TableHead className="py-3 text-center text-sm font-semibold text-white">Top Brand</TableHead>
                        <TableHead className="py-3 text-center text-sm font-semibold text-white">Top Size</TableHead>
                        <TableHead className="py-3 text-center text-sm font-semibold text-white">Top Product</TableHead>
                        <TableHead className="py-3 text-center text-sm font-semibold text-white">Customers</TableHead>
                        <TableHead className="py-3 text-center text-sm font-semibold text-white">Orders</TableHead>
                        <TableHead className="py-3 text-center text-sm font-semibold text-white">Units Sold</TableHead>
                        <TableHead className="py-3 text-center text-sm font-semibold text-white">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analytics.genderRows.map((row: any, idx: number) => (
                        <TableRow key={row.label} className="border-[#2b2b36] hover:bg-white/[0.03]">
                          <TableCell className="py-3 text-center align-middle font-semibold text-white">
                            <div className="flex items-center justify-center gap-1.5">
                              {idx === 0 && <span className="rounded border border-yellow-400/40 bg-yellow-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-yellow-300">Top</span>}
                              <span>{row.label}</span>
                            </div>
                          </TableCell>
                          <TableCell className="py-3 text-center align-middle text-white/80">{row.topBrand}</TableCell>
                          <TableCell className="py-3 text-center align-middle text-white/80">{row.topSize}</TableCell>
                          <TableCell className="py-3 text-center align-middle truncate text-white/80">{row.topProduct}</TableCell>
                          <TableCell className="py-3 text-center align-middle text-white">{row.customers}</TableCell>
                          <TableCell className="py-3 text-center align-middle text-white">{row.orders}</TableCell>
                          <TableCell className="py-3 text-center align-middle font-semibold text-yellow-300">{row.units}</TableCell>
                          <TableCell className="py-3 text-center align-middle font-semibold text-yellow-300">{money(row.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#2b2b36] bg-[#111118] p-6 text-center">
                <p className="font-semibold text-white/70">No gender analytics yet</p>
                <p className="mt-1 text-sm text-white/45">Add gender values to customer profiles to unlock this view.</p>
                <p className="mt-1 text-sm text-white/45">Record sales or adjust the period filter to view customer demographic demand.</p>
              </div>
            )} 
          </CardContent>
        </Card>
      </div>
      )}

      {showProduct && <Card className="bg-[#16161d] border-[#2b2b36]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-white">
            <Sparkles className="h-5 w-5 text-yellow-400" /> Targeted Marketing Recommendations
          </CardTitle>
          <p className="text-sm text-white/55">Suggested actions from slow movers, stock risk, and customer demand.</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {analytics.promotionSuggestions.length ? analytics.promotionSuggestions.map((suggestion, index) => (
              <div key={`${suggestion.title}-${index}`} className="rounded-2xl border border-yellow-400/20 bg-yellow-400/10 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold text-white">{suggestion.title}</p>
                    <p className="mt-1 text-sm text-yellow-200">{suggestion.target}</p>
                  </div>
                  <Badge className="bg-yellow-400 text-red-950">{suggestion.action}</Badge>
                </div>
                <p className="mt-3 text-sm text-white/65">{suggestion.reason}</p>
              </div>
            )) : (
              <div className="rounded-2xl border border-[#2b2b36] bg-white/[0.03] p-4 text-sm text-white/60">
                No promotion recommendation yet. Once sales and inventory movement grow, this section will suggest markdowns, bundles, or restock-first actions.
              </div>
            )}
          </div>
        </CardContent>
      </Card>}
    </div>
  );
}

export default PredictiveAnalytics;
