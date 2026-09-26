import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { Calendar, Eye, Package, Receipt, RotateCcw, Search, ShoppingCart, TrendingUp, Users } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import merylLogoBw from "../../assets/Meryl_Logo_BW.svg";
import { toast } from "sonner";
import { useProducts, useReturns, useSales, useUsers } from "../../lib/hooks";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { writeAuditLog } from "../../lib/audit";
import { parseReplacementNote, resolveReplacementProduct } from "../../lib/replacement-details";
import { TablePagination } from "./ui/table-pagination";

type SaleStatus = "Completed" | "Pending" | "Voided";

function getStatus(paymentStatus?: string | null): SaleStatus {
  const status = (paymentStatus ?? "Paid").toLowerCase();
  if (status.includes("pending")) return "Pending";
  if (status.includes("void") || status.includes("cancel") || status.includes("fail")) return "Voided";
  return "Completed";
}

function formatDate(v?: string | null) {
  if (!v) return "N/A";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "N/A" : d.toISOString().slice(0, 10);
}

function formatSalesDisplayId(sequence: number) {
  return `SALES-${String(sequence).padStart(3, "0")}`;
}

function formatStaffCode(staffCode?: string | null, userId?: string | null, username?: string | null) {
  const explicitCode = String(staffCode ?? "").trim();
  if (explicitCode) return explicitCode;

  const uname = String(username ?? "");
  const usernameDigits = uname.replace(/\D/g, "");
  if (usernameDigits) return `Cashier ${usernameDigits.slice(-3).padStart(3, "0")}`;

  const id = String(userId ?? "").replace(/-/g, "");
  if (id) {
    const numeric = id.split("").reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 1000;
    return `Cashier ${String(numeric).padStart(3, "0")}`;
  }
  return "Cashier 000";
}

function toPaymentStatus(status: SaleStatus): string {
  if (status === "Pending") return "pending";
  if (status === "Voided") return "failed";
  return "completed";
}

function formatCurrency(value: number) {
  return `PHP ${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function SalesManagement() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const salesQuery = useSales();
  const returnsQuery = useReturns();
  const productsQuery = useProducts();
  const usersQuery = useUsers();

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCashier, setSelectedCashier] = useState("all");
  const [replacementFilter, setReplacementFilter] = useState<"all" | "replaced" | "not_replaced">("all");
  const [paymentMethodFilter, setPaymentMethodFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [datePreset, setDatePreset] = useState<"all" | "today" | "week" | "month" | "quarter" | "year" | "custom">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [viewingSale, setViewingSale] = useState<any | null>(null);
  const [updatingSaleId, setUpdatingSaleId] = useState<string | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<any | null>(null);

  const openReceiptForSale = (sale: any) => {
    const totalGross = sale.saleDetails.reduce((sum: number, d: any) => sum + (d.gross || 0), 0);
    const totalDiscount = sale.saleDetails.reduce((sum: number, d: any) => sum + (d.discount_amount || 0), 0);
    const totalItemsCount = sale.saleDetails.reduce((sum: number, d: any) => sum + (d.quantity || 0), 0);
    const totalAmount = Number(sale.total_amount ?? 0);
    const vatableSales = Number((totalAmount / 1.12).toFixed(2));
    const vatAmount = Number((totalAmount - vatableSales).toFixed(2));
    const rawDate = sale.transaction_date ? new Date(sale.transaction_date) : new Date();
    const dateFormatted = Number.isNaN(rawDate.getTime())
      ? "N/A"
      : rawDate.toLocaleString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

    const dateDigits = Number.isNaN(rawDate.getTime())
      ? new Date().toISOString().slice(0, 10).replace(/-/g, "")
      : rawDate.toISOString().slice(0, 10).replace(/-/g, "");
    const saleIdStr = String(sale.sales_id ?? "");
    const cleanSuffix = saleIdStr.replace(/[^a-zA-Z0-9]/g, "").slice(-4).toUpperCase() || "0001";
    const receiptNumber = `RCP-${dateDigits}-${cleanSuffix}`;

    setViewingReceipt({
      receiptNumber,
      rawSalesId: saleIdStr,
      displayId: sale.display_sales_id,
      date: dateFormatted,
      cashier: sale.cashierName || "Administrator",
      customerName: sale.customerName || "Walk-in Customer",
      items: sale.saleDetails.map((d: any) => ({
        name: d.productName,
        brand: d.brand || "",
        color: d.color || "",
        size: d.size || "",
        quantity: Number(d.quantity || 1),
        unitPrice: Number(d.unit_price || (d.gross / (d.quantity || 1)) || 0),
        subtotal: Number(d.subtotal || (d.gross - (d.discount_amount || 0)) || 0),
      })),
      grossSubtotal: totalGross,
      discount: totalDiscount,
      total: totalAmount,
      totalItemsCount,
      vatableSales,
      vatAmount,
      vatExemptSales: 0,
      zeroRatedSales: 0,
      paymentMethod: sale.payment_method || "Cash",
      cashReceived: totalAmount,
      changeAmount: 0,
    });
  };

  const sales = (salesQuery.data as any[]) ?? [];
  const returns = (returnsQuery.data as any[]) ?? [];
  const productRows = (productsQuery.data as any[]) ?? [];
  const normalizedRole = String(user?.role_name ?? "").trim().toLowerCase();
  const isAdmin = normalizedRole.includes("admin");

  const productMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const product of productRows) {
      const inventory = Array.isArray(product.inventory) ? product.inventory[0] : product.inventory;
      const productId = String(product.product_id ?? "");
      if (!productId) continue;
      map.set(productId, {
        product_id: productId,
        name: String(product.product_name ?? "N/A"),
        size: String(product.size ?? "N/A"),
        color: String(product.color ?? "N/A"),
        price: Number(inventory?.srp ?? product.price ?? product.cost_price ?? 0),
      });
    }
    return map;
  }, [productRows]);

  const replacementBySale = useMemo(() => {
    const map = new Map<string, { count: number; additional: number; credits: number; lastActivity: string | null; details: any[] }>();
    for (const replacement of returns) {
      const salesId = String(replacement.original_sales_id ?? replacement.sales_id ?? "");
      if (!salesId) continue;
      const prev = map.get(salesId) ?? { count: 0, additional: 0, credits: 0, lastActivity: null, details: [] };
      const details = Array.isArray(replacement.return_details) ? replacement.return_details : [];
      const credits = Number(replacement.total_refund ?? replacement.total_credits_issued ?? 0);
      const activityDate = String(replacement.last_activity_date ?? replacement.return_date ?? replacement.created_at ?? "");
      const prevTs = prev.lastActivity ? new Date(prev.lastActivity).getTime() : 0;
      const nextTs = activityDate ? new Date(activityDate).getTime() : 0;
      const mappedDetails = details.map((detail: any) => {
        const returnedProduct = Array.isArray(detail.product) ? detail.product[0] : detail.product;
        const returnedFallback = productMap.get(String(detail.returned_product_id ?? detail.product_id ?? ""));
        const returnedColor = String(returnedProduct?.color ?? returnedFallback?.color ?? "N/A");
        const note = parseReplacementNote(detail.reason);
        const replacementProduct = resolveReplacementProduct(
          productMap.values(),
          detail.replacement_product_id ?? detail.new_product_id,
          note,
          returnedColor,
        );
        const returnedQuantity = Number(detail.returned_quantity ?? detail.quantity_returned ?? 0);
        const replacementQuantity = Number(detail.new_quantity ?? detail.replacement_quantity ?? detail.quantity_returned ?? 0);
        return {
          return_detail_id: String(detail.return_detail_id ?? ""),
          returnedProductName: returnedProduct?.product_name ?? returnedFallback?.name ?? "N/A",
          returnedSize: String(returnedProduct?.size ?? returnedFallback?.size ?? "N/A"),
          returnedColor,
          returnedQuantity,
          replacementProductName: replacementProduct?.name ?? (note.replacementName || "N/A"),
          replacementSize: String(replacementProduct?.size ?? (note.replacementSize || "N/A")),
          replacementColor: String(replacementProduct?.color ?? returnedColor),
          replacementQuantity,
          customerReason: note.customerReason,
          inventoryAction: String(detail.inventory_action ?? (note.inventoryAction || "Defective / Not Sellable")),
        };
      });
      // Exchanges are strictly 1:1 with no additional payment.
      const additional = 0;
      map.set(salesId, {
        count: prev.count + (Number(replacement.replacement_count ?? 0) || Math.max(1, details.length || 1)),
        additional: prev.additional + additional,
        credits: prev.credits + credits,
        lastActivity: nextTs > prevTs ? activityDate : prev.lastActivity,
        details: [...prev.details, ...mappedDetails],
      });
    }
    return map;
  }, [productMap, returns]);

  const uiSales = useMemo(
    () => {
      const salesIdSequence = new Map<string, string>();
      [...sales]
        .sort((a, b) => {
          const aTime = new Date(a.transaction_date ?? "").getTime();
          const bTime = new Date(b.transaction_date ?? "").getTime();
          const safeATime = Number.isNaN(aTime) ? 0 : aTime;
          const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
          return safeATime - safeBTime;
        })
        .forEach((sale, index) => {
          salesIdSequence.set(String(sale.sales_id ?? ""), formatSalesDisplayId(index + 1));
        });

      return sales.map((sale) => {
        const customer = Array.isArray(sale.customer) ? sale.customer[0] : sale.customer;
        const cashier = Array.isArray(sale.user) ? sale.user[0] : sale.user;
        const payment = Array.isArray(sale.payment) ? sale.payment[0] : sale.payment;
        const details = Array.isArray((sale as any).sales_details) ? (sale as any).sales_details : [];
        const salesId = String(sale.sales_id ?? "");
        const replacementInfo = replacementBySale.get(salesId) ?? { count: 0, additional: 0, credits: 0, lastActivity: null, details: [] };
        return {
          sales_id: salesId,
          display_sales_id: salesIdSequence.get(salesId) ?? "SALES-000",
          payment_id: payment?.payment_id ?? null,
          transaction_date: formatDate(sale.transaction_date),
          total_amount: Number(sale.total_amount ?? 0),
          payment_method: payment?.payment_method ?? "N/A",
          user_id: String(sale.user_id ?? cashier?.user_id ?? ""),
          cashierName: cashier?.name ?? cashier?.username ?? "Unknown Cashier",
          cashierUsername: cashier?.username ?? "",
          cashierCode: formatStaffCode(cashier?.staff_code, sale.user_id ?? cashier?.user_id, cashier?.username),
          customerName: customer?.name ?? "Walk-in Customer",
          status: getStatus(payment?.payment_status),
          replacementCount: replacementInfo.count,
          replacementPayments: replacementInfo.additional,
          replacementCredits: replacementInfo.credits,
          replacementDetails: replacementInfo.details,
          lastActivityDate: formatDate(replacementInfo.lastActivity ?? sale.updated_at ?? sale.transaction_date),
          saleDetails: details.map((d: any) => {
            const product = Array.isArray(d.product) ? d.product[0] : d.product;
            const quantity = Number(d.quantity ?? 0);
            const price = Number(d.price ?? 0);
            const subtotal = Number(d.subtotal ?? 0);
            const rawDiscount = Number(d.discount_applied ?? 0);
            const gross = price * quantity;

            let discountAmount = Math.max(0, gross - subtotal);
            let discountPercent = rawDiscount;

            if (discountPercent > 0 && discountAmount === 0 && gross > 0) {
              discountAmount = Math.round(((gross * discountPercent) / 100) * 100) / 100;
            } else if (discountPercent <= 0 && gross > 0 && discountAmount > 0) {
              discountPercent = Math.round((discountAmount / gross) * 100);
            }

            return {
              sales_detail_id: d.sales_detail_id,
              product_id: d.product_id,
              productName: (product?.product_name ?? "Unknown Shoe").trim(),
              brand: String(product?.brand ?? "").trim(),
              size: String(product?.size ?? "").trim(),
              color: String(product?.color ?? "").trim(),
              quantity,
              returned_quantity: Number(d.returned_quantity ?? 0),
              price,
              gross,
              discount_percent: discountPercent,
              discount_amount: discountAmount,
              subtotal,
            };
          }),
        };
      });
    },
    [replacementBySale, sales],
  );

  const visibleSales = useMemo(
    () => (isAdmin ? uiSales : uiSales.filter((sale) => sale.user_id === String(user?.user_id ?? ""))),
    [isAdmin, uiSales, user?.user_id],
  );

  const cashierOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; code: string; roleName: string }>();

    const allUsers = (usersQuery.data as any[]) ?? [];
    for (const u of allUsers) {
      const uId = String(u.user_id ?? "");
      const role = String(u.role?.name ?? u.role_name ?? "Staff").trim();
      if (uId) {
        map.set(uId, {
          id: uId,
          name: String(u.name || u.username || "Staff").trim(),
          code: formatStaffCode(u.staff_code, u.user_id, u.username),
          roleName: role,
        });
      }
    }

    for (const s of visibleSales) {
      const uId = String(s.user_id ?? "");
      if (uId && !map.has(uId)) {
        map.set(uId, {
          id: uId,
          name: s.cashierName || "Staff",
          code: s.cashierCode || "",
          roleName: "Cashier",
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [usersQuery.data, visibleSales]);

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
    setSelectedCashier("all");
    setReplacementFilter("all");
    setPaymentMethodFilter("all");
    setStatusFilter("all");
    setDatePreset("all");
    setStartDate("");
    setEndDate("");
    setCurrentPage(1);
  };

  const hasActiveFilters = Boolean(
    searchTerm.trim() ||
    selectedCashier !== "all" ||
    replacementFilter !== "all" ||
    paymentMethodFilter !== "all" ||
    statusFilter !== "all" ||
    startDate ||
    endDate ||
    datePreset !== "all"
  );

  const replacementLabelBySaleId = useMemo(() => {
    const map = new Map<string, "Replaced" | "Not Replaced">();
    for (const sale of visibleSales) {
      const hasReplacement = Number(sale.replacementCount ?? 0) > 0;
      map.set(sale.sales_id, hasReplacement ? "Replaced" : "Not Replaced");
    }
    return map;
  }, [visibleSales]);

  const filteredSales = useMemo(() => {
    return visibleSales.filter((s) => {
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchesSearch =
          s.sales_id.toLowerCase().includes(query) ||
          s.display_sales_id.toLowerCase().includes(query) ||
          s.cashierName.toLowerCase().includes(query) ||
          s.cashierUsername.toLowerCase().includes(query) ||
          s.customerName.toLowerCase().includes(query) ||
          s.payment_method.toLowerCase().includes(query) ||
          s.saleDetails.some((d: any) => d.productName.toLowerCase().includes(query));
        if (!matchesSearch) return false;
      }

      if (selectedCashier !== "all") {
        const matchesCashier =
          s.user_id === selectedCashier ||
          s.cashierUsername === selectedCashier ||
          s.cashierName === selectedCashier;
        if (!matchesCashier) return false;
      }

      if (replacementFilter !== "all") {
        const repStatus = replacementLabelBySaleId.get(s.sales_id) ?? "Not Replaced";
        if (replacementFilter === "replaced" && repStatus === "Not Replaced") return false;
        if (replacementFilter === "not_replaced" && repStatus !== "Not Replaced") return false;
      }

      if (paymentMethodFilter !== "all") {
        if (s.payment_method.toLowerCase() !== paymentMethodFilter.toLowerCase()) return false;
      }

      if (statusFilter !== "all") {
        if (s.status.toLowerCase() !== statusFilter.toLowerCase()) return false;
      }

      if (startDate && s.transaction_date !== "N/A" && s.transaction_date < startDate) {
        return false;
      }
      if (endDate && s.transaction_date !== "N/A" && s.transaction_date > endDate) {
        return false;
      }

      return true;
    });
  }, [visibleSales, searchTerm, selectedCashier, replacementFilter, paymentMethodFilter, statusFilter, replacementLabelBySaleId, startDate, endDate]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, selectedCashier, replacementFilter, paymentMethodFilter, statusFilter, datePreset, startDate, endDate]);

  const totalSalesPages = Math.max(1, Math.ceil(filteredSales.length / pageSize));
  const safeSalesPage = Math.min(Math.max(1, currentPage), totalSalesPages);
  const paginatedSales = useMemo(() => {
    return filteredSales.slice((safeSalesPage - 1) * pageSize, safeSalesPage * pageSize);
  }, [filteredSales, safeSalesPage, pageSize]);

  const filteredCompletedSales = useMemo(
    () => filteredSales.filter((s) => s.status === "Completed"),
    [filteredSales]
  );
  const filteredRevenue = useMemo(
    () => filteredCompletedSales.reduce((sum, sale) => sum + sale.total_amount, 0),
    [filteredCompletedSales]
  );
  const filteredTotalItemsSold = useMemo(() => {
    return filteredCompletedSales.reduce((sum, sale) => {
      const details = Array.isArray(sale.saleDetails) ? sale.saleDetails : [];
      return sum + details.reduce((dSum: number, item: any) => dSum + Number(item.quantity ?? 0), 0);
    }, 0);
  }, [filteredCompletedSales]);
  const filteredAverageOrderValue = useMemo(() => {
    if (filteredCompletedSales.length === 0) return 0;
    return filteredRevenue / filteredCompletedSales.length;
  }, [filteredRevenue, filteredCompletedSales.length]);

  const completedSales = visibleSales.filter((s) => s.status === "Completed");
  const totalRevenue = completedSales.reduce((sum, sale) => sum + sale.total_amount, 0);
  const today = new Date().toISOString().slice(0, 10);
  const todaySales = completedSales.filter((s) => s.transaction_date === today);

  const handleStatusUpdate = async (sale: any, nextStatus: SaleStatus) => {
    if (!isAdmin) return;
    if (sale.status === nextStatus) return;
    if (!sale.payment_id) {
      toast.error("No payment record found for this sale");
      return;
    }

    try {
      setUpdatingSaleId(sale.sales_id);
      const { error } = await supabase
        .from("payment")
        .update({ payment_status: toPaymentStatus(nextStatus) })
        .eq("payment_id", sale.payment_id);

      if (error) throw error;

      await writeAuditLog({
        actorUserId: user?.user_id,
        actionType: "update_sale_status",
        entityType: "payment",
        entityId: String(sale.payment_id ?? sale.sales_id),
        oldData: { status: sale.status },
        newData: { status: nextStatus },
        metadata: { sales_id: sale.sales_id, payment_id: sale.payment_id },
      });

      await queryClient.invalidateQueries({ queryKey: ["sales"] });
      toast.success(`Sale status updated to ${nextStatus}`);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed to update sale status");
    } finally {
      setUpdatingSaleId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* DYNAMIC METRIC KEYCARDS: Dynamically recalculated based on active period & filters */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        {/* Card 1: Sales */}
        <Card className="bg-[#15151D] border-[#24242F] rounded-2xl">
          <CardContent className="pt-5 pb-5 px-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-400 font-medium">Sales</p>
                <p className="text-2xl font-bold text-white tracking-tight mt-1.5">
                  ₱{filteredRevenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  {filteredCompletedSales.length} completed sale{filteredCompletedSales.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 shrink-0">
                <ShoppingCart className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Orders / Transactions */}
        <Card className="bg-[#15151D] border-[#24242F] rounded-2xl">
          <CardContent className="pt-5 pb-5 px-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-400 font-medium">Orders</p>
                <p className="text-2xl font-bold text-white tracking-tight mt-1.5">
                  {filteredSales.length}
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  {filteredCompletedSales.length} completed{filteredSales.length > filteredCompletedSales.length ? ` • ${filteredSales.length - filteredCompletedSales.length} other` : ""}
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 shrink-0">
                <Calendar className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Average Order Value */}
        <Card className="bg-[#15151D] border-[#24242F] rounded-2xl">
          <CardContent className="pt-5 pb-5 px-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-400 font-medium">Avg Order Value</p>
                <p className="text-2xl font-bold text-white tracking-tight mt-1.5">
                  ₱{filteredAverageOrderValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-zinc-400 mt-1">Per completed order</p>
              </div>
              <div className="p-2.5 rounded-xl bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 shrink-0">
                <TrendingUp className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Card 4: Items Sold */}
        <Card className="bg-[#15151D] border-[#24242F] rounded-2xl">
          <CardContent className="pt-5 pb-5 px-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-wider text-zinc-400 font-medium">Items Sold</p>
                <p className="text-2xl font-bold text-white tracking-tight mt-1.5">
                  {filteredTotalItemsSold}
                </p>
                <p className="text-xs text-zinc-400 mt-1">Total units sold</p>
              </div>
              <div className="p-2.5 rounded-xl bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 shrink-0">
                <Package className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-[#15151D] border-[#24242F] rounded-2xl">
        <CardHeader className="border-b border-[#24242F] pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <CardTitle className="text-white flex items-center gap-2 text-lg font-bold">
              <ShoppingCart className="w-5 h-5 text-yellow-400" />
              Sales Records
            </CardTitle>
            <div className="flex items-center gap-2 text-xs text-zinc-300">
              <span className="bg-[#181824] px-2.5 py-1 rounded-full border border-[#282836] text-zinc-300">
                Total: <strong className="text-yellow-400">{visibleSales.length}</strong> orders
              </span>
              {hasActiveFilters && (
                <span className="bg-yellow-400/10 text-yellow-300 px-2.5 py-1 rounded-full border border-yellow-400/30">
                  Filtered: <strong>{filteredSales.length}</strong> orders (₱{filteredRevenue.toFixed(2)})
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {/* FILTER CONTROLS BAR: Search, Cashier Filter, Replacement Filter, Date Range Presets & Pickers */}
          <div className="space-y-3 bg-[#12121A] p-3.5 rounded-xl border border-[#24242F]">
            <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-3">
              {/* Box 1: Search Bar */}
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-yellow-400 pointer-events-none" />
                <Input
                  placeholder="Search by receipt #, customer, product..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 bg-[#181824] border-[#282836] text-white placeholder:text-zinc-500 text-sm focus-visible:ring-yellow-400/40 rounded-xl"
                />
              </div>

              {/* Box 2: Cashier & Staff Dropdown Filter */}
              <div className="w-full xl:w-56 shrink-0">
                <Select value={selectedCashier} onValueChange={setSelectedCashier}>
                  <SelectTrigger className="w-full bg-[#181824] border-[#282836] text-zinc-200 text-sm focus:ring-yellow-400/40 rounded-xl">
                    <div className="flex items-center gap-2 truncate">
                      <Users className="w-4 h-4 text-yellow-400 shrink-0" />
                      <SelectValue placeholder="All Cashiers / Staff" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-[#181824] border-[#2E2E3E] text-zinc-200 max-h-64 shadow-2xl">
                    <SelectItem value="all">All Cashiers / Staff</SelectItem>
                    {cashierOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.code || c.roleName})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Box 3: Replacement Status Dropdown Filter */}
              <div className="w-full xl:w-48 shrink-0">
                <Select value={replacementFilter} onValueChange={(val: any) => setReplacementFilter(val)}>
                  <SelectTrigger className="w-full bg-[#181824] border-[#282836] text-zinc-200 text-sm focus:ring-yellow-400/40 rounded-xl">
                    <div className="flex items-center gap-2 truncate">
                      <RotateCcw className="w-4 h-4 text-yellow-400 shrink-0" />
                      <SelectValue placeholder="All" />
                    </div>
                  </SelectTrigger>
                  <SelectContent className="bg-[#181824] border-[#2E2E3E] text-zinc-200 shadow-2xl">
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="replaced">Replaced</SelectItem>
                    <SelectItem value="not_replaced">Not Replaced</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Box 4: Payment Method Filter */}
              <div className="w-full xl:w-36 shrink-0">
                <Select value={paymentMethodFilter} onValueChange={setPaymentMethodFilter}>
                  <SelectTrigger className="w-full bg-[#181824] border-[#282836] text-zinc-200 text-sm focus:ring-yellow-400/40 rounded-xl">
                    <SelectValue placeholder="Payment Mode" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#181824] border-[#2E2E3E] text-zinc-200 shadow-2xl">
                    <SelectItem value="all">All Modes</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="gcash">GCash</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Box 5: Order Status Filter */}
              <div className="w-full xl:w-36 shrink-0">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full bg-[#181824] border-[#282836] text-zinc-200 text-sm focus:ring-yellow-400/40 rounded-xl">
                    <SelectValue placeholder="All Status" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#181824] border-[#2E2E3E] text-zinc-200 shadow-2xl">
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="Completed">Completed</SelectItem>
                    <SelectItem value="Pending">Pending</SelectItem>
                    <SelectItem value="Voided">Voided</SelectItem>
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
                Showing <strong className="text-yellow-400">{filteredSales.length}</strong> of {visibleSales.length} sales
              </div>
            </div>
          </div>

          <div className="border border-[#24242F] rounded-xl overflow-x-auto bg-[#121218]">
            <Table className="w-full min-w-[860px]">
              <TableHeader>
                <TableRow className="bg-[#181824] hover:bg-[#181824] border-b border-[#24242F]">
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Receipt #</TableHead>
                  {isAdmin && <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Cashier</TableHead>}
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Customer</TableHead>
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Amount</TableHead>
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Status</TableHead>
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Date</TableHead>
                  <TableHead className="text-zinc-300 whitespace-nowrap text-center font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSales.length === 0 ? (
                  <TableRow className="border-b border-[#24242F]">
                    <TableCell colSpan={isAdmin ? 7 : 6} className="h-32 text-center text-zinc-300">
                      <div className="flex flex-col items-center justify-center gap-1.5 py-6">
                        <ShoppingCart className="w-8 h-8 text-yellow-400/40 mb-1" />
                        <p className="font-semibold text-white">No sales transactions found</p>
                        <p className="text-xs text-zinc-400">
                          {hasActiveFilters ? "Try adjusting your search keywords, cashier shift, or date range." : "No sales recorded yet."}
                        </p>
                        {hasActiveFilters && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={handleResetFilters}
                            className="mt-2 text-xs text-yellow-400 hover:text-white hover:bg-yellow-400/10 rounded-lg"
                          >
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                            Clear Filters
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  paginatedSales.map((sale: any) => (
                  <TableRow key={sale.sales_id} className="border-b border-[#20202C] hover:bg-[#1A1A26]/70 transition-colors">
                    <TableCell className="text-yellow-400 font-mono font-medium whitespace-nowrap text-center">{sale.display_sales_id}</TableCell>
                    {isAdmin && (
                      <TableCell className="text-zinc-200 whitespace-nowrap text-center">
                        <div className="flex flex-col items-center">
                          <span className="font-medium text-white">{sale.cashierName}</span>
                          <span className="text-xs text-zinc-400">{sale.cashierCode}</span>
                          {sale.cashierUsername && <span className="text-xs text-yellow-400/60">@{sale.cashierUsername}</span>}
                        </div>
                      </TableCell>
                    )}
                    <TableCell className="text-zinc-200 whitespace-nowrap text-center">{sale.customerName}</TableCell>
                    <TableCell className="text-white font-semibold whitespace-nowrap text-center">PHP {Number(sale.total_amount ?? 0).toFixed(2)}</TableCell>
                    <TableCell className="whitespace-nowrap text-center">
                      <div className="flex items-center justify-center gap-2">
                        {isAdmin ? (
                          <Select
                            value={sale.status}
                            onValueChange={(value) => void handleStatusUpdate(sale, value as SaleStatus)}
                            disabled={updatingSaleId === sale.sales_id}
                          >
                            <SelectTrigger className="h-8 w-28 bg-[#181824] border-[#282836] text-zinc-200 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#181824] border-[#2E2E3E] text-zinc-200">
                              <SelectItem value="Completed">Completed</SelectItem>
                              <SelectItem value="Pending">Pending</SelectItem>
                              <SelectItem value="Voided">Voided</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge
                            className={
                              sale.status === "Completed"
                                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                : sale.status === "Pending"
                                  ? "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                                  : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                            }
                          >
                            {sale.status}
                          </Badge>
                        )}
                        {replacementLabelBySaleId.get(sale.sales_id) !== "Not Replaced" && (
                          <Badge className="bg-blue-500/20 text-blue-400 border border-blue-500/30" title="Replaced">Replaced</Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-zinc-400 text-sm whitespace-nowrap text-center">{sale.lastActivityDate}</TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      <Dialog open={viewingSale?.sales_id === sale.sales_id} onOpenChange={(open) => !open && setViewingSale(null)}>
                        <DialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-yellow-400 hover:text-white hover:bg-yellow-400/10 rounded-lg"
                            onClick={() => setViewingSale(sale)}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="bg-zinc-950 border border-zinc-800 text-zinc-100 max-w-3xl max-h-[85vh] overflow-y-auto shadow-2xl">
                          <DialogHeader className="border-b border-zinc-800/80 pb-3">
                            <div className="flex items-center justify-between pr-6 flex-wrap gap-2">
                              <DialogTitle className="text-zinc-100 text-lg font-bold">
                                Sale Details • {sale.display_sales_id}
                              </DialogTitle>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => openReceiptForSale(sale)}
                                  className="bg-[#FFD60A] hover:bg-[#ffcf24] text-[#15151B] font-bold text-xs h-8 px-3 rounded-lg flex items-center gap-1.5 transition-colors"
                                >
                                  <Receipt className="w-3.5 h-3.5" />
                                  <span>View Receipt</span>
                                </Button>
                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider ${
                                  sale.status === 'Completed' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' :
                                  sale.status === 'Pending' ? 'bg-amber-950 text-amber-300 border border-amber-800' :
                                  'bg-red-950 text-red-300 border border-red-800'
                                }`}>
                                  {sale.status}
                                </span>
                              </div>
                            </div>
                          </DialogHeader>

                          {(() => {
                            const totalGross = sale.saleDetails.reduce((sum: number, d: any) => sum + (d.gross || 0), 0);
                            const totalDiscount = sale.saleDetails.reduce((sum: number, d: any) => sum + (d.discount_amount || 0), 0);
                            const totalItemsCount = sale.saleDetails.reduce((sum: number, d: any) => sum + (d.quantity || 0), 0);

                            return (
                              <div className="space-y-4 py-3">
                                {/* TRANSACTION INFO */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/60 text-xs">
                                  <div>
                                    <p className="text-[11px] text-zinc-400 font-medium">Customer</p>
                                    <p className="font-semibold text-zinc-100 truncate mt-0.5">{sale.customerName}</p>
                                  </div>
                                  {isAdmin && (
                                    <div>
                                      <p className="text-[11px] text-zinc-400 font-medium">Cashier</p>
                                      <p className="font-semibold text-zinc-100 truncate mt-0.5">{sale.cashierName}</p>
                                      <p className="text-[10px] text-zinc-400">{sale.cashierCode}</p>
                                    </div>
                                  )}
                                  <div>
                                    <p className="text-[11px] text-zinc-400 font-medium">Transaction Date</p>
                                    <p className="font-semibold text-zinc-100 mt-0.5">{sale.transaction_date}</p>
                                  </div>
                                  <div>
                                    <p className="text-[11px] text-zinc-400 font-medium">Payment Method</p>
                                    <p className="font-semibold text-zinc-100 uppercase mt-0.5">{sale.payment_method}</p>
                                  </div>
                                </div>

                                {/* PURCHASED PRODUCTS */}
                                <div className="space-y-2.5">
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs uppercase tracking-wider text-zinc-400 font-semibold">
                                      Purchased Items ({totalItemsCount} {totalItemsCount === 1 ? 'pair' : 'pairs'})
                                    </p>
                                  </div>

                                  <div className="space-y-2">
                                    {sale.saleDetails.map((detail: any, idx: number) => {
                                      const hasDiscount = detail.discount_amount > 0 || detail.discount_percent > 0;
                                      return (
                                        <div
                                          key={idx}
                                          className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                                        >
                                          <div className="space-y-1.5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                              <span className="font-bold text-zinc-100 text-sm">{detail.productName}</span>
                                              {detail.brand && detail.brand !== "N/A" && (
                                                <span className="text-[11px] px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700">
                                                  {detail.brand}
                                                </span>
                                              )}
                                              {detail.size && detail.size !== "N/A" && (
                                                <span className="text-[11px] px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700">
                                                  Size {detail.size}
                                                </span>
                                              )}
                                              {detail.color && detail.color !== "N/A" && (
                                                <span className="text-[11px] px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-300 border border-zinc-700">
                                                  {detail.color}
                                                </span>
                                              )}
                                            </div>

                                            <p className="text-xs text-zinc-400">
                                              Qty: <span className="text-zinc-200 font-medium">{detail.quantity} {detail.quantity === 1 ? 'pair' : 'pairs'}</span> × {formatCurrency(detail.price)}
                                            </p>

                                            {hasDiscount && (
                                              <p className="text-xs font-semibold text-emerald-400">
                                                Discount: {detail.discount_percent > 0 ? `${detail.discount_percent}%` : ''} (-{formatCurrency(detail.discount_amount)})
                                              </p>
                                            )}
                                          </div>

                                          <div className="text-right shrink-0">
                                            <p className="text-[11px] text-zinc-400">Item Total</p>
                                            <p className="text-sm font-bold text-yellow-300">{formatCurrency(detail.subtotal)}</p>
                                            {hasDiscount && (
                                              <p className="text-[11px] text-zinc-500 line-through">
                                                {formatCurrency(detail.gross)}
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* REPLACEMENTS SECTION */}
                                {sale.replacementDetails.length > 0 && (
                                  <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                                    <p className="mb-3 text-xs uppercase tracking-wider text-zinc-400 font-semibold">Replacement Items</p>
                                    <div className="space-y-3">
                                      {sale.replacementDetails.map((detail: any) => (
                                        <div key={detail.return_detail_id} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
                                          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:items-stretch">
                                            <div className="rounded-md border border-red-900/50 bg-red-950/20 p-3">
                                              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Replaced Item</p>
                                              <p className="font-medium text-zinc-100">{detail.returnedProductName}</p>
                                              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-zinc-300">
                                                <span>Qty: {detail.returnedQuantity}</span>
                                                <span>Size: {detail.returnedSize}</span>
                                                <span>Color: {detail.returnedColor}</span>
                                              </div>
                                            </div>
                                            <div className="rounded-md border border-emerald-900/50 bg-emerald-950/20 p-3">
                                              <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Replacement Item</p>
                                              <p className="font-medium text-zinc-100">{detail.replacementProductName}</p>
                                              <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-zinc-300">
                                                <span>Qty: {detail.replacementQuantity}</span>
                                                <span>Size: {detail.replacementSize}</span>
                                                <span>Color: {detail.replacementColor}</span>
                                              </div>
                                            </div>
                                          </div>
                                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-300">
                                            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">1:1 Even Exchange</Badge>
                                            <Badge className="bg-zinc-800 text-zinc-200">Inventory: {detail.inventoryAction}</Badge>
                                            {detail.customerReason && (
                                              <Badge className="bg-zinc-800 text-zinc-200">Reason: {detail.customerReason}</Badge>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}

                                {/* FINANCIAL SUMMARY */}
                                <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 space-y-3">
                                  <p className="text-xs uppercase tracking-wider text-zinc-400 font-semibold">Payment & Settlement</p>

                                  <div className="space-y-1.5 text-xs text-zinc-300 border-b border-zinc-800 pb-3">
                                    <div className="flex justify-between">
                                      <span className="text-zinc-400">Gross Subtotal:</span>
                                      <span className="font-medium text-zinc-200">{formatCurrency(totalGross)}</span>
                                    </div>
                                    {totalDiscount > 0 && (
                                      <div className="flex justify-between text-emerald-400 font-medium">
                                        <span>Total Discount:</span>
                                        <span>-{formatCurrency(totalDiscount)}</span>
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex justify-between items-baseline pt-1">
                                    <span className="text-sm font-bold text-zinc-100">Total Net Amount:</span>
                                    <span className="text-lg font-black text-yellow-300">{formatCurrency(sale.total_amount)}</span>
                                  </div>

                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-3 border-t border-zinc-800 text-xs">
                                    <div>
                                      <p className="text-zinc-400 text-[11px]">Payment Mode</p>
                                      <p className="font-semibold text-zinc-200 uppercase mt-0.5">{sale.payment_method}</p>
                                    </div>
                                    <div>
                                      <p className="text-zinc-400 text-[11px]">Replacements</p>
                                      <p className="font-semibold text-zinc-200 mt-0.5">{sale.replacementCount} item{sale.replacementCount === 1 ? '' : 's'}</p>
                                    </div>
                                    <div>
                                      <p className="text-zinc-400 text-[11px]">Last Activity</p>
                                      <p className="font-semibold text-zinc-200 mt-0.5">{sale.lastActivityDate}</p>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                )))}
              </TableBody>
            </Table>
          </div>

          <TablePagination
            currentPage={safeSalesPage}
            pageSize={pageSize}
            totalItems={filteredSales.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={setPageSize}
            pageSizeOptions={[10, 15, 25, 50, 100]}
            unitName="sales"
          />
        </CardContent>
      </Card>

      {/* THERMAL RECEIPT MODAL */}
      <Dialog open={!!viewingReceipt} onOpenChange={(open) => !open && setViewingReceipt(null)}>
        <DialogContent className="bg-[#12121a] border-[#2d2d3d] text-zinc-900 max-w-md rounded-2xl shadow-2xl p-4 sm:p-6 max-h-[92vh] overflow-y-auto">
          <DialogHeader className="border-b border-[#252536] pb-3 text-left">
            <DialogTitle className="text-white text-base font-bold flex items-center gap-2">
              <Receipt className="w-5 h-5 text-yellow-400" />
              Official Sales Receipt
            </DialogTitle>
          </DialogHeader>

          {viewingReceipt && (
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
                <div className="flex justify-between"><span>OR No:</span><span className="font-bold">{viewingReceipt.receiptNumber}</span></div>
                <div className="flex justify-between"><span>Date:</span><span>{viewingReceipt.date}</span></div>
                <div className="flex justify-between"><span>Cashier:</span><span>{viewingReceipt.cashier}</span></div>
                <div className="flex justify-between"><span>Terminal:</span><span>POS-01</span></div>
              </div>

              {/* ── CUSTOMER ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <div className="text-[11px]">
                <span>Customer: {viewingReceipt.customerName}</span>
              </div>

              {/* ── ITEMS ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <div className="space-y-1.5 text-[11px]">
                {viewingReceipt.items.map((item: any, idx: number) => (
                  <div key={idx}>
                    <p className="font-bold uppercase">{item.name}</p>
                    <p className="text-[10px]">
                      {[item.brand, item.color, item.size ? `Size ${item.size}` : ""].filter(Boolean).join(" / ")}
                    </p>
                    <div className="flex justify-between">
                      <span>{item.quantity} @ {item.unitPrice.toFixed(2)}</span>
                      <span>{item.subtotal.toFixed(2)} V</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* ── TOTALS ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <div className="space-y-0.5 text-[11px]">
                {viewingReceipt.discount > 0 && (
                  <>
                    <div className="flex justify-between"><span>Subtotal:</span><span>{viewingReceipt.grossSubtotal.toFixed(2)}</span></div>
                    <div className="flex justify-between"><span>Discount:</span><span>-{viewingReceipt.discount.toFixed(2)}</span></div>
                  </>
                )}
                <div className="flex justify-between font-bold text-[13px] pt-1">
                  <span>TOTAL</span>
                  <span>{viewingReceipt.total.toFixed(2)}</span>
                </div>
              </div>

              {/* ── PAYMENT ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <div className="space-y-0.5 text-[11px]">
                <div className="flex justify-between"><span>{viewingReceipt.paymentMethod}:</span><span>{viewingReceipt.paymentMethod}</span></div>
                <div className="flex justify-between"><span>Total Tender:</span><span>{viewingReceipt.cashReceived.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Change Due:</span><span>{viewingReceipt.changeAmount.toFixed(2)}</span></div>
                <div className="flex justify-between pt-0.5">
                  <span>Qty of item(s) purchased:</span>
                  <span>{viewingReceipt.totalItemsCount}.00</span>
                </div>
              </div>

              {/* ── VAT SUMMARY ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <p className="text-center font-bold text-[11px] mb-0.5">VAT SUMMARY</p>
              <div className="space-y-0.5 text-[11px]">
                <div className="flex justify-between"><span>Vatable Amt(V):</span><span className="tabular-nums">{viewingReceipt.vatableSales.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Vat Amt(V +12%):</span><span className="tabular-nums">{viewingReceipt.vatAmount.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Vat Exempted Sale(E):</span><span className="tabular-nums">{viewingReceipt.vatExemptSales.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Zero Rated Amt(Z):</span><span className="tabular-nums">{viewingReceipt.zeroRatedSales.toFixed(2)}</span></div>
              </div>

              {/* ── CUSTOMER COPY ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <p className="text-center font-bold text-[11px]">Customer Copy</p>

              {/* ── QR CODE ── */}
              <div className="flex justify-center pt-2 pb-1">
                <QRCodeSVG
                  value={viewingReceipt.receiptNumber || viewingReceipt.rawSalesId}
                  size={96}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <p className="text-center text-[9px] font-mono">*{viewingReceipt.receiptNumber}*</p>

              {/* ── FOOTER ── */}
              <p className="text-center text-[10px] tracking-widest my-1">- - - - - - - - - - - - - - - - - -</p>
              <p className="text-center text-[10px] font-bold tracking-wide">THIS SERVES AS YOUR</p>
              <p className="text-center text-[10px] font-bold tracking-wide">OFFICIAL RECEIPT</p>
            </div>
          )}

          <div className="mt-4 flex items-center justify-end gap-3 pt-3 border-t border-[#252536]">
            <Button
              type="button"
              variant="outline"
              onClick={() => setViewingReceipt(null)}
              className="border-[#343444] text-zinc-300 hover:text-white rounded-xl text-xs h-9 px-4"
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={() => {
                window.print();
                toast.success("Receipt sent to printer");
              }}
              className="bg-[#FFD60A] hover:bg-[#ffcf24] text-[#15151B] font-bold rounded-xl text-xs h-9 px-4 flex items-center gap-2 shadow"
            >
              <Receipt className="w-4 h-4" />
              <span>Print Receipt</span>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}




