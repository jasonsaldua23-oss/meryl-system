import { useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Checkbox } from "./ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Coins, CreditCard, KeyRound, Minus, Package, Plus, Receipt, Search, ShieldAlert, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { useCustomers, useInventory, useProducts, usePromotions } from "../../lib/hooks";
import { getRoleGroup, useAuth } from "../../lib/auth-context";
import { logAuditEvent } from "../../lib/api/audit-logger";
import { supabase } from "../../lib/supabase";
import { cleanProductImageUrl } from "../../lib/image-utils";
import merylLogoBw from "../../assets/Meryl_Logo_BW.svg";

type CartItem = {
  id: string;
  product_id: string;
  productName: string;
  brand: string;
  color: string;
  size: string;
  price: number;
  quantity: number;
  quantityInput?: string;
  discount: number;
  discountInput?: string;
  promotionType?: string;
  promo_id?: string | null;
  image_url?: string;
};

type ProductVariant = {
  product_id: string;
  product_name: string;
  brand: string;
  category: string;
  color: string;
  gender: string;
  size: string;
  price: number;
  stock_quantity: number;
  on_hand_stock: number;
  reserved_quantity: number;
  expiration_date: string;
  status: string;
  image_url?: string;
};

type ProductGroup = {
  key: string;
  product_name: string;
  color: string;
  variants: ProductVariant[];
};

type ActivePromotionRule = {
  promoKey: string;
  discountType: string;
  discountValue: number;
  appliesToAll: boolean;
  categories: string[];
  products: string[];
  startDate: string;
  endDate: string;
};

function productVariantLabel(product: Pick<ProductVariant, "color" | "gender" | "size">) {
  return [product.color, product.gender, product.size ? `Size ${product.size}` : ""]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && value.toLowerCase() !== "n/a" && value.toLowerCase() !== "default")
    .join(" / ") || "Default";
}

function getColorSwatch(colorName?: string): string {
  if (!colorName) return "#6b7280";
  const c = colorName.toLowerCase().trim();
  if (c.includes("black")) return "#18181b";
  if (c.includes("white")) return "#f4f4f5";
  if (c.includes("red") || c.includes("crimson") || c.includes("scarlet")) return "#ef4444";
  if (c.includes("green") || c.includes("olive") || c.includes("lime") || c.includes("grinch")) return "#22c55e";
  if (c.includes("blue") || c.includes("navy") || c.includes("royal")) return "#3b82f6";
  if (c.includes("yellow") || c.includes("gold")) return "#eab308";
  if (c.includes("orange")) return "#f97316";
  if (c.includes("purple") || c.includes("violet")) return "#a855f7";
  if (c.includes("pink") || c.includes("rose")) return "#ec4899";
  if (c.includes("gray") || c.includes("grey") || c.includes("silver")) return "#9ca3af";
  if (c.includes("brown") || c.includes("tan") || c.includes("beige")) return "#92400e";
  return c;
}

const SHOE_SIZE_CONVERSIONS: Record<string, { usMen: string; usWomen: string }> = {
  "35": { usMen: "3.5", usWomen: "5" },
  "36": { usMen: "4.5", usWomen: "6" },
  "37": { usMen: "5", usWomen: "6.5" },
  "38": { usMen: "5.5", usWomen: "7" },
  "39": { usMen: "6.5", usWomen: "8" },
  "40": { usMen: "7", usWomen: "8.5" },
  "41": { usMen: "8", usWomen: "9.5" },
  "42": { usMen: "8.5", usWomen: "10" },
  "43": { usMen: "9.5", usWomen: "11" },
  "44": { usMen: "10", usWomen: "11.5" },
  "45": { usMen: "11", usWomen: "12.5" },
  "46": { usMen: "12", usWomen: "13.5" },
  "47": { usMen: "13", usWomen: "14.5" },
  "48": { usMen: "14", usWomen: "15.5" },
};

function getShoeSizeConversion(euSize: string, gender?: string): string {
  const cleanSize = String(euSize ?? "").replace(/^EU\s*/i, "").trim();
  const conversion = SHOE_SIZE_CONVERSIONS[cleanSize];
  if (!conversion) return "";

  const g = (gender || "").trim().toLowerCase();
  if (g === "men" || g === "mens" || g === "man") {
    return `US M ${conversion.usMen}`;
  }
  if (g === "women" || g === "womens" || g === "woman") {
    return `US W ${conversion.usWomen}`;
  }
  return `M ${conversion.usMen} / W ${conversion.usWomen}`;
}

function isExpiredInventoryDate(value?: string | null) {
  const date = String(value ?? "").slice(0, 10);
  if (!date) return false;
  return date < new Date().toISOString().slice(0, 10);
}

function isSellableProduct(product: ProductVariant) {
  return (
    product.status.toLowerCase() === "active" &&
    Number(product.stock_quantity || 0) > 0 &&
    !isExpiredInventoryDate(product.expiration_date)
  );
}

function ProductPhotoPlaceholder({ productName, imageUrl }: { productName: string; imageUrl?: string }) {
  const [loadFailed, setLoadFailed] = useState(false);
  const initial = String(productName || "P").trim().charAt(0).toUpperCase() || "P";
  const cleanUrl = cleanProductImageUrl(imageUrl);

  if (cleanUrl && !loadFailed) {
    return (
      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#2e2e42] bg-[#1a1a27] shadow-inner">
        <img
          src={cleanUrl}
          alt={productName}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setLoadFailed(true)}
        />
      </div>
    );
  }

  return (
    <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-yellow-400/20 bg-[#1e1e2c] text-yellow-200 shadow-inner">
      <Package className="h-5 w-5 text-yellow-300/60" />
      <span className="absolute bottom-0 right-0 flex h-4 w-4 items-center justify-center rounded-tl-md bg-yellow-400 text-[9px] font-bold text-red-950">
        {initial}
      </span>
    </div>
  );
}

const PROMO_TYPE_MARKERS = {
  bundle: "__TYPE_BUNDLE__",
  bogo: "__TYPE_BOGO__",
} as const;

const BOGO_MAX_PAIRS_PER_TRANSACTION = 4;

function parsePromotionTarget(rawValue: string | null | undefined) {
  const raw = String(rawValue ?? "").trim();
  if (!raw || raw.toLowerCase() === "all products") {
    return { appliesToAll: true, categories: [] as string[], products: [] as string[] };
  }

  const categories: string[] = [];
  const products: string[] = [];
  raw.split("|").forEach((segment) => {
    const value = segment.trim();
    if (!value) return;
    if (value.toLowerCase().startsWith("categories:")) {
      value
        .slice("categories:".length)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .forEach((v) => categories.push(v.toLowerCase()));
      return;
    }
    if (value.toLowerCase().startsWith("products:")) {
      value
        .slice("products:".length)
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .forEach((v) => products.push(v.toLowerCase()));
      return;
    }
    products.push(value.toLowerCase());
  });

  return {
    appliesToAll: false,
    categories: Array.from(new Set(categories)),
    products: Array.from(new Set(products)),
  };
}

function derivePromotionTargetFromLinks(row: any) {
  const links = Array.isArray(row?.promo_product) ? row.promo_product : [];
  if (!links.length) return "";

  const categories = new Set<string>();
  const products = new Set<string>();
  links.forEach((link: any) => {
    const product = Array.isArray(link?.product) ? link.product[0] : link?.product;
    const productName = String(product?.product_name ?? "").trim();
    const categoryName = String(product?.category?.[0]?.category_name ?? product?.category?.category_name ?? "").trim();
    if (productName) products.add(productName);
    if (categoryName) categories.add(categoryName);
  });

  if (!categories.size && !products.size) return "";
  if (!categories.size) return `Products: ${Array.from(products).join(", ")}`;
  if (!products.size) return `Categories: ${Array.from(categories).join(", ")}`;
  return `Categories: ${Array.from(categories).join(", ")} | Products: ${Array.from(products).join(", ")}`;
}

function resolveEffectiveDiscountType(discountType: string, promoName: string | undefined) {
  const loweredType = String(discountType ?? "").toLowerCase();
  const loweredName = String(promoName ?? "").toLowerCase();
  if (loweredName.includes(PROMO_TYPE_MARKERS.bogo.toLowerCase())) return "bogo";
  if (loweredName.includes(PROMO_TYPE_MARKERS.bundle.toLowerCase())) return "bundle";
  if (loweredType.includes("buy one get one") || loweredType.includes("bogo")) return "bogo";
  if (loweredType.includes("bundle")) return "bundle";
  if (loweredType.includes("fixed")) return "fixed";
  if (loweredType.includes("percent")) return "percentage";
  return loweredType;
}

function promoToPercent(discountType: string, discountValue: number, unitPrice: number) {
  const type = discountType.toLowerCase();
  if (type.includes("percentage")) return Math.max(0, Math.min(100, discountValue));
  if (type.includes("fixed")) {
    if (unitPrice <= 0) return 0;
    return Math.max(0, Math.min(100, (discountValue / unitPrice) * 100));
  }
  if (type.includes("bogo")) return 50;
  // Bundle defaults to a meaningful discount if source value is too small (e.g. analytics seed = 1).
  if (type.includes("bundle")) return Math.max(0, Math.min(100, discountValue >= 5 ? discountValue : 10));
  return 0;
}

function getPromotionTypePriority(discountType: string) {
  const type = String(discountType ?? "").toLowerCase();
  if (type.includes("bogo")) return 4;
  if (type.includes("bundle")) return 3;
  if (type.includes("fixed")) return 2;
  if (type.includes("percentage")) return 1;
  return 0;
}

function getPromoBadgeLabel(type?: string) {
  const value = String(type ?? "").toLowerCase();
  if (value.includes("bogo")) return "BOGO";
  if (value.includes("bundle")) return "BUNDLE";
  if (value.includes("fixed")) return "FIXED";
  if (value.includes("percent")) return "PERCENT";
  return "AUTO";
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(Number(value || 0))
    .replace(/^₱/, "PHP ");
}

const VAT_RATE = 0.12;

function getVatBreakdown(total: number) {
  const grossTotal = Math.max(0, Number(total) || 0);
  const vatAmount = grossTotal * (VAT_RATE / (1 + VAT_RATE));
  return {
    vatableSales: grossTotal - vatAmount,
    vatAmount,
    vatExemptSales: 0,
    zeroRatedSales: 0,
  };
}

function isBogoCartItem(item: Pick<CartItem, "promotionType">) {
  return String(item.promotionType ?? "").toLowerCase().includes("bogo");
}

function getBogoFreeUnits(quantity: number) {
  return Math.floor(Math.max(0, Number(quantity) || 0) / 2);
}

function getLineDiscountAmount(item: CartItem) {
  const baseSubtotal = item.price * item.quantity;
  if (isBogoCartItem(item)) {
    return Math.min(baseSubtotal, getBogoFreeUnits(item.quantity) * item.price);
  }
  return baseSubtotal * (Math.max(0, Math.min(100, Number(item.discount) || 0)) / 100);
}

function getLineTotal(item: CartItem) {
  return Math.max(0, item.price * item.quantity - getLineDiscountAmount(item));
}

function getLineEffectiveDiscountPercent(item: CartItem) {
  const baseSubtotal = item.price * item.quantity;
  if (baseSubtotal <= 0) return 0;
  return (getLineDiscountAmount(item) / baseSubtotal) * 100;
}

function formatPercentValue(value: number) {
  const clean = Math.max(0, Math.min(100, Number(value) || 0));
  return Number.isInteger(clean) ? String(clean) : clean.toFixed(2).replace(/\.?0+$/, "");
}

export function PointOfSale() {
  const queryClient = useQueryClient();
  const { user, validateCredentials } = useAuth();
  const productsQuery = useProducts();
  const inventoryQuery = useInventory();
  const customersQuery = useCustomers();
  const promotionsQuery = usePromotions();

  // Manager Override & Security State
  const [managerOverrideOpen, setManagerOverrideOpen] = useState(false);
  const [managerUsername, setManagerUsername] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [managerVerifying, setManagerVerifying] = useState(false);
  const [pendingAction, setPendingAction] = useState<{
    description: string;
    action: () => void;
  } | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedProductKey, setSelectedProductKey] = useState<string>("");
  const [selectedColor, setSelectedColor] = useState<string>("");
  const [selectedSize, setSelectedSize] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("1");
  const [customerName, setCustomerName] = useState<string>("walk-in");
  const [saveWalkInDetails, setSaveWalkInDetails] = useState(false);
  const [walkInCustomerName, setWalkInCustomerName] = useState("");
  const [walkInCustomerPhone, setWalkInCustomerPhone] = useState("");
  const [walkInGender, setWalkInGender] = useState("");
  const [walkInAge, setWalkInAge] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<string>("Cash");
  const [cashReceived, setCashReceived] = useState<string>("");
  const [gcashRefNumber, setGcashRefNumber] = useState<string>("");
  const [receiptData, setReceiptData] = useState<any>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [isProductGridOpen, setIsProductGridOpen] = useState(false);
  const [isCustomerGridOpen, setIsCustomerGridOpen] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [modalCategoryFilter, setModalCategoryFilter] = useState("All");
  const [customerSearch, setCustomerSearch] = useState("");

  const customers = (customersQuery.data as any[]) ?? [];
  const customerOptions = useMemo(
    () => [
      { label: "Walk-in Customer", value: "walk-in", customer_id: null, email: "", contact_number: "", date_registered: "" },
      ...customers.map((c) => ({
        label: c.name,
        value: c.name,
        customer_id: c.customer_id,
        email: c.email ?? "",
        contact_number: c.contact_number ?? "",
        date_registered: c.date_registered ?? "",
      })),
    ],
    [customers],
  );

  const productInventory = useMemo(() => {
    const rows = (productsQuery.data as any[]) ?? [];
    const inventoryRows = (inventoryQuery.data as any[]) ?? [];
    const inventoryByProductId = new Map<string, any>();
    for (const inv of inventoryRows) {
      inventoryByProductId.set(String(inv.product_id ?? ""), inv);
    }
    const variants: ProductVariant[] = [];
    for (const row of rows) {
      const inventory = Array.isArray(row.inventory)
        ? row.inventory[0]
        : row.inventory ?? inventoryByProductId.get(String(row.product_id ?? ""));
      const onHandStock = Number(inventory?.stock_quantity ?? 0);
      const reservedQuantity = Number(inventory?.reserved_quantity ?? inventory?.held_stock ?? 0);
      const availableStock = Math.max(0, onHandStock - reservedQuantity);
      const expirationDate = inventory?.expiration_date ? String(inventory.expiration_date).slice(0, 10) : null;
      const status = String(row.status ?? "active").toLowerCase();
      const expired = Boolean(expirationDate && new Date(expirationDate).getTime() < Date.now());

      variants.push({
        product_id: row.product_id,
        product_name: row.product_name ?? "Unnamed Product",
        brand: row.brand ?? "N/A",
        category: row.category?.[0]?.category_name ?? row.category?.category_name ?? "N/A",
        color: row.color ?? "N/A",
        gender: row.gender ?? "N/A",
        size: row.size ?? "N/A",
        price: Number(inventory?.srp ?? row.cost_price ?? 0),
        stock_quantity: availableStock,
        on_hand_stock: onHandStock,
        reserved_quantity: reservedQuantity,
        expiration_date: expirationDate ?? "",
        status: expired ? "Expired" : status === "active" || status === "available" ? "Active" : "Inactive",
        image_url: row.image_url ?? row.image ?? "",
      });
    }
    return variants;
  }, [productsQuery.data, inventoryQuery.data]);

  const sellableProductInventory = useMemo(
    () => productInventory.filter(isSellableProduct),
    [productInventory],
  );

  const distinctCategories = useMemo(() => {
    const set = new Set<string>();
    sellableProductInventory.forEach((p) => {
      if (p.category && p.category !== "N/A") set.add(p.category);
    });
    return ["All", ...Array.from(set)];
  }, [sellableProductInventory]);

  const isSearchActive = productSearch.trim().length > 0 || modalCategoryFilter !== "All";

  type SearchShoeModel = {
    key: string;
    product_name: string;
    color: string;
    brand: string;
    category: string;
    gender: string;
    image_url?: string;
    price: number;
    total_stock: number;
    sizes: string[];
    variants: ProductVariant[];
  };

  const sellableShoeModels = useMemo<SearchShoeModel[]>(() => {
    const map = new Map<string, SearchShoeModel>();
    for (const v of sellableProductInventory) {
      const colorVal = (v.color && v.color !== "N/A" && v.color !== "Default") ? v.color.trim() : "Standard";
      const genderVal = (v.gender && v.gender !== "N/A" && v.gender !== "Default") ? v.gender.trim() : "";
      // Separate each color variant into its own row so sizes stay within that colorway
      const key = `${v.product_name}:::${colorVal}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          product_name: v.product_name,
          color: colorVal,
          brand: v.brand,
          category: v.category,
          gender: genderVal,
          image_url: v.image_url,
          price: v.price,
          total_stock: 0,
          sizes: [],
          variants: [],
        });
      }
      const item = map.get(key)!;
      if (!item.gender && genderVal) {
        item.gender = genderVal;
      }
      item.total_stock += Number(v.stock_quantity || 0);
      // Prefer variant image if available
      if (v.image_url && (!item.image_url || item.image_url === "")) {
        item.image_url = v.image_url;
      }
      if (v.price && (!item.price || item.price <= 0)) item.price = v.price;
      if (v.size && v.size !== "N/A" && v.size !== "Default" && !item.sizes.includes(v.size)) {
        item.sizes.push(v.size);
      }
      item.variants.push(v);
    }

    // Sort sizes naturally / numerically within each colorway
    for (const item of map.values()) {
      item.sizes.sort((a, b) => {
        const numA = parseFloat(a);
        const numB = parseFloat(b);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return a.localeCompare(b);
      });
    }

    return Array.from(map.values());
  }, [sellableProductInventory]);

  const filteredShoeModels = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    let source = sellableShoeModels;
    if (modalCategoryFilter !== "All") {
      source = source.filter((m) => String(m.category || "").toLowerCase() === modalCategoryFilter.toLowerCase());
    }
    if (!term && modalCategoryFilter === "All") return [];
    if (!term) return source;
    return source.filter((m) => {
      const usSizes = m.sizes.map((s) => getShoeSizeConversion(s, m.gender)).join(" ");
      return [
        m.product_name,
        m.color !== "Standard" ? m.color : "",
        m.brand,
        m.category,
        m.gender,
        m.sizes.join(" "),
        usSizes,
        String(m.price),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [sellableShoeModels, productSearch, modalCategoryFilter]);

  const filteredProductInventory = useMemo(() => {
    const term = productSearch.trim().toLowerCase();
    let sourceProducts = sellableProductInventory;
    if (modalCategoryFilter !== "All") {
      sourceProducts = sourceProducts.filter((p) => String(p.category || "").toLowerCase() === modalCategoryFilter.toLowerCase());
    }
    if (!term && modalCategoryFilter === "All") return [];
    if (!term) return sourceProducts;
    return sourceProducts.filter((product) =>
      [
        product.product_id,
        product.product_name,
        product.brand,
        product.category,
        product.color,
        product.gender,
        product.size,
        productVariantLabel(product),
        String(product.price),
        String(product.stock_quantity),
        String(product.on_hand_stock),
        String(product.reserved_quantity),
        product.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [sellableProductInventory, productSearch, modalCategoryFilter]);

  const filteredCustomerOptions = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return customerOptions;
    return customerOptions.filter((customer: any) =>
      [
        customer.customer_id ?? "walk-in",
        customer.label,
        customer.email ?? "",
        customer.contact_number ?? "",
        customer.date_registered ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [customerOptions, customerSearch]);

  const selectCustomer = (customer: any) => {
    setCustomerName(customer.value);
    if (customer.value !== "walk-in") {
      setSaveWalkInDetails(false);
    }
    setIsCustomerGridOpen(false);
    toast.success(`${customer.label} selected`);
  };

  const productMetaById = useMemo(() => {
    const rows = (productsQuery.data as any[]) ?? [];
    const map = new Map<string, { productName: string; categoryName: string }>();
    rows.forEach((row) => {
      map.set(String(row.product_id), {
        productName: String(row.product_name ?? "").trim(),
        categoryName: String(row.category?.[0]?.category_name ?? row.category?.category_name ?? "").trim(),
      });
    });
    return map;
  }, [productsQuery.data]);

  const activePromotionRules = useMemo<ActivePromotionRule[]>(() => {
    const rows = (promotionsQuery.data as any[]) ?? [];
    const today = new Date().toISOString().slice(0, 10);
    return rows
      .map((row) => {
        const status = String(row.status ?? "").toLowerCase();
        if (status === "inactive" || status === "deactivated") return null;
        const startDate = String(row.start_date ?? "").slice(0, 10);
        const endDate = String(row.end_date ?? "").slice(0, 10);
        const withinWindow = (!startDate || startDate <= today) && (!endDate || endDate >= today);
        const isEffectivelyActive = status.includes("active") || withinWindow;
        const isExpired = status.includes("expired") || (Boolean(endDate) && endDate < today);
        if (!isEffectivelyActive || isExpired) return null;

        const parsedTarget = parsePromotionTarget(
          row.target_products ??
            row.targetProducts ??
            derivePromotionTargetFromLinks(row),
        );
        return {
          promoKey: String(row.promo_id ?? row.id ?? row.promo_name ?? `${startDate}-${endDate}-${Math.random()}`),
          discountType: resolveEffectiveDiscountType(
            String(row.discount_type ?? "percentage"),
            String(row.promo_name ?? ""),
          ),
          discountValue: Number(row.discount_value ?? 0),
          appliesToAll: parsedTarget.appliesToAll,
          categories: parsedTarget.categories,
          products: parsedTarget.products,
          startDate,
          endDate,
        } as ActivePromotionRule;
      })
      .filter(Boolean) as ActivePromotionRule[];
  }, [promotionsQuery.data]);

  const productGroups: ProductGroup[] = useMemo(
    () =>
      sellableProductInventory.reduce((acc, variant) => {
        const key = variant.product_name;
        const existing = acc.find((g) => g.key === key);
        if (existing) existing.variants.push(variant);
        else acc.push({ key, product_name: variant.product_name, color: variant.color, variants: [variant] });
        return acc;
      }, [] as ProductGroup[]),
    [sellableProductInventory],
  );

  const availableColors = selectedProductKey
    ? Array.from(new Set(
        sellableProductInventory
          .filter((v) => v.product_name === selectedProductKey)
          .map((v) => v.color)
      ))
    : [];

  const availableSizes = (selectedProductKey && selectedColor)
    ? sellableProductInventory
        .filter((v) => v.product_name === selectedProductKey && v.color === selectedColor)
        .map((v) => ({ ...v }))
    : [];

  const productMatchesPromotion = (promo: ActivePromotionRule, productNameLower: string, categoryLower: string) => {
    const matchesProduct = promo.products.includes(productNameLower);
    const matchesCategory = categoryLower ? promo.categories.includes(categoryLower) : false;
    return promo.appliesToAll || matchesProduct || matchesCategory;
  };

  const recalculatePromotions = (items: CartItem[]) => {
    const withPromo = items.map((item) => {
      const metaRow = productMetaById.get(String(item.product_id ?? ""));
      const itemNameLc = String(metaRow?.productName ?? item.productName ?? "").toLowerCase();
      const itemCategoryLc = String(metaRow?.categoryName ?? "").toLowerCase();

      const matched = activePromotionRules
        .map((promo) => {
          const matchesProduct = promo.products.includes(itemNameLc);
          const matchesCategory = itemCategoryLc ? promo.categories.includes(itemCategoryLc) : false;
          const applies = productMatchesPromotion(promo, itemNameLc, itemCategoryLc);
          if (!applies) return null;
          const specificityScore = matchesProduct ? 3 : matchesCategory ? 2 : promo.appliesToAll ? 1 : 0;
          return {
            promo,
            specificityScore,
            typePriority: getPromotionTypePriority(promo.discountType),
            effectivePercent: promoToPercent(promo.discountType, promo.discountValue, item.price),
          };
        })
        .filter(Boolean)
        .sort((a: any, b: any) => {
          if (b.specificityScore !== a.specificityScore) return b.specificityScore - a.specificityScore;
          if (b.typePriority !== a.typePriority) return b.typePriority - a.typePriority;
          return b.effectivePercent - a.effectivePercent;
        })?.[0] as any;

      if (!matched?.promo) {
        return { ...item, discount: 0, promotionType: undefined, promo_id: null, _promo: null };
      }

      const type = String(matched.promo.discountType).toLowerCase();
      const isBogo = type.includes("bogo");
      const isBundle = type.includes("bundle");
      const percent = promoToPercent(type, matched.promo.discountValue, item.price);

      return {
        ...item,
        discount: isBundle ? 0 : isBogo ? getLineEffectiveDiscountPercent({ ...item, promotionType: "bogo" }) : percent,
        discountInput: isBundle
          ? "0"
          : isBogo
            ? formatPercentValue(getLineEffectiveDiscountPercent({ ...item, promotionType: "bogo" }))
            : item.discountInput,
        promotionType: isBogo ? "bogo" : isBundle ? "bundle" : (type.includes("fixed") ? "fixed" : type.includes("percentage") ? "percentage" : undefined),
        promo_id: matched.promo.promoKey,
        _promo: matched.promo as ActivePromotionRule,
      };
    });

    const bundlePromoMap = new Map<string, ActivePromotionRule>();
    withPromo.forEach((item: any) => {
      const promo = item._promo as ActivePromotionRule | null;
      if (!promo) return;
      if (String(promo.discountType).toLowerCase().includes("bundle")) {
        bundlePromoMap.set(promo.promoKey, promo);
      }
    });

    bundlePromoMap.forEach((promo) => {
      const matching = withPromo.filter((item: any) => item._promo?.promoKey === promo.promoKey);
      const qualifyingQty = matching.reduce((sum: number, item: CartItem) => sum + Number(item.quantity ?? 0), 0);
      const distinctProducts = new Set(matching.map((item: CartItem) => item.product_id)).size;
      const qualifies = qualifyingQty >= 2 && distinctProducts >= 2;
      if (!qualifies) return;
      const bundlePercent = promoToPercent(promo.discountType, promo.discountValue, 100);
      matching.forEach((target: any) => {
        target.discount = bundlePercent;
        target.discountInput = formatPercentValue(bundlePercent);
        target.promotionType = "bundle";
      });
    });

    return withPromo.map(({ _promo, ...clean }: any) => clean as CartItem);
  };

  const addVariantToCart = (selectedVariant: ProductVariant, requestedQuantity: number) => {
    if (!isSellableProduct(selectedVariant)) {
      toast.error("This product is not sellable. Set it to Active and make sure it has stock first.");
      return false;
    }
    const meta = productMetaById.get(selectedVariant.product_id);
    const productNameLc = String(meta?.productName ?? selectedVariant.product_name).toLowerCase();
    const categoryLc = String(meta?.categoryName ?? "").toLowerCase();
    const matchedPromotion = activePromotionRules
      .map((promo) => {
        const matchesProduct = promo.products.includes(productNameLc);
        const matchesCategory = categoryLc ? promo.categories.includes(categoryLc) : false;
        const applies = productMatchesPromotion(promo, productNameLc, categoryLc);
        if (!applies) return null;

        const specificityScore = matchesProduct ? 3 : matchesCategory ? 2 : promo.appliesToAll ? 1 : 0;
        return {
          promo,
          specificityScore,
          typePriority: getPromotionTypePriority(promo.discountType),
          effectivePercent: promoToPercent(promo.discountType, promo.discountValue, selectedVariant.price),
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => {
        if (b.specificityScore !== a.specificityScore) return b.specificityScore - a.specificityScore;
        if (b.typePriority !== a.typePriority) return b.typePriority - a.typePriority;
        return b.effectivePercent - a.effectivePercent;
      })?.[0]?.promo;
    const promoDiscount = matchedPromotion
      ? promoToPercent(matchedPromotion.discountType, matchedPromotion.discountValue, selectedVariant.price)
      : 0;

    const isBogoApplied = Boolean(matchedPromotion?.discountType.toLowerCase().includes("bogo"));
    const isBundleApplied = Boolean(matchedPromotion?.discountType.toLowerCase().includes("bundle"));
    const quantityToAdd = isBogoApplied ? 2 : requestedQuantity;
    const existingProductQuantity = cart
      .filter((item) => item.product_id === selectedVariant.product_id)
      .reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);
    const existingBogoPairs = cart.filter((item) => item.product_id === selectedVariant.product_id && isBogoCartItem(item)).length;
    const nextProductQuantity = existingProductQuantity + quantityToAdd;
    if (isBogoApplied && existingBogoPairs + 1 > BOGO_MAX_PAIRS_PER_TRANSACTION) {
      toast.error(`BOGO limit is ${BOGO_MAX_PAIRS_PER_TRANSACTION} pairs per product per transaction.`);
      return false;
    }
    if (nextProductQuantity > selectedVariant.stock_quantity) {
      const promoHint = isBogoApplied ? " BOGO consumes 2 units for every paid pair." : "";
      toast.error(`Only ${selectedVariant.stock_quantity} units available in stock.${promoHint}`);
      return false;
    }
    const shouldApplyBundleNow = (() => {
      if (!isBundleApplied || !matchedPromotion) return false;
      let qualifyingQty = requestedQuantity;
      cart.forEach((item) => {
        const metaRow = productMetaById.get(String(item.product_id ?? ""));
        const itemNameLc = String(metaRow?.productName ?? item.productName ?? "").toLowerCase();
        const itemCategoryLc = String(metaRow?.categoryName ?? "").toLowerCase();
        if (productMatchesPromotion(matchedPromotion, itemNameLc, itemCategoryLc)) {
          qualifyingQty += Number(item.quantity ?? 0);
        }
      });
      return qualifyingQty >= 2;
    })();

    const finalDiscount = isBogoApplied
      ? getLineEffectiveDiscountPercent({
          id: selectedVariant.product_id,
          product_id: selectedVariant.product_id,
          productName: selectedVariant.product_name,
          brand: selectedVariant.brand,
          color: selectedVariant.color,
          size: selectedVariant.size,
          price: selectedVariant.price,
          quantity: quantityToAdd,
          discount: 0,
          promotionType: "bogo",
        })
      : isBundleApplied
        ? (shouldApplyBundleNow ? promoDiscount : 0)
        : promoDiscount;

    setCart((prev) => {
      const existingItem = isBogoApplied ? undefined : prev.find((item) => item.id === selectedVariant.product_id);
      const next = existingItem
        ? prev.map((item) =>
            item.id === selectedVariant.product_id
              ? {
                  ...item,
                  quantity: item.quantity + quantityToAdd,
                  discount: isBogoApplied
                    ? getLineEffectiveDiscountPercent({ ...item, quantity: item.quantity + quantityToAdd, promotionType: "bogo" })
                    : finalDiscount,
                  discountInput: isBogoApplied
                    ? formatPercentValue(getLineEffectiveDiscountPercent({ ...item, quantity: item.quantity + quantityToAdd, promotionType: "bogo" }))
                    : item.discountInput,
                  promotionType: isBogoApplied ? "bogo" : isBundleApplied ? "bundle" : item.promotionType,
                  promo_id: matchedPromotion?.promoKey ?? item.promo_id ?? null,
                }
              : item,
          )
        : [
            ...prev,
            {
              id: isBogoApplied
                ? `${selectedVariant.product_id}:bogo:${matchedPromotion?.promoKey ?? "promo"}:${Date.now()}`
                : selectedVariant.product_id,
              product_id: selectedVariant.product_id,
              productName: selectedVariant.product_name,
              brand: selectedVariant.brand,
              color: selectedVariant.color,
              size: selectedVariant.size,
              price: selectedVariant.price,
              quantity: quantityToAdd,
              discount: finalDiscount,
              discountInput: isBogoApplied ? formatPercentValue(finalDiscount) : undefined,
              promotionType: isBogoApplied ? "bogo" : isBundleApplied ? "bundle" : undefined,
              promo_id: matchedPromotion?.promoKey ?? null,
              image_url: selectedVariant.image_url,
            },
          ];
      return recalculatePromotions(next);
    });

    setSelectedProductKey("");
    setSelectedColor("");
    setSelectedSize("");
    setQuantity("1");
    if (isBogoApplied) {
      toast.success("BOGO applied: 2 pairs locked as buy-1-get-1");
    } else if (isBundleApplied && !shouldApplyBundleNow) {
      toast.success("Bundle selected. Add at least 2 qualifying items to activate discount.");
    } else if (isBundleApplied && shouldApplyBundleNow) {
      toast.success("Bundle discount applied.");
    } else if (matchedPromotion) {
      toast.success("Product added with active promotion applied");
    } else {
      toast.success("Product added to cart");
    }
    return true;
  };

  const addToCart = () => {
    if (!selectedProductKey) return toast.error("Please select a product");
    if (!selectedColor) return toast.error("Please select a color");
    if (!selectedSize) return toast.error("Please select a size");

    const selectedVariant = sellableProductInventory.find(
      (v) => v.product_name === selectedProductKey && v.color === selectedColor && v.size === selectedSize,
    );
    if (!selectedVariant) return;

    const requestedQuantity = Math.floor(Number(quantity));
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      toast.error("Please enter a valid quantity");
      return;
    }

    const added = addVariantToCart(selectedVariant, requestedQuantity);
    if (!added) return;

    setSelectedProductKey("");
    setSelectedColor("");
    setSelectedSize("");
    setQuantity("1");
  };

  const selectShoeModel = (model: SearchShoeModel) => {
    setSelectedProductKey(model.product_name);
    const colorToSet = model.color !== "Standard" ? model.color : (model.variants[0]?.color ?? "");
    setSelectedColor(colorToSet);
    setSelectedSize("");
    setQuantity("1");
    setIsProductGridOpen(false);
    setProductSearch("");
    const label = model.color !== "Standard" ? `"${model.product_name} (${model.color})"` : `"${model.product_name}"`;
    toast.success(`Selected ${label}. Pick size on the main POS screen.`);
  };

  const fillProductSelection = (variant: ProductVariant) => {
    setSelectedProductKey(variant.product_name);
    setSelectedColor(variant.color);
    setSelectedSize(variant.size);
    setQuantity("1");
    setIsProductGridOpen(false);
    setProductSearch("");
    toast.success(`Loaded "${variant.product_name}" (${variant.color} - Size ${variant.size}) into selection`);
  };

  const quickAddToCart = (variant: ProductVariant) => {
    const added = addVariantToCart(variant, 1);
    if (!added) return;
    setIsProductGridOpen(false);
    setProductSearch("");
  };

  const requestManagerApproval = (description: string, action: () => void) => {
    // If current logged-in user is an administrator, authorize immediately without prompt
    if (getRoleGroup(user?.role_name) === "admin") {
      action();
      return;
    }
    setPendingAction({ description, action });
    setManagerUsername("");
    setManagerPassword("");
    setManagerOverrideOpen(true);
  };

  const handleManagerAuthorize = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!managerUsername.trim() || !managerPassword.trim()) {
      toast.error("Please enter manager username and password.");
      return;
    }

    setManagerVerifying(true);
    try {
      // Verify against the database without replacing the cashier's session.
      const verifiedUser = await validateCredentials(managerUsername.trim(), managerPassword.trim(), {
        issueSession: false,
      });

      if (!verifiedUser || getRoleGroup(verifiedUser.role_name) !== "admin") {
        toast.error("Authorization failed. Administrator or Manager credentials required.");
        setManagerVerifying(false);
        return;
      }

      // Log override event in audit trail
      logAuditEvent({
        action_type: "POS_MANAGER_OVERRIDE",
        entity_type: "POS",
        metadata: {
          action: pendingAction?.description,
          cashier: user?.username || "Cashier",
          manager: verifiedUser.username,
        },
      });

      // Execute approved action
      pendingAction?.action();
      toast.success(`Action authorized by ${verifiedUser.name}.`);
      setManagerOverrideOpen(false);
      setPendingAction(null);
    } catch (err: any) {
      toast.error(err?.message || "Manager authorization failed.");
    } finally {
      setManagerVerifying(false);
    }
  };

  const removeFromCart = (id: string) =>
    setCart((prev) => {
      const next = prev.filter((item) => item.id !== id);
      return recalculatePromotions(next);
    });

  const handleRemoveFromCart = (id: string) => {
    removeFromCart(id);
    toast.success("Item removed from cart.");
  };

  const updateQuantity = (id: string, newQuantity: number) => {
    const currentItem = cart.find((item) => item.id === id);
    if (currentItem && isBogoCartItem(currentItem)) {
      toast.error("BOGO quantity is locked to 2 pairs. Add another BOGO line for another pair.");
      return;
    }
    const variant = sellableProductInventory.find((row) => row.product_id === currentItem?.product_id);
    const stockMax = Math.max(1, Number(variant?.stock_quantity ?? Number.MAX_SAFE_INTEGER));
    const maxQuantity = stockMax;
    const cleanQuantity = Math.min(maxQuantity, Math.max(1, Math.floor(Number(newQuantity) || 1)));
    if (Math.floor(Number(newQuantity) || 1) > maxQuantity) {
      toast.error(`Only ${maxQuantity} units available in stock`);
    }
    setCart((prev) =>
      recalculatePromotions(
        prev.map((item) => (item.id === id ? { ...item, quantity: cleanQuantity, quantityInput: String(cleanQuantity) } : item)),
      ),
    );
  };

  const updateQuantityInput = (id: string, value: string) => {
    const cleanValue = value.replace(/\D/g, "");
    const currentItem = cart.find((item) => item.id === id);
    if (currentItem && isBogoCartItem(currentItem)) return;
    const variant = sellableProductInventory.find((row) => row.product_id === currentItem?.product_id);
    const stockMax = Math.max(1, Number(variant?.stock_quantity ?? Number.MAX_SAFE_INTEGER));
    const maxQuantity = stockMax;
    setCart((prev) =>
      recalculatePromotions(
        prev.map((item) => {
          if (item.id !== id) return item;
          if (cleanValue === "") return { ...item, quantityInput: "" };
          const cleanQuantity = Math.min(maxQuantity, Math.max(1, Number(cleanValue) || 1));
          return { ...item, quantity: cleanQuantity, quantityInput: String(cleanQuantity) };
        }),
      ),
    );
  };

  const commitQuantityInput = (id: string) => {
    const currentItem = cart.find((item) => item.id === id);
    if (currentItem && isBogoCartItem(currentItem)) return;
    const variant = sellableProductInventory.find((row) => row.product_id === currentItem?.product_id);
    const stockMax = Math.max(1, Number(variant?.stock_quantity ?? Number.MAX_SAFE_INTEGER));
    const maxQuantity = stockMax;
    setCart((prev) =>
      recalculatePromotions(
        prev.map((item) => {
          if (item.id !== id) return item;
          const cleanQuantity = Math.min(maxQuantity, Math.max(1, Math.floor(Number(item.quantityInput ?? item.quantity) || 1)));
          return { ...item, quantity: cleanQuantity, quantityInput: String(cleanQuantity) };
        }),
      ),
    );
  };

  const updateDiscount = (id: string, newDiscount: number) => {
    const cleanDiscount = Math.min(100, Math.max(0, Number.isFinite(newDiscount) ? newDiscount : 0));
    setCart((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              discount: isBogoCartItem(item) ? getLineEffectiveDiscountPercent(item) : cleanDiscount,
              discountInput: isBogoCartItem(item) ? formatPercentValue(getLineEffectiveDiscountPercent(item)) : String(cleanDiscount),
            }
          : item,
      ),
    );
  };

  const updateDiscountInput = (id: string, value: string) => {
    const cleanValue = value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
    setCart((prev) =>
      prev.map((item) => {
        if (item.id !== id || isBogoCartItem(item)) return item;
        if (cleanValue === "") return { ...item, discountInput: "", discount: 0 };
        const cleanDiscount = Math.min(100, Math.max(0, Number(cleanValue) || 0));
        return { ...item, discountInput: cleanValue, discount: cleanDiscount };
      }),
    );
  };

  const commitDiscountInput = (id: string) => {
    const currentItem = cart.find((item) => item.id === id);
    if (currentItem && isBogoCartItem(currentItem)) return;
    const cleanDiscount = Math.min(100, Math.max(0, Number(currentItem?.discountInput ?? currentItem?.discount) || 0));

    setCart((prev) =>
      prev.map((item) => {
        if (item.id !== id || isBogoCartItem(item)) return item;
        return { ...item, discount: cleanDiscount, discountInput: String(cleanDiscount) };
      }),
    );
  };

  const calculateSubtotal = () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const calculateTotalDiscount = () => cart.reduce((sum, item) => sum + getLineDiscountAmount(item), 0);
  const calculateTotal = () => calculateSubtotal() - calculateTotalDiscount();

  const normalizePhone = (value: string) => value.replace(/\D/g, "").slice(0, 11);

  const getOrCreateWalkInCustomer = async () => {
    const name = walkInCustomerName.trim();
    const phone = normalizePhone(walkInCustomerPhone);
    if (!name || !phone) {
      throw new Error("Please provide walk-in customer name and mobile number");
    }
    if (phone.length !== 11) {
      throw new Error("Mobile number must be exactly 11 digits");
    }

    const { data: existing, error: selectError } = await supabase
      .from("customer")
      .select("customer_id,name,gender,age,birth_date")
      .eq("contact_number", phone)
      .limit(1);
    if (selectError) throw selectError;

    if (existing && existing.length > 0) {
      const existingGender = String((existing[0] as any).gender ?? "").trim();
      const existingAgeRaw = Number((existing[0] as any).age ?? NaN);
      const existingAge = Number.isFinite(existingAgeRaw) ? existingAgeRaw : null;
      const existingBirthDate = String((existing[0] as any).birth_date ?? "").trim();
      if (!existingGender || (!existingBirthDate && existingAge === null)) {
        throw new Error("This customer exists but is missing gender/age. Please update profile in Customers first.");
      }
      return { customer_id: existing[0].customer_id as string, label: (existing[0].name as string) || name };
    }

    if (!walkInGender) {
      throw new Error("Please provide gender for walk-in customer");
    }
    const parsedAge = Number(walkInAge);
    if (!Number.isFinite(parsedAge) || parsedAge < 0 || parsedAge > 120) {
      throw new Error("Please provide a valid age (0-120) for walk-in customer");
    }

    const fallbackEmail = `${phone.replace(/[^\d]/g, "") || Date.now()}@walkin.local`;
    const { data: created, error: insertError } = await supabase
      .from("customer")
      .insert({
        name,
        contact_number: phone,
        email: fallbackEmail,
        gender: walkInGender,
        age: parsedAge,
        status: "active",
        date_registered: new Date().toISOString().slice(0, 10),
      })
      .select("customer_id,name")
      .single();
    if (insertError) throw insertError;

    return { customer_id: created.customer_id as string, label: (created.name as string) || name };
  };

  const processPayment = async () => {
    if (!user?.user_id) return toast.error("No logged in user");
    if (cart.length === 0) return toast.error("Cart is empty");

    // Sum of the rounded line subtotals, exactly as the server totals the sale.
    const total = Math.round(cart.reduce((sum, item) => sum + Number(getLineTotal(item).toFixed(2)), 0) * 100) / 100;
    const paid = paymentMethod === "Cash" ? Number(cashReceived || 0) : total;
    if (paid < total) return toast.error("Insufficient payment amount");

    if (paymentMethod === "GCash") {
      const cleanDigits = gcashRefNumber.replace(/\D/g, "");
      if (!cleanDigits) {
        return toast.error("Please enter the GCash Reference Number");
      }
      if (cleanDigits.length !== 13) {
        return toast.error(`GCash Reference Number must be exactly 13 digits (currently ${cleanDigits.length} digits)`);
      }
    }

    const dbPaymentMethod = paymentMethod === "Cash" ? "cash" : "gcash";

    const selectedCustomer = customerOptions.find((c) => c.value === customerName);
    let p_customer_id = selectedCustomer?.customer_id ?? null;
    let receiptCustomerName = selectedCustomer?.label ?? "Walk-in Customer";

    if (customerName !== "walk-in") {
      const selectedGender = String((selectedCustomer as any)?.gender ?? "").trim();
      const selectedAgeRaw = Number((selectedCustomer as any)?.age ?? NaN);
      const selectedAge = Number.isFinite(selectedAgeRaw) ? selectedAgeRaw : null;
      const selectedBirthDate = String((selectedCustomer as any)?.birth_date ?? "").trim();
      if (!selectedGender || (!selectedBirthDate && selectedAge === null)) {
        return toast.error("Selected customer is missing gender/age. Update profile in Customers first.");
      }
    }

    if (customerName === "walk-in" && saveWalkInDetails) {
      try {
        const walkInCustomer = await getOrCreateWalkInCustomer();
        p_customer_id = walkInCustomer.customer_id;
        receiptCustomerName = walkInCustomer.label;
      } catch (error: any) {
        return toast.error(error?.message ?? "Failed to save walk-in customer");
      }
    }

    const items = cart.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      price: item.price,
      discount_applied: Number(getLineEffectiveDiscountPercent(item).toFixed(2)),
      subtotal: Number(getLineTotal(item).toFixed(2)),
    }));

    // The database records the signed-in cashier from the session; p_user_id is informational.
    const saleArgs: Record<string, unknown> = {
      p_user_id: user.user_id,
      p_customer_id,
      p_payment_method: dbPaymentMethod,
      p_amount_paid: paid,
      p_items: items,
    };
    if (paymentMethod === "GCash") {
      saleArgs.p_reference_number = gcashRefNumber.replace(/\D/g, "");
    }

    const rpc = (supabase as any).rpc.bind(supabase);
    let { data, error } = await rpc("complete_sale", saleArgs);
    if (error?.code === "PGRST202" && "p_reference_number" in saleArgs) {
      // Database not yet migrated to the version that stores GCash references.
      const { p_reference_number: _ignored, ...legacyArgs } = saleArgs;
      ({ data, error } = await rpc("complete_sale", legacyArgs));
    }

    if (error) return toast.error(error.message);

    const completedSalesId = String(data?.sales_id ?? "").trim();
    if (completedSalesId) {
      await Promise.all(
        cart
          .filter((item) => item.promo_id)
          .map(async (item) => {
            const updateResult = await supabase
              .from("sales_details")
              .update({ promo_id: item.promo_id })
              .eq("sales_id", completedSalesId)
              .eq("product_id", item.product_id);
            if (updateResult.error) {
              const message = String(updateResult.error.message || "").toLowerCase();
              if (!message.includes("promo_id") && !message.includes("column")) {
                console.warn("Unable to tag sale detail with promotion:", updateResult.error);
              }
            }
          }),
      );
    }

function formatReceiptNumber(salesId?: string) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  if (!salesId) return `RCP-${dateStr}-${Math.floor(1000 + Math.random() * 9000)}`;
  if (salesId.startsWith("RCP-") || salesId.startsWith("INV-") || salesId.startsWith("SAL-")) return salesId;
  const cleanSuffix = salesId.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
  return `RCP-${dateStr}-${cleanSuffix}`;
}

    const receiptTotal = Number(data?.total_amount ?? total);
    const vatBreakdown = getVatBreakdown(receiptTotal);
    const receiptNumber = formatReceiptNumber(data?.sales_id);
    const receipt = {
      receiptNumber,
      rawSalesId: data?.sales_id,
      date: new Date().toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      customerName: receiptCustomerName,
      items: [...cart],
      subtotal: calculateSubtotal(),
      discount: calculateTotalDiscount(),
      total: receiptTotal,
      vatableSales: vatBreakdown.vatableSales,
      vatAmount: vatBreakdown.vatAmount,
      vatExemptSales: vatBreakdown.vatExemptSales,
      zeroRatedSales: vatBreakdown.zeroRatedSales,
      cashReceived: paymentMethod === "Cash" ? (Number(cashReceived) || total) : total,
      change_amount: paymentMethod === "Cash" ? Number(data?.change_amount ?? Math.max(0, (Number(cashReceived) || total) - total)) : 0,
      paymentMethod,
      gcashRefNumber: paymentMethod === "GCash" ? gcashRefNumber.trim() : "",
      cashier: user.name || "Cashier 1",
    };
    setReceiptData(receipt);
    setShowReceipt(true);
    logAuditEvent({
      action_type: "POS_SALE_COMPLETED",
      entity_type: "SALE",
      entity_id: receiptNumber,
      metadata: {
        total: receiptTotal,
        payment_method: paymentMethod,
        items_count: cart.length,
        cashier: user?.name || user?.username || "Cashier",
      },
    });
    setCart([]);
    setCustomerName("walk-in");
    setSaveWalkInDetails(false);
    setWalkInCustomerName("");
    setWalkInCustomerPhone("");
    setWalkInGender("");
    setWalkInAge("");
    setPaymentMethod("Cash");
    setCashReceived("");
    setGcashRefNumber("");
    await queryClient.invalidateQueries({ queryKey: ["products"] });
    await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    await queryClient.invalidateQueries({ queryKey: ["inventoryLog"] });
    await queryClient.invalidateQueries({ queryKey: ["sales"] });
    toast.success("Payment processed successfully!");
  };

  const printReceipt = () => {
    window.print();
    toast.success("Receipt sent to printer");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        {/* PRODUCT SELECTION CARD */}
        <Card className="bg-[#101017] border-[#24242f] shadow-xl gap-0">
          <CardHeader className="border-b border-[#24242f] px-5 py-3.5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-yellow-300 flex items-center gap-2 text-lg">
                <Package className="w-5 h-5 text-yellow-400" />
                Product Selection
              </CardTitle>
              <Button
                type="button"
                onClick={() => setIsProductGridOpen(true)}
                className="bg-yellow-400 text-red-950 hover:bg-yellow-500 font-bold text-xs h-9 px-4 rounded-xl shadow"
              >
                <Search className="w-4 h-4 mr-2" />
                Search Products
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 p-5 pt-4">
            {/* SEARCH PRODUCTS MODAL - EXPANSIVE & TOP-POSITIONED */}
            <Dialog
              open={isProductGridOpen}
              onOpenChange={(open) => {
                setIsProductGridOpen(open);
                setProductSearch("");
                setModalCategoryFilter("All");
              }}
            >
              <DialogContent className="bg-[#14141e] border-[#2d2d3d] text-yellow-100 !w-[96vw] !max-w-[1360px] max-h-[92vh] overflow-hidden p-0 shadow-2xl rounded-2xl top-[46%]">
                <div className="border-b border-[#262636] p-5 bg-[#171724]">
                  <DialogHeader>
                    <DialogTitle className="text-yellow-300 flex items-center gap-2 text-lg font-bold">
                      <Package className="w-5 h-5 text-yellow-400" />
                      Search Products
                    </DialogTitle>
                  </DialogHeader>

                  <div className="relative mt-3">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-400" />
                    <Input
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="Search by shoe model, brand, colorway, size, or price..."
                      className="h-11 rounded-xl bg-[#1d1d2b] border-[#303042] pl-10 pr-16 text-yellow-100 placeholder:text-yellow-300/40 focus-visible:ring-yellow-400/50 text-sm font-medium"
                      autoFocus
                    />
                    {productSearch && (
                      <button
                        type="button"
                        onClick={() => setProductSearch("")}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-yellow-300/80 hover:text-yellow-300 text-xs font-bold px-2 py-1 rounded-md bg-zinc-800"
                      >
                        Clear
                      </button>
                    )}
                  </div>

                  {/* CATEGORY FILTER PILLS */}
                  <div className="flex flex-wrap gap-1.5 mt-3 pt-2.5 border-t border-[#252535]">
                    {distinctCategories.map((cat) => {
                      const isActive = modalCategoryFilter.toLowerCase() === cat.toLowerCase();
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setModalCategoryFilter(cat)}
                          className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                            isActive
                              ? "bg-yellow-400 text-red-950 font-bold shadow"
                              : "bg-[#1d1d2b] text-yellow-200/70 hover:bg-[#252538] hover:text-white"
                          }`}
                        >
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {isSearchActive && (
                  <div className="p-5">
                    <div className="overflow-hidden rounded-xl border border-[#282838] bg-[#12121a]">
                      <div className="max-h-[58vh] overflow-y-auto overflow-x-hidden">
                        <Table className="w-full text-sm table-fixed">
                          <TableHeader className="sticky top-0 z-10 bg-[#1a1a28]">
                            <TableRow className="border-b border-[#282838] hover:bg-transparent">
                              <TableHead className="w-16 py-3 text-center text-xs font-semibold uppercase tracking-wide text-yellow-300">Photo</TableHead>
                              <TableHead className="w-[26%] py-3 text-left pl-6 text-xs font-semibold uppercase tracking-wide text-yellow-300">Shoe Model</TableHead>
                              <TableHead className="w-[14%] py-3 text-center text-xs font-semibold uppercase tracking-wide text-yellow-300">Brand</TableHead>
                              <TableHead className="w-[14%] py-3 text-center text-xs font-semibold uppercase tracking-wide text-yellow-300">Category</TableHead>
                              <TableHead className="w-[20%] py-3 text-center text-xs font-semibold uppercase tracking-wide text-yellow-300">Available Options</TableHead>
                              <TableHead className="w-[14%] py-3 text-right pr-6 text-xs font-semibold uppercase tracking-wide text-yellow-300">Price (SRP)</TableHead>
                              <TableHead className="w-[12%] py-3 text-center text-xs font-semibold uppercase tracking-wide text-yellow-300">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredShoeModels.length > 0 ? (
                              filteredShoeModels.map((model) => {
                                const isStandardColor = !model.color || model.color === "Standard";
                                return (
                                  <TableRow
                                    key={model.key}
                                    onClick={() => selectShoeModel(model)}
                                    className="border-t border-[#232333] hover:bg-[#1f1f30] cursor-pointer transition-colors group"
                                  >
                                    <TableCell className="py-3 text-center">
                                      <div className="flex justify-center">
                                        <ProductPhotoPlaceholder
                                          productName={`${model.product_name}${!isStandardColor ? ` ${model.color}` : ""}`}
                                          imageUrl={model.image_url}
                                        />
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 text-left pl-6 font-semibold text-white group-hover:text-yellow-300">
                                      <p className="font-bold text-sm text-white group-hover:text-yellow-300">{model.product_name}</p>
                                      <div className="flex items-center gap-1.5 mt-0.5">
                                        <span className="text-[11px] text-emerald-400 font-medium">
                                          {model.total_stock} pair{model.total_stock === 1 ? "" : "s"} available
                                        </span>
                                        {model.gender && (
                                          <>
                                            <span className="text-zinc-600 text-[10px]">•</span>
                                            <span className="text-[11px] text-yellow-300/80 font-medium">
                                              {model.gender}
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 text-center text-yellow-100/90 truncate" title={model.brand}>
                                      {model.brand}
                                    </TableCell>
                                    <TableCell className="py-3 text-center text-yellow-200/60 text-xs truncate" title={model.category}>
                                      {model.category}
                                    </TableCell>
                                    <TableCell className="py-3 text-center">
                                      <div className="flex flex-col items-center gap-1.5">
                                        {!isStandardColor ? (
                                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium text-white bg-[#1e1e2d] border border-[#33334c] shadow-sm">
                                            <span
                                              className="w-2 h-2 rounded-full border border-white/20 shrink-0"
                                              style={{ backgroundColor: getColorSwatch(model.color) }}
                                            />
                                            {model.color}
                                          </span>
                                        ) : (
                                          <span className="text-[10px] text-zinc-400 italic">Standard</span>
                                        )}
                                        {model.sizes.length > 0 ? (
                                          <span className="text-xs text-yellow-300 font-medium">
                                            Sizes: {model.sizes.join(", ")}
                                          </span>
                                        ) : (
                                          <span className="text-[10px] text-red-400">Out of stock</span>
                                        )}
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 text-right pr-6 font-bold text-yellow-300 truncate" title={`PHP ${model.price}`}>
                                      PHP {model.price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 2 })}
                                    </TableCell>
                                    <TableCell className="py-3 text-center" onClick={(e) => e.stopPropagation()}>
                                      <Button
                                        size="sm"
                                        onClick={() => selectShoeModel(model)}
                                        className="h-8 rounded-lg bg-yellow-400 px-4 font-bold text-xs text-red-950 hover:bg-yellow-500 shadow"
                                        title={`Select ${model.product_name} (${model.color}) to pick size on main POS screen`}
                                      >
                                        Select
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            ) : (
                              <TableRow>
                                <TableCell colSpan={7} className="py-12 text-center text-sm text-yellow-200/60 space-y-2">
                                  <div className="text-zinc-400 font-semibold text-base">No shoe models found matching &ldquo;{productSearch}&rdquo;</div>
                                  <div className="text-xs text-yellow-200/40">Check your spelling or try searching by brand (Nike, Adidas, Rocco), colorway, or model name.</div>
                                </TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                    <p className="mt-3 text-center text-xs text-yellow-200/50">
                      Tip: Click any shoe or &quot;Select&quot; to load it onto the POS screen and choose your color &amp; size tiles.
                    </p>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            {/* PRODUCT, COLOR & SHOPEE-STYLE SIZE SELECTION */}
            <div className="space-y-4">
              {/* 1. SELECT PRODUCT DROPDOWN */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-yellow-300 uppercase tracking-wider">
                  1. Select Shoe Model / Product
                </Label>
                <Select
                  value={selectedProductKey}
                  onValueChange={(value) => {
                    setSelectedProductKey(value);
                    const colors = Array.from(
                      new Set(sellableProductInventory.filter((v) => v.product_name === value).map((v) => v.color))
                    );
                    setSelectedColor(colors.length === 1 ? colors[0] : "");
                    setSelectedSize("");
                  }}
                >
                  <SelectTrigger className="h-11 bg-[#171724] border-[#2e2e3f] text-yellow-100 rounded-xl font-medium focus:ring-yellow-400/50">
                    <SelectValue placeholder="Choose a product model to view variants..." />
                  </SelectTrigger>
                  <SelectContent className="bg-[#15151f] border-[#2e2e3f] text-yellow-100 max-h-72">
                    {productGroups.map((group) => (
                      <SelectItem key={group.key} value={group.key} className="py-2.5 hover:bg-[#202030]">
                        <span className="font-semibold text-white">{group.product_name}</span>
                        <span className="text-xs text-yellow-200/60 ml-2">
                          ({group.variants.length} variant{group.variants.length === 1 ? "" : "s"})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* 2. COLOR VARIANT CHIPS (IF PRODUCT SELECTED) */}
              {selectedProductKey && (
                <div className="space-y-2 rounded-xl bg-[#14141e] border border-[#262636] p-3.5 shadow-inner">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-yellow-300 uppercase tracking-wider">
                      2. Available Colorways
                    </Label>
                    <span className="text-xs text-yellow-200/60">
                      {availableColors.length} color option{availableColors.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {availableColors.map((color) => {
                      const isSelected = selectedColor === color;
                      return (
                        <button
                          key={color}
                          type="button"
                          onClick={() => {
                            setSelectedColor(color);
                            setSelectedSize("");
                          }}
                          className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                            isSelected
                              ? "bg-yellow-400 text-red-950 border-yellow-300 shadow-md ring-2 ring-yellow-400/50 scale-[1.02]"
                              : "bg-[#1c1c28] text-yellow-200 border-[#303044] hover:border-yellow-400/50 hover:bg-[#252536]"
                          }`}
                        >
                          <span className="w-2.5 h-2.5 rounded-full border border-black/30" style={{ backgroundColor: color.toLowerCase() }} />
                          <span>{color}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 3. SHOPEE-STYLE SIZE CARD BUTTONS */}
              {selectedProductKey && (selectedColor || availableColors.length === 1) && (
                <div className="space-y-2 rounded-xl bg-[#14141e] border border-[#262636] p-3.5 shadow-inner">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-yellow-300 uppercase tracking-wider">
                      3. Available Sizes
                    </Label>
                    <span className="text-xs text-yellow-200/60">
                      Tap a size tile to select
                    </span>
                  </div>

                  {availableSizes.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
                      {availableSizes.map((variant) => {
                        const isSelected = selectedSize === variant.size;
                        const isOutOfStock = variant.stock_quantity <= 0;
                        const isLowStock = variant.stock_quantity > 0 && variant.stock_quantity <= 3;

                        return (
                          <button
                            key={variant.product_id}
                            type="button"
                            disabled={isOutOfStock}
                            onClick={() => {
                              setSelectedColor(variant.color);
                              setSelectedSize(variant.size);
                            }}
                            className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-all text-center relative overflow-hidden ${
                              isSelected
                                ? "bg-yellow-400 text-red-950 border-yellow-300 shadow-lg ring-2 ring-yellow-400/60 scale-[1.03]"
                                : isOutOfStock
                                  ? "bg-zinc-900/40 border-zinc-800 text-zinc-600 opacity-40 cursor-not-allowed line-through"
                                  : "bg-[#181824] border-[#2e2e3f] text-yellow-100 hover:border-yellow-400/60 hover:bg-[#202030]"
                            }`}
                          >
                            <span className={`text-sm font-bold ${isSelected ? "text-red-950" : "text-white"}`}>
                              Size {variant.size}
                            </span>
                            {getShoeSizeConversion(variant.size, variant.gender) && (
                              <span
                                className={`text-[10px] font-semibold mt-0.5 leading-tight ${
                                  isSelected ? "text-red-950 font-bold" : "text-yellow-400/90"
                                }`}
                              >
                                {getShoeSizeConversion(variant.size, variant.gender)}
                              </span>
                            )}
                            <span className={`text-xs font-semibold mt-0.5 ${isSelected ? "text-red-900" : "text-yellow-300"}`}>
                              ₱{variant.price.toLocaleString()}
                            </span>
                            <span
                              className={`text-[10px] mt-1 font-bold px-1.5 py-0.2 rounded-full ${
                                isSelected
                                  ? "bg-red-950/20 text-red-950"
                                  : isOutOfStock
                                    ? "text-red-400"
                                    : isLowStock
                                      ? "bg-amber-950/70 text-amber-300 border border-amber-500/30"
                                      : "bg-emerald-950/70 text-emerald-300 border border-emerald-500/30"
                              }`}
                            >
                              {isOutOfStock ? "Out of Stock" : isLowStock ? `Low Stock (${variant.stock_quantity} left)` : `${variant.stock_quantity} available`}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-4 text-xs text-yellow-200/60">
                      No stock available for this colorway.
                    </div>
                  )}
                </div>
              )}

              {/* 4. QUANTITY STEPPER & ADD TO CART BAR */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-3 border-t border-[#222230]">
                <div className="flex items-center gap-3">
                  <Label className="text-xs font-semibold text-yellow-300 uppercase tracking-wider whitespace-nowrap">
                    Quantity:
                  </Label>
                  <div className="inline-flex items-center gap-1 bg-[#14141f] p-1 rounded-xl border border-[#2e2e42]">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const current = Math.max(1, Number(quantity) || 1);
                        if (current > 1) setQuantity(String(current - 1));
                      }}
                      disabled={!selectedSize || Number(quantity) <= 1}
                      className="h-8 w-8 bg-[#1e1e2d] text-yellow-200 hover:bg-[#2c2c40] hover:text-white rounded-lg disabled:opacity-30 text-sm font-bold"
                    >
                      -
                    </Button>
                    <Input
                      type="number"
                      min="1"
                      value={quantity}
                      onChange={(e) => {
                        const cleanValue = e.target.value.replace(/[^\d]/g, "");
                        setQuantity(cleanValue);
                      }}
                      onBlur={() => {
                        if (!quantity || Number(quantity) <= 0) setQuantity("1");
                      }}
                      className="h-8 w-14 text-center font-bold text-sm bg-transparent border-0 text-yellow-100 p-0 focus-visible:ring-0 focus-visible:ring-offset-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const current = Math.max(1, Number(quantity) || 1);
                        setQuantity(String(current + 1));
                      }}
                      disabled={!selectedSize}
                      className="h-8 w-8 bg-[#1e1e2d] text-yellow-200 hover:bg-[#2c2c40] hover:text-white rounded-lg disabled:opacity-30 text-sm font-bold"
                    >
                      +
                    </Button>
                  </div>
                </div>

                <Button
                  onClick={addToCart}
                  disabled={!selectedProductKey || !selectedSize}
                  className="h-10 bg-yellow-400 text-red-950 hover:bg-yellow-500 font-bold text-xs sm:text-sm px-6 rounded-xl shadow-lg disabled:opacity-40 flex items-center justify-center gap-2 transition-transform active:scale-95"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add to Cart</span>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* SHOPPING CART CARD */}
        <Card className="bg-[#101017] border-[#24242f] shadow-xl gap-0">
          <CardHeader className="border-b border-[#24242f] px-5 py-3.5">
            <CardTitle className="text-yellow-300 flex items-center gap-2 text-lg">
              <CreditCard className="w-5 h-5" />
              Shopping Cart
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-4">
            {cart.length === 0 ? (
              <div className="text-center py-8 text-yellow-200/50 text-sm">Cart is empty. Add products to begin transaction.</div>
            ) : (
              <div className="border border-[#262636] rounded-xl overflow-x-auto overflow-y-auto max-h-[420px] bg-[#14141e]">
                <Table className="w-full">
                  <TableHeader>
                    <TableRow className="bg-[#1a1a28] hover:bg-[#1a1a28] border-b border-[#262636]">
                      <TableHead className="text-yellow-300 whitespace-nowrap text-left px-3 text-xs font-semibold">Product</TableHead>
                      <TableHead className="text-yellow-300 whitespace-nowrap text-left px-3 text-xs font-semibold">Brand</TableHead>
                      <TableHead className="text-yellow-300 whitespace-nowrap text-center px-2 text-xs font-semibold">Color</TableHead>
                      <TableHead className="text-yellow-300 whitespace-nowrap text-center px-2 text-xs font-semibold">Size</TableHead>
                      <TableHead className="text-yellow-300 whitespace-nowrap text-center px-3 text-xs font-semibold">Price</TableHead>
                      <TableHead className="text-yellow-300 whitespace-nowrap text-center px-2 text-xs font-semibold">Qty</TableHead>
                      <TableHead className="text-yellow-300 whitespace-nowrap text-center px-2 text-xs font-semibold">Discount</TableHead>
                      <TableHead className="text-yellow-300 whitespace-nowrap text-center px-2 text-xs font-semibold">Promo</TableHead>
                      <TableHead className="text-yellow-300 whitespace-nowrap text-center px-3 text-xs font-semibold">Subtotal</TableHead>
                      <TableHead className="text-yellow-300 whitespace-nowrap text-center px-2 text-xs font-semibold">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cart.map((item) => {
                      const itemTotal = getLineTotal(item);
                      const itemIsBogo = isBogoCartItem(item);
                      return (
                        <TableRow key={item.id} className="border-t border-[#232333] hover:bg-[#1c1c2b] transition-colors">
                          <TableCell className="text-white font-semibold whitespace-nowrap align-middle px-3 py-3 truncate">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-lg bg-[#14141e] border border-[#2d2d3f] overflow-hidden flex items-center justify-center flex-shrink-0 shadow-inner">
                                {item.image_url ? (
                                  <img
                                    src={cleanProductImageUrl(item.image_url)}
                                    alt={item.productName}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-cover"
                                    onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                                  />
                                ) : (
                                  <Package className="w-4 h-4 text-yellow-400/40" />
                                )}
                              </div>
                              <span className="truncate">{item.productName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-yellow-100 whitespace-nowrap align-middle px-3 py-3 truncate">{item.brand}</TableCell>
                          <TableCell className="text-yellow-100 whitespace-nowrap text-center align-middle px-2 py-3">{item.color}</TableCell>
                          <TableCell className="text-yellow-100 whitespace-nowrap text-center align-middle px-2 py-3">{item.size}</TableCell>
                          <TableCell className="text-yellow-300 whitespace-nowrap text-center align-middle px-3 py-3 font-medium">
                            <span className="inline-block tabular-nums">
                              {formatCurrency(item.price)}
                            </span>
                          </TableCell>
                          <TableCell className="text-center align-middle px-2 py-3">
                            <div className="mx-auto flex w-[104px] items-center justify-center rounded-xl border border-[#2e2e3f] bg-[#1d1d2b] p-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => updateQuantity(item.id, item.quantity - 1)}
                                disabled={itemIsBogo || item.quantity <= 1}
                                className="h-7 w-7 rounded-lg text-yellow-300 hover:bg-yellow-400 hover:text-red-950 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                              <Input
                                type="text"
                                inputMode="numeric"
                                value={item.quantityInput ?? String(item.quantity)}
                                onChange={(e) => updateQuantityInput(item.id, e.target.value)}
                                onBlur={() => commitQuantityInput(item.id)}
                                className="h-7 w-10 border-0 bg-transparent p-0 text-center text-yellow-100 shadow-none focus-visible:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none font-bold"
                                disabled={itemIsBogo}
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => updateQuantity(item.id, item.quantity + 1)}
                                disabled={itemIsBogo}
                                className="h-7 w-7 rounded-lg text-yellow-300 hover:bg-yellow-400 hover:text-red-950"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-center align-middle px-2 py-3">
                            <div className="mx-auto flex w-[122px] items-center justify-center rounded-xl border border-[#2e2e3f] bg-[#1d1d2b] p-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => updateDiscount(item.id, item.discount - 1)}
                                disabled={itemIsBogo || item.discount <= 0}
                                className="h-7 w-7 rounded-lg text-yellow-300 hover:bg-yellow-400 hover:text-red-950 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </Button>
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={item.discountInput ?? String(item.discount)}
                                onChange={(e) => updateDiscountInput(item.id, e.target.value)}
                                onBlur={() => commitDiscountInput(item.id)}
                                className="h-7 w-14 border-0 bg-transparent p-0 text-center text-yellow-100 shadow-none focus-visible:ring-0 font-bold"
                                disabled={itemIsBogo}
                              />
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                onClick={() => updateDiscount(item.id, item.discount + 1)}
                                disabled={itemIsBogo || item.discount >= 100}
                                className="h-7 w-7 rounded-lg text-yellow-300 hover:bg-yellow-400 hover:text-red-950 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                          <TableCell className="text-center align-middle px-2 py-3">
                            {item.promotionType ? (
                              <div className="flex flex-col items-center gap-1">
                                <Badge className="bg-yellow-400 text-red-950 font-bold">
                                  {getPromoBadgeLabel(item.promotionType)}
                                </Badge>
                                {isBogoCartItem(item) && (
                                  <span className="text-[10px] text-yellow-200/70">
                                    {getBogoFreeUnits(item.quantity)} free
                                  </span>
                                )}
                              </div>
                            ) : (
                              <span className="text-yellow-200/50 text-xs">None</span>
                            )}
                          </TableCell>
                          <TableCell className="text-yellow-300 text-center align-middle px-3 py-3 font-bold">
                            <span className="inline-block tabular-nums">
                              {formatCurrency(itemTotal)}
                            </span>
                          </TableCell>
                          <TableCell className="text-center align-middle px-2 py-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleRemoveFromCart(item.id)}
                              title="Remove from cart"
                              className="text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded-lg h-8 w-8 p-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* TRANSACTION SUMMARY & PAYMENT CARD */}
      {/* RIGHT COLUMN - TRANSACTION SUMMARY */}
      <div className="space-y-4 lg:sticky lg:top-0 self-start">
        <Card className="bg-[#101017] border-[#24242f] shadow-xl gap-0">
          <CardHeader className="border-b border-[#24242f] px-5 py-3.5">
            <CardTitle className="text-yellow-300 flex items-center gap-2 text-lg">
              <Coins className="w-5 h-5 text-yellow-400" />
              Transaction Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 p-5 pt-4">
            <div className="space-y-3 rounded-xl bg-[#14141e] border border-[#262636] p-4">
              <div className="flex justify-between text-yellow-200/70 text-sm"><span>Subtotal:</span><span className="text-yellow-100 font-semibold">₱{calculateSubtotal().toFixed(2)}</span></div>
              <div className="flex justify-between text-emerald-400 text-sm"><span>Total Discount:</span><span className="font-semibold">-₱{calculateTotalDiscount().toFixed(2)}</span></div>
              <div className="border-t border-[#28283a] pt-3">
                <div className="flex justify-between items-baseline"><span className="text-white font-bold text-base">Total Due:</span><span className="text-yellow-300 text-2xl font-black">₱{calculateTotal().toFixed(2)}</span></div>
              </div>
            </div>

            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-semibold text-yellow-300 uppercase tracking-wider">Customer Selection</Label>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => setIsCustomerGridOpen(true)}
                    className="bg-yellow-400 text-red-950 hover:bg-yellow-500 font-bold text-xs h-7 px-2.5 rounded-lg shadow"
                  >
                    <Users className="w-3.5 h-3.5 mr-1" />
                    Browse
                  </Button>
                </div>
                <Dialog open={isCustomerGridOpen} onOpenChange={setIsCustomerGridOpen}>
                  <DialogContent className="bg-[#14141e] border-[#2d2d3d] text-yellow-100 !w-[92vw] !max-w-[820px] max-h-[82vh] overflow-hidden p-0 rounded-2xl shadow-2xl">
                    <div className="border-b border-[#262636] p-5 bg-[#171724]">
                      <DialogHeader>
                        <DialogTitle className="text-yellow-300 flex items-center gap-2 text-lg">
                          <Users className="w-5 h-5" />
                          Select Customer
                        </DialogTitle>
                      </DialogHeader>
                      <div className="relative mt-3">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-400" />
                        <Input
                          value={customerSearch}
                          onChange={(event) => setCustomerSearch(event.target.value)}
                          placeholder="Search by name, email, or contact number..."
                          className="h-11 pl-10 bg-[#1d1d2b] border-[#303042] text-yellow-100 placeholder:text-yellow-300/40 rounded-xl"
                        />
                      </div>
                    </div>
                    <div className="p-5 pt-4">
                      <div className="border border-[#282838] rounded-xl overflow-hidden bg-[#12121a]">
                        <div className="max-h-[52vh] overflow-y-auto overflow-x-hidden">
                        <Table className="w-full table-fixed text-sm">
                          <TableHeader className="sticky top-0 z-10 bg-[#1a1a28]">
                            <TableRow className="border-b border-[#282838]">
                              <TableHead className="w-[24%] px-3 text-center text-yellow-300 font-semibold text-xs">Name</TableHead>
                              <TableHead className="w-[36%] px-3 text-center text-yellow-300 font-semibold text-xs">Email</TableHead>
                              <TableHead className="w-[24%] px-3 text-center text-yellow-300 font-semibold text-xs">Contact</TableHead>
                              <TableHead className="w-[16%] px-3 text-center text-yellow-300 font-semibold text-xs">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredCustomerOptions.map((customer: any) => (
                              <TableRow
                                key={customer.value}
                                onClick={() => selectCustomer(customer)}
                                className="cursor-pointer border-t border-[#232333] transition-colors hover:bg-[#1c1c2b]"
                              >
                                <TableCell className="truncate px-3 text-center text-yellow-100 font-medium" title={customer.label}>
                                  {customer.label}
                                </TableCell>
                                <TableCell className="truncate px-3 text-center text-yellow-200/60" title={customer.email || "N/A"}>
                                  {customer.email || "N/A"}
                                </TableCell>
                                <TableCell className="truncate px-3 text-center text-yellow-200/60" title={customer.contact_number || "N/A"}>
                                  {customer.contact_number || "N/A"}
                                </TableCell>
                                <TableCell className="px-3 text-center">
                                  <Button
                                    size="sm"
                                    onClick={(event) => {
                                       event.stopPropagation();
                                      selectCustomer(customer);
                                    }}
                                    className="h-7 bg-yellow-400 px-3 text-red-950 font-bold text-xs hover:bg-yellow-500 rounded-lg shadow"
                                  >
                                    Select
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                        </div>
                      </div>
                      <p className="mt-3 text-xs text-yellow-200/50 text-center">
                        Click a row or the Select button to use an existing customer. Use Walk-in Customer for quick sales.
                      </p>
                    </div>
                  </DialogContent>
                </Dialog>
                <Select
                  value={customerName}
                  onValueChange={(value) => {
                    setCustomerName(value);
                    if (value !== "walk-in") {
                      setSaveWalkInDetails(false);
                    }
                  }}
                >
                  <SelectTrigger className="h-10 bg-[#171724] border-[#2e2e3f] text-yellow-100 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#15151f] border-[#2e2e3f] text-yellow-100 max-h-64">
                    {customerOptions.map((c) => (
                      <SelectItem key={c.value} value={c.value} className="hover:bg-[#202030]">{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {customerName === "walk-in" && (
                <div className="space-y-3 rounded-xl border border-[#282838] bg-[#14141e] p-3.5">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="save-walkin-details"
                      checked={saveWalkInDetails}
                      onCheckedChange={(checked) => setSaveWalkInDetails(Boolean(checked))}
                      className="border-yellow-400 data-[state=checked]:bg-yellow-400 data-[state=checked]:text-red-950"
                    />
                    <Label htmlFor="save-walkin-details" className="text-xs font-semibold text-yellow-300 cursor-pointer">
                      Save walk-in customer details
                    </Label>
                  </div>
                  {saveWalkInDetails && (
                    <div className="grid grid-cols-1 gap-2.5 pt-1">
                      <div className="space-y-1">
                        <Label className="text-xs text-yellow-200/70">Customer Name</Label>
                        <Input
                          value={walkInCustomerName}
                          onChange={(e) => setWalkInCustomerName(e.target.value)}
                          placeholder="e.g. Juan Dela Cruz"
                          className="h-9 bg-[#1d1d2b] border-[#303042] text-yellow-100 placeholder:text-yellow-300/40 rounded-lg text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-yellow-200/70">Mobile Number</Label>
                        <Input
                          value={walkInCustomerPhone}
                          onChange={(e) => setWalkInCustomerPhone(normalizePhone(e.target.value))}
                          placeholder="e.g. 09171234567"
                          inputMode="numeric"
                          maxLength={11}
                          className="h-9 bg-[#1d1d2b] border-[#303042] text-yellow-100 placeholder:text-yellow-300/40 rounded-lg text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-yellow-200/70">Gender</Label>
                        <Select value={walkInGender} onValueChange={setWalkInGender}>
                          <SelectTrigger className="h-9 bg-[#1d1d2b] border-[#303042] text-yellow-100 rounded-lg text-xs">
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                          <SelectContent className="bg-[#15151f] border-[#2e2e3f] text-yellow-100 text-xs">
                            <SelectItem value="Male">Male</SelectItem>
                            <SelectItem value="Female">Female</SelectItem>
                            <SelectItem value="Kids (Boy)">Kids (Boy)</SelectItem>
                            <SelectItem value="Kids (Girl)">Kids (Girl)</SelectItem>
                            <SelectItem value="Unisex">Unisex</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-yellow-200/70">Age</Label>
                        <Input
                          type="number"
                          min={0}
                          max={120}
                          value={walkInAge}
                          onChange={(e) => setWalkInAge(e.target.value)}
                          className="h-9 bg-[#1d1d2b] border-[#303042] text-yellow-100 rounded-lg text-xs"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-yellow-300 uppercase tracking-wider">Payment Method</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger className="h-10 bg-[#171724] border-[#2e2e3f] text-yellow-100 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#15151f] border-[#2e2e3f] text-yellow-100">
                    <SelectItem value="Cash">Cash</SelectItem>
                    <SelectItem value="GCash">GCash</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {paymentMethod === "Cash" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-yellow-300 uppercase tracking-wider">Cash Received</Label>
                    <Input
                      type="number"
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      placeholder="0.00"
                      className="h-10 bg-[#171724] border-[#2e2e3f] text-yellow-100 placeholder:text-yellow-300/40 rounded-xl font-bold"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-yellow-300 uppercase tracking-wider">Change Amount</Label>
                    <div className="h-10 bg-[#14141e] border border-[#282838] rounded-xl px-3 flex items-center text-emerald-400 font-bold text-base">
                      ₱{Math.max(0, (parseFloat(cashReceived) || 0) - calculateTotal()).toFixed(2)}
                    </div>
                  </div>
                </>
              )}

              {paymentMethod === "GCash" && (
                <div className="space-y-3 rounded-xl border border-[#2e2e42] bg-[#14141e] p-3.5 shadow-inner">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-sky-400 uppercase tracking-wider flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse"></span>
                      GCash Digital Payment
                    </Label>
                    <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 text-[10px] font-bold">
                      Exact Transfer
                    </Badge>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-yellow-200/80 font-medium">
                        GCash Reference No. <span className="text-red-400 font-bold">*</span>
                      </Label>
                      <span className={`text-[11px] font-mono font-semibold ${
                        gcashRefNumber.replace(/\D/g, "").length === 13
                          ? "text-emerald-400"
                          : "text-yellow-200/50"
                      }`}>
                        {gcashRefNumber.replace(/\D/g, "").length}/13 digits
                      </span>
                    </div>
                    <Input
                      value={gcashRefNumber}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, "").slice(0, 13);
                        const formatted = raw.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
                        setGcashRefNumber(formatted);
                      }}
                      placeholder="e.g. 1002 8493 2019 1"
                      maxLength={16}
                      className="h-10 bg-[#1d1d2b] border-[#303042] text-yellow-100 placeholder:text-yellow-300/40 rounded-xl font-mono text-sm tracking-wider focus-visible:ring-sky-400/50"
                    />
                    <p className="text-[11px] text-yellow-200/50">
                      Must be exactly 13 digits from the customer&apos;s GCash confirmation.
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-[#252535]">
                    <span className="text-yellow-200/70">Exact Amount to Receive:</span>
                    <span className="text-yellow-300 font-bold text-sm">₱{calculateTotal().toFixed(2)}</span>
                  </div>
                </div>
              )}

              <Button onClick={processPayment} disabled={cart.length === 0} className="w-full h-11 bg-yellow-400 text-red-950 hover:bg-yellow-500 font-bold text-sm rounded-xl shadow-lg disabled:opacity-40 flex items-center justify-center gap-2">
                <Receipt className="w-4 h-4" />
                Complete Payment & Checkout
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* FORMAL RETAIL SHOE STORE RECEIPT MODAL */}
      <Dialog open={showReceipt} onOpenChange={setShowReceipt}>
        <DialogContent className="bg-[#12121a] border-[#2d2d3d] text-zinc-900 max-w-md rounded-2xl shadow-2xl p-4 sm:p-6 max-h-[92vh] overflow-y-auto">
          <DialogHeader className="border-b border-[#252536] pb-2">
            <DialogTitle className="text-yellow-300 text-center text-sm font-semibold flex items-center justify-center gap-2">
              <Receipt className="w-4 h-4 text-yellow-400" />
              Official Sales Receipt
            </DialogTitle>
          </DialogHeader>

          {receiptData && (
            <div
              id="printable-receipt"
              style={{ backgroundColor: "#ffffff", color: "#000000" }}
              className="p-5 rounded border border-zinc-200 shadow-2xl font-mono text-[11px] leading-[1.4] w-[302px] mx-auto"
            >
              {/* ── STORE HEADER ── */}
              <div className="text-center mb-1">
                <img
                  src={merylLogoBw}
                  alt="Meryl Shoes Logo"
                  className="h-9 mx-auto mb-1 object-contain"
                  style={{ filter: "brightness(0)" }}
                />
                <p className="text-[10px]">Official Retailer &amp; Shoe Center</p>
                <p className="text-[10px]">Araneta Ave, Bacolod, 6100 Negros Occidental</p>
                <p className="text-[10px]">TIN: 432-891-002-000 VAT REGISTERED</p>
                <p className="text-[10px]">TEL: (034) 435 0128</p>
              </div>

              {/* ── TRANSACTION INFO ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <div className="space-y-0.5 text-[11px]">
                <div className="flex justify-between"><span>OR No:</span><span className="font-bold">{receiptData.receiptNumber}</span></div>
                <div className="flex justify-between"><span>Date:</span><span>{receiptData.date}</span></div>
                <div className="flex justify-between"><span>Cashier:</span><span>{receiptData.cashier}</span></div>
                <div className="flex justify-between"><span>Terminal:</span><span>POS-01</span></div>
              </div>

              {/* ── CUSTOMER ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <div className="text-[11px]">
                <span>Customer: {receiptData.customerName}</span>
              </div>

              {/* ── ITEMS HEADER ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>

              {/* ── ITEM LINES ── */}
              <div className="space-y-2 text-[11px]">
                {receiptData.items.map((item: CartItem, index: number) => {
                  const lineTotal = getLineTotal(item);
                  return (
                    <div key={index}>
                      <p className="font-bold uppercase truncate">{item.productName}</p>
                      <p className="text-[10px] pl-1">{item.brand} / {item.color} / Size {item.size}</p>
                      <div className="flex justify-between pl-1">
                        <span>{item.quantity} @ {item.price.toFixed(2)}</span>
                        <span className="tabular-nums font-bold">{lineTotal.toFixed(2)} V</span>
                      </div>
                      {item.promotionType && (
                        <p className="text-[10px] pl-1">PROMO: {getPromoBadgeLabel(item.promotionType)}{isBogoCartItem(item) ? " (Buy 1 Get 1)" : ""}</p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── TOTALS ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <div className="space-y-0.5 text-[11px]">
                {receiptData.discount > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span>Subtotal:</span>
                      <span className="tabular-nums">{receiptData.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Discount:</span>
                      <span className="tabular-nums">-{receiptData.discount.toFixed(2)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between font-black text-[13px] pt-0.5">
                  <span>TOTAL</span>
                  <span className="tabular-nums">{receiptData.total.toFixed(2)}</span>
                </div>
              </div>

              {/* ── PAYMENT ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <div className="space-y-0.5 text-[11px]">
                {receiptData.paymentMethod === "GCash" ? (
                  <>
                    <div className="flex justify-between"><span>GCash:</span><span className="font-bold">GCash</span></div>
                    <div className="flex justify-between"><span>Ref No:</span><span className="font-bold">{receiptData.gcashRefNumber || "N/A"}</span></div>
                    <div className="flex justify-between"><span>Total Tender:</span><span className="tabular-nums">{receiptData.total.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Change Due:</span><span className="tabular-nums">0.00</span></div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between"><span>Cash:</span><span className="font-bold">Cash</span></div>
                    <div className="flex justify-between"><span>Total Tender:</span><span className="tabular-nums">{(receiptData.cashReceived || receiptData.total).toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Change Due:</span><span className="tabular-nums">{receiptData.change_amount.toFixed(2)}</span></div>
                  </>
                )}
                <div className="flex justify-between pt-0.5">
                  <span>Qty of item(s) purchased:</span>
                  <span>{receiptData.items.reduce((s: number, i: CartItem) => s + i.quantity, 0)}.00</span>
                </div>
              </div>

              {/* ── VAT SUMMARY ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <p className="text-center font-bold text-[11px] mb-0.5">VAT SUMMARY</p>
              <div className="space-y-0.5 text-[11px]">
                <div className="flex justify-between"><span>Vatable Amt(V):</span><span className="tabular-nums">{receiptData.vatableSales.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Vat Amt(V +12%):</span><span className="tabular-nums">{receiptData.vatAmount.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Vat Exempted Sale(E):</span><span className="tabular-nums">{receiptData.vatExemptSales.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Zero Rated Amt(Z):</span><span className="tabular-nums">{receiptData.zeroRatedSales.toFixed(2)}</span></div>
              </div>

              {/* ── CUSTOMER COPY ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <p className="text-center font-bold text-[11px]">Customer Copy</p>

              {/* ── QR CODE ── */}
              <div className="flex justify-center pt-2 pb-1">
                <QRCodeSVG
                  value={receiptData.receiptNumber || receiptData.rawSalesId}
                  size={96}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <p className="text-center text-[9px] font-mono">*{receiptData.receiptNumber}*</p>

              {/* ── FOOTER ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <p className="text-center text-[10px] font-bold tracking-wide">THIS SERVES AS YOUR</p>
              <p className="text-center text-[10px] font-bold tracking-wide">OFFICIAL RECEIPT</p>
            </div>
          )}

          <DialogFooter className="border-t border-[#252536] pt-3 flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowReceipt(false)}
              className="w-1/3 border-[#343444] text-yellow-200 bg-transparent hover:bg-[#202030] rounded-xl text-xs"
            >
              Close
            </Button>
            <Button
              onClick={printReceipt}
              className="w-2/3 bg-yellow-400 text-red-950 hover:bg-yellow-500 font-bold rounded-xl shadow text-xs flex items-center justify-center gap-2"
            >
              <Receipt className="w-4 h-4" />
              <span>Print Receipt</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MANAGER OVERRIDE AUTH DIALOG */}
      <Dialog open={managerOverrideOpen} onOpenChange={setManagerOverrideOpen}>
        <DialogContent className="bg-[#13131c] border-[#2a2c3a] text-yellow-100 max-w-md rounded-2xl shadow-2xl p-6">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl border border-yellow-400/30 bg-yellow-400/10 text-yellow-400 shadow-inner">
              <KeyRound className="h-6 w-6" />
            </div>
            <DialogTitle className="text-center text-white text-lg font-bold">
              Manager Authorization Required
            </DialogTitle>
            <p className="text-center text-xs text-yellow-200/70 mt-1">
              {pendingAction?.description || "This action requires manager approval."}
            </p>
          </DialogHeader>

          <form onSubmit={handleManagerAuthorize} className="space-y-3.5 mt-2">
            <div className="space-y-1 text-left">
              <label className="text-xs text-yellow-200/80 font-medium">Manager Username</label>
              <Input
                placeholder="Enter manager username"
                value={managerUsername}
                onChange={(e) => setManagerUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                className="h-10 bg-[#1b1b26] border-[#2e2e42] text-sm text-yellow-100 rounded-xl focus-visible:ring-yellow-400/50"
              />
            </div>
            <div className="space-y-1 text-left">
              <label className="text-xs text-yellow-200/80 font-medium">Manager Password / PIN</label>
              <Input
                type="password"
                placeholder="Enter manager password"
                value={managerPassword}
                onChange={(e) => setManagerPassword(e.target.value)}
                className="h-10 bg-[#1b1b26] border-[#2e2e42] text-sm text-yellow-100 rounded-xl focus-visible:ring-yellow-400/50"
              />
            </div>

            <DialogFooter className="flex items-center gap-2 pt-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setManagerOverrideOpen(false);
                  setPendingAction(null);
                }}
                className="border border-[#2e2e42] text-zinc-400 hover:text-white rounded-xl text-xs h-10"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={managerVerifying}
                className="bg-yellow-400 text-black font-bold hover:bg-yellow-300 rounded-xl text-xs h-10 px-5 shadow"
              >
                {managerVerifying ? "Verifying..." : "Authorize Action"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
