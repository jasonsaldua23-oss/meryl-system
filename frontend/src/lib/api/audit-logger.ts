import { supabase } from "../supabase";
import { MERYL_USER_STORAGE_KEY } from "../auth-context";

export type AuditActionType =
  | "AUTH_LOGIN"
  | "AUTH_FAILED_LOGIN"
  | "AUTH_ACCOUNT_LOCKED"
  | "AUTH_LOGOUT"
  | "TERMINAL_AUTO_LOCKED"
  | "TERMINAL_UNLOCKED"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "PRODUCT_ARCHIVED"
  | "PRICE_ADJUSTED"
  | "STOCK_ADJUSTED"
  | "POS_SALE_COMPLETED"
  | "POS_MANAGER_OVERRIDE"
  | "RETURN_PROCESSED";

export type AuditLogEntry = {
  action_type: AuditActionType | string;
  entity_type: string;
  entity_id?: string | null;
  old_data?: any;
  new_data?: any;
  metadata?: any;
  actor_user_id?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  created_at?: string;
};

const LOCAL_AUDIT_LOG_KEY = "meryl_local_audit_log";
const memoryAuditLogs: AuditLogEntry[] = [];

// Clean up any legacy localStorage entry immediately
if (typeof window !== "undefined") {
  try {
    localStorage.removeItem(LOCAL_AUDIT_LOG_KEY);
  } catch {}
}

function getLocalAuditLogs(): AuditLogEntry[] {
  return [...memoryAuditLogs];
}

function saveLocalAuditLog(entry: AuditLogEntry) {
  memoryAuditLogs.unshift(entry);
  if (memoryAuditLogs.length > 200) {
    memoryAuditLogs.pop();
  }
}

export async function logAuditEvent(entry: {
  action_type: AuditActionType | string;
  entity_type: string;
  entity_id?: string | null;
  old_data?: any;
  new_data?: any;
  metadata?: any;
}): Promise<void> {
  // 1. Resolve current actor from session
  let actorId: string | null = null;
  let actorName: string | null = "System";
  let actorRole: string | null = "System";

  try {
    const rawUser = sessionStorage.getItem(MERYL_USER_STORAGE_KEY);
    if (rawUser) {
      const user = JSON.parse(rawUser);
      actorId = user.user_id || user.id || null;
      actorName = user.name || user.username || "User";
      actorRole = user.role_name || "Staff";
    }
  } catch {
    // Non-blocking
  }

  const enrichedEntry: AuditLogEntry = {
    ...entry,
    actor_user_id: actorId,
    actor_name: actorName,
    actor_role: actorRole,
    created_at: new Date().toISOString(),
    metadata: {
      ...(entry.metadata || {}),
      actor_name: actorName,
      actor_role: actorRole,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "browser",
    },
  };

  // Always save to local buffer first
  saveLocalAuditLog(enrichedEntry);

  // 2. Attempt to write to Supabase public.audit_log
  try {
    const payload: any = {
      action_type: entry.action_type,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id || null,
      old_data: entry.old_data || null,
      new_data: entry.new_data || null,
      metadata: enrichedEntry.metadata,
    };
    if (actorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)) {
      payload.actor_user_id = actorId;
    }

    const { error } = await supabase.from("audit_log").insert(payload);
    if (error) {
      // Table may not exist yet or RPC alternative. Query builders are
      // thenables without .catch(), so errors are read from the result.
      await (supabase as any).rpc("write_audit_log", {
        p_actor_user_id: payload.actor_user_id || null,
        p_action_type: payload.action_type,
        p_entity_type: payload.entity_type,
        p_entity_id: payload.entity_id,
        p_old_data: payload.old_data,
        p_new_data: payload.new_data,
        p_metadata: payload.metadata,
      });
    }
  } catch {
    // Network or storage error: resiliently absorbed, already saved in local buffer
  }
}

export async function fetchAuditLogs(limit: number = 100): Promise<AuditLogEntry[]> {
  try {
    const { data, error } = await supabase
      .from("audit_log")
      .select("*, actor:user(name, username, role_id)")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!error && data && data.length > 0) {
      return data.map((row: any) => ({
        ...row,
        action_type: String(row.action_type || row.action || "SYSTEM_EVENT").toUpperCase(),
        entity_type: String(row.entity_type || row.entity || "SYSTEM"),
        actor_name: row.metadata?.actor_name || row.actor?.name || row.actor?.username || "Staff",
        actor_role: row.metadata?.actor_role || "Staff",
      }));
    }

    if (error) {
      const fallback = await supabase
        .from("audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!fallback.error && fallback.data && fallback.data.length > 0) {
        return fallback.data.map((row: any) => ({
          ...row,
          action_type: String(row.action_type || row.action || "SYSTEM_EVENT").toUpperCase(),
          entity_type: String(row.entity_type || row.entity || "SYSTEM"),
          actor_name: row.metadata?.actor_name || "Staff",
          actor_role: row.metadata?.actor_role || "Staff",
        }));
      }
    }
  } catch {
    // Fall back to local buffer
  }

  // Fallback to local storage logs
  const local = getLocalAuditLogs();
  return (local || []).map((entry: any) => ({
    ...entry,
    action_type: String(entry.action_type || entry.action || "SYSTEM_EVENT").toUpperCase(),
    entity_type: String(entry.entity_type || entry.entity || "SYSTEM"),
  })).slice(0, limit);
}

