import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../lib/auth-context";
import { supabase } from "../../lib/supabase";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import {
  User,
  Mail,
  Upload,
  Link,
  Trash2,
  Lock,
  ShieldCheck,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  X,
  Sparkles,
  ArrowLeft,
  Eye,
  EyeOff,
  Clock,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "../../lib/api/audit-logger";
import {
  getStoredAvatarSync,
  getStoredAvatarAsync,
  saveStoredAvatar,
  removeStoredAvatar,
  uploadAvatarToSupabaseStorage,
} from "../../lib/avatar-store";

interface PortalProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: "profile" | "security";
}

export function PortalProfileSettingsModal({
  isOpen,
  onClose,
  defaultTab = "profile",
}: PortalProfileSettingsModalProps) {
  const { user: currentUser, setCurrentUser, requestPasswordReset, verifyPasswordResetOtpAndUpdate, logout } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<"profile" | "security">(defaultTab);

  // Profile fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [pendingAvatarFile, setPendingAvatarFile] = useState<File | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");

  // Password reset OTP state
  const [securityStep, setSecurityStep] = useState<"request" | "verify" | "success">("request");
  const [resetEmail, setResetEmail] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [otpExpiresRemaining, setOtpExpiresRemaining] = useState(0);
  const [securityError, setSecurityError] = useState("");

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(Math.max(0, totalSeconds) / 60);
    const secs = Math.max(0, totalSeconds) % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    if (isOpen) {
      setActiveTab(defaultTab);
      setName(currentUser?.name || "");
      setEmail(currentUser?.email || "");

      const currentAvatar =
        currentUser?.avatar_url ||
        getStoredAvatarSync({
          userId: currentUser?.user_id,
          username: currentUser?.username,
          email: currentUser?.email,
        }) ||
        "";

      setAvatarUrl(currentAvatar);
      setUrlInput(currentAvatar);
      setShowUrlInput(false);
      setProfileError("");
      setProfileNotice("");

      if (!currentAvatar && currentUser) {
        getStoredAvatarAsync({
          userId: currentUser.user_id,
          username: currentUser.username,
          email: currentUser.email,
        }).then(async (asyncAvatar) => {
          if (asyncAvatar) {
            setAvatarUrl(asyncAvatar);
            setUrlInput(asyncAvatar);
          } else {
            try {
              const { data } = await supabase
                .from("user")
                .select("avatar_url")
                .eq("user_id", currentUser.user_id)
                .maybeSingle();
              if (data?.avatar_url) {
                setAvatarUrl(data.avatar_url);
                setUrlInput(data.avatar_url);
                saveStoredAvatar(
                  {
                    userId: currentUser.user_id,
                    username: currentUser.username,
                    email: currentUser.email,
                  },
                  data.avatar_url
                );
              }
            } catch {
              // Ignore if column doesn't exist or network error
            }
          }
        });
      }

      setSecurityStep("request");
      setResetEmail(currentUser?.email || "");
      setResetOtp("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setSecurityError("");
      setResendCooldown(0);
      setOtpExpiresRemaining(0);
    }
  }, [isOpen, defaultTab, currentUser]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = window.setInterval(() => {
      setResendCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [resendCooldown]);

  useEffect(() => {
    if (otpExpiresRemaining <= 0) return;
    const interval = window.setInterval(() => {
      setOtpExpiresRemaining((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [otpExpiresRemaining]);

  if (!isOpen) return null;

  // Resize uploaded image to keep it lightweight (max 512x512, jpeg)
  const resizeImageToDataUrl = (file: File, maxDimension = 512, quality = 0.88): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const rawResult = e.target?.result as string;
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(rawResult);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => resolve(rawResult);
        img.src = rawResult;
      };
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    });
  };

  // Handle Photo File Upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload a valid image file (PNG, JPG, WEBP, etc.)");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image size exceeds 5MB limit. Please choose a smaller image.");
      return;
    }

    setPendingAvatarFile(file);
    const dataUrl = await resizeImageToDataUrl(file);
    if (dataUrl) {
      setAvatarUrl(dataUrl);
      setUrlInput("");
      setShowUrlInput(false);
      toast.success("Profile photo selected! Click Save Changes to upload to Supabase.");
    }
  };

  const handleApplyUrl = () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setProfileError("Please enter an image URL.");
      return;
    }
    setAvatarUrl(trimmed);
    setPendingAvatarFile(null);
    setShowUrlInput(false);
    setProfileError("");
    toast.success("Image URL applied! Click Save Changes to apply.");
  };

  const handleRemovePhoto = () => {
    setAvatarUrl("");
    setPendingAvatarFile(null);
    setUrlInput("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    toast.info("Profile photo cleared. Click Save Changes to apply.");
  };

  // Save Profile Changes
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;

    const trimmedName = name.trim();
    const trimmedEmail = email.trim().toLowerCase();

    if (!trimmedName) {
      setProfileError("Name cannot be empty.");
      return;
    }

    setIsSavingProfile(true);
    setProfileError("");
    setProfileNotice("");

    try {
      // 1. Upload to Supabase Storage if a new file was chosen
      let finalAvatarUrl = avatarUrl;
      if (pendingAvatarFile && currentUser) {
        toast.loading("Uploading avatar to Supabase Storage...", { id: "avatar-upload" });
        const cloudUrl = await uploadAvatarToSupabaseStorage(currentUser.user_id, pendingAvatarFile);
        toast.dismiss("avatar-upload");
        if (cloudUrl) {
          finalAvatarUrl = cloudUrl;
        }
      }

      // 2. Check duplicate email if email was changed
      if (trimmedEmail && trimmedEmail !== (currentUser.email || "").toLowerCase()) {
        const { data: existingUser } = await supabase
          .from("user")
          .select("user_id")
          .ilike("email", trimmedEmail)
          .neq("user_id", currentUser.user_id)
          .limit(1);

        if (existingUser && existingUser.length > 0) {
          throw new Error("This email is already registered to another account.");
        }
      }

      // 3. Update user row in database
      // Ensure we NEVER store raw base64 data URIs in the database table
      const isCloudUrl = Boolean(
        finalAvatarUrl &&
        (finalAvatarUrl.startsWith("http://") || finalAvatarUrl.startsWith("https://")) &&
        !finalAvatarUrl.startsWith("data:")
      );
      const dbAvatarUrl = isCloudUrl ? finalAvatarUrl : null;

      const updateData: { name: string; email?: string; avatar_url?: string | null } = {
        name: trimmedName,
        avatar_url: dbAvatarUrl,
      };
      if (trimmedEmail) {
        updateData.email = trimmedEmail;
      }

      let { error: dbError } = await supabase
        .from("user")
        .update(updateData)
        .eq("user_id", currentUser.user_id);

      // If avatar_url column doesn't exist yet in user's Supabase schema, retry without it
      if (dbError && String(dbError.message || "").toLowerCase().includes("avatar_url")) {
        delete updateData.avatar_url;
        const retry = await supabase
          .from("user")
          .update(updateData)
          .eq("user_id", currentUser.user_id);
        dbError = retry.error;
      }

      if (dbError) {
        throw new Error(dbError.message || "Failed to update profile in database.");
      }

      // 4. Save or remove from persistent avatar store (IndexedDB + memoryCache)
      if (!finalAvatarUrl && currentUser) {
        await removeStoredAvatar({
          userId: currentUser.user_id,
          username: currentUser.username,
          email: currentUser.email || undefined,
        });
      } else if (finalAvatarUrl && currentUser) {
        await saveStoredAvatar(
          {
            userId: currentUser.user_id,
            username: currentUser.username,
            email: currentUser.email || undefined,
          },
          finalAvatarUrl
        );
      }

      // 5. Update auth context with new profile info and avatar
      const updatedUser = {
        ...currentUser,
        name: trimmedName,
        email: trimmedEmail || currentUser.email,
        avatar_url: finalAvatarUrl || undefined,
      };

      setCurrentUser(updatedUser);
      setPendingAvatarFile(null);
      setAvatarUrl(finalAvatarUrl);

      // 4. Audit log
      await logAuditEvent({
        action_type: "UPDATE_PROFILE",
        entity_type: "USER",
        entity_id: currentUser.user_id,
        metadata: {
          previous_name: currentUser.name,
          updated_name: trimmedName,
          updated_email: trimmedEmail,
          has_avatar: Boolean(avatarUrl),
        },
      }).catch(() => null);

      setProfileNotice("Profile updated successfully!");
      toast.success("Profile updated successfully!");
    } catch (err: any) {
      const msg = err?.message || "Could not save profile changes.";
      setProfileError(msg);
      toast.error(msg);
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Password Reset OTP Handler
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = resetEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setSecurityError("Please enter a valid email address.");
      return;
    }

    setIsSendingOtp(true);
    setSecurityError("");

    try {
      await requestPasswordReset(cleanEmail);
      setSecurityStep("verify");
      setResendCooldown(60);
      setOtpExpiresRemaining(600);
      toast.success("Verification OTP code sent to your email!");
    } catch (err: any) {
      const msg = err?.message || "Failed to send reset OTP. Check your email.";
      setSecurityError(msg);
      toast.error(msg);
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanOtp = resetOtp.trim().replace(/\D/g, "");
    const cleanPassword = newPassword.trim();
    const cleanConfirm = confirmPassword.trim();

    if (!cleanOtp || cleanOtp.length < 6 || cleanOtp.length > 8) {
      setSecurityError("Please enter the complete 6 to 8-digit OTP code.");
      return;
    }

    if (otpExpiresRemaining <= 0) {
      setSecurityError("This OTP code has expired. Please click Resend OTP to request a fresh code.");
      return;
    }

    if (cleanPassword.length < 8) {
      setSecurityError("New password must be at least 8 characters.");
      return;
    }

    if (cleanPassword !== cleanConfirm) {
      setSecurityError("Passwords do not match.");
      return;
    }

    setIsVerifyingOtp(true);
    setSecurityError("");

    try {
      await verifyPasswordResetOtpAndUpdate(resetEmail.trim().toLowerCase(), cleanOtp, cleanPassword, {
        keepSession: true,
      });

      await logAuditEvent({
        action_type: "PASSWORD_RESET_OTP",
        entity_type: "USER",
        entity_id: currentUser?.user_id,
        metadata: {
          email: resetEmail.trim().toLowerCase(),
          location: "portal_settings",
        },
      }).catch(() => null);

      setSecurityStep("success");
      toast.success("Password changed successfully!");
    } catch (err: any) {
      const msg = err?.message || "Invalid or expired OTP. Please try again.";
      setSecurityError(msg);
      toast.error(msg);
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const userInitial = (name || currentUser?.name || currentUser?.username || "U").charAt(0).toUpperCase();

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200"
    >
      <div className="w-full max-w-lg rounded-2xl border border-[#2c2c3d] bg-[#14141d] p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 text-white relative max-h-[92vh] overflow-y-auto">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-lg p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white transition"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 shadow-inner">
            <User className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white leading-tight">Account & Personalization</h2>
            <p className="text-xs text-yellow-200/60">Customize your portal profile and security settings</p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex rounded-xl bg-[#1c1c28] p-1 border border-white/5">
          <button
            type="button"
            onClick={() => setActiveTab("profile")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-lg transition ${
              activeTab === "profile"
                ? "bg-yellow-400 text-black shadow-md hover:bg-yellow-300"
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <Sparkles className={`w-3.5 h-3.5 ${activeTab === "profile" ? "text-black" : "text-yellow-400"}`} />
            Profile & Personalization
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("security")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-xs font-bold rounded-lg transition ${
              activeTab === "security"
                ? "bg-yellow-400 text-black shadow-md hover:bg-yellow-300"
                : "text-zinc-400 hover:text-white hover:bg-white/5"
            }`}
          >
            <KeyRound className={`w-3.5 h-3.5 ${activeTab === "security" ? "text-black" : "text-yellow-400"}`} />
            Reset Password (OTP)
          </button>
        </div>

        {/* ======================================================== */}
        {/* TAB 1: PROFILE & PERSONALIZATION                         */}
        {/* ======================================================== */}
        {activeTab === "profile" && (
          <form onSubmit={handleSaveProfile} className="space-y-4 text-left">
            {profileError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{profileError}</span>
              </div>
            )}

            {profileNotice && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{profileNotice}</span>
              </div>
            )}

            {/* Profile Picture Section */}
            <div className="p-4 rounded-xl border border-[#2a2a3c] bg-[#191926] space-y-3">
              <Label className="text-xs font-semibold text-yellow-200/90 block">
                Profile Picture (PFP)
              </Label>

              <div className="flex items-center gap-4">
                {/* Avatar Preview */}
                <div className="relative group shrink-0">
                  <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-yellow-400/40 bg-[#252538] flex items-center justify-center text-xl font-bold text-yellow-300 shadow-md">
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt="Profile avatar"
                        className="w-full h-full object-cover"
                        onError={() => {
                          toast.error("Could not load image URL. Reverting to initial.");
                          setAvatarUrl("");
                        }}
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#FFD60A] to-[#FFB800] text-[#1A1A22] flex items-center justify-center text-xl font-extrabold shadow-inner">
                        {userInitial}
                      </div>
                    )}
                  </div>
                </div>

                {/* Upload & Link Controls */}
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept="image/*"
                      className="hidden"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      className="h-8 rounded-lg bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-semibold"
                    >
                      <Upload className="w-3.5 h-3.5 mr-1.5" />
                      Upload Photo
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setShowUrlInput((prev) => !prev)}
                      className="h-8 rounded-lg border-[#35354a] bg-[#202030] text-zinc-300 hover:bg-[#28283c] hover:text-white text-xs"
                    >
                      <Link className="w-3.5 h-3.5 mr-1.5" />
                      {showUrlInput ? "Hide URL" : "Image URL"}
                    </Button>

                    {avatarUrl && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={handleRemovePhoto}
                        className="h-8 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 text-xs"
                      >
                        <Trash2 className="w-3.5 h-3.5 mr-1" />
                        Remove
                      </Button>
                    )}
                  </div>

                  <p className="text-[11px] text-zinc-400">
                    Upload PNG, JPG, or WEBP (max 2MB), or paste an external image URL.
                  </p>
                </div>
              </div>

              {/* URL Input collapse */}
              {showUrlInput && (
                <div className="pt-2 flex gap-2 animate-in fade-in duration-150">
                  <Input
                    type="url"
                    placeholder="https://example.com/avatar.jpg"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    className="h-9 text-xs bg-[#12121a] border-[#2c2c3e] text-yellow-100 placeholder:text-zinc-500"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleApplyUrl}
                    className="h-9 bg-yellow-400 hover:bg-yellow-300 text-black text-xs font-semibold shrink-0"
                  >
                    Apply URL
                  </Button>
                </div>
              )}
            </div>

            {/* Display Name */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-yellow-200/90">
                Display Name <span className="text-red-400">*</span>
              </Label>
              <Input
                type="text"
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (profileError) setProfileError("");
                }}
                placeholder="e.g. Maria Clara"
                className="h-10 rounded-xl border-[#2f3142] bg-[#1c1c28] text-sm text-yellow-100 placeholder:text-zinc-500 focus-visible:ring-yellow-400/50"
              />
            </div>

            {/* Email Address */}
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-yellow-200/90 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-yellow-400" />
                Email Address
              </Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (profileError) setProfileError("");
                }}
                placeholder="e.g. staff@merylshoes.com"
                className="h-10 rounded-xl border-[#2f3142] bg-[#1c1c28] text-sm text-yellow-100 placeholder:text-zinc-500 focus-visible:ring-yellow-400/50"
              />
              <p className="text-[11px] text-zinc-400">
                This email is used to receive OTP verification codes when resetting your password.
              </p>
            </div>

            {/* Read-only account info */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="p-2.5 rounded-lg border border-[#2a2a3c] bg-[#181824] text-xs">
                <span className="text-zinc-400 block text-[10px] uppercase font-semibold">Username</span>
                <span className="font-mono text-yellow-300">@{currentUser?.username || "user"}</span>
              </div>
              <div className="p-2.5 rounded-lg border border-[#2a2a3c] bg-[#181824] text-xs">
                <span className="text-zinc-400 block text-[10px] uppercase font-semibold">Assigned Role</span>
                <Badge className="bg-yellow-400/10 text-yellow-300 border-yellow-400/30 text-[10px] mt-0.5">
                  {currentUser?.role_name || "Staff"}
                </Badge>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-3">
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
                disabled={isSavingProfile || !name.trim()}
                className="flex-1 h-10 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold shadow-md"
              >
                {isSavingProfile ? (
                  <span className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Saving...
                  </span>
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </form>
        )}

        {/* ======================================================== */}
        {/* TAB 2: PASSWORD RESET VIA OTP                            */}
        {/* ======================================================== */}
        {activeTab === "security" && (
          <div className="space-y-4 text-left">
            {securityError && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{securityError}</span>
              </div>
            )}

            {/* STEP 1: REQUEST OTP */}
            {securityStep === "request" && (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-yellow-200/90 flex items-center gap-1.5">
                    <Mail className="w-3.5 h-3.5 text-yellow-400" />
                    Registered Account Email
                  </Label>
                  <Input
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => {
                      setResetEmail(e.target.value);
                      if (securityError) setSecurityError("");
                    }}
                    placeholder="Enter account email"
                    className="h-11 rounded-xl border-[#2f3142] bg-[#1c1c28] text-sm text-yellow-100 placeholder:text-zinc-500 focus-visible:ring-yellow-400/50"
                  />
                  <p className="text-[11px] text-zinc-400">
                    A 6 to 8-digit One-Time Password (OTP) will be sent to this email to authenticate password reset.
                  </p>
                </div>

                <div className="flex gap-2 pt-2">
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
                    disabled={isSendingOtp || !resetEmail.trim()}
                    className="flex-1 h-10 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold shadow-md"
                  >
                    {isSendingOtp ? (
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
            {securityStep === "verify" && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <div className="rounded-xl border border-yellow-400/20 bg-yellow-400/5 p-3 text-xs text-yellow-200/80 flex items-center justify-between">
                  <span className="truncate">OTP sent to: <strong>{resetEmail}</strong></span>
                  <button
                    type="button"
                    onClick={() => {
                      setSecurityStep("request");
                      setSecurityError("");
                    }}
                    className="text-yellow-400 hover:underline text-xs shrink-0 ml-2 font-medium"
                  >
                    Change
                  </button>
                </div>

                {/* OTP Input */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-semibold text-yellow-200/90 flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-yellow-400" />
                      Verification OTP (6 to 8 Digits)
                    </Label>
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
                    maxLength={8}
                    placeholder="12345678"
                    value={resetOtp}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/\D/g, "").slice(0, 8);
                      setResetOtp(cleaned);
                      if (securityError) setSecurityError("");
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
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-yellow-200/90 flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-yellow-400" />
                    New Password
                  </Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? "text" : "password"}
                      placeholder="At least 8 characters..."
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        if (securityError) setSecurityError("");
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
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-yellow-200/90">
                    Confirm New Password
                  </Label>
                  <Input
                    type={showPassword ? "text" : "password"}
                    placeholder="Re-enter new password..."
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      if (securityError) setSecurityError("");
                    }}
                    className="h-11 rounded-xl border-[#2f3142] bg-[#1c1c28] text-sm text-yellow-100 placeholder:text-zinc-500 focus-visible:ring-yellow-400/50"
                  />
                </div>

                {/* Submit & Resend */}
                <div className="flex flex-col gap-2 pt-2">
                  <Button
                    type="submit"
                    disabled={isVerifyingOtp || resetOtp.length < 6 || resetOtp.length > 8 || newPassword.length < 8 || !confirmPassword || otpExpiresRemaining <= 0}
                    className="w-full h-11 rounded-xl bg-yellow-400 hover:bg-yellow-300 text-black font-bold shadow-md transition"
                  >
                    {isVerifyingOtp ? (
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
                      onClick={() => setSecurityStep("request")}
                      className="inline-flex items-center gap-1 text-zinc-400 hover:text-white transition"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Back
                    </button>

                    <button
                      type="button"
                      disabled={resendCooldown > 0 || isSendingOtp}
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

            {/* STEP 3: SUCCESS */}
            {securityStep === "success" && (
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
        )}
      </div>
    </div>
  );
}

