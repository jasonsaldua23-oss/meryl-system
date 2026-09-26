import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Package, Coins, Users, AlertCircle, ArrowUpRight, ArrowDownRight, MoreHorizontal } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, CartesianGrid, BarChart, Bar, Cell, LabelList, YAxis } from "recharts";
import { useCustomers, useProducts, useSales } from "../../lib/hooks";
import { supabase } from "../../lib/supabase";
import { parseDbTimestamp } from "../../lib/datetime";

function formatPeso(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function shortDate(value: string | null | undefined) {
  const date = parseDbTimestamp(value);
  if (!date) return "-";
  return date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function localDayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function Dashboard() {
  const salesQuery = useSales();
  const productsQuery = useProducts();
  const customersQuery = useCustomers();

  const topProductsQuery = useQuery({
    queryKey: ["dashboard-top-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sales_details")
        .select("quantity, subtotal, product:product_id(product_name)");
      if (error) throw error;
      return data ?? [];
    },
  });

  const sales = (salesQuery.data as any[]) ?? [];
  const products = (productsQuery.data as any[]) ?? [];
  const customers = (customersQuery.data as any[]) ?? [];
  const salesDetails = (topProductsQuery.data as any[]) ?? [];

  const {
    totalRevenue,
    monthRevenue,
    monthRevenueChange,
    totalStock,
    lowStockCount,
    newCustomersThisMonth,
    recentSales,
    revenueData,
    categoryData,
    topProducts,
  } = useMemo(() => {
    const isCompletedPayment = (value: string | null | undefined) => {
      const normalized = String(value ?? "").trim().toLowerCase();
      return normalized === "completed" || normalized === "paid";
    };

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const previousMonthDate = new Date(currentYear, currentMonth - 1, 1);
    const previousMonth = previousMonthDate.getMonth();
    const previousMonthYear = previousMonthDate.getFullYear();

    let revenueAll = 0;
    let revenueCurrentMonth = 0;
    let revenuePreviousMonth = 0;

    const parsedSales = [...sales]
      .map((s) => {
        const amount = Number(s.total_amount ?? 0);
        const rawDate = s.transaction_date ?? s.created_at ?? null;
        const date = parseDbTimestamp(rawDate);
        const payment = Array.isArray((s as any).payment) ? (s as any).payment[0] : (s as any).payment;
        const paymentStatus = payment?.payment_status ?? null;
        return {
          ...s,
          amount,
          isCompleted: isCompletedPayment(paymentStatus),
          date,
          dateValue: date && !Number.isNaN(date.getTime()) ? date.getTime() : 0,
        };
      })
      .sort((a, b) => b.dateValue - a.dateValue);

    for (const sale of parsedSales) {
      if (!sale.isCompleted) continue;
      revenueAll += sale.amount;
      if (!sale.date || Number.isNaN(sale.date.getTime())) continue;
      const saleMonth = sale.date.getMonth();
      const saleYear = sale.date.getFullYear();
      if (saleMonth === currentMonth && saleYear === currentYear) {
        revenueCurrentMonth += sale.amount;
      } else if (saleMonth === previousMonth && saleYear === previousMonthYear) {
        revenuePreviousMonth += sale.amount;
      }
    }

    const monthChange =
      revenuePreviousMonth > 0
        ? ((revenueCurrentMonth - revenuePreviousMonth) / revenuePreviousMonth) * 100
        : revenueCurrentMonth > 0
          ? 100
          : 0;

    const stockList = products.map((p) => {
      const inventory = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
      const stock = Number(inventory?.stock_quantity ?? 0);
      const reorder = Number(p.reorder_level ?? inventory?.reorder_level ?? 10);
      return { stock, reorder };
    });
    const stockTotal = stockList.reduce((sum, row) => sum + row.stock, 0);
    const lowStock = stockList.filter((row) => row.stock > 0 && row.stock <= row.reorder).length;

    const customerNewCount = customers.filter((c) => {
      const rawDate = c.created_at ?? c.date_registered ?? null;
      if (!rawDate) return false;
      const date = parseDbTimestamp(rawDate) ?? new Date(NaN);
      return !Number.isNaN(date.getTime()) && date.getMonth() === currentMonth && date.getFullYear() === currentYear;
    }).length;

    const recent = parsedSales.slice(0, 5).map((s) => ({
      id: String(s.sales_id ?? ""),
      customer: s.customer?.customer_name || s.customer?.name || "Walk-in Customer",
      product: `Order #${s.sales_id ?? "-"}`,
      amount: formatPeso(s.amount),
      date: shortDate(s.transaction_date ?? s.created_at),
    }));

    const dailyRevenueMap = new Map<string, number>();
    const dayLabelMap = new Map<string, string>();
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setHours(0, 0, 0, 0);
      d.setDate(now.getDate() - i);
      const key = localDayKey(d);
      dailyRevenueMap.set(key, 0);
      dayLabelMap.set(key, d.toLocaleDateString("en-US", { weekday: "short" }));
    }
    for (const s of parsedSales) {
      if (!s.isCompleted) continue;
      if (!s.date || Number.isNaN(s.date.getTime())) continue;
      const key = localDayKey(new Date(s.date.getFullYear(), s.date.getMonth(), s.date.getDate()));
      if (!dailyRevenueMap.has(key)) continue;
      dailyRevenueMap.set(key, (dailyRevenueMap.get(key) ?? 0) + s.amount);
    }
    const revenueSeries = Array.from(dailyRevenueMap.entries()).map(([key, value]) => ({
      day: dayLabelMap.get(key) ?? key,
      value: Math.round(value),
    }));

    const categoryCount = new Map<string, number>();
    for (const p of products) {
      const categoryName = p.category?.[0]?.category_name || p.category?.category_name || "Uncategorized";
      categoryCount.set(categoryName, (categoryCount.get(categoryName) ?? 0) + 1);
    }
    const categoryTotal = Array.from(categoryCount.values()).reduce((a, b) => a + b, 0) || 1;
    const categorySeries = Array.from(categoryCount.entries())
      .map(([name, count]) => ({
        name,
        value: Math.round((count / categoryTotal) * 100),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 4);

    const productStats = new Map<string, { sold: number; revenue: number }>();
    for (const row of salesDetails) {
      const productName = row.product?.product_name || "Unknown Product";
      const qty = Number(row.quantity ?? 0);
      const subtotal = Number(row.subtotal ?? 0);
      const prev = productStats.get(productName) ?? { sold: 0, revenue: 0 };
      productStats.set(productName, { sold: prev.sold + qty, revenue: prev.revenue + subtotal });
    }
    const topProductSeries = Array.from(productStats.entries())
      .map(([name, agg]) => ({ name, sold: agg.sold, revenue: formatPeso(agg.revenue) }))
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 5);

    return {
      totalRevenue: revenueAll,
      monthRevenue: revenueCurrentMonth,
      monthRevenueChange: monthChange,
      totalStock: stockTotal,
      lowStockCount: lowStock,
      newCustomersThisMonth: customerNewCount,
      recentSales: recent,
      revenueData: revenueSeries,
      categoryData: categorySeries,
      topProducts: topProductSeries,
    };
  }, [sales, products, customers, salesDetails]);

  const loading =
    salesQuery.isLoading ||
    productsQuery.isLoading ||
    customersQuery.isLoading ||
    topProductsQuery.isLoading;

  const stats = [
    {
      title: "Total Revenue",
      value: formatPeso(totalRevenue),
      change: `${monthRevenueChange >= 0 ? "+" : ""}${monthRevenueChange.toFixed(1)}% vs last month`,
      icon: Coins,
      trend: monthRevenueChange < 0 ? "down" : "up",
      accent: "red",
    },
    {
      title: "Products in Stock",
      value: totalStock.toLocaleString(),
      change: `${products.length} variants`,
      icon: Package,
      trend: "up",
      accent: "yellow",
    },
    {
      title: "Total Customers",
      value: customers.length.toLocaleString(),
      change: `+${newCustomersThisMonth} this month`,
      icon: Users,
      trend: "up",
      accent: "red",
    },
    {
      title: "Low Stock Items",
      value: lowStockCount.toLocaleString(),
      change: lowStockCount > 0 ? "Needs attention" : "Healthy",
      icon: AlertCircle,
      trend: lowStockCount > 0 ? "warning" : "up",
      accent: "yellow",
    },
  ];

  if (loading) {
    return <div className="text-sm text-white/60">Loading dashboard data...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="relative rounded-3xl overflow-hidden p-8 bg-[#16161C] border border-white/5">
        <div className="absolute -right-10 -top-10 w-64 h-64 rounded-full bg-[#FFD60A]/15 blur-3xl" />
        <div className="absolute right-20 bottom-0 w-40 h-40 rounded-full bg-[#E5202A]/10 blur-2xl" />
        <div className="relative grid md:grid-cols-3 gap-6 items-center">
          <div className="md:col-span-2">
            <div className="text-[11px] uppercase tracking-widest text-[#FFD60A]">Net Sales Revenue</div>
            <div className="mt-2 text-white text-4xl tracking-tight">{formatPeso(totalRevenue)}</div>
            <div className="flex items-center gap-2 mt-3 text-sm text-white/60">
              <span className="inline-flex items-center gap-1 bg-[#FFD60A] text-[#1A1A22] px-2 py-0.5 rounded-full text-xs">
                <ArrowUpRight className="w-3 h-3" /> {monthRevenueChange >= 0 ? "+" : ""}
                {monthRevenueChange.toFixed(1)}%
              </span>
              vs last month - completed sales only
            </div>
          </div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData} margin={{ top: 10, right: 12, left: 12, bottom: 0 }}>
                <defs>
                  <linearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#FFD60A" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#FFD60A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area type="monotone" dataKey="value" stroke="#FFD60A" strokeWidth={2} fill="url(#heroFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          const isYellow = stat.accent === "yellow";
          return (
            <div
              key={index}
              className="group relative rounded-2xl p-5 bg-[#16161C] border border-white/5 hover:border-white/10 transition"
            >
              <div className="flex items-start justify-between">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    isYellow ? "bg-[#FFD60A]/15 text-[#FFD60A]" : "bg-[#E5202A]/15 text-[#FF6B72]"
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <button className="text-white/30 hover:text-white/70">
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-4 text-xs text-white/50">{stat.title}</div>
              <div className="mt-1 text-white text-2xl tracking-tight">{stat.value}</div>
              <div
                className={`mt-2 inline-flex items-center gap-1 text-xs ${
                  stat.trend === "warning" ? "text-[#FFD60A]" : stat.trend === "down" ? "text-rose-400" : "text-emerald-400"
                }`}
              >
                {stat.trend === "warning" || stat.trend === "down" ? (
                  <ArrowDownRight className="w-3 h-3" />
                ) : (
                  <ArrowUpRight className="w-3 h-3" />
                )}
                {stat.change}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl p-6 bg-[#16161C] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-white">Revenue Overview</h3>
              <p className="text-xs text-white/40 mt-0.5">Last 7 days performance</p>
            </div>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueData} margin={{ top: 8, right: 28, left: 28, bottom: 12 }}>
                <defs>
                  <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#E5202A" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#E5202A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                <XAxis
                  dataKey="day"
                  stroke="#ffffff40"
                  tick={{ fill: "#cbd5e1", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  padding={{ left: 24, right: 24 }}
                />
                <Tooltip
                  formatter={(value) => [formatPeso(Number(value)), "Revenue"]}
                  contentStyle={{
                    background: "#16161C",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                    padding: "10px 14px",
                    color: "#fff",
                  }}
                  labelStyle={{ color: "#FFFFFF", fontWeight: 600, fontSize: 13, marginBottom: 4 }}
                  itemStyle={{ color: "#FFFFFF", fontSize: 12, fontWeight: 500 }}
                />
                <Area type="monotone" dataKey="value" stroke="#FFD60A" strokeWidth={2.5} fill="url(#revFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl p-6 bg-[#16161C] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-white font-semibold">Categories</h3>
              <p className="text-xs text-white/50 mt-0.5">Inventory mix</p>
            </div>
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData}>
                <XAxis
                  dataKey="name"
                  stroke="#ffffff60"
                  tick={{ fill: "#cbd5e1", fontSize: 10, fontWeight: 500 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#ffffff55"
                  tick={{ fill: "#94a3b8", fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 100]}
                  tickFormatter={(value) => `${value}%`}
                  width={34}
                />
                <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                  {categoryData.map((entry, i) => (
                    <Cell key={entry.name} fill={i % 2 === 0 ? "#E5202A" : "#FFD60A"} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="top"
                    formatter={(value: number) => `${Number(value)}%`}
                    fill="#FFFFFF"
                    fontSize={11}
                    fontWeight={600}
                    offset={6}
                  />
                </Bar>
                <Tooltip
                  formatter={(value: number) => [`${Number(value)}%`, "Percentage"]}
                  cursor={{ fill: "rgba(255, 255, 255, 0.05)" }}
                  contentStyle={{
                    background: "#16161C",
                    border: "1px solid rgba(255, 255, 255, 0.15)",
                    borderRadius: 12,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                    padding: "10px 14px",
                    color: "#fff",
                  }}
                  labelStyle={{ color: "#FFFFFF", fontWeight: 600, fontSize: 13, marginBottom: 4 }}
                  itemStyle={{ color: "#FFFFFF", fontSize: 12, fontWeight: 500 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 space-y-2">
            {categoryData.map((c, i) => (
              <div key={c.name} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${i % 2 === 0 ? "bg-[#E5202A]" : "bg-[#FFD60A]"}`} />
                  <span className="text-white/90 font-medium">{c.name}</span>
                </div>
                <span className="text-white font-semibold">{c.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl p-6 bg-[#16161C] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white">Recent Sales</h3>
          </div>
          <div className="space-y-1">
            {recentSales.map((sale) => (
              <div key={sale.id} className="flex justify-between items-center py-3 border-b border-white/5 last:border-0">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#E5202A] to-[#FFD60A] flex items-center justify-center text-xs">
                    {sale.customer.charAt(0)}
                  </div>
                  <div>
                    <p className="text-white text-sm">{sale.customer}</p>
                    <p className="text-white/40 text-xs">{sale.product}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white text-sm">{sale.amount}</p>
                  <p className="text-white/40 text-xs">{sale.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl p-6 bg-[#16161C] border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#FFD60A]" />
              Top Selling Products
            </h3>
          </div>
          <div className="space-y-1">
            {topProducts.map((product, index) => {
              const max = Math.max(...topProducts.map((p) => p.sold), 1);
              const pct = (product.sold / max) * 100;
              return (
                <div key={index} className="py-2.5 border-b border-white/5 last:border-0">
                  <div className="flex justify-between items-center mb-1.5">
                    <p className="text-white text-sm">{product.name}</p>
                    <p className="text-white text-sm">{product.revenue}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-[#E5202A] to-[#FFD60A]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-white/40 text-xs w-16 text-right">{product.sold} units</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
