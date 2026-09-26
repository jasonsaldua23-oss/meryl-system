import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "./ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Badge } from "./ui/badge";
import { FileImage, Minus, Plus, Search, Eye, RotateCcw, AlertTriangle, ArrowRightLeft, Upload, X, Receipt, CheckCircle2, XCircle, AlertCircle, Clock, ShieldCheck, FileCheck, QrCode, Camera, Calendar, Package, TrendingUp, Users, ZoomIn, ZoomOut, Zap, Info, RefreshCw } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import jsQR from "jsqr";
import { toast } from "sonner";
import { useAuth } from "../../lib/auth-context";
import { useInventory, useProducts, useReturns, useSales, useUsers } from "../../lib/hooks";
import { supabase } from "../../lib/supabase";
import { saveReceiptProof, getAllReceiptProofs, StoredReceiptProof } from "../../lib/receipt-proof-store";
import { parseReplacementNote, resolveReplacementProduct } from "../../lib/replacement-details";
import { formatStoreDate, formatStoreDateTime, parseDbTimestamp, recordMoment, storeDateDigits } from "../../lib/datetime";
import merylLogoBw from "../../assets/Meryl_Logo_BW.svg";
import { shortId } from "./ui/utils";
import { TablePagination } from "./ui/table-pagination";

type ReturnDetail = {
  return_detail_id: string;
  product_id: string;
  productName: string;
  productSize: string;
  productColor: string;
  productPrice: number;
  quantity_returned: number;
  reason: string;
  customerReason: string;
  refund_amount: number;
  replacementProductId: string;
  replacementProductName: string;
  replacementProductSize: string;
  replacementProductColor: string;
  replacementProductPrice: number;
  replacementQuantity: number;
  price_difference: number;
  inventory_action: string;
};

type ReturnRow = {
  return_id: string;
  display_return_id: string;
  sales_id: string;
  display_sales_id: string;
  user_id: string;
  customerName: string;
  return_date: string;
  returnDateTime: string;
  total_refund: number;
  return_type: string;
  return_status: string;
  processedBy: string;
  staffCode: string;
  originalCashier: string;
  originalCashierCode: string;
  salesStatus: string;
  receiptProofName: string;
  receiptProofPath: string;
  receiptProofUrl: string;
  receiptVerifiedAt: string;
  returnDetails: ReturnDetail[];
};

type ExchangeForm = {
  sales_id: string;
  returned_product_id: string;
  replacement_product_id: string;
  quantity: number;
  reason: string;
  return_action: "Replacement" | "Partial Return" | "Full Return" | "Adjustment";
  inventory_action: "Defective / Not Sellable" | "Return to Stock";
};

type ReplacementLine = {
  line_id: string;
  sales_detail_id: string;
  returned_product_id: string;
  returned_product_name: string;
  replacement_product_id: string;
  replacement_product_name: string;
  quantity: number;
  returned_price_unit: number;
  replacement_price_unit: number;
  price_difference: number;
  inventory_action: "Defective / Not Sellable" | "Return to Stock";
};

const defaultForm: ExchangeForm = {
  sales_id: "",
  returned_product_id: "",
  replacement_product_id: "",
  quantity: 1,
  reason: "",
  return_action: "Replacement",
  inventory_action: "Defective / Not Sellable",
};

function QuantityStepper({
  value,
  min = 1,
  max = 999,
  disabled = false,
  onChange,
  className = "",
}: {
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
  className?: string;
}) {
  const clamp = (nextValue: number) => Math.min(Math.max(min, Math.floor(Number(nextValue) || min)), max);

  return (
    <div className={`inline-flex items-center justify-center rounded-xl border border-yellow-400/30 bg-[#1D1D25] p-1 ${className}`}>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - 1))}
        className="h-7 w-7 rounded-lg text-yellow-300 hover:bg-yellow-400 hover:text-[#171219] disabled:cursor-not-allowed disabled:opacity-40 p-0 flex items-center justify-center shrink-0"
      >
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <input
        type="text"
        inputMode="numeric"
        value={String(value)}
        disabled={disabled}
        onChange={(event) => onChange(clamp(Number(event.target.value.replace(/\D/g, ""))))}
        className="h-7 w-10 border-0 bg-transparent p-0 text-center text-sm font-bold text-yellow-100 outline-none focus:outline-none focus:ring-0 disabled:opacity-50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none leading-none flex items-center justify-center"
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + 1))}
        className="h-7 w-7 rounded-lg text-yellow-300 hover:bg-yellow-400 hover:text-[#171219] disabled:cursor-not-allowed disabled:opacity-40 p-0 flex items-center justify-center shrink-0"
      >
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

const REPLACEMENT_REASON_OPTIONS = [
  "Wrong size",
  "Damaged item",
  "Defective item",
  "Wrong item received",
  "Customer requested exchange",
  "Customer changed preference",
  "Others",
];

const RECEIPT_PROOF_BUCKET = "return-receipts";

function buildClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `ret_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function formatDate(v?: string | null) {
  return formatStoreDate(parseDbTimestamp(v));
}

function formatCurrency(value: number) {
  return `PHP ${Number(value || 0).toFixed(2)}`;
}

function formatSequence(prefix: string, sequence: number) {
  return `${prefix}-${String(sequence).padStart(3, "0")}`;
}

function withStaffCode(name: string, code?: string) {
  const cleanCode = String(code ?? "").trim();
  return cleanCode && cleanCode !== "N/A" ? `${name} (${cleanCode})` : name;
}

function normalizeProductName(value: string) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function formatReceiptNumber(salesId?: string, transactionDate?: string) {
  const dateStr = storeDateDigits(parseDbTimestamp(transactionDate) ?? new Date());
  if (!salesId) return `RCP-${dateStr}-0000`;
  if (salesId.startsWith("RCP-") || salesId.startsWith("INV-") || salesId.startsWith("SAL-")) return salesId;
  const cleanSuffix = salesId.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase();
  return `RCP-${dateStr}-${cleanSuffix}`;
}

function enhanceFrameForQr(srcData: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const len = w * h;
  let min = 255;
  let max = 0;
  const luma = new Uint8Array(len);

  for (let i = 0; i < len; i++) {
    const idx = i * 4;
    // Fast integer luminance approximation
    const l = (srcData[idx] * 77 + srcData[idx + 1] * 150 + srcData[idx + 2] * 29) >> 8;
    luma[i] = l;
    if (l < min) min = l;
    if (l > max) max = l;
  }

  const range = max - min || 1;
  const out = new Uint8ClampedArray(len * 4);

  // If already high contrast, return original
  if (range > 190 && min < 30 && max > 225) {
    return srcData;
  }

  // Stretch contrast across full dynamic range [0, 255]
  for (let i = 0; i < len; i++) {
    const idx = i * 4;
    const val = Math.min(255, Math.max(0, Math.round(((luma[i] - min) * 255) / range)));
    out[idx] = val;
    out[idx + 1] = val;
    out[idx + 2] = val;
    out[idx + 3] = 255;
  }
  return out;
}

async function decodeQrFromImageFile(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) return resolve(null);

          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(img, 0, 0);

          // Pass 1: Full image
          const fullData = ctx.getImageData(0, 0, w, h);
          let code = jsQR(fullData.data, w, h, { inversionAttempts: "dontInvert" });
          if (code?.data) return resolve(code.data.trim());

          code = jsQR(fullData.data, w, h, { inversionAttempts: "onlyInvert" });
          if (code?.data) return resolve(code.data.trim());

          // Pass 2: Bottom half crop (receipt QR codes are located at the bottom of the receipt)
          const bottomY = Math.floor(h * 0.45);
          const cropH = h - bottomY;
          const cropCanvas = document.createElement("canvas");
          cropCanvas.width = w;
          cropCanvas.height = cropH;
          const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
          if (cropCtx) {
            cropCtx.drawImage(canvas, 0, bottomY, w, cropH, 0, 0, w, cropH);
            const bottomData = cropCtx.getImageData(0, 0, w, cropH);
            code = jsQR(bottomData.data, w, cropH, { inversionAttempts: "attemptBoth" });
            if (code?.data) return resolve(code.data.trim());

            // Pass 2B: Contrast-enhanced bottom half
            const enhancedBottom = enhanceFrameForQr(bottomData.data, w, cropH);
            code = jsQR(enhancedBottom, w, cropH, { inversionAttempts: "attemptBoth" });
            if (code?.data) return resolve(code.data.trim());

            // Pass 3: Bottom 30% crop (tight zoom on footer)
            const bottom30Y = Math.floor(h * 0.7);
            const crop30H = h - bottom30Y;
            const crop30Canvas = document.createElement("canvas");
            crop30Canvas.width = w;
            crop30Canvas.height = crop30H;
            const crop30Ctx = crop30Canvas.getContext("2d", { willReadFrequently: true });
            if (crop30Ctx) {
              crop30Ctx.drawImage(canvas, 0, bottom30Y, w, crop30H, 0, 0, w, crop30H);
              const data30 = crop30Ctx.getImageData(0, 0, w, crop30H);
              code = jsQR(data30.data, w, crop30H, { inversionAttempts: "attemptBoth" });
              if (code?.data) return resolve(code.data.trim());

              // Pass 3B: Contrast-enhanced tight crop
              const enhanced30 = enhanceFrameForQr(data30.data, w, crop30H);
              code = jsQR(enhanced30, w, crop30H, { inversionAttempts: "attemptBoth" });
              if (code?.data) return resolve(code.data.trim());
            }
          }

          // Pass 4: Scaled down (in case photo is from high-megapixel phone)
          if (w > 1200 || h > 1600) {
            const scale = Math.min(800 / w, 1200 / h);
            const scaledCanvas = document.createElement("canvas");
            scaledCanvas.width = Math.floor(w * scale);
            scaledCanvas.height = Math.floor(h * scale);
            const scaledCtx = scaledCanvas.getContext("2d", { willReadFrequently: true });
            if (scaledCtx) {
              scaledCtx.drawImage(img, 0, 0, scaledCanvas.width, scaledCanvas.height);
              const scaledData = scaledCtx.getImageData(0, 0, scaledCanvas.width, scaledCanvas.height);
              code = jsQR(scaledData.data, scaledCanvas.width, scaledCanvas.height, { inversionAttempts: "attemptBoth" });
              if (code?.data) return resolve(code.data.trim());
            }
          }

          resolve(null);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = String(reader.result ?? "");
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

async function tryUpdateById(table: string, idColumn: string, id: string, payloads: Record<string, any>[]) {
  let lastError: any = null;
  for (const payload of payloads) {
    const { error } = await supabase.from(table as any).update(payload).eq(idColumn as any, id);
    if (!error) return;
    lastError = error;
  }
  if (lastError) throw lastError;
}

async function tryInsertRow(table: string, payloads: Record<string, any>[]) {
  let lastError: any = null;
  for (const payload of payloads) {
    const { error } = await supabase.from(table as any).insert(payload);
    if (!error) return;
    lastError = error;
  }
  if (lastError) throw lastError;
}

function isMissingTableError(error: any) {
  const message = String(error?.message ?? "").toLowerCase();
  return message.includes("could not find the table") || message.includes("relation") && message.includes("does not exist");
}

async function resolveExistingTableName(candidates: string[]) {
  let lastError: any = null;
  for (const table of candidates) {
    const { error } = await supabase.from(table as any).select("*").limit(1);
    if (!error) return table;
    lastError = error;
    if (!isMissingTableError(error)) throw error;
  }
  if (lastError) throw lastError;
  throw new Error(`Could not resolve any table from: ${candidates.join(", ")}`);
}

function normalizeSaleStatus(value: string | null | undefined) {
  const normalized = String(value ?? "Completed").trim();
  return normalized || "Completed";
}

export function ReturnManagement() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const returnsQuery = useReturns();
  const salesQuery = useSales();
  const productsQuery = useProducts();
  const inventoryQuery = useInventory();
  const usersQuery = useUsers();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedStaff, setSelectedStaff] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [datePreset, setDatePreset] = useState<"all" | "today" | "week" | "month" | "quarter" | "year" | "custom">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [viewingReturn, setViewingReturn] = useState<ReturnRow | null>(null);
  const [formData, setFormData] = useState<ExchangeForm>(defaultForm);
  const [isSaving, setIsSaving] = useState(false);
  const [salePickerSearch, setSalePickerSearch] = useState("");
  const [returnedItemSearch, setReturnedItemSearch] = useState("");
  const [replacementSearch, setReplacementSearch] = useState("");
  const [isReplacementPickerOpen, setIsReplacementPickerOpen] = useState(false);
  const [selectedReturnedDetailIds, setSelectedReturnedDetailIds] = useState<string[]>([]);
  const [returnedItemQtyByDetail, setReturnedItemQtyByDetail] = useState<Record<string, number>>({});
  const [replacementLines, setReplacementLines] = useState<ReplacementLine[]>([]);
  const [reasonOption, setReasonOption] = useState("");
  const [customReason, setCustomReason] = useState("");
  const [receiptProofFile, setReceiptProofFile] = useState<File | null>(null);
  const [receiptProofPreview, setReceiptProofPreview] = useState("");
  const [receiptNumberInput, setReceiptNumberInput] = useState("");
  const [receiptValidationStatus, setReceiptValidationStatus] = useState<{
    state: "idle" | "valid" | "expired_warning" | "already_replaced" | "not_found" | "no_returnable_items";
    message?: string;
    daysAgo?: number;
    purchaseDate?: string;
    customerName?: string;
    totalAmount?: number;
    displayId?: string;
    returnableCount?: number;
  }>({ state: "idle" });
  const [showManualSaleList, setShowManualSaleList] = useState(false);
  const [printExchangeSlip, setPrintExchangeSlip] = useState<ReturnRow | null>(null);
  const [storedReceiptsMap, setStoredReceiptsMap] = useState<Map<string, StoredReceiptProof>>(new Map());
  const [isQrScannerOpen, setIsQrScannerOpen] = useState(false);
  const [validatedViaQr, setValidatedViaQr] = useState(false);
  const [qrScanError, setQrScanError] = useState<string | null>(null);
  const [cameraLoading, setCameraLoading] = useState(false);
  const [cameraZoom, setCameraZoom] = useState<number>(1);
  const [availableCameras, setAvailableCameras] = useState<any[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [scannerManualInput, setScannerManualInput] = useState("");
  const [retryTrigger, setRetryTrigger] = useState(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  useEffect(() => {
    getAllReceiptProofs().then((map) => {
      setStoredReceiptsMap(map);
    });

    const handleSaved = (event: any) => {
      const proof = event.detail as StoredReceiptProof;
      if (proof) {
        setStoredReceiptsMap((prev) => {
          const next = new Map(prev);
          if (proof.returnId) next.set(proof.returnId, proof);
          if (proof.salesId) next.set(`sale_${proof.salesId}`, proof);
          return next;
        });
      }
    };

    window.addEventListener("receipt-proof-saved", handleSaved);
    return () => window.removeEventListener("receipt-proof-saved", handleSaved);
  }, []);

  const sales = (salesQuery.data as any[]) ?? [];
  const productRows = (productsQuery.data as any[]) ?? [];
  const inventoryRows = (inventoryQuery.data as any[]) ?? [];
  const returnRows = (returnsQuery.data as any[]) ?? [];
  const isAdmin = String(user?.role_name ?? "").trim().toLowerCase().includes("admin");
  const selectedReplacementReason = reasonOption === "Others" ? customReason.trim() : reasonOption.trim();
  const normalizedReplacementReason = selectedReplacementReason.toLowerCase();
  const isUnsellableReason = normalizedReplacementReason.includes("damaged") || normalizedReplacementReason.includes("defective");
  const effectiveInventoryAction: ExchangeForm["inventory_action"] = isUnsellableReason
    ? "Defective / Not Sellable"
    : formData.inventory_action;
  const replacedSalesIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of returnRows) {
      const type = String(row.return_type ?? "Replacement").trim().toLowerCase();
      const status = String(row.return_status ?? "Completed").trim().toLowerCase();
      if (type.includes("replacement") && status !== "cancelled") {
        const saleId = String(row.original_sales_id ?? row.sales_id ?? "");
        if (saleId) ids.add(saleId);
      }
    }
    return ids;
  }, [returnRows]);

  const salesDisplayMap = useMemo(() => {
    const map = new Map<string, string>();
    [...sales]
      .sort((a, b) => {
        const aTime = new Date(a.transaction_date ?? "").getTime();
        const bTime = new Date(b.transaction_date ?? "").getTime();
        return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
      })
      .forEach((sale, index) => map.set(String(sale.sales_id ?? ""), formatSequence("RCP", index + 1)));
    return map;
  }, [sales]);

  const products = useMemo(() => {
    const inventoryByProductId = new Map<string, any>();
    for (const inv of inventoryRows) {
      inventoryByProductId.set(String(inv.product_id ?? ""), inv);
    }

    return productRows
      .map((product: any) => {
        const inventory = Array.isArray(product.inventory)
          ? product.inventory[0]
          : product.inventory ?? inventoryByProductId.get(String(product.product_id ?? ""));
        const price = Number(inventory?.srp ?? product.price ?? product.cost_price ?? 0);
        return {
          product_id: String(product.product_id ?? ""),
          name: String(product.product_name ?? "Unnamed Product"),
          brand: String(product.brand ?? "N/A"),
          size: String(product.size ?? "N/A"),
          color: String(product.color ?? "N/A"),
          price,
          stock: Number(inventory?.stock_quantity ?? 0),
          inventory_id: inventory?.inventory_id ? String(inventory.inventory_id) : "",
          reorder_level: Number(inventory?.reorder_level ?? product.reorder_level ?? 10),
        };
      })
      .filter((product) => product.product_id)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [inventoryRows, productRows]);

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.product_id, product])),
    [products],
  );

  const salesOptions = useMemo(
    () =>
      sales
        .filter((sale: any) => isAdmin || String(sale.user_id ?? "") === String(user?.user_id ?? ""))
        .map((sale: any) => {
          const customer = Array.isArray(sale.customer) ? sale.customer[0] : sale.customer;
          const details = Array.isArray(sale.sales_details) ? sale.sales_details : [];
          return {
            sales_id: String(sale.sales_id ?? ""),
            display_sales_id: salesDisplayMap.get(String(sale.sales_id ?? "")) ?? "SALES-000",
            customerName: customer?.name ?? "Walk-in Customer",
            user_id: String(sale.user_id ?? ""),
            total_amount: Number(sale.total_amount ?? 0),
            sales_status: normalizeSaleStatus(sale.sales_status ?? sale.status),
            return_status: String(sale.return_status ?? "None"),
            details: details.map((detail: any) => {
              const product = Array.isArray(detail.product) ? detail.product[0] : detail.product;
              const qty = Number(detail.quantity ?? 0);
              const returnedQty = Number(detail.returned_quantity ?? 0);
              const remainingQty = Math.max(0, qty - returnedQty);
              return {
                sales_detail_id: String(detail.sales_detail_id ?? ""),
                product_id: String(detail.product_id ?? ""),
                productName: product?.product_name ?? productMap.get(String(detail.product_id ?? ""))?.name ?? "N/A",
                quantity: qty,
                returned_quantity: returnedQty,
                returnable_quantity: remainingQty > 0 ? remainingQty : Math.max(1, qty),
                price: Number(detail.price ?? (qty ? Number(detail.subtotal ?? 0) / qty : 0)),
                subtotal: Number(detail.subtotal ?? 0),
              };
            }),
            customer_id: String(sale.customer_id ?? ""),
          };
        })
        .filter((sale) => sale.details.length > 0),
    [isAdmin, productMap, sales, salesDisplayMap, user?.user_id],
  );

  const selectedSale = salesOptions.find((sale) => sale.sales_id === formData.sales_id);
  const selectedReturnedItems = useMemo(() => {
    const selected = new Set(selectedReturnedDetailIds);
    const details = selectedSale?.details ?? [];
    return details.filter((detail) => selected.has(detail.sales_detail_id));
  }, [selectedReturnedDetailIds, selectedSale?.details]);
  const selectedReturnedItemsWithQty = useMemo(
    () =>
      selectedReturnedItems.map((item) => {
        const itemMax = Math.max(1, Number(item.returnable_quantity > 0 ? item.returnable_quantity : item.quantity || 1));
        return {
          ...item,
          selectedQty: Math.min(
            Math.max(1, Number(returnedItemQtyByDetail[item.sales_detail_id] ?? formData.quantity ?? 1)),
            itemMax,
          ),
        };
      }),
    [formData.quantity, returnedItemQtyByDetail, selectedReturnedItems],
  );
  const selectedOriginalItem =
    selectedReturnedItems[0] ??
    selectedSale?.details.find((detail) => detail.product_id === formData.returned_product_id);
  const replacementProduct =
    productMap.get(formData.replacement_product_id) ??
    (selectedOriginalItem ? productMap.get(selectedOriginalItem.product_id) : undefined);
  const requiresReplacement = formData.return_action === "Replacement" || formData.return_action === "Adjustment";
  const maxReturnQty = Math.max(
    1,
    selectedReturnedItems.length
      ? Math.min(...selectedReturnedItems.map((item) => Number(item.returnable_quantity > 0 ? item.returnable_quantity : item.quantity || 1)))
      : Number(selectedOriginalItem?.returnable_quantity > 0 ? selectedOriginalItem?.returnable_quantity : selectedOriginalItem?.quantity || 1),
  );
  const quantity = Math.min(Math.max(1, Number(formData.quantity || 1)), maxReturnQty);
  const originalTotal =
    selectedReturnedItemsWithQty.length > 0
      ? selectedReturnedItemsWithQty.reduce((sum, item) => sum + Number(item.price ?? 0) * Number(item.selectedQty ?? 1), 0)
      : Number(selectedOriginalItem?.price ?? 0) * quantity;
  const replacementTotal =
    selectedReturnedItemsWithQty.length > 0
      ? selectedReturnedItemsWithQty.reduce((sum, item) => {
          const chosenId = formData.replacement_product_id || item.product_id;
          const repItem = productMap.get(chosenId) ?? productMap.get(item.product_id);
          return sum + Number(repItem?.price ?? item.price ?? 0) * Number(item.selectedQty ?? 1);
        }, 0)
      : Number(replacementProduct?.price ?? 0) * quantity;

  const hasSaleSelected = Boolean(selectedSale);
  const hasReturnedSelected = selectedReturnedItems.length > 0;
  const hasReplacementSelected =
    selectedReturnedItemsWithQty.length > 0 &&
    (Boolean(formData.replacement_product_id)
      ? Boolean(productMap.get(formData.replacement_product_id))
      : selectedReturnedItemsWithQty.every((item) => Boolean(productMap.get(item.product_id))));

  const isSameProductModel = (productIdA: string, productIdB: string) => {
    if (!productIdA || !productIdB) return false;
    if (productIdA === productIdB) return true;
    const prodA = productMap.get(productIdA);
    const prodB = productMap.get(productIdB);
    if (!prodA || !prodB) return false;
    return normalizeProductName(prodA.name) === normalizeProductName(prodB.name);
  };

  const eligibleReplacementProducts = useMemo(() => {
    if (selectedReturnedItemsWithQty.length === 0) return [];
    const returnedNames = new Set(
      selectedReturnedItemsWithQty
        .map((item) => {
          const prod = productMap.get(item.product_id);
          return normalizeProductName(prod?.name || item.productName || "");
        })
        .filter(Boolean),
    );
    const selectedProductIds = new Set(selectedReturnedItemsWithQty.map((item) => item.product_id));

    return products.filter((product) => {
      const prodName = normalizeProductName(product.name);
      return selectedProductIds.has(product.product_id) || (Boolean(prodName) && returnedNames.has(prodName));
    });
  }, [products, productMap, selectedReturnedItemsWithQty]);

  const filteredSaleOptions = useMemo(() => {
    const term = salePickerSearch.trim().toLowerCase();
    if (!term) return salesOptions;
    return salesOptions.filter((sale) =>
      [sale.display_sales_id, sale.sales_id, sale.customerName, sale.sales_status, sale.return_status]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [salePickerSearch, salesOptions]);

  const filteredReturnedItems = useMemo(() => {
    const term = returnedItemSearch.trim().toLowerCase();
    const details = selectedSale?.details ?? [];
    if (!term) return details;
    return details.filter((detail) =>
      [detail.product_id, detail.productName, String(detail.quantity), String(detail.price)]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [returnedItemSearch, selectedSale?.details]);

  const filteredReplacementProducts = useMemo(() => {
    const term = replacementSearch.trim().toLowerCase();
    const availableProducts = eligibleReplacementProducts.filter((product) => product.stock > 0);
    if (!term) return availableProducts;
    return availableProducts.filter((product) =>
      [
        product.product_id,
        product.name,
        product.brand,
        product.color,
        product.size,
        String(product.price),
        String(product.stock),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [eligibleReplacementProducts, replacementSearch]);

  const selectSaleForReturn = (saleId: string) => {
    // Always reset dependent selection state when switching sale context.
    setReplacementLines([]);
    setSelectedReturnedDetailIds([]);
    setReturnedItemQtyByDetail({});
    setReturnedItemSearch("");
    setReplacementSearch("");
    setFormData((current) => ({
      ...current,
      sales_id: saleId,
      returned_product_id: "",
      replacement_product_id: "",
      quantity: 1,
    }));
    const disp = salesDisplayMap.get(saleId);
    if (disp) {
      setReceiptNumberInput(disp);
    }
  };

  const validateReceiptNumber = (queryToValidate?: string) => {
    let rawQuery = (queryToValidate ?? receiptNumberInput).trim();
    if (!rawQuery) {
      toast.error("Please enter a receipt number to validate.");
      return;
    }

    // Unpack possible JSON encoded QR payloads (e.g. {"sales_id":"..."})
    try {
      if (rawQuery.startsWith("{") && rawQuery.endsWith("}")) {
        const parsed = JSON.parse(rawQuery);
        rawQuery = parsed.sales_id || parsed.id || parsed.receiptNumber || parsed.receipt || rawQuery;
      }
    } catch {}

    // Strip out enclosing asterisks (e.g. *RCP-20260501-C425*) or quotes
    const cleanQuery = rawQuery.replace(/^[\*"'`\s]+|[\*"'`\s]+$/g, "").trim();
    const q = cleanQuery.toLowerCase();
    const cleanDigits = q.replace(/\D/g, "");
    const qLastFour = q.replace(/[^a-z0-9]/g, "").slice(-4);

    // 1. Search in all sales (by Sales ID UUID, Display ID RCP-xxx, Official Receipt Number, or Suffix)
    const matchedSale = sales.find((s: any) => {
      const saleId = String(s.sales_id ?? "").toLowerCase();
      const displayId = (salesDisplayMap.get(String(s.sales_id ?? "")) ?? "").toLowerCase();
      const rcpNum = formatReceiptNumber(s.sales_id, s.transaction_date).toLowerCase();
      const lastFour = saleId.replace(/[^a-z0-9]/g, "").slice(-4);
      const displayDigits = displayId.replace(/\D/g, "");

      return (
        displayId === q ||
        saleId === q ||
        rcpNum === q ||
        displayId.includes(q) ||
        saleId.includes(q) ||
        rcpNum.includes(q) ||
        q.includes(saleId) ||
        q.includes(displayId) ||
        q.includes(rcpNum) ||
        (lastFour.length === 4 && (qLastFour === lastFour || q.endsWith(lastFour) || q.includes(lastFour))) ||
        (cleanDigits.length > 0 && (displayDigits === cleanDigits || cleanDigits.endsWith(displayDigits) || saleId.includes(cleanDigits)))
      );
    });

    if (!matchedSale) {
      const displayQuery = rawQuery.length > 32 ? `${rawQuery.slice(0, 32)}...` : rawQuery;
      setReceiptValidationStatus({
        state: "not_found",
        message: `No transaction found matching receipt "${displayQuery}". Please verify the printed receipt.`,
      });
      toast.error(`Receipt "${displayQuery}" not found.`);
      return;
    }

    const saleId = String(matchedSale.sales_id ?? "");
    const displayId = salesDisplayMap.get(saleId) ?? "SALES-000";
    const receiptNumber = formatReceiptNumber(saleId, matchedSale.transaction_date);
    const receiptDisplay = `${receiptNumber} (${displayId})`;
    const customer = Array.isArray(matchedSale.customer) ? matchedSale.customer[0] : matchedSale.customer;
    const customerName = customer?.name ?? "Walk-in Customer";
    const totalAmount = Number(matchedSale.total_amount ?? 0);
    const purchaseDate = matchedSale.transaction_date ? formatDate(matchedSale.transaction_date) : "N/A";
    const txnTime = new Date(matchedSale.transaction_date ?? "").getTime();
    const daysAgo = Number.isNaN(txnTime) ? 0 : Math.max(0, Math.floor((Date.now() - txnTime) / (1000 * 60 * 60 * 24)));

    // 2. Check previous replacement and 7-day policy status (both are permitted to proceed)
    const isAlreadyReplaced = replacedSalesIds.has(saleId);
    const isExpired = daysAgo > 7;

    const rawDetails = Array.isArray(matchedSale.sales_details) ? matchedSale.sales_details : [];
    const totalSoldItems = rawDetails.reduce((acc: number, d: any) => acc + Number(d.quantity ?? 1), 0);
    const remainingReturnable = rawDetails.reduce((acc: number, d: any) => {
      const qty = Number(d.quantity ?? 0);
      const ret = Number(d.returned_quantity ?? 0);
      return acc + Math.max(0, qty - ret);
    }, 0);
    const effectiveReturnableCount = remainingReturnable > 0 ? remainingReturnable : Math.max(1, totalSoldItems);

    let validationState: "valid" | "expired_warning" | "already_replaced" = "valid";
    let statusMessage = "";

    if (isAlreadyReplaced) {
      validationState = "already_replaced";
      statusMessage = `Receipt was previously replaced. Repeat replacement is permitted — you may proceed to select items and finalize.`;
    } else if (isExpired) {
      validationState = "expired_warning";
      statusMessage = `Receipt found (${daysAgo} days ago, exceeds standard 7-day policy). Replacement is permitted — you may proceed.`;
    } else {
      validationState = "valid";
      statusMessage = `Receipt verified! Purchased ${daysAgo === 0 ? "today" : `${daysAgo} day${daysAgo > 1 ? "s" : ""} ago`} • Within return policy.`;
    }

    setReceiptValidationStatus({
      state: validationState,
      displayId: receiptDisplay,
      customerName,
      totalAmount,
      purchaseDate,
      daysAgo,
      returnableCount: effectiveReturnableCount,
      message: statusMessage,
    });

    // Auto-select this sale for Step 2 regardless of 7 days or prior replacement
    selectSaleForReturn(saleId);

    if (isAlreadyReplaced) {
      toast.info(`Receipt ${receiptDisplay} was previously replaced. Repeat replacement is allowed.`);
    } else if (isExpired) {
      toast.info(`Receipt ${receiptDisplay} exceeds 7-day policy (${daysAgo} days ago). Replacement is allowed.`);
    } else {
      toast.success(`Receipt ${receiptDisplay} verified successfully!`);
    }
  };

  // Apply digital zoom and hardware zoom whenever cameraZoom changes
  useEffect(() => {
    const video = document.querySelector("#receipt-qr-reader video") as HTMLVideoElement | null;
    if (video) {
      video.style.transform = `scale(${cameraZoom})`;
      video.style.transformOrigin = "center center";
      video.style.transition = "transform 0.2s ease-out";
      const track = (video.srcObject as MediaStream)?.getVideoTracks()?.[0];
      if (track) {
        try {
          const caps: any = track.getCapabilities ? track.getCapabilities() : {};
          if (caps.zoom) {
            track.applyConstraints({ advanced: [{ zoom: cameraZoom } as any] }).catch(() => {});
          }
        } catch {}
      }
    }
  }, [cameraZoom]);

  const toggleTorch = async () => {
    const video = document.querySelector("#receipt-qr-reader video") as HTMLVideoElement | null;
    if (video) {
      const track = (video.srcObject as MediaStream)?.getVideoTracks()?.[0];
      if (track) {
        try {
          const nextTorch = !torchOn;
          await track.applyConstraints({ advanced: [{ torch: nextTorch } as any] });
          setTorchOn(nextTorch);
        } catch {}
      }
    }
  };

  const handleManualInputInScanner = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setIsQrScannerOpen(false);
    setReceiptNumberInput(clean);
    setValidatedViaQr(true);
    validateReceiptNumber(clean);
    setScannerManualInput("");
  };

  useEffect(() => {
    let qrScanner: Html5Qrcode | null = null;
    let nativeStream: MediaStream | null = null;
    let scanInterval: any = null;
    let isMounted = true;
    let scanningActive = true;
    let isProcessing = false;

    if (isQrScannerOpen) {
      setQrScanError(null);
      setCameraLoading(true);
      setTorchOn(false);
      setTorchSupported(false);

      const offscreenCanvas = document.createElement("canvas");
      const offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });

      let nativeDetector: any = null;
      if (typeof window !== "undefined" && "BarcodeDetector" in window) {
        try {
          nativeDetector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });
        } catch {
          nativeDetector = null;
        }
      }

      const handleDetectedQr = (decodedText: string) => {
        if (!isMounted || !scanningActive) return;
        scanningActive = false;
        if (scanInterval) {
          clearInterval(scanInterval);
          scanInterval = null;
        }
        const clean = decodedText.trim();
        setIsQrScannerOpen(false);
        setReceiptNumberInput(clean);
        setValidatedViaQr(true);
        validateReceiptNumber(clean);
        toast.success(`Receipt QR Code scanned successfully!`);
      };

      const startFrameScanLoop = () => {
        if (scanInterval) clearInterval(scanInterval);
        scanInterval = setInterval(async () => {
          if (!scanningActive || isProcessing || !isMounted) return;
          const currentVideo = document.querySelector("#receipt-qr-reader video") as HTMLVideoElement | null;
          if (!currentVideo || currentVideo.readyState < 2 || currentVideo.videoWidth === 0) return;

          isProcessing = true;
          try {
            // 1. Primary Engine: Native BarcodeDetector (Chrome, Edge, Android)
            // Ultra fast, ML-assisted C++ pipeline, highly tolerant of blur & tilt
            if (nativeDetector) {
              try {
                const barcodes = await nativeDetector.detect(currentVideo);
                if (barcodes && barcodes.length > 0 && barcodes[0]?.rawValue) {
                  handleDetectedQr(barcodes[0].rawValue);
                  return;
                }
              } catch {}
            }

            // 2. Secondary Engine: Canvas-based jsQR with Multi-Pass Processing
            if (offscreenCtx) {
              const vw = currentVideo.videoWidth;
              const vh = currentVideo.videoHeight;

              // Pass 2A: Full frame scan
              const targetW = Math.min(vw, 1024);
              const scale = targetW / vw;
              const targetH = Math.floor(vh * scale);

              offscreenCanvas.width = targetW;
              offscreenCanvas.height = targetH;
              offscreenCtx.drawImage(currentVideo, 0, 0, targetW, targetH);

              const fullImg = offscreenCtx.getImageData(0, 0, targetW, targetH);
              let res = jsQR(fullImg.data, targetW, targetH, { inversionAttempts: "dontInvert" });
              if (res?.data) {
                handleDetectedQr(res.data);
                return;
              }

              // Pass 2B: Center Crop (50% central window)
              // Mimics optical zoom for receipts held ~25-30cm away in sharp focal zone
              const cropSize = Math.floor(Math.min(vw, vh) * 0.55);
              const cropX = Math.floor((vw - cropSize) / 2);
              const cropY = Math.floor((vh - cropSize) / 2);

              offscreenCanvas.width = cropSize;
              offscreenCanvas.height = cropSize;
              offscreenCtx.drawImage(currentVideo, cropX, cropY, cropSize, cropSize, 0, 0, cropSize, cropSize);

              const centerImg = offscreenCtx.getImageData(0, 0, cropSize, cropSize);
              res = jsQR(centerImg.data, cropSize, cropSize, { inversionAttempts: "attemptBoth" });
              if (res?.data) {
                handleDetectedQr(res.data);
                return;
              }

              // Pass 2C: Contrast-Enhanced Center Crop (for faint thermal paper dots)
              const enhancedData = enhanceFrameForQr(centerImg.data, cropSize, cropSize);
              res = jsQR(enhancedData, cropSize, cropSize, { inversionAttempts: "attemptBoth" });
              if (res?.data) {
                handleDetectedQr(res.data);
                return;
              }
            }
          } catch {} finally {
            isProcessing = false;
          }
        }, 75);
      };

      const stopTracks = () => {
        if (nativeStream) {
          nativeStream.getTracks().forEach((t) => {
            try { t.stop(); } catch {}
          });
          nativeStream = null;
        }
        const video = document.querySelector("#receipt-qr-reader video") as HTMLVideoElement | null;
        if (video?.srcObject) {
          try {
            (video.srcObject as MediaStream).getTracks().forEach((t) => {
              try { t.stop(); } catch {}
            });
          } catch {}
          video.srcObject = null;
        }
      };

      const handleTrackCaps = () => {
        const video = document.querySelector("#receipt-qr-reader video") as HTMLVideoElement | null;
        if (video) {
          video.style.transform = `scale(${cameraZoom})`;
          video.style.transformOrigin = "center center";
          const track = (video.srcObject as MediaStream)?.getVideoTracks()?.[0];
          if (track) {
            try {
              const caps: any = track.getCapabilities ? track.getCapabilities() : {};
              if (caps.focusMode && Array.isArray(caps.focusMode) && caps.focusMode.includes("continuous")) {
                track.applyConstraints({ advanced: [{ focusMode: "continuous" } as any] }).catch(() => {});
              }
              if (caps.torch) {
                setTorchSupported(true);
              }
            } catch {}
          }
        }
      };

      const updateAvailableCameras = async () => {
        try {
          if (typeof navigator !== "undefined" && navigator.mediaDevices?.enumerateDevices) {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter((d) => d.kind === "videoinput");
            if (videoDevices.length > 0 && isMounted) {
              setAvailableCameras(
                videoDevices.map((d, i) => ({
                  id: d.deviceId,
                  label: d.label || `Camera ${i + 1}`,
                }))
              );
            }
          }
        } catch {}
      };

      const initScanner = async () => {
        try {
          stopTracks();
          setQrScanError(null);
          setCameraLoading(true);

          if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
            const isSecure = typeof window !== "undefined" ? window.isSecureContext : true;
            throw new Error(
              !isSecure
                ? "INSECURE_CONTEXT: Camera access requires HTTPS or localhost."
                : "Camera is not supported on this browser."
            );
          }

          const scanConfig = {
            fps: 20,
            qrbox: (w: number, h: number) => {
              const edge = Math.floor(Math.min(w, h) * 0.85);
              return { width: edge, height: edge };
            },
            aspectRatio: 1.0,
          };

          let started = false;

          // Attempt 1: Html5Qrcode using selectedCameraId or environment/user facingMode
          try {
            const scanner = new Html5Qrcode("receipt-qr-reader");
            qrScanner = scanner;

            if (selectedCameraId) {
              await scanner.start(
                selectedCameraId,
                scanConfig,
                (text) => handleDetectedQr(text),
                () => {}
              );
              started = true;
            } else {
              try {
                // Try rear camera first (for mobile/tablet)
                await scanner.start(
                  { facingMode: "environment" },
                  scanConfig,
                  (text) => handleDetectedQr(text),
                  () => {}
                );
                started = true;
              } catch (envErr) {
                console.warn("Rear camera start failed, trying front/webcam:", envErr);
                // Fallback to front webcam (standard for laptops/PCs)
                try { scanner.clear(); } catch {}
                const fallbackScanner = new Html5Qrcode("receipt-qr-reader");
                qrScanner = fallbackScanner;
                await fallbackScanner.start(
                  { facingMode: "user" },
                  scanConfig,
                  (text) => handleDetectedQr(text),
                  () => {}
                );
                started = true;
              }
            }
          } catch (html5Err) {
            console.warn("Html5Qrcode engine failed, falling back to direct WebRTC:", html5Err);
          }

          // Attempt 2: Direct WebRTC getUserMedia stream fallback
          if (!started && isMounted) {
            const container = document.getElementById("receipt-qr-reader");
            if (!container) throw new Error("Receipt QR container element not found.");
            container.innerHTML = "";

            let stream: MediaStream | null = null;
            try {
              stream = await navigator.mediaDevices.getUserMedia({
                video: selectedCameraId
                  ? { deviceId: { exact: selectedCameraId } }
                  : {
                      facingMode: { ideal: "user" },
                      width: { ideal: 1280 },
                      height: { ideal: 720 },
                    },
                audio: false,
              });
            } catch {
              // Lowest possible constraint fallback
              stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            }

            if (!stream) throw new Error("Could not acquire camera video stream.");
            nativeStream = stream;

            const videoEl = document.createElement("video");
            videoEl.autoplay = true;
            videoEl.muted = true;
            videoEl.playsInline = true;
            videoEl.setAttribute("playsinline", "true");
            videoEl.className = "w-full h-full object-cover rounded-xl";
            videoEl.srcObject = stream;
            container.appendChild(videoEl);
            await videoEl.play().catch(() => {});
            started = true;
          }

          if (isMounted && started) {
            setCameraLoading(false);
            setQrScanError(null);
            handleTrackCaps();
            startFrameScanLoop();
            updateAvailableCameras();
          }
        } catch (err: any) {
          if (!isMounted) return;
          setCameraLoading(false);
          console.warn("Camera QR Scanner error:", err);

          const errorName = err?.name || "";
          const errorMsg = String(err?.message || "").toLowerCase();

          let friendly = "Unable to access camera directly. You can upload or drag a photo of the receipt QR code below.";

          if (
            errorName === "NotAllowedError" ||
            errorName === "PermissionDeniedError" ||
            errorMsg.includes("permission") ||
            errorMsg.includes("allowed")
          ) {
            friendly = "Camera permission was denied. Please allow camera access in your browser (check the lock or camera icon in your address bar) or upload a receipt photo below.";
          } else if (
            errorName === "NotReadableError" ||
            errorName === "TrackStartError" ||
            errorMsg.includes("could not start video source") ||
            errorMsg.includes("in use")
          ) {
            friendly = "Webcam is currently busy or in use by another application (e.g. Zoom, Teams, or another window). Please close other apps and click Try Again.";
          } else if (
            errorName === "NotFoundError" ||
            errorName === "DevicesNotFoundError" ||
            errorMsg.includes("not found") ||
            errorMsg.includes("no camera")
          ) {
            friendly = "No camera was detected on this computer. You can connect a webcam, enter the receipt number, or upload a photo below.";
          } else if (
            errorName === "OverconstrainedError" ||
            errorName === "ConstraintNotSatisfiedError"
          ) {
            friendly = "Camera resolution constraints not supported by your hardware. Click Try Again to retry with standard webcam settings.";
          } else if (errorMsg.includes("insecure") || (typeof window !== "undefined" && !window.isSecureContext)) {
            friendly = "Camera access requires a secure connection (HTTPS or http://localhost). You can enter the receipt number or upload a photo below.";
          }

          setQrScanError(friendly);
        }
      };

      const timer = setTimeout(initScanner, 200);
      return () => {
        isMounted = false;
        scanningActive = false;
        clearTimeout(timer);
        if (scanInterval) {
          clearInterval(scanInterval);
          scanInterval = null;
        }
        stopTracks();
        if (qrScanner) {
          try {
            if (qrScanner.isScanning) {
              qrScanner.stop().catch(() => {}).finally(() => {
                try { qrScanner?.clear(); } catch {}
              });
            } else {
              qrScanner.clear();
            }
          } catch {}
          qrScanner = null;
        }
      };
    }
  }, [isQrScannerOpen, selectedCameraId, retryTrigger]);

  const handleScanQrFromFile = async (file: File) => {
    try {
      // 1. High-speed multi-pass canvas decoder with jsQR
      const decodedText = await decodeQrFromImageFile(file);
      if (decodedText) {
        const clean = decodedText.trim();
        setIsQrScannerOpen(false);
        setReceiptNumberInput(clean);
        setValidatedViaQr(true);
        validateReceiptNumber(clean);
        toast.success(`Receipt QR Code decoded successfully from image!`);
        return;
      }

      // 2. Secondary fallback via Html5Qrcode without DOM rendering
      try {
        const html5QrCode = new Html5Qrcode("receipt-file-qr-temp");
        const fallbackText = await html5QrCode.scanFile(file, false);
        if (fallbackText) {
          const clean = fallbackText.trim();
          setIsQrScannerOpen(false);
          setReceiptNumberInput(clean);
          setValidatedViaQr(true);
          validateReceiptNumber(clean);
          toast.success(`Receipt QR Code decoded successfully from image!`);
          return;
        }
      } catch {
        // Fallback failed
      }

      toast.error("Could not detect a QR code in this receipt image. Please ensure the QR code at the bottom is clear and visible.");
    } catch (err) {
      toast.error("Could not process receipt image. Please try another photo.");
    }
  };

  const toggleReturnedProduct = (salesDetailId: string, productId: string) => {
    setSelectedReturnedDetailIds((prev) => {
      if (prev.includes(salesDetailId)) {
        const next = prev.filter((id) => id !== salesDetailId);
        setReturnedItemQtyByDetail((qtyPrev) => {
          const copy = { ...qtyPrev };
          delete copy[salesDetailId];
          return copy;
        });
        const nextSelectedProductId = selectedSale?.details.find((detail: any) => next.includes(detail.sales_detail_id))?.product_id ?? "";
        if (next.length === 0) {
          setFormData((current) => ({ ...current, returned_product_id: "", replacement_product_id: "" }));
        } else {
          setFormData((current) => ({
            ...current,
            returned_product_id: nextSelectedProductId,
            replacement_product_id: nextSelectedProductId,
          }));
        }
        return next;
      }
      setFormData((current) => ({ ...current, returned_product_id: productId, replacement_product_id: productId }));
      setReturnedItemQtyByDetail((qtyPrev) => ({ ...qtyPrev, [salesDetailId]: Number(formData.quantity || 1) }));
      return [...prev, salesDetailId];
    });
  };

  const selectReplacementProduct = (productId: string) => {
    const isEligible = selectedReturnedItems.some((item) => isSameProductModel(item.product_id, productId));
    if (!isEligible) {
      toast.error("Replacement must be the same shoe model / variant.");
      return;
    }
    setFormData((current) => ({ ...current, replacement_product_id: productId }));
    setIsReplacementPickerOpen(false);
  };

  const addReplacementLine = () => {
    if (!selectedSale || selectedReturnedItemsWithQty.length === 0 || !hasReplacementSelected) {
      toast.error("Select sale and replaced item(s) first");
      return;
    }
    const duplicate = selectedReturnedItemsWithQty.find((item) =>
      replacementLines.some((line) => line.sales_detail_id === item.sales_detail_id),
    );
    if (duplicate) {
      toast.error(`${duplicate.productName} is already in the replacement list`);
      return;
    }
    const invalidQty = selectedReturnedItemsWithQty.find((item) => Number(item.selectedQty ?? 1) > Number(item.returnable_quantity ?? 0));
    if (invalidQty) {
      toast.error(`Only ${invalidQty.returnable_quantity} unit(s) can be returned from ${invalidQty.productName}`);
      return;
    }
    const stockNeededByProduct = selectedReturnedItemsWithQty.reduce((map, item) => {
      const chosenId = String(formData.replacement_product_id || item.product_id);
      map.set(chosenId, (map.get(chosenId) ?? 0) + Number(item.selectedQty ?? 1));
      return map;
    }, new Map<string, number>());
    for (const [productId, stockNeeded] of stockNeededByProduct) {
      const targetProduct = productMap.get(productId);
      if (!targetProduct || targetProduct.stock < stockNeeded) {
        toast.error(`Only ${targetProduct?.stock ?? 0} replacement unit(s) available for ${targetProduct?.name ?? "this product"}, but ${stockNeeded} needed`);
        return;
      }
    }

    setReplacementLines((prev) => {
      const additions = selectedReturnedItemsWithQty.map((item) => {
        const chosenId = formData.replacement_product_id || item.product_id;
        const replacementItem = productMap.get(chosenId) || productMap.get(item.product_id)!;
        const lineQty = Number(item.selectedQty ?? 1);
        const originalLineTotal = Number(item.price ?? 0) * lineQty;
        const replacementLineTotal = Number(replacementItem.price ?? 0) * lineQty;
        const origProduct = productMap.get(item.product_id);
        const origLabel = `${item.productName}${origProduct?.size ? ` (Size ${origProduct.size})` : ""}`;
        const repLabel = `${replacementItem.name}${replacementItem.size ? ` (Size ${replacementItem.size})` : ""}`;
        return {
          line_id: buildClientId(),
          sales_detail_id: item.sales_detail_id,
          returned_product_id: item.product_id,
          returned_product_name: origLabel,
          replacement_product_id: replacementItem.product_id,
          replacement_product_name: repLabel,
          quantity: lineQty,
          returned_price_unit: Number(item.price ?? 0),
          replacement_price_unit: Number(replacementItem.price ?? 0),
          price_difference: replacementLineTotal - originalLineTotal,
          inventory_action: effectiveInventoryAction,
        };
      });
      return [...prev, ...additions];
    });

    setFormData((prev) => ({
      ...prev,
      returned_product_id: "",
      replacement_product_id: "",
      quantity: 1,
    }));
    setSelectedReturnedDetailIds([]);
    setReturnedItemQtyByDetail({});
  };

  const removeReplacementLine = (lineId: string) => {
    setReplacementLines((prev) => prev.filter((line) => line.line_id !== lineId));
  };

  const displayReturns = useMemo<ReturnRow[]>(() => {
    const sortedAsc = [...returnRows].sort((a, b) => {
      const aTime = new Date(a.return_date ?? a.created_at ?? "").getTime();
      const bTime = new Date(b.return_date ?? b.created_at ?? "").getTime();
      return (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime);
    });
    const returnDisplayMap = new Map<string, string>();
    sortedAsc.forEach((row, index) => {
      returnDisplayMap.set(String(row.return_id ?? ""), formatSequence("EXC", index + 1));
    });

    const usersById = new Map(
      ((usersQuery.data as any[]) ?? []).map((staff: any) => [String(staff.user_id ?? ""), staff]),
    );

    return returnRows.map((row: any) => {
      const sale = Array.isArray(row.sales_transaction) ? row.sales_transaction[0] : row.sales_transaction;
      const customer = Array.isArray(sale?.customer) ? sale.customer[0] : sale?.customer;
      const processedUser = Array.isArray(row.user) ? row.user[0] : row.user;
      const originalCashierUser = usersById.get(String(sale?.user_id ?? ""));
      const details = Array.isArray(row.return_details) ? row.return_details : [];
      const localProof =
        storedReceiptsMap.get(String(row.return_id ?? "")) ||
        storedReceiptsMap.get(`sale_${String(row.sales_id ?? "")}`) ||
        storedReceiptsMap.get(`sale_${String(row.original_sales_id ?? "")}`) ||
        storedReceiptsMap.get(String(row.sales_id ?? ""));
      const rawVerifiedAt = row.receipt_verified_at || localProof?.verifiedAt;
      const formattedVerifiedAt = rawVerifiedAt ? formatDate(rawVerifiedAt) : "-";
      return {
        return_id: String(row.return_id ?? ""),
        display_return_id: returnDisplayMap.get(String(row.return_id ?? "")) ?? "EXC-000",
        sales_id: String(row.sales_id ?? ""),
        display_sales_id: salesDisplayMap.get(String(row.sales_id ?? "")) ?? "RCP-000",
        user_id: String(row.user_id ?? sale?.user_id ?? ""),
        customerName: customer?.name ?? "Walk-in Customer",
        return_date: formatStoreDate(recordMoment(row.return_date, row.created_at)),
        returnDateTime: formatStoreDateTime(recordMoment(row.return_date, row.created_at)),
        total_refund: Number(row.total_refund ?? 0),
        return_type: String(row.return_type ?? "Replacement"),
        return_status: String(row.return_status ?? "Completed"),
        processedBy: processedUser?.name ?? processedUser?.username ?? "Staff",
        staffCode: String(processedUser?.staff_code ?? processedUser?.staffCode ?? "N/A"),
        originalCashier: String(originalCashierUser?.name ?? originalCashierUser?.username ?? "N/A"),
        originalCashierCode: String(originalCashierUser?.staff_code ?? ""),
        salesStatus: normalizeSaleStatus(sale?.sales_status ?? sale?.status),
        receiptProofName: String(row.receipt_proof_name || localProof?.name || ""),
        receiptProofPath: String(row.receipt_proof_path ?? ""),
        receiptProofUrl: String(row.receipt_proof_url || localProof?.url || ""),
        receiptVerifiedAt: formattedVerifiedAt !== "N/A" ? formattedVerifiedAt : "-",
        returnDetails: details.map((detail: any) => {
          const product = Array.isArray(detail.product) ? detail.product[0] : detail.product;
          const replacementJoin = Array.isArray(detail.replacement_product) ? detail.replacement_product[0] : detail.replacement_product;
          const newProductJoin = Array.isArray(detail.new_product) ? detail.new_product[0] : detail.new_product;
          const returnedFallback = productMap.get(String(detail.returned_product_id ?? detail.product_id ?? ""));
          const note = parseReplacementNote(detail.reason);
          const returnedColor = String(product?.color ?? returnedFallback?.color ?? "N/A");
          const replacementFallback = resolveReplacementProduct(
            productMap.values(),
            detail.replacement_product_id ?? detail.new_product_id,
            note,
            returnedColor,
          );
          const replacement = replacementJoin ?? newProductJoin;
          const returnedInventory = Array.isArray(product?.inventory) ? product.inventory[0] : product?.inventory;
          const replacementInventory = Array.isArray(replacement?.inventory) ? replacement.inventory[0] : replacement?.inventory;
          const returnedPrice = Number(detail.returned_price_unit ?? returnedInventory?.srp ?? product?.price ?? product?.cost_price ?? returnedFallback?.price ?? 0);
          const replacementPrice = Number(detail.new_price_unit ?? replacementInventory?.srp ?? replacement?.price ?? replacement?.cost_price ?? replacementFallback?.price ?? 0);
          const returnedQty = Number(detail.returned_quantity ?? detail.quantity_returned ?? 0);
          const replacementQty = Number(detail.new_quantity ?? detail.replacement_quantity ?? detail.quantity_returned ?? 0);
          return {
            return_detail_id: String(detail.return_detail_id ?? ""),
            product_id: String(detail.product_id ?? ""),
            productName: product?.product_name ?? returnedFallback?.name ?? "N/A",
            productSize: String(product?.size ?? returnedFallback?.size ?? "N/A"),
            productColor: String(product?.color ?? returnedFallback?.color ?? "N/A"),
            productPrice: returnedPrice,
            quantity_returned: returnedQty,
            reason: String(detail.reason ?? ""),
            customerReason: note.customerReason,
            refund_amount: Number(detail.refund_amount ?? 0),
            replacementProductId: String(detail.replacement_product_id ?? detail.new_product_id ?? replacementFallback?.product_id ?? ""),
            replacementProductName: replacement?.product_name ?? replacementFallback?.name ?? (note.replacementName || "N/A"),
            replacementProductSize: String(replacement?.size ?? replacementFallback?.size ?? (note.replacementSize || "N/A")),
            replacementProductColor: String(replacement?.color ?? replacementFallback?.color ?? returnedColor),
            replacementProductPrice: replacementPrice,
            replacementQuantity: replacementQty,
            price_difference: 0,
            inventory_action: String(detail.inventory_action ?? (note.inventoryAction || "Defective / Not Sellable")),
          };
        }),
      };
    });
  }, [productMap, returnRows, salesDisplayMap, storedReceiptsMap, usersQuery.data]);

  const visibleReturns = useMemo(
    () => (isAdmin ? displayReturns : displayReturns.filter((row) => row.user_id === String(user?.user_id ?? ""))),
    [displayReturns, isAdmin, user?.user_id],
  );

  const updateInventoryStock = async (productId: string, quantityDelta: number) => {
    const product = productMap.get(productId);
    if (!product) throw new Error("Product inventory not found");

    const nextStock = Math.max(0, Number(product.stock ?? 0) + quantityDelta);
    if (product.inventory_id) {
      const { error } = await supabase
        .from("inventory")
        .update({ stock_quantity: nextStock, last_updated: new Date().toISOString() })
        .eq("inventory_id", product.inventory_id);
      if (error) throw error;
      return;
    }

    const { error } = await supabase.from("inventory").insert({
      inventory_id: buildClientId(),
      product_id: productId,
      stock_quantity: nextStock,
      reorder_level: product.reorder_level,
      last_updated: new Date().toISOString(),
    });
    if (error) throw error;
  };

  const createInventoryLog = async (productId: string, quantityChange: number, transactionType: string, referenceId: string) => {
    const normalized = String(transactionType ?? "").trim().toLowerCase();
    const dbTransactionType =
      normalized === "return" || normalized === "restock" || normalized === "sale" || normalized === "adjustment"
        ? normalized
        : "adjustment";
    await tryInsertRow("inventory_log", [
      {
        inventory_log_id: buildClientId(),
        product_id: productId,
        quantity_change: quantityChange,
        transaction_type: dbTransactionType,
        reference_id: referenceId,
        date_updated: new Date().toISOString(),
      },
    ]);
  };

  const handleReceiptProofChange = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Upload a receipt photo or image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Receipt photo must be 10MB or smaller.");
      return;
    }
    setReceiptProofFile(file);
    const reader = new FileReader();
    reader.onload = () => setReceiptProofPreview(String(reader.result ?? ""));
    reader.readAsDataURL(file);

    // Auto-detect and validate receipt from uploaded proof photo
    try {
      const detectedText = await decodeQrFromImageFile(file);
      if (detectedText) {
        const clean = detectedText.trim();
        setReceiptNumberInput(clean);
        setValidatedViaQr(true);
        validateReceiptNumber(clean);
        toast.success("Receipt QR Code detected & verified from uploaded photo!");
      }
    } catch {
      // Non-blocking: user can still use manual verify or scan button
    }
  };

  const clearReceiptProof = () => {
    setReceiptProofFile(null);
    setReceiptProofPreview("");
  };

  const uploadReceiptProof = async (returnId: string) => {
    if (!receiptProofFile) {
      return {
        receiptProofName: "Customer Receipt Verified",
        receiptProofPath: "manual_verification",
        receiptProofUrl: "",
        receiptVerifiedAt: new Date().toISOString(),
      };
    }
    const extension = receiptProofFile.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpg";
    const proofPath = `${returnId}/${Date.now()}-${buildClientId()}.${extension}`;
    let proofResult = {
      receiptProofName: receiptProofFile.name,
      receiptProofPath: `local/${receiptProofFile.name}`,
      receiptProofUrl: receiptProofPreview || "",
      receiptVerifiedAt: new Date().toISOString(),
    };

    try {
      const { error } = await supabase.storage
        .from(RECEIPT_PROOF_BUCKET)
        .upload(proofPath, receiptProofFile, {
          cacheControl: "3600",
          contentType: receiptProofFile.type || "image/jpeg",
          upsert: true,
        });
      if (!error) {
        const { data } = supabase.storage.from(RECEIPT_PROOF_BUCKET).getPublicUrl(proofPath);
        proofResult = {
          receiptProofName: receiptProofFile.name,
          receiptProofPath: proofPath,
          receiptProofUrl: data?.publicUrl || receiptProofPreview || "",
          receiptVerifiedAt: new Date().toISOString(),
        };
      }
    } catch {
      // Storage upload failed or bucket missing, fall through to safe fallback
    }

    // Persist receipt proof in client-side persistent IndexedDB store
    const storedProof: StoredReceiptProof = {
      returnId,
      salesId: selectedSale?.sales_id,
      name: proofResult.receiptProofName,
      url: proofResult.receiptProofUrl,
      verifiedAt: proofResult.receiptVerifiedAt,
    };
    await saveReceiptProof(storedProof);

    setStoredReceiptsMap((prev) => {
      const next = new Map(prev);
      if (returnId) next.set(returnId, storedProof);
      if (selectedSale?.sales_id) next.set(`sale_${selectedSale.sales_id}`, storedProof);
      return next;
    });

    return proofResult;
  };

  const handleDirectReceiptProofUpload = async (returnId: string, salesId: string, file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file (PNG, JPG, etc.).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Receipt image must be 10MB or smaller.");
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result ?? "");
        const verifiedAt = new Date().toISOString();
        const proofObj = {
          returnId,
          salesId,
          name: file.name,
          url: dataUrl,
          verifiedAt,
        };

        // 1. Save to local persistent IndexedDB + localStorage store
        await saveReceiptProof(proofObj);

        // 2. Try Supabase storage & DB update in background (if supported)
        try {
          const extension = file.name.split(".").pop()?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "jpg";
          const proofPath = `${returnId}/${Date.now()}.${extension}`;
          const { error: storageError } = await supabase.storage
            .from(RECEIPT_PROOF_BUCKET)
            .upload(proofPath, file, { upsert: true });
          if (!storageError) {
            const { data } = supabase.storage.from(RECEIPT_PROOF_BUCKET).getPublicUrl(proofPath);
            if (data?.publicUrl) {
              await supabase.from("returns").update({
                receipt_proof_url: data.publicUrl,
                receipt_proof_name: file.name,
                receipt_proof_path: proofPath,
                receipt_verified_at: verifiedAt,
              }).eq("return_id", returnId);
            }
          }
        } catch {
          // Supabase column/bucket may not exist, safe to ignore
        }

        // 3. Update local state
        setStoredReceiptsMap((prev) => {
          const next = new Map(prev);
          if (returnId) next.set(returnId, proofObj);
          if (salesId) next.set(`sale_${salesId}`, proofObj);
          return next;
        });

        toast.success("Receipt proof attached and saved successfully!");
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      toast.error(err?.message || "Failed to save receipt proof.");
    }
  };

  const handleAddReturn = async () => {
    if (!selectedSale) {
      toast.error("Please select or verify the original receipt/sale first.");
      return;
    }

    // Auto-queue current selection if replacementLines table is currently empty
    let lines = [...replacementLines];
    if (lines.length === 0 && selectedReturnedItemsWithQty.length > 0 && hasReplacementSelected) {
      lines = selectedReturnedItemsWithQty.map((item) => {
        const chosenId = formData.replacement_product_id || item.product_id;
        const replacementItem = productMap.get(chosenId) || productMap.get(item.product_id)!;
        const lineQty = Number(item.selectedQty ?? 1);
        const originalLineTotal = Number(item.price ?? 0) * lineQty;
        const replacementLineTotal = Number(replacementItem.price ?? 0) * lineQty;
        const origProduct = productMap.get(item.product_id);
        const origLabel = `${item.productName}${origProduct?.size ? ` (Size ${origProduct.size})` : ""}`;
        const repLabel = `${replacementItem.name}${replacementItem.size ? ` (Size ${replacementItem.size})` : ""}`;
        return {
          line_id: buildClientId(),
          sales_detail_id: item.sales_detail_id,
          returned_product_id: item.product_id,
          returned_product_name: origLabel,
          replacement_product_id: replacementItem.product_id,
          replacement_product_name: repLabel,
          quantity: lineQty,
          returned_price_unit: Number(item.price ?? 0),
          replacement_price_unit: Number(replacementItem.price ?? 0),
          price_difference: replacementLineTotal - originalLineTotal,
          inventory_action: effectiveInventoryAction,
        };
      });
    }

    if (lines.length === 0) {
      toast.error("Please select an item from the receipt to replace.");
      return;
    }
    const finalReason = selectedReplacementReason || formData.reason || "Customer Replacement Request";

    try {
      setIsSaving(true);
      const saleDetailById = new Map((selectedSale.details ?? []).map((detail: any) => [detail.sales_detail_id, detail]));
      const returnedQtyIncrementByDetail = new Map<string, number>();
      const replacementStockUsed = new Map<string, number>();

      for (const line of lines) {
        if (!isSameProductModel(line.replacement_product_id, line.returned_product_id)) {
          throw new Error("Replacement must use the same shoe model / variant.");
        }
        const saleDetail = saleDetailById.get(line.sales_detail_id);
        if (!saleDetail) {
          throw new Error(`Unable to find sale detail for ${line.returned_product_name}`);
        }
        const alreadyQueued = returnedQtyIncrementByDetail.get(line.sales_detail_id) ?? 0;
        const maxQty = Math.max(1, Number(saleDetail.returnable_quantity > 0 ? saleDetail.returnable_quantity : saleDetail.quantity || 1));
        if (line.quantity + alreadyQueued > maxQty) {
          throw new Error(`Replacement quantity exceeded for ${line.returned_product_name}`);
        }
        returnedQtyIncrementByDetail.set(line.sales_detail_id, alreadyQueued + line.quantity);

        const usedStock = replacementStockUsed.get(line.replacement_product_id) ?? 0;
        const replacementInfo = productMap.get(line.replacement_product_id);
        const availableStock = Number(replacementInfo?.stock ?? 0);
        if (line.replacement_product_id !== line.returned_product_id && usedStock + line.quantity > availableStock) {
          throw new Error(`Not enough stock for ${line.replacement_product_name}`);
        }
        replacementStockUsed.set(line.replacement_product_id, usedStock + line.quantity);
      }

      const returnId = buildClientId();
      const receiptProof = await uploadReceiptProof(returnId);
      const replacementSummary = [
        "Replacement",
        `Lines: ${lines.length}`,
        `Receipt proof: ${receiptProof.receiptProofName}`,
        "No refund/store credit. Replacement only.",
        `Reason: ${finalReason}`,
      ].join(" | ");

      await tryInsertRow("returns", [
        {
          return_id: returnId,
          sales_id: selectedSale.sales_id,
          original_sales_id: selectedSale.sales_id,
          user_id: user?.user_id ?? selectedSale.user_id,
          return_date: new Date().toISOString(),
          return_type: "Replacement",
          return_status: "Completed",
          total_refund: 0,
          fulfilled_date: new Date().toISOString(),
          replacement_count: lines.length,
          last_activity_date: new Date().toISOString(),
          receipt_proof_name: receiptProof.receiptProofName,
          receipt_proof_path: receiptProof.receiptProofPath,
          receipt_proof_url: receiptProof.receiptProofUrl,
          receipt_verified_at: receiptProof.receiptVerifiedAt,
          remarks: replacementSummary,
        },
        {
          return_id: returnId,
          sales_id: selectedSale.sales_id,
          user_id: user?.user_id ?? selectedSale.user_id,
          return_date: new Date().toISOString(),
          total_refund: 0,
        },
      ]);

      for (const line of lines) {
        const saleDetail = saleDetailById.get(line.sales_detail_id);
        if (!saleDetail) continue;
        const effectiveLineInventoryAction = isUnsellableReason
          ? "Defective / Not Sellable"
          : line.inventory_action;

        const replacementNote = [
          "Replacement",
          `Replaced: ${line.returned_product_name}`,
          `Replacement: ${line.replacement_product_name}`,
          "Rule: Even exchange",
          `Inventory action: ${effectiveLineInventoryAction}`,
          `Reason: ${finalReason}`,
        ].join(" | ");

        // Price columns were dropped (1:1 exchanges carry no price difference), so they
        // must not be sent; otherwise every insert fell back to the note-only row and
        // the replacement product was never stored.
        const baseDetail = {
          return_id: returnId,
          product_id: line.returned_product_id,
          quantity_returned: line.quantity,
          reason: replacementNote,
          refund_amount: 0,
        };
        await tryInsertRow("return_details", [
          {
            ...baseDetail,
            return_detail_id: buildClientId(),
            replacement_product_id: line.replacement_product_id,
            replacement_quantity: line.quantity,
            returned_product_id: line.returned_product_id,
            returned_quantity: line.quantity,
            new_product_id: line.replacement_product_id,
            new_quantity: line.quantity,
            inventory_action: effectiveLineInventoryAction,
          },
          {
            ...baseDetail,
            return_detail_id: buildClientId(),
            replacement_product_id: line.replacement_product_id,
            replacement_quantity: line.quantity,
            inventory_action: effectiveLineInventoryAction,
          },
          {
            return_detail_id: buildClientId(),
            return_id: returnId,
            product_id: line.returned_product_id,
            quantity_returned: line.quantity,
            reason: replacementNote,
            refund_amount: 0,
          },
        ]);

        const nextReturnedQty = Number(saleDetail.returned_quantity ?? 0) + line.quantity;
        const isFullyReturnedItem = nextReturnedQty >= Number(saleDetail.quantity ?? 0);
        try {
          await tryUpdateById("sales_details", "sales_detail_id", line.sales_detail_id, [
            {
              returned_quantity: nextReturnedQty,
              replacement_product_id: line.replacement_product_id,
              item_status: isFullyReturnedItem ? "Replaced" : "Partially Replaced",
            },
          ]);
        } catch {
          // Older schemas may not have return-tracking columns on sales_details yet.
        }

        if (effectiveLineInventoryAction === "Return to Stock") {
          if (line.replacement_product_id !== line.returned_product_id) {
            await updateInventoryStock(line.returned_product_id, line.quantity);
            await createInventoryLog(line.returned_product_id, line.quantity, "return", returnId);
            await updateInventoryStock(line.replacement_product_id, -line.quantity);
            await createInventoryLog(line.replacement_product_id, -line.quantity, "adjustment", returnId);
          } else {
            await createInventoryLog(line.replacement_product_id, 0, "adjustment", returnId);
          }
        } else {
          await updateInventoryStock(line.replacement_product_id, -line.quantity);
          await createInventoryLog(line.replacement_product_id, -line.quantity, "adjustment", returnId);
        }
      }

      await tryUpdateById("sales_transaction", "sales_id", selectedSale.sales_id, [
        {
          original_total_amount: Number(selectedSale.total_amount ?? 0),
          adjusted_total_amount: Number(selectedSale.total_amount ?? 0),
          total_amount: Number(selectedSale.total_amount ?? 0),
          sales_status: "Adjusted",
          return_status: "Completed",
          updated_at: new Date().toISOString(),
        },
        {
          total_amount: Number(selectedSale.total_amount ?? 0),
          updated_at: new Date().toISOString(),
        },
      ]);

      // Policy: Replacement only. No store credit issuance and no cash refund.

      await queryClient.invalidateQueries({ queryKey: ["returns"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["products"] });
      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      await queryClient.invalidateQueries({ queryKey: ["payments"] });
      await queryClient.invalidateQueries({ queryKey: ["customers"] });
      setIsAddDialogOpen(false);
      setFormData(defaultForm);
      setReplacementLines([]);
      setReasonOption("");
      setCustomReason("");
      clearReceiptProof();
      toast.success(`${lines.length} replacement item(s) recorded successfully.`);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to record replacement");
    } finally {
      setIsSaving(false);
    }
  };

  const applyDatePreset = (preset: "all" | "today" | "week" | "month" | "quarter" | "year" | "custom") => {
    setDatePreset(preset);
    const now = new Date();
    const formatYMD = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    if (preset === "all") {
      setStartDate("");
      setEndDate("");
    } else if (preset === "today") {
      const todayStr = formatYMD(now);
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === "week") {
      const weekAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
      setStartDate(formatYMD(weekAgo));
      setEndDate(formatYMD(now));
    } else if (preset === "month") {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      setStartDate(formatYMD(firstDay));
      setEndDate(formatYMD(now));
    } else if (preset === "quarter") {
      const currentQuarterMonth = Math.floor(now.getMonth() / 3) * 3;
      const firstDayOfQuarter = new Date(now.getFullYear(), currentQuarterMonth, 1);
      setStartDate(formatYMD(firstDayOfQuarter));
      setEndDate(formatYMD(now));
    } else if (preset === "year") {
      const firstDayOfYear = new Date(now.getFullYear(), 0, 1);
      setStartDate(formatYMD(firstDayOfYear));
      setEndDate(formatYMD(now));
    }
  };

  const handleCustomDateChange = (type: "start" | "end", val: string) => {
    setDatePreset("custom");
    if (type === "start") {
      setStartDate(val);
    } else {
      setEndDate(val);
    }
  };

  const handleResetFilters = () => {
    setSearchTerm("");
    setSelectedStaff("all");
    setStatusFilter("all");
    setDatePreset("all");
    setStartDate("");
    setEndDate("");
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    selectedStaff !== "all" ||
    statusFilter !== "all" ||
    startDate ||
    endDate ||
    datePreset !== "all"
  );

  const staffOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string }>();
    const allUsers = (usersQuery.data as any[]) ?? [];
    for (const u of allUsers) {
      const uId = String(u.user_id ?? "");
      if (uId) {
        map.set(uId, {
          id: uId,
          name: String(u.name || u.username || "Staff").trim(),
          code: String(u.staff_code || "").trim(),
        });
      }
    }
    for (const r of visibleReturns) {
      const uId = String(r.user_id ?? "");
      if (uId && !map.has(uId)) {
        map.set(uId, {
          id: uId,
          name: r.processedBy || "Staff",
          code: r.staffCode || "",
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [usersQuery.data, visibleReturns]);

  const filteredReturns = useMemo(() => {
    return visibleReturns.filter((returnItem) => {
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesSearch =
          returnItem.display_return_id.toLowerCase().includes(query) ||
          returnItem.display_sales_id.toLowerCase().includes(query) ||
          returnItem.customerName.toLowerCase().includes(query) ||
          returnItem.processedBy.toLowerCase().includes(query) ||
          returnItem.staffCode.toLowerCase().includes(query) ||
          returnItem.returnDetails.some(
            (d) =>
              d.productName.toLowerCase().includes(query) ||
              d.replacementProductName.toLowerCase().includes(query),
          );
        if (!matchesSearch) return false;
      }

      if (selectedStaff !== "all") {
        const matchesStaff =
          returnItem.user_id === selectedStaff ||
          returnItem.processedBy === selectedStaff ||
          returnItem.staffCode === selectedStaff;
        if (!matchesStaff) return false;
      }

      if (statusFilter !== "all") {
        const matchesStatus = (returnItem.return_status || "").toLowerCase() === statusFilter.toLowerCase();
        if (!matchesStatus) return false;
      }

      if (startDate && returnItem.return_date !== "N/A" && returnItem.return_date < startDate) {
        return false;
      }
      if (endDate && returnItem.return_date !== "N/A" && returnItem.return_date > endDate) {
        return false;
      }

      return true;
    });
  }, [visibleReturns, searchTerm, selectedStaff, statusFilter, startDate, endDate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedStaff, statusFilter, datePreset, startDate, endDate]);

  const totalReturnPages = Math.max(1, Math.ceil(filteredReturns.length / pageSize));
  const safeReturnPage = Math.min(Math.max(1, currentPage), totalReturnPages);
  const paginatedReturns = useMemo(() => {
    return filteredReturns.slice((safeReturnPage - 1) * pageSize, safeReturnPage * pageSize);
  }, [filteredReturns, safeReturnPage, pageSize]);

  const completedReturns = filteredReturns.length;
  const totalItemsReplaced = useMemo(
    () =>
      filteredReturns.reduce((sum, item) => {
        return sum + item.returnDetails.reduce((dSum, d) => dSum + Number(d.quantity_returned ?? 0), 0);
      }, 0),
    [filteredReturns],
  );
  const sizeExchangeCount = useMemo(
    () =>
      filteredReturns.filter((item) =>
        item.returnDetails.some(
          (detail) =>
            detail.reason.toLowerCase().includes("size") ||
            detail.inventory_action === "Return to Stock",
        ),
      ).length,
    [filteredReturns],
  );
  const defectExchangeCount = useMemo(
    () =>
      filteredReturns.filter((item) =>
        item.returnDetails.some(
          (detail) =>
            detail.reason.toLowerCase().includes("defect") ||
            detail.reason.toLowerCase().includes("damag") ||
            detail.inventory_action === "Defective / Not Sellable",
        ),
      ).length,
    [filteredReturns],
  );

  const setReplacementDialogOpen = (open: boolean) => {
    setIsAddDialogOpen(open);
    if (open) return;
    setFormData(defaultForm);
    setReplacementLines([]);
    setSelectedReturnedDetailIds([]);
    setReturnedItemQtyByDetail({});
    setReasonOption("");
    setCustomReason("");
    clearReceiptProof();
    setReceiptNumberInput("");
    setReceiptValidationStatus({ state: "idle" });
    setShowManualSaleList(false);
  };

  return (
    <div className="space-y-4">
      {/* DYNAMIC METRIC KEYCARDS: Dynamically recalculated based on active period & filters (no badges) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Completed Replacements */}
        <Card className="bg-[#15151D] border-[#24242F] rounded-2xl">
          <CardContent className="pt-5 pb-5 px-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-400 font-medium">Completed Exchanges</p>
                <p className="text-2xl font-bold text-white tracking-tight mt-1.5">{completedReturns}</p>
                <p className="text-xs text-zinc-400 mt-1">Processed exchange records</p>
              </div>
              <div className="p-2.5 rounded-xl bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 shrink-0">
                <RotateCcw className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Items Replaced */}
        <Card className="bg-[#15151D] border-[#24242F] rounded-2xl">
          <CardContent className="pt-5 pb-5 px-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-400 font-medium">Items Replaced</p>
                <p className="text-2xl font-bold text-white tracking-tight mt-1.5">{totalItemsReplaced}</p>
                <p className="text-xs text-zinc-400 mt-1">Total shoe units exchanged</p>
              </div>
              <div className="p-2.5 rounded-xl bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 shrink-0">
                <Package className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Size Swaps */}
        <Card className="bg-[#15151D] border-[#24242F] rounded-2xl">
          <CardContent className="pt-5 pb-5 px-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-400 font-medium">Size Swaps</p>
                <p className="text-2xl font-bold text-white tracking-tight mt-1.5">{sizeExchangeCount}</p>
                <p className="text-xs text-zinc-400 mt-1">1:1 size or fit exchanges</p>
              </div>
              <div className="p-2.5 rounded-xl bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 shrink-0">
                <ArrowRightLeft className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Defective / Damaged */}
        <Card className="bg-[#15151D] border-[#24242F] rounded-2xl">
          <CardContent className="pt-5 pb-5 px-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-400 font-medium">Defective / Damaged</p>
                <p className="text-2xl font-bold text-white tracking-tight mt-1.5">{defectExchangeCount}</p>
                <p className="text-xs text-zinc-400 mt-1">Defect or damage replacements</p>
              </div>
              <div className="p-2.5 rounded-xl bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-[#15151D] border-[#24242F] rounded-2xl">
        <CardHeader className="border-b border-[#24242F] pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <CardTitle className="text-white flex items-center gap-2 text-lg font-bold">
              <RotateCcw className="w-5 h-5 text-yellow-400" />
              Replacement Management
            </CardTitle>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                <span className="bg-[#181824] px-2.5 py-1 rounded-full border border-[#282836] text-zinc-300">
                  Total: <strong className="text-yellow-400">{visibleReturns.length}</strong> replacements
                </span>
                {hasActiveFilters && (
                  <span className="bg-yellow-400/10 text-yellow-300 px-2.5 py-1 rounded-full border border-yellow-400/30">
                    Filtered: <strong>{filteredReturns.length}</strong>
                  </span>
                )}
              </div>
              <Dialog open={isAddDialogOpen} onOpenChange={setReplacementDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-yellow-400 text-[#15151B] hover:bg-yellow-500 font-bold text-xs h-9 px-4 rounded-xl flex items-center gap-1.5">
                    <Plus className="w-4 h-4" />
                    Process Replacement
                  </Button>
                </DialogTrigger>
              <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 !w-[94vw] !max-w-[1050px] max-h-[88vh] overflow-hidden p-0 shadow-2xl flex flex-col">
                <div className="border-b border-zinc-800 p-5 bg-zinc-900">
                  <DialogHeader>
                    <DialogTitle className="text-yellow-300 flex items-center gap-2">
                      <ArrowRightLeft className="w-5 h-5" />
                      Process Item Replacement
                    </DialogTitle>
                  </DialogHeader>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-5 scrollbar-hide">
                  <div className="grid gap-5">
                  <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-semibold text-zinc-100">Current Selection</p>
                      <Badge className="bg-yellow-400 text-red-900">{replacementLines.length} line(s) added</Badge>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      <div className={`rounded-lg border p-2.5 ${hasSaleSelected ? "border-emerald-600 bg-emerald-900/20" : "border-zinc-700 bg-zinc-950"}`}>
                        <p className="text-[11px] text-zinc-400 font-medium">1. Sale / Receipt</p>
                        <p className="text-sm font-semibold text-zinc-100 truncate">{selectedSale?.display_sales_id ?? "Not selected"}</p>
                      </div>
                      <div className={`rounded-lg border p-2.5 ${hasReturnedSelected ? "border-emerald-600 bg-emerald-900/20" : "border-zinc-700 bg-zinc-950"}`}>
                        <p className="text-[11px] text-zinc-400 font-medium">2. Replaced Item</p>
                        <p className="text-sm font-semibold text-zinc-100 truncate">
                          {selectedOriginalItem
                            ? `${selectedOriginalItem.productName}${productMap.get(selectedOriginalItem.product_id)?.size ? ` (Size ${productMap.get(selectedOriginalItem.product_id)?.size})` : ""}`
                            : "Not selected"}
                        </p>
                      </div>
                      <div className={`rounded-lg border p-2.5 ${hasReplacementSelected ? "border-emerald-600 bg-emerald-900/20" : "border-zinc-700 bg-zinc-950"}`}>
                        <p className="text-[11px] text-zinc-400 font-medium">3. Replacement Variant</p>
                        <p className="text-sm font-semibold text-zinc-100 truncate">
                          {replacementProduct
                            ? `${replacementProduct.name} (${replacementProduct.size ? `Size ${replacementProduct.size}` : ""}${replacementProduct.color ? ` / ${replacementProduct.color}` : ""})`
                            : hasReplacementSelected
                              ? "Same Product (1:1)"
                              : "Not selected"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-yellow-300 flex items-center gap-2 text-base font-semibold">
                        <Receipt className="w-5 h-5 text-yellow-400" />
                        Step 1: Validate Receipt / Original Sale *
                      </Label>
                      <Badge className="bg-yellow-400/15 text-yellow-300 border border-yellow-400/30 text-xs font-medium">
                        Receipt Verification
                      </Badge>
                    </div>

                    <div className="space-y-3 rounded-xl border border-zinc-800 p-4 bg-zinc-950">
                      {/* Receipt Number Validation Bar */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-zinc-300">
                            Scan the receipt QR code or enter Receipt # (<span className="font-semibold text-yellow-300">SALES-001</span> or <span className="font-semibold text-yellow-300">RCP-...</span>):
                          </p>
                          {validatedViaQr && (
                            <Badge className="bg-sky-500/20 text-sky-300 border-sky-400/40 text-[10px] flex items-center gap-1">
                              <QrCode className="w-3 h-3 text-sky-400" />
                              QR Verified
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <div className="relative flex-1">
                            <Receipt className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-400/80" />
                            <Input
                              value={receiptNumberInput}
                              onChange={(event) => {
                                setReceiptNumberInput(event.target.value);
                                setValidatedViaQr(false);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  validateReceiptNumber();
                                }
                              }}
                              placeholder="Scan QR or enter Receipt # (e.g. RCP-20260918-XXXX or SALES-001)..."
                              className="h-11 rounded-xl pl-10 bg-[#1D1D25] border-zinc-700 text-white placeholder:text-zinc-500 focus-visible:ring-[#FFD60A]/40 font-medium"
                            />
                          </div>
                          <Button
                            type="button"
                            onClick={() => setIsQrScannerOpen(true)}
                            className="h-11 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-yellow-400/40 text-yellow-300 font-bold px-4 flex items-center justify-center gap-2 shadow transition"
                          >
                            <Camera className="w-4 h-4 text-yellow-400" />
                            <span>Scan Camera</span>
                          </Button>
                          <label className="h-11 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-yellow-400/40 text-yellow-300 font-bold px-4 flex items-center justify-center gap-2 shadow transition cursor-pointer">
                            <Upload className="w-4 h-4 text-yellow-400" />
                            <span>Upload QR Photo</span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleScanQrFromFile(file);
                              }}
                            />
                          </label>
                          <Button
                            type="button"
                            onClick={() => validateReceiptNumber()}
                            className="h-11 rounded-xl bg-[#FFD60A] hover:bg-[#ffcf24] px-5 text-[#15151B] font-bold shadow-md flex items-center justify-center gap-2"
                          >
                            <ShieldCheck className="w-4 h-4 text-[#15151B]" />
                            <span>Verify</span>
                          </Button>
                        </div>
                      </div>

                      {/* Receipt Validation Result Feedback Box */}
                      {receiptValidationStatus.state === "valid" && (
                        <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-3.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                              <span className="text-emerald-300 font-semibold text-sm">
                                Valid Receipt Verified — {receiptValidationStatus.displayId}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {validatedViaQr && (
                                <Badge className="bg-sky-500/20 text-sky-300 border-sky-400/40 text-[11px] flex items-center gap-1">
                                  <QrCode className="w-3 h-3 text-sky-400" />
                                  Scanned via QR
                                </Badge>
                              )}
                              <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/40 text-[11px]">
                                Within 7-Day Window
                              </Badge>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1 border-t border-emerald-500/20">
                            <div>
                              <span className="text-emerald-400/70 block">Purchase Date:</span>
                              <span className="text-emerald-100 font-medium">{receiptValidationStatus.purchaseDate}</span>
                            </div>
                            <div>
                              <span className="text-emerald-400/70 block">Age:</span>
                              <span className="text-emerald-100 font-medium">
                                {receiptValidationStatus.daysAgo === 0 ? "Today" : `${receiptValidationStatus.daysAgo} day(s) ago`}
                              </span>
                            </div>
                            <div>
                              <span className="text-emerald-400/70 block">Customer:</span>
                              <span className="text-emerald-100 font-medium truncate block">{receiptValidationStatus.customerName}</span>
                            </div>
                            <div>
                              <span className="text-emerald-400/70 block">Total Amount:</span>
                              <span className="text-emerald-300 font-semibold">{formatCurrency(receiptValidationStatus.totalAmount ?? 0)}</span>
                            </div>
                          </div>
                          <p className="text-[11px] text-emerald-200/90 pt-2 border-t border-emerald-500/20">
                            <span className="font-semibold text-emerald-300">Replacement Policy:</span> Receipt verified. Exchanges and repeat replacements are enabled.
                          </p>
                        </div>
                      )}

                      {receiptValidationStatus.state === "expired_warning" && (
                        <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-3.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0" />
                              <span className="text-amber-300 font-semibold text-sm">
                                Policy Notice — {receiptValidationStatus.displayId}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {validatedViaQr && (
                                <Badge className="bg-sky-500/20 text-sky-300 border-sky-400/40 text-[11px] flex items-center gap-1">
                                  <QrCode className="w-3 h-3 text-sky-400" />
                                  Scanned via QR
                                </Badge>
                              )}
                              <Badge className="bg-amber-500/20 text-amber-200 border-amber-400/40 text-[11px]">
                                {receiptValidationStatus.daysAgo} Days Ago (&gt;7 Days) • Replacement Allowed
                              </Badge>
                            </div>
                          </div>
                          <p className="text-xs text-amber-200/90">
                            {receiptValidationStatus.message} Transaction loaded successfully; replacement is permitted.
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1 border-t border-amber-500/20">
                            <div>
                              <span className="text-amber-400/70 block">Purchase Date:</span>
                              <span className="text-amber-100 font-medium">{receiptValidationStatus.purchaseDate}</span>
                            </div>
                            <div>
                              <span className="text-amber-400/70 block">Customer:</span>
                              <span className="text-amber-100 font-medium truncate block">{receiptValidationStatus.customerName}</span>
                            </div>
                            <div>
                              <span className="text-amber-400/70 block">Total Amount:</span>
                              <span className="text-amber-300 font-semibold">{formatCurrency(receiptValidationStatus.totalAmount ?? 0)}</span>
                            </div>
                            <div>
                              <span className="text-amber-400/70 block">Eligible Items:</span>
                              <span className="text-amber-100 font-medium">{receiptValidationStatus.returnableCount} unit(s)</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {receiptValidationStatus.state === "already_replaced" && (
                        <div className="rounded-xl border border-blue-500/40 bg-blue-950/40 p-3.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <CheckCircle2 className="w-5 h-5 text-blue-400 shrink-0" />
                              <span className="text-blue-300 font-semibold text-sm">
                                Previously Replaced Receipt — {receiptValidationStatus.displayId}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {validatedViaQr && (
                                <Badge className="bg-sky-500/20 text-sky-300 border-sky-400/40 text-[11px] flex items-center gap-1">
                                  <QrCode className="w-3 h-3 text-sky-400" />
                                  Scanned via QR
                                </Badge>
                              )}
                              <Badge className="bg-blue-500/20 text-blue-200 border-blue-400/40 text-[11px]">
                                Repeat Replacement Allowed
                              </Badge>
                              {receiptValidationStatus.daysAgo !== undefined && receiptValidationStatus.daysAgo > 7 && (
                                <Badge className="bg-amber-500/20 text-amber-200 border-amber-400/40 text-[11px]">
                                  {receiptValidationStatus.daysAgo} Days Ago (&gt;7 Days)
                                </Badge>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-blue-200/90">
                            {receiptValidationStatus.message} Transaction loaded successfully — select items and finalize below.
                          </p>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1 border-t border-blue-500/20">
                            <div>
                              <span className="text-blue-400/70 block">Purchase Date:</span>
                              <span className="text-blue-100 font-medium">{receiptValidationStatus.purchaseDate}</span>
                            </div>
                            <div>
                              <span className="text-blue-400/70 block">Customer:</span>
                              <span className="text-blue-100 font-medium truncate block">{receiptValidationStatus.customerName}</span>
                            </div>
                            <div>
                              <span className="text-blue-400/70 block">Total Amount:</span>
                              <span className="text-blue-300 font-semibold">{formatCurrency(receiptValidationStatus.totalAmount ?? 0)}</span>
                            </div>
                            <div>
                              <span className="text-blue-400/70 block">Eligible Items:</span>
                              <span className="text-blue-100 font-medium">{receiptValidationStatus.returnableCount} unit(s)</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {receiptValidationStatus.state === "no_returnable_items" && (
                        <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-3.5 flex items-start gap-2.5">
                          <XCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                          <div className="text-xs space-y-0.5">
                            <span className="text-red-300 font-semibold text-sm block">
                              No Returnable Items Remaining ({receiptValidationStatus.displayId})
                            </span>
                            <p className="text-red-200/80">
                              {receiptValidationStatus.message}
                            </p>
                          </div>
                        </div>
                      )}

                      {receiptValidationStatus.state === "not_found" && (
                        <div className="rounded-xl border border-red-500/40 bg-red-950/40 p-3.5 flex items-start gap-2.5 max-w-full overflow-hidden">
                          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                          <div className="text-xs space-y-0.5 min-w-0 max-w-full break-all">
                            <span className="text-red-300 font-semibold text-sm block">
                              Invalid Receipt Number
                            </span>
                            <p className="text-red-200/80 break-all leading-relaxed">
                              {receiptValidationStatus.message} Check the receipt for the SALES-xxx or RCP-xxx code or search the sales list below.
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Optional Manual Search Fallback Table */}
                      <div className="pt-2">
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setShowManualSaleList(!showManualSaleList)}
                          className="text-xs text-yellow-300 hover:text-yellow-200 hover:bg-zinc-800/80 px-2 h-7"
                        >
                          {showManualSaleList ? "▲ Hide Sales List" : "▼ Or Browse All Sales Instead"}
                        </Button>

                        {showManualSaleList && (
                          <div className="mt-2 space-y-2 border-t border-zinc-800 pt-2">
                            <div className="relative">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-400" />
                              <Input
                                value={salePickerSearch}
                                onChange={(event) => setSalePickerSearch(event.target.value)}
                                placeholder="Filter sales by Receipt #, customer, status..."
                                className="h-9 rounded-lg pl-9 bg-[#1D1D25] border-zinc-700 text-white placeholder:text-zinc-500 text-xs focus-visible:ring-[#FFD60A]/40"
                              />
                            </div>
                            <div className="border border-zinc-800 rounded-xl overflow-y-auto overflow-x-hidden max-h-40 bg-zinc-950">
                              <Table className="w-full table-fixed text-xs">
                                <TableHeader>
                                  <TableRow className="bg-zinc-900 hover:bg-zinc-900 border-zinc-800">
                                    <TableHead className="w-[20%] text-yellow-300 text-center">Receipt #</TableHead>
                                    <TableHead className="w-[28%] text-yellow-300 text-center">Customer</TableHead>
                                    <TableHead className="w-[14%] text-yellow-300 text-center">Items</TableHead>
                                    <TableHead className="w-[20%] text-yellow-300 text-center">Amount</TableHead>
                                    <TableHead className="w-[18%] text-yellow-300 text-center">Action</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {filteredSaleOptions.map((sale) => (
                                    <TableRow key={sale.sales_id} className={`border-zinc-800 transition-colors hover:bg-zinc-900/60 ${formData.sales_id === sale.sales_id ? "bg-yellow-400/10" : ""}`}>
                                      <TableCell className="truncate text-zinc-200 text-center font-medium" title={sale.display_sales_id}>{sale.display_sales_id}</TableCell>
                                      <TableCell className="truncate text-zinc-200 text-center" title={sale.customerName}>{sale.customerName}</TableCell>
                                      <TableCell className="text-zinc-200 text-center">{sale.details.length}</TableCell>
                                      <TableCell className="truncate text-yellow-300 text-center font-semibold">{formatCurrency(sale.total_amount)}</TableCell>
                                      <TableCell className="text-center">
                                        <Button
                                          size="sm"
                                          onClick={() => {
                                            validateReceiptNumber(sale.display_sales_id);
                                          }}
                                          className="h-7 rounded-full bg-[#FFD60A] px-3 text-[#15151B] text-xs hover:bg-[#ffcf24] font-bold"
                                        >
                                          {formData.sales_id === sale.sales_id ? "Selected" : "Select"}
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <Label className="text-yellow-300">Receipt Proof *</Label>
                        <p className="mt-1 text-xs text-yellow-200/70">
                          Take or upload a photo of the printed receipt to validate the buyer.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Label
                          htmlFor="receipt-proof-upload"
                          className="inline-flex h-9 cursor-pointer items-center rounded-md bg-yellow-400 px-3 text-sm font-semibold text-red-900 hover:bg-yellow-500"
                        >
                          <Upload className="mr-2 h-4 w-4" />
                          Upload Receipt
                        </Label>
                        {receiptProofFile && (
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={clearReceiptProof}
                            className="h-9 border border-zinc-700 text-zinc-200 hover:bg-zinc-800"
                          >
                            <X className="mr-2 h-4 w-4" />
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                    <input
                      id="receipt-proof-upload"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(event) => handleReceiptProofChange(event.target.files?.[0])}
                    />
                    {receiptProofPreview ? (
                      <div className="grid gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 md:grid-cols-[160px_1fr] md:items-center">
                        <img
                          src={receiptProofPreview}
                          alt="Receipt proof preview"
                          className="h-28 w-full rounded-md border border-zinc-800 object-cover md:w-40"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-100">{receiptProofFile?.name}</p>
                          <p className="mt-1 text-xs text-zinc-400">
                            This proof will be saved with the replacement record for buyer validation.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex min-h-[96px] items-center justify-center rounded-lg border border-dashed border-zinc-700 bg-zinc-950 text-center text-sm text-zinc-400">
                        <div>
                          <FileImage className="mx-auto mb-2 h-7 w-7 text-yellow-300/70" />
                          No receipt photo uploaded
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <Label className="text-yellow-300 font-semibold text-sm">Replaced Item Inventory Action *</Label>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Specify where the customer&apos;s returned shoe will be routed in inventory.
                        </p>
                      </div>
                      <div className="sm:w-72">
                        <Select
                          value={effectiveInventoryAction}
                          onValueChange={(value) =>
                            setFormData({ ...formData, inventory_action: value as ExchangeForm["inventory_action"] })
                          }
                          disabled={isUnsellableReason}
                        >
                          <SelectTrigger className="bg-red-600 border-red-800 text-yellow-200 font-medium">
                            <SelectValue placeholder="Select inventory action" />
                          </SelectTrigger>
                          <SelectContent className="bg-red-700 border-red-800 text-yellow-200">
                            <SelectItem value="Defective / Not Sellable">Defective / Not Sellable</SelectItem>
                            <SelectItem value="Return to Stock">Back to Stock (Restock)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {isUnsellableReason && (
                      <p className="text-xs text-yellow-300 pt-1">
                        Damaged or defective items cannot be returned to sellable stock.
                      </p>
                    )}
                  </div>

                  <div className={`space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 ${!hasSaleSelected ? "opacity-50" : ""}`}>
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <Label className="text-yellow-300">Step 2: Select Replaced Product</Label>
                        <div className="relative md:w-80">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-400" />
                          <Input
                            value={returnedItemSearch}
                            onChange={(event) => setReturnedItemSearch(event.target.value)}
                            placeholder="Search purchased product..."
                            className="pl-10 bg-red-600 border-red-800 text-yellow-200 placeholder:text-yellow-300/50 focus-visible:ring-yellow-400"
                            disabled={!hasSaleSelected}
                          />
                        </div>
                      </div>
                      {!hasSaleSelected && <p className="text-xs text-zinc-300">Select a sale first to show purchased items.</p>}
                      <div key={`returned-items-${formData.sales_id || "none"}`} className="border border-zinc-800 rounded-xl overflow-y-auto overflow-x-auto max-h-48">
                        <Table className="w-full text-sm">
                          <TableHeader>
                            <TableRow className="bg-zinc-900 hover:bg-zinc-900 border-zinc-800">
                              <TableHead className="text-yellow-300 text-center">SKU</TableHead>
                              <TableHead className="text-yellow-300 text-center">Product</TableHead>
                              <TableHead className="text-yellow-300 text-center">Sold</TableHead>
                              <TableHead className="text-yellow-300 text-center">Replaceable</TableHead>
                              <TableHead className="text-yellow-300 text-center">Replace Qty</TableHead>
                              <TableHead className="text-yellow-300 text-center">Price</TableHead>
                              <TableHead className="text-yellow-300 text-center">Action</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {filteredReturnedItems.map((detail: any) => {
                              const isSelected = selectedReturnedDetailIds.includes(detail.sales_detail_id);
                              const rowQty = Math.min(
                                Math.max(1, Number(returnedItemQtyByDetail[detail.sales_detail_id] ?? formData.quantity ?? 1)),
                                Math.max(1, Number(detail.returnable_quantity ?? detail.quantity ?? 1)),
                              );
                              return (
                              <TableRow key={`${detail.sales_detail_id}-${detail.product_id}`} className={`border-zinc-800 transition-colors hover:bg-zinc-900 ${isSelected ? "bg-yellow-400/10" : ""}`}>
                                 <TableCell className="text-yellow-200 text-center font-mono whitespace-nowrap" title={detail.product_id}>{shortId(detail.product_id)}</TableCell>
                                 <TableCell className="truncate text-yellow-200 text-center" title={detail.productName}>{detail.productName}</TableCell>
                                <TableCell className="text-yellow-200 text-center">{detail.quantity}</TableCell>
                                 <TableCell className="text-yellow-200 text-center">
                                   {Math.max(1, Number(detail.returnable_quantity > 0 ? detail.returnable_quantity : detail.quantity || 1))}
                                 </TableCell>
                                <TableCell className="text-center">
                                  <QuantityStepper
                                    value={rowQty}
                                    disabled={!isSelected}
                                    max={Math.max(1, Number(detail.returnable_quantity > 0 ? detail.returnable_quantity : detail.quantity || 1))}
                                    onChange={(nextQty) => {
                                      setReturnedItemQtyByDetail((prev) => ({
                                        ...prev,
                                        [detail.sales_detail_id]: nextQty,
                                      }));
                                    }}
                                  />
                                </TableCell>
                                <TableCell className="truncate text-yellow-300 text-center">{formatCurrency(detail.price)}</TableCell>
                                <TableCell className="text-center">
                                  <Button
                                    size="sm"
                                    onClick={() => toggleReturnedProduct(detail.sales_detail_id, detail.product_id)}
                                    className="h-8 rounded-full bg-yellow-400 px-4 text-red-900 hover:bg-yellow-500 font-bold"
                                  >
                                    {isSelected ? "Selected" : "Select"}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            )})}
                          </TableBody>
                        </Table>
                      </div>
                    </div>

                  {requiresReplacement && (
                    <div className={`space-y-3 rounded-xl border border-zinc-800 bg-zinc-950 p-4 ${!hasReturnedSelected ? "opacity-50" : ""}`}>
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <Label className="text-yellow-300 font-semibold text-sm">Step 3: Same Product Replacement</Label>
                          <p className="text-xs text-zinc-400 mt-0.5">
                            Exchange for the identical pair or a different size/color variant of the same shoe model.
                          </p>
                        </div>
                        <Dialog open={isReplacementPickerOpen} onOpenChange={setIsReplacementPickerOpen}>
                          <DialogTrigger asChild>
                            <Button
                              type="button"
                              disabled={!hasReturnedSelected}
                              className="bg-yellow-400 text-red-900 hover:bg-yellow-500 disabled:opacity-50 font-bold text-xs h-9"
                            >
                              Choose Size / Variant
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 !w-[92vw] !max-w-[980px] max-h-[84vh] overflow-hidden p-0">
                            <div className="border-b border-zinc-800 p-4 bg-zinc-900">
                              <DialogHeader>
                                <DialogTitle className="text-yellow-300 flex items-center gap-2">
                                  <ArrowRightLeft className="w-5 h-5" />
                                  Same Product Size &amp; Variant Options
                                </DialogTitle>
                              </DialogHeader>
                            </div>
                            <div className="max-h-[66vh] overflow-y-auto p-4 space-y-3">
                              <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-400" />
                                <Input
                                  value={replacementSearch}
                                  onChange={(event) => setReplacementSearch(event.target.value)}
                                  placeholder="Search by size, color, brand..."
                                  className="pl-10 bg-[#1D1D25] border-zinc-700 text-white placeholder:text-zinc-500 text-xs"
                                />
                              </div>
                              <div className="border border-zinc-800 rounded-xl overflow-y-auto overflow-x-auto max-h-[48vh]">
                                <Table className="w-full text-sm">
                                  <TableHeader>
                                    <TableRow className="bg-zinc-900 hover:bg-zinc-900 border-zinc-800">
                                      <TableHead className="text-yellow-300 text-center">Product Model</TableHead>
                                      <TableHead className="text-yellow-300 text-center">Brand</TableHead>
                                      <TableHead className="text-yellow-300 text-center">Size</TableHead>
                                      <TableHead className="text-yellow-300 text-center">Color</TableHead>
                                      <TableHead className="text-yellow-300 text-center">Stock Available</TableHead>
                                      <TableHead className="text-yellow-300 text-center">Action</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {filteredReplacementProducts.map((product) => {
                                      const isCurrentChoice = formData.replacement_product_id === product.product_id;
                                      const isIdentical = selectedOriginalItem?.product_id === product.product_id;
                                      return (
                                        <TableRow key={product.product_id} className={`border-zinc-800 transition-colors hover:bg-zinc-900 ${isCurrentChoice ? "bg-yellow-400/10" : ""}`}>
                                          <TableCell className="truncate text-zinc-100 text-center font-medium" title={product.name}>{product.name}</TableCell>
                                          <TableCell className="truncate text-zinc-300 text-center" title={product.brand}>{product.brand}</TableCell>
                                          <TableCell className="truncate text-yellow-300 text-center font-semibold">{product.size}</TableCell>
                                          <TableCell className="truncate text-zinc-300 text-center">{product.color}</TableCell>
                                          <TableCell className="text-center">
                                            <Badge className={`rounded-full ${product.stock > 0 ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-red-500/20 text-red-300 border-red-500/30"}`}>
                                              {product.stock} units in stock
                                            </Badge>
                                          </TableCell>
                                          <TableCell className="text-center">
                                            <Button
                                              size="sm"
                                              disabled={product.stock <= 0}
                                              onClick={() => selectReplacementProduct(product.product_id)}
                                              className="h-8 rounded-full bg-yellow-400 px-4 text-red-900 hover:bg-yellow-500 font-bold text-xs disabled:opacity-40"
                                            >
                                              {isCurrentChoice ? "Selected" : isIdentical ? "Select (Same Size)" : "Select"}
                                            </Button>
                                          </TableCell>
                                        </TableRow>
                                      );
                                    })}
                                  </TableBody>
                                </Table>
                              </div>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                      {!hasReturnedSelected ? (
                        <p className="text-xs text-zinc-400">Select the replaced product in Step 2 first.</p>
                      ) : (
                        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="space-y-1">
                            <span className="text-[11px] text-zinc-400 uppercase tracking-wide font-semibold block">Selected Replacement Unit</span>
                            <p className="text-sm font-bold text-zinc-100">
                              {replacementProduct
                                ? `${replacementProduct.name} — Size ${replacementProduct.size} (${replacementProduct.color})`
                                : "Same Product (Identical Variant)"}
                            </p>
                            <p className="text-xs text-zinc-400">
                              Available Stock:{" "}
                              <span className="text-yellow-300 font-semibold">
                                {replacementProduct ? `${replacementProduct.stock} unit(s)` : "Available"}
                              </span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {replacementProduct && selectedOriginalItem && replacementProduct.product_id === selectedOriginalItem.product_id ? (
                              <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs">
                                Identical Replacement (Defect Swap)
                              </Badge>
                            ) : (
                              <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs">
                                Size / Variant Exchange (Even 1:1)
                              </Badge>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2 rounded-xl border border-red-800 p-3">
                    <Label className="text-yellow-300">Replacement Queue ({replacementLines.length})</Label>
                    <div className="border border-red-800 rounded-lg overflow-x-auto">
                      <Table className="w-full text-sm">
                        <TableHeader>
                          <TableRow className="bg-red-800 hover:bg-red-800 border-red-900">
                            <TableHead className="text-yellow-300 text-center">Original Item</TableHead>
                            <TableHead className="text-yellow-300 text-center">Replacement Item / Size</TableHead>
                            <TableHead className="text-yellow-300 text-center">Qty</TableHead>
                            <TableHead className="text-yellow-300 text-center">Policy</TableHead>
                            <TableHead className="text-yellow-300 text-center">Action</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {replacementLines.length === 0 ? (
                            <TableRow className="border-red-800">
                              <TableCell colSpan={5} className="text-center text-yellow-200 py-3">No items added yet</TableCell>
                            </TableRow>
                          ) : (
                            replacementLines.map((line) => (
                              <TableRow key={line.line_id} className="border-red-800">
                                <TableCell className="text-yellow-200 text-center">{line.returned_product_name}</TableCell>
                                <TableCell className="text-yellow-200 text-center">{line.replacement_product_name}</TableCell>
                                <TableCell className="text-yellow-200 text-center">{line.quantity}</TableCell>
                                <TableCell className="text-center">
                                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs">
                                    1:1 Even Exchange
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-center">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="text-yellow-300 hover:text-yellow-200 hover:bg-red-700"
                                    onClick={() => removeReplacementLine(line.line_id)}
                                  >
                                    Remove
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div>
                        <Label className="text-yellow-300 font-semibold text-sm">Step 4: Quantity</Label>
                        <p className="text-xs text-zinc-400 mt-0.5">
                          Specify units to exchange (max {maxReturnQty} unit{maxReturnQty > 1 ? "s" : ""})
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <QuantityStepper
                          value={quantity}
                          max={maxReturnQty}
                          onChange={(nextQty) => setFormData({ ...formData, quantity: nextQty })}
                        />
                        <span className="text-xs text-yellow-300 font-semibold whitespace-nowrap bg-yellow-400/15 border border-yellow-400/30 px-2.5 py-1 rounded-lg">
                          {quantity} unit{quantity > 1 ? "s" : ""} (1:1 Even Exchange)
                        </span>
                      </div>
                    </div>
                    {selectedReturnedItems.length > 1 && (
                      <p className="text-xs text-yellow-300 pt-1">Tip: Set exact qty per selected item in Step 2 (Replace Qty column).</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label className="text-yellow-300">Reason *</Label>
                    <Select
                      value={reasonOption}
                      onValueChange={(value) => {
                        setReasonOption(value);
                        if (value !== "Others") {
                          setCustomReason("");
                          setFormData({ ...formData, reason: value });
                        } else {
                          setFormData({ ...formData, reason: customReason });
                        }
                      }}
                    >
                      <SelectTrigger className="bg-red-600 border-red-800 text-yellow-200">
                        <SelectValue placeholder="Select replacement reason" />
                      </SelectTrigger>
                      <SelectContent className="bg-red-700 border-red-800 text-yellow-200">
                        {REPLACEMENT_REASON_OPTIONS.map((reason) => (
                          <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {reasonOption === "Others" && (
                      <Input
                        value={customReason}
                        onChange={(e) => {
                          setCustomReason(e.target.value);
                          setFormData({ ...formData, reason: e.target.value });
                        }}
                        className="bg-red-600 border-red-800 text-yellow-200"
                        placeholder="Specify the replacement reason"
                      />
                    )}
                  </div>

                    <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-yellow-300/80">
                      Step 5: Queue items using &ldquo;Add Selected Item&rdquo; or click Finalize Replacement below.
                    </p>
                    <Button
                      type="button"
                      onClick={addReplacementLine}
                      disabled={!hasReturnedSelected || !hasReplacementSelected}
                      className="border border-yellow-400/70 bg-transparent text-yellow-300 hover:bg-yellow-400/15"
                    >
                      Add Selected Item
                    </Button>
                    </div>
                  </div>
                </div>
                <DialogFooter className="shrink-0 border-t border-red-800 p-5">
                  <Button
                    onClick={handleAddReturn}
                    disabled={isSaving}
                    className="bg-yellow-400 text-red-900 hover:bg-yellow-500 disabled:opacity-60 font-bold"
                  >
                    {isSaving
                      ? "Processing..."
                      : `Finalize Replacement (${(replacementLines.length > 0 ? replacementLines.length : (hasReturnedSelected ? selectedReturnedItemsWithQty.length : 0))} item${(replacementLines.length > 0 ? replacementLines.length : (hasReturnedSelected ? selectedReturnedItemsWithQty.length : 0)) === 1 ? "" : "s"})`}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {/* FILTER CONTROLS BAR: Search, Staff Filter, Date Range Presets & Pickers */}
          <div className="space-y-3 bg-[#12121A] p-3.5 rounded-xl border border-[#24242F]">
            <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
              {/* Box 1: Search Bar */}
              <div className="relative flex-1 min-w-[240px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-yellow-400 pointer-events-none" />
                <Input
                  placeholder="Search by replacement ID, receipt #, customer, shoe..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 bg-[#181824] border-[#282836] text-white placeholder:text-zinc-500 text-sm focus-visible:ring-yellow-400/40 rounded-xl"
                />
              </div>

              {/* Box 2: Staff Dropdown Filter */}
              <div className="w-full xl:w-64 shrink-0">
                <Select value={selectedStaff} onValueChange={setSelectedStaff}>
                  <SelectTrigger className="w-full bg-[#181824] border-[#282836] text-zinc-200 text-sm focus:ring-yellow-400/40 rounded-xl">
                    <div className="flex items-center gap-2 truncate">
                      <Users className="w-4 h-4 text-yellow-400 shrink-0" />
                      <SelectValue placeholder="All Staff" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-[#181824] border-[#2E2E3E] text-zinc-200 max-h-64 shadow-2xl">
                    <SelectItem value="all">All Staff</SelectItem>
                    {staffOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.code ? `(${c.code})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Box 3: Status Dropdown Filter */}
              <div className="w-full xl:w-44 shrink-0">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full bg-[#181824] border-[#282836] text-zinc-200 text-sm focus:ring-yellow-400/40 rounded-xl">
                    <div className="flex items-center gap-2 truncate">
                      <ShieldCheck className="w-4 h-4 text-yellow-400 shrink-0" />
                      <SelectValue placeholder="All Status" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-[#181824] border-[#2E2E3E] text-zinc-200 shadow-2xl">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Presets: All, Daily, Weekly, Monthly, Quarterly, Annually */}
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
                    All
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => applyDatePreset("today")}
                    className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                      datePreset === "today"
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
                    onClick={() => applyDatePreset("week")}
                    className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                      datePreset === "week"
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
                    onClick={() => applyDatePreset("month")}
                    className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                      datePreset === "month"
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
                    onClick={() => applyDatePreset("quarter")}
                    className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                      datePreset === "quarter"
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
                    onClick={() => applyDatePreset("year")}
                    className={`h-7 px-2.5 text-xs rounded-md transition-all ${
                      datePreset === "year"
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
                  <span>Date Range:</span>
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
              </div>

              <div className="text-xs text-zinc-400">
                Showing <strong className="text-yellow-400">{filteredReturns.length}</strong> of {visibleReturns.length} replacements
              </div>
            </div>
          </div>

          <div className="border border-[#24242F] rounded-xl overflow-x-auto bg-[#121218] scrollbar-hide">
            <Table className="w-full min-w-[980px]">
              <TableHeader>
                <TableRow className="bg-[#181824] hover:bg-[#181824] border-b border-[#24242F]">
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Replacement ID</TableHead>
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Receipt #</TableHead>
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Customer</TableHead>
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Staff Code</TableHead>
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Processed By</TableHead>
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Replacement Status</TableHead>
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Replacement Date</TableHead>
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReturns.length === 0 ? (
                  <TableRow className="border-b border-[#24242F]">
                    <TableCell colSpan={8} className="h-32 text-center text-zinc-300">
                      <div className="flex flex-col items-center justify-center gap-1.5 py-6">
                        <RotateCcw className="w-8 h-8 text-yellow-400/40 mb-1" />
                        <p className="font-semibold text-white">No replacement records found</p>
                        <p className="text-xs text-zinc-400">
                          {hasActiveFilters ? "Try adjusting your search keywords, staff, or date range." : "No replacements processed yet."}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedReturns.map((returnItem) => {
                    return (
                    <TableRow key={returnItem.return_id} className="border-b border-[#20202C] hover:bg-[#1A1A26]/70 transition-colors">
                      <TableCell className="text-yellow-400 font-mono font-medium whitespace-nowrap text-center">{returnItem.display_return_id}</TableCell>
                      <TableCell className="text-zinc-300 font-mono whitespace-nowrap text-center">{returnItem.display_sales_id}</TableCell>
                      <TableCell className="text-zinc-200 whitespace-nowrap text-center">{returnItem.customerName}</TableCell>
                      <TableCell className="text-zinc-400 text-xs whitespace-nowrap text-center">{returnItem.staffCode}</TableCell>
                      <TableCell className="text-zinc-200 whitespace-nowrap text-center">{returnItem.processedBy}</TableCell>
                      <TableCell className="whitespace-nowrap text-center">
                        <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">{returnItem.return_status}</Badge>
                      </TableCell>
                      <TableCell className="text-zinc-400 text-sm whitespace-nowrap text-center">{returnItem.return_date}</TableCell>
                      <TableCell className="text-center">
                        <Dialog open={viewingReturn?.return_id === returnItem.return_id} onOpenChange={(open) => !open && setViewingReturn(null)}>
                          <DialogTrigger asChild>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-yellow-400 hover:text-white hover:bg-yellow-400/10 rounded-lg"
                              onClick={() => setViewingReturn(returnItem)}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </DialogTrigger>
                        <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-3xl max-h-[85vh] overflow-y-auto">
                          <DialogHeader>
                            <DialogTitle className="text-zinc-100">Replacement Details - {returnItem.display_return_id}</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4 py-4">
                            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                              <p className="mb-3 text-xs uppercase tracking-wide text-zinc-400">Summary</p>
                              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                                <div>
                                  <p className="text-sm text-zinc-400">Customer</p>
                                  <p className="text-zinc-100">{returnItem.customerName}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-zinc-400">Original Sale</p>
                                  <p className="text-zinc-100">{returnItem.display_sales_id}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-zinc-400">Replacement Type</p>
                                  <p className="text-zinc-100">{returnItem.return_type}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-zinc-400">Staff Code</p>
                                  <p className="text-zinc-100">{returnItem.staffCode}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-zinc-400">Processed By</p>
                                  <p className="text-zinc-100">{returnItem.processedBy}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-zinc-400">Replacement Date</p>
                                  <p className="text-zinc-100">{returnItem.return_date}</p>
                                </div>
                                <div>
                                  <p className="text-sm text-zinc-400">Sales Status</p>
                                  <p className="text-zinc-100">{returnItem.salesStatus}</p>
                                </div>
                              </div>
                            </div>

                            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                              <p className="mb-3 text-xs uppercase tracking-wide text-zinc-400">Policy & Status</p>
                              <div className="grid grid-cols-2 gap-4">
                                <div>
                                  <p className="text-sm text-zinc-400">Exchange Rule</p>
                                  <p className="text-emerald-400 font-medium">1:1 Even Exchange (Same Model)</p>
                                </div>
                                <div>
                                  <p className="text-sm text-zinc-400">Replacement Status</p>
                                  <p className="text-zinc-100">{returnItem.return_status || "Completed"}</p>
                                </div>
                              </div>
                            </div>

                            {(() => {
                              const activeProof =
                                storedReceiptsMap.get(returnItem.return_id) ||
                                storedReceiptsMap.get(`sale_${returnItem.sales_id}`) ||
                                storedReceiptsMap.get(returnItem.sales_id);
                              const activeReceiptUrl = returnItem.receiptProofUrl || activeProof?.url || "";
                              const activeReceiptName = returnItem.receiptProofName || activeProof?.name || "Receipt photo";
                              const activeVerifiedAt =
                                (returnItem.receiptVerifiedAt && returnItem.receiptVerifiedAt !== "-")
                                  ? returnItem.receiptVerifiedAt
                                  : (activeProof?.verifiedAt ? formatDate(activeProof.verifiedAt) : "-");

                              return (
                                <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                                  <div className="mb-3 flex items-center justify-between">
                                    <p className="text-xs uppercase tracking-wide text-zinc-400">Receipt Proof</p>
                                    {activeReceiptUrl && (
                                      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/80 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer">
                                        <Upload className="h-3.5 w-3.5" />
                                        Replace Photo
                                        <input
                                          type="file"
                                          accept="image/*"
                                          className="hidden"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handleDirectReceiptProofUpload(returnItem.return_id, returnItem.sales_id, file);
                                          }}
                                        />
                                      </label>
                                    )}
                                  </div>
                                  {activeReceiptUrl ? (
                                    <div className="grid gap-3 md:grid-cols-[180px_1fr] md:items-center">
                                      <a href={activeReceiptUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border border-zinc-800 hover:border-yellow-400/60 transition-colors">
                                        <img
                                          src={activeReceiptUrl}
                                          alt="Uploaded receipt proof"
                                          className="h-32 w-full object-cover md:w-44 transition-transform duration-200 hover:scale-105"
                                        />
                                      </a>
                                      <div className="min-w-0">
                                        <p className="truncate font-medium text-zinc-100">{activeReceiptName}</p>
                                        <p className="mt-1 text-sm text-zinc-400">Verified: {activeVerifiedAt}</p>
                                        <a
                                          href={activeReceiptUrl}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-yellow-400 hover:text-yellow-300"
                                        >
                                          Open full size
                                        </a>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="rounded-md border border-dashed border-amber-500/30 bg-amber-500/5 p-4 text-center">
                                      <FileImage className="mx-auto h-8 w-8 text-amber-400/80 mb-2" />
                                      <p className="text-sm font-medium text-amber-300">No receipt proof currently attached</p>
                                      <p className="mt-1 text-xs text-zinc-400 max-w-md mx-auto">
                                        You can upload the customer's printed physical receipt photo now to attach proof to this replacement record.
                                      </p>
                                      <label className="mt-3 inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg bg-yellow-400 px-4 py-2 text-xs font-bold text-zinc-950 hover:bg-yellow-300 transition-colors shadow-sm cursor-pointer">
                                        <Upload className="h-4 w-4" />
                                        Upload Receipt Proof Now
                                        <input
                                          type="file"
                                          accept="image/*"
                                          className="hidden"
                                          onChange={(e) => {
                                            const file = e.target.files?.[0];
                                            if (file) handleDirectReceiptProofUpload(returnItem.return_id, returnItem.sales_id, file);
                                          }}
                                        />
                                      </label>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                              <p className="mb-3 text-xs uppercase tracking-wide text-zinc-400">Replacement Items</p>
                              <div className="space-y-3">
                                {returnItem.returnDetails.map((detail) => (
                                  <div key={detail.return_detail_id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-stretch">
                                      <div className="rounded-md border border-red-900/50 bg-red-950/20 p-3">
                                        <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Replaced Item</p>
                                        <p className="font-medium text-zinc-100">{detail.productName}</p>
                                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-zinc-300">
                                          <span>Qty: {detail.quantity_returned}</span>
                                          <span>Size: {detail.productSize}</span>
                                          <span>Color: {detail.productColor}</span>
                                        </div>
                                      </div>
                                      <div className="rounded-md border border-emerald-900/50 bg-emerald-950/20 p-3">
                                        <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Replacement Item</p>
                                        <p className="font-medium text-zinc-100">{detail.replacementProductName}</p>
                                        <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-zinc-300">
                                          <span>Qty: {detail.replacementQuantity}</span>
                                          <span>Size: {detail.replacementProductSize}</span>
                                          <span>Color: {detail.replacementProductColor}</span>
                                        </div>
                                      </div>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-300">
                                      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">1:1 Even Exchange</Badge>
                                      <Badge className="bg-zinc-800 text-zinc-200">Inventory: {detail.inventory_action}</Badge>
                                      {detail.customerReason && (
                                        <Badge className="bg-zinc-800 text-zinc-200">Reason: {detail.customerReason}</Badge>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <DialogFooter className="pt-3 border-t border-zinc-800 flex justify-end gap-2">
                               <Button
                                 onClick={() => setPrintExchangeSlip(returnItem)}
                                 className="bg-yellow-400 text-red-950 hover:bg-yellow-500 font-bold text-xs flex items-center gap-2 rounded-xl shadow"
                               >
                                 <Receipt className="w-4 h-4" />
                                 <span>Print Exchange Slip ({returnItem.display_return_id})</span>
                               </Button>
                             </DialogFooter>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                  );
                }))}
              </TableBody>
            </Table>
          </div>

          <TablePagination
            currentPage={safeReturnPage}
            pageSize={pageSize}
            totalItems={filteredReturns.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[10, 15, 25, 50, 100]}
            unitName="replacements"
          />
        </CardContent>
      </Card>

      {/* FORMAL RETAIL REPLACEMENT / EXCHANGE SLIP MODAL */}
      <Dialog open={Boolean(printExchangeSlip)} onOpenChange={(open) => !open && setPrintExchangeSlip(null)}>
        <DialogContent className="bg-[#12121a] border-[#2d2d3d] text-zinc-900 max-w-md rounded-2xl shadow-2xl p-4 sm:p-6 max-h-[92vh] overflow-y-auto">
          <DialogHeader className="border-b border-[#252536] pb-2">
            <DialogTitle className="text-yellow-300 text-center text-sm font-semibold flex items-center justify-center gap-2">
              <Receipt className="w-4 h-4 text-yellow-400" />
              Official Replacement / Exchange Slip
            </DialogTitle>
          </DialogHeader>

          {printExchangeSlip && (
            <div
              id="printable-exchange-slip"
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
              <p className="text-center font-bold text-[12px] mt-2 tracking-[0.2em]">EXCHANGE SLIP</p>
              <p className="text-center text-[9px] tracking-wide">1:1 Even Exchange</p>

              {/* ── SLIP METADATA ── */}
              <div className="border-t border-dashed border-black my-2" />
              <div className="space-y-0.5 text-[10.5px]">
                {[
                  ["Slip No.", printExchangeSlip.display_return_id, true],
                  ["Orig. Receipt", printExchangeSlip.display_sales_id, true],
                  ["Date", printExchangeSlip.returnDateTime, false],
                  ["Customer", printExchangeSlip.customerName, false],
                  ["Orig. Cashier", withStaffCode(printExchangeSlip.originalCashier, printExchangeSlip.originalCashierCode), false],
                  ["Processed By", withStaffCode(printExchangeSlip.processedBy, printExchangeSlip.staffCode), false],
                ].map(([label, value, bold]) => (
                  <div key={String(label)} className="flex justify-between gap-2">
                    <span className="shrink-0">{label}</span>
                    <span className={`text-right truncate ${bold ? "font-bold" : ""}`}>{value}</span>
                  </div>
                ))}
              </div>

              {/* ── ITEMS EXCHANGED ── */}
              <div className="border-t border-dashed border-black my-2" />
              <div className="space-y-3 text-[10.5px]">
                {printExchangeSlip.returnDetails.map((detail, idx) => (
                  <div key={idx}>
                    <p className="font-bold mb-1">
                      ITEM {idx + 1} · QTY {detail.quantity_returned}
                    </p>
                    <div className="grid grid-cols-[56px_1fr] gap-y-1">
                      <span className="font-semibold">RETURNED</span>
                      <div className="min-w-0">
                        <p className="uppercase truncate">{detail.productName}</p>
                        <p className="text-[9.5px]">{detail.productColor} · Size {detail.productSize}</p>
                      </div>
                      <span className="font-semibold">GIVEN</span>
                      <div className="min-w-0">
                        <p className="uppercase truncate">{detail.replacementProductName}</p>
                        <p className="text-[9.5px]">{detail.replacementProductColor} · Size {detail.replacementProductSize}</p>
                      </div>
                    </div>
                    {detail.customerReason && (
                      <p className="text-[9.5px] mt-1">Reason: {detail.customerReason}</p>
                    )}
                    <p className="text-[9.5px]">Returned item: {detail.inventory_action}</p>
                  </div>
                ))}
              </div>

              {/* ── EXCHANGE SUMMARY ── */}
              <div className="border-t border-dashed border-black my-2" />
              <div className="space-y-0.5 text-[10.5px]">
                <div className="flex justify-between">
                  <span>Items Exchanged</span>
                  <span>
                    {printExchangeSlip.returnDetails.reduce((sum, detail) => sum + Number(detail.quantity_returned || 0), 0)} pair(s)
                  </span>
                </div>
                <div className="flex justify-between font-bold text-[12px] pt-1">
                  <span>AMOUNT DUE</span>
                  <span className="tabular-nums">PHP 0.00</span>
                </div>
                <p className="text-[9px] pt-1 text-center">Same-model swap · No refund · No additional payment</p>
              </div>

              {/* ── SIGNATURES ── */}
              <div className="border-t border-dashed border-black my-2" />
              <div className="grid grid-cols-2 gap-4 text-center text-[9px] pt-1">
                <div>
                  <div className="border-b border-black h-8 mb-1"></div>
                  <p>Customer Signature</p>
                </div>
                <div>
                  <div className="border-b border-black h-8 mb-1 flex items-end justify-center">
                    <span className="text-[9.5px] font-semibold uppercase truncate">{printExchangeSlip.processedBy}</span>
                  </div>
                  <p>Authorized Staff</p>
                </div>
              </div>

              {/* ── QR CODE ── */}
              <div className="flex justify-center pt-2 pb-1">
                <QRCodeSVG
                  value={printExchangeSlip.display_return_id || "N/A"}
                  size={80}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <p className="text-center text-[9px] font-mono">*{printExchangeSlip.display_return_id}*</p>

              {/* ── FOOTER ── */}
              <div className="border-t border-dashed border-black my-2" />
              <p className="text-center text-[10px] font-bold tracking-wide">THIS SERVES AS YOUR</p>
              <p className="text-center text-[10px] font-bold tracking-wide">OFFICIAL EXCHANGE SLIP</p>
              <p className="text-center text-[9px] mt-1">Thank you for shopping at Meryl Shoes!</p>
            </div>
          )}

          <DialogFooter className="border-t border-[#252536] pt-3 flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPrintExchangeSlip(null)}
              className="w-1/3 border-[#343444] text-yellow-200 bg-transparent hover:bg-[#202030] rounded-xl text-xs"
            >
              Close
            </Button>
            <Button
              onClick={() => {
                window.print();
                toast.success("Exchange slip sent to printer");
              }}
              className="w-2/3 bg-yellow-400 text-red-950 hover:bg-yellow-500 font-bold rounded-xl shadow text-xs flex items-center justify-center gap-2"
            >
              <Receipt className="w-4 h-4" />
              <span>Print Official Slip</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RECEIPT QR CODE SCANNER MODAL */}
      <Dialog open={isQrScannerOpen} onOpenChange={setIsQrScannerOpen}>
        <DialogContent className="bg-[#12121a] border-[#2d2d3d] text-zinc-100 max-w-md rounded-2xl shadow-2xl p-5">
          <DialogHeader className="border-b border-[#252536] pb-3 text-left">
            <DialogTitle className="text-yellow-300 text-base font-bold flex items-center gap-2">
              <QrCode className="w-5 h-5 text-yellow-400" />
              Scan Receipt QR Code
            </DialogTitle>
            <p className="text-xs text-zinc-400 mt-0.5">
              Point your camera at the QR code on the customer&apos;s thermal receipt to instantly verify purchase validity.
            </p>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {/* Focus distance guidance tip */}
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 p-2.5 text-xs text-amber-200">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <p className="font-semibold text-amber-300">Webcam Focus Tip:</p>
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  Hold receipt <strong>20–30 cm (8–12 inches)</strong> away so it stays in sharp focus. If the QR code looks small, use the <strong>1.5x / 2x Zoom</strong> buttons below.
                </p>
              </div>
            </div>

            {/* Viewfinder Area */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                const file = e.dataTransfer.files?.[0];
                if (file) handleScanQrFromFile(file);
              }}
              className={`relative w-full aspect-square max-w-[300px] mx-auto rounded-2xl overflow-hidden bg-black border-2 shadow-2xl flex items-center justify-center transition-all [&_video]:!w-full [&_video]:!h-full [&_video]:!object-cover [&_video]:!rounded-xl [&_img]:hidden ${
                isDraggingOver ? "border-yellow-400 bg-yellow-400/10 scale-[1.02]" : "border-yellow-400/40"
              }`}
            >
              <div id="receipt-qr-reader" className="w-full h-full" />
              <div id="receipt-file-qr-temp" className="hidden" />

              {/* Viewfinder Corner Overlays */}
              <div className="pointer-events-none absolute inset-6 border border-dashed border-yellow-400/30 rounded-xl" />
              <div className="pointer-events-none absolute top-6 left-6 w-6 h-6 border-t-2 border-l-2 border-yellow-400 rounded-tl-lg" />
              <div className="pointer-events-none absolute top-6 right-6 w-6 h-6 border-t-2 border-r-2 border-yellow-400 rounded-tr-lg" />
              <div className="pointer-events-none absolute bottom-6 left-6 w-6 h-6 border-b-2 border-l-2 border-yellow-400 rounded-bl-lg" />
              <div className="pointer-events-none absolute bottom-6 right-6 w-6 h-6 border-b-2 border-r-2 border-yellow-400 rounded-br-lg" />

              {/* Laser Scanning Animation Line */}
              {!cameraLoading && !qrScanError && (
                <div className="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 h-0.5 bg-gradient-to-r from-transparent via-yellow-400 to-transparent shadow-[0_0_12px_#facc15] animate-pulse" />
              )}

              {cameraLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/85 z-10 gap-2">
                  <div className="w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-yellow-300 font-medium">Starting camera...</p>
                </div>
              )}

              {qrScanError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#181824] p-4 text-center z-10 gap-2.5">
                  <AlertCircle className="w-9 h-9 text-amber-400 shrink-0" />
                  <p className="text-xs text-zinc-300 leading-relaxed max-w-[250px]">{qrScanError}</p>
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setQrScanError(null);
                        setCameraLoading(true);
                        setRetryTrigger((prev) => prev + 1);
                      }}
                      className="h-8 px-3 text-xs bg-yellow-400 hover:bg-yellow-300 text-black font-semibold rounded-lg flex items-center gap-1.5 shadow"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Try Again</span>
                    </Button>
                    <label className="h-8 px-3 text-xs bg-zinc-800 hover:bg-zinc-700 text-yellow-300 border border-yellow-400/30 font-semibold rounded-lg flex items-center gap-1.5 cursor-pointer transition">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload Photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleScanQrFromFile(file);
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Zoom Controls & Camera Options */}
            <div className="flex items-center justify-between gap-2 px-1">
              {/* Zoom Buttons */}
              <div className="flex items-center gap-1 bg-[#181826] p-1 rounded-xl border border-zinc-800">
                <span className="text-[10px] uppercase font-bold text-zinc-400 px-1.5 flex items-center gap-1">
                  <ZoomIn className="w-3 h-3 text-yellow-400" />
                  Zoom:
                </span>
                {[1, 1.5, 2].map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setCameraZoom(z)}
                    className={`px-2.5 py-0.5 text-xs font-bold rounded-lg transition ${
                      cameraZoom === z
                        ? "bg-yellow-400 text-black shadow"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                    }`}
                  >
                    {z}x
                  </button>
                ))}
              </div>

              {/* Extra Tools: Flip Camera & Flashlight */}
              <div className="flex items-center gap-1.5">
                {torchSupported && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={toggleTorch}
                    className={`h-8 px-2.5 rounded-xl border text-xs flex items-center gap-1.5 ${
                      torchOn
                        ? "bg-yellow-400 text-black border-yellow-400"
                        : "bg-[#181826] text-zinc-300 border-zinc-800 hover:text-white"
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Flash</span>
                  </Button>
                )}

                {availableCameras.length > 1 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const curIdx = Math.max(0, availableCameras.findIndex((c) => c.id === selectedCameraId));
                      const nextCamera = availableCameras[(curIdx + 1) % availableCameras.length];
                      setSelectedCameraId(nextCamera.id);
                    }}
                    className="h-8 px-2.5 rounded-xl bg-[#181826] border border-zinc-800 text-zinc-300 hover:text-white text-xs flex items-center gap-1.5"
                    title="Switch Camera"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-yellow-400" />
                    <span>Switch</span>
                  </Button>
                )}
              </div>
            </div>

            {/* Quick Manual Entry Fallback inside Modal */}
            <div className="pt-2 border-t border-[#252536] space-y-1.5">
              <p className="text-[11px] text-zinc-400">
                Or enter Receipt # printed below the QR code (e.g. <code>*RCP-...*</code>):
              </p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Receipt className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-yellow-400/70" />
                  <Input
                    value={scannerManualInput}
                    onChange={(e) => setScannerManualInput(e.target.value)}
                    placeholder="e.g. RCP-20260918-9374 or 9374"
                    className="h-9 pl-8 text-xs bg-[#1a1a27] border-[#2e2e42] text-yellow-100 placeholder:text-zinc-500 rounded-xl"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && scannerManualInput.trim()) {
                        e.preventDefault();
                        handleManualInputInScanner(scannerManualInput);
                      }
                    }}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={!scannerManualInput.trim()}
                  onClick={() => handleManualInputInScanner(scannerManualInput)}
                  className="h-9 px-4 text-xs bg-yellow-400 text-black font-bold hover:bg-yellow-300 rounded-xl shrink-0"
                >
                  Verify
                </Button>
              </div>
            </div>

            {/* Upload alternative */}
            <div className="text-center pt-1">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 px-4 py-1.5 text-xs font-semibold text-yellow-200 transition">
                <Upload className="w-3.5 h-3.5 text-yellow-400" />
                Upload Receipt Photo Instead
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleScanQrFromFile(file);
                  }}
                />
              </label>
            </div>
          </div>

          <DialogFooter className="border-t border-[#252536] pt-3 flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsQrScannerOpen(false)}
              className="border-[#343444] text-zinc-300 hover:text-white rounded-xl text-xs h-9 px-4"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
