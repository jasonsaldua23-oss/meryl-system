import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AlertTriangle, ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { getPostLoginPath, getRoleGroup, MERYL_TERMINAL_LOCKED_KEY, useAuth, type AuthUser } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;

type OtpChallenge = {
  email: string;
  sentAt: number;
  attempts: number;
  resendAvailableAt: number;
};

function createOtpChallenge(email: string): OtpChallenge {
  const now = Date.now();
  return {
    email,
    sentAt: now,
    attempts: 0,
    resendAvailableAt: now + OTP_RESEND_COOLDOWN_MS,
  };
}

export function AuthCallback() {
  const navigate = useNavigate();
  const { completeExternalAuth, requestEmailOtp, markGoogleOtpVerified, logout } = useAuth();
  const [error, setError] = useState("");
  const [otpMode, setOtpMode] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpNotice, setOtpNotice] = useState("");
  const [matchedUser, setMatchedUser] = useState<AuthUser | null>(null);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpChallenge, setOtpChallenge] = useState<OtpChallenge | null>(null);
  const [now, setNow] = useState(Date.now());
  const initialCheckDoneRef = useRef(false);

  useEffect(() => {
    if (!otpMode) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [otpMode]);

  const expiresAt = otpChallenge ? otpChallenge.sentAt + OTP_TTL_MS : 0;
  const remainingSeconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const canResend = otpChallenge ? now >= otpChallenge.resendAvailableAt : false;
  const resendCooldownSeconds = otpChallenge ? Math.max(0, Math.ceil((otpChallenge.resendAvailableAt - now) / 1000)) : 0;
  const attemptsLeft = otpChallenge ? Math.max(0, OTP_MAX_ATTEMPTS - otpChallenge.attempts) : OTP_MAX_ATTEMPTS;

  useEffect(() => {
    let mounted = true;

    async function finishSignIn() {
      if (initialCheckDoneRef.current) return;
      initialCheckDoneRef.current = true;
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const provider = String(session?.user?.app_metadata?.provider ?? "").toLowerCase();
        const sessionEmail = String(session?.user?.email ?? "").trim().toLowerCase();

        // Arriving here is a fresh Google/email sign-in: start unlocked.
        sessionStorage.removeItem(MERYL_TERMINAL_LOCKED_KEY);
        const appUser = await completeExternalAuth({
          persist: provider !== "google",
          bypassOtpGate: provider === "google",
        });

        if (!mounted) return;

        if (!appUser) {
          logout();
          setError(
            "Your account is not authorized to access this system. Please contact the administrator.",
          );
          return;
        }

        if (provider === "google") {
          setOtpMode(true);
          setOtpEmail(sessionEmail);
          setMatchedUser(appUser);
          try {
            setSendingOtp(true);
            await requestEmailOtp(sessionEmail);
            if (mounted) {
              setOtpChallenge(createOtpChallenge(sessionEmail));
              setOtpNotice("We sent an OTP/sign-in code to your registered email. Enter it below within 5 minutes.");
            }
          } finally {
            if (mounted) setSendingOtp(false);
          }
          return;
        }

        navigate(getPostLoginPath(appUser), { replace: true });
      } catch (authError) {
        if (!mounted) return;
        logout();
        setError(
          authError instanceof Error
            ? authError.message
            : "We could not finish Google/email sign-in. Please try again.",
        );
      }
    }

    finishSignIn();

    return () => {
      mounted = false;
    };
  }, [completeExternalAuth, logout, navigate, requestEmailOtp]);

  const handleVerifyOtp = async () => {
    if (verifyingOtp || !otpEmail) return;
    if (!otpCode.trim()) {
      setError("Enter the OTP code from your email.");
      return;
    }
    if (!otpChallenge || otpChallenge.email !== otpEmail) {
      setError("Please request a new OTP before continuing.");
      return;
    }
    if (Date.now() > otpChallenge.sentAt + OTP_TTL_MS) {
      setError("This OTP has expired. Please resend a new code.");
      return;
    }
    if (otpChallenge.attempts >= OTP_MAX_ATTEMPTS) {
      logout();
      setOtpMode(false);
      setError("Too many failed OTP attempts. Please sign in again.");
      return;
    }

    try {
      setVerifyingOtp(true);
      setError("");
      setOtpNotice("");

      // Mark Google OTP as verified BEFORE verifyOtp so onAuthStateChange doesn't trigger OTP gate
      markGoogleOtpVerified(otpEmail);

      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: otpEmail,
        token: otpCode.trim(),
        type: "email",
      });

      if (verifyError) {
        sessionStorage.removeItem("meryl_google_otp_verified_email");
        throw verifyError;
      }

      setOtpChallenge(null);
      sessionStorage.removeItem(MERYL_TERMINAL_LOCKED_KEY);
      const appUser = await completeExternalAuth({ persist: true, bypassOtpGate: true });
      if (!appUser) {
        throw new Error("Could not complete sign-in after OTP verification.");
      }

      navigate(getPostLoginPath(appUser), { replace: true });
    } catch (otpError) {
      sessionStorage.removeItem("meryl_google_otp_verified_email");
      const nextChallenge = {
        ...otpChallenge,
        attempts: otpChallenge.attempts + 1,
      };
      setOtpChallenge(nextChallenge);
      if (nextChallenge.attempts >= OTP_MAX_ATTEMPTS) {
        logout();
        setOtpMode(false);
        setError("Too many failed OTP attempts. Please sign in again.");
      } else {
        setError(
          otpError instanceof Error
            ? `${otpError.message} ${OTP_MAX_ATTEMPTS - nextChallenge.attempts} attempt(s) left.`
            : `Invalid OTP code. ${OTP_MAX_ATTEMPTS - nextChallenge.attempts} attempt(s) left.`,
        );
      }
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleResendOtp = async () => {
    if (!otpEmail || sendingOtp) return;
    if (otpChallenge && Date.now() < otpChallenge.resendAvailableAt) {
      const seconds = Math.ceil((otpChallenge.resendAvailableAt - Date.now()) / 1000);
      setError(`Please wait ${seconds} second(s) before resending the OTP.`);
      return;
    }
    try {
      setSendingOtp(true);
      setError("");
      await requestEmailOtp(otpEmail);
      setOtpChallenge(createOtpChallenge(otpEmail));
      setOtpCode("");
      setOtpNotice("OTP sent again. Check your registered email inbox.");
    } catch (otpError) {
      setError(otpError instanceof Error ? otpError.message : "Could not resend OTP.");
    } finally {
      setSendingOtp(false);
    }
  };

  const handleBackToLogin = async () => {
    try {
      await logout();
    } catch {
      // ignore
    }
    navigate("/", { replace: true });
  };

  const userRoleGroup = matchedUser ? getRoleGroup(matchedUser.role_name) : null;
  const roleBadgeStyle =
    userRoleGroup === "admin"
      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
      : userRoleGroup === "sales"
      ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
      : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
  const roleBadgeText =
    userRoleGroup === "admin"
      ? "Administrator"
      : userRoleGroup === "sales"
      ? "Cashier / Sales Staff"
      : "Inventory Staff";

  return (
    <div className="min-h-screen bg-[#0E0E12] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#16161C] p-7 shadow-2xl">
        {!error && !otpMode ? (
          <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FFD60A]/15 text-[#FFD60A]">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
            <h1 className="mt-5 text-2xl font-semibold">Finishing sign-in</h1>
            <p className="mt-2 text-sm text-white/60">
              We are verifying your email and matching it to your Meryl staff role.
            </p>
          </div>
        ) : otpMode ? (
          <div>
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#FFD60A]/15 text-[#FFD60A]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Verify OTP to continue</h1>
                <p className="mt-2 text-sm leading-6 text-white/65">
                  Google sign-in succeeded. Enter the OTP sent to <span className="text-white">{otpEmail}</span> to access the system.
                </p>
                <p className="mt-1 text-xs text-[#FFD60A]">
                  Expires in {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")} - {attemptsLeft} attempt(s) left
                </p>
              </div>
            </div>

            {matchedUser && (
              <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-[#1D1D25] px-3.5 py-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-xs font-semibold text-white/80">
                    {(matchedUser.name || matchedUser.username || "U").slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-white">{matchedUser.name || matchedUser.username}</div>
                    <div className="text-[11px] text-white/40">{matchedUser.username ? `@${matchedUser.username}` : matchedUser.email}</div>
                  </div>
                </div>
                <div>
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-semibold ${roleBadgeStyle}`}>
                    {roleBadgeText}
                  </span>
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-xl px-3 py-2.5 bg-[#E5202A]/15 border border-[#E5202A]/30 text-sm text-[#FF8B91]">
                {error}
              </div>
            )}

            {otpNotice && (
              <div className="mt-4 rounded-xl px-3 py-2.5 bg-emerald-500/10 border border-emerald-400/25 text-sm text-emerald-200">
                {otpNotice}
              </div>
            )}

            <div className="mt-4">
              <label className="mb-1.5 block text-xs text-white/60">Email OTP code</label>
              <input
                type="text"
                value={otpCode}
                onChange={(event) => setOtpCode(event.target.value)}
                placeholder="Enter OTP code"
                className="h-11 w-full rounded-xl border border-white/5 bg-[#1D1D25] px-3 text-sm text-white placeholder:text-white/30 transition focus:border-[#FFD60A]/40 focus:outline-none focus:ring-2 focus:ring-[#FFD60A]/20"
              />
              <p className="mt-1.5 text-[11px] text-white/45">
                OTP codes expire after 5 minutes. If it expires, tap <span className="text-white/70">Resend OTP</span>.
              </p>
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                type="button"
                onClick={handleVerifyOtp}
                disabled={verifyingOtp || sendingOtp}
                className="h-11 flex-1 rounded-xl bg-[#FFD60A] font-semibold text-[#17171D] hover:bg-[#ffcf24]"
              >
                {verifyingOtp ? "Verifying..." : "Verify and Continue"}
              </Button>
              <Button
                type="button"
                onClick={handleResendOtp}
                disabled={verifyingOtp || sendingOtp || !canResend}
                className="h-11 rounded-xl border border-white/10 bg-[#1D1D25] text-white hover:bg-white/10 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {sendingOtp ? "Sending..." : canResend ? "Resend OTP" : `Resend (${resendCooldownSeconds}s)`}
              </Button>
            </div>

            <div className="mt-4 pt-3 border-t border-white/10 text-center">
              <button
                type="button"
                onClick={handleBackToLogin}
                className="inline-flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition py-1 font-medium"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back to Login
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#E5202A]/15 text-[#FF8B91]">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Sign-in needs setup</h1>
                <p className="mt-2 text-sm leading-6 text-white/65">{error}</p>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-[#FFD60A]/20 bg-[#FFD60A]/10 p-4 text-sm text-[#F7D75A]">
              <div className="flex items-center gap-2 font-semibold text-white">
                <ShieldCheck className="h-4 w-4 text-[#FFD60A]" />
                Quick check
              </div>
              <p className="mt-2 text-xs leading-5">
                The Google email must exactly exist in the Users page, must be Active, and must have an assigned role.
              </p>
            </div>

            <Button
              type="button"
              onClick={() => navigate("/", { replace: true })}
              className="mt-6 h-11 w-full rounded-xl bg-[#FFD60A] font-semibold text-[#17171D] hover:bg-[#ffcf24]"
            >
              Back to Login
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
