# Audit Log + Strong Filters on Activity & Audit

Two clean feeds, each with powerful filtering so a user can pinpoint exactly what they're looking for.

- **Activity** = inventory movement (units in/out, transfers, corrections). Unchanged data model.
- **Audit** = every platform-level actionable change a user makes (catalog/structure edits). New feed.

## What Audit logs

Every state-changing action in the app. Read-only views and navigation are NOT logged.

| Entity | Actions logged |
| --- | --- |
| Warehouse | created, edited (name / city / code), archived |
| Bin | created, edited (aisle / rack / shelf → label), archived |
| Product | created, edited (name / unit of measure), archived |
| Seed demo data | one row marking the seed event |

Inventory unit changes (adjust, transfer, add inventory) stay in **Activity** to avoid duplication — but every audit row links to the entity so the user can pivot.

For edits, we record a per-field diff: `{ field: { before, after } }`. For create/archive, we snapshot the entity.

## Audit page (`/audit`)

Mirrors Activity's layout for familiarity. Header explains: "Every change to your warehouses, products, and bins."

**Filter bar (sticky, all combine):**
- **Search** — free text over entity name, code/SKU, and notes/diff values.
- **Entity type** — multi-select chips: Warehouse · Product · Bin.
- **Action** — multi-select chips: Created · Edited · Archived.
- **Warehouse scope** — dropdown of warehouses (applies to warehouse rows and any bin under it).
- **Date range** — presets (Today, Last 7 days, Last 30 days, All time) + custom range.
- **Active-filter pills** under the bar with one-click remove, and a **Clear all** button.
- Result count: "Showing 23 of 184 changes".

**Table columns:**
What changed · Entity (name + type badge) · Details (human-readable diff, e.g. `name: "Delhi Warehouse" → "Delhi Hub"`) · Warehouse · When.
Color-coded action badge: created (green) · edited (blue) · archived (red).
Empty state matches Activity's tone.

## Activity page — upgraded filters

Same filter UX language as Audit so users learn it once.

**Filter bar:**
- **Search** — free text over product name, SKU, bin label, notes.
- **Warehouse** — multi-select.
- **Product** — multi-select (searchable dropdown).
- **Bin** — multi-select, auto-scoped to selected warehouses.
- **Reason** — multi-select chips: Received · Sold · Damaged · Returned · Manual Correction · Transfer In · Transfer Out.
- **Direction** — All · Inbound (+) · Outbound (−).
- **Date range** — same presets + custom as Audit.
- Active-filter pills, Clear all, result count.

Existing table columns stay; transfers keep the paired highlight.

## Shared filter component

A single `<FilterBar />` component used by both pages so behavior is identical: same chip styling, same date presets, same pill removal, same "Clear all", same empty-state copy when filters yield zero results ("No results. Try removing a filter.").

Filter state lives in URL search params (via TanStack Router `validateSearch` + Zod), so filtered views are bookmarkable and back/forward works naturally.

## Technical details

**New table `audit_log`** (append-only, mirrors `activity_log`'s posture):

```
id uuid pk default gen_random_uuid()
entity_type text         -- 'warehouse' | 'product' | 'bin' | 'system'
entity_id uuid nullable  -- nullable for 'system' events like seed
entity_name text         -- denormalized snapshot
action text              -- 'created' | 'updated' | 'archived' | 'seeded'
changes jsonb            -- diff for updates, snapshot for create/archive
warehouse_id uuid nullable -- context for bins
created_at timestamptz default now()
```

Public RLS policies matching the existing tables (no auth in scope). Insert + select only; no update/delete grants.

**`src/lib/wms.ts`** — small `writeAudit(...)` helper. Extend every mutation:
- `createWarehouse` / `updateWarehouse` (fetch current → diff) / `archiveWarehouse`
- `createProduct` / `updateProduct` (diff) / `archiveProduct`
- `createBin` / `updateBin` (diff label parts) / `archiveBin`
- `seedDemoData` (one `seeded` row)

Audit insert happens after the primary write succeeds; failure to audit logs to console but does not roll back the user's action.

Add `fetchAuditLog(filters)` reader (newest first, limit 500, server-side filters for entity_type/action/warehouse/date, client-side text search for snappiness — same approach as Activity today).

**Routes:**
- New `src/routes/audit.tsx` with `validateSearch` for filter state.
- Update `src/routes/activity.tsx` with the same filter pattern + new `<FilterBar />`.

**Navigation:** add **Audit** link to `AppHeader.tsx`, ordered Warehouses · Products · Activity · Audit.

## Out of scope

- User attribution (no auth in this app).
- Logging reads / page navigations.
- Editing or deleting audit/activity rows (append-only by design).
