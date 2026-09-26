import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ??
  "https://vylmcqmxpxqkldosowrs.supabase.co";
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5bG1jcW14cHhxa2xkb3Nvd3JzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NjI0MTAsImV4cCI6MjA5MzAzODQxMH0.NxMMQZ3nFQmpYua-zsd5RNgdaA6zgBIm0XR3NDlds2c";

// Staff session token issued by the login_user RPC. The database resolves the
// signed-in user from this header in its RLS policies, so it must accompany
// every request (REST, RPC and Storage all go through this fetch).
export const APP_SESSION_HEADER = "x-meryl-session";
const APP_SESSION_STORAGE_KEY = "meryl_app_session";

export function getAppSessionToken(): string | null {
  try {
    return typeof window !== "undefined" ? sessionStorage.getItem(APP_SESSION_STORAGE_KEY) : null;
  } catch {
    return null;
  }
}

export function setAppSessionToken(token: string | null | undefined) {
  try {
    if (token) sessionStorage.setItem(APP_SESSION_STORAGE_KEY, token);
    else sessionStorage.removeItem(APP_SESSION_STORAGE_KEY);
  } catch {}
}

// Revokes a token server-side and forgets it locally (only if it is still the
// current one, so a delayed revoke cannot drop a newer login). Uses a direct
// request so the token is captured before it is cleared.
export function revokeAppSession(token: string | null = getAppSessionToken()) {
  if (token && getAppSessionToken() === token) setAppSessionToken(null);
  if (!token) return;
  fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/app_logout`, {
    method: "POST",
    headers: {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseAnonKey}`,
      "Content-Type": "application/json",
      [APP_SESSION_HEADER]: token,
    },
    body: "{}",
    keepalive: true,
  }).catch(() => null);
}

const fetchWithAppSession: typeof fetch = (input, init) => {
  const token = getAppSessionToken();
  if (!token) return fetch(input, init);
  const headers = new Headers(init?.headers);
  headers.set(APP_SESSION_HEADER, token);
  return fetch(input, { ...init, headers });
};

export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseAnonKey,
  {
    global: {
      fetch: fetchWithAppSession,
    },
    auth: {
      // Keep Google/OTP sessions tab-scoped so opening a new tab still shows login.
      storage: typeof window !== "undefined" ? window.sessionStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);
