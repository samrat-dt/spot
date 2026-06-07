import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchActivity, REASON_LABELS, listWarehouses, listProducts, type Reason } from "@/lib/wms";
import { Fragment, useMemo, useState } from "react";
import { Activity, ArrowRight, Warehouse, Package, Boxes } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { format } from "date-fns";
import {
  FilterBar, MultiSelect, ChipGroup, DatePresetPicker, datePresetCutoff, type DatePreset,
} from "@/components/FilterBar";

export const Route = createFileRoute("/activity")({
  head: () => ({
    meta: [
      { title: "Activity — Spot" },
      { name: "description", content: "Complete history of every inventory change across all warehouses." },
    ],
  }),
  component: ActivityPage,
});

const REASON_OPTIONS: { value: Reason; label: string }[] = (Object.keys(REASON_LABELS) as Reason[])
  .map((r) => ({ value: r, label: REASON_LABELS[r] }));

type Direction = "in" | "out";
const DIRECTION_OPTIONS: { value: Direction; label: string }[] = [
  { value: "in", label: "Inbound (+)" },
  { value: "out", label: "Outbound (−)" },
];

function ActivityPage() {
  const { data = [], isLoading } = useQuery({ queryKey: ["activity"], queryFn: fetchActivity });
  const { data: warehouses = [] } = useQuery({ queryKey: ["warehouses-list"], queryFn: listWarehouses });
  const { data: products = [] } = useQuery({ queryKey: ["products-list"], queryFn: listProducts });

  const [search, setSearch] = useState("");
  const [whs, setWhs] = useState<string[]>([]);
  const [prods, setProds] = useState<string[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");

  const filtered = useMemo(() => {
    const cutoff = datePresetCutoff(datePreset);
    const q = search.trim().toLowerCase();
    return data.filter((r: any) => {
      if (whs.length && !whs.includes(r.warehouse_id)) return false;
      if (prods.length && !prods.includes(r.product_id)) return false;
      if (reasons.length && !reasons.includes(r.reason)) return false;
      if (directions.length) {
        const dir: Direction = r.quantity_delta >= 0 ? "in" : "out";
        if (!directions.includes(dir)) return false;
      }
      if (cutoff && new Date(r.created_at) < cutoff) return false;
      if (q) {
        const hay = [
          r.products?.name, r.products?.sku_code,
          r.warehouses?.name, r.warehouses?.code,
          r.bins?.bin_label, r.notes,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, search, whs, prods, reasons, directions, datePreset]);

  const processedItems = useMemo(() => {
    const refGroups = new Map<string, any[]>();
    for (const r of filtered) {
      if (r.reference_id) {
        const g = refGroups.get(r.reference_id) ?? [];
        g.push(r);
        refGroups.set(r.reference_id, g);
      }
    }
    const items: ({ type: "single"; row: any } | { type: "pair"; out: any; in: any })[] = [];
    const seen = new Set<string>();
    for (const r of filtered) {
      if (r.reference_id) {
        if (seen.has(r.reference_id)) continue;
        seen.add(r.reference_id);
        const group = refGroups.get(r.reference_id)!;
        if (group.length === 2) {
          const out = group.find((x: any) => x.reason === "transfer_out") ?? group[0];
          const inn = group.find((x: any) => x.reason === "transfer_in") ?? group[1];
          items.push({ type: "pair", out, in: inn });
        } else {
          items.push({ type: "single", row: r });
        }
      } else {
        items.push({ type: "single", row: r });
      }
    }
    return items;
  }, [filtered]);

  const clearAll = () => {
    setSearch(""); setWhs([]); setProds([]); setReasons([]); setDirections([]); setDatePreset("all");
  };

  const pills: { key: string; label: string; onRemove: () => void }[] = [];
  whs.forEach((w) => {
    const name = warehouses.find((x) => x.id === w)?.name ?? "Warehouse";
    pills.push({ key: `w-${w}`, label: name, onRemove: () => setWhs(whs.filter((x) => x !== w)) });
  });
  prods.forEach((p) => {
    const name = products.find((x) => x.id === p)?.name ?? "Product";
    pills.push({ key: `p-${p}`, label: name, onRemove: () => setProds(prods.filter((x) => x !== p)) });
  });
  reasons.forEach((r) => pills.push({ key: `r-${r}`, label: REASON_LABELS[r], onRemove: () => setReasons(reasons.filter((x) => x !== r)) }));
  directions.forEach((d) => pills.push({ key: `d-${d}`, label: d === "in" ? "Inbound" : "Outbound", onRemove: () => setDirections(directions.filter((x) => x !== d)) }));
  if (datePreset !== "all") {
    pills.push({ key: "date", label: ({ today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" } as any)[datePreset], onRemove: () => setDatePreset("all") });
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <div>
        <p className="text-sm font-medium text-primary">History</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Activity</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">
          Every inventory change across all warehouses, newest first. Transfers show as paired moves.
        </p>
      </div>

      <div className="mt-8">
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search product, SKU, bin, notes…"
          pills={pills}
          onClearAll={clearAll}
          resultCount={filtered.length}
          totalCount={data.length}
        >
          <MultiSelect<string>
            label="Warehouse"
            icon={<Warehouse className="h-3.5 w-3.5 opacity-70" />}
            options={warehouses.map((w) => ({ value: w.id, label: w.name, hint: w.code }))}
            values={whs}
            onChange={setWhs}
            placeholder="Find warehouse"
          />
          <MultiSelect<string>
            label="Product"
            icon={<Package className="h-3.5 w-3.5 opacity-70" />}
            options={products.map((p) => ({ value: p.id, label: p.name, hint: p.sku_code }))}
            values={prods}
            onChange={setProds}
            placeholder="Find product"
          />
          <MultiSelect<Reason>
            label="Reason"
            icon={<Boxes className="h-3.5 w-3.5 opacity-70" />}
            options={REASON_OPTIONS}
            values={reasons}
            onChange={setReasons}
            placeholder="Filter reason"
          />
          <DatePresetPicker value={datePreset} onChange={setDatePreset} />
        </FilterBar>

        <div className="mt-3">
          <ChipGroup<Direction> options={DIRECTION_OPTIONS} values={directions} onChange={setDirections} />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card shadow-card">
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
              {processedItems.map((item) => {
                if (item.type === "pair") {
                  const { out, in: inn } = item;
                  return (
                    <Fragment key={out.reference_id}>
                      <tr className="border-t border-border bg-primary-soft/30">
                        <td className="px-5 py-3.5 font-medium">{out.products?.name}</td>
                        <td className="px-5 py-3.5 text-muted-foreground">{out.warehouses?.name}</td>
                        <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{out.bins?.bin_label}</td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums bg-primary-soft text-primary">
                            <ArrowRight className="h-3 w-3" />
                            {out.quantity_delta}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-muted-foreground">{REASON_LABELS["transfer_out"]}</span>
                          <span className="ml-1.5 text-xs font-medium text-primary">→ {inn.warehouses?.name}</span>
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground">{out.notes ?? <span className="text-border">—</span>}</td>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(out.created_at), "MMM d, yyyy · HH:mm")}</td>
                      </tr>
                      <tr className="border-t border-primary/20 bg-primary-soft/20">
                        <td className="px-5 py-3.5 font-medium">{inn.products?.name}</td>
                        <td className="px-5 py-3.5 text-muted-foreground">{inn.warehouses?.name}</td>
                        <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground">{inn.bins?.bin_label}</td>
                        <td className="px-5 py-3.5 text-right">
                          <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums bg-primary-soft text-primary">
                            <ArrowRight className="h-3 w-3" />
                            {inn.quantity_delta > 0 ? "+" : ""}{inn.quantity_delta}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <span className="text-muted-foreground">{REASON_LABELS["transfer_in"]}</span>
                          <span className="ml-1.5 text-xs font-medium text-primary">← {out.warehouses?.name}</span>
                        </td>
                        <td className="px-5 py-3.5 text-muted-foreground">{inn.notes ?? <span className="text-border">—</span>}</td>
                        <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(inn.created_at), "MMM d, yyyy · HH:mm")}</td>
                      </tr>
                    </Fragment>
                  );
                }
                const r = item.row;
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
                    <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">{format(new Date(r.created_at), "MMM d, yyyy · HH:mm")}</td>
                  </tr>
                );
              })}
              {processedItems.length === 0 && data.length > 0 && (
                <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-muted-foreground">
                  No results. Try removing a filter.
                </td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
