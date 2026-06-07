import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWarehouseSummaries, createWarehouse, seedDemoData } from "@/lib/wms";
import { Warehouse, MapPin, Package, AlertTriangle, Plus, ArrowRight, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Warehouses — Spot" },
      { name: "description", content: "All your warehouses at a glance — products, units in stock, and low-stock alerts." },
    ],
  }),
  component: WarehousesPage,
});

function WarehousesPage() {
  const qc = useQueryClient();
  const { data: warehouses = [], isLoading } = useQuery({
    queryKey: ["warehouses-summary"],
    queryFn: fetchWarehouseSummaries,
  });

  const seed = useMutation({
    mutationFn: seedDemoData,
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ["warehouses-summary"] });
      if (created) toast.success("Demo data loaded", { description: "3 warehouses with sample inventory." });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-primary">Overview</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">Warehouses</h1>
          <p className="mt-2 max-w-xl text-[15px] text-muted-foreground">
            Every warehouse you operate. Each card shows total products, units in stock,
            and a flag if anything is running low.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {warehouses.length === 0 && !isLoading && (
            <Button variant="outline" onClick={() => seed.mutate()} disabled={seed.isPending}>
              <Sparkles className="mr-1.5 h-4 w-4" /> Load demo data
            </Button>
          )}
          <AddWarehouseDialog />
        </div>
      </div>

      <div className="mt-10">
        {isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-44 animate-pulse rounded-2xl border border-border bg-card" />
            ))}
          </div>
        ) : warehouses.length === 0 ? (
          <EmptyState
            icon={<Warehouse className="h-6 w-6" />}
            title="No warehouses yet"
            description="Add your first warehouse to start tracking inventory."
            action={<AddWarehouseDialog />}
          />
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {warehouses.map((w) => (
              <WarehouseCard key={w.id} w={w} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function WarehouseCard({ w }: { w: Awaited<ReturnType<typeof fetchWarehouseSummaries>>[number] }) {
  return (
    <Link
      to="/warehouses/$id"
      params={{ id: w.id }}
      className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lift"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <Warehouse className="h-5 w-5" />
          </div>
          <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground">{w.name}</h3>
          <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> {w.city}
          </p>
        </div>
        {w.lowStock > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning-foreground">
            <AlertTriangle className="h-3 w-3" /> {w.lowStock} low stock
          </span>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 border-t border-border pt-4">
        <Stat label="Products" value={w.totalProducts} />
        <Stat label="Units in stock" value={w.totalUnits} />
      </div>

      <div className="mt-4 flex items-center text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        View warehouse <ArrowRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value.toLocaleString()}</p>
    </div>
  );
}

function AddWarehouseDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [code, setCode] = useState("");

  const create = useMutation({
    mutationFn: () => createWarehouse({ name: name.trim(), city: city.trim(), code: code.trim().toUpperCase() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["warehouses-summary"] });
      toast.success("Warehouse added");
      setOpen(false);
      setName(""); setCity(""); setCode("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus className="mr-1.5 h-4 w-4" /> Add Warehouse
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a warehouse</DialogTitle>
          <DialogDescription>A warehouse is a physical location where you store inventory.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="wname">Name</Label>
            <Input id="wname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Delhi Warehouse" />
            <p className="flex items-center gap-1 text-xs text-muted-foreground"><Package className="h-3 w-3" /> A friendly name for your team.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="city">City</Label>
              <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Delhi" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="code">Code</Label>
              <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="DEL-01" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!name.trim() || !city.trim() || !code.trim() || create.isPending}
          >
            {create.isPending ? "Adding…" : "Add warehouse"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
