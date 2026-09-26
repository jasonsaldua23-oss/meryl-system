import { useEffect, useState } from "react";
import { useAuth, type AuthUser } from "../../lib/auth-context";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import {
  KeyRound,
  Mail,
  ShieldCheck,
  Eye,
  EyeOff,
  Lock,
  AlertTriangle,
  CheckCircle2,
  ArrowLeft,
  RefreshCw,
  X,
  Clock,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "../../lib/api/audit-logger";

interface PortalPasswordResetModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetUser?: AuthUser | null;
}

export function PortalPasswordResetModal({
  isOpen,
  onClose,
  targetUser,
}: PortalPasswordResetModalProps) {
  const { user: currentUser, requestPasswordReset, verifyPasswordResetOtpAndUpdate, logout } = useAuth();
  const effectiveUser = targetUser || currentUser;

  const [step, setStep] = useState<"request" | "verify" | "success">("request");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpExpiresRemaining, setOtpExpiresRemaining] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(Math.max(0, totalSeconds) / 60);
    const secs = Math.max(0, totalSeconds) % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Initialize or reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep("request");
      setEmail(effectiveUser?.email || "");
      setOtp("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setIsSending(false);
      setIsVerifying(false);
      setResendCooldown(0);
      setOtpExpiresRemaining(0);
      setErrorMessage("");
    }
  }, [isOpen, effectiveUser]);

  // Handle resend countdown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  // Handle OTP 10-minute expiration timer
  useEffect(() => {
    if (otpExpiresRemaining <= 0) return;
    const timer = window.setInterval(() => {
      setOtpExpiresRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [otpExpiresRemaining]);

  if (!isOpen) return null;

  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setIsSending(true);
    setErrorMessage("");

    try {
      await requestPasswordReset(cleanEmail);
      setStep("verify");
      setResendCooldown(60);
      setOtpExpiresRemaining(600);
      toast.success("Verification OTP code sent to your email!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to send OTP. Please check your email.";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsSending(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOtp = otp.trim().replace(/\D/g, "");
    const cleanPassword = newPassword.trim();
    const cleanConfirm = confirmPassword.trim();

    if (!cleanOtp || cleanOtp.length < 6 || cleanOtp.length > 8) {
      setErrorMessage("Please enter the complete 6 to 8-digit OTP code.");
      return;
    }

    if (otpExpiresRemaining <= 0) {
      setErrorMessage("This OTP code has expired. Please click Resend OTP to request a fresh code.");
      return;
    }

    if (cleanPassword.length < 8) {
      setErrorMessage("New password must be at least 8 characters.");
      return;
    }

    if (cleanPassword !== cleanConfirm) {
      setErrorMessage("Passwords do not match. Please re-enter.");
      return;
    }

    setIsVerifying(true);
    setErrorMessage("");

    try {
      await verifyPasswordResetOtpAndUpdate(email.trim().toLowerCase(), cleanOtp, cleanPassword, {
        keepSession: true,
      });

      // Log security audit event
      await logAuditEvent({
        action_type: "PASSWORD_RESET_OTP",
        entity_type: "USER",
        entity_id: effectiveUser?.user_id,
        metadata: {
          username: effectiveUser?.username,
          email: email.trim().toLowerCase(),
          reset_location: "portal_modal",
          timestamp: new Date().toISOString(),
        },
      }).catch(() => null);

      setStep("success");
      toast.success("Password has been reset successfully!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid or expired OTP. Please try again.";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsVerifying(false);
    }
  };

  const initial = (effectiveUser?.name || effectiveUser?.username || "U").charAt(0).toUpperCase();

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-slot="dialog-content"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#2c2c3d] bg-[#14141d] p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 text-white relative">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white transition"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Top Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 shadow-inner">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">Reset Password</h2>
            <p className="text-xs text-yellow-200/60">Secure portal password update via Email OTP</p>
          </div>
        </div>

        {/* User Profile Summary Card */}
        <div className="flex items-center gap-3 rounded-xl border border-[#29293a] bg-[#1a1a27] p-3 text-left">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#E5202A] to-[#FFD60A] text-black font-extrabold text-sm shadow-sm">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white truncate">{effectiveUser?.name || "Staff Member"}</p>
            <p className="text-xs text-yellow-200/60 truncate">
              {effectiveUser?.username ? `@${effectiveUser.username}` : effectiveUser?.email || "No email on record"}
            </p>
          </div>
          {effectiveUser?.role_name && (
            <span className="rounded-md border border-yellow-400/30 bg-yellow-400/10 px-2 py-0.5 text-[11px] font-bold text-yellow-300">
              {effectiveUser.role_name}
            </span>
          )}
        </div>

        {/* Error Alert Box */}
        {errorMessage && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span className="flex-1">{errorMessage}</span>
          </div>
        )}

        {/* STEP 1: REQUEST OTP */}
        {step === "request" && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div className="space-y-1.5 text-left">
              <label className="text-xs font-semibold text-yellow-200/90 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-yellow-400" />
                Registered Email Address
              </label>
              <Input
                type="email"
                required
                placeholder="e.g. staff@merylshoes.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (errorMessage) setErrorMessage("");
                }}
                className="h-11 rounded-xl border-[#2f3142] bg-[#1c1c28] text-sm text-yellow-100 placeholder:text-zinc-500 focus-visible:ring-yellow-400/50"
              />
              <p className="text-[11px] text-zinc-400">
                A 6 to 8-digit verification code will be sent to this email address to verify your identity.
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                className="flex-1 h-10 rounded-xl border-[#2d2d3f] bg-[#1a1a26] text-zinc-300 hover:bg-[#242436] hover:text-white"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSending || !email.trim()}
                className="flex-1 h-10 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold shadow-md"
              >
                {isSending ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Sending OTP...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    Send Reset OTP
                  </span>
                )}
              </Button>
            </div>
          </form>
        )}

        {/* STEP 2: VERIFY OTP & ENTER NEW PASSWORD */}
        {step === "verify" && (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/5 p-3 text-xs text-yellow-200/80 flex items-center justify-between">
              <span className="truncate">OTP sent to: <strong>{email}</strong></span>
              <button
                type="button"
                onClick={() => {
                  setStep("request");
                  setErrorMessage("");
                }}
                className="text-yellow-400 hover:underline text-xs shrink-0 ml-2 font-medium"
              >
                Change
              </button>
            </div>

            {/* OTP Code Input */}
            <div className="space-y-1.5 text-left">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-yellow-200/90 flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-yellow-400" />
                  Verification OTP (6 to 8 Digits)
                </label>
                {otpExpiresRemaining > 0 ? (
                  <span className={`inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full border ${
                    otpExpiresRemaining <= 60
                      ? "bg-amber-500/20 border-amber-400/40 text-amber-300 animate-pulse"
                      : "bg-emerald-500/20 border-emerald-400/30 text-emerald-300"
                  }`}>
                    <Clock className="w-3 h-3" />
                    Expires in {formatTimer(otpExpiresRemaining)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/40 text-red-300 animate-pulse">
                    <AlertTriangle className="w-3 h-3" />
                    Expired (00:00)
                  </span>
                )}
              </div>
              <Input
                type="text"
                autoFocus
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={8}
                placeholder="12345678"
                value={otp}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/\D/g, "").slice(0, 8);
                  setOtp(cleaned);
                  if (errorMessage) setErrorMessage("");
                }}
                className={`h-11 rounded-xl bg-[#1c1c28] text-center text-lg tracking-[0.35em] font-mono text-yellow-300 placeholder:text-zinc-600 focus-visible:ring-yellow-400/50 ${
                  otpExpiresRemaining <= 0 ? "border-red-500/60" : "border-[#2f3142]"
                }`}
              />
              {otpExpiresRemaining <= 0 && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  OTP code has expired. Please click <strong>Resend OTP</strong> to request a new code.
                </p>
              )}
            </div>

            {/* New Password */}
            <div className="space-y-1.5 text-left">
              <label className="text-xs font-semibold text-yellow-200/90 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-yellow-400" />
                New Password
              </label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 8 characters..."
                  value={newPassword}
                  onChange={(e) => {
                    setNewPassword(e.target.value);
                    if (errorMessage) setErrorMessage("");
                  }}
                  className="h-11 rounded-xl border-[#2f3142] bg-[#1c1c28] pr-10 text-sm text-yellow-100 placeholder:text-zinc-500 focus-visible:ring-yellow-400/50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-yellow-300 transition"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5 text-left">
              <label className="text-xs font-semibold text-yellow-200/90">Confirm New Password</label>
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Re-enter new password..."
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  if (errorMessage) setErrorMessage("");
                }}
                className="h-11 rounded-xl border-[#2f3142] bg-[#1c1c28] text-sm text-yellow-100 placeholder:text-zinc-500 focus-visible:ring-yellow-400/50"
              />
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2 pt-2">
              <Button
                type="submit"
                disabled={isVerifying || otp.length < 6 || otp.length > 8 || newPassword.length < 8 || !confirmPassword || otpExpiresRemaining <= 0}
                className="w-full h-11 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold shadow-md transition"
              >
                {isVerifying ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Updating Password...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4" />
                    Confirm & Update Password
                  </span>
                )}
              </Button>

              <div className="flex items-center justify-between text-xs pt-1 px-1">
                <button
                  type="button"
                  onClick={() => setStep("request")}
                  className="inline-flex items-center gap-1 text-zinc-400 hover:text-white transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Back
                </button>

                <button
                  type="button"
                  disabled={resendCooldown > 0 || isSending}
                  onClick={handleSendOtp}
                  className="text-yellow-400 hover:underline disabled:opacity-40 disabled:no-underline transition font-medium inline-flex items-center gap-1"
                >
                  {resendCooldown > 0 ? (
                    <>
                      <Clock className="w-3 h-3 text-yellow-400 animate-pulse" />
                      Resend OTP in {resendCooldown}s
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-3 h-3 text-yellow-400" />
                      Resend OTP
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}

        {/* STEP 3: SUCCESS CONFIRMATION */}
        {step === "success" && (
          <div className="py-4 space-y-4 text-center animate-in zoom-in-95 duration-200">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 shadow-inner">
              <CheckCircle2 className="h-8 w-8" />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white">Password Updated!</h3>
              <p className="text-xs text-zinc-400 max-w-xs mx-auto">
                Your password has been changed successfully. You can continue working or log in with your new credentials.
              </p>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <Button
                type="button"
                onClick={onClose}
                className="w-full h-10 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold shadow-md"
              >
                Continue in Portal
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onClose();
                  logout();
                }}
                className="w-full h-10 rounded-xl border-[#2d2d3f] bg-[#1a1a26] text-zinc-300 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-300"
              >
                Sign Out & Log In Again
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

