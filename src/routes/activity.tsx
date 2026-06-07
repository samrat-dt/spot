import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchActivity, REASON_LABELS, type Reason } from "@/lib/wms";
import { useMemo, useState } from "react";
import { Activity, Search, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/EmptyState";
import { format } from "date-fns";

export const Route = createFileRoute("/activity")({
  head: () => ({
    meta: [
      { title: "Activity — Spot" },
      { name: "description", content: "Complete history of every inventory change across all warehouses." },
    ],
  }),
  component: ActivityPage,
});

function ActivityPage() {
  const { data = [], isLoading } = useQuery({ queryKey: ["activity"], queryFn: fetchActivity });
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return data;
    return data.filter((r) => (r.products?.name ?? "").toLowerCase().includes(q));
  }, [data, search]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">History</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Activity</h1>
          <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">
            Every inventory change across all warehouses, newest first. Transfers show as paired moves.
          </p>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by product" className="pl-9" />
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card shadow-card">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Loading activity…</div>
        ) : data.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Activity className="h-6 w-6" />}
              title="No activity yet"
              description="Inventory changes will appear here automatically."
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Product</th>
                <th className="px-5 py-3">Warehouse</th>
                <th className="px-5 py-3">Bin</th>
                <th className="px-5 py-3 text-right">Change</th>
                <th className="px-5 py-3">Reason</th>
                <th className="px-5 py-3">Notes</th>
                <th className="px-5 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const reason = r.reason as Reason;
                const isTransfer = reason === "transfer_in" || reason === "transfer_out";
                const delta = r.quantity_delta;
                return (
                  <tr key={r.id} className={`border-t border-border ${isTransfer ? "bg-primary-soft/30" : ""}`}>
                    <td className="px-5 py-3.5 font-medium">{r.products?.name}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{r.warehouses?.name}</td>
                    <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{r.bins?.bin_label}</td>
                    <td className="px-5 py-3.5 text-right">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums
                        ${isTransfer ? "bg-primary-soft text-primary"
                          : delta >= 0 ? "bg-success/10 text-success"
                          : "bg-destructive/10 text-destructive"}`}>
                        {isTransfer && <ArrowRight className="h-3 w-3" />}
                        {delta > 0 ? "+" : ""}{delta}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-muted-foreground">{REASON_LABELS[reason]}</td>
                    <td className="px-5 py-3.5 text-muted-foreground">{r.notes ?? <span className="text-border">—</span>}</td>
                    <td className="px-5 py-3.5 text-xs text-muted-foreground">{format(new Date(r.created_at), "MMM d, yyyy · HH:mm")}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground">No activity matches "{search}".</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
