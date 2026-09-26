import { supabase } from "./supabase";

/**
 * Which bell notifications a user has read or dismissed.
 *
 * Kept in the database (table notification_state, database/notification_state.sql)
 * so it survives reloads, closing the tab and other devices; the app clears
 * browser storage on every load. Until that SQL is run, it falls back to this
 * tab's sessionStorage (kept across reloads, lost when the tab closes).
 */
export type NotificationState = { read: Set<string>; dismissed: Set<string> };

const TABLE = "notification_state";
let tableMissing = false;

function isMissingTable(error: any) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "");
  return code === "42P01" || code === "PGRST205" || (/notification_state/.test(message) && /not find|does not exist/i.test(message));
}

function sessionKey(userId: string) {
  return `bell_state:${userId}`;
}

function readSession(userId: string): NotificationState {
  try {
    const raw = JSON.parse(sessionStorage.getItem(sessionKey(userId)) ?? "{}");
    return { read: new Set(raw.read ?? []), dismissed: new Set(raw.dismissed ?? []) };
  } catch {
    return { read: new Set(), dismissed: new Set() };
  }
}

function writeSession(userId: string, state: NotificationState) {
  try {
    sessionStorage.setItem(
      sessionKey(userId),
      JSON.stringify({ read: Array.from(state.read).slice(-500), dismissed: Array.from(state.dismissed).slice(-500) }),
    );
  } catch {
    // Storage unavailable: state lasts until the page is reloaded.
  }
}

export async function loadNotificationState(userId: string): Promise<NotificationState> {
  if (!tableMissing) {
    const { data, error } = await (supabase as any)
      .from(TABLE)
      .select("notification_key, read_at, dismissed_at")
      .eq("user_id", userId)
      .limit(2000);
    if (!error) {
      const state: NotificationState = { read: new Set(), dismissed: new Set() };
      (data ?? []).forEach((row: any) => {
        if (row.read_at) state.read.add(String(row.notification_key));
        if (row.dismissed_at) state.dismissed.add(String(row.notification_key));
      });
      return state;
    }
    if (isMissingTable(error)) tableMissing = true;
    else console.warn("Could not load notification state:", error.message);
  }
  return readSession(userId);
}

/** Mark notifications read and/or dismissed. */
export async function saveNotificationState(
  userId: string,
  keys: string[],
  change: { read?: boolean; dismissed?: boolean },
  fullState: NotificationState,
) {
  if (!keys.length) return;
  writeSession(userId, fullState);
  if (tableMissing) return;
  const now = new Date().toISOString();
  const rows = keys.map((key) => ({
    user_id: userId,
    notification_key: key,
    ...(change.read ? { read_at: now } : {}),
    ...(change.dismissed ? { dismissed_at: now } : {}),
  }));
  const { error } = await (supabase as any).from(TABLE).upsert(rows, { onConflict: "user_id,notification_key" });
  if (error) {
    if (isMissingTable(error)) tableMissing = true;
    else console.warn("Could not save notification state:", error.message);
  }
}

/** Bring every dismissed notification back. */
export async function restoreDismissedNotifications(userId: string, fullState: NotificationState) {
  writeSession(userId, fullState);
  if (tableMissing) return;
  const { error } = await (supabase as any)
    .from(TABLE)
    .update({ dismissed_at: null })
    .eq("user_id", userId)
    .not("dismissed_at", "is", null);
  if (error && !isMissingTable(error)) console.warn("Could not restore notifications:", error.message);
}
