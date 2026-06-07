# Spot WMS — Gaps, Bugs, and Improvement Opportunities

**App:** Spot (Warehouse Management System)
**Stack:** TanStack Start + React + Supabase + Shadcn/ui
**Last reviewed:** 2026-06-07 (updated after `a92020f — Fixed warehouse inventory gaps`)

---

## Status Key

| Tag | Meaning |
|---|---|
| ✅ FIXED | Resolved in the `a92020f` push |
| 🔴 OPEN | Still present |
| 🟡 PARTIAL | Improved but not fully resolved |

---

## 1. CRITICAL GAPS

### ~~CG-1: No "Add inventory" action on warehouse detail~~ ✅ FIXED

**Resolution:** `addInventory()` added to `wms.ts`. `AddInventoryDrawer` added to `warehouses.$id.tsx` — product picker (excludes already-placed products for that bin), bin picker (this warehouse only), starting quantity, reason. Both the empty-state CTA and a persistent button next to the inventory search field open it.

---

### ~~CG-2: No product management screen~~ ✅ FIXED

**Resolution:** `/products` route added with full CRUD — `fetchProducts`, `createProduct`, `updateProduct`, `archiveProduct` in `wms.ts`. Products table shows name, SKU, unit, bin count, total units. Archive blocked if product has remaining stock. Nav updated to Warehouses / Products / Activity.

---

### ~~CG-3: No bin creation UI~~ ✅ FIXED

**Resolution:** Bins panel added to warehouse detail page. `fetchBinsForWarehouse`, `createBin`, `updateBin`, `archiveBin` added to `wms.ts`. Each bin shows product count and unit count. Add Bin dialog accepts aisle, rack, shelf and previews the resulting label. Archive blocked if bin has inventory.

---

### ~~FG-1: No warehouse edit or archive~~ ✅ FIXED

**Resolution:** `updateWarehouse` and `archiveWarehouse` added to `wms.ts`. Warehouse detail page header now has a `MoreHorizontal` dropdown with "Edit warehouse" (dialog) and "Archive warehouse" (confirm dialog, blocked if inventory remains). Redirect to `/` on successful archive.

---

### ~~FG-6: Duplicate warehouse code shows raw Postgres error~~ ✅ FIXED

**Resolution:** `createWarehouse` now does a client-side `SELECT` check before `INSERT` and throws a readable message: `"A warehouse with code X already exists."` Same pattern applied to `updateWarehouse` (excludes self from duplicate check). `createBin` also has a duplicate address check. `createProduct` checks SKU uniqueness before insert.

---

## 2. OPEN GAPS

### FG-3: Activity log has no filters, no pagination, and no export 🔴 OPEN

**Details:**
`fetchActivity()` is hard-capped at 500 rows with no cursor. The search input on `/activity` still filters by `products.name` only — warehouse name, bin label, and reason are visible in the table but unsearchable. No date range filter, no pagination controls, no CSV export.

**Quick fix (5 min):** Extend the filter predicate in `activity.tsx`:
```ts
data.filter(r =>
  (r.products?.name ?? "").toLowerCase().includes(q) ||
  (r.warehouses?.name ?? "").toLowerCase().includes(q) ||
  (r.bins?.bin_label ?? "").toLowerCase().includes(q) ||
  REASON_LABELS[r.reason as Reason]?.toLowerCase().includes(q)
)
```
Also update the placeholder from `"Search by product"` to `"Search by product, warehouse, or reason"`.

---

### FG-4: No notes field on the Transfer drawer 🔴 OPEN

**Details:**
`transferStock()` accepts an optional `notes` arg and writes it to both `activity_log` rows. The `TransferDrawer` component never passes `notes` — the field is absent from the form. Adjustments can be annotated; transfers cannot.

**Fix (15 min):** Add `const [notes, setNotes] = useState("")` and a `<Textarea>` to `TransferDrawer`. Pass `notes` to `transferStock()`.

---

### FG-5: adjustInventory and transferStock are not atomic 🔴 OPEN

**Details:**
Both functions perform sequential Supabase calls without a database transaction:
- `adjustInventory`: UPDATE inventory → INSERT activity_log. Mid-flight failure leaves inventory mutated with no log entry.
- `transferStock`: UPDATE source → SELECT+UPDATE/INSERT destination → INSERT two log rows. Up to four sequential writes; failure at any step leaves partial state.
- `adjustInventory` also reads `currentQuantity` at render time. Concurrent edits race: last write wins, silently discarding the other.

**Fix:** Postgres functions called via `supabase.rpc()`. The `quantity + p_delta` arithmetic in Postgres eliminates the stale-read race atomically. Requires a new migration.

**Interview note:** Silent in demo conditions with one user. Not worth explaining proactively.

---

### UX-1: Activity search scope is narrower than the visible columns 🔴 OPEN

**File:** `src/routes/activity.tsx`
**Issue:** Table shows 7 columns including Warehouse, Bin, Reason. Search only matches product name.
**Fix:** One-line predicate extension (see FG-3 quick fix above).

---

### UX-2: Edit drawer has no default reason and no "required" visual cue 🔴 OPEN

**File:** `src/routes/warehouses.$id.tsx` — `EditDrawer`
**Issue:** Reason select initializes to `""`. Submit without selecting a reason shows an inline error, but there is no asterisk or validation styling to pre-warn the user.
**Fix:** Either default `reason` state to `"received_stock"` or add a red asterisk to the Label and surface the error before submission.

---

### UX-3: No new-quantity preview in Edit drawer 🔴 OPEN

**File:** `src/routes/warehouses.$id.tsx` — `EditDrawer`
**Issue:** User types `-150` on a 120-unit item and only discovers the problem after clicking Submit.
**Fix:**
```tsx
{delta !== "" && !Number.isNaN(parseInt(delta)) && (
  <p className="text-xs text-muted-foreground">
    New quantity: <span className="font-semibold">{Math.max(0, (row?.quantity ?? 0) + parseInt(delta))}</span>
  </p>
)}
```

---

### ~~UX-5: 404 and error boundary pages lack AppHeader navigation~~ ✅ FIXED

**Resolution:** Both `NotFoundComponent` and `ErrorComponent` in `src/routes/__root.tsx` now render `<AppHeader />` at the top, with content centered via `py-24` below it.

---

### ~~P-2: Transfer success toast has no shortcut to destination warehouse~~ ✅ FIXED

**Resolution:** `TransferDrawer` in `src/routes/warehouses.$id.tsx` now captures `destWh` before async work and passes a `"View destination"` action to the success toast that navigates to the destination warehouse page.

---

### ~~P-3: Transfer pairs in Activity are visually unlinked~~ ✅ FIXED

**Resolution:** `src/routes/activity.tsx` now groups rows by `reference_id` into a `processedItems` memo. Complete pairs render as adjacent rows — the first (`transfer_out`) shows "→ [Destination]" inline, the second (`transfer_in`) shows "← [Source]" inline. The pair's second row uses a softer `border-primary/20` top border to visually connect it to the first.

---

## 3. OUT OF SCOPE (documented non-goals)

| Item | Rationale |
|---|---|
| Authentication / multi-user | Demo runs as anon. RLS policies are open (`USING (true)`). Auth is v2. |
| Real-time sync between tabs | No Supabase Realtime. Data refreshes on mutation only. |
| Mobile layout | Fixed max-width. Inventory table does not reflow on small screens. |
| Low-stock email / webhook alerts | Visual flagging only. `LOW_STOCK_THRESHOLD = 10` is a hardcoded constant — configurable per-product threshold is v2. |
| Barcode / QR scanning | Manual entry only. |
| Multi-tenancy | Single shared database. No `org_id` column. |
| Purchase orders / order lifecycle | No orders table. Reason codes cover receipt/sale events but no order flow. |
| Inventory reservations | No reserved/available split. Quantity is a single integer. |
| RBAC | All operations available to all users. |
| Bulk import (CSV) | No file upload. Seeding only via `seedDemoData()`. |
| Historical charts | `chart.tsx` exists but is unused. No time-series analytics. |

---

## Quick Reference: Remaining Open Issues

| Issue | File | Status |
|---|---|---|
| ~~Activity search narrow + placeholder misleading~~ | `src/routes/activity.tsx` | ✅ FIXED (remote) |
| ~~Transfer drawer missing notes field~~ | `src/routes/warehouses.$id.tsx` | ✅ FIXED |
| ~~Edit drawer no default reason / no preview~~ | `src/routes/warehouses.$id.tsx` | ✅ FIXED |
| ~~Transfer toast no "View destination" action~~ | `src/routes/warehouses.$id.tsx` | ✅ FIXED |
| ~~404/error page missing AppHeader~~ | `src/routes/__root.tsx` | ✅ FIXED |
| ~~Transfer pairs visually linked in Activity~~ | `src/routes/activity.tsx` | ✅ FIXED |
| Non-atomic adjustInventory / transferStock | `src/lib/wms.ts` | 🔴 OPEN (60–90 min, requires migration) |
| Activity pagination + export | `src/routes/activity.tsx` + `wms.ts` | 🔴 OPEN (2–3 hours) |
