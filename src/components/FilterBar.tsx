import { ReactNode } from "react";
import { Search, X, Calendar as CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronDown } from "lucide-react";

export type DatePreset = "all" | "today" | "7d" | "30d";

export const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

export function datePresetCutoff(p: DatePreset): Date | null {
  const now = new Date();
  if (p === "today") { const d = new Date(now); d.setHours(0,0,0,0); return d; }
  if (p === "7d") return new Date(now.getTime() - 7 * 86400_000);
  if (p === "30d") return new Date(now.getTime() - 30 * 86400_000);
  return null;
}

export function FilterBar({
  search, onSearch, searchPlaceholder = "Search…",
  children, pills, onClearAll, resultCount, totalCount,
}: {
  search: string;
  onSearch: (v: string) => void;
  searchPlaceholder?: string;
  children?: ReactNode;
  pills?: { key: string; label: string; onRemove: () => void }[];
  onClearAll?: () => void;
  resultCount: number;
  totalCount: number;
}) {
  const hasFilters = (pills?.length ?? 0) > 0 || search.trim().length > 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={searchPlaceholder} className="pl-9" />
        </div>
        {children}
      </div>
      {hasFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
          {search.trim() && (
            <FilterPill label={`Search: "${search.trim()}"`} onRemove={() => onSearch("")} />
          )}
          {pills?.map((p) => (
            <FilterPill key={p.key} label={p.label} onRemove={p.onRemove} />
          ))}
          {onClearAll && (
            <button onClick={onClearAll} className="ml-1 text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-2">
              Clear all
            </button>
          )}
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            Showing {resultCount.toLocaleString()} of {totalCount.toLocaleString()}
          </span>
        </div>
      )}
      {!hasFilters && (
        <div className="text-xs text-muted-foreground tabular-nums">
          {totalCount.toLocaleString()} {totalCount === 1 ? "entry" : "entries"}
        </div>
      )}
    </div>
  );
}

function FilterPill({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium">
      {label}
      <button onClick={onRemove} className="rounded-full p-0.5 hover:bg-background" aria-label={`Remove ${label}`}>
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ---- Multi-select dropdown ----
export function MultiSelect<T extends string>({
  label, options, values, onChange, icon, placeholder = "Search…",
}: {
  label: string;
  options: { value: T; label: string; hint?: string }[];
  values: T[];
  onChange: (v: T[]) => void;
  icon?: ReactNode;
  placeholder?: string;
}) {
  const summary = values.length === 0
    ? label
    : values.length === 1
      ? options.find((o) => o.value === values[0])?.label ?? label
      : `${label} · ${values.length}`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          {icon}
          <span className="text-sm">{summary}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[260px] p-0" align="start">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>No matches.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const selected = values.includes(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    onSelect={() => {
                      onChange(selected ? values.filter((v) => v !== o.value) : [...values, o.value]);
                    }}
                    className="flex items-center gap-2"
                  >
                    <div className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>
                      {selected && <Check className="h-3 w-3" />}
                    </div>
                    <span className="flex-1">{o.label}</span>
                    {o.hint && <span className="text-xs text-muted-foreground">{o.hint}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ---- Chip group (single-select multi-toggle) ----
export function ChipGroup<T extends string>({
  options, values, onChange,
}: {
  options: { value: T; label: string }[];
  values: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = values.includes(o.value);
        return (
          <button
            key={o.value}
            onClick={() => onChange(active ? values.filter((v) => v !== o.value) : [...values, o.value])}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Date preset picker ----
export function DatePresetPicker({ value, onChange }: { value: DatePreset; onChange: (v: DatePreset) => void }) {
  const current = DATE_PRESETS.find((p) => p.value === value)?.label ?? "All time";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5">
          <CalendarIcon className="h-3.5 w-3.5 opacity-70" />
          <span className="text-sm">{current}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[180px] p-1" align="start">
        {DATE_PRESETS.map((p) => (
          <button
            key={p.value}
            onClick={() => onChange(p.value)}
            className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm hover:bg-muted ${value === p.value ? "font-semibold text-primary" : ""}`}
          >
            {p.label}
            {value === p.value && <Check className="h-3.5 w-3.5" />}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
