import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { AlertCircle, TrendingUp, Package, Zap, Download } from "lucide-react";
import { inventoryAnalyticsApi, type InventoryTurnoverContext, type InventoryProduct } from "../../lib/api/inventoryAnalytics";
import { toast } from "sonner";
import { localDateKey } from "../../lib/datetime";

function formatPeso(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function getVelocityBadgeColor(velocityClass: string) {
  switch (velocityClass) {
    case "high_velocity":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "medium_velocity":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "slow_mover":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "dead_stock":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

function getActionBadgeColor(actionTone: string | null) {
  if (!actionTone) return "bg-green-500/20 text-green-400 border-green-500/30";
  switch (actionTone) {
    case "success":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "warning":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "danger":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

interface ProductTableProps {
  products: InventoryProduct[];
  emptyMessage: string;
  columns: ("turnover" | "sales" | "stock" | "days" | "recommendation" | "action")[];
}

function ProductTable({ products, emptyMessage, columns }: ProductTableProps) {
  if (products.length === 0) {
    return <div className="text-center py-8 text-white/60">{emptyMessage}</div>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-white/10">
            <TableHead className="text-white/70">Product Name</TableHead>
            <TableHead className="text-white/70 text-right">Category</TableHead>
            {columns.includes("sales") && <TableHead className="text-white/70 text-right">Units Sold (30d)</TableHead>}
            {columns.includes("stock") && <TableHead className="text-white/70 text-right">Current Stock</TableHead>}
            {columns.includes("turnover") && <TableHead className="text-white/70 text-right">Turnover Ratio</TableHead>}
            {columns.includes("days") && <TableHead className="text-white/70 text-right">Days of Stock</TableHead>}
            {columns.includes("recommendation") && <TableHead className="text-white/70 text-right">Recommendation</TableHead>}
            {columns.includes("action") && <TableHead className="text-white/70 text-right">Action</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.product_id} className="border-white/5 hover:bg-white/5">
              <TableCell className="text-white">
                <div>
                  <p className="font-medium">{product.product_name}</p>
                  <p className="text-xs text-white/50">Size {product.size}</p>
                </div>
              </TableCell>
              <TableCell className="text-right text-white/70">{product.category}</TableCell>
              {columns.includes("sales") && <TableCell className="text-right text-white">{product.units_sold_30d}</TableCell>}
              {columns.includes("stock") && <TableCell className="text-right text-white">{product.current_stock}</TableCell>}
              {columns.includes("turnover") && (
                <TableCell className="text-right">
                  <span className="text-white font-semibold">{product.turnover_ratio}x</span>
                </TableCell>
              )}
              {columns.includes("days") && <TableCell className="text-right text-white">{product.days_of_stock} days</TableCell>}
              {columns.includes("recommendation") && (
                <TableCell className="text-right">
                  <Badge className={`${getVelocityBadgeColor(product.velocity_class)} border`}>
                    {product.velocity_label}
                  </Badge>
                </TableCell>
              )}
              {columns.includes("action") && (
                <TableCell className="text-right">
                  {product.action ? (
                    <Badge className={`${getActionBadgeColor(product.action_tone)} border`}>
                      {product.action}
                    </Badge>
                  ) : (
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30 border">
                      Optimal
                    </Badge>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function InventoryTurnoverAnalytics() {
  const [sortBy, setSortBy] = useState<"turnover_desc" | "turnover_asc" | "stock_desc" | "sales_desc">("turnover_desc");
  const [filterVelocity, setFilterVelocity] = useState<string>("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["inventory-turnover-analytics"],
    queryFn: () => inventoryAnalyticsApi.fetchTurnoverAnalytics(),
    refetchInterval: 5 * 60 * 1000, // Refetch every 5 minutes
  });

  const filteredAndSortedProducts = useMemo(() => {
    if (!data) return [];

    let products = [...data.all_products];

    // Apply velocity filter
    if (filterVelocity !== "all") {
      products = products.filter((p) => p.velocity_class === filterVelocity);
    }

    // Apply sort
    switch (sortBy) {
      case "turnover_desc":
        products.sort((a, b) => b.turnover_ratio - a.turnover_ratio);
        break;
      case "turnover_asc":
        products.sort((a, b) => a.turnover_ratio - b.turnover_ratio);
        break;
      case "stock_desc":
        products.sort((a, b) => b.current_stock - a.current_stock);
        break;
      case "sales_desc":
        products.sort((a, b) => b.units_sold_30d - a.units_sold_30d);
        break;
    }

    return products;
  }, [data, filterVelocity, sortBy]);

  const handleExportReport = () => {
    if (!data) return;

    const csvContent = [
      ["Inventory Turnover Analytics Report"],
      [`Generated: ${data.report_date}`],
      [`Analysis Period: ${data.analysis_period}`],
      [],
      ["Product Name", "Category", "Size", "Units Sold (30d)", "Current Stock", "Turnover Ratio", "Days of Stock", "Velocity", "Action"],
      ...data.all_products.map((p) => [
        p.product_name,
        p.category,
        p.size,
        p.units_sold_30d,
        p.current_stock,
        p.turnover_ratio,
        p.days_of_stock,
        p.velocity_label,
        p.action || "Optimal",
      ]),
    ]
      .map((row) => row.map((cell) => `"${cell}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `inventory-turnover-${localDateKey(new Date())}.csv`;
    link.click();
    toast.success("Report exported successfully");
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-40 bg-white/5 rounded-lg animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-white/5 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-red-500/10 border-red-500/30">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 text-red-400">
            <AlertCircle className="w-5 h-5" />
            <div>
              <p className="font-semibold">Failed to load analytics</p>
              <p className="text-sm text-red-400/70">Please try again or contact support</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return <div className="text-white/60">No data available</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Inventory Turnover Analytics</h2>
          <p className="text-sm text-white/60 mt-1">Monitor stock velocity and identify high-performing items</p>
        </div>
        <Button onClick={handleExportReport} className="bg-white/10 hover:bg-white/20 text-white gap-2">
          <Download className="w-4 h-4" />
          Export Report
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-[#1D1D25] border-white/10">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-white/60 text-sm">Total Products</p>
                <p className="text-3xl font-bold text-white mt-2">{data.total_products}</p>
              </div>
              <Package className="w-8 h-8 text-white/20" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1D1D25] border-white/10">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-white/60 text-sm">Avg Turnover</p>
                <p className="text-3xl font-bold text-white mt-2">{data.avg_turnover_ratio}x</p>
              </div>
              <Zap className="w-8 h-8 text-yellow-500/20" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1D1D25] border-white/10">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-white/60 text-sm">Dead Stock Items</p>
                <p className="text-3xl font-bold text-red-400 mt-2">{data.total_dead_stock}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-red-500/20" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#1D1D25] border-white/10">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-white/60 text-sm">Action Required</p>
                <p className="text-3xl font-bold text-orange-400 mt-2">{data.products_needing_action}</p>
              </div>
              <TrendingUp className="w-8 h-8 text-orange-500/20" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-end">
        <div className="flex-1 max-w-xs">
          <label className="text-xs uppercase tracking-wider text-white/40 mb-2 block">Filter by Velocity</label>
          <Select value={filterVelocity} onValueChange={setFilterVelocity}>
            <SelectTrigger className="bg-[#1D1D25] border-white/10 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#1D1D25] border-white/10">
              <SelectItem value="all">All Products</SelectItem>
              <SelectItem value="high_velocity">High Velocity</SelectItem>
              <SelectItem value="medium_velocity">Medium Velocity</SelectItem>
              <SelectItem value="slow_mover">Slow Movers</SelectItem>
              <SelectItem value="dead_stock">Dead Stock</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex-1 max-w-xs">
          <label className="text-xs uppercase tracking-wider text-white/40 mb-2 block">Sort By</label>
          <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
            <SelectTrigger className="bg-[#1D1D25] border-white/10 text-white">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#1D1D25] border-white/10">
              <SelectItem value="turnover_desc">Turnover Ratio (High to Low)</SelectItem>
              <SelectItem value="turnover_asc">Turnover Ratio (Low to High)</SelectItem>
              <SelectItem value="stock_desc">Current Stock (High to Low)</SelectItem>
              <SelectItem value="sales_desc">Sales Last 30 Days (High to Low)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* High Velocity Products */}
      {data.high_velocity_products.length > 0 && (
        <Card className="bg-[#1D1D25] border-white/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <Zap className="h-4 w-4 text-emerald-400" />
                High Velocity Products ({data.high_velocity_products.length})
              </CardTitle>
              <Badge className="bg-green-500/20 text-green-400 border-green-500/30 border">Best Performers</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ProductTable
              products={data.high_velocity_products}
              emptyMessage="No high velocity products"
              columns={["sales", "stock", "turnover", "days", "action"]}
            />
          </CardContent>
        </Card>
      )}

      {/* Slow Moving Products */}
      {data.slow_moving_products.length > 0 && (
        <Card className="bg-[#1D1D25] border-white/10">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-white flex items-center gap-2">
                <Package className="h-4 w-4 text-yellow-400" />
                Slow Moving Products ({data.slow_moving_products.length})
              </CardTitle>
              <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 border">Consider Promotion</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <ProductTable
              products={data.slow_moving_products}
              emptyMessage="No slow moving products"
              columns={["sales", "stock", "turnover", "days", "recommendation"]}
            />
          </CardContent>
        </Card>
      )}

      {/* Dead Stock */}
      {data.dead_stock_products.length > 0 && (
        <Card className="bg-red-500/10 border-red-500/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-red-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-red-400" />
                Dead Stock Alert ({data.dead_stock_products.length})
              </CardTitle>
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 border">Action Required</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-sm text-red-400/80">
                These products have had no sales in 60+ days. Consider marking them down or discontinuing them.
              </p>
            </div>
            <ProductTable
              products={data.dead_stock_products}
              emptyMessage="No dead stock detected"
              columns={["stock", "days", "action"]}
            />
          </CardContent>
        </Card>
      )}

      {/* Category Breakdown */}
      <Card className="bg-[#1D1D25] border-white/10">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-yellow-400" />
            Category Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10">
                  <TableHead className="text-white/70">Category</TableHead>
                  <TableHead className="text-white/70 text-right">Products</TableHead>
                  <TableHead className="text-white/70 text-right">Units Sold</TableHead>
                  <TableHead className="text-white/70 text-right">Total Sales</TableHead>
                  <TableHead className="text-white/70 text-right">Avg Turnover</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.category_breakdown.map((category) => (
                  <TableRow key={category.name} className="border-white/5 hover:bg-white/5">
                    <TableCell className="text-white font-medium">{category.name}</TableCell>
                    <TableCell className="text-right text-white">{category.product_count}</TableCell>
                    <TableCell className="text-right text-white">{category.total_units}</TableCell>
                    <TableCell className="text-right text-white">{formatPeso(category.total_sales)}</TableCell>
                    <TableCell className="text-right text-white font-semibold">{category.avg_turnover}x</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Footer */}
      <div className="text-xs text-white/40 space-y-1">
        <p>Report generated: {data.report_date}</p>
        <p>Analysis period: {data.analysis_period}</p>
      </div>
    </div>
  );
}
