import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { Package, Plus, Pencil, Archive, Search, Tag } from "lucide-react";
import {
  fetchProducts, createProduct, updateProduct, archiveProduct, type ProductSummary,
  listWarehouses, listBins, addInventory, type Reason, REASON_LABELS,
} from "@/lib/wms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/EmptyState";
import { toast } from "sonner";

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "Products — Spot" },
      { name: "description", content: "Manage your product catalog — names, SKUs, and total units across warehouses." },
    ],
  }),
  component: ProductsPage,
});

function ProductsPage() {
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products-summary"],
    queryFn: fetchProducts,
  });
  const [search, setSearch] = useState("");
  const [editProduct, setEditProduct] = useState<ProductSummary | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<ProductSummary | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<ProductSummary | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) || p.sku_code.toLowerCase().includes(q)
    );
  }, [products, search]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Catalog</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Products</h1>
          <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">
            Every product you stock. Each one has a unique SKU and tracks total units across all warehouses.
          </p>
        </div>
        <AddProductDialog />
      </div>

      <div className="mt-10 rounded-2xl border border-border bg-card shadow-card">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold tracking-tight">All products</h2>
            <p className="text-xs text-muted-foreground">{products.length} {products.length === 1 ? "product" : "products"} in catalog.</p>
          </div>
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or SKU" className="pl-9" />
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Loading products…</div>
        ) : products.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Package className="h-6 w-6" />}
              title="No products yet"
              description="Add your first product to start tracking inventory across warehouses."
              action={<AddProductDialog />}
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Product</th>
                <th className="px-5 py-3">SKU</th>
                <th className="px-5 py-3">Unit</th>
                <th className="px-5 py-3 text-right">Bins</th>
                <th className="px-5 py-3 text-right">Total units</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-t border-border transition-colors hover:bg-muted/30">
                  <td className="px-5 py-4 font-medium text-foreground">{p.name}</td>
                  <td className="px-5 py-4 font-mono text-xs text-muted-foreground">{p.sku_code}</td>
                  <td className="px-5 py-4 text-muted-foreground">{p.unit_of_measure}</td>
                  <td className="px-5 py-4 text-right tabular-nums">{p.binCount}</td>
                  <td className="px-5 py-4 text-right text-lg font-semibold tabular-nums">{p.totalUnits.toLocaleString()}</td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setReceiveTarget(p)}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Receive
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditProduct(p)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setArchiveTarget(p)}>
                        <Archive className="mr-1 h-3.5 w-3.5" /> Archive
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-5 py-12 text-center text-sm text-muted-foreground">No products match "{search}".</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      <ReceiveStockDialog product={receiveTarget} onClose={() => setReceiveTarget(null)} />
      <EditProductDialog product={editProduct} onClose={() => setEditProduct(null)} />
      <ArchiveProductDialog product={archiveTarget} onClose={() => setArchiveTarget(null)} />
    </main>
  );
}

function ReceiveStockDialog({ product, onClose }: { product: ProductSummary | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [warehouseId, setWarehouseId] = useState("");
  const [binId, setBinId] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<Reason>("received_stock");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (product) { setWarehouseId(""); setBinId(""); setQty(""); setReason("received_stock"); setNotes(""); }
  }, [product]);

  const { data: warehouses = [] } = useQuery({
    queryKey: ["wh-list"],
    queryFn: listWarehouses,
    enabled: !!product,
  });

  const { data: bins = [] } = useQuery({
    queryKey: ["bins", warehouseId],
    queryFn: () => listBins(warehouseId),
    enabled: !!warehouseId,
  });

  const { data: existingAtBin } = useQuery({
    queryKey: ["inv-at-bin", product?.id, binId],
    queryFn: async () => {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase
        .from("inventory").select("quantity")
        .eq("product_id", product!.id).eq("bin_id", binId).eq("is_deleted", false)
        .maybeSingle();
      return data;
    },
    enabled: !!product && !!binId,
  });

  const add = useMutation({
    mutationFn: () => addInventory({
      warehouseId, binId,
      productId: product!.id,
      quantity: parseInt(qty, 10) || 0,
      reason, notes,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products-summary"] });
      qc.invalidateQueries({ queryKey: ["warehouse-detail"] });
      qc.invalidateQueries({ queryKey: ["bins-summary"] });
      qc.invalidateQueries({ queryKey: ["warehouses-summary"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      toast.success("Stock received");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const q = parseInt(qty, 10);
  const canSubmit = !!warehouseId && !!binId && !Number.isNaN(q) && q >= 0;

  return (
    <Dialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        {product && (
          <>
            <DialogHeader>
              <DialogTitle>Receive stock</DialogTitle>
              <DialogDescription>
                Add units of <span className="font-medium text-foreground">{product.name}</span> into a specific bin.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-1.5">
                <Label>Warehouse</Label>
                <Select value={warehouseId} onValueChange={(v) => { setWarehouseId(v); setBinId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Choose a warehouse" /></SelectTrigger>
                  <SelectContent>
                    {warehouses.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name} <span className="text-muted-foreground">— {w.city}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label>Bin</Label>
                  <Select value={binId} onValueChange={setBinId} disabled={!warehouseId}>
                    <SelectTrigger>
                      <SelectValue placeholder={warehouseId ? "Choose a bin" : "Pick warehouse first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {bins.map((b) => (
                        <SelectItem key={b.id} value={b.id} className="font-mono">{b.bin_label}</SelectItem>
                      ))}
                      {bins.length === 0 && warehouseId && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">No bins in this warehouse yet.</div>
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="rqty">Quantity</Label>
                  <Input id="rqty" type="number" min={0} value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. 50" />
                </div>
              </div>
              {existingAtBin && (
                <p className="rounded-md bg-primary-soft px-3 py-2 text-xs text-primary">
                  This bin already holds {existingAtBin.quantity} units — your quantity will be added to the existing stock.
                </p>
              )}
              <div className="grid gap-1.5">
                <Label>Reason</Label>
                <Select value={reason} onValueChange={(v) => setReason(v as Reason)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(["received_stock", "returned", "manual_correction"] as Reason[]).map((r) => (
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
                {add.isPending ? "Adding…" : "Receive stock"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddProductDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [uom, setUom] = useState("unit");

  const create = useMutation({
    mutationFn: () => createProduct({ name, sku_code: sku, unit_of_measure: uom }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products-summary"] });
      qc.invalidateQueries({ queryKey: ["products-list"] });
      toast.success("Product added");
      setOpen(false);
      setName(""); setSku(""); setUom("unit");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="mr-1.5 h-4 w-4" /> Add Product
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a product</DialogTitle>
          <DialogDescription>Products are the SKUs you stock across your warehouses.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="pname">Name</Label>
            <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Wireless Mouse" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="psku">SKU</Label>
              <Input id="psku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="SKU-MOUSE-01" className="font-mono" />
              <p className="flex items-center gap-1 text-xs text-muted-foreground"><Tag className="h-3 w-3" /> Stays unique across catalog.</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="puom">Unit of measure</Label>
              <Input id="puom" value={uom} onChange={(e) => setUom(e.target.value)} placeholder="unit, kg, box…" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || !sku.trim() || create.isPending}>
            {create.isPending ? "Adding…" : "Add product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditProductDialog({ product, onClose }: { product: ProductSummary | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [uom, setUom] = useState("unit");

  useEffect(() => {
    if (product) { setName(product.name); setUom(product.unit_of_measure); }
  }, [product]);

  const save = useMutation({
    mutationFn: () => updateProduct(product!.id, { name, unit_of_measure: uom }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products-summary"] });
      qc.invalidateQueries({ queryKey: ["products-list"] });
      qc.invalidateQueries({ queryKey: ["warehouse-detail"] });
      qc.invalidateQueries({ queryKey: ["activity"] });
      toast.success("Product updated");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        {product && (
          <>
            <DialogHeader>
              <DialogTitle>Edit product</DialogTitle>
              <DialogDescription>SKU <span className="font-mono">{product.sku_code}</span> can't be changed.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-2">
              <div className="grid gap-1.5">
                <Label htmlFor="ename">Name</Label>
                <Input id="ename" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="euom">Unit of measure</Label>
                <Input id="euom" value={uom} onChange={(e) => setUom(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ArchiveProductDialog({ product, onClose }: { product: ProductSummary | null; onClose: () => void }) {
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: () => archiveProduct(product!.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products-summary"] });
      qc.invalidateQueries({ queryKey: ["products-list"] });
      qc.invalidateQueries({ queryKey: ["warehouses-summary"] });
      toast.success("Product archived");
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AlertDialog open={!!product} onOpenChange={(v) => !v && onClose()}>
      <AlertDialogContent>
        {product && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive {product.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                {product.totalUnits > 0
                  ? `This product still has ${product.totalUnits.toLocaleString()} units across ${product.binCount} bin(s). You'll need to clear them before archiving.`
                  : "This product has no units in stock. Archiving hides it from pickers but keeps its history in the activity log."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); archive.mutate(); }} disabled={archive.isPending}>
                {archive.isPending ? "Archiving…" : "Archive product"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
