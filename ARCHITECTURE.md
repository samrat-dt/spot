# Spot WMS — Architecture

## 1. App Overview

Spot is a lightweight **Warehouse Management System (WMS)** built as a single-tenant web app. It models the core daily operations of a multi-warehouse operation:

- Track physical **warehouses** (buildings) and their **bins** (storage slots, addressed by aisle / rack / shelf).
- Record **inventory** — how many units of each **product** sit in each bin of each warehouse.
- Perform **inventory adjustments** (receiving stock, sales, damage, returns, corrections) with a mandatory reason code.
- **Transfer** stock between warehouses (or between bins in different warehouses), with both sides of the move recorded atomically in the activity log via a shared `reference_id`.
- Browse a **full audit trail** of every inventory change across all warehouses.

The app is entirely client-rendered against Supabase; there is no custom API server. All database access goes through the Supabase JS SDK and PostgreSQL Row Level Security policies.

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | TanStack Start (Vite + Nitro SSR shell) | ^1.167 |
| UI runtime | React | ^19.2 |
| Routing | TanStack Router (file-based) | ^1.168 |
| Server state / caching | TanStack React Query | ^5.83 |
| Database / BaaS | Supabase (PostgreSQL + PostgREST) | ^2.107 (JS SDK) |
| Component library | Shadcn UI (Radix UI primitives) | latest |
| Styling | Tailwind CSS | v4 (Vite plugin) |
| Icons | Lucide React | ^0.575 |
| Toast notifications | Sonner | ^2.0 |
| Date formatting | date-fns | ^4.1 |
| Build tool | Vite | ^7.3 |
| Runtime / package manager | Bun | (bunfig.toml present) |
| Language | TypeScript | ^5.8 |

**Key integration notes**

- The Vite config delegates almost everything to `@lovable.dev/vite-tanstack-config`, which wires up TanStack Start, React, Tailwind v4, path aliases (`@/`), and Nitro under the hood. Do not add those plugins manually.
- The Supabase client (`src/integrations/supabase/client.ts`) is a lazy singleton wrapped in a `Proxy` so it is safe to import at module load time on both client and server. Environment variables are read from `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (client) or `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` (SSR fallback).
- The router is created in `src/router.tsx`, injecting a shared `QueryClient` into route context so loader functions and components can share the same cache.

---

## 3. Directory Structure

```
spot-app/
├── src/
│   ├── components/
│   │   ├── AppHeader.tsx          # Sticky top nav: Spot logo + Warehouses / Products / Activity links
│   │   ├── EmptyState.tsx         # Reusable empty-state card (icon, title, description, optional action)
│   │   └── ui/                    # Shadcn UI generated components (Button, Dialog, Sheet, Select, …)
│   │
│   ├── hooks/
│   │   └── use-mobile.tsx         # Breakpoint hook (unused by WMS screens, generated scaffold)
│   │
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts          # Lazy singleton Supabase client (anon key, typed with Database)
│   │       ├── client.server.ts   # Server-side Supabase client (service role, SSR only)
│   │       ├── types.ts           # Auto-generated DB types (Tables, Enums, Relationships)
│   │       ├── auth-attacher.ts   # Attaches Supabase auth session to server requests
│   │       └── auth-middleware.ts # TanStack Start middleware: reads session cookie, sets context
│   │
│   ├── lib/
│   │   ├── wms.ts                 # ALL WMS data-access functions (see §5)
│   │   ├── utils.ts               # cn() helper (clsx + tailwind-merge)
│   │   ├── config.server.ts       # Server-only env config
│   │   ├── error-capture.ts       # Error capture utility
│   │   ├── error-page.ts          # Shared error page helpers
│   │   ├── lovable-error-reporting.ts  # Lovable platform error hook (used in root error boundary)
│   │   └── api/
│   │       └── example.functions.ts    # TanStack Start server function scaffold (unused)
│   │
│   ├── routes/
│   │   ├── __root.tsx             # Root route: HTML shell, QueryClientProvider, AppHeader, Toaster
│   │   ├── index.tsx              # Route "/" — Warehouses overview
│   │   ├── warehouses.$id.tsx     # Route "/warehouses/$id" — Warehouse detail + bins + inventory
│   │   ├── products.tsx           # Route "/products" — Product catalog CRUD
│   │   ├── activity.tsx           # Route "/activity" — Activity log
│   │   └── README.md              # TanStack Router file-routing conventions
│   │
│   ├── routeTree.gen.ts           # Auto-generated route tree (do not edit)
│   ├── router.tsx                 # createRouter() — injects QueryClient into context
│   ├── server.ts                  # Nitro/SSR server entry (error wrapper around TanStack Start handler)
│   ├── start.ts                   # Client entry point
│   └── styles.css                 # Global CSS + Tailwind v4 theme tokens
│
├── supabase/
│   ├── config.toml                # Supabase CLI project config
│   └── migrations/
│       └── 20260607135042_*.sql   # Single migration: all tables, enum, indexes, RLS policies
│
├── .lovable/
│   └── plan.md                    # Lovable implementation plan (reference — not built artifact)
├── vite.config.ts                 # Delegates to @lovable.dev/vite-tanstack-config
├── package.json
├── tsconfig.json
└── bunfig.toml
```

---

## 4. Data Model

### 4.1 Tables

#### `warehouses`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key, `gen_random_uuid()` |
| `name` | `TEXT NOT NULL` | Human-readable label, e.g. "Delhi Warehouse" |
| `city` | `TEXT NOT NULL` | City for display purposes |
| `code` | `TEXT NOT NULL UNIQUE` | Short identifier, e.g. "DEL-01" (uppercased on insert) |
| `is_deleted` | `BOOLEAN DEFAULT false` | Soft-delete flag |
| `created_at` | `TIMESTAMPTZ` | Set by DB default |
| `updated_at` | `TIMESTAMPTZ` | Maintained by `set_updated_at()` trigger |

#### `bins`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key |
| `warehouse_id` | `UUID FK → warehouses.id` | ON DELETE CASCADE |
| `aisle` | `TEXT NOT NULL` | e.g. "A" |
| `rack` | `TEXT NOT NULL` | e.g. "01" |
| `shelf` | `TEXT NOT NULL` | e.g. "B" |
| `bin_label` | `TEXT GENERATED ALWAYS AS (aisle \|\| '-' \|\| rack \|\| '-' \|\| shelf) STORED` | Derived display label, e.g. "A-01-B" |
| `is_deleted` | `BOOLEAN DEFAULT false` | Soft-delete flag |
| `created_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | Trigger-maintained |
| Unique | `(warehouse_id, aisle, rack, shelf)` | Prevents duplicate bin addresses per warehouse |

#### `products`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key |
| `name` | `TEXT NOT NULL` | e.g. "Wireless Mouse" |
| `sku_code` | `TEXT NOT NULL UNIQUE` | e.g. "SKU-MOUSE-01" |
| `unit_of_measure` | `TEXT DEFAULT 'unit'` | e.g. "unit", "kg" |
| `is_deleted` | `BOOLEAN DEFAULT false` | Soft-delete flag |
| `created_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | Trigger-maintained |

#### `inventory`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key |
| `product_id` | `UUID FK → products.id` | ON DELETE CASCADE |
| `bin_id` | `UUID FK → bins.id` | ON DELETE CASCADE |
| `warehouse_id` | `UUID FK → warehouses.id` | ON DELETE CASCADE (denormalized for fast warehouse-scoped queries) |
| `quantity` | `INTEGER DEFAULT 0` | Current on-hand count |
| `is_deleted` | `BOOLEAN DEFAULT false` | Soft-delete flag |
| `created_at` | `TIMESTAMPTZ` | |
| `updated_at` | `TIMESTAMPTZ` | Trigger-maintained |
| Unique | `(product_id, bin_id)` | A product can appear at most once per bin |

#### `activity_log`

| Column | Type | Notes |
|---|---|---|
| `id` | `UUID` | Primary key |
| `product_id` | `UUID FK → products.id` | ON DELETE CASCADE |
| `warehouse_id` | `UUID FK → warehouses.id` | ON DELETE CASCADE |
| `bin_id` | `UUID FK → bins.id` | ON DELETE CASCADE |
| `quantity_delta` | `INTEGER NOT NULL` | Positive = added, negative = removed |
| `reason` | `adjustment_reason ENUM NOT NULL` | See §4.2 |
| `notes` | `TEXT` | Optional free-text from the user |
| `reference_id` | `UUID` | Shared between the `transfer_out` and `transfer_in` pair of a single transfer operation |
| `created_at` | `TIMESTAMPTZ` | Immutable — no `updated_at`, no `is_deleted` |

The RLS policy on `activity_log` permits SELECT and INSERT for `anon` / `authenticated`, but not UPDATE or DELETE. The log is effectively append-only from the application layer.

### 4.2 `adjustment_reason` Enum

```sql
CREATE TYPE public.adjustment_reason AS ENUM (
  'received_stock',
  'sold',
  'damaged',
  'returned',
  'manual_correction',
  'transfer_in',
  'transfer_out'
);
```

`transfer_in` and `transfer_out` are written only by `transferStock()`, never surfaced in the Edit drawer's reason select. The remaining five values are available to `adjustInventory()`.

### 4.3 Relationships

```
warehouses 1──* bins         (warehouse_id FK)
warehouses 1──* inventory    (warehouse_id FK)
warehouses 1──* activity_log (warehouse_id FK)

products   1──* inventory    (product_id FK)
products   1──* activity_log (product_id FK)

bins       1──* inventory    (bin_id FK)
bins       1──* activity_log (bin_id FK)

inventory  represents: 1 product × 1 bin (unique constraint)
```

### 4.4 Database Indexes

| Index | Column(s) | Purpose |
|---|---|---|
| `idx_inventory_warehouse` | `inventory(warehouse_id)` | Fast warehouse-scoped inventory reads |
| `idx_bins_warehouse` | `bins(warehouse_id)` | Fast bin list for a warehouse |
| `idx_activity_created` | `activity_log(created_at DESC)` | Chronological activity feed |

### 4.5 Row Level Security

All tables have RLS enabled. All current policies grant full public access (`USING (true)`) — there is no per-user data isolation. The `activity_log` table restricts writes to INSERT only (no UPDATE/DELETE via RLS).

---

## 5. Client Data Layer

All data access is centralized in **`src/lib/wms.ts`**. The file exports typed async functions that are called directly from React Query `queryFn` / `mutationFn` callbacks. There is no intermediary API route.

### 5.1 Constants and Types

| Export | Value / Type |
|---|---|
| `LOW_STOCK_THRESHOLD` | `10` — units below this trigger the warning highlight and low-stock badge |
| `Reason` | Union type of all seven `adjustment_reason` enum values |
| `REASON_LABELS` | `Record<Reason, string>` mapping enum values to human-readable labels |

### 5.2 Read Functions

| Function | Query | Returns |
|---|---|---|
| `fetchWarehouseSummaries()` | All non-deleted warehouses + all non-deleted inventory (full table). Aggregates client-side: distinct product count, total units, low-stock row count per warehouse. | `Array<Warehouse & { totalProducts, totalUnits, lowStock }>` |
| `fetchWarehouseDetail(warehouseId)` | One warehouse + all non-deleted inventory rows, joining `bins(id, bin_label)` and `products(id, name, sku_code)`. | `{ warehouse, rows[] }` |
| `fetchBinsForWarehouse(warehouseId)` | All non-deleted bins for a warehouse. Enriches each bin with `productCount` and `totalUnits` aggregated from the inventory table client-side. | `BinSummary[]` |
| `fetchActivity()` | 500 most recent `activity_log` rows (ORDER BY `created_at DESC LIMIT 500`), joining product, warehouse, bin. | `ActivityRow[]` |
| `fetchProducts()` | All non-deleted products, enriched with `binCount` and `totalUnits` aggregated from inventory. | `ProductSummary[]` |
| `listWarehouses()` | All non-deleted warehouses ordered by name. Used by TransferDrawer. | `Warehouse[]` |
| `listBins(warehouseId)` | All non-deleted bins for a warehouse, ordered by `bin_label`. Used by TransferDrawer bin select. | `Bin[]` |
| `listProducts()` | All non-deleted products ordered by name. Used by AddInventoryDrawer product picker. | `Product[]` |

### 5.3 Write Functions

#### Warehouse functions

| Function | What it does |
|---|---|
| `createWarehouse(input)` | Inserts a warehouse. Client-side duplicate code check (`SELECT` before `INSERT`) with a friendly error message. Code is uppercased. |
| `updateWarehouse(id, input)` | Updates name, city, code. Client-side duplicate check on code (excludes self). Writes `updated_at`. |
| `archiveWarehouse(id)` | Checks that total non-zero inventory for the warehouse is 0. If inventory remains, throws a descriptive error listing remaining unit count. Otherwise sets `is_deleted = true` on the warehouse. |

#### Bin functions

| Function | What it does |
|---|---|
| `createBin(input)` | Inserts a bin with `aisle`, `rack`, `shelf`. Duplicate address checked client-side per warehouse. `bin_label` is generated by Postgres. |
| `updateBin(id, input)` | Updates `aisle`, `rack`, `shelf`. Duplicate address check excludes the bin being edited. |
| `archiveBin(id)` | Checks that total units in the bin is 0. Throws if inventory remains. Sets `is_deleted = true`. |

#### Product functions

| Function | What it does |
|---|---|
| `createProduct(input)` | Inserts a product with `name`, `sku_code`, `unit_of_measure`. Client-side SKU uniqueness check. SKU is uppercased. |
| `updateProduct(id, input)` | Updates `name` and `unit_of_measure`. SKU cannot be changed after creation. |
| `archiveProduct(id)` | Checks total units across all inventory rows. Throws if any remain. Sets `is_deleted = true`. |

#### Inventory functions

| Function | What it does |
|---|---|
| `addInventory(args)` | Adds a product to a bin for the first time in a warehouse. Checks for duplicate (product+bin already exists). Inserts an `inventory` row then writes a `received_stock` (or caller-supplied reason) `activity_log` entry. |
| `adjustInventory(args)` | Adjusts an existing inventory row by `delta`. Validates `next >= 0`. Updates `inventory.quantity`, inserts `activity_log`. **Note:** two sequential writes, not atomic. |
| `transferStock(args)` | Moves `quantity` units source → destination. Validates non-zero qty, within-source-stock, different bins. Decrements source, upserts destination, inserts a paired `transfer_out`/`transfer_in` log using a shared `referenceId`. **Note:** four sequential writes, not atomic. |

#### `seedDemoData()`

One-shot demo seeder. Aborts if any non-deleted warehouse exists. Creates:
- 3 warehouses (Delhi DEL-01, Mumbai MUM-01, Bangalore BLR-01)
- 5 products (Wireless Mouse, USB-C Cable 2m, Mechanical Keyboard, 27" Monitor, Webcam HD)
- 8 bins per warehouse (aisles A/B × racks 01/02 × shelves A/B)
- 5 inventory rows per warehouse (hardcoded quantities `[120, 48, 7, 5, 230]`)

---

## 6. Routing

TanStack Router uses file-based routing. The route tree is auto-generated in `src/routeTree.gen.ts` from the files under `src/routes/`.

### Route Layout

```
__root.tsx           ← HTML shell (RootShell), QueryClientProvider, AppHeader, Toaster
  index.tsx          → /
  warehouses.$id.tsx → /warehouses/:id
  products.tsx       → /products
  activity.tsx       → /activity
  [notFound]         → /* (no AppHeader — rendered outside RootComponent)
  [errorBoundary]    → /* (no AppHeader — rendered outside RootComponent)
```

### Route Details

#### `GET /` — Warehouses Overview (`src/routes/index.tsx`)

| Aspect | Detail |
|---|---|
| Query | `useQuery(['warehouses-summary'], fetchWarehouseSummaries)` |
| Mutations | `createWarehouse`, `seedDemoData` — both invalidate `warehouses-summary` |
| Primary UI | Responsive card grid — one `WarehouseCard` per warehouse |
| Loading state | 3 skeleton pulse cards |
| Empty state | "Load demo data" button (hidden once any warehouse exists) + "Add Warehouse" dialog trigger |
| Modals | `AddWarehouseDialog` (name, city, code; submit disabled until all three filled) |

#### `GET /warehouses/$id` — Warehouse Detail (`src/routes/warehouses.$id.tsx`)

| Aspect | Detail |
|---|---|
| Params | `id` — warehouse UUID |
| Queries | `warehouse-detail` (inventory rows), `bins-summary` (bin list with counts) |
| Not-found | `!data?.warehouse` after load → `notFound()` |
| Header actions | `MoreHorizontal` dropdown → "Edit warehouse" dialog + "Archive warehouse" confirm dialog |
| **Bins section** | Card above inventory: lists all bins with product/unit counts. "Add bin" button → dialog (aisle, rack, shelf, live label preview). Each bin has a `DropdownMenu` with Edit and Archive. Archive blocked if bin has inventory. |
| **Inventory section** | Table: product, SKU, bin, units (animated), last updated, Edit + Transfer. Search filters by name/SKU. |
| **Add inventory** | Button next to search (and in empty state CTA) → `AddInventoryDrawer`: product picker (excludes already-placed in that bin), bin picker (this warehouse's bins), starting quantity, reason. |
| Low-stock | Rows with `quantity < 10` get warning color and `AlertTriangle` icon |
| EditDrawer | Adjustment delta + reason (5 codes) + optional notes |
| TransferDrawer | Dest warehouse → dest bin (loaded on warehouse selection) → quantity |
| Animated counter | `AnimatedCount` interpolates over 14 steps at 18 ms on value change |

#### `GET /products` — Product Catalog (`src/routes/products.tsx`)

| Aspect | Detail |
|---|---|
| Query | `useQuery(['products-summary'], fetchProducts)` |
| Primary UI | Table: name, SKU, unit of measure, bins (count), total units, Edit + Archive |
| Search | Filters by name or SKU (in-memory) |
| Add | `AddProductDialog`: name, SKU, unit of measure. SKU uniqueness checked before insert. |
| Edit | `EditProductDialog`: name and unit of measure only. SKU immutable after creation. |
| Archive | `ArchiveProductDialog`: blocked with count if product still has units in stock. |

#### `GET /activity` — Activity Log (`src/routes/activity.tsx`)

| Aspect | Detail |
|---|---|
| Query | `useQuery(['activity'], fetchActivity)` |
| Primary UI | Table: product, warehouse, bin, change badge, reason, notes, timestamp |
| Client filter | Search by `products.name` only (case-insensitive) |
| Transfer rows | `reason = transfer_in / transfer_out` → `bg-primary-soft/30` row + blue badge |
| Change badge | Green for positive delta, red for negative, blue for transfers |
| Hard cap | 500 rows — no pagination |

#### `/*` — 404 Not Found

Minimal centered card with "404" heading and a "Back to warehouses" link. Rendered outside the `RootComponent` tree, so `AppHeader` and `QueryClientProvider` are not present.

#### `/*` — Error Boundary

Renders the caught `error.message` with a "Try again" button that calls `router.invalidate()` then `reset()`. Also rendered outside the `RootComponent` tree — no `AppHeader`.

### React Query Cache Keys

| Key | Populated by | Invalidated by |
|---|---|---|
| `['warehouses-summary']` | `fetchWarehouseSummaries` | `createWarehouse`, `updateWarehouse`, `archiveWarehouse`, `seedDemoData`, `adjustInventory`, `transferStock`, `addInventory`, `archiveProduct` |
| `['warehouse-detail', id]` | `fetchWarehouseDetail(id)` | `adjustInventory`, `transferStock`, `addInventory`, `updateProduct` |
| `['bins-summary', id]` | `fetchBinsForWarehouse(id)` | `createBin`, `updateBin`, `archiveBin` |
| `['products-summary']` | `fetchProducts` | `createProduct`, `updateProduct`, `archiveProduct` |
| `['products-list']` | `listProducts` | `createProduct`, `updateProduct`, `archiveProduct` |
| `['activity']` | `fetchActivity` | `adjustInventory`, `transferStock`, `addInventory` |
| `['wh-list']` | `listWarehouses` | Not explicitly invalidated |
| `['bins', warehouseId]` | `listBins(warehouseId)` | Not explicitly invalidated (TransferDrawer stale risk) |

---

## 7. Key Design Decisions

### Why TanStack Start?

TanStack Start provides an SSR-capable meta-framework built on top of Vite and TanStack Router. It gives server-rendered HTML on first load (good for SEO and time-to-first-paint) while keeping the developer experience of a Vite SPA for subsequent navigation. The file-based router eliminates manual route registration boilerplate.

### Why Supabase?

Supabase provides a managed PostgreSQL database, auto-generated REST API (PostgREST), realtime subscriptions, and an auth layer — all accessible from the browser via the typed JS SDK. For a single-tenant WMS prototype this eliminates the need for a custom API server while still offering a real relational database with foreign keys, constraints, and indexes. The typed `Database` interface generated from the schema means all queries are type-safe in TypeScript.

### Why `bin_label` is a generated column

Bin addresses are always the deterministic concatenation of `aisle || '-' || rack || '-' || shelf`. Storing this as a `GENERATED ALWAYS AS ... STORED` column means:

- The label is computed once at write time by Postgres, not repeatedly by application code.
- Application code can never write a `bin_label` that is inconsistent with the underlying address components.
- Queries can `SELECT bin_label` directly without string manipulation in the application layer.
- The unique constraint on `(warehouse_id, aisle, rack, shelf)` implicitly enforces label uniqueness per warehouse.

### Why `LOW_STOCK_THRESHOLD = 10`

The threshold is a module-level constant in `wms.ts` (not stored in the database) because:

- The current product has a single threshold applied uniformly across all warehouses and products.
- There is no admin UI to configure per-warehouse or per-product thresholds.
- Keeping it in code makes it easy to find and change in a single place; changing it requires a code edit and redeploy.

Future work: move to a per-warehouse or per-product config stored in the database if per-SKU reorder points are needed.

---

## 8. Running Locally

### Prerequisites

- **Bun** — install from [bun.sh](https://bun.sh)
- A **Supabase project** with the migration applied (`supabase/migrations/20260607135042_*.sql`)

### Environment variables

Create a `.env.local` file at the project root:

```
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
```

### Start the dev server

```bash
bun run dev
```

The app starts at `http://localhost:5173` by default (Vite). Hot module replacement is active for all route and component changes.

### Other scripts

| Script | Purpose |
|---|---|
| `bun run build` | Production build (Nitro + Vite) |
| `bun run build:dev` | Development-mode production build |
| `bun run preview` | Preview the production build locally |
| `bun run lint` | ESLint across the entire `src/` tree |
| `bun run format` | Prettier formatting |

### Database migrations

If you have the Supabase CLI installed and a linked project:

```bash
supabase db push
```

Or apply the migration manually in the Supabase dashboard SQL editor.
