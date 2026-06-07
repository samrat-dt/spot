import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ShieldCheck, Warehouse, Package, Boxes, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { EmptyState } from "@/components/EmptyState";
import {
  FilterBar, MultiSelect, ChipGroup, DatePresetPicker, datePresetCutoff, type DatePreset,
} from "@/components/FilterBar";
import {
  fetchAuditLog, listWarehouses,
  AUDIT_ACTION_LABELS, AUDIT_ENTITY_LABELS,
  type AuditAction, type AuditEntityType,
} from "@/lib/wms";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit — Spot" },
      { name: "description", content: "Every change to warehouses, products, and bins." },
    ],
  }),
  component: AuditPage,
});

const ENTITY_OPTIONS: { value: AuditEntityType; label: string }[] = [
  { value: "warehouse", label: "Warehouse" },
  { value: "product", label: "Product" },
  { value: "bin", label: "Bin" },
  { value: "system", label: "System" },
];
const ACTION_OPTIONS: { value: AuditAction; label: string }[] = [
  { value: "created", label: "Created" },
  { value: "updated", label: "Edited" },
  { value: "archived", label: "Archived" },
  { value: "seeded", label: "Seeded" },
];

function AuditPage() {
  const { data = [], isLoading } = useQuery({ queryKey: ["audit"], queryFn: fetchAuditLog });
  const { data: warehouses = [] } = useQuery({ queryKey: ["warehouses-list"], queryFn: listWarehouses });

  const [search, setSearch] = useState("");
  const [entities, setEntities] = useState<AuditEntityType[]>([]);
  const [actions, setActions] = useState<AuditAction[]>([]);
  const [whs, setWhs] = useState<string[]>([]);
  const [datePreset, setDatePreset] = useState<DatePreset>("all");

  const filtered = useMemo(() => {
    const cutoff = datePresetCutoff(datePreset);
    const q = search.trim().toLowerCase();
    return data.filter((r: any) => {
      if (entities.length && !entities.includes(r.entity_type)) return false;
      if (actions.length && !actions.includes(r.action)) return false;
      if (whs.length && !whs.includes(r.warehouse_id)) return false;
      if (cutoff && new Date(r.created_at) < cutoff) return false;
      if (q) {
        const hay = [
          r.entity_name, r.entity_type, r.action, r.notes,
          JSON.stringify(r.changes ?? {}),
          r.warehouses?.name, r.warehouses?.code,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, search, entities, actions, whs, datePreset]);

  const clearAll = () => {
    setSearch(""); setEntities([]); setActions([]); setWhs([]); setDatePreset("all");
  };

  const pills: { key: string; label: string; onRemove: () => void }[] = [];
  entities.forEach((e) => pills.push({ key: `e-${e}`, label: AUDIT_ENTITY_LABELS[e], onRemove: () => setEntities(entities.filter((x) => x !== e)) }));
  actions.forEach((a) => pills.push({ key: `a-${a}`, label: AUDIT_ACTION_LABELS[a], onRemove: () => setActions(actions.filter((x) => x !== a)) }));
  whs.forEach((w) => {
    const name = warehouses.find((x) => x.id === w)?.name ?? "Warehouse";
    pills.push({ key: `w-${w}`, label: name, onRemove: () => setWhs(whs.filter((x) => x !== w)) });
  });
  if (datePreset !== "all") {
    pills.push({ key: "date", label: ({ today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" } as any)[datePreset], onRemove: () => setDatePreset("all") });
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <div>
        <p className="text-sm font-medium text-primary">Audit</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">
          Every change to your warehouses, products, and bins — who changed what, when. Append-only, newest first.
        </p>
      </div>

      <div className="mt-8">
        <FilterBar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search entity, field, value, notes…"
          pills={pills}
          onClearAll={clearAll}
          resultCount={filtered.length}
          totalCount={data.length}
        >
          <MultiSelect<AuditEntityType>
            label="Entity"
            icon={<Boxes className="h-3.5 w-3.5 opacity-70" />}
            options={ENTITY_OPTIONS}
            values={entities}
            onChange={setEntities}
            placeholder="Filter entity"
          />
          <MultiSelect<string>
            label="Warehouse"
            icon={<Warehouse className="h-3.5 w-3.5 opacity-70" />}
            options={warehouses.map((w) => ({ value: w.id, label: w.name, hint: w.code }))}
            values={whs}
            onChange={setWhs}
            placeholder="Find warehouse"
          />
          <DatePresetPicker value={datePreset} onChange={setDatePreset} />
        </FilterBar>

        <div className="mt-3">
          <ChipGroup<AuditAction> options={ACTION_OPTIONS} values={actions} onChange={setActions} />
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card shadow-card">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Loading audit log…</div>
        ) : data.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<ShieldCheck className="h-6 w-6" />}
              title="No changes yet"
              description="Every edit to warehouses, products, and bins will appear here."
            />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Entity</th>
                <th className="px-5 py-3">Details</th>
                <th className="px-5 py-3">Warehouse</th>
                <th className="px-5 py-3">When</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r: any) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-5 py-3.5"><ActionBadge action={r.action} /></td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <EntityIcon type={r.entity_type} />
                      <div>
                        <div className="font-medium">{r.entity_name}</div>
                        <div className="text-xs text-muted-foreground">{AUDIT_ENTITY_LABELS[r.entity_type as AuditEntityType] ?? r.entity_type}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-muted-foreground"><ChangesCell action={r.action} changes={r.changes} /></td>
                  <td className="px-5 py-3.5 text-muted-foreground">
                    {r.warehouses?.name ?? <span className="text-border">—</span>}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-muted-foreground whitespace-nowrap">
                    {format(new Date(r.created_at), "MMM d, yyyy · HH:mm")}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && data.length > 0 && (
                <tr><td colSpan={5} className="px-5 py-12 text-center text-sm text-muted-foreground">
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

function ActionBadge({ action }: { action: string }) {
  const cls =
    action === "created" ? "bg-success/10 text-success" :
    action === "archived" ? "bg-destructive/10 text-destructive" :
    action === "seeded" ? "bg-primary-soft text-primary" :
    "bg-primary-soft text-primary";
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {AUDIT_ACTION_LABELS[(action as AuditAction)] ?? action}
    </span>
  );
}

function EntityIcon({ type }: { type: string }) {
  const Icon = type === "warehouse" ? Warehouse : type === "product" ? Package : type === "bin" ? Boxes : Sparkles;
  return <Icon className="h-4 w-4 text-muted-foreground" />;
}

function ChangesCell({ action, changes }: { action: string; changes: any }) {
  if (!changes || (typeof changes === "object" && Object.keys(changes).length === 0)) {
    return <span className="text-border">—</span>;
  }
  if (action === "updated") {
    return (
      <div className="space-y-0.5">
        {Object.entries(changes).map(([field, v]: [string, any]) => (
          <div key={field} className="text-xs">
            <span className="font-medium text-foreground">{field}:</span>{" "}
            <span className="line-through opacity-60">{format2(v?.before)}</span>{" → "}
            <span className="font-medium text-foreground">{format2(v?.after)}</span>
          </div>
        ))}
      </div>
    );
  }
  // created / archived / seeded — snapshot
  return (
    <div className="space-y-0.5">
      {Object.entries(changes).map(([k, v]) => (
        <div key={k} className="text-xs">
          <span className="font-medium text-foreground">{k}:</span> {format2(v)}
        </div>
      ))}
    </div>
  );
}

function format2(v: unknown): string {
  if (v === null || v === undefined || v === "") return "∅";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
