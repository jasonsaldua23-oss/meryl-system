import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  APP_SESSION_HEADER,
  getAppSessionToken,
  revokeAppSession,
  setAppSessionToken,
  supabase,
} from "./supabase";
import { logAuditEvent } from "./api/audit-logger";
import {
  getStoredAvatarSync,
  getStoredAvatarAsync,
  saveStoredAvatar,
  purgeLocalStorageSensitiveData,
} from "./avatar-store";

export const MERYL_USER_STORAGE_KEY = "meryl_user";
export const MERYL_TERMINAL_LOCKED_KEY = "meryl_terminal_locked";
export const MERYL_FAILED_ATTEMPTS_PREFIX = "meryl_failed_attempts_";
export const MAX_LOGIN_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 5 * 60 * 1000; // 5 minutes lockout
export const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes terminal inactivity
const GOOGLE_OTP_VERIFIED_EMAIL_KEY = "meryl_google_otp_verified_email";
export const BACKEND_BASE = (
  import.meta.env.VITE_API_URL ||
  (typeof window !== "undefined" &&
  (window.location.hostname.includes("merylshoesbacolod.shop") ||
   window.location.hostname.includes("hostinger"))
    ? "https://meryl-system.onrender.com"
    : "")
).replace(/\/$/, "");

/**
 * Proof of identity for the Flask backend: the staff session token for
 * password logins, or the Supabase access token for Google/OTP logins.
 */
export async function getBackendAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const appToken = getAppSessionToken();
  if (appToken) headers[APP_SESSION_HEADER] = appToken;
  try {
    const { data } = await supabase.auth.getSession();
    if (data?.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
  } catch {}
  return headers;
}

async function syncBackendSession() {
  try {
    const authHeaders = await getBackendAuthHeaders();
    if (Object.keys(authHeaders).length === 0) return;
    await fetch(`${BACKEND_BASE}/api/auth/sync-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      credentials: "include",
      body: "{}",
    });
  } catch {}
}

async function callLoginRpc(username: string, password: string, issueSession: boolean) {
  const rpc = (supabase as any).rpc.bind(supabase);
  if (!issueSession) {
    const result = await rpc("login_user", {
      p_username: username,
      p_password: password,
      p_issue_session: false,
    });
    // Databases without the phase 4 migration only have the 2-argument version.
    if (!result.error || result.error.code !== "PGRST202") return result;
  }
  return rpc("login_user", { p_username: username, p_password: password });
}

export type AuthUser = {
  user_id: string;
  name: string;
  username: string;
  email?: string;
  role_id: string;
  role_name: string;
  status: string;
  avatar_url?: string;
  staff_code?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  isLocked: boolean;
  lockTerminal: () => void;
  unlockTerminal: (password: string) => Promise<boolean>;
  checkLockoutStatus: (username: string) => { isLocked: boolean; remainingSeconds: number };
  login: (username: string, password: string) => Promise<AuthUser | null>;
  validateCredentials: (
    username: string,
    password: string,
    options?: { issueSession?: boolean }
  ) => Promise<AuthUser | null>;
  setCurrentUser: (user: AuthUser) => void;
  signInWithGoogle: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ ok?: boolean; message?: string } | void>;
  updatePasswordAfterRecovery: (newPassword: string) => Promise<void>;
  verifyPasswordResetOtpAndUpdate: (
    email: string,
    otp: string,
    newPassword: string,
    options?: { keepSession?: boolean }
  ) => Promise<void>;
  requestEmailOtp: (email: string) => Promise<void>;
  completeExternalAuth: (options?: { persist?: boolean; bypassOtpGate?: boolean }) => Promise<AuthUser | null>;
  markGoogleOtpVerified: (email: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const failedAttemptsMemory = new Map<string, { count: number; lockedUntil: number }>();

export const ENCRYPTED_SESSION_KEY = "_sec_session_state";

function encryptSessionPayload(plainText: string): string {
  try {
    const salt = "Meryl_Secure_2026";
    let output = "";
    for (let i = 0; i < plainText.length; i++) {
      output += String.fromCharCode(plainText.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
    }
    return "enc." + btoa(encodeURIComponent(output));
  } catch {
    return "";
  }
}

function decryptSessionPayload(cipherText: string): string | null {
  try {
    if (!cipherText || !cipherText.startsWith("enc.")) return null;
    const raw = decodeURIComponent(atob(cipherText.substring(4)));
    const salt = "Meryl_Secure_2026";
    let output = "";
    for (let i = 0; i < raw.length; i++) {
      output += String.fromCharCode(raw.charCodeAt(i) ^ salt.charCodeAt(i % salt.length));
    }
    return output;
  } catch {
    return null;
  }
}

export function getFailedAttempts(username: string): { count: number; lockedUntil: number } {
  const clean = username.trim().toLowerCase();
  if (!clean) return { count: 0, lockedUntil: 0 };
  return failedAttemptsMemory.get(clean) || { count: 0, lockedUntil: 0 };
}

export function recordFailedAttempt(username: string): { count: number; lockedUntil: number; isLocked: boolean } {
  const clean = username.trim().toLowerCase();
  if (!clean) return { count: 0, lockedUntil: 0, isLocked: false };
  const current = getFailedAttempts(clean);
  const now = Date.now();
  const count = (current.lockedUntil && now > current.lockedUntil) ? 1 : current.count + 1;
  const isLocked = count >= MAX_LOGIN_ATTEMPTS;
  const lockedUntil = isLocked ? now + LOCKOUT_DURATION_MS : 0;
  const record = { count, lockedUntil };
  failedAttemptsMemory.set(clean, record);

  // Clean up any legacy localStorage key
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(`${MERYL_FAILED_ATTEMPTS_PREFIX}${clean}`);
    } catch {}
  }
  return { count, lockedUntil, isLocked };
}

export function clearFailedAttempts(username: string): void {
  const clean = username.trim().toLowerCase();
  if (!clean) return;
  failedAttemptsMemory.delete(clean);
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(`${MERYL_FAILED_ATTEMPTS_PREFIX}${clean}`);
    } catch {}
  }
}

export function checkLockoutStatus(username: string): { isLocked: boolean; remainingSeconds: number } {
  const clean = username.trim().toLowerCase();
  if (!clean) return { isLocked: false, remainingSeconds: 0 };
  const info = getFailedAttempts(clean);
  const now = Date.now();
  if (info.lockedUntil && info.lockedUntil > now) {
    return { isLocked: true, remainingSeconds: Math.ceil((info.lockedUntil - now) / 1000) };
  }
  return { isLocked: false, remainingSeconds: 0 };
}

function readStoredUser(): AuthUser | null {
  try {
    if (typeof sessionStorage === "undefined") return null;
    
    // Purge legacy plaintext keys
    sessionStorage.removeItem("meryl_user");
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem("meryl_user");
    }

    const encrypted = sessionStorage.getItem(ENCRYPTED_SESSION_KEY);
    if (!encrypted) return null;

    const decrypted = decryptSessionPayload(encrypted);
    if (!decrypted) return null;

    const user = JSON.parse(decrypted) as AuthUser;
    if (user && typeof window !== "undefined") {
      const persistedAvatar = getStoredAvatarSync({
        userId: user.user_id,
        username: user.username,
        email: user.email,
      });
      if (persistedAvatar) {
        user.avatar_url = persistedAvatar;
      }
    }
    return user;
  } catch {
    return null;
  }
}

function writeStoredUser(authUser: AuthUser) {
  if (typeof window !== "undefined") {
    if (authUser.avatar_url) {
      saveStoredAvatar(
        {
          userId: authUser.user_id,
          username: authUser.username,
          email: authUser.email,
        },
        authUser.avatar_url
      );
    } else {
      // NEVER delete avatar on login or user write! Backfill from persistent avatar store instead.
      const existing = getStoredAvatarSync({
        userId: authUser.user_id,
        username: authUser.username,
        email: authUser.email,
      });
      if (existing) {
        authUser.avatar_url = existing;
      }
    }
    try {
      // Encrypt user session payload before writing to sessionStorage
      const encrypted = encryptSessionPayload(JSON.stringify(authUser));
      sessionStorage.setItem(ENCRYPTED_SESSION_KEY, encrypted);
      // Ensure plaintext keys are never present
      sessionStorage.removeItem(MERYL_USER_STORAGE_KEY);
      localStorage.removeItem(MERYL_USER_STORAGE_KEY);
    } catch {}
  }
}

export function clearStoredUser() {
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(ENCRYPTED_SESSION_KEY);
    sessionStorage.removeItem(MERYL_USER_STORAGE_KEY);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(MERYL_USER_STORAGE_KEY);
  }
}

function getVerifiedGoogleOtpEmail() {
  return sessionStorage.getItem(GOOGLE_OTP_VERIFIED_EMAIL_KEY)?.trim().toLowerCase() ?? "";
}

function markGoogleOtpVerifiedEmail(email: string) {
  sessionStorage.setItem(GOOGLE_OTP_VERIFIED_EMAIL_KEY, email.trim().toLowerCase());
}

function clearGoogleOtpVerifiedEmail() {
  sessionStorage.removeItem(GOOGLE_OTP_VERIFIED_EMAIL_KEY);
}

export function getRoleGroup(roleName?: string | null) {
  const normalizedRole = String(roleName ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");

  if (["admin", "administrator", "owner", "admin owner", "admin/owner"].includes(normalizedRole)) {
    return "admin";
  }

  if (["sales", "sales staff", "cashier", "cashier staff", "sales cashier"].includes(normalizedRole)) {
    return "sales";
  }

  if (["inventory", "inventory staff", "stock staff", "warehouse staff"].includes(normalizedRole)) {
    return "inventory";
  }

  return "";
}

function isAuthorizedAppUser(authUser: AuthUser | null) {
  if (!authUser) return false;
  if (String(authUser.status ?? "").trim().toLowerCase() !== "active") return false;
  return Boolean(getRoleGroup(authUser.role_name));
}

export function getPostLoginPath(authUser: AuthUser | null) {
  const roleGroup = getRoleGroup(authUser?.role_name);
  if (roleGroup === "admin") return "/admin";
  if (roleGroup === "sales") return "/sales";
  if (roleGroup === "inventory") return "/inventory";
  return "/";
}

async function findAppUserByEmail(email: string): Promise<AuthUser | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  try {
    const { data, error } = await supabase.rpc("login_user_by_email", {
      p_email: normalizedEmail,
    });

    if (!error && data) {
      const authUser = data as AuthUser;
      return isAuthorizedAppUser(authUser) ? authUser : null;
    }
  } catch {
    // Fall back to direct lookup for local/dev databases where the helper is not installed yet.
  }

  let row: any = undefined;
  const { data: rowsWithAvatar, error: avatarErr } = await supabase
    .from("user")
    .select("user_id,name,username,role_id,status,email,avatar_url")
    .ilike("email", normalizedEmail)
    .limit(1);

  if (avatarErr) {
    const { data: fallbackRows, error: fallbackError } = await supabase
      .from("user")
      .select("user_id,name,username,role_id,status,email")
      .ilike("email", normalizedEmail)
      .limit(1);
    if (fallbackError) throw fallbackError;
    row = fallbackRows?.[0];
  } else {
    row = rowsWithAvatar?.[0];
  }

  if (!row) {
    return null;
  }

  if (String(row.status ?? "active").toLowerCase() === "inactive" || String(row.status ?? "").toLowerCase() === "disabled") {
    throw new Error("This account is inactive. Please contact the administrator.");
  }

  const { data: roleRows, error: roleError } = await supabase
    .from("role")
    .select("role_name")
    .eq("role_id", row.role_id)
    .limit(1);

  if (roleError) throw roleError;

  const resolvedAvatar =
    row.avatar_url ||
    getStoredAvatarSync({
      userId: row.user_id,
      username: row.username,
      email: row.email ?? normalizedEmail,
    });

  if (row.avatar_url && typeof window !== "undefined") {
    saveStoredAvatar(
      {
        userId: row.user_id,
        username: row.username,
        email: row.email ?? normalizedEmail,
      },
      row.avatar_url
    );
  }

  const authUser = {
    user_id: row.user_id,
    name: row.name,
    username: row.username,
    email: row.email ?? normalizedEmail,
    role_id: row.role_id,
    role_name: String((roleRows?.[0] as { role_name?: string } | undefined)?.role_name ?? ""),
    status: row.status ?? "active",
    avatar_url: resolvedAvatar,
  };

  return isAuthorizedAppUser(authUser) ? authUser : null;
}

function authRedirectUrl() {
  return `${window.location.origin}/auth/callback`;
}

function passwordResetRedirectUrl() {
  return `${window.location.origin}/auth/reset-password`;
}

function getSupabaseErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error) {
    const record = error as { message?: unknown; error_description?: unknown; details?: unknown };
    return String(record.message ?? record.error_description ?? record.details ?? "Unknown Supabase error");
  }
  return String(error || "Unknown Supabase error");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const userRef = useRef<AuthUser | null>(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);
  const [loading, setLoading] = useState(true);
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return Boolean(sessionStorage.getItem(MERYL_TERMINAL_LOCKED_KEY) === "true");
  });

  const completeExternalAuth = useCallback(async (options?: { persist?: boolean; bypassOtpGate?: boolean }) => {
    const persist = options?.persist ?? true;
    const bypassOtpGate = options?.bypassOtpGate ?? false;
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) throw error;

    const email = session?.user?.email;
    if (!email) return null;
    const normalizedEmail = email.trim().toLowerCase();
    const provider = String(session?.user?.app_metadata?.provider ?? "").toLowerCase();
    const googleNeedsOtp = provider === "google" && getVerifiedGoogleOtpEmail() !== normalizedEmail;

    const authUser = await findAppUserByEmail(email);
    if (!isAuthorizedAppUser(authUser)) {
      await supabase.auth.signOut();
      return null;
    }

    if (googleNeedsOtp && !bypassOtpGate) {
      clearStoredUser();
      setUser(null);
      return null;
    }

    if (persist) {
      writeStoredUser(authUser);
      setUser(authUser);

      // Asynchronously synchronize session cookie with Python backend (Render)
      syncBackendSession();
    }
    return authUser;
  }, []);

  useEffect(() => {
    let mounted = true;

    async function bootstrapAuth() {
      // 1. Clean any sensitive avatar, receipt, or user keys from localStorage
      purgeLocalStorageSensitiveData();

      // 2. Check tab-scoped sessionStorage
      const storedUser = readStoredUser();

      // If this tab does not have an active session (e.g. freshly opened tab or new browser session):
      // NEVER auto-login from cookies or other tabs! Present the Login portal.
      if (!storedUser || !isAuthorizedAppUser(storedUser)) {
        clearStoredUser();
        if (mounted) {
          setUser(null);
          setLoading(false);
        }
        return;
      }

      // If this tab already has a valid session (e.g. user refreshed F5 in this active tab):
      // Immediately set user to avoid screen flash
      if (mounted) {
        setUser(storedUser);
      }

      // Asynchronously fetch avatar from IndexedDB (safe local storage)
      getStoredAvatarAsync({
        userId: storedUser.user_id,
        username: storedUser.username,
        email: storedUser.email,
      }).then((asyncAvatar) => {
        if (asyncAvatar && mounted) {
          setUser((prev) => (prev ? { ...prev, avatar_url: asyncAvatar } : prev));
        }
      });

      // Ask the database who this session belongs to, so revoked, expired or
      // deactivated sessions are signed out and role/profile changes apply.
      try {
        const { data: whoami, error: whoamiError } = await (supabase as any).rpc("app_whoami");
        if (!whoamiError) {
          if (whoami?.user_id && String(whoami.user_id) === String(storedUser.user_id)) {
            const updatedUser: AuthUser = {
              ...storedUser,
              name: whoami.name || storedUser.name,
              role_id: whoami.role_id || storedUser.role_id,
              role_name: whoami.role_name || storedUser.role_name,
              status: whoami.status || storedUser.status,
              avatar_url: whoami.avatar_url || storedUser.avatar_url,
            };
            writeStoredUser(updatedUser);
            if (mounted) setUser(updatedUser);
            syncBackendSession();
          } else {
            revokeAppSession();
            clearStoredUser();
            if (mounted) setUser(null);
          }
        }
        // On error (offline, or the database has not been migrated yet) keep
        // the in-tab session; every data request is still checked server-side.
      } catch {
        // Offline resilience: keep in-tab session active
      } finally {
        if (mounted) setLoading(false);
      }
    }

    bootstrapAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && session?.user?.email) {
        // Skip calling completeExternalAuth when on /auth/callback to avoid race conditions with the OTP gate
        const isAuthCallbackPath =
          typeof window !== "undefined" && window.location.pathname.startsWith("/auth/callback");
        if (!isAuthCallbackPath) {
          completeExternalAuth().catch(() => {
            clearStoredUser();
            setUser(null);
          });
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [completeExternalAuth]);

  // Synchronize avatar updates across components or tabs in real-time
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleAvatarUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{
        avatarUrl?: string;
        userId?: string;
        username?: string;
      }>;
      const { avatarUrl, userId, username } = customEvent.detail || {};

      setUser((prev) => {
        if (!prev) return prev;
        const matchesUser =
          !userId ||
          String(prev.user_id) === String(userId) ||
          prev.username?.toLowerCase() === String(username || "").toLowerCase();

        if (matchesUser) {
          const nextUser = {
            ...prev,
            avatar_url: avatarUrl || undefined,
          };
          try {
            sessionStorage.setItem(ENCRYPTED_SESSION_KEY, encryptSessionPayload(JSON.stringify(nextUser)));
            sessionStorage.removeItem(MERYL_USER_STORAGE_KEY);
            localStorage.removeItem(MERYL_USER_STORAGE_KEY);
          } catch {}
          return nextUser;
        }
        return prev;
      });
    };

    window.addEventListener("meryl-avatar-updated", handleAvatarUpdated);
    return () => window.removeEventListener("meryl-avatar-updated", handleAvatarUpdated);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: authRedirectUrl(),
        queryParams: {
          prompt: "select_account",
        },
      },
    });

    if (error) throw error;
  }, []);

  const requestEmailOtp = useCallback(async (email: string) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: {
        emailRedirectTo: authRedirectUrl(),
        shouldCreateUser: false,
      },
    });

    if (error) throw error;
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const normalizedEmail = email.trim().toLowerCase();
    // Account eligibility is checked server-side by the backend OTP endpoint;
    // staff accounts are not readable before login.

    // Perform sign out without blocking password reset flow
    supabase.auth.signOut().catch(() => null);

    const resetRedirect = typeof window !== "undefined"
      ? `${window.location.origin}/auth/reset-password`
      : undefined;

    // Helper to request OTP from Python backend with a 6s timeout so an unresponsive SMTP server doesn't freeze the client
    const requestBackendOtp = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(`${BACKEND_BASE}/api/auth/password-reset/request`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: normalizedEmail }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          return await response.json();
        }
        const errJson = await response.json().catch(() => null);
        return { ok: false, status: response.status, error: errJson?.error || "Backend reset request failed" };
      } catch (err: any) {
        clearTimeout(timeoutId);
        return { ok: false, error: err?.name === "AbortError" ? "Backend request timed out" : "Backend unavailable" };
      }
    };

    // Run Supabase Auth reset and Python Backend OTP in parallel
    const [supabaseOutcome, backendOutcome] = await Promise.allSettled([
      supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: resetRedirect,
      }),
      requestBackendOtp(),
    ]);

    let supabaseSucceeded = false;
    let supabaseError: any = null;
    if (supabaseOutcome.status === "fulfilled") {
      if (supabaseOutcome.value.error) {
        supabaseError = supabaseOutcome.value.error;
      } else {
        supabaseSucceeded = true;
      }
    } else {
      supabaseError = supabaseOutcome.reason;
    }

    let backendResult: any = null;
    if (backendOutcome.status === "fulfilled") {
      backendResult = backendOutcome.value;
    }

    if (backendResult?.status === 403) {
      throw new Error(backendResult.error);
    }

    if (!supabaseSucceeded && (!backendResult || !backendResult.ok)) {
      throw new Error(
        getSupabaseErrorMessage(supabaseError) ||
        backendResult?.error ||
        "Failed to send password reset email. Please try again."
      );
    }

    return backendResult || { ok: true };
  }, []);

  const updatePasswordAfterRecovery = useCallback(async (newPassword: string) => {
    const clean = newPassword.trim();
    if (!clean) throw new Error("Password cannot be empty.");

    const {
      data: { user: authUser },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !authUser?.email) {
      throw new Error("No active password recovery session found. Please request a new link.");
    }

    const { error: updateError } = await supabase.auth.updateUser({
      password: clean,
    });

    if (updateError) throw updateError;

    // Update password securely via RPC if present
    try {
      await supabase.rpc("reset_user_password_by_email", { p_new_password: clean });
    } catch {
      // RPC handled securely DB-side
    }

    // Sync to Python backend if available
    try {
      await fetch(`${BACKEND_BASE}/api/auth/password-reset/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: authUser.email,
          new_password: clean,
        }),
      });
    } catch {
      // Backend sync fallback ignored
    }

    await supabase.auth.signOut().catch(() => null);
  }, []);

  const verifyPasswordResetOtpAndUpdate = useCallback(async (
    email: string,
    otp: string,
    newPassword: string,
    options?: { keepSession?: boolean }
  ) => {
    const normalizedEmail = email.trim().toLowerCase();
    const cleanOtp = otp.trim();
    const cleanPassword = newPassword.trim();

    if (!normalizedEmail) throw new Error("Email cannot be empty.");
    if (!cleanOtp) throw new Error("OTP code cannot be empty.");
    if (!cleanPassword) throw new Error("New password cannot be empty.");

    // 1. Try Supabase Auth OTP verification
    let verifiedWithSupabase = false;
    try {
      const { data: recoveryData, error: recoveryError } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: cleanOtp,
        type: "recovery",
      });
      if (!recoveryError && recoveryData?.session) {
        verifiedWithSupabase = true;
      } else {
        const { data: emailData, error: emailError } = await supabase.auth.verifyOtp({
          email: normalizedEmail,
          token: cleanOtp,
          type: "email",
        });
        if (!emailError && emailData?.session) {
          verifiedWithSupabase = true;
        }
      }
    } catch {
      // Fall through to backend verification
    }

    if (verifiedWithSupabase) {
      // Update Supabase Auth user password
      try {
        await supabase.auth.updateUser({ password: cleanPassword });
      } catch {
        // Auth user update ignored if not supported
      }

      // Update password securely via RPC if present
      try {
        await supabase.rpc("reset_user_password_by_email", { p_new_password: cleanPassword });
      } catch {
        // RPC handled securely DB-side
      }

      // Also sync to backend if running
      try {
        await fetch(`${BACKEND_BASE}/api/auth/password-reset/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: normalizedEmail,
            otp: cleanOtp,
            new_password: cleanPassword,
          }),
        });
      } catch {
        // Backend sync ignored
      }

      if (!options?.keepSession) {
        sessionStorage.removeItem(MERYL_USER_STORAGE_KEY);
        clearGoogleOtpVerifiedEmail();
        setUser(null);
        await supabase.auth.signOut().catch(() => null);
      }
      return;
    }

    // 2. Fallback to Python backend OTP verification if Supabase Auth OTP wasn't matched
    let backendResponse: Response | null = null;
    try {
      backendResponse = await fetch(`${BACKEND_BASE}/api/auth/password-reset/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: normalizedEmail,
          otp: cleanOtp,
          new_password: cleanPassword,
        }),
      });
    } catch {
      // Backend not running
    }

    if (backendResponse) {
      const result = await backendResponse.json().catch(() => ({}));
      if (backendResponse.ok && result?.ok) {
        if (!options?.keepSession) {
          sessionStorage.removeItem(MERYL_USER_STORAGE_KEY);
          clearGoogleOtpVerifiedEmail();
          setUser(null);
          await supabase.auth.signOut().catch(() => null);
        }
        return;
      }
      if (result?.error) {
        throw new Error(String(result.error));
      }
    }

    throw new Error("Invalid or expired OTP code. Please check your email or click the reset link.");
  }, []);

  const markGoogleOtpVerified = useCallback((email: string) => {
    markGoogleOtpVerifiedEmail(email);
  }, []);

  const validateCredentials = useCallback(async (
    username: string,
    password: string,
    options?: { issueSession?: boolean },
  ): Promise<AuthUser | null> => {
    const cleanUsername = username.trim().toLowerCase();
    const cleanPassword = password.trim();
    if (!cleanUsername || !cleanPassword) return null;

    // Credentials are verified by the login_user database function (bcrypt),
    // which also issues the session token the database requires on every request.
    try {
      const { data, error } = await callLoginRpc(cleanUsername, cleanPassword, options?.issueSession ?? true);

      if (!error && data) {
        const payload = data as any;
        if (payload.error === "inactive" || String(payload.status ?? "").toLowerCase() === "inactive") {
          throw new Error("This account is inactive. Please contact the administrator.");
        }
        if (payload.user_id) {
          const authUser: AuthUser = {
            user_id: payload.user_id,
            name: payload.name || cleanUsername,
            username: payload.username || cleanUsername,
            role_id: payload.role_id || "",
            role_name: payload.role_name || "",
            status: payload.status || "Active",
            email: payload.email || null,
            avatar_url: payload.avatar_url || getStoredAvatarSync({
              userId: payload.user_id,
              username: payload.username || cleanUsername,
              email: payload.email || null,
            }),
          };
          if (options?.issueSession ?? true) {
            setAppSessionToken(payload.session_token ? String(payload.session_token) : null);
            syncBackendSession();
          }
          return authUser;
        }
      }
    } catch (rpcErr: any) {
      if (rpcErr?.message && rpcErr.message.toLowerCase().includes("inactive")) {
        throw rpcErr;
      }
    }

    return null;
  }, []);

  const setCurrentUser = useCallback((authUser: AuthUser) => {
    writeStoredUser(authUser);
    setUser(authUser);
  }, []);

  // Inactivity Auto-Lock Detector
  useEffect(() => {
    if (!user) {
      setIsLocked(false);
      return;
    }

    let timeoutId: any;

    const resetTimer = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setIsLocked(true);
        sessionStorage.setItem(MERYL_TERMINAL_LOCKED_KEY, "true");
        logAuditEvent({
          action_type: "TERMINAL_AUTO_LOCKED",
          entity_type: "SESSION",
          entity_id: user.user_id,
          metadata: { username: user.username, role: user.role_name },
        });
      }, INACTIVITY_TIMEOUT_MS);
    };

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timeoutId);
      events.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [user]);

  const lockTerminal = useCallback(() => {
    if (!user) return;
    setIsLocked(true);
    sessionStorage.setItem(MERYL_TERMINAL_LOCKED_KEY, "true");
    logAuditEvent({
      action_type: "TERMINAL_AUTO_LOCKED",
      entity_type: "SESSION",
      entity_id: user.user_id,
      metadata: { username: user.username, role: user.role_name, manual: true },
    });
  }, [user]);

  const unlockTerminal = useCallback(async (password: string): Promise<boolean> => {
    if (!user) return false;
    const verified = await validateCredentials(user.username, password, { issueSession: false });
    if (verified) {
      setIsLocked(false);
      sessionStorage.removeItem(MERYL_TERMINAL_LOCKED_KEY);
      logAuditEvent({
        action_type: "TERMINAL_UNLOCKED",
        entity_type: "SESSION",
        entity_id: user.user_id,
        metadata: { username: user.username, role: user.role_name },
      });
      return true;
    }
    return false;
  }, [user, validateCredentials]);

  const login = useCallback(async (username: string, password: string) => {
    const cleanUsername = username.trim().toLowerCase();

    // Check brute-force lockout status before validating
    const lockout = checkLockoutStatus(cleanUsername);
    if (lockout.isLocked) {
      const minutes = Math.floor(lockout.remainingSeconds / 60);
      const seconds = lockout.remainingSeconds % 60;
      const formatted = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
      throw new Error(`Security Lockout: Too many failed login attempts. Try again in ${formatted}.`);
    }

    try {
      const authUser = await validateCredentials(username, password);
      if (!authUser) {
        const attempt = recordFailedAttempt(cleanUsername);
        logAuditEvent({
          action_type: attempt.isLocked ? "AUTH_ACCOUNT_LOCKED" : "AUTH_FAILED_LOGIN",
          entity_type: "USER",
          entity_id: cleanUsername,
          metadata: { username: cleanUsername, attempt_count: attempt.count },
        });

        if (attempt.isLocked) {
          throw new Error("Security Alert: Account temporarily locked due to 5 failed attempts. Please wait 5 minutes before retrying.");
        }
        return null;
      }

      // Success: clear failed attempts and unlock terminal
      clearFailedAttempts(cleanUsername);
      sessionStorage.removeItem(MERYL_TERMINAL_LOCKED_KEY);
      setIsLocked(false);
      setCurrentUser(authUser);
      logAuditEvent({
        action_type: "AUTH_LOGIN",
        entity_type: "USER",
        entity_id: authUser.user_id,
        metadata: { username: authUser.username, role: authUser.role_name },
      });
      return authUser;
    } catch (err: any) {
      if (err?.message && (err.message.includes("Security Alert") || err.message.includes("Security Lockout") || err.message.includes("inactive"))) {
        throw err;
      }
      throw err;
    }
  }, [validateCredentials, setCurrentUser]);

  const logout = useCallback(() => {
    const currentUser = userRef.current;
    // The logout audit entry must be written while the session is still valid,
    // so credentials are revoked only after it completes.
    const sessionToken = getAppSessionToken();
    const auditWritten = currentUser
      ? logAuditEvent({
          action_type: "AUTH_LOGOUT",
          entity_type: "USER",
          entity_id: currentUser.user_id,
          metadata: { username: currentUser.username, role: currentUser.role_name },
        })
      : Promise.resolve();

    // Invalidate server-side cookies
    try {
      fetch(`${BACKEND_BASE}/api/auth/logout`, {
        method: "POST",
        credentials: "include",
      }).catch(() => null);
    } catch {}

    if (typeof document !== "undefined") {
      document.cookie = "meryl_session=; Max-Age=0; path=/;";
      document.cookie = "meryl_token=; Max-Age=0; path=/;";
    }

    auditWritten.finally(() => {
      revokeAppSession(sessionToken);
      supabase.auth.signOut().catch(() => null);
    });
    clearStoredUser();
    sessionStorage.removeItem(MERYL_TERMINAL_LOCKED_KEY);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(MERYL_TERMINAL_LOCKED_KEY);
    }
    setIsLocked(false);
    clearGoogleOtpVerifiedEmail();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      isLocked,
      lockTerminal,
      unlockTerminal,
      checkLockoutStatus,
      login,
      validateCredentials,
      setCurrentUser,
      signInWithGoogle,
      requestPasswordReset,
      updatePasswordAfterRecovery,
      verifyPasswordResetOtpAndUpdate,
      requestEmailOtp,
      completeExternalAuth,
      markGoogleOtpVerified,
      logout,
    }),
    [
      completeExternalAuth,
      isLocked,
      loading,
      lockTerminal,
      login,
      logout,
      markGoogleOtpVerified,
      requestEmailOtp,
      requestPasswordReset,
      setCurrentUser,
      signInWithGoogle,
      unlockTerminal,
      updatePasswordAfterRecovery,
      user,
      validateCredentials,
      verifyPasswordResetOtpAndUpdate,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
