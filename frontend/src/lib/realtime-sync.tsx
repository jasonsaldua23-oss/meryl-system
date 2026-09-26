import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";

const CROSS_TAB_CHANNEL_NAME = "meryl_cross_tab_sync";

let crossTabChannel: BroadcastChannel | null = null;
if (typeof window !== "undefined" && "BroadcastChannel" in window) {
  try {
    crossTabChannel = new BroadcastChannel(CROSS_TAB_CHANNEL_NAME);
  } catch {
    crossTabChannel = null;
  }
}

/**
 * Broadcasts query invalidation to all other open tabs in the same browser.
 */
export function broadcastQueryInvalidation(keys: string[]) {
  if (crossTabChannel && keys.length > 0) {
    try {
      crossTabChannel.postMessage({ type: "INVALIDATE_QUERIES", keys });
    } catch {}
  }
}

/**
 * Global Realtime Sync listener that subscribes to:
 * 1. Cross-tab BroadcastChannel events (zero-latency sync across tabs on same machine)
 * 2. Supabase Realtime PostgreSQL change events (cross-device cloud sync)
 * 3. Visibility-aware gentle polling fallback (fail-safe for dropped connections)
 */
export function RealtimeSyncListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // 1. Cross-Tab Synchronization (Instant updates across open browser tabs)
    const handleBroadcastMessage = (event: MessageEvent) => {
      try {
        if (event.data?.type === "INVALIDATE_QUERIES" && Array.isArray(event.data.keys)) {
          event.data.keys.forEach((key: string) => {
            queryClient.invalidateQueries({ queryKey: [key] });
          });
        }
      } catch {}
    };

    if (crossTabChannel) {
      crossTabChannel.addEventListener("message", handleBroadcastMessage);
    }

    // 2. Supabase Realtime WebSocket Synchronization (Cross-device sync)
    const invalidateKeys = (keys: string[]) => {
      keys.forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
      broadcastQueryInvalidation(keys);
    };

    const realtimeChannel = supabase
      .channel("meryl-realtime-global-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_transaction" },
        () => invalidateKeys(["sales", "analytics", "inventory"])
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sales_details" },
        () => invalidateKeys(["sales", "inventory", "products"])
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory" },
        () => invalidateKeys(["inventory", "products", "inventory_log", "inventoryLog"])
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory_log" },
        () => invalidateKeys(["inventory_log", "inventoryLog", "inventory"])
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product" },
        () => invalidateKeys(["products", "inventory"])
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "customer" },
        () => invalidateKeys(["customers"])
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payment" },
        () => invalidateKeys(["payments", "sales"])
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "returns" },
        () => invalidateKeys(["returns", "inventory", "sales"])
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "return_details" },
        () => invalidateKeys(["returns", "inventory"])
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "promotion" },
        () => invalidateKeys(["promotions"])
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notification" },
        () => invalidateKeys(["notifications"])
      )
      .subscribe();

    // 3. Fallback Smart Polling (runs every 10 seconds only when tab is visible).
    // Realtime change events are filtered by RLS using the Supabase JWT, so
    // username/password sessions (identified by the x-meryl-session header)
    // rely on this polling for cross-device updates.
    // Every query on screen is refreshed (inventory log, payments, users,
    // categories, analytics... not just a fixed list); hidden ones stay cached.
    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        queryClient.invalidateQueries({ refetchType: "active" });
      }
    }, 10000);

    return () => {
      clearInterval(interval);
      if (crossTabChannel) {
        crossTabChannel.removeEventListener("message", handleBroadcastMessage);
      }
      try {
        supabase.removeChannel(realtimeChannel);
      } catch {}
    };
  }, [queryClient]);

  return null;
}

