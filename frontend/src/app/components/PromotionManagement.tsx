import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Badge } from './ui/badge';
import { Progress } from './ui/progress';
import { TablePagination } from './ui/table-pagination';
import { Tag, Plus, Edit, Trash2, TrendingUp, Coins, ShoppingCart, Percent, Mail, CheckCircle, X, Check, ToggleLeft, ToggleRight, Power, Copy, RotateCcw, Calendar, Search, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { useCustomers, useProducts, usePromotions, usePromotionsMutations, useSales } from '../../lib/hooks';
import { BACKEND_BASE, getBackendAuthHeaders, useAuth } from '../../lib/auth-context';
import { writeAuditLog } from '../../lib/audit';
import { supabase } from '../../lib/supabase';
import { buildAudience } from '../../lib/promotion-audience';
import { PromotionNotifyDialog } from './PromotionNotifyDialog';

type Promotion = {
  promo_id: string;
  promo_name: string;
  discount_type: 'Percentage' | 'Fixed Amount' | 'BOGO' | 'Bundle';
  discount_value: number;
  targetProducts: string;
  start_date: string;
  end_date: string;
  status: 'Active' | 'Upcoming' | 'Ended' | 'Inactive';
  salesGenerated: number;
  unitsAffected: number;
  effectiveness: number;
  targetSalesGoal: number;
  targetProductIds: string[];
};

type Notification = {
  notification_id: string;
  customer_id: string;
  promo_id: string;
  email: string;
  email_status: 'sent' | 'pending' | 'failed' | 'Sent' | 'Pending' | 'Failed';
  date_sent: string;
  send_error?: string;
};

type Customer = {
  customer_id: string;
  name: string;
  email: string;
  status: 'Active' | 'Inactive';
};

type PromotionRecommendation = {
  id: string;
  title: string;
  rationale: string;
  discount_type: Promotion['discount_type'];
  discount_value: number;
  targetProducts: string;
};

type PromotionMarginProduct = {
  id: string;
  name: string;
  category: string;
  srp: number;
  unitCost: number;
  stock: number;
  reorderLevel: number;
  sold30: number;
  isSlowMover: boolean;
};


const PROMO_TYPE_MARKERS = {
  bundle: "__TYPE_BUNDLE__",
  bogo: "__TYPE_BOGO__",
} as const;

function stripPromoTypeMarker(name: string | undefined) {
  const value = String(name ?? "");
  return value
    .replace(PROMO_TYPE_MARKERS.bundle, "")
    .replace(PROMO_TYPE_MARKERS.bogo, "")
    .trim();
}

function encodePromoNameWithType(name: string | undefined, type: Promotion["discount_type"] | string | undefined) {
  const cleanName = stripPromoTypeMarker(name);
  const normalizedType = String(type ?? "").toLowerCase();
  if (normalizedType.includes("bundle")) return `${cleanName} ${PROMO_TYPE_MARKERS.bundle}`.trim();
  if (normalizedType.includes("bogo") || normalizedType.includes("buy one get one")) {
    return `${cleanName} ${PROMO_TYPE_MARKERS.bogo}`.trim();
  }
  return cleanName;
}

function decodeDisplayType(rawType: string, rawName: string | undefined): Promotion["discount_type"] {
  const loweredName = String(rawName ?? "").toLowerCase();
  if (loweredName.includes(PROMO_TYPE_MARKERS.bundle.toLowerCase())) return "Bundle";
  if (loweredName.includes(PROMO_TYPE_MARKERS.bogo.toLowerCase())) return "BOGO";
  if (rawType.includes("fixed")) return "Fixed Amount";
  return "Percentage";
}

function toDbDiscountType(value: Promotion['discount_type'] | string | undefined) {
  const normalized = String(value ?? '').toLowerCase();
  if (normalized.includes('bundle')) return 'fixed';
  if (normalized.includes('fixed')) return 'fixed';
  if (normalized.includes('bogo')) return 'percentage';
  return 'percentage';
}

function getPromotionStatusForWindow(startDate?: string, endDate?: string): Promotion['status'] {
  const now = Date.now();
  const startMs = promotionTimeMs(startDate, 'start');
  const endMs = promotionTimeMs(endDate, 'end');
  if (endMs < now) return 'Ended';
  if (startMs <= now && now <= endMs) return 'Active';
  return 'Upcoming';
}

function toDbStatusForWindow(startDate?: string, endDate?: string) {
  // "inactive" is reserved for promotions switched off by staff. Upcoming ones are
  // saved as enabled ("active") so they start by themselves when their window opens.
  return getPromotionStatusForWindow(startDate, endDate) === 'Ended' ? 'expired' : 'active';
}

function toLocalDateTimeInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function normalizePromotionDateTime(value: string | undefined, boundary: 'start' | 'end') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('T')) return raw.slice(0, 16);
  return `${raw.slice(0, 10)}T${boundary === 'start' ? '00:00' : '23:59'}`;
}

function promotionTimeMs(value: string | undefined, boundary: 'start' | 'end') {
  const normalized = normalizePromotionDateTime(value, boundary);
  if (!normalized) return boundary === 'start' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const time = new Date(normalized).getTime();
  if (Number.isNaN(time)) return boundary === 'start' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  return time;
}

function saleTimestampMs(value: string | undefined) {
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  const hasTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  return new Date(hasTimezone ? raw : `${raw}Z`).getTime();
}

function formatPromotionDateTime(value: string | undefined, boundary: 'start' | 'end') {
  const normalized = normalizePromotionDateTime(value, boundary);
  if (!normalized) return 'N/A';
  return normalized.replace('T', ' ');
}

function isMissingTargetProductsColumnError(error: any) {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return message.includes("target_products") && message.includes("column");
}

function todayDateInput() {
  return toLocalDateTimeInput();
}

function validatePromotionDates(startDate?: string, endDate?: string) {
  const now = Date.now();
  const start = normalizePromotionDateTime(startDate, 'start');
  const end = normalizePromotionDateTime(endDate, 'end');
  if (!start || !end) return 'Please choose both start and end dates.';
  if (promotionTimeMs(start, 'start') < now - 120000) return 'Start date/time cannot be in the past.';
  if (promotionTimeMs(end, 'end') < now) return 'End date/time cannot be in the past.';
  if (promotionTimeMs(end, 'end') < promotionTimeMs(start, 'start')) return 'End date/time cannot be earlier than the start date/time.';
  return '';
}

function formatTargetProducts(categories: string[], products: string[]) {
  const cats = categories.filter(Boolean);
  const prods = products.filter(Boolean);
  if (!cats.length && !prods.length) return 'All Products';
  if (!cats.length) return `Products: ${prods.join(', ')}`;
  if (!prods.length) return `Categories: ${cats.join(', ')}`;
  return `Categories: ${cats.join(', ')} | Products: ${prods.join(', ')}`;
}

function parseTargetProducts(text: string | undefined) {
  const raw = String(text ?? '').trim();
  if (!raw || raw.toLowerCase() === 'all products') {
    return { categories: [] as string[], products: [] as string[] };
  }

  const categories: string[] = [];
  const products: string[] = [];
  raw.split('|').forEach((segment) => {
    const value = segment.trim();
    if (!value) return;
    if (value.toLowerCase().startsWith('categories:')) {
      value
        .slice('categories:'.length)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .forEach((v) => categories.push(v));
      return;
    }
    if (value.toLowerCase().startsWith('products:')) {
      value
        .slice('products:'.length)
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
        .forEach((v) => products.push(v));
      return;
    }
    // Backward compatibility: handle old recommendation format like "Running Shoes Category".
    if (value.toLowerCase().endsWith(' category')) {
      categories.push(value.slice(0, -' category'.length).trim());
      return;
    }
    products.push(value);
  });

  return {
    categories: Array.from(new Set(categories)),
    products: Array.from(new Set(products)),
  };
}

function normalizeRecommendationTarget(value: string | undefined) {
  return String(value ?? 'All Products')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function recommendationSignature(type: string | undefined, target: string | undefined) {
  return `${String(type ?? '').toLowerCase()}::${normalizeRecommendationTarget(target)}`;
}

function rangesOverlap(startA?: string, endA?: string, startB?: string, endB?: string) {
  const aStart = promotionTimeMs(startA, 'start');
  const aEnd = promotionTimeMs(endA, 'end');
  const bStart = promotionTimeMs(startB, 'start');
  const bEnd = promotionTimeMs(endB, 'end');
  if (!Number.isFinite(aStart) || !Number.isFinite(aEnd) || !Number.isFinite(bStart) || !Number.isFinite(bEnd)) return false;
  return !(aEnd < bStart || bEnd < aStart);
}

function normalizeTargetSignature(target: string | undefined) {
  const parsed = parseTargetProducts(target);
  const categories = Array.from(new Set(parsed.categories.map((c) => c.trim().toLowerCase()))).sort();
  const products = Array.from(new Set(parsed.products.map((p) => p.trim().toLowerCase()))).sort();
  if (!categories.length && !products.length) return "all";
  return `c:${categories.join(",")}|p:${products.join(",")}`;
}

function getPromoPriority(discountType: string | undefined) {
  const type = String(discountType ?? "").toLowerCase();
  if (type.includes("bogo")) return 4;
  if (type.includes("bundle")) return 3;
  if (type.includes("fixed")) return 2;
  if (type.includes("percent")) return 1;
  return 0;
}

function estimatePromotionPrice(srp: number, discountType: string | undefined, discountValue: number) {
  const type = String(discountType ?? "").toLowerCase();
  const value = Number(discountValue || 0);
  if (srp <= 0) return 0;
  if (type.includes("percent") || type.includes("bogo")) {
    return Math.max(0, srp * (1 - value / 100));
  }
  if (type.includes("bundle")) {
    return Math.max(0, srp * (1 - bundlePercent(value) / 100));
  }
  if (type.includes("fixed")) {
    return Math.max(0, srp - value);
  }
  return srp;
}

/** Bundle discount percent as applied by the POS (values under 5 fall back to 10%). */
function bundlePercent(value: number) {
  return Math.max(0, Math.min(100, value >= 5 ? value : 10));
}

function maxSafePercentageDiscount(product: { srp: number; unitCost: number; isSlowMover?: boolean }, fallback = 5) {
  if (!product.srp || !product.unitCost || product.srp <= 0) return fallback;
  const minimumPrice = product.unitCost * (product.isSlowMover ? 1.03 : 1.1);
  const maxPercent = Math.floor(((product.srp - minimumPrice) / product.srp) * 100);
  return Math.max(1, Math.min(30, maxPercent));
}

function roundedSafePercentage(product: { srp: number; unitCost: number; isSlowMover?: boolean }, requested: number) {
  const safe = maxSafePercentageDiscount(product, Math.min(5, requested));
  return Math.max(1, Math.min(requested, Math.floor(safe / 5) * 5 || safe));
}

function resolvePromotionTargetProducts(targetProducts: string | undefined, products: PromotionMarginProduct[]) {
  const parsed = parseTargetProducts(targetProducts);
  const wantsAll = !parsed.categories.length && !parsed.products.length;
  const categories = new Set(parsed.categories.map((c) => c.trim().toLowerCase()));
  const names = new Set(parsed.products.map((p) => p.trim().toLowerCase()));

  return products.filter((product) => {
    const category = product.category.trim().toLowerCase();
    const name = product.name.trim().toLowerCase();
    if (wantsAll) return true;
    if (names.size > 0) {
      if (!names.has(name)) return false;
      return !categories.size || categories.has(category);
    }
    return categories.has(category);
  });
}

function saleIsCompleted(sale: any) {
  const payment = Array.isArray(sale?.payment) ? sale.payment[0] : sale?.payment;
  const status = String(payment?.payment_status ?? sale?.payment_status ?? '').toLowerCase();
  return status === 'completed' || status === 'paid' || !status;
}

function productDetailMatchesPromotion(detail: any, promotion: Promotion) {
  return productDetailPromotionSpecificity(detail, promotion) > 0;
}

function productDetailPromotionSpecificity(detail: any, promotion: Promotion) {
  const detailProductId = String(detail?.product_id ?? '').trim();
  if (detailProductId && promotion.targetProductIds.includes(detailProductId)) return 3;

  const product = Array.isArray(detail?.product) ? detail.product[0] : detail?.product;
  const productName = String(product?.product_name ?? '').trim().toLowerCase();
  const category = Array.isArray(product?.category) ? product.category[0] : product?.category;
  const categoryName = String(category?.category_name ?? '').trim().toLowerCase();
  const parsed = parseTargetProducts(promotion.targetProducts);
  const wantsAll = !parsed.categories.length && !parsed.products.length;
  const categories = new Set(parsed.categories.map((item) => item.trim().toLowerCase()));
  const products = new Set(parsed.products.map((item) => item.trim().toLowerCase()));

  if (wantsAll) return 1;
  if (products.size > 0) {
    if (!products.has(productName)) return 0;
    return !categories.size || categories.has(categoryName) ? 3 : 0;
  }
  return categories.has(categoryName) ? 2 : 0;
}

function sanitizeTargetProductsToSellable(
  targetProducts: string | undefined,
  categoryOptions: string[],
  productOptions: Array<{ name: string; category: string; stock: number }>,
) {
  const parsed = parseTargetProducts(targetProducts);
  const allowedCategories = new Set(categoryOptions.map((c) => c.trim().toLowerCase()));
  const productByName = new Map(
    productOptions.map((p) => [p.name.trim().toLowerCase(), { name: p.name, category: p.category }]),
  );

  const categories = parsed.categories.filter((c) => allowedCategories.has(c.trim().toLowerCase()));
  const normalizedCategorySet = new Set(categories.map((c) => c.trim().toLowerCase()));

  const products = parsed.products.filter((p) => {
    const row = productByName.get(p.trim().toLowerCase());
    if (!row) return false;
    if (!normalizedCategorySet.size) return true;
    return normalizedCategorySet.has(String(row.category || "").trim().toLowerCase());
  });

  return formatTargetProducts(
    Array.from(new Set(categories)),
    Array.from(new Set(products)),
  );
}

function deriveTargetProductsFromLinks(row: any) {
  const links = Array.isArray(row?.promo_product) ? row.promo_product : [];
  if (!links.length) return 'All Products';
  const categories = new Set<string>();
  const products = new Set<string>();
  links.forEach((link: any) => {
    const product = Array.isArray(link?.product) ? link.product[0] : link?.product;
    const productName = String(product?.product_name ?? '').trim();
    const categoryName = String(product?.category?.[0]?.category_name ?? product?.category?.category_name ?? '').trim();
    if (productName) products.add(productName);
    if (categoryName) categories.add(categoryName);
  });
  if (!products.size) return 'All Products';
  // Links point at individual products, so describe them as products. (Summarising
  // them as categories made the POS discount whole categories; truncating the list
  // with "+N more" broke matching.)
  return `Products: ${Array.from(products).join(', ')}`;
}

function normalizeRecommendationTitle(value: string | undefined) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function PromotionManagement() {
  const { user } = useAuth();
  const salesQuery = useSales();
  const productsQuery = useProducts();
  const promotionsQuery = usePromotions();
  const promotionsMutations = usePromotionsMutations();
  const customersQuery = useCustomers();
  const customers: Customer[] = ((customersQuery.data as any[]) ?? []).map((row: any) => ({
    customer_id: String(row.customer_id ?? ''),
    name: String(row.customer_name ?? row.name ?? 'Customer'),
    email: String(row.email ?? '').trim(),
    status: String(row.status ?? 'active').toLowerCase() === 'active' ? 'Active' : 'Inactive',
  }));
  const customerNameMap = new Map(customers.map((c) => [c.customer_id, c.name]));
  const productRows = (productsQuery.data as any[]) ?? [];
  const sellableProductRows = useMemo(
    () =>
      productRows.filter((p: any) => {
        const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
        const stock = Number(inv?.stock_quantity ?? 0);
        const invStatus = String(inv?.inventory_status ?? 'active').toLowerCase();
        const productStatus = String(p.status ?? 'active').toLowerCase();
        return stock > 0 && invStatus === 'active' && productStatus === 'active';
      }),
    [productRows],
  );
  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          sellableProductRows
            .map(
              (p: any) =>
                String(p.category?.[0]?.category_name ?? p.category?.category_name ?? '').trim(),
            )
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [sellableProductRows],
  );
  const productOptions = useMemo(
    () =>
      sellableProductRows
        .map((p: any) => {
          const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
          return {
            name: String(p.product_name ?? 'Unknown Product').trim(),
            category: String(p.category?.[0]?.category_name ?? p.category?.category_name ?? '').trim(),
            stock: Number(inv?.stock_quantity ?? 0),
          };
        })
        .filter((p: any) => p.name)
        .reduce((acc: Array<{ name: string; category: string; stock: number }>, current) => {
          const idx = acc.findIndex(
            (row) => row.name.toLowerCase() === current.name.toLowerCase() && row.category.toLowerCase() === current.category.toLowerCase(),
          );
          if (idx >= 0) acc[idx] = { ...acc[idx], stock: acc[idx].stock + current.stock };
          else acc.push(current);
          return acc;
        }, [])
        .sort((a: any, b: any) => a.name.localeCompare(b.name)),
    [sellableProductRows],
  );
  const promotionMarginProducts = useMemo<PromotionMarginProduct[]>(() => {
    const sales = (salesQuery.data as any[]) ?? [];
    const now = new Date();
    const last30 = new Date(now);
    last30.setDate(now.getDate() - 30);
    const soldByProduct = new Map<string, number>();

    sales.forEach((sale: any) => {
      const txDate = new Date(sale.transaction_date ?? sale.created_at ?? '');
      if (Number.isNaN(txDate.getTime()) || txDate < last30) return;
      const payment = Array.isArray(sale.payment) ? sale.payment[0] : sale.payment;
      const status = String(payment?.payment_status ?? '').toLowerCase();
      if (status !== 'completed' && status !== 'paid') return;
      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((detail: any) => {
        const productId = String(detail.product_id ?? '');
        if (!productId) return;
        soldByProduct.set(productId, (soldByProduct.get(productId) ?? 0) + Number(detail.quantity ?? 0));
      });
    });

    return sellableProductRows
      .map((p: any) => {
        const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
        const productId = String(p.product_id ?? '');
        const stock = Number(inv?.stock_quantity ?? 0);
        const reorderLevel = Number(p.reorder_level ?? inv?.reorder_level ?? 10);
        const sold30 = soldByProduct.get(productId) ?? 0;
        return {
          id: productId,
          name: String(p.product_name ?? 'Unknown Product').trim(),
          category: String(p.category?.[0]?.category_name ?? p.category?.category_name ?? '').trim(),
          srp: Number(inv?.srp ?? p.srp ?? p.selling_price ?? p.price ?? 0),
          unitCost: Number(p.cost_price ?? p.unit_price ?? p.base_price ?? 0),
          stock,
          reorderLevel,
          sold30,
          isSlowMover: stock >= reorderLevel * 2 && sold30 <= 2,
        };
      })
      .filter((p) => p.id && p.name && p.srp > 0 && p.unitCost > 0);
  }, [salesQuery.data, sellableProductRows]);

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingPromotion, setEditingPromotion] = useState<Promotion | null>(null);
  const [formData, setFormData] = useState<Partial<Promotion>>({
    promo_name: '',
    discount_type: 'Percentage',
    discount_value: 0,
    targetSalesGoal: 10000,
    targetProducts: '',
    start_date: '',
    end_date: '',
    status: 'Upcoming'
  });

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [hiddenRecommendationIds, setHiddenRecommendationIds] = useState<Set<string>>(new Set());
  const [pendingRecommendationId, setPendingRecommendationId] = useState<string | null>(null);
  const [showNotificationDialog, setShowNotificationDialog] = useState(false);
  const [lastNotificationBatch, setLastNotificationBatch] = useState<Notification[]>([]);
  const [lastNotificationPromo, setLastNotificationPromo] = useState<Partial<Promotion>>({});
  const [isSavingPromotion, setIsSavingPromotion] = useState(false);
  // Promotion whose email audience is being chosen (Use Case 9); null = dialog closed.
  const [notifyTarget, setNotifyTarget] = useState<{ promo_id: string; promo_name: string; start_date?: string; end_date?: string } | null>(null);
  const [isSendingNotify, setIsSendingNotify] = useState(false);
  const [isUpdatingPromotion, setIsUpdatingPromotion] = useState(false);

  const syncPromotionProductLinks = async (promoId: string, targetProducts: string | undefined) => {
    const promo_id = String(promoId ?? '').trim();
    if (!promo_id) return;

    const parsed = parseTargetProducts(targetProducts);
    const wantsAll = !parsed.categories.length && !parsed.products.length;
    const productRowsForLink = sellableProductRows;
    const normalizedCategories = new Set(parsed.categories.map((c) => c.toLowerCase()));
    const normalizedProducts = new Set(parsed.products.map((p) => p.toLowerCase()));

    const targetProductIds = productRowsForLink
      .filter((row: any) => {
        const productName = String(row?.product_name ?? '').trim();
        const categoryName = String(row?.category?.[0]?.category_name ?? row?.category?.category_name ?? '').trim();
        if (!productName) return false;
        if (wantsAll) return false;
        if (normalizedProducts.size > 0) {
          if (!normalizedProducts.has(productName.toLowerCase())) return false;
          if (normalizedCategories.size > 0 && !normalizedCategories.has(categoryName.toLowerCase())) return false;
          return true;
        }
        return normalizedCategories.has(categoryName.toLowerCase());
      })
      .map((row: any) => String(row?.product_id ?? '').trim())
      .filter(Boolean);

    await supabase.from('promo_product').delete().eq('promo_id', promo_id);
    if (!targetProductIds.length) return;

    const uniqueIds = Array.from(new Set(targetProductIds));
    const rows = uniqueIds.map((product_id) => ({ promo_id, product_id }));
    const { error } = await supabase.from('promo_product').insert(rows as any);
    if (error) throw error;
  };

  useEffect(() => {
    try {
      localStorage.removeItem('promotions.hiddenRecommendationIds');
    } catch {
      // ignore
    }
  }, []);

  const emailAudience = useMemo(
    () => buildAudience((customersQuery.data as any[]) ?? [], (salesQuery.data as any[]) ?? []),
    [customersQuery.data, salesQuery.data],
  );

  const triggerPromotionEmailNotification = async (promoId: string, customerIds?: string[]) => {
    const parseResult = async (response: Response) => response.json().catch(() => ({}));
    // The backend verifies the staff session from these headers.
    const response = await fetch(`${BACKEND_BASE}/api/promotions/${encodeURIComponent(promoId)}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getBackendAuthHeaders()) },
      credentials: 'include',
      body: JSON.stringify(customerIds ? { customer_ids: customerIds } : {}),
    });
    const result = await parseResult(response);

    if (!response.ok || result?.ok === false) {
      throw new Error(result?.error || 'Failed to send promotion notifications');
    }

    return result as {
      ok: boolean;
      promo_id: string;
      delivery?: { enabled?: boolean; sent?: number; failed?: number; reason?: string };
      recipients?: Notification[];
    };
  };

  const promotions: Promotion[] = useMemo(() => {
    const rows = (promotionsQuery.data as any[]) ?? [];
    const sales = (salesQuery.data as any[]) ?? [];
    return rows.map((row) => {
      const rawType = String(row.discount_type ?? 'Percentage').toLowerCase();
      const discount_type: Promotion['discount_type'] = decodeDisplayType(rawType, row.promo_name);
      const rawStatus = String(row.status ?? 'active').toLowerCase();
      const nowMs = Date.now();
      const start = normalizePromotionDateTime(String(row.start_date ?? ''), 'start');
      const end = normalizePromotionDateTime(String(row.end_date ?? ''), 'end');
      const startMs = promotionTimeMs(start, 'start');
      const endMs = promotionTimeMs(end, 'end');
      const status: Promotion['status'] =
        rawStatus === 'inactive' || rawStatus === 'deactivated'
          ? 'Inactive'
          : rawStatus.includes('expired') || endMs < nowMs
            ? 'Ended'
            : startMs <= nowMs && nowMs <= endMs
              ? 'Active'
              : 'Upcoming';
      const targetSalesGoal = Number(row.target_sales_goal ?? row.targetSalesGoal ?? 10000) || 10000;
      const targetProductIds = (Array.isArray(row.promo_product) ? row.promo_product : [])
        .map((link: any) => {
          const product = Array.isArray(link?.product) ? link.product[0] : link?.product;
          return String(link?.product_id ?? product?.product_id ?? '').trim();
        })
        .filter(Boolean);
      const basePromotion = {
        promo_id: String(row.promo_id ?? ''),
        promo_name: stripPromoTypeMarker(String(row.promo_name ?? 'Promotion')),
        discount_type,
        discount_value: Number(row.discount_value ?? 0),
        targetProducts: String(row.target_products ?? row.targetProducts ?? deriveTargetProductsFromLinks(row)),
        start_date: start,
        end_date: end,
        status,
        salesGenerated: 0,
        unitsAffected: 0,
        effectiveness: 0,
        targetSalesGoal,
        targetProductIds,
      };
      const performance = sales.reduce(
        (sum, sale: any) => {
          if (!saleIsCompleted(sale)) return sum;
          const saleTime = saleTimestampMs(sale.transaction_date ?? sale.created_at);
          if (Number.isNaN(saleTime)) return sum;
          if (saleTime < startMs || saleTime > endMs) return sum;
          const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
          details.forEach((detail: any) => {
            const detailPromoId = String(detail?.promo_id ?? '').trim();
            const hasExplicitPromo = Boolean(detailPromoId);
            if (hasExplicitPromo && detailPromoId !== basePromotion.promo_id) return;
            if (!hasExplicitPromo) {
              const winningPromotion = rows
                .map((candidateRow: any) => {
                  const candidateStart = normalizePromotionDateTime(String(candidateRow.start_date ?? ''), 'start');
                  const candidateEnd = normalizePromotionDateTime(String(candidateRow.end_date ?? ''), 'end');
                  const candidateStartMs = promotionTimeMs(candidateStart, 'start');
                  const candidateEndMs = promotionTimeMs(candidateEnd, 'end');
                  if (saleTime < candidateStartMs || saleTime > candidateEndMs) return null;
                  const candidateType = decodeDisplayType(String(candidateRow.discount_type ?? 'Percentage').toLowerCase(), candidateRow.promo_name);
                  const candidateTargetIds = (Array.isArray(candidateRow.promo_product) ? candidateRow.promo_product : [])
                    .map((link: any) => {
                      const product = Array.isArray(link?.product) ? link.product[0] : link?.product;
                      return String(link?.product_id ?? product?.product_id ?? '').trim();
                    })
                    .filter(Boolean);
                  const candidatePromotion = {
                    promo_id: String(candidateRow.promo_id ?? ''),
                    promo_name: stripPromoTypeMarker(String(candidateRow.promo_name ?? 'Promotion')),
                    discount_type: candidateType,
                    discount_value: Number(candidateRow.discount_value ?? 0),
                    targetProducts: String(candidateRow.target_products ?? candidateRow.targetProducts ?? deriveTargetProductsFromLinks(candidateRow)),
                    start_date: candidateStart,
                    end_date: candidateEnd,
                    status: 'Active' as Promotion['status'],
                    salesGenerated: 0,
                    unitsAffected: 0,
                    effectiveness: 0,
                    targetSalesGoal: Number(candidateRow.target_sales_goal ?? candidateRow.targetSalesGoal ?? 10000) || 10000,
                    targetProductIds: candidateTargetIds,
                  };
                  const specificity = productDetailPromotionSpecificity(detail, candidatePromotion);
                  if (!specificity) return null;
                  return {
                    promo_id: candidatePromotion.promo_id,
                    specificity,
                    typePriority: getPromoPriority(candidatePromotion.discount_type),
                    discountValue: Number(candidatePromotion.discount_value ?? 0),
                    startMs: candidateStartMs,
                  };
                })
                .filter(Boolean)
                .sort((a: any, b: any) => {
                  if (b.specificity !== a.specificity) return b.specificity - a.specificity;
                  if (b.typePriority !== a.typePriority) return b.typePriority - a.typePriority;
                  if (b.discountValue !== a.discountValue) return b.discountValue - a.discountValue;
                  return b.startMs - a.startMs;
                })[0] as any;
              if (winningPromotion?.promo_id !== basePromotion.promo_id) return;
            }
            const quantity = Number(detail.quantity ?? 0);
            const lineSubtotal = Number(detail.subtotal ?? 0);
            const fallbackSubtotal = Number(detail.price ?? 0) * quantity;
            sum.sales += lineSubtotal > 0 ? lineSubtotal : fallbackSubtotal;
            sum.units += quantity;
          });
          return sum;
        },
        { sales: 0, units: 0 },
      );

      return {
        ...basePromotion,
        salesGenerated: Math.round(performance.sales),
        unitsAffected: performance.units,
        effectiveness: Math.min(100, Math.round((performance.sales / Math.max(1, targetSalesGoal)) * 100)),
      };
    });
  }, [promotionsQuery.data, salesQuery.data]);

  const productRecommendations = useMemo<PromotionRecommendation[]>(() => {
    const sales = (salesQuery.data as any[]) ?? [];
    const products = (productsQuery.data as any[]) ?? [];
    const now = new Date();
    const last30 = new Date(now);
    last30.setDate(now.getDate() - 30);

    const soldByProduct = new Map<string, number>();
    // Last completed sale per product, for holding duration (Use Case 8 Scenario 3).
    const lastSoldByProduct = new Map<string, number>();
    sales.forEach((sale: any) => {
      const txTime = saleTimestampMs(sale.transaction_date ?? sale.created_at);
      if (Number.isNaN(txTime)) return;
      const payment = Array.isArray(sale.payment) ? sale.payment[0] : sale.payment;
      const status = String(payment?.payment_status ?? '').toLowerCase();
      if (status !== 'completed' && status !== 'paid') return;
      const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
      details.forEach((d: any) => {
        const pid = String(d.product_id ?? '');
        if (!pid) return;
        lastSoldByProduct.set(pid, Math.max(lastSoldByProduct.get(pid) ?? 0, txTime));
        if (txTime < last30.getTime()) return;
        soldByProduct.set(pid, (soldByProduct.get(pid) ?? 0) + Number(d.quantity ?? 0));
      });
    });

    const rows = products.map((p: any) => {
      const inventory = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
      const stock = Number(inventory?.stock_quantity ?? 0);
      const reorder = Number(inventory?.reorder_level ?? p.reorder_level ?? 10);
      const sold30 = soldByProduct.get(String(p.product_id ?? '')) ?? 0;
      const velocity = sold30 / 30;
      const srp = Number(inventory?.srp ?? p.srp ?? p.selling_price ?? p.price ?? 0);
      const unitCost = Number(p.cost_price ?? p.unit_price ?? p.base_price ?? 0);
      const listedAt = saleTimestampMs(p.created_at);
      const lastMovement = lastSoldByProduct.get(String(p.product_id ?? '')) ?? (Number.isNaN(listedAt) ? now.getTime() : listedAt);
      return {
        id: String(p.product_id ?? ''),
        holdingDays: Math.max(0, Math.floor((now.getTime() - lastMovement) / 86400000)),
        name: String(p.product_name ?? 'Unknown Product'),
        category: String(p.category?.[0]?.category_name ?? p.category?.category_name ?? 'General'),
        srp,
        unitCost,
        stock,
        reorder,
        sold30,
        velocity,
        isSlowMover: stock >= reorder * 2 && sold30 <= 2,
      };
    });

    // Promotions target models by name, so combine every size/colour of a model.
    const models = new Map<string, { name: string; category: string; stock: number; sold30: number; holdingDays: number; variants: typeof rows }>();
    rows.forEach((r) => {
      const key = r.name.trim().toLowerCase();
      const model = models.get(key) ?? { name: r.name, category: r.category, stock: 0, sold30: 0, holdingDays: Number.POSITIVE_INFINITY, variants: [] as typeof rows };
      model.stock += r.stock;
      model.sold30 += r.sold30;
      // The model is only as idle as its most recently sold variant.
      model.holdingDays = Math.min(model.holdingDays, r.holdingDays);
      model.variants.push(r);
      models.set(key, model);
    });
    const modelList = Array.from(models.values()).filter((m) => m.stock > 0);
    const safeFor = (model: { variants: typeof rows }, requested: number) => {
      const priced = model.variants.filter((v) => v.srp > 0 && v.unitCost > 0);
      return priced.length ? Math.min(...priced.map((v) => roundedSafePercentage(v, requested))) : Math.min(5, requested);
    };
    // Slow / dead stock by holding duration (manuscript: dead stock = no sale in 60+ days).
    const idle = modelList
      .filter((m) => m.holdingDays >= 30)
      .sort((a, b) => b.holdingDays - a.holdingDays || b.stock - a.stock);
    const slow = idle[0];
    const fast = modelList
      .filter((m) => m.sold30 > 0 && (!slow || m.name !== slow.name))
      .sort((a, b) => b.sold30 - a.sold30)[0];
    const categoryRollup = new Map<string, { stock: number; sold: number }>();
    rows.forEach((r) => {
      const prev = categoryRollup.get(r.category) ?? { stock: 0, sold: 0 };
      categoryRollup.set(r.category, { stock: prev.stock + r.stock, sold: prev.sold + r.sold30 });
    });
    const weakCategory = Array.from(categoryRollup.entries())
      .map(([category, v]) => ({ category, ratio: v.stock > 0 ? v.sold / v.stock : 0 }))
      .sort((a, b) => a.ratio - b.ratio)[0];

    const recs: PromotionRecommendation[] = [];
    if (slow) {
      const isDead = slow.holdingDays >= 60;
      recs.push({
        id: `clearance-${slow.name}`,
        title: `${isDead ? 'Clear dead stock' : 'Boost slow mover'}: ${slow.name}`,
        rationale: `No sale in ${slow.holdingDays} days with ${slow.stock} pairs on hand${isDead ? ' (dead stock: 60+ days).' : '.'}`,
        discount_type: 'Percentage',
        discount_value: safeFor(slow, isDead ? 20 : 15),
        targetProducts: `Products: ${slow.name}`,
      });
    }
    if (slow && fast) {
      // Targeted Sales Marketing: pair a slow-moving model with a fast-moving one.
      recs.push({
        id: `bundle-${slow.name}-${fast.name}`,
        title: `Bundle: ${slow.name} + ${fast.name}`,
        rationale: `Pairs a slow mover (no sale in ${slow.holdingDays} days) with a best seller (${fast.sold30} sold in 30 days). Applies when both are in the cart.`,
        discount_type: 'Bundle',
        discount_value: Math.max(5, Math.min(safeFor(slow, 10), safeFor(fast, 10))),
        targetProducts: `Products: ${slow.name}, ${fast.name}`,
      });
    }
    if (weakCategory) {
      const categoryProducts = rows.filter((row) => row.category === weakCategory.category && row.srp > 0 && row.unitCost > 0);
      const safeCategoryDiscount = categoryProducts.length
        ? Math.min(...categoryProducts.map((row) => roundedSafePercentage(row, 10)))
        : 5;
      recs.push({
        id: `category-${weakCategory.category}`,
        title: `Category push: ${weakCategory.category}`,
        rationale: `Lowest sell-through ratio in last 30 days.`,
        discount_type: 'Percentage',
        discount_value: safeCategoryDiscount,
        targetProducts: `Categories: ${weakCategory.category}`,
      });
    }
    const sellableRows = rows.filter((row) => row.srp > 0 && row.unitCost > 0);
    const safeAllProductsDiscount = sellableRows.length
      ? Math.min(...sellableRows.map((row) => roundedSafePercentage(row, 10)))
      : 5;
    recs.push({
      id: 'weekend-traffic',
      title: 'Weekend traffic booster',
      rationale: 'Use short promo window to increase conversion without long margin impact.',
      discount_type: 'Percentage',
      discount_value: safeAllProductsDiscount,
      targetProducts: 'All Products',
    });
    return recs.slice(0, 4);
  }, [productsQuery.data, salesQuery.data]);

  const activeRecommendationSignatures = useMemo(() => {
    const covered = new Set<string>();
    promotions
      .filter((promo) => promo.status !== 'Ended')
      .forEach((promo) => {
        covered.add(recommendationSignature(promo.discount_type, promo.targetProducts));
      });
    return covered;
  }, [promotions]);

  const activeRecommendationTitles = useMemo(() => {
    const covered = new Set<string>();
    promotions
      .filter((promo) => promo.status !== 'Ended')
      .forEach((promo) => {
        covered.add(normalizeRecommendationTitle(promo.promo_name));
      });
    return covered;
  }, [promotions]);

  const visibleProductRecommendations = useMemo(
    () =>
      productRecommendations.filter(
        (rec) =>
          !hiddenRecommendationIds.has(rec.id) &&
          !activeRecommendationSignatures.has(recommendationSignature(rec.discount_type, rec.targetProducts)) &&
          !activeRecommendationTitles.has(normalizeRecommendationTitle(rec.title)),
      ),
    [activeRecommendationSignatures, activeRecommendationTitles, hiddenRecommendationIds, productRecommendations],
  );

  const validatePromotionMargin = (draft: Partial<Promotion>) => {
    const type = String(draft.discount_type ?? 'Percentage');
    const value = Number(draft.discount_value ?? 0);
    if (value <= 0) return '';

    const targets = resolvePromotionTargetProducts(draft.targetProducts, promotionMarginProducts);
    if (!targets.length) return '';

    const riskyProduct = targets.find((product) => {
      const promoPrice = estimatePromotionPrice(product.srp, type, value);
      const minimumPrice = product.isSlowMover ? product.unitCost * 1.03 : product.unitCost * 1.1;
      return promoPrice < minimumPrice;
    });
    if (!riskyProduct) return '';

    const promoPrice = estimatePromotionPrice(riskyProduct.srp, type, value);
    const minimumPrice = riskyProduct.isSlowMover ? riskyProduct.unitCost * 1.03 : riskyProduct.unitCost * 1.1;
    const marginLabel = riskyProduct.isSlowMover ? 'slow-mover floor' : 'regular margin floor';
    return `${riskyProduct.name} would sell at ₱${promoPrice.toFixed(2)}, below the ${marginLabel} of ₱${minimumPrice.toFixed(2)}. Lower the discount or target only products that can still make profit.`;
  };

  const applyRecommendation = (rec: PromotionRecommendation) => {
    const start = new Date();
    const end = new Date();
    end.setDate(start.getDate() + 7);
    setFormData({
      promo_name: rec.title,
      discount_type: rec.discount_type,
      discount_value: rec.discount_value,
      targetSalesGoal: formData.targetSalesGoal || 10000,
      targetProducts: rec.targetProducts,
      start_date: toLocalDateTimeInput(start),
      end_date: toLocalDateTimeInput(end),
      status: 'Upcoming',
    });
    setPendingRecommendationId(rec.id);
    setIsAddDialogOpen(true);
    toast.success('Recommendation applied to promotion form');
  };

  const promotionPerformance = useMemo(() => {
    const rows = [...promotions]
      .sort((a, b) => Number(b.salesGenerated || 0) - Number(a.salesGenerated || 0))
      .slice(0, 6)
      .map((p, index) => ({
        id: p.promo_id || `pp${index + 1}`,
        name: p.promo_name || `Promo ${index + 1}`,
        revenue: Number(p.salesGenerated || 0),
        units: Number(p.unitsAffected || 0),
        roi: Number(p.effectiveness || 0),
      }));
    return rows;
  }, [promotions]);

  const handleAddPromotion = async () => {
    if (!formData.promo_name || !formData.targetProducts || !formData.start_date || !formData.end_date) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (Number(formData.targetSalesGoal || 0) <= 0) {
      toast.error('Please enter a target sales goal greater than zero.');
      return;
    }
    const draftType = String(formData.discount_type ?? "Percentage");
    const draftTarget = String(formData.targetProducts ?? "All Products");
    const duplicate = promotions.find((promo) => {
      if (promo.status === "Ended") return false;
      if (!rangesOverlap(formData.start_date, formData.end_date, promo.start_date, promo.end_date)) return false;
      const sameType = String(promo.discount_type ?? "").toLowerCase() === String(formData.discount_type ?? "").toLowerCase();
      if (!sameType) return false;
      return normalizeTargetSignature(promo.targetProducts) === normalizeTargetSignature(draftTarget);
    });
    if (duplicate) {
      const existingPriority = getPromoPriority(String(duplicate.discount_type ?? ""));
      const incomingPriority = getPromoPriority(draftType);
      const winner = incomingPriority >= existingPriority ? "new promotion" : `"${duplicate.promo_name}"`;
      toast.warning(`Overlapping promo scope detected with "${duplicate.promo_name}". POS will apply a single winner by priority/specificity (current winner: ${winner}).`);
    }
    const dateError = validatePromotionDates(formData.start_date, formData.end_date);
    if (dateError) {
      toast.error(dateError);
      return;
    }
    const marginError = validatePromotionMargin(formData);
    if (marginError) {
      toast.error(marginError);
      return;
    }

    try {
      setIsSavingPromotion(true);
      const newPromotionPayload = {
        promo_name: encodePromoNameWithType(formData.promo_name!, formData.discount_type),
        discount_type: toDbDiscountType(formData.discount_type),
        discount_value: String(formData.discount_type ?? '').toLowerCase().includes('bogo')
          ? Number(formData.discount_value || 50)
          : Number(formData.discount_value || 0),
        target_sales_goal: Number(formData.targetSalesGoal),
        target_products: formData.targetProducts || 'All Products',
        targetProducts: formData.targetProducts || 'All Products',
        start_date: formData.start_date!,
        end_date: formData.end_date!,
        status: toDbStatusForWindow(formData.start_date, formData.end_date),
      };

      let createdPromotion: any;
      try {
        createdPromotion = await promotionsMutations.createMutation.mutateAsync(newPromotionPayload as any);
      } catch (error: any) {
        if (!isMissingTargetProductsColumnError(error)) throw error;
        const { target_products: _ignored, ...fallbackPayload } = newPromotionPayload as any;
        createdPromotion = await promotionsMutations.createMutation.mutateAsync(fallbackPayload);
      }

      const createdPromoId = String(createdPromotion?.promo_id || '').trim();
      try {
        await syncPromotionProductLinks(createdPromoId, formData.targetProducts || 'All Products');
      } catch (syncError: any) {
        console.warn("Promotion link sync warning (create):", syncError);
        toast.warning("Promotion saved, but product-link sync is limited by current permissions.");
      }
      await writeAuditLog({
        actorUserId: user?.user_id,
        actionType: "create_promotion",
        entityType: "promotion",
        entityId: createdPromoId || null,
        newData: {
          promo_name: formData.promo_name,
          discount_type: formData.discount_type,
          discount_value: formData.discount_value,
          targetSalesGoal: formData.targetSalesGoal,
          targetProducts: formData.targetProducts,
          start_date: formData.start_date,
          end_date: formData.end_date,
          status: getPromotionStatusForWindow(formData.start_date, formData.end_date),
        },
      });
      await promotionsQuery.refetch();
      if (pendingRecommendationId) {
        setHiddenRecommendationIds((prev) => new Set(prev).add(pendingRecommendationId));
      }
      setIsAddDialogOpen(false);
      setPendingRecommendationId(null);
      toast.success('Promotion created. Choose who should receive the email, or skip for now.');
      // Emails are sent only after the administrator picks the audience (Use Case 9).
      if (createdPromoId) {
        setNotifyTarget({
          promo_id: createdPromoId,
          promo_name: String(formData.promo_name ?? 'Promotion'),
          start_date: formData.start_date,
          end_date: formData.end_date,
        });
      }
      setFormData({});
    } catch (error: any) {
      toast.error(error?.message ?? 'Unable to create promotion');
    } finally {
      setIsSavingPromotion(false);
    }
  };

  const handleEditPromotion = async () => {
    if (!editingPromotion) return;
    if (Number(formData.targetSalesGoal || 0) <= 0) {
      toast.error('Please enter a target sales goal greater than zero.');
      return;
    }
    const draftType = String(formData.discount_type ?? "Percentage");
    const draftTarget = String(formData.targetProducts ?? "All Products");
    const duplicate = promotions.find((promo) => {
      if (promo.promo_id === editingPromotion.promo_id) return false;
      if (promo.status === "Ended") return false;
      if (!rangesOverlap(formData.start_date, formData.end_date, promo.start_date, promo.end_date)) return false;
      const sameType = String(promo.discount_type ?? "").toLowerCase() === String(formData.discount_type ?? "").toLowerCase();
      if (!sameType) return false;
      return normalizeTargetSignature(promo.targetProducts) === normalizeTargetSignature(draftTarget);
    });
    if (duplicate) {
      const existingPriority = getPromoPriority(String(duplicate.discount_type ?? ""));
      const incomingPriority = getPromoPriority(draftType);
      const winner = incomingPriority >= existingPriority ? "edited promotion" : `"${duplicate.promo_name}"`;
      toast.warning(`Overlapping promo scope detected with "${duplicate.promo_name}". POS will apply a single winner by priority/specificity (current winner: ${winner}).`);
    }
    const dateError = validatePromotionDates(formData.start_date, formData.end_date);
    const isKeepingExistingPastStartDate =
      dateError === 'Start date/time cannot be in the past.' &&
      normalizePromotionDateTime(formData.start_date, 'start') === normalizePromotionDateTime(editingPromotion.start_date, 'start');
    if (dateError) {
      if (!isKeepingExistingPastStartDate) {
        toast.error(dateError);
        return;
      }
    }
    const marginError = validatePromotionMargin(formData);
    if (marginError) {
      toast.error(marginError);
      return;
    }
    try {
      setIsUpdatingPromotion(true);
      const payload = {
        promo_name: encodePromoNameWithType(formData.promo_name, formData.discount_type),
        discount_type: toDbDiscountType(formData.discount_type),
        discount_value: String(formData.discount_type ?? '').toLowerCase().includes('bogo')
          ? Number(formData.discount_value || 50)
          : formData.discount_value,
        target_sales_goal: Number(formData.targetSalesGoal),
        target_products: formData.targetProducts,
        targetProducts: formData.targetProducts,
        start_date: formData.start_date,
        end_date: formData.end_date,
        // Editing must not silently re-enable a promotion that staff switched off.
        status: editingPromotion.status === 'Inactive'
          ? 'inactive'
          : toDbStatusForWindow(formData.start_date, formData.end_date),
      } as any;

      try {
        await promotionsMutations.updateMutation.mutateAsync({
          id: editingPromotion.promo_id,
          payload,
        } as any);
      } catch (error: any) {
        if (!isMissingTargetProductsColumnError(error)) throw error;
        const { target_products: _ignored, ...fallbackPayload } = payload;
        await promotionsMutations.updateMutation.mutateAsync({
          id: editingPromotion.promo_id,
          payload: fallbackPayload,
        } as any);
      }
      try {
        await syncPromotionProductLinks(editingPromotion.promo_id, formData.targetProducts);
      } catch (syncError: any) {
        console.warn("Promotion link sync warning (update):", syncError);
        toast.warning("Promotion updated, but product-link sync is limited by current permissions.");
      }
      await promotionsQuery.refetch();
      await writeAuditLog({
        actorUserId: user?.user_id,
        actionType: "update_promotion",
        entityType: "promotion",
        entityId: editingPromotion.promo_id,
        oldData: editingPromotion,
        newData: formData,
      });
      setEditingPromotion(null);
      setFormData({});
      toast.success('Promotion updated successfully!');
    } catch (error: any) {
      toast.error(error?.message ?? 'Unable to update promotion');
    } finally {
      setIsUpdatingPromotion(false);
    }
  };

  const handleTogglePromotionStatus = async (promotion: Promotion) => {
    try {
      // Active and Upcoming promotions are enabled; pausing sets "inactive".
      // Resuming lets the start/end window decide again.
      const isCurrentlyActive = promotion.status !== 'Inactive';
      const nextDbStatus = isCurrentlyActive ? 'inactive' : toDbStatusForWindow(promotion.start_date, promotion.end_date);
      const { error } = await supabase
        .from('promotion')
        .update({ status: nextDbStatus, updated_at: new Date().toISOString() })
        .eq('promo_id', promotion.promo_id);

      if (error) throw error;

      await promotionsQuery.refetch();
      await writeAuditLog({
        actorUserId: user?.user_id,
        actionType: isCurrentlyActive ? 'deactivate_promotion' : 'activate_promotion',
        entityType: 'promotion',
        entityId: promotion.promo_id,
        oldData: { status: promotion.status },
        newData: { status: nextDbStatus },
      });

      toast.success(
        isCurrentlyActive
          ? `Promotion "${promotion.promo_name}" deactivated successfully!`
          : `Promotion "${promotion.promo_name}" activated successfully!`
      );
    } catch (error: any) {
      toast.error(error?.message ?? 'Unable to update promotion status');
    }
  };

  const sendPromotionNotification = async (customerIds: string[]) => {
    if (!notifyTarget) return;
    setIsSendingNotify(true);
    try {
      const result = await triggerPromotionEmailNotification(notifyTarget.promo_id, customerIds);
      const recipients = (result.recipients || []) as Notification[];
      const sent = Number(result.delivery?.sent || 0);
      const failed = Number(result.delivery?.failed || 0);
      setNotifications((prev) => [...prev, ...recipients]);
      setLastNotificationBatch(recipients);
      setLastNotificationPromo({ promo_name: notifyTarget.promo_name, start_date: notifyTarget.start_date, end_date: notifyTarget.end_date });
      await writeAuditLog({
        actorUserId: user?.user_id,
        actionType: 'send_promotion_notification',
        entityType: 'promotion',
        entityId: notifyTarget.promo_id,
        metadata: { requested_recipients: customerIds.length, sent, failed },
      });
      if (result.delivery?.enabled) {
        toast.success(`Emails sent: ${sent}, failed: ${failed}.`);
      } else {
        toast.warning(`Email sending is not available (${result.delivery?.reason || 'not configured'}).`);
      }
      setNotifyTarget(null);
      setShowNotificationDialog(recipients.length > 0);
    } catch (error: any) {
      toast.error(error?.message ?? 'Unable to send promotion emails');
    } finally {
      setIsSendingNotify(false);
    }
  };

  const openEditDialog = (promotion: Promotion) => {
    setEditingPromotion(promotion);
    setFormData(promotion);
  };

  const handleCreateDialogOpenChange = (open: boolean) => {
    setIsAddDialogOpen(open);
    if (!open) {
      // Cancel/exit should not permanently hide recommendation cards.
      setPendingRecommendationId(null);
      setFormData({});
    }
  };

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'ended'>('all');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('all');
  const [datePreset, setDatePreset] = useState<'all' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually' | 'custom'>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  const applyDatePreset = (preset: 'all' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually' | 'custom') => {
    setDatePreset(preset);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const formatYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'daily') {
      const todayStr = formatYMD(now);
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === 'weekly') {
      const weekStart = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      setStartDate(formatYMD(weekStart));
      setEndDate(formatYMD(now));
    } else if (preset === 'monthly') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      setStartDate(formatYMD(firstDay));
      setEndDate(formatYMD(lastDay));
    } else if (preset === 'quarterly') {
      const currentQuarterMonth = Math.floor(now.getMonth() / 3) * 3;
      const firstDayOfQuarter = new Date(now.getFullYear(), currentQuarterMonth, 1);
      const lastDayOfQuarter = new Date(now.getFullYear(), currentQuarterMonth + 3, 0);
      setStartDate(formatYMD(firstDayOfQuarter));
      setEndDate(formatYMD(lastDayOfQuarter));
    } else if (preset === 'annually') {
      const firstDayOfYear = new Date(now.getFullYear(), 0, 1);
      const lastDayOfYear = new Date(now.getFullYear(), 11, 31);
      setStartDate(formatYMD(firstDayOfYear));
      setEndDate(formatYMD(lastDayOfYear));
    }
  };

  const handleCustomDateChange = (type: 'start' | 'end', val: string) => {
    setDatePreset('custom');
    if (type === 'start') {
      setStartDate(val);
    } else {
      setEndDate(val);
    }
  };

  const handleResetFilters = () => {
    setStatusFilter('all');
    setSearchTerm('');
    setSelectedTypeFilter('all');
    setDatePreset('all');
    setStartDate('');
    setEndDate('');
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    statusFilter !== 'all' ||
    selectedTypeFilter !== 'all' ||
    datePreset !== 'all' ||
    startDate ||
    endDate
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, searchTerm, selectedTypeFilter, datePreset, startDate, endDate]);

  const handleDuplicatePromotion = (promo: Promotion) => {
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);

    const pad = (n: number) => String(n).padStart(2, '0');
    const formatDt = (d: Date, timeStr: string) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${timeStr}`;

    const cleanBaseName = promo.promo_name.replace(/\s*\((?:Rerun|Copy)(?:\s*\d+)?\)$/i, '').trim();

    setFormData({
      promo_name: `${cleanBaseName} (Rerun)`,
      discount_type: promo.discount_type,
      discount_value: promo.discount_value,
      targetSalesGoal: promo.targetSalesGoal,
      targetProducts: promo.targetProducts,
      start_date: formatDt(today, '08:00'),
      end_date: formatDt(nextWeek, '23:59'),
      status: 'Upcoming',
    });
    setIsAddDialogOpen(true);
    toast.info(`Campaign "${cleanBaseName}" cloned! Choose your new promotional period.`);
  };

  const totalRevenue = promotions.reduce((sum, p) => sum + p.salesGenerated, 0);
  const activePromotions = promotions.filter(p => p.status === 'Active').length;
  const endedPromotions = promotions.filter(p => p.status === 'Ended').length;
  const upcomingPromotions = promotions.filter(p => p.status === 'Upcoming').length;

  const displayedPromotions = useMemo(() => {
    return promotions.filter((p) => {
      // 1. Status Filter
      if (statusFilter === 'active') {
        if (!(p.status === 'Active' || p.status === 'Upcoming' || p.status === 'Inactive')) return false;
      } else if (statusFilter === 'ended') {
        if (p.status !== 'Ended') return false;
      }

      // 2. Promo Type Filter
      if (selectedTypeFilter !== 'all') {
        if (p.discount_type !== selectedTypeFilter) return false;
      }

      // 3. Search Term Filter
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase().trim();
        const matchesName = p.promo_name.toLowerCase().includes(q);
        const matchesProducts = p.targetProducts.toLowerCase().includes(q);
        const matchesType = p.discount_type.toLowerCase().includes(q);
        if (!matchesName && !matchesProducts && !matchesType) return false;
      }

      // 4. Date Range Filter
      if (startDate || endDate) {
        const fStart = startDate || '1970-01-01';
        const fEnd = endDate || '2099-12-31';
        if (!rangesOverlap(p.start_date, p.end_date, fStart, fEnd)) {
          return false;
        }
      }

      return true;
    });
  }, [promotions, statusFilter, selectedTypeFilter, searchTerm, startDate, endDate]);

  const totalPromoPages = Math.max(1, Math.ceil(displayedPromotions.length / pageSize));
  const safePromoPage = Math.min(Math.max(1, currentPage), totalPromoPages);
  const paginatedPromotions = useMemo(() => {
    return displayedPromotions.slice((safePromoPage - 1) * pageSize, safePromoPage * pageSize);
  }, [displayedPromotions, safePromoPage, pageSize]);

  const avgEffectiveness = promotions.filter(p => p.effectiveness > 0).reduce((sum, p) => sum + p.effectiveness, 0) / promotions.filter(p => p.effectiveness > 0).length || 0;
  const sentNotificationCount = lastNotificationBatch.filter(
    (notif) => String(notif.email_status || '').toLowerCase() === 'sent',
  ).length;
  const failedNotificationCount = lastNotificationBatch.filter(
    (notif) => String(notif.email_status || '').toLowerCase() === 'failed',
  ).length;
  const notificationSummaryTone =
    failedNotificationCount > 0 && sentNotificationCount === 0
      ? 'failed'
      : failedNotificationCount > 0
        ? 'partial'
        : 'sent';

  return (
    <div className="space-y-6">
      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-[#15151D] border-[#24242F]">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-400">Active Promotions</p>
                <p className="text-2xl font-bold text-yellow-300">{activePromotions}</p>
              </div>
              <Tag className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[#15151D] border-[#24242F]">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-400">Revenue Generated</p>
                <p className="text-2xl font-bold text-yellow-300">₱{totalRevenue.toLocaleString()}</p>
              </div>
              <Coins className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[#15151D] border-[#24242F]">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-400">Avg Effectiveness</p>
                <p className="text-2xl font-bold text-yellow-300">{avgEffectiveness.toFixed(1)}%</p>
              </div>
              <TrendingUp className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-[#15151D] border-[#24242F]">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-zinc-400">Units Affected</p>
                <p className="text-2xl font-bold text-yellow-300">{promotions.reduce((sum, p) => sum + p.unitsAffected, 0)}</p>
              </div>
              <ShoppingCart className="h-8 w-8 text-yellow-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Analytics Recommendations */}
      <Card className="bg-[#15151D] border-[#24242F]">
        <CardHeader>
          <CardTitle className="text-yellow-300 flex items-center gap-2">
            <Percent className="w-5 h-5 text-yellow-400" />
            Recommended by Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleProductRecommendations.map((rec) => (
              <div key={rec.id} className="rounded-xl border border-[#2B2B38] bg-[#1A1A24] p-3 hover:border-yellow-400/30 transition">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-white font-semibold">{rec.title}</p>
                    <p className="text-zinc-400 text-xs mt-1">{rec.rationale}</p>
                    <div className="flex gap-2 mt-2">
                      <Badge className="bg-yellow-400 text-black font-semibold">{rec.discount_type}</Badge>
                      <Badge className="bg-[#242432] text-yellow-300 border border-zinc-700 font-semibold">
                        {rec.discount_type === 'Percentage'
                          ? `${rec.discount_value}%`
                          : rec.discount_type === 'Fixed Amount'
                            ? `₱${rec.discount_value}`
                            : rec.discount_type === 'BOGO'
                              ? 'Buy 1 Get 1'
                              : 'Bundle'}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="bg-yellow-400 text-black font-bold hover:bg-yellow-300 shadow-sm"
                    onClick={() => applyRecommendation(rec)}
                  >
                    Apply
                  </Button>
                </div>
              </div>
            ))}
            {!visibleProductRecommendations.length && (
              <div className="md:col-span-2 rounded-lg border border-yellow-400/20 bg-yellow-400/10 p-4 text-sm text-yellow-100">
                All current analytics recommendations are already covered by active or scheduled promotions.
                Delete, end, or expire a matching promotion and the recommendation will appear again if the sales data still supports it.
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active Promotions Table */}
      <Card className="bg-[#15151D] border-[#24242F]">
        <CardHeader className="pb-3 border-b border-[#24242F]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-yellow-300 flex items-center gap-2">
                <Tag className="w-5 h-5 text-yellow-400" />
                Promotion Campaigns
              </CardTitle>
              <p className="text-xs text-zinc-400 mt-1">
                Manage promotional discounts, scheduled periods, duplicate/rerun past campaigns, and monitor sales effectiveness.
              </p>
            </div>
            <Dialog open={isAddDialogOpen} onOpenChange={handleCreateDialogOpenChange}>
              <DialogTrigger asChild>
                <Button className="bg-yellow-400 text-black hover:bg-yellow-300 font-bold text-xs sm:text-sm self-start sm:self-auto shadow-md">
                  <Plus className="w-4 h-4 mr-2" />
                  Create Promotion
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#15161d] border-[#2a2c36] text-yellow-100 sm:max-w-3xl max-h-[90vh] overflow-hidden p-0 shadow-2xl">
                <DialogHeader className="border-b border-white/10 bg-[#171821] px-6 py-5">
                  <DialogTitle className="text-white text-xl">Create New Promotion</DialogTitle>
                </DialogHeader>
                <div className="max-h-[calc(90vh-9.5rem)] overflow-y-auto px-6 py-5 pr-4 [scrollbar-width:thin] [scrollbar-color:#facc15_#20212a]">
                  <PromotionForm
                    formData={formData}
                    setFormData={setFormData}
                    categoryOptions={categoryOptions}
                    productOptions={productOptions}
                  />
                </div>
                <DialogFooter className="border-t border-white/10 bg-[#171821]/95 px-6 py-4">
                  <DialogClose asChild>
                    <Button type="button" variant="outline" className="border-[#343444] bg-transparent text-yellow-200 hover:bg-[#202030]">Cancel</Button>
                  </DialogClose>
                  <Button
                    onClick={handleAddPromotion}
                    disabled={isSavingPromotion}
                    className="bg-yellow-400 text-black hover:bg-yellow-300 font-bold disabled:opacity-60"
                  >
                    {isSavingPromotion ? 'Creating...' : 'Create Promotion'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {/* FILTER CONTROLS BAR: Search, Status Tabs, Date Presets (Daily, Weekly, Monthly, Quarterly, Annually), and Custom Date Pickers */}
          <div className="space-y-3 bg-[#12121A] p-3.5 rounded-xl border border-[#24242F]">
            <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
              {/* Search Bar */}
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-yellow-400 pointer-events-none" />
                <Input
                  placeholder="Search by promo name, products, discount type..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 bg-[#181824] border-[#282836] text-white placeholder:text-zinc-500 text-sm focus-visible:ring-yellow-400/40 rounded-xl"
                />
              </div>

              {/* Status Tabs */}
              <div className="flex items-center gap-1 bg-[#181824] p-1 rounded-xl border border-[#282836] shrink-0">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    statusFilter === 'all'
                      ? 'bg-yellow-400 text-black shadow font-bold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  All ({promotions.length})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('active')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    statusFilter === 'active'
                      ? 'bg-yellow-400 text-black shadow font-bold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Active ({activePromotions + upcomingPromotions})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('ended')}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    statusFilter === 'ended'
                      ? 'bg-yellow-400 text-black shadow font-bold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Ended ({endedPromotions})
                </button>
              </div>

              {/* Date Range Presets: All, Daily, Weekly, Monthly, Quarterly, Annually */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="inline-flex items-center p-0.5 rounded-lg bg-[#181824] border border-[#282836] text-xs flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => applyDatePreset("all")}
                    className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                      datePreset === "all"
                        ? "bg-yellow-400 text-black font-bold"
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    All Dates
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => applyDatePreset("daily")}
                    className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                      datePreset === "daily"
                        ? "bg-yellow-400 text-black font-bold"
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    Daily
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => applyDatePreset("weekly")}
                    className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                      datePreset === "weekly"
                        ? "bg-yellow-400 text-black font-bold"
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    Weekly
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => applyDatePreset("monthly")}
                    className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                      datePreset === "monthly"
                        ? "bg-yellow-400 text-black font-bold"
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    Monthly
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => applyDatePreset("quarterly")}
                    className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                      datePreset === "quarterly"
                        ? "bg-yellow-400 text-black font-bold"
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    Quarterly
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => applyDatePreset("annually")}
                    className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                      datePreset === "annually"
                        ? "bg-yellow-400 text-black font-bold"
                        : "text-zinc-400 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    Annually
                  </Button>
                </div>

                {hasActiveFilters && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={handleResetFilters}
                    className="h-7 px-2 text-xs text-yellow-400 hover:text-yellow-300 hover:bg-yellow-400/10 flex items-center gap-1 rounded-md"
                    title="Reset all filters"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Custom Date Pickers Sub-Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2.5 border-t border-[#24242F] text-xs text-zinc-300">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 font-medium text-yellow-400">
                  <Calendar className="w-4 h-4 text-yellow-400" />
                  <span>Custom Date Range:</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-400">From</span>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => handleCustomDateChange("start", e.target.value)}
                    className="h-8 w-36 bg-[#181824] border-[#282836] text-white text-xs px-2.5 rounded-lg cursor-pointer [color-scheme:dark]"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-400">To</span>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => handleCustomDateChange("end", e.target.value)}
                    className="h-8 w-36 bg-[#181824] border-[#282836] text-white text-xs px-2.5 rounded-lg cursor-pointer [color-scheme:dark]"
                  />
                </div>

                {/* Promo Type Filter */}
                <div className="flex items-center gap-1.5 sm:ml-2">
                  <Filter className="w-3.5 h-3.5 text-yellow-400" />
                  <Select value={selectedTypeFilter} onValueChange={setSelectedTypeFilter}>
                    <SelectTrigger className="h-8 w-36 bg-[#181824] border-[#282836] text-yellow-100 text-xs rounded-lg">
                      <SelectValue placeholder="All Types" />
                    </SelectTrigger>
                    <SelectContent className="bg-[#15151d] border-[#282836] text-yellow-100 text-xs">
                      <SelectItem value="all">All Promo Types</SelectItem>
                      <SelectItem value="Percentage">Percentage</SelectItem>
                      <SelectItem value="Fixed Amount">Fixed Amount</SelectItem>
                      <SelectItem value="BOGO">BOGO (Buy 1 Get 1)</SelectItem>
                      <SelectItem value="Bundle">Bundle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="text-xs text-zinc-400">
                Showing <strong className="text-yellow-400">{displayedPromotions.length}</strong> of {promotions.length} campaigns
              </div>
            </div>
          </div>

          <div className="border border-[#24242F] rounded-xl overflow-x-auto bg-[#111118]">
            <Table className="w-full min-w-[920px]">
              <TableHeader>
                <TableRow className="bg-[#181824] hover:bg-[#181824] border-[#24242F]">
                  <TableHead className="text-yellow-300 whitespace-nowrap text-center">Promotion Name</TableHead>
                  <TableHead className="text-yellow-300 whitespace-nowrap text-center">Type</TableHead>
                  <TableHead className="text-yellow-300 whitespace-nowrap text-center">Discount</TableHead>
                  <TableHead className="text-yellow-300 whitespace-nowrap text-center">Period</TableHead>
                  <TableHead className="text-yellow-300 whitespace-nowrap text-center">Status</TableHead>
                  <TableHead className="text-yellow-300 whitespace-nowrap text-center">Performance</TableHead>
                  <TableHead className="text-yellow-300 whitespace-nowrap text-center">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedPromotions.length > 0 ? (
                  paginatedPromotions.map((promotion) => (
                    <TableRow key={promotion.promo_id} className="border-[#24242F] hover:bg-white/[0.02]">
                      <TableCell className="min-w-[200px] text-center align-middle">
                        <div>
                          <p className="text-white font-semibold break-words leading-tight">{promotion.promo_name}</p>
                          <p className="mt-1 text-zinc-400 text-xs break-words leading-tight">{promotion.targetProducts}</p>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-center align-middle">
                        <Badge className="bg-yellow-400 text-black font-semibold">
                          {promotion.discount_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-yellow-300 whitespace-nowrap text-center align-middle font-semibold">
                        {promotion.discount_type === 'Percentage' ? `${promotion.discount_value}%` :
                         promotion.discount_type === 'Fixed Amount' ? `₱${promotion.discount_value}` :
                         promotion.discount_type === 'BOGO' ? 'Buy 1 Get 1' : `Bundle ${bundlePercent(Number(promotion.discount_value || 0))}%`}
                      </TableCell>
                      <TableCell className="text-zinc-200 text-sm text-center align-middle">
                        <div className="leading-tight">
                          <p className="text-white font-medium">{formatPromotionDateTime(promotion.start_date, 'start')}</p>
                          <p className="text-zinc-400 text-xs">to {formatPromotionDateTime(promotion.end_date, 'end')}</p>
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-center align-middle">
                        <Badge className={
                          promotion.status === 'Active' ? 'bg-emerald-600 text-white font-medium' :
                          promotion.status === 'Upcoming' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-medium' :
                          promotion.status === 'Inactive' ? 'bg-zinc-700 text-zinc-300 font-medium' :
                          'bg-zinc-800 text-zinc-400 border border-zinc-700 font-medium'
                        }>
                          {promotion.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="min-w-[220px] text-center align-middle">
                        <div className="space-y-1">
                          <div className="flex flex-wrap justify-center gap-3 text-xs text-zinc-300">
                            <span className="whitespace-nowrap">Sales: ₱{promotion.salesGenerated}</span>
                            <span className="whitespace-nowrap">Goal: PHP {promotion.targetSalesGoal.toLocaleString()}</span>
                            <span className="whitespace-nowrap">{promotion.unitsAffected} units</span>
                          </div>
                          <Progress value={promotion.effectiveness} className="h-2 bg-zinc-800" />
                          <p className="text-xs text-yellow-300">{promotion.effectiveness}% of target</p>
                        </div>
                      </TableCell>
                      <TableCell className="text-center align-middle">
                        <div className="flex gap-1.5 justify-center items-center">
                          <Dialog open={editingPromotion?.promo_id === promotion.promo_id} onOpenChange={(open) => !open && setEditingPromotion(null)}>
                            <DialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-yellow-400 hover:text-yellow-300 hover:bg-zinc-800 h-8 px-2.5 flex items-center gap-1"
                                onClick={() => openEditDialog(promotion)}
                                title="Edit Promotion"
                              >
                                <Edit className="w-4 h-4" />
                                <span className="text-xs">Edit</span>
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="bg-[#15161d] border-[#2a2c36] text-yellow-100 sm:max-w-3xl max-h-[90vh] overflow-hidden p-0 shadow-2xl">
                              <DialogHeader className="border-b border-white/10 bg-[#171821] px-6 py-5">
                                <DialogTitle className="text-white text-xl">Edit Promotion</DialogTitle>
                              </DialogHeader>
                              <div className="max-h-[calc(90vh-9.5rem)] overflow-y-auto px-6 py-5 pr-4 [scrollbar-width:thin] [scrollbar-color:#facc15_#20212a]">
                                <PromotionForm
                                  formData={formData}
                                  setFormData={setFormData}
                                  categoryOptions={categoryOptions}
                                  productOptions={productOptions}
                                />
                              </div>
                              <DialogFooter className="border-t border-white/10 bg-[#171821]/95 px-6 py-4">
                                <DialogClose asChild>
                                  <Button type="button" variant="outline" className="border-[#343444] bg-transparent text-yellow-200 hover:bg-[#202030]">Cancel</Button>
                                </DialogClose>
                                <Button
                                  onClick={handleEditPromotion}
                                  disabled={isUpdatingPromotion}
                                  className="bg-yellow-400 text-black hover:bg-yellow-300 font-bold disabled:opacity-60"
                                >
                                  {isUpdatingPromotion ? 'Updating...' : 'Update Promotion'}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>

                          {/* Duplicate / Rerun Button (Available for all promotions so you can rerun with a new period) */}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-yellow-300 hover:text-yellow-100 hover:bg-yellow-400/20 h-8 px-2.5 flex items-center gap-1.5 border border-yellow-500/40 hover:border-yellow-400 rounded-lg transition-colors shadow-sm"
                            onClick={() => handleDuplicatePromotion(promotion)}
                            title="Clone and rerun this campaign with a new promotional period (preserves past sales history)"
                          >
                            <Copy className="w-3.5 h-3.5 text-yellow-400" />
                            <span className="text-xs font-semibold">Rerun</span>
                          </Button>

                          {promotion.status !== 'Ended' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-sky-300 hover:text-sky-100 hover:bg-sky-400/15 h-8 px-2.5 flex items-center gap-1.5 border border-sky-500/40 hover:border-sky-400 rounded-lg transition-colors"
                              onClick={() => setNotifyTarget({ promo_id: promotion.promo_id, promo_name: promotion.promo_name, start_date: promotion.start_date, end_date: promotion.end_date })}
                              title="Email this promotion to a chosen group of customers"
                            >
                              <Mail className="w-3.5 h-3.5" />
                              <span className="text-xs font-semibold">Notify</span>
                            </Button>
                          )}

                          {/* Activate / Deactivate Toggle for non-Ended promotions */}
                          {promotion.status === 'Active' || promotion.status === 'Upcoming' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-emerald-400 hover:text-red-400 hover:bg-red-950/50 h-8 px-2.5 flex items-center gap-1.5 border border-emerald-500/30 hover:border-red-500/40 rounded-lg transition-colors"
                              onClick={() => handleTogglePromotionStatus(promotion)}
                              title="Click to Pause / Deactivate Promotion"
                            >
                              <ToggleRight className="w-4 h-4 text-emerald-400" />
                              <span className="text-xs font-semibold">{promotion.status === 'Upcoming' ? 'Scheduled' : 'Active'}</span>
                            </Button>
                          ) : promotion.status !== 'Ended' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-zinc-400 hover:text-emerald-300 hover:bg-emerald-950/50 h-8 px-2.5 flex items-center gap-1.5 border border-zinc-700 hover:border-emerald-500/40 rounded-lg transition-colors"
                              onClick={() => handleTogglePromotionStatus(promotion)}
                              title="Click to Activate Promotion"
                            >
                              <ToggleLeft className="w-4 h-4 text-zinc-400" />
                              <span className="text-xs font-semibold">Paused</span>
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-yellow-200/60 text-sm">
                      No promotions found matching the selected filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Table Pagination */}
          <TablePagination
            currentPage={safePromoPage}
            pageSize={pageSize}
            totalItems={displayedPromotions.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[10, 15, 25, 50]}
            unitName="campaigns"
          />
        </CardContent>
      </Card>

      <PromotionNotifyDialog
        key={notifyTarget?.promo_id ?? 'none'}
        open={Boolean(notifyTarget)}
        onOpenChange={(open) => !open && setNotifyTarget(null)}
        promoName={notifyTarget?.promo_name ?? ''}
        audience={emailAudience}
        sending={isSendingNotify}
        onSend={sendPromotionNotification}
      />

      {/* Notification Confirmation Dialog */}
      <Dialog open={showNotificationDialog} onOpenChange={setShowNotificationDialog}>
        <DialogContent className="bg-[#15161d] border-[#2a2c36] text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Email Notification Summary
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div
              className={`flex items-center gap-3 p-4 rounded-lg border ${
                notificationSummaryTone === 'sent'
                  ? 'bg-emerald-950/40 border-emerald-700'
                  : notificationSummaryTone === 'partial'
                    ? 'bg-amber-950/40 border-amber-700'
                    : 'bg-red-950/40 border-red-800'
              }`}
            >
              {notificationSummaryTone === 'sent' ? (
                <CheckCircle className="w-6 h-6 text-emerald-400" />
              ) : (
                <X className="w-6 h-6 text-red-300" />
              )}
              <div>
                <p className="text-white font-semibold">
                  {sentNotificationCount} sent, {failedNotificationCount} failed
                </p>
                <p className="text-sm text-gray-300">
                  {failedNotificationCount > 0
                    ? 'Some emails were not accepted by Gmail. Check the failed recipients below for the exact reason.'
                    : 'All selected customers were notified about this promotion.'}
                </p>
              </div>
            </div>

            <div className="max-h-64 overflow-y-auto">
              <p className="text-gray-200 mb-2">Notification Recipients:</p>
              <div className="space-y-2">
                {lastNotificationBatch.map((notif) => {
                  const customerName = customerNameMap.get(notif.customer_id) || 'Customer';
                  const status = String(notif.email_status || 'pending').toLowerCase();
                  const isFailed = status === 'failed';
                  return (
                    <div key={notif.notification_id} className="flex items-start justify-between gap-3 p-3 bg-[#1f2029] rounded border border-[#30323d]">
                      <div className="flex items-start gap-3 min-w-0">
                        <Mail className="w-4 h-4 text-yellow-400 mt-1" />
                        <div className="min-w-0">
                          <p className="text-white text-sm">{customerName}</p>
                          <p className="text-gray-300 text-xs break-all">{notif.email || 'No email address'}</p>
                          {isFailed && notif.send_error ? (
                            <p className="text-red-300 text-xs mt-1 break-words">{notif.send_error}</p>
                          ) : null}
                        </div>
                      </div>
                      <Badge className={`${isFailed ? 'bg-red-900 text-red-100 border border-red-700' : 'bg-emerald-900 text-emerald-100 border border-emerald-700'} text-xs shrink-0`}>
                        {status.slice(0, 1).toUpperCase() + status.slice(1)}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="p-4 bg-[#1f2029] border border-[#30323d] rounded-lg">
              <p className="text-white text-sm">Promotion Details:</p>
              <div className="mt-2 space-y-1 text-sm text-gray-300">
                <p><span className="text-yellow-300">Promotion:</span> {lastNotificationPromo.promo_name || 'Promotion'}</p>
                <p><span className="text-yellow-300">Start Date:</span> {lastNotificationPromo.start_date || formData.start_date || lastNotificationBatch[0]?.date_sent || 'N/A'}</p>
                <p><span className="text-yellow-300">End Date:</span> {lastNotificationPromo.end_date || formData.end_date || 'N/A'}</p>
                <p className="text-xs text-gray-400 mt-2">Successful recipients received this promotion via Gmail.</p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowNotificationDialog(false)} className="bg-yellow-400 text-black hover:bg-yellow-300">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PromotionForm({ formData, setFormData, categoryOptions, productOptions }: {
  formData: Partial<Promotion>;
  setFormData: (data: Partial<Promotion>) => void;
  categoryOptions: string[];
  productOptions: Array<{ name: string; category: string; stock: number }>;
}) {
  const minPromotionDate = todayDateInput();
  const isBogoType = String(formData.discount_type ?? '').toLowerCase().includes('bogo');
  const isFixedAmountType = String(formData.discount_type ?? '').toLowerCase().includes('fixed');
  const isPercentageType = String(formData.discount_type ?? '').toLowerCase().includes('percent');
  const isBundleType = String(formData.discount_type ?? '').toLowerCase().includes('bundle');
  const parsed = useMemo(() => parseTargetProducts(formData.targetProducts), [formData.targetProducts]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>(parsed.categories);
  const [selectedProducts, setSelectedProducts] = useState<string[]>(parsed.products);
  const [pendingCategory, setPendingCategory] = useState('');
  const [isProductPickerOpen, setIsProductPickerOpen] = useState(false);
  const [productSearch, setProductSearch] = useState('');

  useEffect(() => {
    const sanitizedTarget = sanitizeTargetProductsToSellable(
      formData.targetProducts,
      categoryOptions,
      productOptions,
    );
    const next = parseTargetProducts(sanitizedTarget);
    setSelectedCategories(next.categories);
    setSelectedProducts(next.products);

    if (String(formData.targetProducts ?? "").trim() !== sanitizedTarget) {
      setFormData({
        ...formData,
        targetProducts: sanitizedTarget,
      });
    }
  }, [formData.targetProducts, categoryOptions, productOptions]);

  const filteredProductOptions = useMemo(() => {
    if (!selectedCategories.length) return productOptions;
    return productOptions.filter((p) => selectedCategories.includes(p.category));
  }, [productOptions, selectedCategories]);
  const searchedProductOptions = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return filteredProductOptions;
    return filteredProductOptions.filter((p) =>
      `${p.name} ${p.category} ${p.stock}`.toLowerCase().includes(q),
    );
  }, [filteredProductOptions, productSearch]);
  const targetProductsValue = String(formData.targetProducts ?? '').trim();
  const isAllProductsSelected = targetProductsValue.toLowerCase() === 'all products';

  const syncTargetProducts = (categories: string[], products: string[]) => {
    setFormData({
      ...formData,
      targetProducts: formatTargetProducts(categories, products),
    });
  };

  const addCategory = (value: string) => {
    if (!value || selectedCategories.includes(value)) return;
    const nextCategories = [...selectedCategories, value];
    setSelectedCategories(nextCategories);
    // Reset product picks when category scope changes to avoid stale cross-category selections.
    setSelectedProducts([]);
    syncTargetProducts(nextCategories, []);
  };

  const removeCategory = (value: string) => {
    const nextCategories = selectedCategories.filter((c) => c !== value);
    setSelectedCategories(nextCategories);
    // Reset product picks when category scope changes to avoid stale cross-category selections.
    setSelectedProducts([]);
    syncTargetProducts(nextCategories, []);
  };

  const addProduct = (value: string) => {
    const normalizedValue = String(value ?? '').trim().toLowerCase();
    if (!normalizedValue) return;
    if (selectedProducts.some((p) => String(p).trim().toLowerCase() === normalizedValue)) {
      toast.info('Product is already selected.');
      return;
    }
    const nextProducts = [...selectedProducts, value];
    setSelectedProducts(nextProducts);
    syncTargetProducts(selectedCategories, nextProducts);
    setProductSearch('');
    setIsProductPickerOpen(false);
    toast.success(`Added ${value} to target products.`);
  };

  const removeProduct = (value: string) => {
    const nextProducts = selectedProducts.filter((p) => p !== value);
    setSelectedProducts(nextProducts);
    syncTargetProducts(selectedCategories, nextProducts);
  };

  // Quick promotion lengths: end = start + N days (start defaults to now).
  const durationPresets = [
    { label: '1 day', days: 1 },
    { label: '3 days', days: 3 },
    { label: '1 week', days: 7 },
    { label: '2 weeks', days: 14 },
    { label: '1 month', days: 30 },
  ];
  const applyDuration = (days: number) => {
    const startValue = normalizePromotionDateTime(formData.start_date, 'start') || toLocalDateTimeInput();
    const startMs = promotionTimeMs(startValue, 'start');
    setFormData({ ...formData, start_date: startValue, end_date: toLocalDateTimeInput(new Date(startMs + days * 86400000)) });
  };
  const startMs = promotionTimeMs(formData.start_date, 'start');
  const endMs = promotionTimeMs(formData.end_date, 'end');
  const hasWindow = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs;
  const durationDays = hasWindow ? Math.max(1, Math.round((endMs - startMs) / 86400000)) : 0;
  const formatWhen = (ms: number) =>
    new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const typeOptions: Array<{ value: Promotion['discount_type']; title: string; hint: string; icon: typeof Percent }> = [
    { value: 'Percentage', title: 'Percent off', hint: 'e.g. 15% off each pair', icon: Percent },
    { value: 'Fixed Amount', title: 'Peso amount off', hint: 'e.g. ₱500 off each pair', icon: Coins },
    { value: 'BOGO', title: 'Buy 1 Get 1', hint: 'Every 2nd pair is free', icon: Copy },
    { value: 'Bundle', title: 'Bundle deal', hint: '% off when 2+ listed items are bought together', icon: ShoppingCart },
  ];
  const selectedType = (formData.discount_type || 'Percentage') as Promotion['discount_type'];
  const discountValue = Number(formData.discount_value || 0);
  const offerSummary = isBogoType
    ? 'Buy 1 Get 1 (2nd pair free)'
    : !discountValue
      ? 'No discount value yet'
      : isFixedAmountType
        ? `₱${discountValue.toLocaleString()} off each item`
        : isBundleType
          ? `${discountValue >= 5 ? discountValue : 10}% off each bundled item`
          : `${discountValue}% off`;
  const scopeSummary = isAllProductsSelected || !targetProductsValue ? 'All products' : targetProductsValue;
  // The switch keeps its own state: an empty "specific" target is normalised back
  // to "All Products" by the clean-up effect above, so it cannot drive the toggle.
  const [scopeMode, setScopeMode] = useState<'all' | 'specific'>(isAllProductsSelected || !targetProductsValue ? 'all' : 'specific');

  const sectionTitle = (step: number, title: string, hint?: string) => (
    <div className="mb-3 flex items-baseline gap-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-[11px] font-bold text-black">{step}</span>
      <p className="text-sm font-semibold text-white">{title}</p>
      {hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
  const fieldClass = 'bg-[#1D1D26] border-[#313342] text-white placeholder:text-zinc-500 focus-visible:ring-yellow-400/40';

  return (
    <div className="space-y-6 py-1">
      {/* 1. Name */}
      <section>
        {sectionTitle(1, 'Promotion name')}
        <Input
          id="promo_name"
          value={formData.promo_name || ''}
          onChange={(e) => setFormData({ ...formData, promo_name: e.target.value })}
          className={fieldClass}
          placeholder="e.g., Ber Months Sale"
        />
      </section>

      {/* 2. Offer */}
      <section>
        {sectionTitle(2, 'Offer', 'What the customer gets')}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {typeOptions.map((option) => {
            const active = selectedType === option.value;
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  setFormData({
                    ...formData,
                    discount_type: option.value,
                    discount_value: option.value === 'BOGO' ? 0 : formData.discount_value,
                  })
                }
                className={`rounded-xl border p-3 text-left transition ${
                  active ? 'border-yellow-400 bg-yellow-400/10' : 'border-[#313342] bg-[#1A1A23] hover:border-yellow-400/50'
                }`}
                aria-pressed={active}
              >
                <Icon className={`mb-1.5 h-4 w-4 ${active ? 'text-yellow-300' : 'text-zinc-400'}`} />
                <p className={`text-sm font-semibold ${active ? 'text-yellow-200' : 'text-white'}`}>{option.title}</p>
                <p className="mt-0.5 text-[11px] leading-snug text-zinc-400">{option.hint}</p>
              </button>
            );
          })}
        </div>
        {isBogoType ? (
          <p className="mt-3 rounded-lg border border-[#313342] bg-[#1A1A23] px-3 py-2 text-xs text-zinc-300">
            The customer pays for 1 of every 2 pairs of the same model — a 50% effective discount. No value needed.
          </p>
        ) : (
          <div className="mt-3 max-w-xs space-y-1.5">
            <Label htmlFor="discount_value" className="text-xs text-zinc-400">
              {isFixedAmountType ? 'Amount off each item' : isBundleType ? 'Percent off each bundled item' : 'Percent off'}
            </Label>
            <div className="relative">
              {isFixedAmountType ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">₱</span> : null}
              <Input
                id="discount_value"
                type="number"
                min={0}
                max={isFixedAmountType ? undefined : 100}
                value={formData.discount_value || ''}
                onChange={(e) => setFormData({ ...formData, discount_value: parseFloat(e.target.value) })}
                className={`${fieldClass} ${isFixedAmountType ? 'pl-7' : 'pr-8'}`}
                placeholder={isFixedAmountType ? '500' : '15'}
              />
              {!isFixedAmountType ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">%</span> : null}
            </div>
            {isBundleType ? <p className="text-[11px] text-zinc-500">Values below 5 are applied as 10%.</p> : null}
          </div>
        )}
      </section>

      {/* 3. Products */}
      <section>
        {sectionTitle(3, 'Products', 'Which shoes it applies to')}
        <div className="inline-flex rounded-lg border border-[#313342] bg-[#1A1A23] p-0.5">
          {[
            { id: 'all', label: 'All products' },
            { id: 'specific', label: 'Specific categories / products' },
          ].map((choice) => {
            const active = scopeMode === choice.id;
            return (
              <button
                key={choice.id}
                type="button"
                onClick={() => {
                  setScopeMode(choice.id as 'all' | 'specific');
                  if (choice.id === 'all') {
                    setSelectedCategories([]);
                    setSelectedProducts([]);
                    setFormData({ ...formData, targetProducts: 'All Products' });
                  }
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  active ? 'bg-yellow-400 text-black' : 'text-zinc-300 hover:text-yellow-200'
                }`}
              >
                {choice.label}
              </button>
            );
          })}
        </div>

        {scopeMode === 'specific' ? (
          <div className="mt-3 grid grid-cols-1 gap-4 rounded-xl border border-[#313342] bg-[#161622] p-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs text-zinc-400">Categories</Label>
              <Select value={pendingCategory} onValueChange={(value) => {
                addCategory(value);
                setPendingCategory('');
              }}>
                <SelectTrigger className="bg-[#1D1D26] border-[#313342] text-white">
                  <SelectValue placeholder="Add a category" />
                </SelectTrigger>
                <SelectContent className="bg-[#181822] border-[#313342] text-white">
                  {categoryOptions.map((category) => (
                    <SelectItem key={category} value={category}>{category}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex min-h-6 flex-wrap gap-1.5">
                {selectedCategories.map((category) => (
                  <Badge key={category} className="gap-1 bg-yellow-400 pr-1 font-semibold text-black">
                    {category}
                    <button type="button" className="ml-1" onClick={() => removeCategory(category)} aria-label={`Remove ${category}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs text-zinc-400">Products {selectedCategories.length ? '(within the chosen categories)' : ''}</Label>
              <Dialog open={isProductPickerOpen} onOpenChange={setIsProductPickerOpen}>
                <DialogTrigger asChild>
                  <Button type="button" className="w-full justify-start border border-[#313342] bg-[#1D1D26] text-white hover:bg-[#252530]">
                    <Plus className="mr-2 h-4 w-4 text-yellow-400" />
                    Add a product
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-[#15161d] border-[#2a2c36] text-yellow-100 sm:max-w-2xl max-h-[85vh] overflow-hidden p-0">
                  <DialogHeader className="border-b border-white/10 px-5 py-4">
                    <DialogTitle className="text-white">Select Sellable Products</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 p-5">
                    <Input
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      className="bg-[#1D1D26] border-[#313342] text-white placeholder:text-zinc-500"
                      placeholder="Search by product or category..."
                    />
                    <div className="max-h-[48vh] overflow-y-auto rounded-lg border border-[#313342] bg-[#12121A]">
                      <Table className="w-full text-sm">
                        <TableHeader>
                          <TableRow className="bg-[#181824] hover:bg-[#181824] border-[#313342]">
                            <TableHead className="text-yellow-300 text-center">Product</TableHead>
                            <TableHead className="text-yellow-300 text-center">Category</TableHead>
                            <TableHead className="text-yellow-300 text-center">Stock</TableHead>
                            <TableHead className="text-yellow-300 text-center">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {searchedProductOptions.map((product) => (
                            <TableRow key={`${product.name}-${product.category}`} className="border-[#313342] hover:bg-white/[0.02]">
                              <TableCell className="text-white text-center font-medium">{product.name}</TableCell>
                              <TableCell className="text-zinc-400 text-center">{product.category || 'Uncategorized'}</TableCell>
                              <TableCell className="text-yellow-300 text-center font-semibold">{product.stock}</TableCell>
                              <TableCell className="text-center">
                                <Button
                                  type="button"
                                  size="sm"
                                  className="bg-yellow-400 text-black hover:bg-yellow-300 font-bold"
                                  onClick={() => addProduct(product.name)}
                                >
                                  Add
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <div className="flex min-h-6 flex-wrap gap-1.5">
                {selectedProducts.map((product) => (
                  <Badge key={product} className="gap-1 border border-zinc-700 bg-[#2B2B38] pr-1 font-semibold text-yellow-300">
                    {product}
                    <button type="button" className="ml-1" onClick={() => removeProduct(product)} aria-label={`Remove ${product}`}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </div>
            {!selectedCategories.length && !selectedProducts.length ? (
              <p className="text-xs text-amber-300/90 md:col-span-2">Add at least one category or product, or switch back to All products.</p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 4. Schedule */}
      <section>
        {sectionTitle(4, 'Schedule', 'Starts and ends automatically')}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="start_date" className="text-xs text-zinc-400">Starts</Label>
            <Input
              id="start_date"
              type="datetime-local"
              style={{ colorScheme: 'dark' }}
              min={minPromotionDate}
              value={normalizePromotionDateTime(formData.start_date, 'start')}
              onChange={(e) => {
                const nextStartDate = e.target.value;
                setFormData({
                  ...formData,
                  start_date: nextStartDate,
                  end_date:
                    formData.end_date && promotionTimeMs(formData.end_date, 'end') < promotionTimeMs(nextStartDate, 'start')
                      ? nextStartDate
                      : formData.end_date,
                });
              }}
              className={fieldClass}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="end_date" className="text-xs text-zinc-400">Ends</Label>
            <Input
              id="end_date"
              type="datetime-local"
              style={{ colorScheme: 'dark' }}
              min={normalizePromotionDateTime(formData.start_date, 'start') || minPromotionDate}
              value={normalizePromotionDateTime(formData.end_date, 'end')}
              onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
              className={fieldClass}
            />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-zinc-500">Quick length:</span>
          {durationPresets.map((preset) => (
            <button
              key={preset.days}
              type="button"
              onClick={() => applyDuration(preset.days)}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                durationDays === preset.days
                  ? 'border-yellow-400 bg-yellow-400/10 text-yellow-200'
                  : 'border-[#313342] text-zinc-300 hover:border-yellow-400/50'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </section>

      {/* 5. Goal */}
      <section>
        {sectionTitle(5, 'Target sales goal', 'Used to measure how well it performed')}
        <div className="relative max-w-xs">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-400">₱</span>
          <Input
            id="targetSalesGoal"
            type="number"
            min={0}
            value={formData.targetSalesGoal || ''}
            onChange={(e) => setFormData({ ...formData, targetSalesGoal: e.target.value ? Number(e.target.value) : undefined })}
            className={`${fieldClass} pl-7`}
            placeholder="10000"
          />
        </div>
      </section>

      {/* Summary */}
      <div className="rounded-xl border border-yellow-400/40 bg-yellow-400/[0.06] p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-yellow-300">Summary</p>
        <dl className="grid grid-cols-[90px_1fr] gap-y-1 text-sm">
          <dt className="text-zinc-400">Offer</dt>
          <dd className="font-medium text-white">{offerSummary}</dd>
          <dt className="text-zinc-400">Applies to</dt>
          <dd className="break-words font-medium text-white">{scopeSummary || '—'}</dd>
          <dt className="text-zinc-400">Runs</dt>
          <dd className="font-medium text-white">
            {hasWindow ? `${formatWhen(startMs)} – ${formatWhen(endMs)} (${durationDays} day${durationDays === 1 ? '' : 's'})` : 'Choose start and end'}
          </dd>
          <dt className="text-zinc-400">Goal</dt>
          <dd className="font-medium text-white">{formData.targetSalesGoal ? `₱${Number(formData.targetSalesGoal).toLocaleString()}` : '—'}</dd>
        </dl>
      </div>
    </div>
  );
}
