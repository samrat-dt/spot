import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchWarehouseDetail, REASON_LABELS, type Reason,
  adjustInventory, transferStock, listWarehouses, listBins,
  fetchBinsForWarehouse, createBin, updateBin, archiveBin, type BinSummary,
  listProducts, addInventory,
  updateWarehouse, archiveWarehouse,
} from "@/lib/wms";
import { useMemo, useState, useEffect } from "react";
import {
  ArrowLeft, MapPin, Package, Layers, Search, Pencil, ArrowRightLeft,
  AlertTriangle, Boxes, Plus, Archive, MoreHorizontal, Settings,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/warehouses/$id")({
  component: WarehouseDetailPage,
});

type Row = Awaited<ReturnType<typeof fetchWarehouseDetail>>["rows"][number];

function WarehouseDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["warehouse-detail", id],
    queryFn: () => fetchWarehouseDetail(id),
  });
  const { data: bins = [] } = useQuery({
    queryKey: ["bins-summary", id],
    queryFn: () => fetchBinsForWarehouse(id),
  });
  const [search, setSearch] = useState("");
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [transferRow, setTransferRow] = useState<Row | null>(null);
  const [addInvOpen, setAddInvOpen] = useState(false);
  const [editWhOpen, setEditWhOpen] = useState(false);
  const [archiveWhOpen, setArchiveWhOpen] = useState(false);
  const [addBinOpen, setAddBinOpen] = useState(false);
  const [editBin, setEditBin] = useState<BinSummary | null>(null);
  const [archiveBinTarget, setArchiveBinTarget] = useState<BinSummary | null>(null);

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

  const archiveWh = useMutation({
    mutationFn: () => archiveWarehouse(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouses-summary"] });
      toast.success("Warehouse archived");
      navigate({ to: "/" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> All warehouses
      </Link>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">{data?.warehouse?.name ?? "…"}</h1>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onClick={() => setEditWhOpen(true)}>
                  <Settings className="mr-2 h-4 w-4" /> Edit warehouse
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setArchiveWhOpen(true)} className="text-destructive focus:text-destructive">
                  <Archive className="mr-2 h-4 w-4" /> Archive warehouse
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
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
          <SummaryStat icon={<Layers className="h-4 w-4" />} label="Bins" value={bins.length} />
        </div>
      </div>

      {/* ---- Bins panel ---- */}
      <section className="mt-8 rounded-2xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Bins</h2>
            <p className="text-xs text-muted-foreground">
              Physical storage locations in this warehouse. Each bin has a unique aisle-rack-shelf label.
            </p>
          </div>
          <Button size="sm" onClick={() => setAddBinOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add bin
          </Button>
        </div>
        {bins.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Layers className="h-6 w-6" />}
              title="No bins yet"
              description="Bins are the physical slots in your warehouse (e.g. Aisle A, Rack 01, Shelf B). Add at least one before placing inventory."
              action={<Button onClick={() => setAddBinOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Add bin</Button>}
            />
          </div>
        ) : (
          <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {bins.map((b) => (
              <div key={b.id} className="group flex items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:border-primary/30">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-medium">{b.bin_label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {b.productCount} {b.productCount === 1 ? "product" : "products"} · {b.totalUnits.toLocaleString()} units
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditBin(b)}>
                      <Pencil className="mr-2 h-4 w-4" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setArchiveBinTarget(b)} className="text-destructive focus:text-destructive">
                      <Archive className="mr-2 h-4 w-4" /> Archive
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- Inventory panel ---- */}
      <section className="mt-6 rounded-2xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">Inventory</h2>
            <p className="text-xs text-muted-foreground">Every product stored here, grouped by bin location.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search product or SKU" className="pl-9" />
            </div>
            <Button size="sm" onClick={() => setAddInvOpen(true)} disabled={bins.length === 0}>
              <Plus className="mr-1.5 h-4 w-4" /> Add inventory
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Loading inventory…</div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title="No inventory yet"
              description={
                bins.length === 0
                  ? "Add a bin first, then place a product into it to start tracking stock."
                  : "Place a product into a bin to start tracking stock."
              }
              action={
                bins.length === 0
                  ? <Button onClick={() => setAddBinOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Add bin</Button>
                  : <Button onClick={() => setAddInvOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Add inventory</Button>
              }
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
      </section>

      <EditDrawer row={editRow} warehouseId={id} onClose={() => setEditRow(null)} />
      <TransferDrawer row={transferRow} warehouseId={id} onClose={() => setTransferRow(null)} />
      <AddInventoryDialog open={addInvOpen} onClose={() => setAddInvOpen(false)} warehouseId={id} bins={bins} />
      <AddBinDialog open={addBinOpen} onClose={() => setAddBinOpen(false)} warehouseId={id} />
      <EditBinDialog bin={editBin} warehouseId={id} onClose={() => setEditBin(null)} />
      <ArchiveBinDialog bin={archiveBinTarget} onClose={() => setArchiveBinTarget(null)} />
      <EditWarehouseDialog
        open={editWhOpen}
        onClose={() => setEditWhOpen(false)}
        warehouse={data?.warehouse ?? null}
      />
      <AlertDialog open={archiveWhOpen} onOpenChange={setArchiveWhOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this warehouse?</AlertDialogTitle>
            <AlertDialogDescription>
              {totalUnits > 0
                ? `This warehouse still holds ${totalUnits.toLocaleString()} units across ${rows.length} product(s). Transfer or remove them before archiving.`
                : "Archiving hides this warehouse from lists but keeps its history in the activity log."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); archiveWh.mutate(); }} disabled={archiveWh.isPending}>
              {archiveWh.isPending ? "Archiving…" : "Archive warehouse"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  const [reason, setReason] = useState<Reason>("received_stock");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (row) { setDelta(""); setReason("received_stock"); setNotes(""); setError(null); }
  }, [row]);

  const mutate = useMutation({
    mutationFn: async () => {
      if (!row) return;
      const d = parseInt(delta, 10);
      if (Number.isNaN(d) || d === 0) throw new Error("Enter a positive or negative amount.");
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
      qc.invalidateQueries({ queryKey: ["bins-summary", warehouseId] });
      qc.invalidateQueries({ queryKey: ["warehouses-summary"] });
      qc.invalidateQueries({ queryKey: ["products-summary"] });
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
                {delta !== "" && !Number.isNaN(parseInt(delta, 10)) && parseInt(delta, 10) !== 0 && (
                  <p className="text-xs text-muted-foreground">
                    New quantity:{" "}
                    <span className={`font-semibold ${(row.quantity ?? 0) + parseInt(delta, 10) < 0 ? "text-destructive" : "text-foreground"}`}>
                      {Math.max(0, (row.quantity ?? 0) + parseInt(delta, 10)).toLocaleString()}
                    </span>
                    {(row.quantity ?? 0) + parseInt(delta, 10) < 0 && (
                      <span className="ml-1 text-destructive">(cannot go below 0)</span>
                    )}
                  </p>
                )}
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
  const navigate = useNavigate();
  const [destWh, setDestWh] = useState<string>("");
  const [destBin, setDestBin] = useState<string>("");
  const [qty, setQty] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (row) { setDestWh(""); setDestBin(""); setQty(""); setNotes(""); setError(null); } }, [row]);

  const { data: warehouses = [] } = useQuery({ queryKey: ["wh-list"], queryFn: listWarehouses });
  const { data: bins = [] } = useQuery({
    queryKey: ["bins", destWh], queryFn: () => listBins(destWh), enabled: !!destWh,
  });
  // Find which destination bins already hold this product
  const { data: existingByBin = {} } = useQuery({
    queryKey: ["dest-existing", destWh, row?.product_id],
    queryFn: async () => {
      if (!destWh || !row) return {};
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("inventory")
        .select("bin_id, quantity")
        .eq("warehouse_id", destWh)
        .eq("product_id", row.product_id)
        .eq("is_deleted", false);
      const map: Record<string, number> = {};
      (data ?? []).forEach((r) => { map[r.bin_id] = r.quantity ?? 0; });
      return map;
    },
    enabled: !!destWh && !!row,
  });

  const sourceWh = warehouses.find((w) => w.id === warehouseId);
  const destWhName = warehouses.find((w) => w.id === destWh)?.name;
  const existingAtDest = destBin ? existingByBin[destBin] : undefined;

  const binsWithProduct = bins.filter((b) => existingByBin[b.id] !== undefined);
  const binsEmpty = bins.filter((b) => existingByBin[b.id] === undefined);

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
        notes: notes || undefined,
      });
      return q;
    },
    onSuccess: (q) => {
      qc.invalidateQueries({ queryKey: ["warehouse-detail"] });
      qc.invalidateQueries({ queryKey: ["bins-summary"] });
      qc.invalidateQueries({ queryKey: ["warehouses-summary"] });
      qc.invalidateQueries({ queryKey: ["products-summary"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      const capturedDest = destWh;
      toast.success(`${q} units transferred from ${sourceWh?.name} → ${destWhName}.`, {
        action: { label: "View destination", onClick: () => navigate({ to: "/warehouses/$id", params: { id: capturedDest } }) },
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
                    {binsWithProduct.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Already has this product</SelectLabel>
                        {binsWithProduct.map((b) => (
                          <SelectItem key={b.id} value={b.id} className="font-mono">
                            {b.bin_label} <span className="ml-2 text-muted-foreground">({existingByBin[b.id]} on hand)</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {binsEmpty.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Other bins</SelectLabel>
                        {binsEmpty.map((b) => (
                          <SelectItem key={b.id} value={b.id} className="font-mono">{b.bin_label}</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {bins.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">No bins in this warehouse yet.</div>
                    )}
                  </SelectContent>
                </Select>
                {existingAtDest !== undefined && (
                  <p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-primary">
                    This bin already holds {existingAtDest} units of this product — they'll be combined.
                  </p>
                )}
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="tqty">Quantity</Label>
                <Input id="tqty" type="number" min={1} max={row.quantity ?? 0}
                  value={qty} onChange={(e) => { setQty(e.target.value); setError(null); }}
                  placeholder={`Up to ${row.quantity ?? 0}`} />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="tnotes">Notes <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea id="tnotes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any context for the team" />
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

// ---- Add Bin ----
function AddBinDialog({ open, onClose, warehouseId }: { open: boolean; onClose: () => void; warehouseId: string }) {
  const qc = useQueryClient();
  const [aisle, setAisle] = useState("");
  const [rack, setRack] = useState("");
  const [shelf, setShelf] = useState("");

  useEffect(() => { if (open) { setAisle(""); setRack(""); setShelf(""); } }, [open]);

  const create = useMutation({
    mutationFn: () => createBin({ warehouseId, aisle, rack, shelf }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bins-summary", warehouseId] });
      qc.invalidateQueries({ queryKey: ["bins", warehouseId] });
      toast.success("Bin added");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const preview = aisle && rack && shelf
    ? `${aisle.toUpperCase()}-${rack.toUpperCase()}-${shelf.toUpperCase()}`
    : "—";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a bin</DialogTitle>
          <DialogDescription>A bin is a physical slot identified by aisle, rack, and shelf.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="aisle">Aisle</Label>
              <Input id="aisle" value={aisle} onChange={(e) => setAisle(e.target.value)} placeholder="A" maxLength={3} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rack">Rack</Label>
              <Input id="rack" value={rack} onChange={(e) => setRack(e.target.value)} placeholder="01" maxLength={3} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="shelf">Shelf</Label>
              <Input id="shelf" value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder="A" maxLength={3} />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-muted/40 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Bin label</p>
            <p className="mt-1 font-mono text-lg font-semibold">{preview}</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!aisle || !rack || !shelf || create.isPending}>
            {create.isPending ? "Adding…" : "Add bin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditBinDialog({ bin, warehouseId, onClose }: { bin: BinSummary | null; warehouseId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [aisle, setAisle] = useState("");
  const [rack, setRack] = useState("");
  const [shelf, setShelf] = useState("");

  useEffect(() => { if (bin) { setAisle(bin.aisle); setRack(bin.rack); setShelf(bin.shelf); } }, [bin]);

  const save = useMutation({
    mutationFn: () => updateBin(bin!.id, { warehouseId, aisle, rack, shelf }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bins-summary", warehouseId] });
      qc.invalidateQueries({ queryKey: ["bins", warehouseId] });
      qc.invalidateQueries({ queryKey: ["warehouse-detail", warehouseId] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      toast.success("Bin renamed");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!bin} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        {bin && (
          <>
            <DialogHeader>
              <DialogTitle>Rename bin</DialogTitle>
              <DialogDescription>Currently <span className="font-mono">{bin.bin_label}</span>.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-3 py-2">
              <div className="grid gap-1.5"><Label>Aisle</Label><Input value={aisle} onChange={(e) => setAisle(e.target.value)} maxLength={3} /></div>
              <div className="grid gap-1.5"><Label>Rack</Label><Input value={rack} onChange={(e) => setRack(e.target.value)} maxLength={3} /></div>
              <div className="grid gap-1.5"><Label>Shelf</Label><Input value={shelf} onChange={(e) => setShelf(e.target.value)} maxLength={3} /></div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={!aisle || !rack || !shelf || save.isPending}>
                {save.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ArchiveBinDialog({ bin, onClose }: { bin: BinSummary | null; onClose: () => void }) {
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: () => archiveBin(bin!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bins-summary"] });
      qc.invalidateQueries({ queryKey: ["bins"] });
      qc.invalidateQueries({ queryKey: ["warehouse-detail"] });
      toast.success("Bin archived");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AlertDialog open={!!bin} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        {bin && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive bin {bin.bin_label}?</AlertDialogTitle>
              <AlertDialogDescription>
                {bin.totalUnits > 0
                  ? `This bin still holds ${bin.totalUnits.toLocaleString()} units. Move them to another bin before archiving.`
                  : "Archiving removes this bin from pickers. History is kept."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); archive.mutate(); }} disabled={archive.isPending}>
                {archive.isPending ? "Archiving…" : "Archive bin"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---- Add Inventory ----
function AddInventoryDialog({ open, onClose, warehouseId, bins }: {
  open: boolean; onClose: () => void; warehouseId: string; bins: BinSummary[];
}) {
  const qc = useQueryClient();
  const { data: products = [] } = useQuery({
    queryKey: ["products-list"], queryFn: listProducts, enabled: open,
  });
  const [productId, setProductId] = useState("");
  const [binId, setBinId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<Reason>("received_stock");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) { setProductId(""); setBinId(""); setQty(""); setReason("received_stock"); setNotes(""); }
  }, [open]);

  const add = useMutation({
    mutationFn: () => addInventory({
      warehouseId, binId, productId,
      quantity: parseInt(qty, 10) || 0,
      reason, notes,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse-detail", warehouseId] });
      qc.invalidateQueries({ queryKey: ["bins-summary", warehouseId] });
      qc.invalidateQueries({ queryKey: ["warehouses-summary"] });
      qc.invalidateQueries({ queryKey: ["products-summary"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      toast.success("Inventory added");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const q = parseInt(qty, 10);
  const canSubmit = !!productId && !!binId && !Number.isNaN(q) && q >= 0;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add inventory</DialogTitle>
          <DialogDescription>Place a product into a bin in this warehouse.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder={products.length === 0 ? "No products in catalog yet" : "Choose a product"} />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} <span className="ml-2 font-mono text-xs text-muted-foreground">{p.sku_code}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {products.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Add a product first in the <Link to="/products" className="text-primary underline">Products</Link> page.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label>Bin</Label>
              <Select value={binId} onValueChange={setBinId}>
                <SelectTrigger><SelectValue placeholder="Choose a bin" /></SelectTrigger>
                <SelectContent>
                  {bins.map((b) => (
                    <SelectItem key={b.id} value={b.id} className="font-mono">{b.bin_label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="iqty">Starting quantity</Label>
              <Input id="iqty" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 50" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(["received_stock","returned","manual_correction"] as Reason[]).map((r) => (
                  <SelectItem key={r} value={r}>{REASON_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any context for the team" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => add.mutate()} disabled={!canSubmit || add.isPending}>
            {add.isPending ? "Adding…" : "Add inventory"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---- Edit Warehouse ----
function EditWarehouseDialog({ open, onClose, warehouse }: {
  open: boolean; onClose: () => void;
  warehouse: { id: string; name: string; city: string; code: string } | null;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [code, setCode] = useState("");

  useEffect(() => {
    if (open && warehouse) { setName(warehouse.name); setCity(warehouse.city); setCode(warehouse.code); }
  }, [open, warehouse]);

  const save = useMutation({
    mutationFn: () => updateWarehouse(warehouse!.id, { name, city, code }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouse-detail", warehouse!.id] });
      qc.invalidateQueries({ queryKey: ["warehouses-summary"] });
      qc.invalidateQueries({ queryKey: ["wh-list"] });
      toast.success("Warehouse updated");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit warehouse</DialogTitle>
          <DialogDescription>Update the name, city, or code.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5"><Label>City</Label><Input value={city} onChange={(e) => setCity(e.target.value)} /></div>
            <div className="grid gap-1.5"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || !city.trim() || !code.trim() || save.isPending}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
