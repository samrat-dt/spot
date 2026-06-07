# Spot WMS — Architecture

> **For agents:** This document is ground-truth. Read it fully before making code changes. Every section reflects the actual code as of the last commit.

---

## 1. App Overview

**Spot** is a single-tenant, client-rendered **Warehouse Management System (WMS)**. It tracks the movement of physical goods across multiple warehouses by modelling four core entities: warehouses, bins, products, and inventory.

### What it does

| Domain | Operations |
|---|---|
| **Warehouses** | Create, edit, archive. Each warehouse has a name, city, and a short unique code. |
| **Bins** | Create, rename, archive within a warehouse. A bin is a physical storage slot addressed by aisle / rack / shelf. |
| **Products** | Create, edit, archive. Global product catalog shared across all warehouses. |
| **Inventory** | Add, adjust (delta + reason + notes), transfer between warehouses. Tracks `(product, bin, warehouse) → quantity`. |
| **Activity log** | Append-only ledger of every inventory change (adds, adjustments, transfers). |
| **Audit log** | Append-only ledger of every platform-level change (warehouse/bin/product create, edit, archive). |

### What it does NOT do

- No user authentication or multi-tenancy (single shared database, `USING (true)` RLS)
- No Supabase Realtime (data refreshes only on mutation)
- No pagination (hard cap of 500 rows on activity/audit feeds)
- No RBAC (all operations available to everyone)
- No mobile layout (fixed max-width, tables don't reflow)
- No purchase orders, reservations, or barcode scanning
- No bulk CSV import

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Meta-framework | TanStack Start (SSR shell via Nitro) | ^1.167 |
| UI runtime | React | ^19.2 |
| Routing | TanStack Router (file-based, code-gen) | ^1.168 |
| Server state / cache | TanStack React Query | ^5.83 |
| Database / BaaS | Supabase (PostgreSQL + PostgREST) | JS SDK ^2.107 |
| Component primitives | Shadcn UI (Radix UI) | latest |
| Styling | Tailwind CSS v4 (Vite plugin) | ^4.2 |
| Icons | Lucide React | ^0.575 |
| Toast notifications | Sonner | ^2.0 |
| Date formatting | date-fns | ^4.1 |
| Build tool | Vite | ^7.3 |
| Package manager / runtime | Bun | (bunfig.toml) |
| Language | TypeScript | ^5.8 |

### Key integration details

- **`vite.config.ts`** delegates to `@lovable.dev/vite-tanstack-config`. This package wires up TanStack Start, React, Tailwind v4, `tsConfigPaths`, the `@/` path alias, and Nitro internally. Do **not** add those plugins manually — doing so breaks the build with duplicate plugin errors.
- **SSR** is handled by Nitro (targeting Cloudflare Workers by default). The app renders on the server for the initial HTML load, then hydrates as a React SPA for subsequent navigation.
- **`src/server.ts`** is the Nitro entry point. It wraps the TanStack Start server handler in an error catcher that reports unexpected server-side errors via `lovable-error-reporting`.
- **`src/router.tsx`** calls `createRouter()` and injects a shared `QueryClient` into route context, making the same React Query cache available to all loaders and components.

---

## 3. Infrastructure & Deployment

```
Browser ──HTTPS──► Cloudflare Worker (Nitro/SSR)
                        │
                        ├── Renders initial HTML (TanStack Start SSR)
                        │
                        └──HTTPS──► Supabase
                                        ├── PostgreSQL (PostgREST REST API)
                                        └── anon key (public, RLS enforced)
```

- The frontend is hosted as a **Cloudflare Worker** (Nitro target). Static assets are served from the same edge deployment.
- All database calls go from the **browser** directly to **Supabase's PostgREST endpoint** using the `anon` key. There is no custom API layer between the browser and Supabase.
- On the server side (during SSR), the same `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` environment variables are used (falling back to `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY`).
- A `client.server.ts` exists for service-role access during SSR (currently unused by WMS features — scaffold only).

---

## 4. Database Schema

Two migrations in `supabase/migrations/`:

| File | Contents |
|---|---|
| `20260607135042_…sql` | Core tables: `warehouses`, `bins`, `products`, `inventory`, `activity_log`. Also: `adjustment_reason` enum, `set_updated_at()` trigger, all indexes and RLS policies. |
| `20260607151940_…sql` | `audit_log` table, its indexes and RLS policies. |

### 4.1 `warehouses`

```sql
id          UUID PK DEFAULT gen_random_uuid()
name        TEXT NOT NULL
city        TEXT NOT NULL
code        TEXT NOT NULL UNIQUE               -- e.g. "DEL-01", always uppercased by app
is_deleted  BOOLEAN NOT NULL DEFAULT false    -- soft-delete
created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at  TIMESTAMPTZ NOT NULL DEFAULT now() -- maintained by trigger
```

- `code` is globally unique across all warehouses (including archived ones unless `is_deleted` filter applied — the app checks `is_deleted = false`).
- The `set_updated_at()` trigger fires `BEFORE UPDATE` on every row change.
- RLS: `FOR ALL USING (true) WITH CHECK (true)` — fully public.

### 4.2 `bins`

```sql
id            UUID PK DEFAULT gen_random_uuid()
warehouse_id  UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE
aisle         TEXT NOT NULL                    -- e.g. "A"
rack          TEXT NOT NULL                    -- e.g. "01"
shelf         TEXT NOT NULL                    -- e.g. "B"
bin_label     TEXT GENERATED ALWAYS AS
                (aisle || '-' || rack || '-' || shelf) STORED
                                               -- e.g. "A-01-B" — computed by Postgres, immutable from app
is_deleted    BOOLEAN NOT NULL DEFAULT false
created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE (warehouse_id, aisle, rack, shelf)
```

- `bin_label` is a **GENERATED ALWAYS AS STORED** column. The application **cannot write to it directly** — writing `aisle`, `rack`, `shelf` is sufficient. Postgres derives the label at insert/update time.
- The unique constraint is on `(warehouse_id, aisle, rack, shelf)`, which implicitly enforces label uniqueness per warehouse.
- The app does a client-side duplicate check before `INSERT` / `UPDATE` to produce a user-friendly error instead of a Postgres constraint violation.

### 4.3 `products`

```sql
id               UUID PK DEFAULT gen_random_uuid()
name             TEXT NOT NULL
sku_code         TEXT NOT NULL UNIQUE           -- always uppercased by app
unit_of_measure  TEXT NOT NULL DEFAULT 'unit'   -- e.g. "unit", "kg", "box"
is_deleted       BOOLEAN NOT NULL DEFAULT false
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
```

- `sku_code` is globally unique. The app does a client-side check on `is_deleted = false` rows before inserting.
- SKU cannot be changed after creation (no `updateProduct()` parameter for it) — it may be used as an external reference.

### 4.4 `inventory`

```sql
id            UUID PK DEFAULT gen_random_uuid()
product_id    UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE
bin_id        UUID NOT NULL REFERENCES bins(id)       ON DELETE CASCADE
warehouse_id  UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE
quantity      INTEGER NOT NULL DEFAULT 0
is_deleted    BOOLEAN NOT NULL DEFAULT false
created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
UNIQUE (product_id, bin_id)
```

- `warehouse_id` is **denormalized** (derivable from `bin.warehouse_id`) for fast warehouse-scoped queries without an extra join.
- `UNIQUE (product_id, bin_id)` means a product appears **at most once per bin**. Transfers into a bin that already has the product merge quantities (the app does an upsert).
- `is_deleted = true` is set when a bin or product is archived (soft cascade — actual DB foreign key is ON DELETE CASCADE but the app sets `is_deleted` before archiving the parent).

### 4.5 `activity_log`

```sql
id              UUID PK DEFAULT gen_random_uuid()
product_id      UUID NOT NULL REFERENCES products(id)   ON DELETE CASCADE
warehouse_id    UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE
bin_id          UUID NOT NULL REFERENCES bins(id)       ON DELETE CASCADE
quantity_delta  INTEGER NOT NULL                        -- positive = added, negative = removed
reason          adjustment_reason NOT NULL              -- see §4.7
notes           TEXT                                    -- optional operator annotation
reference_id    UUID                                    -- links transfer_out + transfer_in pairs
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()      -- no updated_at, no is_deleted
```

- **Append-only** by design: RLS allows `SELECT` and `INSERT` for `anon`/`authenticated`, but not `UPDATE` or `DELETE`.
- No `updated_at` trigger or `is_deleted` flag — rows are permanent.
- `reference_id`: when `transferStock()` is called, it generates a `crypto.randomUUID()` and writes it to **both** the `transfer_out` and `transfer_in` rows so they can be identified as a pair.

### 4.6 `audit_log`

```sql
id           UUID PK DEFAULT gen_random_uuid()
entity_type  TEXT NOT NULL                     -- 'warehouse' | 'product' | 'bin' | 'system'
entity_id    UUID                              -- nullable for 'system' events (e.g. seed)
entity_name  TEXT NOT NULL                    -- denormalized snapshot of name at time of change
action       TEXT NOT NULL                    -- 'created' | 'updated' | 'archived' | 'seeded'
changes      JSONB NOT NULL DEFAULT '{}'      -- diff for 'updated', snapshot for 'created'/'archived'
warehouse_id UUID                             -- nullable; set for bins (their parent warehouse)
notes        TEXT                             -- unused by current write paths, reserved for future
created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
```

- **Append-only**: same RLS pattern as `activity_log` (INSERT + SELECT only).
- `changes` structure:
  - For `created`: snapshot of fields at creation time, e.g. `{"name": "Delhi", "city": "Delhi", "code": "DEL-01"}`
  - For `updated`: per-field diff, e.g. `{"name": {"before": "Delhi Warehouse", "after": "Delhi Hub"}}`
  - For `archived`: snapshot of fields at archive time
  - For `seeded`: summary counts, e.g. `{"warehouses": 3, "products": 5, "bins": 24, "inventory_rows": 15}`

Indexes:
```sql
audit_log_created_at_idx   ON audit_log(created_at DESC)
audit_log_entity_type_idx  ON audit_log(entity_type)
audit_log_warehouse_id_idx ON audit_log(warehouse_id)
```

### 4.7 `adjustment_reason` Enum

```sql
CREATE TYPE public.adjustment_reason AS ENUM (
  'received_stock',    -- goods received into warehouse
  'sold',              -- stock removed after sale
  'damaged',           -- goods written off as damaged
  'returned',          -- goods returned from customer/vendor
  'manual_correction', -- arbitrary correction
  'transfer_in',       -- written automatically by transferStock()
  'transfer_out'       -- written automatically by transferStock()
);
```

`transfer_in` and `transfer_out` are **system-only** — they are not shown in the Edit drawer's reason select. The remaining five are user-selectable.

### 4.8 Entity Relationships

```
warehouses ──1:N──► bins
warehouses ──1:N──► inventory    (denormalized warehouse_id)
warehouses ──1:N──► activity_log (denormalized warehouse_id)
warehouses ──1:N──► audit_log    (nullable warehouse_id, set for bins)

products   ──1:N──► inventory
products   ──1:N──► activity_log

bins       ──1:N──► inventory
bins       ──1:N──► activity_log

inventory  represents a unique (product × bin) placement
  UNIQUE (product_id, bin_id)
```

### 4.9 Database Indexes

| Index | Table.Column | Purpose |
|---|---|---|
| `idx_inventory_warehouse` | `inventory(warehouse_id)` | Warehouse-scoped inventory reads |
| `idx_bins_warehouse` | `bins(warehouse_id)` | Bin list for a warehouse |
| `idx_activity_created` | `activity_log(created_at DESC)` | Chronological activity feed |
| `audit_log_created_at_idx` | `audit_log(created_at DESC)` | Chronological audit feed |
| `audit_log_entity_type_idx` | `audit_log(entity_type)` | Entity type filtering |
| `audit_log_warehouse_id_idx` | `audit_log(warehouse_id)` | Warehouse-scoped audit reads |

### 4.10 Row Level Security Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `warehouses` | public | public | public | public |
| `bins` | public | public | public | public |
| `products` | public | public | public | public |
| `inventory` | public | public | public | public |
| `activity_log` | public | public | ✗ | ✗ |
| `audit_log` | public | public | ✗ | ✗ |

All "public" policies use `USING (true)`. There is no per-user data isolation.

---

## 5. Client Data Layer (`src/lib/wms.ts`)

All database access lives in **`src/lib/wms.ts`**. Components call these functions as React Query `queryFn` / `mutationFn` values. There is no intermediate API route.

### 5.1 Constants & Types

| Export | Description |
|---|---|
| `LOW_STOCK_THRESHOLD = 10` | Units below this trigger warning highlights on the warehouse card and inventory rows |
| `type Reason` | Union of all 7 `adjustment_reason` enum values |
| `REASON_LABELS: Record<Reason, string>` | Maps enum values to display strings |
| `type AuditAction` | `"created" \| "updated" \| "archived" \| "seeded"` |
| `type AuditEntityType` | `"warehouse" \| "product" \| "bin" \| "system"` |
| `AUDIT_ACTION_LABELS` | Maps `AuditAction` to display strings |
| `AUDIT_ENTITY_LABELS` | Maps `AuditEntityType` to display strings |
| `type BinSummary` | `{ id, bin_label, aisle, rack, shelf, productCount, totalUnits }` |
| `type ProductSummary` | `{ id, name, sku_code, unit_of_measure, totalUnits, binCount }` |

### 5.2 Read Functions

| Function | Fetches | Aggregation |
|---|---|---|
| `fetchWarehouseSummaries()` | All non-deleted warehouses + full inventory table | `totalProducts`, `totalUnits`, `lowStock` aggregated client-side per warehouse |
| `fetchWarehouseDetail(id)` | One warehouse + its non-deleted inventory rows, joining `bins(id, bin_label)` and `products(id, name, sku_code)` | None — flat rows |
| `fetchBinsForWarehouse(id)` | All non-deleted bins for a warehouse + inventory for that warehouse | `productCount`, `totalUnits` aggregated client-side per bin |
| `fetchActivity()` | 500 most-recent `activity_log` rows, joining product, warehouse, bin | None — returned as-is |
| `fetchAuditLog()` | 500 most-recent `audit_log` rows, joining `warehouses(name, code)` | None — returned as-is |
| `fetchProducts()` | All non-deleted products + full inventory table | `totalUnits`, `binCount` aggregated client-side per product |
| `listWarehouses()` | All non-deleted warehouses ordered by name | — |
| `listBins(warehouseId)` | All non-deleted bins for a warehouse, ordered by `bin_label` | — |
| `listProducts()` | All non-deleted products ordered by name | — |

### 5.3 Mutation Functions

#### Warehouse CRUD

| Function | Writes | Guards |
|---|---|---|
| `createWarehouse(input)` | `INSERT INTO warehouses` then `writeAudit(created)` | Client-side `SELECT` before `INSERT` to check `code` uniqueness |
| `updateWarehouse(id, input)` | `UPDATE warehouses` then `writeAudit(updated)` with diff | Client-side duplicate code check (excludes self). Diff computed with `diffObj()` |
| `archiveWarehouse(id)` | `UPDATE warehouses SET is_deleted=true` then `writeAudit(archived)` | Checks total non-zero inventory across all bins; throws if `> 0` |

#### Bin CRUD

| Function | Writes | Guards |
|---|---|---|
| `createBin(input)` | `INSERT INTO bins` then `writeAudit(created)` | Client-side `SELECT` checks label uniqueness within warehouse |
| `updateBin(id, input)` | `UPDATE bins` then `writeAudit(updated)` with diff | Client-side duplicate check (excludes self) |
| `archiveBin(id)` | Optionally soft-deletes inventory rows, `UPDATE bins SET is_deleted=true`, `writeAudit(archived)` | Throws if bin still has non-zero units |

#### Product CRUD

| Function | Writes | Guards |
|---|---|---|
| `createProduct(input)` | `INSERT INTO products` then `writeAudit(created)` | Client-side `SELECT` checks SKU uniqueness |
| `updateProduct(id, input)` | `UPDATE products` then `writeAudit(updated)` with diff | SKU cannot be changed (not in the update input type) |
| `archiveProduct(id)` | Optionally soft-deletes inventory rows, `UPDATE products SET is_deleted=true`, `writeAudit(archived)` | Throws if product still has any units across all warehouses |

#### Inventory Operations

| Function | Writes | Notes |
|---|---|---|
| `addInventory(args)` | `UPSERT inventory` (merge if `(product, bin)` exists), `INSERT activity_log` if `qty > 0` | Reason defaults to `received_stock`; caller can pass other values |
| `adjustInventory(args)` | `UPDATE inventory`, `INSERT activity_log` | **Two sequential writes — not atomic.** Validates `next >= 0`. Reads `currentQuantity` at render time (stale-read race possible under concurrency) |
| `transferStock(args)` | `UPDATE inventory (source)`, `UPSERT inventory (dest)`, `INSERT 2 × activity_log` | **Four sequential writes — not atomic.** Generates one `referenceId` shared by both log rows. Validates qty > 0, qty ≤ source, source ≠ dest bin |
| `seedDemoData()` | Bulk insert warehouses + products + bins + inventory + `writeAudit(seeded)` | Aborts silently if any non-deleted warehouse exists |

### 5.4 The `writeAudit` Helper

```ts
async function writeAudit(row: {
  entity_type: AuditEntityType;
  entity_id: string | null;   // null for 'system' events
  entity_name: string;         // name at time of change
  action: AuditAction;
  changes?: Record<string, unknown>;
  warehouse_id?: string | null;
  notes?: string | null;
}) {
  // Silently swallows errors — audit failure never rolls back the main operation
}
```

Pattern: every mutation (warehouse, bin, product, seed) calls `writeAudit` **after** the primary write succeeds. If the audit write fails, the error is logged to console but the user's operation is not rolled back.

`diffObj<T>(before, after, fields)` computes a per-field `{ before, after }` diff object, skipping unchanged fields. Used by `updateWarehouse`, `updateBin`, `updateProduct`.

---

## 6. Routing Architecture

TanStack Router uses **file-based routing**. The router auto-generates `src/routeTree.gen.ts` from the `src/routes/` directory — **never edit `routeTree.gen.ts` manually**.

### Route Tree

```
__root.tsx            ← HTML shell (RootShell), QueryClientProvider, AppHeader, Toaster
  index.tsx           → GET /
  warehouses.$id.tsx  → GET /warehouses/:id
  products.tsx        → GET /products
  activity.tsx        → GET /activity
  audit.tsx           → GET /audit
  [notFoundComponent] → matches any unmatched path — renders AppHeader + 404 content
  [errorComponent]    → renders AppHeader + error message + "Try again" button
```

### `__root.tsx` — Root Route

- **`RootShell`**: the outer HTML document (`<html>`, `<head>`, `<body>`, `<Scripts>`). Contains `HeadContent` for SSR-injected meta/link tags.
- **`RootComponent`**: wrapped in `QueryClientProvider`. Renders `AppHeader` (sticky top nav), `<Outlet>` (active route), and `<Toaster position="bottom-right" richColors closeButton>`.
- **`NotFoundComponent`**: renders `AppHeader` + centered 404 card with a "Back to warehouses" link.
- **`ErrorComponent`**: renders `AppHeader` + centered error card. Calls `reportLovableError()` on mount. "Try again" calls `router.invalidate(); reset()`.
- Both `NotFoundComponent` and `ErrorComponent` render **outside** `RootComponent` (no `QueryClientProvider`) but **with** `AppHeader` (which doesn't need query context).

### Route: `GET /` — Warehouses Overview

- **File**: `src/routes/index.tsx`
- **Queries**: `useQuery(['warehouses-summary'], fetchWarehouseSummaries)`
- **Mutations**: `createWarehouse` (invalidates `warehouses-summary`), `seedDemoData` (same)
- **UI**:
  - Header: page title + "Load demo data" button (visible only when `warehouses.length === 0 && !isLoading`) + "Add Warehouse" dialog trigger
  - Body: responsive `grid gap-5 sm:grid-cols-2 lg:grid-cols-3` of `WarehouseCard` components
  - `WarehouseCard`: links to `/warehouses/$id`. Shows name, city, total products, total units, and a low-stock badge if `lowStock > 0`
  - Loading: 3 skeleton pulse cards
  - Empty: `EmptyState` with "Add Warehouse" action

### Route: `GET /warehouses/:id` — Warehouse Detail

- **File**: `src/routes/warehouses.$id.tsx`
- **Param**: `id` — warehouse UUID from the URL
- **Queries**:
  - `['warehouse-detail', id]` → `fetchWarehouseDetail(id)` — warehouse metadata + inventory rows
  - `['bins-summary', id]` → `fetchBinsForWarehouse(id)` — bin list with counts
  - `['wh-list']` → `listWarehouses()` — for TransferDrawer destination picker
  - `['bins', destWh]` → `listBins(destWh)` — for TransferDrawer bin picker (enabled only when dest warehouse selected)
  - `['dest-existing', destWh, productId]` — inline query for existing inventory at dest to show merge hint
- **Not-found guard**: `if (!isLoading && !data?.warehouse) throw notFound()` → renders `NotFoundComponent`
- **Top-level state** (all `useState` in `WarehouseDetailPage`):
  - `editRow: Row | null` — triggers `EditDrawer` (Sheet)
  - `transferRow: Row | null` — triggers `TransferDrawer` (Sheet)
  - `addInvOpen: boolean` — triggers `AddInventoryDialog`
  - `editWhOpen: boolean` — triggers `EditWarehouseDialog`
  - `archiveWhOpen: boolean` — triggers archive confirm `AlertDialog`
  - `addBinOpen: boolean` — triggers `AddBinDialog`
  - `editBin: BinSummary | null` — triggers `EditBinDialog`
  - `archiveBinTarget: BinSummary | null` — triggers `ArchiveBinDialog`

**Bins panel** — section above inventory:
- Lists all bins as small cards (grid). Each shows `bin_label`, product count, unit count.
- Per-bin `DropdownMenu`: Rename → `EditBinDialog`, Archive → `ArchiveBinDialog`.
- Archive blocked if bin has units (error toast from `archiveBin()`).
- Empty state: prompt to add a bin.

**Inventory panel** — main table:
- Columns: Product, SKU, Bin, Units, Last Updated, Actions (Edit + Transfer)
- Search: client-side filter by `products.name` or `products.sku_code`
- Units column: `AnimatedCount` interpolates over 14 frames at 18 ms intervals on value change
- Low-stock: rows with `quantity < 10` get `text-warning-foreground` + amber background + `AlertTriangle` icon
- **Add inventory** button disabled when `bins.length === 0` (must create a bin first)

**`EditDrawer`** (Sheet, max-w-md):
- Current quantity displayed large in a card
- Delta input (positive to add, negative to remove)
- Real-time new-quantity preview below input; shows red warning if result would go below 0
- Reason select: 5 user-facing values (excludes `transfer_in`/`transfer_out`), defaults to `received_stock`
- Notes textarea (optional)
- Calls `adjustInventory()`. Invalidates `warehouse-detail`, `bins-summary`, `warehouses-summary`, `products-summary`, `activity`.

**`TransferDrawer`** (Sheet, max-w-md):
- "From" card: shows product, source warehouse, source bin, units on hand
- Destination warehouse select (excludes current warehouse)
- Destination bin select (loads on warehouse selection): grouped into "Already has this product" and "Other bins"
- Merge hint: if selected dest bin already has the product, shows current quantity + "they'll be combined"
- Quantity input
- Notes textarea (optional)
- Calls `transferStock()`. Success toast includes "View destination" action that navigates to the dest warehouse.
- Invalidates `warehouse-detail`, `bins-summary`, `warehouses-summary`, `products-summary`, `activity`.

**`AddInventoryDialog`** (Dialog, sm:max-w-lg):
- Product picker (all non-deleted products)
- Bin picker (this warehouse's bins only)
- Starting quantity (≥ 0)
- Reason: 3 options (`received_stock`, `returned`, `manual_correction`)
- Notes textarea (optional)

**`AddBinDialog`** / **`EditBinDialog`**: aisle + rack + shelf inputs with live bin label preview.

**`EditWarehouseDialog`**: name, city, code fields. Code uniqueness checked before save.

**`ArchiveBinDialog`** / archive warehouse confirm: `AlertDialog`. Warns with remaining unit count if inventory present.

### Route: `GET /products` — Product Catalog

- **File**: `src/routes/products.tsx`
- **Queries**: `useQuery(['products-summary'], fetchProducts)`
- **UI**: Table with search (name or SKU). Columns: name, SKU, unit of measure, bin count, total units, Edit + Archive buttons.
- **AddProductDialog**: name + SKU + unit of measure
- **EditProductDialog**: name + unit of measure only (SKU immutable)
- **ArchiveProductDialog**: warns with unit count; `archiveProduct()` enforces the guard server-side too

### Route: `GET /activity` — Activity Log

- **File**: `src/routes/activity.tsx`
- **Queries**:
  - `['activity']` → `fetchActivity()` (500 rows, newest first)
  - `['warehouses-list']` → `listWarehouses()` (for filter dropdown)
  - `['products-list']` → `listProducts()` (for filter dropdown)
- **Filter state** (all `useState`, no URL params):
  - `search: string` — matches against `products.name`, `products.sku_code`, `warehouses.name`, `warehouses.code`, `bins.bin_label`, `notes`
  - `whs: string[]` — multi-select warehouse IDs
  - `prods: string[]` — multi-select product IDs
  - `reasons: Reason[]` — multi-select reason codes
  - `directions: Direction[]` — "in" (delta ≥ 0) or "out" (delta < 0)
  - `datePreset: DatePreset` — "all" | "today" | "7d" | "30d"
- **Transfer pair grouping**: `processedItems` memo groups rows by `reference_id`. Complete pairs (both `transfer_out` and `transfer_in` present in `filtered`) render as two adjacent rows with partner annotations ("→ Destination" on the out-row, "← Source" on the in-row). The in-row uses `border-t border-primary/20` instead of the standard border. Orphaned rows (partner filtered out) render as single rows.
- **Table columns**: Product, Warehouse, Bin, Change (signed delta badge), Reason + partner annotation, Notes, When

### Route: `GET /audit` — Audit Log

- **File**: `src/routes/audit.tsx`
- **Queries**:
  - `['audit']` → `fetchAuditLog()` (500 rows, newest first)
  - `['warehouses-list']` → `listWarehouses()` (for filter dropdown)
- **Filter state** (all `useState`):
  - `search: string` — matches against `entity_name`, `entity_type`, `action`, `notes`, `JSON.stringify(changes)`, `warehouses.name`, `warehouses.code`
  - `entities: AuditEntityType[]` — multi-select entity types
  - `actions: AuditAction[]` — multi-select action types (via ChipGroup)
  - `whs: string[]` — multi-select warehouse IDs
  - `datePreset: DatePreset`
- **Table columns**: Action badge, Entity (icon + name + type), Details (`ChangesCell`), Warehouse, When
- **`ChangesCell`**: for `updated` action, renders per-field diff (`before → after`). For others, renders key-value snapshot.
- **`ActionBadge`**: green for `created`, red for `archived`, blue for `updated`/`seeded`.

---

## 7. Component Architecture

### `AppHeader` (`src/components/AppHeader.tsx`)

Sticky top nav (`z-30`, `backdrop-blur`). Contains the Spot logo (links to `/`) and four `NavLink` components: Warehouses, Products, Activity, Audit.

`NavLink` uses TanStack Router's `activeOptions={{ exact: to === "/" }}` to avoid `/` matching all routes, and the `data-[status=active]` attribute for active styling.

### `EmptyState` (`src/components/EmptyState.tsx`)

Reusable empty-state card: icon, title, description, optional `action` slot. Used on every route and in every table's empty body.

### `FilterBar` (`src/components/FilterBar.tsx`)

Shared filter UI used by both Activity and Audit pages. Exported sub-components:

| Component | Description |
|---|---|
| `FilterBar` | Container: search input + children slot for filter controls + active-filter pills row + result count |
| `MultiSelect<T>` | Popover with a `Command` palette for multi-select of typed values. Shows selected count in trigger label. |
| `ChipGroup<T>` | Horizontal row of toggle chips (multi-select). Used for Reason on Activity and Action on Audit. |
| `DatePresetPicker` | Popover offering "All time / Today / Last 7 days / Last 30 days". |
| `datePresetCutoff(preset)` | Pure function returning a `Date` cutoff for the preset, or `null` for "all". |
| `type DatePreset` | `"all" \| "today" \| "7d" \| "30d"` |

Filter state is **local `useState`** in each route component — not persisted to URL search params (the design document planned URL params but the implementation uses local state).

### `AnimatedCount` (`src/routes/warehouses.$id.tsx`)

Inline component that animates a numeric value over 14 steps at 18 ms intervals when the value prop changes. Uses `setInterval` + `clearInterval` cleanup in `useEffect`.

### Shadcn UI components (`src/components/ui/`)

Full set of generated Shadcn components (Button, Dialog, Sheet, Select, Input, Textarea, Label, DropdownMenu, AlertDialog, Popover, Command, etc.). All use `class-variance-authority` (CVA) for variant handling and `clsx` + `tailwind-merge` (via `cn()`) for conditional classes.

---

## 8. State Management

### React Query Cache

All server state is managed by TanStack React Query. The shared `QueryClient` is injected into route context in `src/router.tsx` and consumed via `Route.useRouteContext()` in `__root.tsx`.

| Cache key | Function | Invalidated after |
|---|---|---|
| `['warehouses-summary']` | `fetchWarehouseSummaries` | `createWarehouse`, `updateWarehouse`, `archiveWarehouse`, `seedDemoData`, `adjustInventory`, `transferStock`, `addInventory`, `archiveProduct` |
| `['warehouse-detail', id]` | `fetchWarehouseDetail(id)` | `adjustInventory`, `transferStock`, `addInventory`, `updateBin`, `archiveBin`, `updateProduct` |
| `['bins-summary', id]` | `fetchBinsForWarehouse(id)` | `createBin`, `updateBin`, `archiveBin`, `adjustInventory`, `transferStock`, `addInventory` |
| `['products-summary']` | `fetchProducts` | `createProduct`, `updateProduct`, `archiveProduct` |
| `['products-list']` | `listProducts` | `createProduct`, `updateProduct`, `archiveProduct` |
| `['activity']` | `fetchActivity` | `adjustInventory`, `transferStock`, `addInventory` |
| `['audit']` | `fetchAuditLog` | (not invalidated — audit page does not perform mutations) |
| `['warehouses-list']` | `listWarehouses` | Not explicitly invalidated |
| `['wh-list']` | `listWarehouses` (TransferDrawer) | Not explicitly invalidated |
| `['bins', warehouseId]` | `listBins(warehouseId)` | Not explicitly invalidated |
| `['dest-existing', whId, productId]` | Inline supabase query in TransferDrawer | Enabled only when `destWh && row` |

### Local State

UI state (open/closed modals, form inputs, selected rows, search strings, filter values) is managed with `useState` in each route component. No global state management library.

---

## 9. Key Data Flows

### Adding inventory to a bin

```
User fills AddInventoryDialog (product + bin + quantity + reason)
  → addInventory(args) in wms.ts
      → supabase: SELECT inventory WHERE (product, bin) to check for existing row
          → if exists: UPDATE inventory SET quantity += args.quantity
          → if new:    INSERT inventory (product, bin, warehouse, quantity)
      → if quantity > 0:
          → supabase: INSERT activity_log (product, warehouse, bin, delta=qty, reason)
  → qc.invalidateQueries(['warehouse-detail', id])
  → qc.invalidateQueries(['bins-summary', id])
  → qc.invalidateQueries(['warehouses-summary'])
  → qc.invalidateQueries(['products-summary'])
  → qc.invalidateQueries(['activity'])
  → toast.success("Inventory added")
```

### Adjusting inventory (Edit)

```
User fills EditDrawer (delta + reason + notes)
  → adjustInventory(args) in wms.ts
      → validates next = currentQuantity + delta >= 0
      → supabase: UPDATE inventory SET quantity=next WHERE id=inventoryId
      → supabase: INSERT activity_log (delta, reason, notes)
  → invalidate: warehouse-detail, bins-summary, warehouses-summary, products-summary, activity
  → toast.success("Inventory updated", { description })
```

### Transferring stock between warehouses

```
User fills TransferDrawer (destWh + destBin + quantity + notes)
  → transferStock(args) in wms.ts
      → validates: qty > 0, qty ≤ sourceQuantity, sourceBin ≠ destBin
      → supabase: UPDATE inventory (source) SET quantity -= qty
      → supabase: SELECT inventory WHERE (product, destBin) to check for existing
          → if exists: UPDATE inventory (dest) SET quantity += qty
          → if new:    INSERT inventory (product, destBin, destWarehouse, quantity=qty)
      → referenceId = crypto.randomUUID()
      → supabase: INSERT activity_log × 2 (transfer_out with -qty, transfer_in with +qty, both share referenceId)
  → invalidate: warehouse-detail, bins-summary, warehouses-summary, products-summary, activity
  → toast.success("N units transferred …", { action: "View destination" → navigate })
```

### Archiving a warehouse

```
User clicks "Archive warehouse" → confirms AlertDialog
  → archiveWarehouse(id) in wms.ts
      → supabase: SELECT inventory WHERE warehouse_id=id AND is_deleted=false
      → aggregates remaining = sum(quantity)
      → if remaining > 0: throw Error("Cannot archive: N units still in stock")
      → supabase: SELECT warehouses for audit snapshot
      → supabase: UPDATE warehouses SET is_deleted=true
      → writeAudit(archived, snapshot)
  → invalidate: warehouses-summary
  → toast.success("Warehouse archived")
  → navigate({ to: "/" })
```

### Creating / editing a platform entity (warehouse/bin/product)

```
User submits create or edit dialog
  → create/update function in wms.ts
      → client-side uniqueness check (code/label/SKU)
      → supabase: INSERT or UPDATE
      → writeAudit(created or updated, changes)
  → invalidate relevant query keys
  → toast.success(...)
```

---

## 10. UI / Design System

### Tailwind v4 Configuration

The app uses **Tailwind CSS v4** configured via the `@tailwindcss/vite` plugin (included by `@lovable.dev/vite-tanstack-config`). Tailwind v4 reads `@source "../src"` from `src/styles.css` to find classes.

Custom design tokens are defined as CSS custom properties in `:root {}` in `src/styles.css` and mapped into Tailwind's `@theme inline {}` block:

### Design Tokens

| Token | Value | Usage |
|---|---|---|
| `--primary` | `oklch(0.515 0.245 277)` — Indigo #4F46E5 | Buttons, active nav, badges |
| `--primary-soft` | `oklch(0.96 0.025 277)` — light indigo tint | Transfer row backgrounds, badges |
| `--background` | `oklch(0.995 0.002 260)` — near-white | Page background |
| `--card` | `oklch(1 0 0)` — pure white | Card backgrounds |
| `--muted` | `oklch(0.97 0.005 260)` | Table headers, subtle backgrounds |
| `--muted-foreground` | `oklch(0.5 0.015 260)` — medium gray | Secondary text |
| `--destructive` | `oklch(0.6 0.22 27)` — red | Error text, archive actions |
| `--warning` | `oklch(0.78 0.16 75)` — amber | Low-stock highlights |
| `--warning-soft` | `oklch(0.97 0.05 85)` — pale amber | Low-stock row backgrounds |
| `--success` | `oklch(0.62 0.16 150)` — green | Positive delta badges |
| `--border` | `oklch(0.92 0.005 260)` | All border colors |
| `--radius` | `0.75rem` | Base border radius |

Custom shadows:
- `shadow-card`: subtle two-layer drop shadow for cards
- `shadow-lift`: larger hover lift shadow
- `shadow-drawer`: left-side shadow for Sheet/Drawer panels

### Shadcn UI

All UI primitives (Button, Dialog, Sheet, Select, Input, etc.) are from Shadcn UI, generated into `src/components/ui/`. They use Radix UI for accessibility primitives and CVA for variant handling.

The `cn()` utility in `src/lib/utils.ts` combines `clsx` and `tailwind-merge` to safely compose class strings.

---

## 11. Authentication & Security

### Current posture

- **No authentication**: the app uses the Supabase `anon` key only. There is no login, no session, no user concept.
- **Fully public data**: all RLS policies use `USING (true)` — any user with the URL can read and write all data.
- **No cross-tenant isolation**: single shared database with no `org_id` or `user_id` columns.
- **Append-only logs**: `activity_log` and `audit_log` have no UPDATE/DELETE RLS policies, making them tamper-resistant from the application layer.
- **Client-side uniqueness checks**: duplicate warehouse codes, bin labels, product SKUs are caught with a SELECT before INSERT. This is not atomic — concurrent inserts could theoretically both pass the check. In single-user demo conditions this is not an issue.
- **Non-atomic mutations**: `adjustInventory` and `transferStock` perform sequential Supabase calls without a DB transaction. A mid-flight failure can leave partial state. Documented in GAPS.md as out of scope for the current version.

### Supabase client initialization

```ts
// src/integrations/supabase/client.ts
// Lazy singleton via Proxy — safe to import at module top-level on client and server
export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
```

Environment variables are read from:
- Client (Vite): `import.meta.env.VITE_SUPABASE_URL`, `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`
- Server (SSR/Nitro): `process.env.SUPABASE_URL`, `process.env.SUPABASE_PUBLISHABLE_KEY`

---

## 12. Error Handling

| Layer | Mechanism |
|---|---|
| Route error boundary | `ErrorComponent` in `__root.tsx`. Catches unhandled throws from route `component`. Calls `reportLovableError()` then shows error message + "Try again". |
| Not-found | `throw notFound()` in `warehouses.$id.tsx` when warehouse UUID not found. Renders `NotFoundComponent`. |
| Mutation errors | `onError: (e: Error) => toast.error(e.message)` on all mutations. User-facing errors are thrown with descriptive messages from `wms.ts`. |
| Inline form errors | `EditDrawer` and `TransferDrawer` keep an `error: string | null` state, displayed as a red inline message. |
| Audit write failures | `writeAudit()` wraps the Supabase call in try/catch and logs to console but does not rethrow — audit failure is silent to the user and does not block the primary operation. |
| SSR server errors | `src/server.ts` catches and reports server-side errors via `lovable-error-reporting`. |

---

## 13. Running Locally

### Prerequisites

- **Bun** — `curl -fsSL https://bun.sh/install | bash`
- A **Supabase project** with both migrations applied

### Environment

Create `.env` at project root:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
```

### Commands

```bash
bun run dev       # dev server at http://localhost:5173 (HMR active)
bun run build     # production build (Nitro + Vite)
bun run preview   # preview production build locally
bun run lint      # ESLint
bun run format    # Prettier
```

### Applying migrations

```bash
supabase db push                    # if Supabase CLI is installed and project is linked
# OR apply manually in Supabase dashboard > SQL Editor
```

---

## 14. File Map (Quick Reference)

```
src/
├── components/
│   ├── AppHeader.tsx        — sticky top nav: logo + 4 nav links
│   ├── EmptyState.tsx       — reusable empty-state card with optional action
│   ├── FilterBar.tsx        — FilterBar, MultiSelect, ChipGroup, DatePresetPicker
│   └── ui/                  — Shadcn UI component library (do not edit directly)
│
├── integrations/supabase/
│   ├── client.ts            — anon-key client (lazy singleton Proxy)
│   ├── client.server.ts     — service-role client (SSR only, currently scaffold)
│   └── types.ts             — auto-generated Database type (Tables, Enums)
│
├── lib/
│   ├── wms.ts               — ALL data access: reads, mutations, audit helper
│   └── utils.ts             — cn() = clsx + tailwind-merge
│
├── routes/
│   ├── __root.tsx           — HTML shell, QC provider, AppHeader, Toaster, 404+error
│   ├── index.tsx            — GET /  (warehouses overview)
│   ├── warehouses.$id.tsx   — GET /warehouses/:id  (detail + bins + inventory)
│   ├── products.tsx         — GET /products  (product catalog CRUD)
│   ├── activity.tsx         — GET /activity  (inventory movement log)
│   └── audit.tsx            — GET /audit  (platform change log)
│
├── routeTree.gen.ts         — AUTO-GENERATED — do not edit
├── router.tsx               — createRouter(), injects QueryClient
├── server.ts                — Nitro entry with error wrapper
├── start.ts                 — client entry point
└── styles.css               — Tailwind v4 @theme + CSS custom properties

supabase/migrations/
├── 20260607135042_*.sql     — core schema (warehouses, bins, products, inventory, activity_log)
└── 20260607151940_*.sql     — audit_log table

ARCHITECTURE.md              — this file
FEATURES.md                  — user-facing feature reference
GAPS.md                      — known issues and improvement opportunities
```

---

## 15. Known Limitations

See **GAPS.md** for the full issue list. The two open architectural concerns are:

### Non-atomic mutations

`adjustInventory` and `transferStock` perform sequential Supabase REST calls. A failure mid-sequence leaves partial state (e.g., inventory decremented but no log entry written). The fix is Postgres functions called via `supabase.rpc()`, which would run inside a DB transaction. This requires a new migration and is out of scope for the current version.

### Activity/Audit pagination

Both feeds are hard-capped at 500 rows with no cursor-based pagination. Adding pagination requires changes to `fetchActivity()` / `fetchAuditLog()` to accept `limit`/`offset` or a cursor, plus pagination controls in the UI.
