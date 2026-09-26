import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Badge } from "./ui/badge";
import { Edit, Eye, Info, Package, Plus, Search, Settings, Warehouse, SlidersHorizontal, ArrowUpDown, CheckCircle2, AlertTriangle, Layers, TrendingUp, Calendar, DollarSign, X, Check, Filter, Upload } from "lucide-react";
import { toast } from "sonner";
import { useCategories, useInventory, useProducts, useProductsMutations } from "../../lib/hooks";
import { supabase } from "../../lib/supabase";
import { logAuditEvent } from "../../lib/api/audit-logger";
import { cleanProductImageUrl, getWebpageUrlWarning } from "../../lib/image-utils";
import { TablePagination } from "./ui/table-pagination";
import { storeToday } from "../../lib/datetime";

type InventoryStatus = "Active" | "Inactive";
type ProductTab = "list" | "settings" | "inventory";
type ProductEditScope = "this_variant" | "selected_variants" | "all_variants_base";

type UiProduct = {
  id: string;
  product_id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  category_id: string;
  color: string;
  gender: string;
  size: string;
  unit_price: number;
  inventory_id: string;
  stock: number;
  reserved_stock: number;
  available_stock: number;
  reorder_level: number;
  srp: number;
  status: InventoryStatus;
  manufacturer_date: string;
  expiration_date: string;
  hasInventory: boolean;
  isArchived: boolean;
  image_url?: string;
};

type ProductFormData = {
  name: string;
  brand: string;
  category_id: string;
  color: string;
  gender: string;
  size: string;
  unit_price: number;
  image_url: string;
};

type StockFormData = {
  product_id: string;
  stock_in: number | string;
  reserved_quantity: number | string;
  markup_rate: number;
  reorder_level: number | string;
  status: InventoryStatus;
  manufacturer_date: string;
  expiration_date: string;
};

const defaultProductForm: ProductFormData = {
  name: "",
  brand: "",
  category_id: "",
  color: "",
  gender: "",
  size: "",
  unit_price: 0,
  image_url: "",
};

const defaultStockForm: StockFormData = {
  product_id: "",
  stock_in: 0,
  reserved_quantity: 0,
  markup_rate: 0.9,
  reorder_level: 10,
  status: "Active",
  manufacturer_date: "",
  expiration_date: "",
};

const MARKUP_RATE_OPTIONS = [0.1, 0.2, 0.3, 0.35, 0.5, 0.75, 0.9, 1.0];

function buildClientId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function shortId(value: string | null | undefined, head = 8, tail = 6) {
  const text = String(value ?? "").trim();
  if (text.length <= head + tail + 1) return text;
  return `${text.slice(0, head)}...${text.slice(-tail)}`;
}

function toDbStatus(status: InventoryStatus): "active" | "inactive" {
  return status === "Active" ? "active" : "inactive";
}

function toUiStatus(value: string | null | undefined): InventoryStatus {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "active" || normalized === "available" ? "Active" : "Inactive";
}

function getProductStatusMeta(product?: UiProduct) {
  if (!product) return { label: "Not Selected", className: "border-slate-500/30 bg-slate-500/15 text-slate-200" };
  if (!product.hasInventory) return { label: "Unconfigured", className: "border-amber-500/40 bg-amber-500/15 text-amber-200" };
  if (product.status !== "Active") return { label: "Inactive", className: "border-slate-500/30 bg-slate-500/15 text-slate-200" };
  if (isExpiredProduct(product)) return { label: "Expired", className: "border-red-500/40 bg-red-500/15 text-red-200" };
  if (Number(product.available_stock || 0) <= 0) return { label: "Out of Stock", className: "border-red-500/40 bg-red-500/15 text-red-200" };
  if (Number(product.available_stock || 0) <= Number(product.reorder_level || 0)) return { label: "Low Stock", className: "border-yellow-400/40 bg-yellow-400/15 text-yellow-100" };
  return { label: "Active", className: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200" };
}

function isExpiredProduct(product?: Pick<UiProduct, "expiration_date">) {
  const expirationDate = String(product?.expiration_date ?? "").slice(0, 10);
  if (!expirationDate) return false;
  return expirationDate < storeToday();
}

function stockCondition(stock: number, reorder: number, expired = false) {
  if (expired) return { label: "Expired", className: "bg-red-800 text-yellow-100" };
  if (stock <= 0) return { label: "Out of Stock", className: "bg-red-900 text-yellow-100" };
  if (stock <= reorder) return { label: "Critical", className: "bg-red-700 text-yellow-100" };
  if (stock <= reorder + 5) return { label: "Warning", className: "bg-yellow-600 text-red-950" };
  return { label: "Good", className: "bg-green-700 text-white" };
}

function formatMoney(value: number) {
  const num = Number(value || 0);
  return `PHP ${num.toLocaleString(undefined, {
    minimumFractionDigits: num % 1 !== 0 ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function ProductThumbnail({
  src,
  alt,
  className = "w-10 h-10 rounded-lg",
  iconSize = "w-4 h-4",
}: {
  src?: string | null;
  alt: string;
  className?: string;
  iconSize?: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  const cleanSrc = cleanProductImageUrl(src || "");

  // Reset load failure when src changes
  useEffect(() => {
    setLoadFailed(false);
  }, [cleanSrc]);

  return (
    <div className={`${className} bg-[#1a1a27] border border-[#2d2d3f] overflow-hidden flex items-center justify-center mx-auto flex-shrink-0 shadow-sm relative`}>
      {cleanSrc && !loadFailed ? (
        <img
          src={cleanSrc}
          alt={alt}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
          onError={() => setLoadFailed(true)}
        />
      ) : (
        <Package className={`${iconSize} text-yellow-400/40`} />
      )}
    </div>
  );
}

function calculateSrpFromMarkup(unitPrice: number, markupRate: number) {
  const price = Number(unitPrice || 0);
  const rate = Number(markupRate || 0);
  return Math.round((price + price * rate) * 100) / 100;
}

function defaultMarkupRateForProduct(product?: Pick<UiProduct, "unit_price" | "srp">) {
  if (!product || Number(product.unit_price || 0) <= 0) return 0.9;
  const savedMarkup = (Number(product.srp || 0) - Number(product.unit_price || 0)) / Number(product.unit_price || 0);
  if (!Number.isFinite(savedMarkup) || savedMarkup <= 0) return 0.9;

  return MARKUP_RATE_OPTIONS.reduce((closest, option) => {
    return Math.abs(option - savedMarkup) < Math.abs(closest - savedMarkup) ? option : closest;
  }, MARKUP_RATE_OPTIONS[0]);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function productNameWithoutBrand(productName: string, brand: string) {
  const name = String(productName ?? "").trim().replace(/\s+/g, " ");
  const brandName = String(brand ?? "").trim().replace(/\s+/g, " ");
  if (!name || !brandName || brandName.toLowerCase() === "n/a") return name;

  return name
    .replace(new RegExp(`^${escapeRegExp(brandName)}(?:\\s+|[-_/]+)+`, "i"), "")
    .trim() || name;
}

function variantLabel(product: Pick<UiProduct, "color" | "gender" | "size">) {
  return [product.color, product.gender, product.size ? `Size ${product.size}` : ""]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value && value.toLowerCase() !== "n/a" && value.toLowerCase() !== "default")
    .join(" / ") || "Default";
}

function productGroupKey(product: UiProduct) {
  return [product.name, product.brand, product.category].map((value) => value.trim().toLowerCase()).join("::");
}

type ProductManagementProps = {
  view?: ProductTab;
  onViewChange?: (view: ProductTab) => void;
};

export function ProductManagement({ view, onViewChange }: ProductManagementProps = {}) {
  const queryClient = useQueryClient();
  const [internalActiveTab, setInternalActiveTab] = useState<ProductTab>(view ?? "inventory");
  const activeTab = view ?? internalActiveTab;

  const [searchTermByTab, setSearchTermByTab] = useState<Record<string, string>>({ list: "", settings: "", inventory: "" });
  const [selectedCategoryByTab, setSelectedCategoryByTab] = useState<Record<string, string>>({ list: "all", settings: "all", inventory: "all" });
  
  const searchTerm = searchTermByTab[activeTab] ?? "";
  const setSearchTerm = (val: string | ((prev: string) => string)) => {
    setSearchTermByTab((prev) => ({
      ...prev,
      [activeTab]: typeof val === 'function' ? val(prev[activeTab] || "") : val
    }));
  };

  const selectedCategory = selectedCategoryByTab[activeTab] ?? "all";
  const setSelectedCategory = (val: string | ((prev: string) => string)) => {
    setSelectedCategoryByTab((prev) => ({
      ...prev,
      [activeTab]: typeof val === 'function' ? val(prev[activeTab] || "all") : val
    }));
  };

  const [selectedBrand, setSelectedBrand] = useState("all");
  const [selectedGender, setSelectedGender] = useState("all");
  const [selectedStockStatus, setSelectedStockStatus] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<UiProduct | null>(null);
  const [deleteTargetProductId, setDeleteTargetProductId] = useState<string>("");
  const [productForm, setProductForm] = useState<ProductFormData>(defaultProductForm);
  const [editScope, setEditScope] = useState<ProductEditScope>("this_variant");
  const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([]);
  const [stockForm, setStockForm] = useState<StockFormData>(defaultStockForm);
  const [showArchived, setShowArchived] = useState(false);

  const productsQuery = useProducts();
  const inventoryQuery = useInventory();
  const categoriesQuery = useCategories();
  const productMutations = useProductsMutations();

  useEffect(() => {
    if (view) setInternalActiveTab(view);
  }, [view]);

  const setActiveTab = (nextView: ProductTab) => {
    setInternalActiveTab(nextView);
    onViewChange?.(nextView);
  };

  const categories = ((categoriesQuery.data as any[]) ?? []).filter((category: any) => {
    const name = String(category?.category_name ?? "").trim().toLowerCase();
    return !["kid", "kids", "men", "women"].includes(name);
  });

  const inventoryByProductId = useMemo(() => {
    const map = new Map<string, any>();
    for (const row of (inventoryQuery.data as any[]) ?? []) {
      const key = String(row.product_id ?? "");
      if (key) map.set(key, row);
    }
    return map;
  }, [inventoryQuery.data]);

  const products = useMemo<UiProduct[]>(() => {
    return ((productsQuery.data as any[]) ?? []).map((row: any) => {
      const category = Array.isArray(row.category) ? row.category[0] : row.category;
      const inventory = Array.isArray(row.inventory) ? row.inventory[0] : row.inventory ?? inventoryByProductId.get(String(row.product_id ?? ""));
      const brand = String(row.brand ?? "N/A");
      const unitPrice = Number(row.unit_price ?? row.cost_price ?? 0);
      const srp = Number(inventory?.srp ?? row.price ?? row.cost_price ?? unitPrice);
      const reorder = Number(inventory?.reorder_level ?? row.reorder_level ?? 10);
      const stock = Number(inventory?.stock_quantity ?? 0);
      const reserved = Math.min(Math.max(Number(inventory?.reserved_quantity ?? 0), 0), Math.max(stock, 0));
      const status = toUiStatus(inventory?.inventory_status ?? row.status);
      const isArchived = String(row.status ?? "").trim().toLowerCase() === "inactive";
      return {
        id: String(row.product_id ?? ""),
        product_id: String(row.product_id ?? ""),
        sku: String(row.sku ?? row.product_id ?? ""),
        name: productNameWithoutBrand(String(row.product_name ?? "Unnamed Product"), brand),
        brand,
        category: String(category?.category_name ?? "Uncategorized"),
        category_id: String(row.category_id ?? ""),
        color: String(row.color ?? "Default"),
        gender: String(row.gender ?? "N/A"),
        size: String(row.size ?? "N/A"),
        unit_price: unitPrice,
        inventory_id: inventory?.inventory_id ? String(inventory.inventory_id) : "",
        stock,
        reserved_stock: reserved,
        available_stock: Math.max(stock - reserved, 0),
        reorder_level: reorder,
        srp,
        status,
        manufacturer_date: String(inventory?.manufacturer_date ?? ""),
        expiration_date: String(inventory?.expiration_date ?? ""),
        hasInventory: Boolean(inventory?.inventory_id),
        isArchived,
        image_url: cleanProductImageUrl(String(row.image_url ?? "").trim()),
      };
    });
  }, [inventoryByProductId, productsQuery.data]);

  const productMap = useMemo(() => new Map(products.map((product) => [product.product_id, product])), [products]);

  const baseProducts = useMemo(() => {
    const sourceRaw = activeTab === "inventory" ? products.filter((product) => product.hasInventory) : products;
    return activeTab === "list" && !showArchived ? sourceRaw.filter((product) => !product.isArchived) : sourceRaw;
  }, [activeTab, products, showArchived]);

  const availableCategories = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const p of baseProducts) {
      const cat = (p.category || "Uncategorized").trim();
      const key = cat.toLowerCase();
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }

    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const c of categories) {
      const name = String(c.category_name ?? "").trim();
      if (name) {
        const key = name.toLowerCase();
        map.set(key, {
          id: String(c.category_id ?? name),
          name,
          count: countMap.get(key) ?? 0,
        });
      }
    }

    for (const p of baseProducts) {
      const name = (p.category || "Uncategorized").trim();
      const key = name.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          id: p.category_id || name,
          name,
          count: countMap.get(key) ?? 0,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [baseProducts, categories]);

  const availableBrands = useMemo(() => {
    const set = new Set<string>();
    for (const p of baseProducts) {
      if (p.brand && p.brand !== "N/A") set.add(p.brand);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [baseProducts]);

  const availableGenders = useMemo(() => {
    const set = new Set<string>();
    for (const p of baseProducts) {
      if (p.gender && p.gender !== "N/A") set.add(p.gender);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [baseProducts]);

  const filteredProducts = useMemo(() => {
    const q = searchTerm.toLowerCase().trim();
    return baseProducts.filter((product) => {
      const matchesSearch =
        !q ||
        product.name.toLowerCase().includes(q) ||
        product.brand.toLowerCase().includes(q) ||
        product.category.toLowerCase().includes(q) ||
        product.sku.toLowerCase().includes(q) ||
        shortId(product.sku).toLowerCase().includes(q) ||
        product.color.toLowerCase().includes(q) ||
        product.gender.toLowerCase().includes(q) ||
        product.size.toLowerCase().includes(q) ||
        variantLabel(product).toLowerCase().includes(q);

      const matchesCategory =
        selectedCategory === "all" ||
        product.category_id === selectedCategory ||
        product.category.toLowerCase() === selectedCategory.toLowerCase();

      const matchesBrand =
        selectedBrand === "all" ||
        product.brand.toLowerCase() === selectedBrand.toLowerCase();

      const matchesGender =
        selectedGender === "all" ||
        product.gender.toLowerCase() === selectedGender.toLowerCase();

      let matchesStock = true;
      if (selectedStockStatus === "in_stock") {
        matchesStock = product.available_stock > 10;
      } else if (selectedStockStatus === "low_stock") {
        matchesStock = product.available_stock > 0 && product.available_stock <= 10;
      } else if (selectedStockStatus === "out_of_stock") {
        matchesStock = product.available_stock <= 0;
      } else if (selectedStockStatus === "unconfigured") {
        matchesStock = !product.hasInventory;
      }

      return matchesSearch && matchesCategory && matchesBrand && matchesGender && matchesStock;
    });
  }, [baseProducts, searchTerm, selectedCategory, selectedBrand, selectedGender, selectedStockStatus]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCategory, selectedBrand, selectedGender, selectedStockStatus, activeTab]);

  const totalProductPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const safeProductPage = Math.min(Math.max(1, currentPage), totalProductPages);
  const paginatedProducts = useMemo(() => {
    return filteredProducts.slice((safeProductPage - 1) * pageSize, safeProductPage * pageSize);
  }, [filteredProducts, safeProductPage, pageSize]);

  const selectedSettingsProduct = productMap.get(stockForm.product_id);
  const editableVariantGroup = useMemo(() => {
    if (!editingProduct) return [] as UiProduct[];
    const key = productGroupKey(editingProduct);
    return products
      .filter((product) => productGroupKey(product) === key)
      .sort((a, b) => `${a.color} ${a.size}`.localeCompare(`${b.color} ${b.size}`, undefined, { numeric: true }));
  }, [editingProduct, products]);
  const isExternallyRouted = Boolean(view);

  const openAddProduct = () => {
    setEditingProduct(null);
    setDeleteTargetProductId("");
    setEditScope("this_variant");
    setSelectedVariantIds([]);
    setProductForm(defaultProductForm);
    setIsProductDialogOpen(true);
  };

  const openEditProduct = (product: UiProduct) => {
    setEditingProduct(product);
    setDeleteTargetProductId(product.product_id);
    setProductForm({
      name: product.name,
      brand: product.brand === "N/A" ? "" : product.brand,
      category_id: product.category_id,
      color: product.color === "Default" ? "" : product.color,
      gender: product.gender === "N/A" ? "" : product.gender,
      size: product.size === "N/A" ? "" : product.size,
      unit_price: product.unit_price,
      image_url: product.image_url || "",
    });
    const variantIds = products
      .filter((candidate) => productGroupKey(candidate) === productGroupKey(product))
      .map((candidate) => candidate.product_id);
    setEditScope("this_variant");
    setSelectedVariantIds(variantIds);
    setIsProductDialogOpen(true);
  };

  const openSettingsForProduct = (product: UiProduct) => {
    setActiveTab("settings");
    setStockForm({
      product_id: product.product_id,
      stock_in: 0,
      reserved_quantity: product.reserved_stock || 0,
      markup_rate: defaultMarkupRateForProduct(product),
      reorder_level: product.reorder_level || 10,
      status: product.status,
      manufacturer_date: product.manufacturer_date ? product.manufacturer_date.slice(0, 10) : "",
      expiration_date: product.expiration_date ? product.expiration_date.slice(0, 10) : "",
    });
  };

  const validateProductForm = () => {
    if (!productForm.name.trim()) return "Product name is required.";
    if (!productForm.brand.trim()) return "Brand is required.";
    if (!productNameWithoutBrand(productForm.name, productForm.brand)) {
      return "Product name should include the model/style, not only the brand.";
    }
    if (!productForm.category_id) return "Category is required.";
    if (!productForm.size || !productForm.size.trim()) {
      return "Size is required.";
    }
    if (!productForm.unit_price || Number(productForm.unit_price) <= 0) {
      return "Unit price is required and must be greater than 0.";
    }
    if (isNaN(Number(productForm.unit_price))) {
      return "Unit price must be a valid number.";
    }
    return "";
  };

  const saveProduct = async () => {
    const validation = validateProductForm();
    if (validation) return toast.error(validation);

    const cleanProductName = productNameWithoutBrand(productForm.name, productForm.brand);
    const trimmedImageUrl = cleanProductImageUrl(productForm.image_url?.trim() || "") || null;
    const basePayload: any = {
      product_name: cleanProductName,
      brand: productForm.brand.trim(),
      category_id: productForm.category_id,
      cost_price: Number(productForm.unit_price || 0),
      image_url: trimmedImageUrl,
    };

    const thisVariantPayload: any = {
      ...basePayload,
      size: productForm.size.trim() || null,
      color: productForm.color.trim() || null,
      gender: productForm.gender || null,
      image_url: trimmedImageUrl,
    };

    try {
      if (editingProduct) {
        if (editScope === "this_variant") {
          await productMutations.updateMutation.mutateAsync({ id: editingProduct.product_id, payload: thisVariantPayload });
          logAuditEvent({
            action_type: "PRODUCT_UPDATED",
            entity_type: "PRODUCT",
            entity_id: editingProduct.product_id,
            old_data: { name: editingProduct.name, price: editingProduct.unit_price, size: editingProduct.size },
            new_data: thisVariantPayload,
          });
          toast.success("Product variant updated.");
        } else {
          const targetIds =
            editScope === "all_variants_base"
              ? editableVariantGroup.map((variant) => variant.product_id)
              : selectedVariantIds.filter((id) => editableVariantGroup.some((variant) => variant.product_id === id));
          if (!targetIds.length) {
            return toast.error("Select at least one variant to update.");
          }
          let { error } = await supabase.from("product").update(basePayload as any).in("product_id", targetIds);
          if (error && String(error.message ?? "").toLowerCase().includes("image_url")) {
            const { image_url, ...restPayload } = basePayload;
            const retry = await supabase.from("product").update(restPayload as any).in("product_id", targetIds);
            error = retry.error;
          }
          if (error) throw error;
          logAuditEvent({
            action_type: "PRODUCT_UPDATED",
            entity_type: "PRODUCT",
            entity_id: targetIds.join(","),
            metadata: { updated_count: targetIds.length, scope: editScope },
            new_data: basePayload,
          });
          toast.success(`Updated ${targetIds.length} variant${targetIds.length === 1 ? "" : "s"} (base fields only).`);
        }
      } else {
        await productMutations.createMutation.mutateAsync(thisVariantPayload);
        logAuditEvent({
          action_type: "PRODUCT_CREATED",
          entity_type: "PRODUCT",
          entity_id: cleanProductName,
          new_data: thisVariantPayload,
        });
        toast.success("Product added to Product List.");
      }
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      setIsProductDialogOpen(false);
      setEditingProduct(null);
      setDeleteTargetProductId("");
      setEditScope("this_variant");
      setSelectedVariantIds([]);
      setProductForm(defaultProductForm);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to save product");
    }
  };

  const saveProductSettings = async () => {
    const product = selectedSettingsProduct;
    if (!product) return toast.error("Select an existing product first.");
    if (Number(stockForm.stock_in) < 0) return toast.error("Stock-in quantity cannot be negative.");
    if (!product.hasInventory && Number(stockForm.stock_in) <= 0) {
      return toast.error("Stock-in quantity must be greater than 0 for new inventory.");
    }
    const computedSrp = calculateSrpFromMarkup(product.unit_price, stockForm.markup_rate);
    if (Number(product.unit_price) <= 0) {
      return toast.error("Unit price must be greater than 0 before SRP can be calculated.");
    }
    if (computedSrp <= Number(product.unit_price)) {
      return toast.error("Select a markup greater than 0 to calculate SRP.");
    }
    if (Number(stockForm.reorder_level) < 0) return toast.error("Reorder level must be greater than or equal to 0.");
    if (stockForm.manufacturer_date && stockForm.expiration_date && stockForm.expiration_date < stockForm.manufacturer_date) {
      return toast.error("Expiration date must not be earlier than manufacturer date.");
    }

    const nextStock = Number(product.stock || 0) + Number(stockForm.stock_in || 0);
    const requestedReserved = Math.max(Number(stockForm.reserved_quantity || 0), 0);
    if (requestedReserved > nextStock) {
      return toast.error("Held stock cannot be greater than total on-hand stock.");
    }
    const nextReserved = requestedReserved;
    const inventoryPayload = {
      stock_quantity: nextStock,
      reserved_quantity: nextReserved,
      reorder_level: Number(stockForm.reorder_level || 0),
      srp: computedSrp,
      inventory_status: toDbStatus(stockForm.status),
      manufacturer_date: stockForm.manufacturer_date || null,
      expiration_date: stockForm.expiration_date || null,
      last_updated: new Date().toISOString(),
    };

    try {
      if (product.inventory_id) {
        const { error } = await supabase
          .from("inventory")
          .update(inventoryPayload as any)
          .eq("inventory_id", product.inventory_id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("inventory").insert({
          inventory_id: buildClientId("inv"),
          product_id: product.product_id,
          ...inventoryPayload,
        });
        if (error) throw error;
      }

      if (Number(stockForm.stock_in) !== 0) {
        const { error: logError } = await supabase.from("inventory_log").insert({
          inventory_log_id: buildClientId("log"),
          product_id: product.product_id,
          quantity_change: Number(stockForm.stock_in),
          transaction_type: "restock",
          reference_id: product.inventory_id || null,
          date_updated: new Date().toISOString(),
        });
        if (logError) throw logError;
      }

      const reservedDelta = nextReserved - Number(product.reserved_stock || 0);
      if (reservedDelta !== 0) {
        const { error: holdLogError } = await supabase.from("inventory_log").insert({
          inventory_log_id: buildClientId("log"),
          product_id: product.product_id,
          quantity_change: Math.abs(reservedDelta),
          transaction_type: reservedDelta > 0 ? "hold" : "release_hold",
          reference_id: product.inventory_id || null,
          date_updated: new Date().toISOString(),
        });
        if (holdLogError) throw holdLogError;
      }

      logAuditEvent({
        action_type: "STOCK_ADJUSTED",
        entity_type: "INVENTORY",
        entity_id: product.product_id,
        metadata: {
          product_name: product.name,
          added_stock: stockForm.stock_in,
          new_srp: computedSrp,
          reorder_level: stockForm.reorder_level,
        },
      });

      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["products"] }),
        queryClient.refetchQueries({ queryKey: ["inventory"] }),
        queryClient.refetchQueries({ queryKey: ["inventoryLog"] }),
      ]);
      toast.success("Product settings saved and inventory updated.");
      if (selectedStockStatus === "out_of_stock") {
        setSelectedStockStatus("all");
      }
      setStockForm(defaultStockForm);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to save product settings");
    }
  };

  const updateProductArchiveStatus = async (productId: string, status: "active" | "inactive") => {
    const { data, error } = await supabase
      .from("product")
      .update({ status } as any)
      .eq("product_id", productId)
      .select("product_id, status")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error(`No product row was updated for product_id=${productId}. Check RLS permissions and record id.`);
    }
    return data;
  };

  const deleteProduct = async (productId: string) => {
    const product = productMap.get(productId);
    if (!product) {
      toast.error("Selected product was not found.");
      return;
    }
    if (product.isArchived) {
      try {
        await updateProductArchiveStatus(productId, "active");

        const { error: restoreInventoryError } = await supabase
          .from("inventory")
          .update({
            inventory_status: "active",
            last_updated: new Date().toISOString(),
          } as any)
          .eq("product_id", productId);
        if (restoreInventoryError) throw restoreInventoryError;

        logAuditEvent({
          action_type: "PRODUCT_UPDATED",
          entity_type: "PRODUCT",
          entity_id: productId,
          metadata: { action: "RESTORED", name: product.name, sku: product.sku },
        });

        await queryClient.invalidateQueries({ queryKey: ["products"] });
        await queryClient.invalidateQueries({ queryKey: ["inventory"] });
        setIsProductDialogOpen(false);
        setEditingProduct(null);
        setDeleteTargetProductId("");
        toast.success("Product restored.");
        return;
      } catch (error: any) {
        toast.error(error?.message ?? "Failed to restore product");
        return;
      }
    }

    try {
      // Remove related inventory logs and inventory rows first to satisfy FK constraints.
      const { error: logDeleteError } = await supabase
        .from("inventory_log")
        .delete()
        .eq("product_id", productId);
      if (logDeleteError) throw logDeleteError;

      const { error: inventoryDeleteError } = await supabase
        .from("inventory")
        .delete()
        .eq("product_id", productId);
      if (inventoryDeleteError) throw inventoryDeleteError;

      await productMutations.removeMutation.mutateAsync(productId);
      logAuditEvent({
        action_type: "PRODUCT_ARCHIVED",
        entity_type: "PRODUCT",
        entity_id: productId,
        metadata: { action: "DELETED", name: product.name, sku: product.sku },
      });

      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["inventoryLog"] });
      await queryClient.invalidateQueries({ queryKey: ["returns"] });
      setIsProductDialogOpen(false);
      setEditingProduct(null);
      setDeleteTargetProductId("");
      toast.success("Product deleted from Product List.");
    } catch (error: any) {
      const message = String(error?.message ?? "").toLowerCase();
      const blockedByHistory =
        message.includes("foreign key") ||
        message.includes("sales_details_product_id_fkey") ||
        message.includes("violates") ||
        message.includes("no product row was deleted");

      if (blockedByHistory) {
        try {
          // Keep sales history intact: archive product instead of hard delete.
          await updateProductArchiveStatus(productId, "inactive");

          const { error: archiveInventoryError } = await supabase
            .from("inventory")
            .update({
              inventory_status: "inactive",
              stock_quantity: 0,
              last_updated: new Date().toISOString(),
            } as any)
            .eq("product_id", productId);
          if (archiveInventoryError) throw archiveInventoryError;

          await queryClient.invalidateQueries({ queryKey: ["products"] });
          await queryClient.invalidateQueries({ queryKey: ["inventory"] });
          setIsProductDialogOpen(false);
          setEditingProduct(null);
          setDeleteTargetProductId("");
          toast.success("Product is linked to sales history and was archived instead.");
          return;
        } catch (archiveError: any) {
          toast.error(archiveError?.message ?? "Failed to archive product");
          return;
        }
      }

      toast.error(error?.message ?? "Failed to delete product");
    }
  };

  return (
    <div className="space-y-4">
      {!isExternallyRouted && <Card className="bg-red-700 border-red-800">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="text-yellow-300 flex items-center gap-2">
                <Package className="w-5 h-5" />
                Inventory Module
              </CardTitle>
              <p className="text-sm text-yellow-200/80 mt-1">Separate master products, item settings, and sellable inventory.</p>
            </div>
            <Dialog open={isProductDialogOpen} onOpenChange={setIsProductDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={openAddProduct} className="bg-yellow-400 text-black hover:bg-yellow-300 font-bold">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Product
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#15161d] border-[#2a2c36] text-yellow-100 max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="text-yellow-300">{editingProduct ? "Edit Product" : "Add Product"}</DialogTitle>
                </DialogHeader>
                <ProductMasterForm formData={productForm} setFormData={setProductForm} categories={categories} products={products} />
                {editingProduct && (
                  <VariantUpdateScope
                    editScope={editScope}
                    setEditScope={setEditScope}
                    editableVariantGroup={editableVariantGroup}
                    selectedVariantIds={selectedVariantIds}
                    setSelectedVariantIds={setSelectedVariantIds}
                  />
                )}
                <DialogFooter>
                  <Button onClick={saveProduct} className="bg-yellow-400 text-black hover:bg-yellow-300 font-bold">
                    {editingProduct ? "Update Product" : "Save Product"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 md:grid-cols-3">
            <TabButton active={activeTab === "list"} onClick={() => setActiveTab("list")} icon={<Package className="w-4 h-4" />} label="Product List" />
            <TabButton active={activeTab === "settings"} onClick={() => setActiveTab("settings")} icon={<Settings className="w-4 h-4" />} label="Product Settings" />
            <TabButton active={activeTab === "inventory"} onClick={() => setActiveTab("inventory")} icon={<Warehouse className="w-4 h-4" />} label="Inventory" />
          </div>
        </CardContent>
      </Card>}

      {activeTab === "settings" ? (
        <ProductSettingsPage
          products={products}
          categories={categories}
          stockForm={stockForm}
          setStockForm={setStockForm}
          selectedProduct={selectedSettingsProduct}
          onSave={saveProductSettings}
        />
      ) : (
        <Card className="bg-[#15151D] border-[#24242F]">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-yellow-300 flex items-center gap-2">
                {activeTab === "list" ? <Package className="w-5 h-5 text-yellow-400" /> : <Warehouse className="w-5 h-5 text-yellow-400" />}
                {activeTab === "list" ? "Product List / Master Data" : "Sellable Inventory"}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Badge className="bg-yellow-400 text-black font-semibold">{filteredProducts.length} records</Badge>
                {activeTab === "list" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setShowArchived((prev) => !prev)}
                    className="border border-[#2d2d3a] text-yellow-200 hover:bg-[#252533]"
                  >
                    {showArchived ? "Hide Archived" : "Show Archived"}
                  </Button>
                )}
                {activeTab === "list" && isExternallyRouted && (
                  <Dialog open={isProductDialogOpen} onOpenChange={setIsProductDialogOpen}>
                    <DialogTrigger asChild>
                      <Button onClick={openAddProduct} className="bg-yellow-400 text-black hover:bg-yellow-300 font-bold">
                        <Plus className="w-4 h-4 mr-2" />
                        Add Product
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="bg-[#15161d] border-[#2a2c36] text-yellow-100 max-w-2xl">
                      <DialogHeader>
                        <DialogTitle className="text-yellow-300">{editingProduct ? "Edit Product" : "Add Product"}</DialogTitle>
                      </DialogHeader>
                      <ProductMasterForm formData={productForm} setFormData={setProductForm} categories={categories} products={products} />
                      {editingProduct && (
                        <VariantUpdateScope
                          editScope={editScope}
                          setEditScope={setEditScope}
                          editableVariantGroup={editableVariantGroup}
                          selectedVariantIds={selectedVariantIds}
                          setSelectedVariantIds={setSelectedVariantIds}
                        />
                      )}
                      <DialogFooter className="flex items-center justify-between gap-2">
                        {editingProduct ? (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => void deleteProduct(deleteTargetProductId || editingProduct.product_id)}
                            className="text-red-300 hover:bg-red-800/70 hover:text-red-100"
                          >
                            {editingProduct.isArchived ? "Restore Product" : "Delete / Archive Product"}
                          </Button>
                        ) : <span />}
                        <Button onClick={saveProduct} className="bg-yellow-400 text-black hover:bg-yellow-300 font-bold">
                          {editingProduct ? "Update Product" : "Save Product"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Search and Multi-Dimensional Filter Controls */}
            <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-2.5">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-400" />
                <Input
                  placeholder={activeTab === "inventory" ? "Search by SKU, product, brand, category, or variant..." : "Search by SKU, product, brand, or category..."}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  className="pl-10 pr-9 bg-[#12121A] border-[#24242F] text-white placeholder:text-zinc-500 focus-visible:ring-yellow-400/40"
                />
                {searchTerm && (
                  <button
                    type="button"
                    onClick={() => setSearchTerm("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Category Filter Dropdown */}
              <div className="w-full xl:w-48 shrink-0">
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="h-10 bg-[#12121A] border-[#24242F] text-white focus:ring-yellow-400/40">
                    <div className="flex items-center gap-2 truncate">
                      <Filter className="w-4 h-4 text-yellow-400 shrink-0" />
                      <span className="truncate">
                        {selectedCategory === "all"
                          ? "All Categories"
                          : availableCategories.find(
                              (c) =>
                                c.id === selectedCategory ||
                                c.name.toLowerCase() === selectedCategory.toLowerCase()
                            )?.name ?? selectedCategory}
                      </span>
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-[#15161d] border-[#2a2c36] text-white max-h-72">
                    <SelectItem value="all">
                      All Categories ({baseProducts.length})
                    </SelectItem>
                    {availableCategories.map((cat) => (
                      <SelectItem key={cat.id || cat.name} value={cat.name}>
                        {cat.name} ({cat.count})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Brand Filter Dropdown */}
              <div className="w-full xl:w-40 shrink-0">
                <Select value={selectedBrand} onValueChange={setSelectedBrand}>
                  <SelectTrigger className="h-10 bg-[#12121A] border-[#24242F] text-white focus:ring-yellow-400/40">
                    <SelectValue placeholder="All Brands" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#15161d] border-[#2a2c36] text-white max-h-72">
                    <SelectItem value="all">All Brands</SelectItem>
                    {availableBrands.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Department / Gender Filter Dropdown */}
              <div className="w-full xl:w-36 shrink-0">
                <Select value={selectedGender} onValueChange={setSelectedGender}>
                  <SelectTrigger className="h-10 bg-[#12121A] border-[#24242F] text-white focus:ring-yellow-400/40">
                    <SelectValue placeholder="All Depts" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#15161d] border-[#2a2c36] text-white max-h-72">
                    <SelectItem value="all">All Depts</SelectItem>
                    {availableGenders.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Stock Status Filter Dropdown */}
              <div className="w-full xl:w-36 shrink-0">
                <Select value={selectedStockStatus} onValueChange={setSelectedStockStatus}>
                  <SelectTrigger className="h-10 bg-[#12121A] border-[#24242F] text-white focus:ring-yellow-400/40">
                    <SelectValue placeholder="All Stock" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#15161d] border-[#2a2c36] text-white max-h-72">
                    <SelectItem value="all">All Stock</SelectItem>
                    <SelectItem value="unconfigured">Unconfigured</SelectItem>
                    <SelectItem value="in_stock">In Stock (&gt;10)</SelectItem>
                    <SelectItem value="low_stock">Low Stock (1-10)</SelectItem>
                    <SelectItem value="out_of_stock">Out of Stock (0)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Quick-filter Category Pills */}
            {availableCategories.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs scrollbar-thin scrollbar-thumb-zinc-800">
                <span className="text-zinc-500 font-medium shrink-0 mr-1 text-[11px] uppercase tracking-wider">
                  Category:
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedCategory("all")}
                  className={`px-3 py-1 rounded-full border transition-all shrink-0 font-medium ${
                    selectedCategory === "all"
                      ? "bg-yellow-400 text-black border-yellow-400 font-bold shadow-sm"
                      : "bg-[#181824] border-[#24242F] text-zinc-300 hover:border-yellow-400/40 hover:text-white"
                  }`}
                >
                  All ({baseProducts.length})
                </button>
                {availableCategories.map((cat) => {
                  const isSelected =
                    selectedCategory.toLowerCase() === cat.name.toLowerCase() ||
                    selectedCategory === cat.id;
                  return (
                    <button
                      key={cat.id || cat.name}
                      type="button"
                      onClick={() => setSelectedCategory(isSelected ? "all" : cat.name)}
                      className={`px-3 py-1 rounded-full border transition-all shrink-0 font-medium ${
                        isSelected
                          ? "bg-yellow-400 text-black border-yellow-400 font-bold shadow-sm"
                          : "bg-[#181824] border-[#24242F] text-zinc-300 hover:border-yellow-400/40 hover:text-white"
                      }`}
                    >
                      {cat.name} <span className="opacity-70 text-[10px]">({cat.count})</span>
                    </button>
                  );
                })}
                {(selectedCategory !== "all" || searchTerm || selectedBrand !== "all" || selectedGender !== "all" || selectedStockStatus !== "all") && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory("all");
                      setSearchTerm("");
                      setSelectedBrand("all");
                      setSelectedGender("all");
                      setSelectedStockStatus("all");
                      setCurrentPage(1);
                    }}
                    className="text-xs text-yellow-400/80 hover:text-yellow-300 underline underline-offset-2 shrink-0 ml-2"
                  >
                    Clear filters
                  </button>
                )}
              </div>
            )}

            {/* Active Filter Info Notice */}
            {(selectedCategory !== "all" || searchTerm || selectedBrand !== "all" || selectedGender !== "all" || selectedStockStatus !== "all") && (
              <div className="flex items-center justify-between text-xs text-zinc-400 px-1 pt-1">
                <span>
                  Showing <strong className="text-yellow-400">{filteredProducts.length}</strong> matching items
                  {selectedCategory !== "all" && (
                    <> in category <strong className="text-white">"{selectedCategory}"</strong></>
                  )}
                  {selectedBrand !== "all" && (
                    <> &bull; brand <strong className="text-white">"{selectedBrand}"</strong></>
                  )}
                  {selectedGender !== "all" && (
                    <> &bull; dept <strong className="text-white">"{selectedGender}"</strong></>
                  )}
                  {selectedStockStatus !== "all" && (
                    <> &bull; status <strong className="text-white">"{selectedStockStatus.replace(/_/g, " ")}"</strong></>
                  )}
                  {searchTerm && (
                    <> matching <strong className="text-white">"{searchTerm}"</strong></>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCategory("all");
                    setSearchTerm("");
                    setSelectedBrand("all");
                    setSelectedGender("all");
                    setSelectedStockStatus("all");
                    setCurrentPage(1);
                  }}
                  className="text-yellow-400 hover:underline cursor-pointer"
                >
                  Reset all
                </button>
              </div>
            )}

            {activeTab === "list" ? (
              <ProductListTable products={paginatedProducts} onEdit={openEditProduct} onConfigure={openSettingsForProduct} />
            ) : (
              <InventoryTable products={paginatedProducts} onConfigure={openSettingsForProduct} />
            )}

            <TablePagination
              currentPage={safeProductPage}
              pageSize={pageSize}
              totalItems={filteredProducts.length}
              onPageChange={setCurrentPage}
              onPageSizeChange={setPageSize}
              pageSizeOptions={[10, 15, 25, 50, 100]}
              unitName={activeTab === "list" ? "products" : "items"}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      className={active ? "bg-yellow-400 text-black font-bold hover:bg-yellow-300" : "bg-[#181824] border border-[#24242F] text-zinc-300 hover:text-white hover:bg-[#20202e]"}
    >
      {icon}
      <span className="ml-2">{label}</span>
    </Button>
  );
}

function ProductListTable({ products, onEdit, onConfigure }: { products: UiProduct[]; onEdit: (product: UiProduct) => void; onConfigure?: (product: UiProduct) => void }) {
  return (
    <div className="border border-[#24242F] rounded-xl overflow-x-auto bg-[#111118]">
      <Table className="w-full min-w-[1040px]">
        <TableHeader>
          <TableRow className="bg-[#181824] hover:bg-[#181824] border-[#24242F]">
            {['Image', 'SKU', 'Product', 'Brand', 'Category', 'Color', 'Department', 'Size', 'Unit Price', 'Actions'].map((head) => (
              <TableHead key={head} className="text-yellow-300 text-center whitespace-nowrap">{head}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.product_id} className={`border-[#24242F] hover:bg-white/[0.02] ${product.isArchived ? "opacity-55" : ""}`}>
              <TableCell className="text-center align-middle py-2 px-3">
                <ProductThumbnail src={product.image_url} alt={product.name} />
              </TableCell>
              <TableCell className="text-yellow-200 text-center whitespace-nowrap font-mono" title={product.sku}>{shortId(product.sku)}</TableCell>
              <TableCell className="text-yellow-200 text-center whitespace-nowrap">
                <span>{product.name}</span>
              </TableCell>
              <TableCell className="text-yellow-200 text-center whitespace-nowrap">{product.brand}</TableCell>
              <TableCell className="text-yellow-200 text-center whitespace-nowrap">{product.category}</TableCell>
              <TableCell className="text-yellow-200 text-center whitespace-nowrap">{product.color}</TableCell>
              <TableCell className="text-yellow-200 text-center whitespace-nowrap">{product.gender}</TableCell>
              <TableCell className="text-yellow-200 text-center whitespace-nowrap">{product.size}</TableCell>
              <TableCell className="text-yellow-300 text-center whitespace-nowrap">{formatMoney(product.unit_price)}</TableCell>
              <TableCell className="text-center whitespace-nowrap">
                <div className="flex justify-center gap-2">
                  <Button size="sm" variant="ghost" title="Edit product master" className="text-yellow-400 hover:bg-zinc-800" onClick={() => onEdit(product)}><Edit className="w-4 h-4" /></Button>
                  {onConfigure && (
                    <Button size="sm" variant="ghost" title={product.hasInventory ? "Product settings & stock" : "Configure initial stock & pricing"} className="text-yellow-400 hover:bg-zinc-800" onClick={() => onConfigure(product)}>
                      <Settings className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function InventoryTable({ products, onConfigure }: { products: UiProduct[]; onConfigure: (product: UiProduct) => void }) {
  const [selectedProduct, setSelectedProduct] = useState<UiProduct | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const openDetails = (product: UiProduct) => {
    setSelectedProduct(product);
    setIsDetailsOpen(true);
  };

  return (
    <div className="border border-[#24242F] rounded-xl overflow-x-auto bg-[#111118]">
      <Table className="w-full min-w-[820px]">
        <TableHeader>
          <TableRow className="bg-[#181824] hover:bg-[#181824] border-[#24242F]">
            {["Image", "Product", "Variant", "Price", "Available", "Status", "Actions"].map((head) => (
              <TableHead key={head} className="text-yellow-300 text-center whitespace-nowrap">{head}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => {
            return (
              <TableRow key={product.product_id} className="border-[#24242F] hover:bg-white/[0.02]">
                <TableCell className="text-center align-middle py-2 px-3">
                  <ProductThumbnail src={product.image_url} alt={product.name} />
                </TableCell>
                <TableCell className="text-yellow-200 text-center whitespace-nowrap font-medium">{product.name}</TableCell>
                <TableCell className="text-center">
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    {product.color && product.color.toLowerCase() !== "n/a" && product.color.toLowerCase() !== "default" && (
                      <span className="text-[11px] font-medium text-white px-2 py-0.5 rounded bg-black/40 border border-white/10">
                        {product.color}
                      </span>
                    )}
                    {product.size && product.size.toLowerCase() !== "n/a" && product.size.toLowerCase() !== "default" && (
                      <span className="text-[11px] font-bold text-yellow-300 px-2 py-0.5 rounded bg-black/50 border border-yellow-400/40">
                        Size {product.size}
                      </span>
                    )}
                    {product.gender && product.gender.toLowerCase() !== "n/a" && product.gender.toLowerCase() !== "default" && (
                      <span className="text-[10px] text-yellow-200/60 font-medium px-1.5 py-0.5 rounded bg-black/20">
                        {product.gender}
                      </span>
                    )}
                    {(!product.color || product.color.toLowerCase() === "n/a" || product.color.toLowerCase() === "default") &&
                     (!product.size || product.size.toLowerCase() === "n/a" || product.size.toLowerCase() === "default") &&
                     (!product.gender || product.gender.toLowerCase() === "n/a" || product.gender.toLowerCase() === "default") && (
                      <span className="text-xs text-yellow-200/50">Standard</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-yellow-300 text-center whitespace-nowrap">{formatMoney(product.srp)}</TableCell>
                <TableCell className="text-center whitespace-nowrap">
                  <Badge className={product.available_stock > 0 ? "bg-green-700 text-white" : "bg-red-800 text-yellow-100"}>
                    {product.available_stock} available
                  </Badge>
                </TableCell>
                <TableCell className="text-center whitespace-nowrap"><Badge className={product.status === 'Active' ? 'bg-green-600 text-white' : 'bg-gray-600 text-white'}>{product.status}</Badge></TableCell>
                <TableCell className="text-center whitespace-nowrap">
                  <div className="flex justify-center gap-2">
                    <Button size="sm" variant="ghost" title="View details" className="text-yellow-400 hover:bg-zinc-800" onClick={() => openDetails(product)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" title="Product settings" className="text-yellow-400 hover:bg-zinc-800" onClick={() => onConfigure(product)}>
                      <Settings className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="max-w-xl border-[#2d2d3a] bg-[#15151d] text-yellow-100">
          <DialogHeader>
            <DialogTitle className="text-yellow-300">Inventory Details</DialogTitle>
          </DialogHeader>
          {selectedProduct && (() => {
            const condition = stockCondition(
              selectedProduct.available_stock,
              selectedProduct.reorder_level,
              isExpiredProduct(selectedProduct),
            );
            const isActive = String(selectedProduct.status ?? "").toLowerCase() === "active";
            const variantChips = [
              selectedProduct.category,
              selectedProduct.color,
              selectedProduct.gender,
              selectedProduct.size ? `Size ${selectedProduct.size}` : "",
            ]
              .map((value) => String(value ?? "").trim())
              .filter((value) => value && !["n/a", "default"].includes(value.toLowerCase()));
            const manufactured = String(selectedProduct.manufacturer_date ?? "").slice(0, 10);
            const expires = String(selectedProduct.expiration_date ?? "").slice(0, 10);
            const onHand = Math.max(1, Number(selectedProduct.stock) || 0);
            const availablePct = Math.min(100, Math.round((Number(selectedProduct.available_stock) / onHand) * 100));

            return (
              <div className="space-y-4">
                {/* Identity: what it is, what it costs, whether it can be sold */}
                <div className="flex gap-4 rounded-xl border border-[#2d2d40] bg-[#1a1a27] p-4">
                  <ProductThumbnail
                    src={selectedProduct.image_url}
                    alt={selectedProduct.name}
                    className="w-20 h-20 rounded-xl shrink-0"
                    iconSize="w-7 h-7"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-yellow-300/70">{selectedProduct.brand}</p>
                    <p className="truncate text-lg font-bold leading-tight text-white">{selectedProduct.name}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {variantChips.map((chip) => (
                        <span key={chip} className="rounded-md border border-[#34344a] bg-[#222232] px-2 py-0.5 text-[11px] text-zinc-300">
                          {chip}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xl font-bold text-yellow-300">{formatMoney(selectedProduct.srp)}</p>
                    <div className="mt-2 flex flex-col items-end gap-1">
                      <Badge className={isActive ? "bg-emerald-600/20 text-emerald-300 border-emerald-500/30" : "bg-zinc-700 text-zinc-300"}>
                        {selectedProduct.status}
                      </Badge>
                      <Badge className={condition.className}>{condition.label}</Badge>
                    </div>
                  </div>
                </div>

                {/* Stock at a glance */}
                <div className="rounded-xl border border-[#2d2d40] bg-[#1a1a27] p-4">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-zinc-400">Available to sell</p>
                      <p className="text-3xl font-bold leading-none text-white">
                        {selectedProduct.available_stock}
                        <span className="ml-1 text-sm font-medium text-zinc-400">units</span>
                      </p>
                    </div>
                    <div className="flex gap-5 text-right text-xs">
                      <div>
                        <p className="text-zinc-400">On hand</p>
                        <p className="text-base font-semibold text-zinc-100">{selectedProduct.stock}</p>
                      </div>
                      <div>
                        <p className="text-zinc-400">Held</p>
                        <p className="text-base font-semibold text-zinc-100">{selectedProduct.reserved_stock}</p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#2a2a3a]">
                    <div className="h-full rounded-full bg-yellow-400" style={{ width: `${availablePct}%` }} />
                  </div>
                  <p className="mt-2 text-[11px] text-zinc-400">
                    Reorder when available stock reaches <span className="font-semibold text-zinc-200">{selectedProduct.reorder_level}</span> units
                  </p>
                </div>

                {/* Record details: only what exists */}
                <dl className="divide-y divide-[#2a2a3a] rounded-xl border border-[#2d2d40] bg-[#1a1a27] px-4 text-sm">
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <dt className="text-zinc-400">SKU</dt>
                    <dd className="flex items-center gap-2 font-mono text-xs text-zinc-200">
                      <span title={selectedProduct.sku}>{shortId(selectedProduct.sku, 8, 4)}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(String(selectedProduct.sku ?? "")).then(
                            () => toast.success("SKU copied"),
                            () => toast.error("Could not copy SKU"),
                          );
                        }}
                        className="rounded border border-[#34344a] px-1.5 py-0.5 font-sans text-[10px] text-yellow-300 hover:bg-[#262636]"
                      >
                        Copy
                      </button>
                    </dd>
                  </div>
                  {manufactured && (
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-zinc-400">Manufactured</dt>
                      <dd className="text-zinc-200">{manufactured}</dd>
                    </div>
                  )}
                  {expires && (
                    <div className="flex items-center justify-between gap-3 py-2.5">
                      <dt className="text-zinc-400">Expires</dt>
                      <dd className={isExpiredProduct(selectedProduct) ? "font-semibold text-red-400" : "text-zinc-200"}>{expires}</dd>
                    </div>
                  )}
                </dl>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductSettingsPage({
  products,
  categories,
  stockForm,
  setStockForm,
  selectedProduct,
  onSave,
}: {
  products: UiProduct[];
  categories: any[];
  stockForm: StockFormData;
  setStockForm: (data: StockFormData) => void;
  selectedProduct?: UiProduct;
  onSave: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedBrand, setSelectedBrand] = useState("all");
  const [selectedStockFilter, setSelectedStockFilter] = useState<"all" | "in_stock" | "low_stock" | "out_of_stock" | "inactive" | "unconfigured">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [isConfigDialogOpen, setIsConfigDialogOpen] = useState(false);
  const [activeProduct, setActiveProduct] = useState<UiProduct | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Auto-open modal if a product was selected externally (e.g. from Product List or Inventory)
  useEffect(() => {
    if (selectedProduct && (!activeProduct || activeProduct.product_id !== selectedProduct.product_id)) {
      handleOpenConfigure(selectedProduct);
    }
  }, [selectedProduct]);

  // Available brands
  const availableBrands = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.brand && p.brand !== "N/A") set.add(p.brand);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products]);

  // Inventory summary metrics
  const totalVariants = products.length;
  const inStockCount = products.filter((p) => Number(p.available_stock || 0) > 0 && String(p.status).toLowerCase() === "active").length;
  const lowStockCount = products.filter((p) => {
    const stock = Number(p.stock || 0);
    const reorder = Number(p.reorder_level || 10);
    return stock > 0 && stock <= reorder && String(p.status).toLowerCase() === "active";
  }).length;
  const outOfStockCount = products.filter((p) => Number(p.stock || 0) <= 0 || String(p.status).toLowerCase() === "inactive").length;

  // Filtered products list for the table
  const filteredProducts = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return products.filter((p) => {
      // Search filter
      const matchesSearch =
        !term ||
        p.name.toLowerCase().includes(term) ||
        p.brand.toLowerCase().includes(term) ||
        p.sku.toLowerCase().includes(term) ||
        shortId(p.sku).toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term) ||
        p.color.toLowerCase().includes(term) ||
        p.size.toLowerCase().includes(term);

      // Category filter
      const matchesCategory =
        selectedCategory === "all" ||
        p.category_id === selectedCategory ||
        p.category.toLowerCase() === selectedCategory.toLowerCase();

      // Brand filter
      const matchesBrand =
        selectedBrand === "all" ||
        p.brand.toLowerCase() === selectedBrand.toLowerCase();

      // Stock status filter
      const stock = Number(p.stock || 0);
      const reorder = Number(p.reorder_level || 10);
      const isInactive = String(p.status).toLowerCase() === "inactive";
      let matchesStock = true;
      if (selectedStockFilter === "in_stock") {
        matchesStock = Number(p.available_stock || 0) > 0 && !isInactive;
      } else if (selectedStockFilter === "low_stock") {
        matchesStock = stock > 0 && stock <= reorder && !isInactive;
      } else if (selectedStockFilter === "out_of_stock") {
        matchesStock = stock <= 0 && !isInactive;
      } else if (selectedStockFilter === "inactive") {
        matchesStock = isInactive;
      } else if (selectedStockFilter === "unconfigured") {
        matchesStock = !p.hasInventory;
      }

      return matchesSearch && matchesCategory && matchesBrand && matchesStock;
    });
  }, [products, searchQuery, selectedCategory, selectedBrand, selectedStockFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedCategory, selectedBrand, selectedStockFilter]);

  const totalSettingsPages = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const safeSettingsPage = Math.min(Math.max(1, currentPage), totalSettingsPages);
  const paginatedProducts = useMemo(() => {
    return filteredProducts.slice((safeSettingsPage - 1) * pageSize, safeSettingsPage * pageSize);
  }, [filteredProducts, safeSettingsPage, pageSize]);

  // Open modal for a specific product
  const handleOpenConfigure = (product: UiProduct) => {
    setActiveProduct(product);
    setStockForm({
      product_id: product.product_id,
      stock_in: 0,
      reserved_quantity: product.reserved_stock || 0,
      markup_rate: defaultMarkupRateForProduct(product),
      reorder_level: product.reorder_level || 10,
      status: (product.status as InventoryStatus) || "Active",
      manufacturer_date: product.manufacturer_date ? product.manufacturer_date.slice(0, 10) : "",
      expiration_date: product.expiration_date ? product.expiration_date.slice(0, 10) : "",
    });
    setIsConfigDialogOpen(true);
  };

  // Live calculations for the active product inside modal
  const activeCost = Number(activeProduct?.unit_price || 0);
  const computedSrp = activeProduct ? calculateSrpFromMarkup(activeCost, stockForm.markup_rate) : 0;
  const markupAmount = activeProduct ? computedSrp - activeCost : 0;
  const currentOnHand = Number(activeProduct?.stock || 0);
  const stockInToAdd = Number(stockForm.stock_in || 0);
  const heldQuantity = Number(stockForm.reserved_quantity || 0);
  const projectedOnHand = currentOnHand + stockInToAdd;
  const projectedAvailable = Math.max(0, projectedOnHand - heldQuantity);

  const handleSaveModal = async () => {
    setIsSaving(true);
    try {
      await onSave();
      // If the current stock filter would hide the newly configured item (out of stock, unconfigured, or inactive),
      // reset it to "all" so the user immediately sees the configured product in the table!
      if (selectedStockFilter === "out_of_stock" || selectedStockFilter === "unconfigured" || selectedStockFilter === "inactive") {
        setSelectedStockFilter("all");
      }
      setIsConfigDialogOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. KEY METRICS STATS BAR */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#12121a] border border-[#24242f] rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-yellow-200/60 uppercase font-semibold tracking-wider">Total Variants</p>
            <p className="text-2xl font-bold text-white mt-1">{totalVariants}</p>
          </div>
          <div className="p-3 bg-yellow-400/10 border border-yellow-400/20 rounded-xl text-yellow-400">
            <Package className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-[#12121a] border border-[#24242f] rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-emerald-400/80 uppercase font-semibold tracking-wider">POS Available</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">{inStockCount}</p>
          </div>
          <div className="p-3 bg-emerald-400/10 border border-emerald-400/20 rounded-xl text-emerald-400">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-[#12121a] border border-[#24242f] rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-amber-400/80 uppercase font-semibold tracking-wider">Low Stock Warning</p>
            <p className="text-2xl font-bold text-amber-400 mt-1">{lowStockCount}</p>
          </div>
          <div className="p-3 bg-amber-400/10 border border-amber-400/20 rounded-xl text-amber-400">
            <AlertTriangle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-[#12121a] border border-[#24242f] rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-red-400/80 uppercase font-semibold tracking-wider">Out of Stock</p>
            <p className="text-2xl font-bold text-red-400 mt-1">{outOfStockCount}</p>
          </div>
          <div className="p-3 bg-red-400/10 border border-red-400/20 rounded-xl text-red-400">
            <Layers className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 2. MASTER PARAMETER DATA TABLE CARD */}
      <Card className="border-[#24242f] bg-[#101017]">
        <CardHeader className="pb-3 border-b border-[#24242f]">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <CardTitle className="text-yellow-300 flex items-center gap-2 text-lg">
                <SlidersHorizontal className="w-5 h-5" />
                Product Settings & Item Parameters
              </CardTitle>
              <p className="text-xs text-yellow-200/60 mt-1">
                Manage selling price (SRP), markup multiplier, stock-in batches, held reservations, and reorder levels.
              </p>
            </div>
            <Badge className="bg-yellow-400/10 text-yellow-300 border border-yellow-400/30 px-3 py-1 text-xs self-start md:self-auto">
              {filteredProducts.length} Item{filteredProducts.length === 1 ? "" : "s"} Displayed
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="p-5 space-y-4">
          {/* SEARCH & FILTERS CONTROLS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-400/70" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by Product Name, SKU, Brand, Color, Size..."
                className="h-10 pl-10 bg-[#171722] border-[#2d2d3a] text-yellow-100 placeholder:text-yellow-300/40 focus-visible:ring-yellow-400/50 rounded-xl"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Category Filter */}
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="h-10 bg-[#171722] border-[#2d2d3a] text-yellow-100 rounded-xl">
                <SelectValue placeholder="Category: All" />
              </SelectTrigger>
              <SelectContent className="bg-[#15151d] border-[#2d2d3a] text-yellow-100 max-h-64">
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c: any) => (
                  <SelectItem key={c.category_id} value={c.category_id}>
                    {c.category_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Brand Filter */}
            <Select value={selectedBrand} onValueChange={setSelectedBrand}>
              <SelectTrigger className="h-10 bg-[#171722] border-[#2d2d3a] text-yellow-100 rounded-xl">
                <SelectValue placeholder="All Brands" />
              </SelectTrigger>
              <SelectContent className="bg-[#15151d] border-[#2d2d3a] text-yellow-100 max-h-64">
                <SelectItem value="all">All Brands</SelectItem>
                {availableBrands.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Stock Level Filter */}
            <Select value={selectedStockFilter} onValueChange={(val: any) => setSelectedStockFilter(val)}>
              <SelectTrigger className="h-10 bg-[#171722] border-[#2d2d3a] text-yellow-100 rounded-xl">
                <SelectValue placeholder="Stock: All Statuses" />
              </SelectTrigger>
              <SelectContent className="bg-[#15151d] border-[#2d2d3a] text-yellow-100">
                <SelectItem value="all">All Stock Statuses</SelectItem>
                <SelectItem value="unconfigured">Unconfigured (New Products)</SelectItem>
                <SelectItem value="in_stock">In-Stock & Sellable</SelectItem>
                <SelectItem value="low_stock">Low Stock (≤ Reorder)</SelectItem>
                <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                <SelectItem value="inactive">Inactive Items</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* TABLE CONTAINER */}
          <div className="rounded-xl border border-[#262633] overflow-hidden bg-[#13131c]">
            <Table>
              <TableHeader className="bg-[#171724]">
                <TableRow className="border-[#262633] hover:bg-transparent">
                  <TableHead className="text-yellow-300 font-semibold text-xs py-3.5 w-[56px] pl-4">Photo</TableHead>
                  <TableHead className="text-yellow-300 font-semibold text-xs">Product & SKU</TableHead>
                  <TableHead className="text-yellow-300 font-semibold text-xs">Brand & Category</TableHead>
                  <TableHead className="text-yellow-300 font-semibold text-xs">Variant (Color/Size)</TableHead>
                  <TableHead className="text-yellow-300 font-semibold text-xs text-right">Unit Cost</TableHead>
                  <TableHead className="text-yellow-300 font-semibold text-xs text-right">Selling Price (SRP)</TableHead>
                  <TableHead className="text-yellow-300 font-semibold text-xs text-center">Stock Levels</TableHead>
                  <TableHead className="text-yellow-300 font-semibold text-xs text-center">Status</TableHead>
                  <TableHead className="text-yellow-300 font-semibold text-xs text-center w-[140px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedProducts.length > 0 ? (
                  paginatedProducts.map((product) => {
                    const statusMeta = getProductStatusMeta(product);
                    const isLow = Number(product.stock || 0) > 0 && Number(product.stock || 0) <= Number(product.reorder_level || 10);
                    const isOut = Number(product.stock || 0) <= 0;
                    const isInactive = String(product.status).toLowerCase() === "inactive";

                    return (
                      <TableRow key={product.product_id} className="border-[#262633] hover:bg-[#1b1b26] transition-colors">
                        {/* Thumbnail Photo */}
                        <TableCell className="py-2.5 pl-4 pr-1">
                          <ProductThumbnail src={product.image_url} alt={product.name} />
                        </TableCell>

                        {/* Product & SKU */}
                        <TableCell className="py-3">
                          <p className="font-semibold text-white text-sm">{product.name}</p>
                          <span className="text-xs text-yellow-200/50 font-mono">{shortId(product.sku)}</span>
                        </TableCell>

                        {/* Brand & Category */}
                        <TableCell>
                          <p className="text-sm text-yellow-100">{product.brand}</p>
                          <span className="text-xs text-yellow-200/50">{product.category}</span>
                        </TableCell>

                        {/* Variant */}
                        <TableCell>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-medium text-white px-2 py-0.5 rounded bg-[#222230] border border-[#303042]">
                              {product.color}
                            </span>
                            <span className="text-xs font-medium text-yellow-200 px-2 py-0.5 rounded bg-[#222230] border border-[#303042]">
                              Size {product.size}
                            </span>
                            <span className="text-[11px] text-yellow-200/40">{product.gender}</span>
                          </div>
                        </TableCell>

                        {/* Cost Price */}
                        <TableCell className="text-right font-medium text-yellow-100/90 text-sm">
                          {formatMoney(product.unit_price)}
                        </TableCell>

                        {/* Calculated SRP */}
                        <TableCell className="text-right">
                          <p className="font-bold text-yellow-300 text-sm">
                            {formatMoney(product.srp || product.unit_price * 1.25)}
                          </p>
                          <span className="text-[10px] text-emerald-400/80 bg-emerald-950/50 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                            {defaultMarkupRateForProduct(product).toFixed(2)}x markup
                          </span>
                        </TableCell>

                        {/* Stock Levels */}
                        <TableCell className="text-center">
                          <div className="inline-flex items-center gap-2">
                            <div className="text-right">
                              <span className="text-xs text-yellow-200/60 block">On-Hand: {product.stock}</span>
                              <span className="text-[11px] text-zinc-400 block">Held: {product.reserved_stock || 0}</span>
                            </div>
                            <Badge
                              className={`text-xs px-2 py-0.5 font-bold ${
                                isInactive
                                  ? "bg-zinc-800 text-zinc-400 border-zinc-700"
                                  : isOut
                                    ? "bg-red-950/80 text-red-300 border-red-800/60"
                                    : isLow
                                      ? "bg-amber-950/80 text-amber-300 border-amber-800/60"
                                      : "bg-emerald-950/80 text-emerald-300 border-emerald-800/60"
                              }`}
                            >
                              {product.available_stock} Avail
                            </Badge>
                          </div>
                        </TableCell>

                        {/* Status */}
                        <TableCell className="text-center">
                          <Badge className={`border px-2 py-0.5 text-xs ${statusMeta.className}`}>
                            {statusMeta.label}
                          </Badge>
                        </TableCell>

                        {/* Action */}
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            onClick={() => handleOpenConfigure(product)}
                            className="bg-yellow-400 text-red-900 hover:bg-yellow-500 font-semibold text-xs h-8 px-3 rounded-lg shadow flex items-center gap-1.5 mx-auto transition-transform active:scale-95"
                          >
                            <SlidersHorizontal className="w-3.5 h-3.5" />
                            <span>Configure</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="py-12 text-center text-yellow-200/60">
                      <Package className="w-8 h-8 mx-auto mb-2 text-yellow-400/40" />
                      <p className="text-sm font-semibold">No products found matching your search.</p>
                      <p className="text-xs text-yellow-200/40 mt-1">Try clearing filters or searching for another SKU.</p>
                      {(searchQuery || selectedCategory !== "all" || selectedBrand !== "all" || selectedStockFilter !== "all") && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSearchQuery("");
                            setSelectedCategory("all");
                            setSelectedBrand("all");
                            setSelectedStockFilter("all");
                            setCurrentPage(1);
                          }}
                          className="mt-3 border-yellow-400/40 text-yellow-300 hover:bg-yellow-400/10 text-xs"
                        >
                          Clear all filters
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* PAGINATION */}
          <TablePagination
            currentPage={safeSettingsPage}
            pageSize={pageSize}
            totalItems={filteredProducts.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[10, 15, 25, 50, 100]}
            unitName="variants"
          />
        </CardContent>
      </Card>

      {/* 3. CONFIGURE ITEM PARAMETERS MODAL / DIALOG */}
      <Dialog open={isConfigDialogOpen} onOpenChange={setIsConfigDialogOpen}>
        <DialogContent className="bg-[#13131c] border-[#2a2c3a] text-yellow-100 !w-[96vw] !max-w-[960px] max-h-[88vh] flex flex-col p-0 shadow-2xl rounded-2xl overflow-hidden">
          {/* MODAL HEADER */}
          <DialogHeader className="border-b border-[#232332] bg-[#181824] px-6 py-4 flex-shrink-0">
            <DialogTitle className="text-white text-lg font-bold">
              Configure Product Parameters
            </DialogTitle>
            <p className="text-xs text-yellow-200/60 mt-0.5">
              Set inventory stock-in quantities, markup margins, and POS availability.
            </p>
          </DialogHeader>

          {/* MODAL BODY */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 [scrollbar-width:thin] [scrollbar-color:#eab308_#1f1f2e]">
            {activeProduct && (
              <>
                {/* Product Summary Header Bar */}
                <div className="rounded-xl border border-[#2d2d40] bg-[#1a1a27] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <ProductThumbnail
                      src={activeProduct.image_url}
                      alt={activeProduct.name}
                      className="w-14 h-14 rounded-xl"
                      iconSize="w-6 h-6"
                    />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white text-base">{activeProduct.brand} - {activeProduct.name}</span>
                        <span className="bg-[#242436] text-yellow-300 border border-[#36364e] text-xs px-2.5 py-0.5 rounded-md font-medium">
                          {activeProduct.category}
                        </span>
                      </div>
                      <p className="text-xs text-yellow-200/70">
                        Color: {activeProduct.color} &nbsp;|&nbsp; Size: {activeProduct.size} &nbsp;|&nbsp; Department: {activeProduct.gender}
                      </p>
                    </div>
                  </div>
                  <div className="sm:text-right border-t sm:border-t-0 border-[#2b2b3d] pt-2 sm:pt-0">
                    <span className="text-xs text-yellow-200/60 uppercase tracking-wider block">Unit Cost</span>
                    <span className="text-lg font-bold text-yellow-300">{formatMoney(activeProduct.unit_price)}</span>
                  </div>
                </div>

                {/* 2-COLUMN GRID */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* COLUMN 1: INVENTORY & STOCKING */}
                  <div className="space-y-3 rounded-xl border border-[#272738] bg-[#161622] p-4 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-[#252536] pb-2">
                        <span className="text-sm font-bold text-white">Inventory Stock</span>
                        <span className="text-xs text-yellow-200/70">Current On-Hand: <strong className="text-yellow-300">{currentOnHand} units</strong></span>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-yellow-200/80 font-medium">
                          Add Stock Quantity
                        </Label>
                        <Input
                          type="number"
                          min="0"
                          value={stockForm.stock_in === "" ? "" : stockForm.stock_in}
                          onFocus={(e) => {
                            if (e.target.value === "0") e.target.select();
                          }}
                          onChange={(e) => {
                            const val = e.target.value;
                            setStockForm({
                              ...stockForm,
                              stock_in: val === "" ? "" : Math.max(0, parseInt(val, 10) || 0),
                            });
                          }}
                          placeholder="0"
                          className="h-10 bg-[#1f1f2e] border-[#303044] text-yellow-100 font-semibold focus-visible:ring-yellow-400/50 rounded-lg text-sm"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1.5">
                          <Label className="text-xs text-yellow-200/80 font-medium">
                            Reserved / Held Stock
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            value={stockForm.reserved_quantity === "" ? "" : stockForm.reserved_quantity}
                            onFocus={(e) => {
                              if (e.target.value === "0") e.target.select();
                            }}
                            onChange={(e) => {
                              const val = e.target.value;
                              setStockForm({
                                ...stockForm,
                                reserved_quantity: val === "" ? "" : Math.max(0, parseInt(val, 10) || 0),
                              });
                            }}
                            placeholder="0"
                            className="h-10 bg-[#1f1f2e] border-[#303044] text-yellow-100 text-sm rounded-lg"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs text-yellow-200/80 font-medium">
                            Reorder Alert Level
                          </Label>
                          <Input
                            type="number"
                            min="0"
                            value={stockForm.reorder_level === "" ? "" : stockForm.reorder_level}
                            onFocus={(e) => {
                              if (e.target.value === "0") e.target.select();
                            }}
                            onChange={(e) => {
                              const val = e.target.value;
                              setStockForm({
                                ...stockForm,
                                reorder_level: val === "" ? "" : Math.max(0, parseInt(val, 10) || 0),
                              });
                            }}
                            placeholder="5"
                            className="h-10 bg-[#1f1f2e] border-[#303044] text-yellow-100 text-sm rounded-lg"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Stock Result Summary */}
                    <div className="rounded-lg bg-[#101018] border border-[#28283a] p-3 flex items-center justify-between mt-2">
                      <span className="text-xs text-yellow-200/70">Ready for POS Sale:</span>
                      <span className="text-sm font-bold text-emerald-400">
                        {projectedAvailable} Units Available
                      </span>
                    </div>
                  </div>

                  {/* COLUMN 2: PRICING & MARKUP */}
                  <div className="space-y-3 rounded-xl border border-[#272738] bg-[#161622] p-4 flex flex-col justify-between">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-[#252536] pb-2">
                        <span className="text-sm font-bold text-white">Pricing & Markup</span>
                        <span className="text-xs text-yellow-200/70">Cost: <strong className="text-yellow-300">{formatMoney(activeCost)}</strong></span>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-yellow-200/80 font-medium">Markup Preset</Label>
                        <div className="grid grid-cols-4 gap-2">
                          {[
                            { label: "20%", rate: 0.20 },
                            { label: "35%", rate: 0.35 },
                            { label: "50%", rate: 0.50 },
                            { label: "90%", rate: 0.90 },
                          ].map((item) => (
                            <button
                              key={item.rate}
                              type="button"
                              onClick={() => setStockForm({ ...stockForm, markup_rate: item.rate })}
                              className={`h-9 rounded-lg text-xs font-semibold border transition-all ${
                                Math.abs(stockForm.markup_rate - item.rate) < 0.001
                                  ? "bg-yellow-400 text-red-950 border-yellow-400 font-bold"
                                  : "bg-[#1f1f2e] border-[#303044] text-yellow-200/80 hover:bg-[#28283c] hover:text-white"
                              }`}
                            >
                              +{item.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs text-yellow-200/80 font-medium">Custom Multiplier</Label>
                        <Select
                          value={String(stockForm.markup_rate)}
                          onValueChange={(value) => setStockForm({ ...stockForm, markup_rate: Number(value) })}
                        >
                          <SelectTrigger className="h-10 bg-[#1f1f2e] border-[#303044] text-yellow-100 text-xs rounded-lg">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#181824] border-[#2e2e42] text-yellow-100 text-xs">
                            {MARKUP_RATE_OPTIONS.map((rate) => (
                              <SelectItem key={rate} value={String(rate)}>
                                {rate.toFixed(2)}x Multiplier (+{Math.round(rate * 100)}% margin)
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Calculated Price Display */}
                    <div className="rounded-lg bg-[#101018] border border-yellow-500/30 p-3 flex items-center justify-between mt-2">
                      <div>
                        <span className="text-xs text-yellow-200/70 block">Selling Price (SRP):</span>
                        <span className="text-xs text-emerald-400 font-medium">
                          +₱{markupAmount.toLocaleString()} profit per unit
                        </span>
                      </div>
                      <span className="text-lg font-black text-yellow-300">
                        {formatMoney(computedSrp)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* DATES & BATCH TRACKING */}
                <div className="rounded-xl border border-[#272738] bg-[#161622] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Calendar className="w-4 h-4 text-yellow-400" />
                    <span className="text-xs font-bold text-white">Batch & Quality Dates</span>
                    <span className="text-xs text-yellow-200/60">(Optional)</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-yellow-200/80 font-medium">
                        Manufactured Date
                      </Label>
                      <Input
                        type="date"
                        value={stockForm.manufacturer_date || ""}
                        onChange={(e) => setStockForm({ ...stockForm, manufacturer_date: e.target.value })}
                        className="h-10 bg-[#1f1f2e] border-[#303044] text-yellow-100 text-xs rounded-lg [color-scheme:dark]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-yellow-200/80 font-medium">
                        Expiration Date
                      </Label>
                      <Input
                        type="date"
                        value={stockForm.expiration_date || ""}
                        onChange={(e) => setStockForm({ ...stockForm, expiration_date: e.target.value })}
                        className="h-10 bg-[#1f1f2e] border-[#303044] text-yellow-100 text-xs rounded-lg [color-scheme:dark]"
                      />
                    </div>
                  </div>
                </div>

                {/* BOTTOM ROW: POS STATUS */}
                <div className="rounded-xl border border-[#272738] bg-[#161622] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold text-white block">POS Status</span>
                    <span className="text-xs text-yellow-200/60">Choose whether this item is available for cashiers to sell in the POS.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setStockForm({ ...stockForm, status: "Active" })}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                        stockForm.status === "Active"
                          ? "bg-emerald-500 text-black font-bold shadow"
                          : "bg-[#1f1f2e] text-zinc-400 border border-[#303044] hover:text-white"
                      }`}
                    >
                      Active (Sellable)
                    </button>
                    <button
                      type="button"
                      onClick={() => setStockForm({ ...stockForm, status: "Inactive" })}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                        stockForm.status === "Inactive"
                          ? "bg-red-500 text-white font-bold shadow"
                          : "bg-[#1f1f2e] text-zinc-400 border border-[#303044] hover:text-white"
                      }`}
                    >
                      Inactive (Disabled)
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* MODAL FOOTER */}
          <DialogFooter className="border-t border-[#232332] bg-[#181824] px-6 py-4 flex items-center justify-end gap-3 flex-shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsConfigDialogOpen(false)}
              className="h-10 border-[#38384a] bg-transparent text-yellow-200 hover:bg-[#252533] rounded-lg px-5 text-xs font-medium"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveModal}
              disabled={isSaving}
              className="h-10 bg-yellow-400 text-red-950 hover:bg-yellow-500 font-bold px-6 rounded-lg shadow-lg disabled:opacity-60 text-xs"
            >
              {isSaving ? "Saving..." : "Save Parameters"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const PREDEFINED_BRANDS = [
  "Nike",
  "Adidas",
  "Jordan",
  "Puma",
  "Converse",
  "Vans",
  "New Balance",
  "Under Armour",
  "Asics",
  "Reebok",
  "Flamingos",
  "Rocco",
  "Venus",
  "MStyle",
  "LA Bucks",
  "Shoelyns",
  "Alex",
  "Shoefit",
  "C-Speed",
  "Ultra Lite",
];

const STANDARD_COLORS = [
  { label: "Black", value: "Black", bg: "#09090b", border: "#3f3f46" },
  { label: "White", value: "White", bg: "#ffffff", border: "#d4d4d8" },
  { label: "Black/White", value: "Black/White", bg: "linear-gradient(135deg, #09090b 50%, #ffffff 50%)", border: "#3f3f46" },
  { label: "Red", value: "Red", bg: "#ef4444" },
  { label: "Blue", value: "Blue", bg: "#3b82f6" },
  { label: "Navy", value: "Navy", bg: "#1e3a8a" },
  { label: "Green", value: "Green", bg: "#10b981" },
  { label: "Yellow", value: "Yellow", bg: "#eab308" },
  { label: "Orange", value: "Orange", bg: "#f97316" },
  { label: "Purple", value: "Purple", bg: "#a855f7" },
  { label: "Pink", value: "Pink", bg: "#ec4899" },
  { label: "Grey", value: "Grey", bg: "#6b7280" },
  { label: "Brown", value: "Brown", bg: "#78350f" },
  { label: "Beige", value: "Beige", bg: "#d4b996" },
  { label: "Multi-Color", value: "Multi-Color", bg: "linear-gradient(135deg, #ef4444, #eab308, #10b981, #3b82f6)" },
  { label: "Default", value: "Default", bg: "#52525b" },
];

const STANDARD_SIZES = [
  { value: "35", label: "EU 35 (US Men 3.5 / Women 5)" },
  { value: "36", label: "EU 36 (US Men 4.5 / Women 6)" },
  { value: "37", label: "EU 37 (US Men 5 / Women 6.5)" },
  { value: "38", label: "EU 38 (US Men 5.5 / Women 7)" },
  { value: "39", label: "EU 39 (US Men 6.5 / Women 8)" },
  { value: "40", label: "EU 40 (US Men 7 / Women 8.5)" },
  { value: "41", label: "EU 41 (US Men 8 / Women 9.5)" },
  { value: "42", label: "EU 42 (US Men 8.5 / Women 10)" },
  { value: "43", label: "EU 43 (US Men 9.5 / Women 11)" },
  { value: "44", label: "EU 44 (US Men 10 / Women 11.5)" },
  { value: "45", label: "EU 45 (US Men 11 / Women 12.5)" },
  { value: "46", label: "EU 46 (US Men 12 / Women 13.5)" },
  { value: "47", label: "EU 47 (US Men 13 / Women 14.5)" },
  { value: "48", label: "EU 48 (US Men 14)" },
];

function ProductMasterForm({
  formData,
  setFormData,
  categories,
  products = [],
}: {
  formData: ProductFormData;
  setFormData: (data: ProductFormData) => void;
  categories: any[];
  products?: UiProduct[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isCustomBrand, setIsCustomBrand] = useState(false);
  const [isCustomSize, setIsCustomSize] = useState(false);
  const [isCustomColor, setIsCustomColor] = useState(false);

  const availableBrands = useMemo(() => {
    const set = new Set<string>();
    PREDEFINED_BRANDS.forEach((b) => set.add(b));
    products.forEach((p) => {
      const b = (p.brand || "").trim();
      if (b && b !== "N/A" && b.length > 1) {
        set.add(b);
      }
    });
    if (formData.brand && formData.brand.trim() && !isCustomBrand) {
      set.add(formData.brand.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [products, formData.brand, isCustomBrand]);

  const availableSizes = useMemo(() => {
    const list = [...STANDARD_SIZES];
    if (formData.size && !isCustomSize && !list.some((s) => s.value === formData.size)) {
      list.unshift({ value: formData.size, label: `${formData.size} (Current)` });
    }
    return list;
  }, [formData.size, isCustomSize]);

  const availableColors = useMemo(() => {
    const list = [...STANDARD_COLORS];
    if (formData.color && !isCustomColor && !list.some((c) => c.value.toLowerCase() === formData.color.toLowerCase())) {
      list.unshift({ label: formData.color, value: formData.color, bg: "#64748b" });
    }
    return list;
  }, [formData.color, isCustomColor]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload a valid image file (PNG, JPG, WEBP).");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image file size should be less than 5MB.");
      return;
    }

    setIsProcessingFile(true);
    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_SIZE = 500;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL("image/jpeg", 0.85);
        setFormData({ ...formData, image_url: compressedDataUrl });
        setIsProcessingFile(false);
        toast.success("Image uploaded successfully.");
      };
      img.onerror = () => {
        setFormData({ ...formData, image_url: String(readerEvent.target?.result ?? "") });
        setIsProcessingFile(false);
      };
      img.src = String(readerEvent.target?.result ?? "");
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="grid gap-4 py-4">
      {/* ROW 1: Product Name & Brand */}
      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          label="Product Name *"
          value={formData.name}
          onChange={(value) => setFormData({ ...formData, name: value })}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-yellow-300">Brand *</Label>
            {isCustomBrand ? (
              <button
                type="button"
                onClick={() => {
                  setIsCustomBrand(false);
                  setFormData({ ...formData, brand: availableBrands[0] || "" });
                }}
                className="text-[11px] text-yellow-400 hover:text-yellow-300 underline"
              >
                Choose from list
              </button>
            ) : null}
          </div>
          {isCustomBrand ? (
            <Input
              autoFocus
              placeholder="Type new brand name..."
              value={formData.brand}
              onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
              className="bg-[#1d1d27] border-[#2d2d3a] text-yellow-100"
            />
          ) : (
            <Select
              value={formData.brand || ""}
              onValueChange={(value) => {
                if (value === "__custom_brand__") {
                  setIsCustomBrand(true);
                  setFormData({ ...formData, brand: "" });
                } else {
                  setFormData({ ...formData, brand: value });
                }
              }}
            >
              <SelectTrigger className="bg-[#1d1d27] border-[#2d2d3a] text-yellow-100">
                <SelectValue placeholder="Select Brand *" />
              </SelectTrigger>
              <SelectContent className="bg-[#181824] border-[#2d2d3a] text-yellow-100 max-h-64">
                {availableBrands.map((b) => (
                  <SelectItem key={b} value={b}>
                    {b}
                  </SelectItem>
                ))}
                <SelectItem value="__custom_brand__" className="text-yellow-400 font-semibold border-t border-[#2d2d3a] mt-1 pt-1.5">
                  + Add Custom Brand...
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* ROW 2: Category & Size */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label className="text-yellow-300">Category *</Label>
          <Select
            value={formData.category_id}
            onValueChange={(value) => setFormData({ ...formData, category_id: value })}
          >
            <SelectTrigger className="bg-[#1d1d27] border-[#2d2d3a] text-yellow-100">
              <SelectValue placeholder="Select category *" />
            </SelectTrigger>
            <SelectContent className="bg-[#181824] border-[#2d2d3a] text-yellow-100">
              {categories.map((category: any) => (
                <SelectItem key={category.category_id} value={category.category_id}>
                  {category.category_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-yellow-300">Size *</Label>
            {isCustomSize ? (
              <button
                type="button"
                onClick={() => {
                  setIsCustomSize(false);
                  setFormData({ ...formData, size: "42" });
                }}
                className="text-[11px] text-yellow-400 hover:text-yellow-300 underline"
              >
                Choose from standard sizes
              </button>
            ) : null}
          </div>
          {isCustomSize ? (
            <Input
              autoFocus
              placeholder="e.g. EU 42.5 or 9.5"
              value={formData.size}
              onChange={(e) => setFormData({ ...formData, size: e.target.value })}
              className="bg-[#1d1d27] border-[#2d2d3a] text-yellow-100"
            />
          ) : (
            <Select
              value={formData.size || ""}
              onValueChange={(value) => {
                if (value === "__custom_size__") {
                  setIsCustomSize(true);
                  setFormData({ ...formData, size: "" });
                } else {
                  setFormData({ ...formData, size: value });
                }
              }}
            >
              <SelectTrigger className="bg-[#1d1d27] border-[#2d2d3a] text-yellow-100">
                <SelectValue placeholder="Select size *" />
              </SelectTrigger>
              <SelectContent className="bg-[#181824] border-[#2d2d3a] text-yellow-100 max-h-64">
                {availableSizes.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
                <SelectItem value="__custom_size__" className="text-yellow-400 font-semibold border-t border-[#2d2d3a] mt-1 pt-1.5">
                  + Custom Size...
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {/* ROW 3: Color, Department & Unit Price */}
      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-yellow-300">Color</Label>
            {isCustomColor ? (
              <button
                type="button"
                onClick={() => {
                  setIsCustomColor(false);
                  setFormData({ ...formData, color: "Black" });
                }}
                className="text-[11px] text-yellow-400 hover:text-yellow-300 underline"
              >
                Choose from palette
              </button>
            ) : null}
          </div>
          {isCustomColor ? (
            <Input
              autoFocus
              placeholder="e.g. Bred / Royal Blue"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              className="bg-[#1d1d27] border-[#2d2d3a] text-yellow-100"
            />
          ) : (
            <Select
              value={formData.color || ""}
              onValueChange={(value) => {
                if (value === "__custom_color__") {
                  setIsCustomColor(true);
                  setFormData({ ...formData, color: "" });
                } else {
                  setFormData({ ...formData, color: value });
                }
              }}
            >
              <SelectTrigger className="bg-[#1d1d27] border-[#2d2d3a] text-yellow-100">
                <SelectValue placeholder="Select color" />
              </SelectTrigger>
              <SelectContent className="bg-[#181824] border-[#2d2d3a] text-yellow-100 max-h-64">
                {availableColors.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <div className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full border shrink-0"
                        style={{ background: c.bg, borderColor: c.border || "transparent" }}
                      />
                      <span>{c.label}</span>
                    </div>
                  </SelectItem>
                ))}
                <SelectItem value="__custom_color__" className="text-yellow-400 font-semibold border-t border-[#2d2d3a] mt-1 pt-1.5">
                  + Custom Color...
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="space-y-2">
          <Label className="text-yellow-300">Department</Label>
          <Select
            value={formData.gender || "Unisex"}
            onValueChange={(value) => setFormData({ ...formData, gender: value })}
          >
            <SelectTrigger className="bg-[#1d1d27] border-[#2d2d3a] text-yellow-100">
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent className="bg-[#181824] border-[#2d2d3a] text-yellow-100">
              <SelectItem value="Men">Men</SelectItem>
              <SelectItem value="Women">Women</SelectItem>
              <SelectItem value="Kids">Kids</SelectItem>
              <SelectItem value="Unisex">Unisex</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-yellow-300">Unit Price (SRP) *</Label>
          <Input
            type="number"
            min="0.01"
            step="0.01"
            placeholder="0.00"
            value={formData.unit_price === 0 ? "" : formData.unit_price}
            onChange={(e) => {
              const val = e.target.value === "" ? 0 : parseFloat(e.target.value);
              setFormData({ ...formData, unit_price: isNaN(val) ? 0 : val });
            }}
            className="bg-[#1d1d27] border-[#2d2d3a] text-yellow-100 font-semibold"
          />
        </div>
      </div>

      {/* ROW 4: Image Upload */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-yellow-300">Product Image (Optional)</Label>
          {formData.image_url ? (
            <button
              type="button"
              onClick={() => setFormData({ ...formData, image_url: "" })}
              className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1 transition"
            >
              <X className="w-3.5 h-3.5" /> Remove Image
            </button>
          ) : null}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div
            onClick={() => fileInputRef.current?.click()}
            className="w-14 h-14 rounded-xl bg-[#1a1a27] border border-[#2d2d3f] hover:border-yellow-400/50 cursor-pointer overflow-hidden flex items-center justify-center flex-shrink-0 relative group transition shadow-sm"
            title="Click to upload image file"
          >
            <ProductThumbnail
              src={formData.image_url}
              alt="Preview"
              className="w-full h-full rounded-xl"
              iconSize="w-6 h-6"
            />
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition">
              <Upload className="w-4 h-4 text-white" />
            </div>
          </div>

          <div className="flex-1 flex flex-col sm:flex-row items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleImageUpload}
            />
            <Button
              type="button"
              variant="outline"
              disabled={isProcessingFile}
              onClick={() => fileInputRef.current?.click()}
              className="w-full sm:w-auto h-10 border-[#38384a] bg-[#1d1d27] text-yellow-200 hover:bg-[#252533] hover:text-yellow-100 rounded-xl px-4 text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0"
            >
              <Upload className="w-3.5 h-3.5 text-yellow-400" />
              {isProcessingFile ? "Loading..." : "Upload Image"}
            </Button>
            <Input
              value={formData.image_url || ""}
              onChange={(e) => {
                const cleaned = cleanProductImageUrl(e.target.value);
                setFormData({ ...formData, image_url: cleaned });
              }}
              placeholder="or paste image URL / link..."
              className="h-10 bg-[#1d1d27] border-[#2d2d3a] text-yellow-100 placeholder:text-zinc-500 text-xs rounded-xl flex-1 focus-visible:ring-yellow-400/40"
            />
          </div>
        </div>
        {getWebpageUrlWarning(formData.image_url) && (
          <div className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-lg p-2.5 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <span>{getWebpageUrlWarning(formData.image_url)}</span>
          </div>
        )}
        <p className="text-[11px] text-zinc-500">
          Upload an image from your device or paste a web image link. Tip: On Google, right-click the image and pick &quot;Copy image address&quot;.
        </p>
      </div>
    </div>
  );
}

function VariantUpdateScope({
  editScope,
  setEditScope,
  editableVariantGroup,
  selectedVariantIds,
  setSelectedVariantIds,
}: {
  editScope: ProductEditScope;
  setEditScope: (scope: ProductEditScope) => void;
  editableVariantGroup: UiProduct[];
  selectedVariantIds: string[];
  setSelectedVariantIds: (ids: string[]) => void;
}) {
  const toggleVariant = (productId: string) => {
    if (selectedVariantIds.includes(productId)) {
      setSelectedVariantIds(selectedVariantIds.filter((id) => id !== productId));
      return;
    }
    setSelectedVariantIds([...selectedVariantIds, productId]);
  };

  return (
    <div className="rounded-xl border border-[#2d2d3a] bg-[#12121a] p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-yellow-300/70">Update Scope</p>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <Button
          type="button"
          variant="ghost"
          onClick={() => setEditScope("this_variant")}
          className={editScope === "this_variant" ? "bg-yellow-400 text-red-900 hover:bg-yellow-500" : "border border-[#2d2d3a] text-yellow-100 hover:bg-[#1d1d27]"}
        >
          This variant only
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setEditScope("selected_variants")}
          className={editScope === "selected_variants" ? "bg-yellow-400 text-red-900 hover:bg-yellow-500" : "border border-[#2d2d3a] text-yellow-100 hover:bg-[#1d1d27]"}
        >
          Selected variants
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => setEditScope("all_variants_base")}
          className={editScope === "all_variants_base" ? "bg-yellow-400 text-red-900 hover:bg-yellow-500" : "border border-[#2d2d3a] text-yellow-100 hover:bg-[#1d1d27]"}
        >
          All variants of base
        </Button>
      </div>

      {editScope !== "this_variant" && (
        <div className="mt-3 rounded-lg border border-[#2d2d3a] bg-[#15151d] p-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-yellow-200/80">Select which variants are affected:</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelectedVariantIds(editableVariantGroup.map((variant) => variant.product_id))}
              className="h-7 px-2 text-xs text-yellow-200 hover:bg-[#1d1d27]"
            >
              Select all
            </Button>
          </div>
          <div className="grid max-h-36 gap-1 overflow-y-auto pr-1">
            {editableVariantGroup.map((variant) => (
              <label key={variant.product_id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-yellow-100 hover:bg-[#1d1d27]">
                <input
                  type="checkbox"
                  checked={selectedVariantIds.includes(variant.product_id)}
                  onChange={() => toggleVariant(variant.product_id)}
                  className="h-4 w-4 accent-yellow-400"
                />
                <span className="text-xs">
                  {variant.color} / {variant.size} ({shortId(variant.sku)})
                </span>
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-yellow-300/70">
            Group updates change base fields only (name, brand, category, unit price). Variant attributes stay unchanged.
          </p>
        </div>
      )}
    </div>
  );
}

function DetailPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#2d2d3a] bg-[#1d1d27] px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wide text-yellow-300/60">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold leading-tight text-yellow-50">{value || "N/A"}</p>
    </div>
  );
}

function ProductSizeCard({ product, isSelected, onSelect }: { product: UiProduct; isSelected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`min-h-[120px] rounded-lg border p-3 text-left transition ${
        isSelected
          ? "border-yellow-300 bg-yellow-400 text-red-950 shadow-md shadow-yellow-950/20"
          : "border-[#2d2d3a] bg-[#111118] text-yellow-100 hover:border-yellow-400/60 hover:bg-yellow-400/10 hover:text-white"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${isSelected ? "text-red-950/65" : "text-yellow-300/55"}`}>
            Size
          </p>
          <p className="mt-1 text-2xl font-bold leading-none">{product.size || "N/A"}</p>
        </div>
        <Badge className={isSelected ? "bg-red-950 text-yellow-100" : "bg-[#20202a] text-yellow-100"}>
          {product.available_stock} available
        </Badge>
      </div>
      <div className="mt-3 space-y-1 text-xs">
        <p className="truncate font-semibold">{product.color || "No color set"}</p>
        <div className={`flex items-center justify-between gap-2 ${isSelected ? "text-red-950/70" : "text-yellow-200/50"}`}>
          <span className="truncate">{shortId(product.sku)}</span>
          <span className="shrink-0 font-semibold">{formatMoney(product.unit_price)}</span>
        </div>
      </div>
    </button>
  );
}

function ConfigSnapshotPill({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "good" | "danger" }) {
  const toneClass =
    tone === "good"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
      : tone === "danger"
        ? "border-red-500/30 bg-red-500/10 text-red-100"
        : "border-[#2d2d3a] bg-[#1d1d27] text-yellow-50";

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-yellow-300/60">{label}</p>
      <p className="mt-1 truncate text-sm font-bold">{value || "Not set"}</p>
    </div>
  );
}

function formatDateValue(value?: string) {
  const date = String(value ?? "").slice(0, 10);
  return date || "Not set";
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label className="text-yellow-300">{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} className="bg-[#1d1d27] border-[#2d2d3a] text-yellow-100" />
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  const [inputValue, setInputValue] = useState(String(Number(value || 0)));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setInputValue(String(Number(value || 0)));
    }
  }, [isFocused, value]);

  const commitValue = (rawValue: string) => {
    if (rawValue === "") {
      setInputValue(String(Number(value || 0)));
      return;
    }

    const nextValue = Math.max(0, Number(rawValue) || 0);
    setInputValue(String(nextValue));
    onChange(nextValue);
  };

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-yellow-300">{label}</Label>
      <Input
        type="number"
        min={0}
        value={inputValue}
        onFocus={() => setIsFocused(true)}
        onBlur={(event) => {
          setIsFocused(false);
          commitValue(event.target.value);
        }}
        onChange={(event) => {
          const rawValue = event.target.value;
          setInputValue(rawValue);
          if (rawValue !== "") {
            onChange(Math.max(0, Number(rawValue) || 0));
          }
        }}
        className="h-9 bg-[#1d1d27] border-[#2d2d3a] text-yellow-100 focus-visible:ring-yellow-400/50"
      />
    </div>
  );
}
