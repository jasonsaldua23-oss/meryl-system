import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bell, X, AlertTriangle, Calendar, Package, TrendingUp, Info, Mail } from "lucide-react";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { useNotifications, useProducts, usePromotions, useSales } from "../../lib/hooks";
import { useAuth } from "../../lib/auth-context";
import { isPromotionLive, promotionBoundaryMs, promotionDisplayName } from "../../lib/promotion-rules";
import { shortId } from "./ui/utils";
import {
  loadNotificationState,
  rememberNotificationStateInTab,
  restoreDismissedNotifications,
  saveNotificationState,
} from "../../lib/notification-state";

type Category = "stock" | "sales" | "promotion" | "email";

interface NotificationItem {
  id: string;
  type: "warning" | "info" | "critical" | "success";
  category: Category;
  title: string;
  message: string;
  timestamp: Date;
}

const CATEGORY_LABELS: Record<Category, string> = {
  stock: "Stock",
  sales: "Sales",
  promotion: "Promotions",
  email: "Promotion emails",
};


function asDate(value: string | null | undefined) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function latestDate(...values: Array<string | null | undefined>) {
  const dates = values.map(asDate).filter((date): date is Date => Boolean(date));
  if (!dates.length) return null;
  return dates.sort((a, b) => b.getTime() - a.getTime())[0];
}

function compactParts(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => String(part ?? "").trim())
    .filter((part) => part && part.toLowerCase() !== "n/a" && part.toLowerCase() !== "default");
}

function stockVariantLabel(product: any) {
  const name = String(product?.product_name ?? "Unknown Product").trim();
  const brand = String(product?.brand ?? "").trim();
  const sku = String(product?.sku ?? product?.product_id ?? "").trim();
  const variant = compactParts([product?.color, product?.gender, product?.size ? `Size ${product.size}` : null]);
  const variantText = variant.length ? ` - ${variant.join(" / ")}` : "";
  const skuText = sku ? ` (${shortId(sku)})` : "";
  return `${brand ? `${brand} ` : ""}${name}${variantText}${skuText}`;
}

/** How often read/dismissed state is re-read, for changes made on other devices. */
const STATE_POLL_MS = 10_000;

function formatTimestamp(date: Date) {
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const ICONS: Record<Category, ReactNode> = {
  stock: <Package className="w-4 h-4" />,
  sales: <TrendingUp className="w-4 h-4" />,
  promotion: <Calendar className="w-4 h-4" />,
  email: <Mail className="w-4 h-4" />,
};

function typeColor(type: NotificationItem["type"]) {
  switch (type) {
    case "critical":
      return "bg-red-900 text-yellow-200 border-red-800";
    case "warning":
      return "bg-red-800 text-yellow-200 border-red-700";
    case "success":
      return "bg-green-900 text-yellow-200 border-green-800";
    default:
      return "bg-red-700 text-yellow-200 border-red-600";
  }
}

export function NotificationCenter() {
  const { user } = useAuth();
  const userId = user?.user_id ?? "";

  const [isOpen, setIsOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread" | Category>("all");
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  // Re-render every minute so "5m ago" stays current while the page is open.
  const [, setTick] = useState(0);

  // Read / dismissed state is saved per user in the database, so it survives
  // reloads, closing the tab and other devices. Other open tabs get changes
  // instantly (BroadcastChannel); other devices within STATE_POLL_MS.
  const lastLocalChange = useRef(0);
  const channel = useRef<BroadcastChannel | null>(null);

  const refreshState = useCallback(async () => {
    if (!userId) return;
    const started = Date.now();
    const state = await loadNotificationState(userId);
    // Don't overwrite a click made while this request was in flight.
    if (lastLocalChange.current >= started - 1500) return;
    setReadIds(state.read);
    setDismissedIds(state.dismissed);
  }, [userId]);

  useEffect(() => {
    setReadIds(new Set());
    setDismissedIds(new Set());
    lastLocalChange.current = 0;
    if (!userId) return;
    void refreshState();

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("meryl_bell_state");
      bc.onmessage = (event) => {
        const data = event.data;
        if (data?.userId !== userId) return;
        lastLocalChange.current = Date.now();
        const state = { read: new Set<string>(data.read), dismissed: new Set<string>(data.dismissed) };
        rememberNotificationStateInTab(userId, state);
        setReadIds(state.read);
        setDismissedIds(state.dismissed);
      };
    } catch {
      bc = null;
    }
    channel.current = bc;

    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void refreshState();
    };
    const timer = window.setInterval(refreshIfVisible, STATE_POLL_MS);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
      bc?.close();
      channel.current = null;
    };
  }, [refreshState, userId]);

  /** Apply a change here, tell the other tabs, and save it. */
  const applyLocal = (read: Set<string>, dismissed: Set<string>) => {
    lastLocalChange.current = Date.now();
    setReadIds(read);
    setDismissedIds(dismissed);
    try {
      channel.current?.postMessage({ userId, read: Array.from(read), dismissed: Array.from(dismissed) });
    } catch {
      // Other tabs catch up on their next refresh.
    }
  };
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  const salesQuery = useSales();
  const productsQuery = useProducts();
  const promotionsQuery = usePromotions();
  const notificationsQuery = useNotifications();

  const sales = (salesQuery.data as any[]) ?? [];
  const products = (productsQuery.data as any[]) ?? [];
  const promotions = (promotionsQuery.data as any[]) ?? [];
  const emailRows = (notificationsQuery.data as any[]) ?? [];

  const allNotifications = useMemo(() => {
    const now = new Date();
    const items: NotificationItem[] = [];

    // Low stock alerts (manuscript 1.7): variants at or below their reorder level.
    const lowStock = products
      .map((p) => {
        const inventory = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
        return {
          productId: String(p.product_id ?? p.id ?? p.sku ?? p.product_name ?? "product"),
          label: stockVariantLabel(p),
          stock: Number(inventory?.stock_quantity ?? 0),
          reorder: Number(p.reorder_level ?? inventory?.reorder_level ?? 10),
          status: String(p.status ?? "active").toLowerCase(),
          eventDate: latestDate(inventory?.last_updated, inventory?.updated_at, p.updated_at, p.created_at) ?? now,
        };
      })
      .filter((x) => (x.status === "active" || x.status === "available") && x.stock <= x.reorder);

    lowStock
      .filter((x) => x.stock <= Math.max(2, Math.floor(x.reorder * 0.4)))
      .sort((a, b) => a.stock - b.stock || b.eventDate.getTime() - a.eventDate.getTime())
      .slice(0, 5)
      .forEach((x) => {
        items.push({
          id: `stock-critical-${x.productId}-${x.stock}`,
          type: "critical",
          category: "stock",
          title: x.stock === 0 ? "Out of Stock" : "Critical Stock Alert",
          message:
            x.stock === 0
              ? `${x.label} is out of stock (reorder level ${x.reorder}).`
              : `${x.label} has only ${x.stock} pair${x.stock === 1 ? "" : "s"} left (reorder level ${x.reorder}).`,
          timestamp: x.eventDate,
        });
      });
    if (lowStock.length > 0) {
      const latest = [...lowStock].sort((a, b) => b.eventDate.getTime() - a.eventDate.getTime())[0];
      items.push({
        id: `stock-low-summary-${lowStock.length}-${latest.productId}-${latest.stock}`,
        type: "warning",
        category: "stock",
        title: "Low Stock Warning",
        message: `${lowStock.length} variant${lowStock.length === 1 ? " is" : "s are"} at or below reorder level. Latest: ${latest.label} (${latest.stock}/${latest.reorder}).`,
        timestamp: latest.eventDate,
      });
    }

    // Busy day: 5+ completed sales in the last 24 hours.
    const recentSales = sales
      .map((s) => ({
        date: asDate(s.transaction_date ?? s.created_at),
        status: String((Array.isArray(s.payment) ? s.payment[0] : s.payment)?.payment_status ?? "completed").toLowerCase(),
      }))
      .filter((s) => s.date && s.status === "completed" && now.getTime() - s.date.getTime() <= 24 * 3600000)
      .sort((a, b) => b.date!.getTime() - a.date!.getTime());
    if (recentSales.length >= 5) {
      items.push({
        id: `sales-high-${recentSales[0].date!.toISOString().slice(0, 10)}`,
        type: "success",
        category: "sales",
        title: "High Sales Activity",
        message: `${recentSales.length} completed sales in the last 24 hours.`,
        timestamp: recentSales[0].date!,
      });
    }

    // Promotions starting now or ending within 48 hours.
    promotions.forEach((promo) => {
      const name = promotionDisplayName(promo);
      const id = String(promo.promo_id ?? name);
      if (!isPromotionLive(promo, now.getTime())) return;
      const start = promotionBoundaryMs(promo.start_date, "start");
      const end = promotionBoundaryMs(promo.end_date, "end");
      if (Number.isFinite(start) && now.getTime() - start <= 24 * 3600000) {
        items.push({
          id: `promo-live-${id}`,
          type: "info",
          category: "promotion",
          title: "Promotion Now Live",
          message: `${name} is running at the POS.`,
          timestamp: new Date(start),
        });
      }
      if (Number.isFinite(end) && end - now.getTime() <= 48 * 3600000) {
        const hoursLeft = Math.max(1, Math.round((end - now.getTime()) / 3600000));
        items.push({
          id: `promo-ending-${id}`,
          type: "warning",
          category: "promotion",
          title: "Promotion Ending Soon",
          message: `${name} ends in about ${hoursLeft} hour${hoursLeft === 1 ? "" : "s"}.`,
          timestamp: new Date(Math.max(start || 0, end - 48 * 3600000)),
        });
      }
    });

    // Promotion email results (Use Case 9, Scenario 2): one summary per campaign
    // instead of one row per customer email.
    const byPromo = new Map<string, { name: string; sent: number; failed: number; pending: number; latest: Date }>();
    emailRows.forEach((row) => {
      const promoId = String(row.promo_id ?? "");
      if (!promoId) return;
      const promo = Array.isArray(row.promotion) ? row.promotion[0] : row.promotion;
      const entry = byPromo.get(promoId) ?? {
        name: promo ? promotionDisplayName(promo) : "A promotion",
        sent: 0,
        failed: 0,
        pending: 0,
        latest: new Date(0),
      };
      const status = String(row.email_status ?? "").toLowerCase();
      if (status === "sent" || status === "delivered") entry.sent += 1;
      else if (status === "failed" || status === "error" || status === "bounced") entry.failed += 1;
      else entry.pending += 1;
      const when = asDate(row.date_sent ?? row.created_at);
      if (when && when > entry.latest) entry.latest = when;
      byPromo.set(promoId, entry);
    });
    byPromo.forEach((entry, promoId) => {
      if (entry.sent + entry.failed === 0) return; // nothing dispatched yet
      const parts = [`${entry.sent} sent`];
      if (entry.failed) parts.push(`${entry.failed} failed`);
      if (entry.pending) parts.push(`${entry.pending} not sent yet`);
      items.push({
        id: `promo-email-${promoId}-${entry.sent}-${entry.failed}`,
        type: entry.failed ? "warning" : "success",
        category: "email",
        title: entry.failed ? "Some Promotion Emails Failed" : "Promotion Emails Sent",
        message: `${entry.name}: ${parts.join(", ")}.`,
        timestamp: entry.latest.getTime() > 0 ? entry.latest : now,
      });
    });

    return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [products, sales, promotions, emailRows]);

  const notifications = useMemo(
    () => allNotifications.filter((n) => !dismissedIds.has(n.id)),
    [allNotifications, dismissedIds],
  );
  const unreadCount = notifications.filter((n) => !readIds.has(n.id)).length;

  const filtered = useMemo(
    () =>
      notifications.filter((n) =>
        filter === "all" ? true : filter === "unread" ? !readIds.has(n.id) : n.category === filter,
      ),
    [filter, notifications, readIds],
  );

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  const markRead = (ids: string[]) => {
    const fresh = ids.filter((id) => !readIds.has(id));
    if (!fresh.length) return;
    const next = new Set([...readIds, ...fresh]);
    applyLocal(next, dismissedIds);
    if (userId) void saveNotificationState(userId, fresh, { read: true }, { read: next, dismissed: dismissedIds });
  };
  const markAsRead = (id: string) => markRead([id]);
  const markAllAsRead = () => markRead(notifications.map((n) => n.id));
  const dismiss = (id: string) => {
    const next = new Set(dismissedIds).add(id);
    applyLocal(readIds, next);
    if (userId) void saveNotificationState(userId, [id], { dismissed: true }, { read: readIds, dismissed: next });
  };
  const restoreDismissed = () => {
    applyLocal(readIds, new Set());
    if (userId) void restoreDismissedNotifications(userId, { read: readIds, dismissed: new Set() });
  };

  const renderItem = (notification: NotificationItem) => {
    const unread = !readIds.has(notification.id);
    return (
      <div
        key={notification.id}
        className={`p-3 rounded-lg border-2 ${typeColor(notification.type)} ${
          unread ? "border-l-4 border-l-yellow-400" : "opacity-80"
        } hover:bg-red-600 transition-colors cursor-pointer`}
        onClick={() => markAsRead(notification.id)}
      >
        <div className="flex gap-3">
          <div className="flex-shrink-0 mt-1">{ICONS[notification.category] ?? <Info className="w-4 h-4" />}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h4 className="text-yellow-300 text-sm font-semibold">{notification.title}</h4>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  dismiss(notification.id);
                }}
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0 hover:bg-red-900"
                aria-label="Dismiss notification"
              >
                <X className="w-3 h-3 text-yellow-200" />
              </Button>
            </div>
            <p className="text-yellow-200 text-xs mb-2">{notification.message}</p>
            <div className="flex items-center justify-between">
              <span className="text-yellow-300 text-xs opacity-75" title={notification.timestamp.toLocaleString()}>
                {formatTimestamp(notification.timestamp)} · {CATEGORY_LABELS[notification.category]}
              </span>
              {notification.type === "critical" && (
                <Badge className="bg-red-950 text-yellow-300 border-red-800 text-xs">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Critical
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const emptyState = (text: string) => (
    <div className="text-center py-8 text-yellow-200">
      <Bell className="w-12 h-12 mx-auto mb-2 opacity-50" />
      <p>{text}</p>
    </div>
  );

  const filterOptions: Array<["all" | "unread" | Category, string, number]> = [
    ["all", "All", notifications.length],
    ["unread", "Unread", unreadCount],
    ...(Object.keys(CATEGORY_LABELS) as Category[]).map(
      (category) => [category, CATEGORY_LABELS[category], notifications.filter((n) => n.category === category).length] as ["all" | "unread" | Category, string, number],
    ),
  ];

  return (
    <div className="relative">
      <Button
        onClick={() => setIsOpen((open) => !open)}
        variant="ghost"
        className="relative hover:bg-red-800 text-yellow-300"
        aria-expanded={isOpen}
        aria-label="Open notifications"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <div className="absolute -top-1 -right-1 bg-yellow-400 text-red-900 text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
            {unreadCount > 9 ? "9+" : unreadCount}
          </div>
        )}
      </Button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />

          <div className="fixed right-4 top-20 z-50 w-[calc(100vw-2rem)] max-w-96 bg-red-700 border-2 border-red-800 rounded-lg shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-red-800">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-yellow-400" />
                <h3 className="text-yellow-300 font-semibold">Notifications</h3>
                {unreadCount > 0 && <Badge className="bg-yellow-400 text-red-900">{unreadCount} new</Badge>}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <Button onClick={markAllAsRead} variant="ghost" size="sm" className="text-yellow-300 hover:text-yellow-100 hover:bg-red-800 text-xs">
                    Mark all read
                  </Button>
                )}
                <Button onClick={() => setIsOpen(false)} variant="ghost" size="sm" className="text-yellow-300 hover:text-yellow-100 hover:bg-red-800" aria-label="Close notifications">
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="max-h-[min(500px,calc(100vh-14rem))] overflow-y-auto">
              <div className="p-2">
                {notifications.length === 0 ? (
                  emptyState("You're all caught up")
                ) : (
                  <div className="space-y-2">{notifications.slice(0, 8).map(renderItem)}</div>
                )}
              </div>
            </div>

            <div className="p-3 border-t border-red-800 bg-red-800">
              <Button
                variant="ghost"
                className="w-full text-yellow-300 hover:text-yellow-100 hover:bg-red-700 text-sm"
                onClick={() => {
                  setIsOpen(false);
                  setFilter("all");
                  setShowAll(true);
                }}
              >
                View All Notifications{notifications.length > 8 ? ` (${notifications.length})` : ""}
              </Button>
            </div>
          </div>
        </>
      )}

      <Dialog open={showAll} onOpenChange={setShowAll}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bell className="w-5 h-5 text-yellow-400" />
              All Notifications
            </DialogTitle>
            <DialogDescription>
              Stock alerts, sales activity, promotions and promotion email results. Updates every few seconds.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-center gap-1.5">
            {filterOptions.map(([id, label, count]) => (
              <button
                key={id}
                type="button"
                onClick={() => setFilter(id)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                  filter === id ? "border-yellow-400 bg-yellow-400/10 text-yellow-200" : "border-zinc-700 text-zinc-300 hover:border-yellow-400/50"
                }`}
              >
                {label} <span className="opacity-60">{count}</span>
              </button>
            ))}
            <div className="ml-auto flex gap-1">
              {unreadCount > 0 && (
                <Button variant="ghost" size="sm" className="text-xs text-yellow-300" onClick={markAllAsRead}>
                  Mark all read
                </Button>
              )}
              {dismissedIds.size > 0 && (
                <Button variant="ghost" size="sm" className="text-xs text-zinc-400" onClick={restoreDismissed}>
                  Restore dismissed
                </Button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              emptyState(filter === "unread" ? "No unread notifications" : "No notifications here")
            ) : (
              <div className="space-y-2">{filtered.map(renderItem)}</div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
