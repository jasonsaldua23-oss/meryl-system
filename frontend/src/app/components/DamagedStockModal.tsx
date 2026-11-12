import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { AlertTriangle, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "../../lib/supabase";
import { logAuditEvent } from "../../lib/api/audit-logger";
import { useQueryClient } from "@tanstack/react-query";

function buildClientId(prefix = "id") {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

interface DamagedStockModalProps {
  product: {
    product_id: string;
    inventory_id?: string;
    sku: string;
    name: string;
    brand?: string;
    color?: string;
    size?: string;
    stock: number;
    available_stock?: number;
    unit_price?: number;
    srp?: number;
  } | null;
  isOpen: boolean;
  onClose: () => void;
  user?: { name?: string; email?: string; username?: string; role?: string } | null;
  currentUser?: { name?: string; email?: string; username?: string; role?: string } | null;
  onSuccess?: () => void;
}

export function DamagedStockModal({ product, isOpen, onClose, user, currentUser, onSuccess }: DamagedStockModalProps) {
  const activeUser = user || currentUser;
  const queryClient = useQueryClient();
  const [adjustmentQty, setAdjustmentQty] = useState<number>(1);
  const [reason, setReason] = useState<string>("Damaged Write-off");
  const [remarks, setRemarks] = useState<string>("");
  const [retireVariant, setRetireVariant] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!product) return null;

  const currentStock = Number(product.stock || 0);
  const maxDeductible = Math.max(0, currentStock);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!product) return;

    const qty = Math.floor(Number(adjustmentQty));
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Please enter a valid adjustment quantity (at least 1).");
      return;
    }
    if (qty > maxDeductible) {
      toast.error(`Cannot deduct ${qty} pairs. Current on-hand stock is only ${currentStock}.`);
      return;
    }
    if (!remarks.trim()) {
      toast.error("Please provide remarks explaining the damage or quarantine reason.");
      return;
    }

    const actor =
      activeUser?.name ||
      activeUser?.username ||
      activeUser?.email ||
      "Authorized Staff";

    const nextStock = Math.max(0, currentStock - qty);
    const nowIso = new Date().toISOString();

    try {
      setIsSubmitting(true);

      // 1. Update inventory stock_quantity
      if (product.inventory_id) {
        const updatePayload: Record<string, any> = {
          stock_quantity: nextStock,
          last_updated: nowIso,
        };
        if (retireVariant) {
          updatePayload.inventory_status = "inactive";
        }
        const { error: invErr } = await supabase
          .from("inventory")
          .update(updatePayload as any)
          .eq("inventory_id", product.inventory_id);
        if (invErr) throw invErr;
      }

      // If user chose to retire the entire variant, also set product status to inactive
      if (retireVariant) {
        await supabase
          .from("product")
          .update({ status: "inactive" } as any)
          .eq("product_id", product.product_id);
      }

      // 2. Create authoritative inventory_log entry
      const logId = buildClientId("invlog");
      const { error: logErr } = await supabase.from("inventory_log").insert({
        inventory_log_id: logId,
        product_id: product.product_id,
        quantity_change: -qty,
        transaction_type: "adjustment",
        reference_id: product.inventory_id || null,
        date_updated: nowIso,
      });
      if (logErr) {
        console.warn("Could not write to inventory_log directly:", logErr.message);
      }

      // 3. Log comprehensive audit event
      await logAuditEvent({
        action_type: "STOCK_DAMAGED_ADJUSTMENT",
        entity_type: "INVENTORY",
        entity_id: product.product_id,
        old_data: {
          stock_quantity: currentStock,
        },
        new_data: {
          stock_quantity: nextStock,
          adjustment_quantity: qty,
          reason,
          remarks: remarks.trim(),
          retired: retireVariant,
        },
        metadata: {
          product_id: product.product_id,
          sku: product.sku,
          product_name: product.name,
          color: product.color,
          size: product.size,
          previous_quantity: currentStock,
          new_quantity: nextStock,
          adjustment_quantity: qty,
          reason,
          remarks: remarks.trim(),
          actor,
          timestamp: nowIso,
        },
      });

      toast.success(
        `Recorded ${qty} damaged pair(s) for ${product.sku}. Stock reduced to ${nextStock}. Audit trail logged.`,
      );

      // Invalidate queries to refresh UI across tables
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["products"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory"] }),
        queryClient.invalidateQueries({ queryKey: ["inventory_logs"] }),
        queryClient.invalidateQueries({ queryKey: ["audit_logs"] }),
      ]);

      setAdjustmentQty(1);
      setRemarks("");
      setRetireVariant(false);
      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Failed to record damaged stock adjustment.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSubmitting && onClose()}>
      <DialogContent className="max-w-md bg-[#16161f] border border-[#2e2e3d] text-white p-6 shadow-2xl rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-red-400">
            <ShieldAlert className="w-5 h-5 text-red-500" />
            <DialogTitle className="text-lg font-bold text-white">Record Damaged / Stock Adjustment</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-zinc-400">
            Deduct defective or quarantined pairs from sellable inventory. Every deduction creates a traceable audit record.
          </DialogDescription>
        </DialogHeader>

        {/* Selected Product Summary */}
        <div className="bg-[#121218] border border-[#272736] rounded-xl p-3.5 space-y-1.5 text-xs">
          <div className="flex justify-between items-center">
            <span className="font-semibold text-white text-sm truncate">{product.name}</span>
            <span className="font-mono text-yellow-300 font-bold">{product.sku}</span>
          </div>
          <div className="flex gap-2 text-zinc-400">
            <span>{product.brand || "Meryl"}</span>
            <span>•</span>
            <span>{product.color || "Default"}</span>
            <span>•</span>
            <span>Size {product.size || "N/A"}</span>
          </div>
          <div className="flex justify-between items-center pt-2 border-t border-[#20202e] text-[11px]">
            <span className="text-zinc-400">Current On-Hand Stock:</span>
            <span className="font-bold text-emerald-400">{currentStock} pair{currentStock === 1 ? "" : "s"}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Reason Selection */}
          <div className="space-y-1.5">
            <Label className="text-yellow-300">Adjustment Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-9 bg-[#1b1b26] border-[#333347] text-white">
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent className="bg-[#1b1b26] border-[#333347] text-white">
                <SelectItem value="Damaged Write-off">Damaged Write-off (Unsellable / Scrap)</SelectItem>
                <SelectItem value="Quarantined">Quarantined (Defect Verification)</SelectItem>
                <SelectItem value="Stock Adjustment">Stock Adjustment (Audit Correction)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Adjustment Quantity */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <Label className="text-yellow-300">Quantity to Deduct (Pairs)</Label>
              <span className="text-[11px] text-zinc-400">Max available: {maxDeductible}</span>
            </div>
            <Input
              type="number"
              min={1}
              max={maxDeductible || 1}
              value={adjustmentQty}
              onChange={(e) => setAdjustmentQty(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="h-9 bg-[#1b1b26] border-[#333347] text-white"
              disabled={maxDeductible <= 0}
            />
            {currentStock > 0 && (
              <p className="text-[11px] text-zinc-400">
                New stock after deduction: <strong className="text-white">{Math.max(0, currentStock - adjustmentQty)}</strong> pairs.
              </p>
            )}
          </div>

          {/* Remarks */}
          <div className="space-y-1.5">
            <Label className="text-yellow-300">Defect Description / Remarks *</Label>
            <Textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g., Sole separated during display, water damage in storage, stitching defect..."
              className="bg-[#1b1b26] border-[#333347] text-white text-xs resize-none"
              required
            />
          </div>

          {/* Inactive Option */}
          <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl">
            <input
              type="checkbox"
              id="retireVariantCheckbox"
              checked={retireVariant}
              onChange={(e) => setRetireVariant(e.target.checked)}
              className="mt-0.5 rounded border-zinc-600 accent-yellow-400"
            />
            <label htmlFor="retireVariantCheckbox" className="text-[11px] text-amber-200 cursor-pointer">
              <strong>Retire variant completely:</strong> Mark this shoe size/color inactive (no longer sold). Leave unchecked if remaining pairs are still sellable.
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="border-[#38384a] bg-transparent text-zinc-300 hover:bg-[#222230] text-xs h-9"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || maxDeductible <= 0}
              className="bg-red-600 text-white hover:bg-red-700 font-bold text-xs h-9 flex items-center gap-1.5 shadow"
            >
              <AlertTriangle className="w-4 h-4" />
              {isSubmitting ? "Recording..." : `Deduct ${adjustmentQty} Damaged Pair${adjustmentQty > 1 ? "s" : ""}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

