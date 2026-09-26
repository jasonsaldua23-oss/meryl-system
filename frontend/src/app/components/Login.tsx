import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from './ui/button';
import { ArrowLeft, KeyRound, LogIn, Mail, User, Lock, ShieldCheck, Eye, EyeOff, CheckCircle2, ShieldAlert, Clock, RotateCcw, AlertTriangle, Loader2 } from 'lucide-react';
import { checkLockoutStatus, clearFailedAttempts, getPostLoginPath, recordFailedAttempt, useAuth, type AuthUser } from '../../lib/auth-context';
import { logAuditEvent } from '../../lib/api/audit-logger';
import { supabase } from '../../lib/supabase';
import { BrandLogo } from './BrandLogo';


export function Login() {
  const navigate = useNavigate();
  const { validateCredentials, setCurrentUser, signInWithGoogle, requestPasswordReset, verifyPasswordResetOtpAndUpdate } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetStep, setResetStep] = useState<'email' | 'otp'>('email');
  const [forgotMode, setForgotMode] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [externalSubmitting, setExternalSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [showResetConfirmPassword, setShowResetConfirmPassword] = useState(false);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [loggedInUser, setLoggedInUser] = useState<AuthUser | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [resetCooldownUntil, setResetCooldownUntil] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const stored = sessionStorage.getItem('meryl_reset_cooldown_until');
    if (!stored) return 0;
    const time = parseInt(stored, 10);
    return time > Date.now() ? time : 0;
  });
  const [resetCooldownRemaining, setResetCooldownRemaining] = useState<number>(0);

  // OTP 10-minute expiration timer (persisted across refreshes)
  const [otpExpiresUntil, setOtpExpiresUntil] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const stored = sessionStorage.getItem('meryl_otp_expires_until');
    if (!stored) return 0;
    const time = parseInt(stored, 10);
    return time > Date.now() ? time : 0;
  });
  const [otpExpiresRemaining, setOtpExpiresRemaining] = useState<number>(0);

  // Helper to format remaining seconds as MM:SS
  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(Math.max(0, totalSeconds) / 60);
    const secs = Math.max(0, totalSeconds) % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Check lockout status whenever username changes
  useEffect(() => {
    const clean = username.trim().toLowerCase();
    if (!clean) {
      setLockoutRemaining(0);
      return;
    }
    const status = checkLockoutStatus(clean);
    setLockoutRemaining(status.remainingSeconds);
  }, [username]);

  // Run live 1-second ticking countdown whenever lockoutRemaining > 0
  useEffect(() => {
    if (lockoutRemaining <= 0) return;

    const timer = setInterval(() => {
      const clean = username.trim().toLowerCase();
      if (clean) {
        const status = checkLockoutStatus(clean);
        setLockoutRemaining(status.remainingSeconds);
        if (!status.isLocked) {
          setError('');
        }
      } else {
        setLockoutRemaining((prev) => Math.max(0, prev - 1));
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [lockoutRemaining > 0, username]);

  // Live ticking countdown for reset password rate limit / security cooldown
  useEffect(() => {
    if (resetCooldownUntil <= 0) {
      setResetCooldownRemaining(0);
      return;
    }

    const updateTimer = () => {
      const remaining = Math.max(0, Math.ceil((resetCooldownUntil - Date.now()) / 1000));
      setResetCooldownRemaining(remaining);
      if (remaining <= 0) {
        setResetCooldownUntil(0);
        sessionStorage.removeItem('meryl_reset_cooldown_until');
        setNotice('Cooldown finished. You can now request a new reset OTP.');
      }
    };

    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [resetCooldownUntil]);

  // Live ticking countdown for OTP 10-minute expiration
  useEffect(() => {
    if (otpExpiresUntil <= 0) {
      setOtpExpiresRemaining(0);
      return;
    }

    const updateOtpTimer = () => {
      const remaining = Math.max(0, Math.ceil((otpExpiresUntil - Date.now()) / 1000));
      setOtpExpiresRemaining(remaining);
      if (remaining <= 0) {
        setOtpExpiresUntil(0);
        sessionStorage.removeItem('meryl_otp_expires_until');
      }
    };

    updateOtpTimer();
    const timer = setInterval(updateOtpTimer, 1000);
    return () => clearInterval(timer);
  }, [otpExpiresUntil]);

  useEffect(() => {
    const resetExternalSubmitting = () => {
      setExternalSubmitting(false);
    };

    window.addEventListener('pageshow', resetExternalSubmitting);
    window.addEventListener('focus', resetExternalSubmitting);
    return () => {
      window.removeEventListener('pageshow', resetExternalSubmitting);
      window.removeEventListener('focus', resetExternalSubmitting);
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const cleanUsername = username.trim().toLowerCase();
    const cleanPassword = password.trim();

    // Check brute-force lockout status before validating
    const lockout = checkLockoutStatus(cleanUsername);
    if (lockout.isLocked) {
      setLockoutRemaining(lockout.remainingSeconds);
      setError(`Security Lockout: Account temporarily locked due to 5 failed attempts. Please wait.`);
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');

    try {
      // Step 1: Validate credentials
      const authUser = await validateCredentials(cleanUsername, cleanPassword);

      if (!authUser) {
        const attempt = recordFailedAttempt(cleanUsername);
        logAuditEvent({
          action_type: attempt.isLocked ? "AUTH_ACCOUNT_LOCKED" : "AUTH_FAILED_LOGIN",
          entity_type: "USER",
          entity_id: cleanUsername,
          metadata: { username: cleanUsername, attempt_count: attempt.count },
        });

        if (attempt.isLocked) {
          const status = checkLockoutStatus(cleanUsername);
          setLockoutRemaining(status.remainingSeconds || 300);
          setError('');
        } else {
          const remaining = 5 - attempt.count;
          setError(`Invalid username or password. (${remaining} attempt${remaining === 1 ? '' : 's'} remaining before temporary lockout)`);
        }
        setSubmitting(false);
        return;
      }

      // Step 2: Clear failed attempts on success and log audit
      clearFailedAttempts(cleanUsername);
      logAuditEvent({
        action_type: "AUTH_LOGIN",
        entity_type: "USER",
        entity_id: authUser.user_id,
        metadata: { username: authUser.username, role: authUser.role_name },
      });

      // Step 3: Show success overlay on the login page
      setLoggedInUser(authUser);
      setLoginSuccess(true);

      // Step 4: After 2 seconds, set user state and redirect
      setTimeout(() => {
        setCurrentUser(authUser);
        navigate(getPostLoginPath(authUser));
      }, 2000);
    } catch (err: any) {
      setError(err?.message || 'Invalid username or password');
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    if (externalSubmitting) return;
    setExternalSubmitting(true);
    setError('');
    setNotice('');

    try {
      await signInWithGoogle();
    } catch (googleError) {
      setError(googleError instanceof Error ? googleError.message : 'Google sign-in is not available right now.');
      setExternalSubmitting(false);
    }
  };

  const handleForgotPassword = async (e?: React.FormEvent | React.MouseEvent) => {
    e?.preventDefault();
    if (submitting || resetCooldownRemaining > 0) return;
    setSubmitting(true);
    setError('');
    setNotice('');

    try {
      await requestPasswordReset(resetEmail);
      setResetStep('otp');
      setResetOtp('');
      setResetPassword('');
      setResetConfirmPassword('');

      // Dynamic 10-minute (600s) OTP expiry timer
      const expiresTime = Date.now() + 10 * 60 * 1000;
      setOtpExpiresUntil(expiresTime);
      setOtpExpiresRemaining(600);
      sessionStorage.setItem('meryl_otp_expires_until', String(expiresTime));

      // 60-second rate limit cooldown for resending OTP
      const cooldownTime = Date.now() + 60 * 1000;
      setResetCooldownUntil(cooldownTime);
      setResetCooldownRemaining(60);
      sessionStorage.setItem('meryl_reset_cooldown_until', String(cooldownTime));

      setNotice('Verification code sent to your email! Please check your inbox and enter the 6 to 8-digit code below.');
    } catch (resetError) {
      const message = resetError instanceof Error ? resetError.message : 'Unable to send password reset request right now.';

      // Parse seconds from Supabase rate limit error (e.g. "For security purposes, you can only request this after 133 seconds.")
      const secondsMatch = message.match(/(\d+)\s*seconds?/i);
      if (secondsMatch && secondsMatch[1]) {
        const secs = parseInt(secondsMatch[1], 10);
        if (secs > 0) {
          const until = Date.now() + secs * 1000;
          setResetCooldownUntil(until);
          setResetCooldownRemaining(secs);
          sessionStorage.setItem('meryl_reset_cooldown_until', String(until));
          setError('');
          return;
        }
      }

      setError(message.includes('rate limit') ? 'Email rate limit exceeded. Please wait a few moments before requesting another reset.' : message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyResetOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    const cleanOtp = resetOtp.trim().replace(/\D/g, '');
    if (!cleanOtp || cleanOtp.length < 6 || cleanOtp.length > 8) {
      setError('Please enter the 6 to 8-digit OTP code sent to your email.');
      return;
    }

    if (otpExpiresUntil > 0 && otpExpiresRemaining <= 0) {
      setError('This OTP code has expired. Please click "Resend OTP" to request a fresh code.');
      return;
    }

    if (resetPassword.trim().length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (resetPassword !== resetConfirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');

    try {
      await verifyPasswordResetOtpAndUpdate(resetEmail, cleanOtp, resetPassword);
      setResetSuccess(true);
      setError('');
      setNotice('');

      // Clear timers and storage
      setOtpExpiresUntil(0);
      setOtpExpiresRemaining(0);
      sessionStorage.removeItem('meryl_otp_expires_until');
      setResetCooldownUntil(0);
      setResetCooldownRemaining(0);
      sessionStorage.removeItem('meryl_reset_cooldown_until');

      window.setTimeout(() => {
        setForgotMode(false);
        setResetStep('email');
        setResetOtp('');
        setResetPassword('');
        setResetConfirmPassword('');
        setPassword('');
        setResetSuccess(false);
        setNotice('Password updated successfully! You can now sign in with your new password.');
      }, 2000);
    } catch (resetError) {
      const message = resetError instanceof Error ? resetError.message : 'Unable to verify OTP right now.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const resetForgotState = () => {
    setForgotMode(false);
    setResetStep('email');
    setResetOtp('');
    setResetPassword('');
    setResetConfirmPassword('');
    setError('');
    setNotice('');
  };

  return (
    <div className="min-h-screen bg-[#0E0E12] text-white flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-[#E5202A]/20 blur-3xl" />
      <div className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full bg-[#FFD60A]/15 blur-3xl" />
      <div className="absolute top-1/2 left-1/3 w-[300px] h-[300px] rounded-full bg-[#E5202A]/10 blur-3xl" />

      <div className="relative w-full max-w-5xl grid lg:grid-cols-2 gap-6 z-10">
        {/* Left: Brand panel */}
        <div className="hidden lg:flex flex-col justify-between rounded-3xl p-8 bg-gradient-to-br from-[#E5202A] via-[#C71820] to-[#7A0F14] relative overflow-hidden">
          <div className="absolute -right-10 -top-10 w-72 h-72 rounded-full bg-[#FFD60A]/20 blur-3xl" />
          <div className="absolute right-20 bottom-0 w-48 h-48 rounded-full bg-[#FFD60A]/10 blur-2xl" />

          <div className="relative flex items-center gap-4">
            <BrandLogo size="xl" className="ring-white/60 shadow-[0_18px_45px_rgba(0,0,0,0.5)]" />
            <div>
              <div className="text-white text-xl font-bold tracking-wide">Meryl Shoes</div>
            </div>
          </div>

          <div className="relative">
            <div className="text-[11px] uppercase tracking-widest text-[#FFD60A]/90">Welcome back</div>
            <h1 className="mt-3 text-white text-4xl tracking-tight leading-tight">
              Run your store<br/>with confidence.
            </h1>
            <p className="mt-3 text-white/80 text-sm max-w-sm">
              Real-time POS, inventory, and sales analytics designed for daily operations.
            </p>
          </div>
          <div className="relative h-16" />
        </div>

        {/* Right: Form */}
        <div className="rounded-3xl p-8 bg-[#16161C] border border-white/5">
          <div className="flex items-center justify-between mb-8">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[#FFD60A]">Sign in</div>
              <h2 className="mt-1 text-white text-2xl tracking-tight">
                {forgotMode ? 'Reset Password' : 'Login Portal'}
              </h2>
            </div>
            <BrandLogo size="sm" className="lg:hidden" />
          </div>

          {forgotMode ? (
            resetSuccess ? (
              <div className="py-10 flex flex-col items-center text-center space-y-4 animate-in zoom-in-95 duration-300">
                <div className="relative my-2">
                  <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping opacity-60" style={{ animationDuration: '2s' }} />
                  <div className="relative w-16 h-16 rounded-full bg-gradient-to-tr from-emerald-600/30 via-emerald-500/20 to-teal-400/20 border border-emerald-500/40 flex items-center justify-center shadow-[0_0_30px_rgba(16,185,129,0.35)]">
                    <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-white text-xl font-bold">Password Updated!</h3>
                  <p className="text-xs text-white/60 max-w-xs">
                    Your password has been changed successfully. Returning to login...
                  </p>
                </div>
                <div className="w-36 h-1 rounded-full bg-white/10 overflow-hidden mt-2">
                  <div className="h-full bg-emerald-400 rounded-full" style={{ animation: 'progressBar 2s ease-in-out forwards' }} />
                </div>
              </div>
            ) : (
            <form onSubmit={resetStep === 'email' ? handleForgotPassword : handleVerifyResetOtp} className="space-y-4">
              {resetStep === 'email' ? (
                <div>
                  <label className="text-xs text-white/60 mb-1.5 block">Registered email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                    <input
                      type="email"
                      placeholder="Enter registered email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      required
                      className="w-full pl-10 pr-3 py-2.5 bg-[#1D1D25] border border-white/5 rounded-xl text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#FFD60A]/40 focus:ring-2 focus:ring-[#FFD60A]/20 transition"
                    />
                  </div>
                  {resetCooldownRemaining > 0 && (
                    <p className="mt-2 text-xs text-amber-400/90 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 animate-pulse" />
                      Please wait {resetCooldownRemaining}s before requesting another reset.
                    </p>
                  )}
                </div>
              ) : (
                <>
                  {/* Compact email summary pill */}
                  <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#1D1D25] border border-white/5">
                    <div className="flex items-center gap-2 text-xs text-white/70 min-w-0">
                      <Mail className="w-3.5 h-3.5 text-[#FFD60A] shrink-0" />
                      <span className="truncate font-medium text-white">{resetEmail}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setResetStep('email');
                        setError('');
                        setNotice('');
                      }}
                      className="text-[11px] text-[#FFD60A] hover:text-[#FFE66D] hover:underline font-medium shrink-0 ml-2 cursor-pointer"
                    >
                      Change
                    </button>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs text-white/60 block">Email OTP code (6 to 8 digits)</label>
                      {otpExpiresUntil > 0 && (
                        otpExpiresRemaining > 0 ? (
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono border transition-colors ${
                            otpExpiresRemaining <= 60
                              ? 'bg-amber-500/20 border-amber-400/50 text-amber-300 animate-pulse'
                              : 'bg-emerald-500/15 border-emerald-400/30 text-emerald-300'
                          }`}>
                            <Clock className="w-3 h-3" />
                            Expires in {formatTimer(otpExpiresRemaining)}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-mono bg-red-500/20 border border-red-500/40 text-red-300 font-semibold animate-pulse">
                            <AlertTriangle className="w-3 h-3" />
                            Expired (00:00)
                          </span>
                        )
                      )}
                    </div>
                    <div className="relative">
                      <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={8}
                        placeholder="Enter 6 to 8-digit OTP code"
                        value={resetOtp}
                        onChange={(e) => setResetOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                        required
                        className={`w-full pl-10 pr-3 py-2.5 bg-[#1D1D25] border rounded-xl text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 transition tracking-wider font-mono ${
                          otpExpiresUntil > 0 && otpExpiresRemaining <= 0
                            ? 'border-red-500/60 focus:border-red-500 focus:ring-red-500/20'
                            : 'border-white/5 focus:border-[#FFD60A]/40 focus:ring-[#FFD60A]/20'
                        }`}
                      />
                    </div>
                    {otpExpiresUntil > 0 && otpExpiresRemaining <= 0 && (
                      <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-red-400" />
                        OTP code has expired. Please click <strong>Resend OTP</strong> below.
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-white/60 mb-1.5 block">New password</label>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <input
                        type={showResetPassword ? 'text' : 'password'}
                        placeholder="At least 8 characters"
                        value={resetPassword}
                        onChange={(e) => setResetPassword(e.target.value)}
                        required
                        className="w-full pl-10 pr-10 py-2.5 bg-[#1D1D25] border border-white/5 rounded-xl text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#FFD60A]/40 focus:ring-2 focus:ring-[#FFD60A]/20 transition"
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetPassword(!showResetPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition"
                        tabIndex={-1}
                      >
                        {showResetPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-white/60 mb-1.5 block">Confirm password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                      <input
                        type={showResetConfirmPassword ? 'text' : 'password'}
                        placeholder="Re-enter new password"
                        value={resetConfirmPassword}
                        onChange={(e) => setResetConfirmPassword(e.target.value)}
                        required
                        className="w-full pl-10 pr-10 py-2.5 bg-[#1D1D25] border border-white/5 rounded-xl text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#FFD60A]/40 focus:ring-2 focus:ring-[#FFD60A]/20 transition"
                      />
                      <button
                        type="button"
                        onClick={() => setShowResetConfirmPassword(!showResetConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition"
                        tabIndex={-1}
                      >
                        {showResetConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {error ? (
                <div className="rounded-xl px-3.5 py-2.5 bg-[#E5202A]/15 border border-[#E5202A]/30 text-xs text-[#FF6B72] flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-[#FF6B72]" />
                  <span>{error}</span>
                </div>
              ) : notice ? (
                <div className="rounded-xl px-3.5 py-2.5 bg-emerald-500/10 border border-emerald-400/25 text-xs text-emerald-200 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{notice}</span>
                </div>
              ) : null}

              <Button
                type="submit"
                disabled={
                  submitting ||
                  (resetStep === 'email' && resetCooldownRemaining > 0) ||
                  (resetStep === 'otp' && (
                    (otpExpiresUntil > 0 && otpExpiresRemaining <= 0) ||
                    resetOtp.length < 6 ||
                    resetPassword.length < 8 ||
                    !resetConfirmPassword
                  ))
                }
                className="w-full h-11 rounded-xl bg-[#FFD60A] hover:bg-[#ffcf24] text-[#15151B] shadow-lg shadow-yellow-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium flex items-center justify-center"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin text-[#15151B]" />
                    <span>{resetStep === 'email' ? 'Sending Reset OTP...' : 'Verifying & Resetting...'}</span>
                  </>
                ) : resetStep === 'email' ? (
                  resetCooldownRemaining > 0 ? (
                    <>
                      <Clock className="w-4 h-4 mr-2" />
                      <span>Wait {resetCooldownRemaining}s to Resend</span>
                    </>
                  ) : (
                    <>
                      <Mail className="w-4 h-4 mr-2" />
                      <span>Send Reset OTP</span>
                    </>
                  )
                ) : (
                  <>
                    <ShieldCheck className="w-4 h-4 mr-2" />
                    <span>Verify OTP and Reset Password</span>
                  </>
                )}
              </Button>

              {resetStep === 'otp' && (
                <Button
                  type="button"
                  disabled={submitting || resetCooldownRemaining > 0}
                  onClick={handleForgotPassword}
                  className="h-11 w-full rounded-xl border border-white/10 bg-[#1D1D25] text-white hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin text-yellow-400" />
                      <span>Sending fresh code...</span>
                    </>
                  ) : resetCooldownRemaining > 0 ? (
                    <>
                      <Clock className="w-4 h-4 mr-2 text-yellow-400 animate-pulse" />
                      <span>Resend OTP in {resetCooldownRemaining}s</span>
                    </>
                  ) : (
                    <>
                      <RotateCcw className="w-4 h-4 mr-2 text-yellow-400" />
                      <span>Resend OTP</span>
                    </>
                  )}
                </Button>
              )}

              <Button
                type="button"
                disabled={submitting}
                onClick={resetForgotState}
                className="h-11 w-full rounded-xl border border-white/10 bg-[#1D1D25] text-white hover:bg-white/10"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Login
              </Button>
            </form>
            )
          ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            {lockoutRemaining > 0 && (
              <div className="rounded-xl px-4 py-3 bg-red-950/70 border border-red-500/40 text-sm text-red-200 flex items-start gap-2.5 animate-in fade-in">
                <ShieldAlert className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold text-red-300">Account Temporarily Locked</p>
                  <p className="text-xs text-zinc-300 mt-0.5">
                    Too many consecutive failed attempts. Please wait{' '}
                    <span className="font-mono font-bold text-yellow-400">
                      {Math.floor(lockoutRemaining / 60)}:{(lockoutRemaining % 60).toString().padStart(2, '0')}
                    </span>{' '}
                    before trying again.
                  </p>
                </div>
              </div>
            )}

            <div>
              <label className="text-xs text-white/60 mb-1.5 block">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type="text"
                  placeholder="Enter username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                  required
                  className="w-full pl-10 pr-3 py-2.5 bg-[#1D1D25] border border-white/5 rounded-xl text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#FFD60A]/40 focus:ring-2 focus:ring-[#FFD60A]/20 transition lowercase"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-white/60 block">Password</label>
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setNotice('');
                    setForgotMode(true);
                  }}
                  className="text-xs text-[#FFD60A] hover:text-[#FFE66D] hover:underline transition font-medium cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full pl-10 pr-10 py-2.5 bg-[#1D1D25] border border-white/5 rounded-xl text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#FFD60A]/40 focus:ring-2 focus:ring-[#FFD60A]/20 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && lockoutRemaining === 0 && (
              <div className="rounded-xl px-3 py-2.5 bg-[#E5202A]/15 border border-[#E5202A]/30 text-sm text-[#FF6B72]">
                {error}
              </div>
            )}

            {notice && (
              <div className="rounded-xl px-4 py-3 bg-emerald-500/20 border border-emerald-400/40 text-sm text-emerald-200 flex items-center gap-2.5 transition-all duration-300">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                <span className="font-medium">{notice}</span>
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting || lockoutRemaining > 0}
              className="w-full h-11 rounded-xl bg-gradient-to-r from-[#E5202A] to-[#B81820] hover:from-[#C71820] hover:to-[#9A1218] text-white shadow-lg shadow-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <LogIn className="w-4 h-4 mr-2" />
              {lockoutRemaining > 0 ? 'Locked (Please Wait)' : 'Sign in'}
            </Button>
          </form>
          )}

          {!forgotMode && (
          <>
          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-white/10" />
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-white/40">
              <ShieldCheck className="h-3.5 w-3.5 text-[#FFD60A]" />
              Secure options
            </div>
            <div className="h-px flex-1 bg-white/10" />
          </div>

          <div className="space-y-3">
            <Button
              type="button"
              disabled={externalSubmitting || submitting}
              onClick={handleGoogleLogin}
              className="h-11 w-full rounded-xl border border-white/10 bg-[#1D1D25] text-white hover:bg-white/10"
            >
              <span className="mr-2 grid h-5 w-5 place-items-center rounded-full bg-white text-sm font-bold text-[#E5202A]">
                G
              </span>
              {externalSubmitting ? 'Opening Google...' : 'Continue with Google'}
            </Button>
            <p className="px-1 text-[11px] leading-4 text-white/45">
              Google sign-in now includes OTP verification before access.
            </p>
          </div>
          </>
          )}

        </div>
      </div>

      {/* Login Success Overlay */}
      {loginSuccess && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="relative w-full max-w-sm mx-4 overflow-hidden rounded-3xl bg-[#15151F]/95 border border-white/10 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.85)] flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
            {/* Top decorative gradient bar */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 via-[#FFD60A] to-teal-400" />

            {/* Ambient glows */}
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 w-48 h-48 bg-emerald-500/15 rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 w-48 h-48 bg-[#FFD60A]/10 rounded-full blur-3xl pointer-events-none" />

            {/* Animated Checkmark Badge */}
            <div className="relative my-2">
              <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping opacity-60" style={{ animationDuration: '2s' }} />
              <div className="relative w-20 h-20 rounded-full bg-gradient-to-tr from-emerald-600/25 via-emerald-500/20 to-teal-400/20 border border-emerald-500/40 flex items-center justify-center shadow-[0_0_35px_rgba(16,185,129,0.35)]">
                <svg className="w-10 h-10 text-emerald-400" viewBox="0 0 52 52" fill="none">
                  <circle
                    cx="26"
                    cy="26"
                    r="23"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="opacity-20"
                  />
                  <circle
                    cx="26"
                    cy="26"
                    r="23"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    className="success-circle-draw"
                  />
                  <path
                    d="M16 26.5L23 33.5L36 18.5"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="success-check-draw"
                  />
                </svg>
              </div>
            </div>

            {/* Heading & Greeting */}
            <div className="mt-4 space-y-1">
              <h3 className="text-2xl font-bold text-white tracking-tight">Login Successful!</h3>
              <p className="text-xs text-white/60">
                {loggedInUser ? (
                  <span>Welcome back, <strong className="text-white font-medium">{loggedInUser.name || loggedInUser.username}</strong></span>
                ) : (
                  'Welcome to Meryl Shoes'
                )}
              </p>
            </div>

            {/* Role Badge */}
            {loggedInUser?.role_name && (
              <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FFD60A]/10 border border-[#FFD60A]/25 text-[#FFD60A] text-[11px] font-semibold tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FFD60A] animate-pulse" />
                {loggedInUser.role_name.replace(/_/g, ' ')}
              </div>
            )}

            {/* Status & Progress Bar */}
            <div className="w-full mt-6 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-white/40 font-medium">
                <span>Entering workspace...</span>
                <span className="text-emerald-400 font-mono">Ready</span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/5 overflow-hidden p-0.5 border border-white/5">
                <div 
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-[#FFD60A]" 
                  style={{ animation: 'loginProgressBar 2s cubic-bezier(0.4, 0, 0.2, 1) forwards' }} 
                />
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes checkDraw {
          0% { stroke-dashoffset: 40; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes circleDraw {
          0% { stroke-dashoffset: 145; }
          100% { stroke-dashoffset: 0; }
        }
        @keyframes loginProgressBar {
          0% { width: 0%; }
          100% { width: 100%; }
        }
        @keyframes progressBar {
          from { width: 0%; }
          to { width: 100%; }
        }
        .success-check-draw {
          stroke-dasharray: 40;
          stroke-dashoffset: 40;
          animation: checkDraw 0.6s cubic-bezier(0.65, 0, 0.45, 1) 0.25s forwards;
        }
        .success-circle-draw {
          stroke-dasharray: 145;
          stroke-dashoffset: 145;
          transform: rotate(-90deg);
          transform-origin: 50% 50%;
          animation: circleDraw 0.5s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
