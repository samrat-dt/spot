# Spot WMS — Feature Reference

**As of:** `5ff488e` (2026-06-07) — all gaps 1–5 and 7–8 fixed.

---

## Feature Status Overview

| Feature | Status | Screen |
|---|---|---|
| Warehouse list with aggregate stats | ✅ Working | `/` |
| Add warehouse | ✅ Working | `/` |
| Edit warehouse (name, city, code) | ✅ Working | `/warehouses/$id` |
| Archive warehouse | ✅ Working | `/warehouses/$id` |
| Demo data seed | ✅ Working | `/` (empty state only) |
| Bin management (add, rename, archive) | ✅ Working | `/warehouses/$id` |
| Product catalog (add, edit, archive) | ✅ Working | `/products` |
| Add inventory to a bin | ✅ Working | `/warehouses/$id` |
| Adjust inventory (delta + reason + notes) | ✅ Working | `/warehouses/$id` |
| Stock transfer between warehouses + notes | ✅ Working | `/warehouses/$id` |
| Transfer toast with "View destination" nav | ✅ Working | `/warehouses/$id` |
| Low-stock warnings | ✅ Working | `/` and `/warehouses/$id` |
| Activity log with full filter bar | ✅ Working | `/activity` |
| Transfer pairs grouped visually | ✅ Working | `/activity` |
| Audit log (platform-level changes) | ✅ Working | `/audit` |
| AppHeader on 404 and error pages | ✅ Working | `__root.tsx` |
| Search product catalog | ✅ Working | `/products` |

---

## Warehouses

### Warehouse List (`/`)

The home screen shows every non-archived warehouse as a card. Each card displays:
- Warehouse name and city
- Total distinct products stored
- Total units in stock across all bins
- Low-stock badge if any product/bin combo has fewer than 10 units

**Add Warehouse** opens a dialog requiring:
- **Name** — human-readable label (e.g. "Delhi Warehouse")
- **City** — display city
- **Code** — short unique identifier, e.g. `DEL-01` (auto-uppercased, duplicate-checked client-side before insert)

The **Load demo data** button appears only when zero warehouses exist. It creates 3 warehouses, 5 products, 8 bins per warehouse, and seed inventory in one click.

### Warehouse Detail (`/warehouses/$id`)

Click any warehouse card to open its detail page. The page has two sections: **Bins** (top) and **Inventory** (bottom).

The header stat strip shows: total products, total units, total bin count.

The `MoreHorizontal` menu in the warehouse title gives:
- **Edit warehouse** — change name, city, or code. Code uniqueness checked before save.
- **Archive warehouse** — soft-deletes the warehouse. Blocked with error toast if any bin still holds non-zero inventory.

---

## Bins

Bins are the physical storage slots in a warehouse. Each bin has a structured address — **Aisle / Rack / Shelf** — and a generated label in the format `A-01-B`. Labels are unique per warehouse.

### Add a bin

Click **Add bin** in the Bins section header (or the empty-state CTA). Fill in:
- **Aisle** — e.g. `A`
- **Rack** — e.g. `01`
- **Shelf** — e.g. `B`

The resulting label (e.g. `A-01-B`) is previewed live. Duplicate addresses within the warehouse are caught before save.

### Rename a bin

Click the `⋯` menu on any bin card → **Rename**. Same fields as Add. Labels that would duplicate another bin in the same warehouse are rejected.

### Archive a bin

`⋯` menu → **Archive**. Blocked with an explanatory toast if the bin still holds inventory.

---

## Products

Products are the SKUs tracked across all warehouses. A product has a **name**, a globally unique **SKU code**, and a **unit of measure** (default: `unit`).

### Product catalog (`/products`)

Accessible from the top nav. Shows every non-archived product with:
- Name and SKU
- Unit of measure
- How many bins it's placed in
- Total units across all warehouses

**Search** filters by name or SKU in real time.

**Add Product** dialog: name, SKU (auto-uppercased, uniqueness-checked), unit of measure.

**Edit Product**: name and unit of measure only. SKU cannot be changed after creation.

**Archive Product**: blocked if the product still has units in stock across any warehouse.

---

## Inventory

Inventory is the intersection of a product, a bin, and a warehouse. A product can appear in multiple bins (and multiple warehouses). Each `(product, bin)` combination is unique — if you add or transfer more of the same product into a bin that already holds it, the quantities are merged.

### Add inventory to a bin

On any warehouse detail page, click **Add inventory** (button next to the search field, or the CTA in the empty state). The dialog asks for:
- **Product** — searchable picker showing all non-archived products
- **Bin** — picker showing all non-archived bins in this warehouse
- **Starting quantity** — must be ≥ 0
- **Reason** — defaults to "Received Stock" (also accepts Returned, Manual Correction)
- **Notes** — optional

The insert creates or merges an `inventory` row and writes an `activity_log` entry.

### Adjust inventory (Edit)

Click **Edit** on any inventory row. The drawer shows:
- Current quantity (large display)
- **Adjustment** — enter `+20` to add, `-5` to remove. Cannot reduce below 0.
- **Real-time preview** — shows the resulting quantity below the input; turns red if the result would go below 0 with a "(cannot go below 0)" warning.
- **Reason** — one of: Received Stock, Sold, Damaged, Returned, Manual Correction. Defaults to "Received Stock".
- **Notes** — optional free-text for team context

On submit, the inventory quantity is updated and an `activity_log` entry is written.

### Low-stock warnings

Any inventory row with fewer than 10 units (`LOW_STOCK_THRESHOLD`) is highlighted in amber with a warning icon. The warehouse card on the home screen shows a count of low-stock entries.

---

## Stock Transfers

Click **Transfer** on any inventory row to move units to another warehouse.

1. Select the **destination warehouse** (current warehouse is excluded)
2. Select the **destination bin** from that warehouse's bins
   - Bins already holding this product are shown first with their current quantity
   - If the selected bin already has the product, a "they'll be combined" hint appears
3. Enter the **quantity** to move (must be > 0 and ≤ units on hand)
4. Optionally add **notes**
5. Click **Confirm transfer**

On success:
- Source bin quantity decreases
- Destination bin quantity increases (or a new inventory row is created if the product isn't there yet)
- Two `activity_log` entries are created — one `transfer_out` (negative delta at source) and one `transfer_in` (positive delta at destination) — linked by a shared `reference_id` UUID
- A success toast appears with a **"View destination"** action that navigates directly to the destination warehouse

The transfer is blocked with a clear message if quantity is 0, exceeds available stock, or source and destination bins are the same.

---

## Activity Log (`/activity`)

Every inventory change across all warehouses appears here in chronological order, newest first. Columns:

| Column | Contents |
|---|---|
| Product | Product name |
| Warehouse | Where the change happened |
| Bin | Specific bin address |
| Change | Delta with sign (+/-) and color — green for additions, red for removals, blue for transfers |
| Reason | Human-readable reason code + directional partner annotation for transfers |
| Notes | Operator notes (if provided) |
| When | Exact timestamp |

### Transfer pairs

Transfer operations appear as two visually linked rows. The `transfer_out` row shows "→ Destination Warehouse" in the Reason column; the `transfer_in` row shows "← Source Warehouse". The second row of the pair uses a softer divider to visually connect them. If only one side of a pair passes the active filters, it falls back to a standalone row.

### Filters

All filters combine (AND logic):

| Filter | Matches |
|---|---|
| **Search** | `products.name`, `products.sku_code`, `warehouses.name`, `warehouses.code`, `bins.bin_label`, `notes` |
| **Warehouse** | Multi-select — any row from the selected warehouses |
| **Product** | Multi-select — any row for the selected products |
| **Reason** | Multi-select — any of the selected reason codes |
| **Direction chips** | Inbound (+) or Outbound (−) |
| **Date range** | Today / Last 7 days / Last 30 days / All time |

Active filters appear as removable pills. A result count ("Showing X of Y") appears when filters are active.

**Hard cap:** Displays at most 500 entries. No pagination.

---

## Audit Log (`/audit`)

Every platform-level change to warehouses, products, and bins appears here, newest first. This feed tracks structural changes — for inventory movements, see Activity.

Logged events:

| Entity | Actions |
|---|---|
| Warehouse | Created, edited (name/city/code), archived |
| Product | Created, edited (name/UOM), archived |
| Bin | Created, renamed (aisle/rack/shelf), archived |
| System | Seed demo data |

Table columns: Action badge, Entity (icon + name + type label), Details (field-by-field diff for edits; snapshot for create/archive), Warehouse (if applicable), When.

### Filters

| Filter | Matches |
|---|---|
| **Search** | `entity_name`, field values in `changes`, `warehouses.name` |
| **Entity type** | Warehouse / Product / Bin / System (multi-select) |
| **Action chips** | Created / Edited / Archived / Seeded (multi-select) |
| **Warehouse** | Scopes bin rows by their parent warehouse |
| **Date range** | Today / Last 7 days / Last 30 days / All time |

---

## Demo Data

The **Load demo data** button (visible only on an empty app) seeds realistic data in one click:

| Entity | Created |
|---|---|
| Warehouses | Delhi DEL-01, Mumbai MUM-01, Bangalore BLR-01 |
| Products | Wireless Mouse, USB-C Cable 2m, Mechanical Keyboard, 27" Monitor, Webcam HD |
| Bins per warehouse | 8 — aisles A/B × racks 01/02 × shelves A/B |
| Inventory | 5 rows per warehouse — quantities: Mouse 120, USB-C 48, Keyboard 7 (⚠ low), Monitor 5 (⚠ low), Webcam 230 |

The seeder aborts silently if any warehouse already exists. It cannot be re-run without clearing all warehouses.

---

## Navigation

The sticky `AppHeader` is present on every page, including 404 and error pages.

| Link | Route |
|---|---|
| Spot (logo) | `/` |
| Warehouses | `/` |
| Products | `/products` |
| Activity | `/activity` |
| Audit | `/audit` |
