import { useMemo, useState } from "react";
import { Mail, Users } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  AGE_BRACKETS,
  VIP_MIN_PURCHASES,
  selectAudience,
  type AgeBracketId,
  type AudienceCustomer,
  type AudienceFilters,
} from "../../lib/promotion-audience";

/**
 * Choose who receives a promotion email, see how many that is, then send.
 * Manuscript Use Case 9, Scenario 1: filter cohorts by gender, age bracket or VIP
 * status (Step 2), show recipient counts (Step 3), then dispatch (Step 4).
 */
export function PromotionNotifyDialog({
  open,
  onOpenChange,
  promoName,
  audience,
  sending,
  onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promoName: string;
  audience: AudienceCustomer[];
  sending: boolean;
  onSend: (customerIds: string[]) => void;
}) {
  const [filters, setFilters] = useState<AudienceFilters>({ gender: "all", ageBracket: "all", vipOnly: false });
  const { recipients, withoutEmail } = useMemo(() => selectAudience(audience, filters), [audience, filters]);
  const preview = recipients.slice(0, 6);

  return (
    <Dialog open={open} onOpenChange={(next) => !sending && onOpenChange(next)}>
      <DialogContent className="bg-[#15161d] border-[#2a2c36] text-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-yellow-300">
            <Mail className="h-5 w-5" />
            Send promotion email
          </DialogTitle>
          <p className="text-sm text-white/60">
            Choose who should receive <span className="font-semibold text-white">{promoName}</span>.
          </p>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-white/60">Gender</Label>
            <Select value={filters.gender} onValueChange={(v) => setFilters((f) => ({ ...f, gender: v as AudienceFilters["gender"] }))}>
              <SelectTrigger className="bg-[#1D1D26] border-[#313342] text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#181822] border-[#313342] text-white">
                <SelectItem value="all">All genders</SelectItem>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-white/60">Age bracket</Label>
            <Select value={filters.ageBracket} onValueChange={(v) => setFilters((f) => ({ ...f, ageBracket: v as AgeBracketId }))}>
              <SelectTrigger className="bg-[#1D1D26] border-[#313342] text-white"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-[#181822] border-[#313342] text-white">
                {AGE_BRACKETS.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-white/80">
          <input
            type="checkbox"
            checked={filters.vipOnly}
            onChange={(e) => setFilters((f) => ({ ...f, vipOnly: e.target.checked }))}
            className="h-4 w-4 accent-yellow-400"
          />
          VIP customers only
          <span className="text-xs text-white/45">({VIP_MIN_PURCHASES}+ completed purchases)</span>
        </label>

        <div className="rounded-lg border border-[#2a2c36] bg-[#0f1016] p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <Users className="h-4 w-4 text-yellow-400" />
            {recipients.length} customer{recipients.length === 1 ? "" : "s"} will receive this email
          </p>
          {withoutEmail > 0 && (
            <p className="mt-1 text-xs text-white/50">
              {withoutEmail} matching customer{withoutEmail === 1 ? " has" : "s have"} no email address and will be skipped.
            </p>
          )}
          {preview.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-white/65">
              {preview.map((c) => (
                <li key={c.customer_id} className="flex justify-between gap-3">
                  <span className="truncate">{c.name}{c.isVip ? " · VIP" : ""}</span>
                  <span className="truncate text-white/40">{c.email}</span>
                </li>
              ))}
              {recipients.length > preview.length && (
                <li className="text-white/40">and {recipients.length - preview.length} more…</li>
              )}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={sending} onClick={() => onOpenChange(false)} className="border-[#343444] bg-transparent text-yellow-200 hover:bg-[#202030]">
            Not now
          </Button>
          <Button
            disabled={sending || recipients.length === 0}
            onClick={() => onSend(recipients.map((c) => c.customer_id))}
            className="bg-yellow-400 font-bold text-red-950 hover:bg-yellow-500"
          >
            {sending ? "Sending…" : `Send to ${recipients.length} customer${recipients.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
