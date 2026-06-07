import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWarehouseDetail, REASON_LABELS, type Reason, adjustInventory, transferStock, listWarehouses, listBins } from "@/lib/wms";
import { useMemo, useState, useEffect } from "react";
import { ArrowLeft, MapPin, Package, Layers, Search, Pencil, ArrowRightLeft, AlertTriangle, Boxes } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/warehouses/$id")({
  component: WarehouseDetailPage,
});

type Row = Awaited<ReturnType<typeof fetchWarehouseDetail>>["rows"][number];

function WarehouseDetailPage() {
  const { id } = Route.useParams();
  const { data, isLoading } = useQuery({
    queryKey: ["warehouse-detail", id],
    queryFn: () => fetchWarehouseDetail(id),
  });
  const [search, setSearch] = useState("");
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [transferRow, setTransferRow] = useState<Row | null>(null);

  if (!isLoading && !data?.warehouse) throw notFound();

  const rows = data?.rows ?? [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.products?.name ?? "").toLowerCase().includes(q) ||
      (r.products?.sku_code ?? "").toLowerCase().includes(q)
    );
  }, [rows, search]);

  const totalUnits = rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
  const binsInUse = new Set(rows.map((r) => r.bin_id)).size;

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All warehouses
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{data?.warehouse?.name ?? "…"}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> {data?.warehouse?.city}
            <span className="mx-2 text-border">•</span>
            <span className="font-mono text-xs">{data?.warehouse?.code}</span>
          </p>
        </div>
        <div className="flex items-center gap-6 rounded-2xl border border-border bg-card px-6 py-3 shadow-card">
          <SummaryStat icon={<Package className="h-4 w-4" />} label="Products" value={rows.length} />
          <div className="h-8 w-px bg-border" />
          <SummaryStat icon={<Boxes className="h-4 w-4" />} label="Units" value={totalUnits} />
          <div className="h-8 w-px bg-border" />
          <SummaryStat icon={<Layers className="h-4 w-4" />} label="Bins in use" value={binsInUse} />
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Inventory</h2>
            <p className="text-xs text-muted-foreground">Every product stored here, grouped by bin location.</p>
          </div>
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search product or SKU"
              className="pl-9"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Loading inventory…</div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title="No inventory yet"
              description="This warehouse has no inventory yet. Add a product to a bin to start tracking stock."
            />
          </div>
        ) : (
          <div className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Product</th>
                  <th className="px-5 py-3">SKU</th>
                  <th className="px-5 py-3">Bin</th>
                  <th className="px-5 py-3 text-right">Units</th>
                  <th className="px-5 py-3">Last updated</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const low = (r.quantity ?? 0) < 10;
                  return (
                    <tr key={r.id} className="border-t border-border transition-colors hover:bg-muted/30">
                      <td className="px-5 py-4 font-medium text-foreground">{r.products?.name}</td>
                      <td className="px-5 py-4 font-mono text-xs text-muted-foreground">{r.products?.sku_code}</td>
                      <td className="px-5 py-4">
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 font-mono text-xs">
                          <Layers className="h-3 w-3 text-muted-foreground" /> {r.bins?.bin_label}
                        </span>
                      </td>
                      <td className={`px-5 py-4 text-right text-lg font-semibold tabular-nums ${low ? "text-warning-foreground" : ""}`}>
                        <span className={low ? "rounded-md bg-warning-soft px-2 py-0.5" : ""}>
                          <AnimatedCount value={r.quantity ?? 0} />
                          {low && <AlertTriangle className="ml-1.5 inline h-3.5 w-3.5 -translate-y-0.5" />}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(r.updated_at), { addSuffix: true })}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setEditRow(r)}>
                            <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setTransferRow(r)}>
                            <ArrowRightLeft className="mr-1 h-3.5 w-3.5" /> Transfer
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">No products match "{search}".</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EditDrawer row={editRow} warehouseId={id} onClose={() => setEditRow(null)} />
      <TransferDrawer row={transferRow} warehouseId={id} onClose={() => setTransferRow(null)} />
    </main>
  );
}

function SummaryStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">{icon}</span>
      <div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
      </div>
    </div>
  );
}

function AnimatedCount({ value }: { value: number }) {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (display === value) return;
    const start = display;
    const diff = value - start;
    const steps = 14;
    let i = 0;
    const id = setInterval(() => {
      i++;
      setDisplay(Math.round(start + (diff * i) / steps));
      if (i >= steps) { clearInterval(id); setDisplay(value); }
    }, 18);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{display.toLocaleString()}</>;
}

// ---- Edit Drawer ----
function EditDrawer({ row, warehouseId, onClose }: { row: Row | null; warehouseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [delta, setDelta] = useState<string>("");
  const [reason, setReason] = useState<Reason | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (row) { setDelta(""); setReason(""); setNotes(""); setError(null); }
  }, [row]);

  const mutate = useMutation({
    mutationFn: async () => {
      if (!row) return;
      const d = parseInt(delta, 10);
      if (Number.isNaN(d) || d === 0) throw new Error("Enter a positive or negative amount.");
      if (!reason) throw new Error("Select a reason.");
      return adjustInventory({
        inventoryId: row.id,
        productId: row.product_id,
        warehouseId,
        binId: row.bin_id,
        currentQuantity: row.quantity ?? 0,
        delta: d,
        reason,
        notes,
      });
    },
    onSuccess: () => {
      const d = parseInt(delta, 10);
      qc.invalidateQueries({ queryKey: ["warehouse-detail", warehouseId] });
      qc.invalidateQueries({ queryKey: ["warehouses-summary"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      toast.success("Inventory updated", {
        description: `${Math.abs(d)} units ${d > 0 ? "added" : "removed"} (${REASON_LABELS[reason as Reason]}).`,
      });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Sheet open={!!row} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="sm:max-w-md">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>{row.products?.name}</SheetTitle>
              <SheetDescription className="font-mono text-xs">{row.products?.sku_code}</SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6 px-4">
              <div className="rounded-xl border border-border bg-muted/40 p-5 text-center">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Current quantity</p>
                <p className="mt-1 text-5xl font-semibold tabular-nums tracking-tight">{(row.quantity ?? 0).toLocaleString()}</p>
                <p className="mt-1 text-xs text-muted-foreground">units in bin {row.bins?.bin_label}</p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="delta">Adjustment</Label>
                <Input
                  id="delta" type="number" value={delta} onChange={(e) => { setDelta(e.target.value); setError(null); }}
                  placeholder="e.g. 20 or -5"
                />
                <p className="text-xs text-muted-foreground">Use a positive number to add, negative to remove.</p>
              </div>

              <div className="grid gap-1.5">
                <Label>Reason</Label>
                <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
                  <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                  <SelectContent>
                    {(["received_stock","sold","damaged","returned","manual_correction"] as Reason[]).map((r) => (
                      <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="notes">Notes <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any context for the team" />
              </div>

              {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            </div>

            <SheetFooter className="mt-6">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={() => mutate.mutate()} disabled={mutate.isPending}>
                {mutate.isPending ? "Saving…" : "Submit adjustment"}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---- Transfer Drawer ----
function TransferDrawer({ row, warehouseId, onClose }: { row: Row | null; warehouseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [destWh, setDestWh] = useState<string>("");
  const [destBin, setDestBin] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (row) { setDestWh(""); setDestBin(""); setQty(""); setError(null); } }, [row]);

  const { data: warehouses = [] } = useQuery({ queryKey: ["wh-list"], queryFn: listWarehouses });
  const { data: bins = [] } = useQuery({
    queryKey: ["bins", destWh], queryFn: () => listBins(destWh), enabled: !!destWh,
  });
  const sourceWh = warehouses.find((w) => w.id === warehouseId);
  const destWhName = warehouses.find((w) => w.id === destWh)?.name;

  const mutate = useMutation({
    mutationFn: async () => {
      if (!row) return;
      const q = parseInt(qty, 10);
      if (Number.isNaN(q) || q <= 0) throw new Error("Quantity must be greater than 0.");
      if (!destWh) throw new Error("Choose a destination warehouse.");
      if (!destBin) throw new Error("Choose a destination bin.");
      await transferStock({
        sourceInventoryId: row.id,
        productId: row.product_id,
        sourceWarehouseId: warehouseId,
        sourceBinId: row.bin_id,
        sourceQuantity: row.quantity ?? 0,
        destWarehouseId: destWh,
        destBinId: destBin,
        quantity: q,
      });
      return q;
    },
    onSuccess: (q) => {
      qc.invalidateQueries({ queryKey: ["warehouse-detail", warehouseId] });
      qc.invalidateQueries({ queryKey: ["warehouses-summary"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      toast.success(`${q} units transferred from ${sourceWh?.name} → ${destWhName}.`);
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <Sheet open={!!row} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="sm:max-w-md">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>Transfer stock</SheetTitle>
              <SheetDescription>Move units from this bin to another warehouse and bin.</SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-5 px-4">
              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">From</p>
                <p className="mt-1 font-medium">{row.products?.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {sourceWh?.name} · Bin <span className="font-mono">{row.bins?.bin_label}</span> · {row.quantity ?? 0} on hand
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label>Destination warehouse</Label>
                <Select value={destWh} onValueChange={(v) => { setDestWh(v); setDestBin(""); }}>
                  <SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.filter((w) => w.id !== warehouseId).map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name} <span className="text-muted-foreground">— {w.city}</span></SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label>Destination bin</Label>
                <Select value={destBin} onValueChange={setDestBin} disabled={!destWh}>
                  <SelectTrigger><SelectValue placeholder={destWh ? "Choose a bin" : "Pick a warehouse first"} /></SelectTrigger>
                  <SelectContent>
                    {bins.map((b) => (
                      <SelectItem key={b.id} value={b.id} className="font-mono">{b.bin_label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="tqty">Quantity</Label>
                <Input id="tqty" type="number" min={1} max={row.quantity ?? 0}
                  value={qty} onChange={(e) => { setQty(e.target.value); setError(null); }}
                  placeholder={`Up to ${row.quantity ?? 0}`} />
              </div>

              {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            </div>

            <SheetFooter className="mt-6">
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={() => mutate.mutate()} disabled={mutate.isPending}>
                {mutate.isPending ? "Transferring…" : "Confirm transfer"}
              </Button>
            </SheetFooter>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
