# Spot WMS — Feature Reference

**As of:** `a92020f — Fixed warehouse inventory gaps` (2026-06-07)

---

## Feature Status Overview

| Feature | Status | Screen |
|---|---|---|
| Warehouse list with aggregate stats | ✅ Working | `/` |
| Add warehouse | ✅ Working | `/` |
| Edit warehouse (name, city, code) | ✅ Working | `/warehouses/$id` |
| Archive warehouse | ✅ Working | `/warehouses/$id` |
| Demo data seed | ✅ Working | `/` (empty state only) |
| Bin management (add, edit, archive) | ✅ Working | `/warehouses/$id` |
| Product catalog (add, edit, archive) | ✅ Working | `/products` |
| Add inventory to a bin | ✅ Working | `/warehouses/$id` |
| Adjust inventory (delta + reason + notes) | ✅ Working | `/warehouses/$id` |
| Stock transfer between warehouses | ✅ Working | `/warehouses/$id` |
| Low-stock warnings | ✅ Working | `/` and `/warehouses/$id` |
| Activity log (audit trail) | ✅ Working | `/activity` |
| Search inventory | ✅ Working | `/warehouses/$id` |
| Search products | ✅ Working | `/products` |
| Search activity | 🟡 Product name only | `/activity` |

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
- **Code** — short unique identifier, e.g. `DEL-01` (auto-uppercased, duplicate-checked)

The **Load demo data** button appears only when zero warehouses exist. It creates 3 warehouses, 5 products, 8 bins per warehouse, and seed inventory in one click.

### Warehouse Detail (`/warehouses/$id`)

Click any warehouse card to open its detail page. The page has two sections:

**Bins** (top) and **Inventory** (bottom).

The header stat strip shows: total products, total units, total bin count for the warehouse.

The `MoreHorizontal` menu in the warehouse title gives:
- **Edit warehouse** — change name, city, or code. Code uniqueness is checked before save.
- **Archive warehouse** — soft-deletes the warehouse. Blocked (with error toast) if any bin still holds non-zero inventory.

---

## Bins

Bins are the physical storage slots in a warehouse. Each bin has a structured address — **Aisle / Rack / Shelf** — and a generated label in the format `A-01-B`. Labels are unique per warehouse.

### Add a bin

Click **Add bin** in the Bins section header (or the empty-state CTA). Fill in:
- **Aisle** — single letter, e.g. `A`
- **Rack** — two-digit number, e.g. `01`
- **Shelf** — single letter, e.g. `B`

The resulting label (e.g. `A-01-B`) is previewed live. Duplicate addresses within the warehouse are caught before save.

### Edit a bin

Click the `⋯` menu on any bin row → **Edit bin**. Same fields as Add. Labels that would duplicate another bin in the same warehouse are rejected.

### Archive a bin

`⋯` menu → **Archive bin**. Blocked with an explanatory toast if the bin still holds inventory. Archived bins disappear from pickers and the bins list.

---

## Products

Products are the SKUs tracked across all warehouses. A product has a **name**, a globally unique **SKU code**, and a **unit of measure** (default: `unit`).

### Product catalog (`/products`)

Accessible from the top nav. Shows every non-archived product with:
- Name and SKU
- Unit of measure
- How many bins it's placed in
- Total units across all warehouses

**Add Product** dialog: name, SKU (auto-uppercased, uniqueness-checked), unit of measure.

**Edit Product**: name and unit of measure only. SKU cannot be changed after creation — it may be used as an external reference.

**Archive Product**: blocked if the product still has units in stock across any warehouse. Archived products are hidden from pickers and the catalog table.

---

## Inventory

Inventory is the intersection of a product, a bin, and a warehouse. A product can appear in multiple bins (and multiple warehouses). Each `(product, bin)` combination is unique — if you transfer more of the same product into a bin that already holds it, the quantities are merged.

### Add inventory to a bin

On any warehouse detail page, click **Add inventory** (button next to the search field, or the CTA in the empty state). The drawer asks for:
- **Product** — searchable picker showing all non-archived products not already placed in the selected bin
- **Bin** — picker showing all non-archived bins in this warehouse
- **Starting quantity** — must be ≥ 0
- **Reason** — defaults to "Received Stock"

The insert creates an `inventory` row and writes a matching `activity_log` entry so the audit trail reflects the initial placement.

### Adjust inventory (Edit)

Click **Edit** on any inventory row. The drawer shows:
- Current quantity (large display)
- **Adjustment** — enter `+20` to add, `-5` to remove. Cannot reduce below 0.
- **Reason** — one of: Received Stock, Sold, Damaged, Returned, Manual Correction
- **Notes** — optional free-text for team context

On submit, the inventory quantity is updated and an `activity_log` entry is written.

### Low-stock warnings

Any inventory row with fewer than 10 units (`LOW_STOCK_THRESHOLD`) is highlighted in amber with a warning icon. The warehouse card on the home screen shows a count of low-stock entries (e.g. "3 low stock").

---

## Stock Transfers

Click **Transfer** on any inventory row to move units to another warehouse.

1. Select the **destination warehouse** (current warehouse is excluded from the list)
2. Select the **destination bin** from that warehouse's bins
3. Enter the **quantity** to move (must be > 0 and ≤ units on hand)
4. Click **Confirm transfer**

On success:
- Source bin quantity decreases
- Destination bin quantity increases (or a new inventory row is created if the product isn't there yet)
- Two `activity_log` entries are created — one `transfer_out` (negative delta at source) and one `transfer_in` (positive delta at destination) — linked by a shared `reference_id` UUID

The transfer is blocked with a clear message if:
- Quantity is 0 or exceeds available stock
- Source and destination bins are the same

---

## Activity Log (`/activity`)

Every inventory change across all warehouses appears here in chronological order, newest first. Columns:

| Column | Contents |
|---|---|
| Product | Product name |
| Warehouse | Where the change happened |
| Bin | Specific bin address |
| Change | Delta with sign (+/-) and color — green for additions, red for removals, blue for transfers |
| Reason | Human-readable reason code |
| Notes | Operator notes (if provided) |
| When | Exact timestamp |

Transfer pairs are visually highlighted with a blue row background.

**Search:** Filter by product name (case-insensitive). **Note:** warehouse name, bin, and reason are not yet searchable — see GAPS.md.

**Hard cap:** Displays at most 500 entries. No pagination currently.

---

## Demo Data

The **Load demo data** button (visible only on an empty app) seeds realistic data in one click:

| Entity | Created |
|---|---|
| Warehouses | Delhi DEL-01, Mumbai MUM-01, Bangalore BLR-01 |
| Products | Wireless Mouse, USB-C Cable 2m, Mechanical Keyboard, 27" Monitor, Webcam HD |
| Bins per warehouse | 8 — aisles A/B × racks 01/02 × shelves A/B |
| Inventory | 5 rows per warehouse — quantities: Mouse 120, USB-C 48, Keyboard 7 (⚠ low), Monitor 5 (⚠ low), Webcam 230 |

The seeder is a one-shot operation — it aborts silently if any warehouse already exists. Cannot be re-run from the UI without clearing warehouses.
