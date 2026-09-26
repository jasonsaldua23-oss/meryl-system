import { useEffect, useMemo, useState } from "react";
import { AuditLogEntry, fetchAuditLogs } from "../../lib/api/audit-logger";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { ShieldCheck, Search, RefreshCw, Filter, User, Clock, Activity, FileText } from "lucide-react";
import { toast } from "sonner";

export function AuditLogViewer() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFilter, setSelectedFilter] = useState<"ALL" | "AUTH" | "PRODUCT" | "POS">("ALL");

  const loadLogs = async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const data = await fetchAuditLogs(150);
      setLogs(data);
    } catch {
      if (!quiet) toast.error("Failed to fetch audit logs.");
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
    // Pick up actions from other tabs and devices, like the rest of the app.
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadLogs(true);
    }, 10000);
    return () => window.clearInterval(timer);
  }, []);

  const filteredLogs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return logs.filter((log) => {
      const action = String(log?.action_type || "").toUpperCase();
      const entity = String(log?.entity_type || "");
      const actorName = String(log?.actor_name || "");
      const actorRole = String(log?.actor_role || "");
      const entityId = String(log?.entity_id || "");

      // Category filter
      if (selectedFilter === "AUTH" && !action.startsWith("AUTH_") && !action.startsWith("TERMINAL_")) {
        return false;
      }
      if (selectedFilter === "PRODUCT" && !action.startsWith("PRODUCT_") && !action.startsWith("STOCK_") && !action.startsWith("PRICE_")) {
        return false;
      }
      if (selectedFilter === "POS" && !action.startsWith("POS_")) {
        return false;
      }

      // Search term
      if (!q) return true;
      let metaString = "";
      try {
        metaString = typeof log?.metadata === "object" && log?.metadata !== null ? JSON.stringify(log.metadata) : String(log?.metadata || "");
      } catch {
        metaString = "";
      }

      return (
        action.toLowerCase().includes(q) ||
        entity.toLowerCase().includes(q) ||
        actorName.toLowerCase().includes(q) ||
        actorRole.toLowerCase().includes(q) ||
        entityId.toLowerCase().includes(q) ||
        metaString.toLowerCase().includes(q)
      );
    });
  }, [logs, searchTerm, selectedFilter]);

  const getActionBadge = (action?: string | null) => {
    const safeAction = String(action || "SYSTEM_EVENT").toUpperCase();
    if (safeAction.includes("LOCKED") || safeAction.includes("FAILED") || safeAction.includes("DELETED") || safeAction.includes("ARCHIVED")) {
      return <Badge className="bg-red-950/80 border border-red-500/40 text-red-300 font-semibold">{safeAction}</Badge>;
    }
    if (safeAction.includes("LOGIN") || safeAction.includes("UNLOCKED") || safeAction.includes("CREATED")) {
      return <Badge className="bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-semibold">{safeAction}</Badge>;
    }
    if (safeAction.includes("OVERRIDE")) {
      return <Badge className="bg-purple-950/80 border border-purple-500/40 text-purple-300 font-semibold">{safeAction}</Badge>;
    }
    if (safeAction.includes("STOCK") || safeAction.includes("PRICE")) {
      return <Badge className="bg-yellow-950/80 border border-yellow-500/40 text-yellow-300 font-semibold">{safeAction}</Badge>;
    }
    return <Badge className="bg-[#232332] border border-[#35354a] text-zinc-300 font-semibold">{safeAction}</Badge>;
  };

  const formatTimestamp = (dateStr?: string) => {
    if (!dateStr) return "Just now";
    try {
      const d = new Date(dateStr);
      return d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Card className="bg-[#15151D] border-[#24242F] shadow-xl text-yellow-100">
      <CardHeader className="border-b border-[#24242F] pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-yellow-400/10 border border-yellow-400/20 text-yellow-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-white text-lg font-bold">System Security & Audit Trail</CardTitle>
              <p className="text-xs text-yellow-200/60 mt-0.5">
                Tamper-evident record of all logins, lockouts, price changes, and overrides.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadLogs()}
              disabled={loading}
              className="border-[#303042] bg-[#1a1a27] text-yellow-200 hover:bg-[#252538] text-xs h-9"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh Log
            </Button>
          </div>
        </div>

        {/* Filters & Search */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-yellow-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by action, user, role, product SKU, or details..."
              className="pl-9 h-9 bg-[#12121A] border-[#24242F] text-xs text-white placeholder:text-zinc-500 rounded-xl focus-visible:ring-yellow-400/40"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedFilter("ALL")}
              className={`h-9 text-xs font-semibold rounded-xl ${selectedFilter === "ALL" ? "bg-yellow-400 text-black font-bold" : "bg-[#181824] text-zinc-400 hover:text-white"}`}
            >
              All Events ({logs.length})
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedFilter("AUTH")}
              className={`h-9 text-xs font-semibold rounded-xl ${selectedFilter === "AUTH" ? "bg-yellow-400 text-black font-bold" : "bg-[#181824] text-zinc-400 hover:text-white"}`}
            >
              Logins & Sessions
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedFilter("PRODUCT")}
              className={`h-9 text-xs font-semibold rounded-xl ${selectedFilter === "PRODUCT" ? "bg-yellow-400 text-black font-bold" : "bg-[#181824] text-zinc-400 hover:text-white"}`}
            >
              Products & Stock
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedFilter("POS")}
              className={`h-9 text-xs font-semibold rounded-xl ${selectedFilter === "POS" ? "bg-yellow-400 text-black font-bold" : "bg-[#181824] text-zinc-400 hover:text-white"}`}
            >
              POS Overrides
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <div className="border border-[#24242F] rounded-xl overflow-x-auto bg-[#111118]">
          <Table className="w-full min-w-[850px]">
            <TableHeader>
              <TableRow className="bg-[#181824] hover:bg-[#181824] border-[#24242F]">
                <TableHead className="text-yellow-300 text-left whitespace-nowrap">Timestamp</TableHead>
                <TableHead className="text-yellow-300 text-left whitespace-nowrap">Security Action</TableHead>
                <TableHead className="text-yellow-300 text-left whitespace-nowrap">Actor</TableHead>
                <TableHead className="text-yellow-300 text-left whitespace-nowrap">Entity</TableHead>
                <TableHead className="text-yellow-300 text-left whitespace-nowrap">Activity Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-zinc-500 text-sm">
                    Loading security audit trail...
                  </TableCell>
                </TableRow>
              ) : filteredLogs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-zinc-500 text-sm">
                    No matching audit logs found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredLogs.map((log, idx) => (
                  <TableRow key={idx} className="border-[#24242F] hover:bg-white/[0.02]">
                    <TableCell className="text-xs text-yellow-200/80 whitespace-nowrap font-mono">
                      {formatTimestamp(log.created_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {getActionBadge(log.action_type)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <div className="w-6 h-6 rounded-md bg-yellow-400 text-black font-extrabold text-[10px] flex items-center justify-center">
                          {String(log.actor_name || "U").charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-white">{log.actor_name || "System"}</p>
                          <p className="text-[10px] text-yellow-200/50">{log.actor_role || "Staff"}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-yellow-100 whitespace-nowrap">
                      <span className="font-semibold text-white">{String(log.entity_type || "SYSTEM")}</span>
                      {log.entity_id != null && (
                        <span className="text-[11px] text-yellow-200/50 block font-mono">
                          ID: {String(log.entity_id).length > 18 ? `${String(log.entity_id).slice(0, 16)}...` : String(log.entity_id)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-zinc-300 max-w-xs truncate">
                      {(() => {
                        if (!log.metadata) return "Standard action recorded.";
                        try {
                          const metaObj = typeof log.metadata === "string" ? JSON.parse(log.metadata) : log.metadata;
                          if (metaObj && typeof metaObj === "object" && !Array.isArray(metaObj)) {
                            const text = Object.entries(metaObj)
                              .filter(([k]) => k !== "user_agent")
                              .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                              .join(" • ");
                            return (
                              <span className="font-mono text-[11px] text-yellow-200/90">
                                {text || "Normal activity"}
                              </span>
                            );
                          }
                          return <span className="font-mono text-[11px] text-yellow-200/90">{String(log.metadata)}</span>;
                        } catch {
                          return <span className="font-mono text-[11px] text-yellow-200/90">{String(log.metadata)}</span>;
                        }
                      })()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

