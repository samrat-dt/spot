# Make Spot fully functional

Right now only the demo seeder can create bins, products, and first-time inventory rows. This plan adds the missing create / edit / archive flows so a manager can run the warehouse end-to-end without touching the database.

## 1. Bins management

Add a **Bins** section to the warehouse detail page (above Inventory, collapsible card):

- Shows every bin in the warehouse with its `bin_label` (Aisle-Rack-Shelf), how many distinct products it holds, and total units.
- **Add bin** button → dialog with three fields (Aisle, Rack, Shelf) and a live preview of the resulting `A-01-A` label. Validates uniqueness within the warehouse.
- Each bin row has **Rename** (edit aisle/rack/shelf) and **Archive** (soft delete via `is_deleted = true`, blocked if the bin still holds inventory with explanatory toast).

## 2. Products catalog

New top-level route **/products** added to the header nav:

- Table of all products: name, SKU, unit of measure, total units across all warehouses.
- **Add product** dialog: name, SKU (uppercased, uniqueness-checked), unit of measure (default "unit").
- Each row: **Edit** (name / unit) and **Archive** (soft delete, blocked if product still has non-zero inventory anywhere).

## 3. Add inventory (place product in bin)

On the warehouse detail page, add an **Add inventory** button next to the search field, and make the empty-state CTA wire to the same dialog:

- Product picker (searchable, only non-archived products, excludes products already in the chosen bin).
- Bin picker (only non-archived bins in this warehouse).
- Starting quantity (≥ 0) and reason (defaults to "Received stock").
- Creates the `inventory` row and writes a matching `activity_log` entry so history stays consistent.

## 4. Edit warehouse + archive warehouse

On the warehouse detail page header, add a small **Edit** menu:

- **Rename / change city / change code** dialog.
- **Archive warehouse** (soft delete) — blocked with explanation if any non-zero inventory remains. Redirects back to the warehouses list on success.

## 5. Transfer correctness fix

`transferStock` currently looks up the destination row by `(product_id, bin_id)`. If the destination bin holds a *different* product, behavior is correct, but if the user picks a bin that already holds the same product elsewhere we should still merge. The real issue is the destination bin dropdown — it shows all bins including ones that may hold other unrelated products. Two changes:

- Group destination bins in the dropdown into **"Already has this product"** and **"Empty / other"** so the user sees the consequence before confirming.
- Keep the existing merge behavior (correct) but add a confirmation line in the drawer: *"This bin already holds 12 units of this product — they will be combined."* when applicable.

## 6. Small UX glue

- Wire the inventory empty-state CTA to the new Add inventory dialog.
- After creating a bin or product, refresh the relevant queries so the new option appears immediately in pickers.
- All destructive actions (archive bin/product/warehouse) use a confirm dialog with the count of dependent records.

## Technical notes

- All new mutations live in `src/lib/wms.ts` alongside `adjustInventory` / `transferStock`. No schema changes — `is_deleted` already exists on warehouses, bins, products, inventory.
- New functions: `createBin`, `updateBin`, `archiveBin`, `listProducts`, `createProduct`, `updateProduct`, `archiveProduct`, `addInventory`, `updateWarehouse`, `archiveWarehouse`. Each one that touches stock writes an `activity_log` row where applicable (e.g. `addInventory` logs a `received_stock` entry).
- Uniqueness checks (bin label per warehouse, SKU global, warehouse code global) are done client-side before insert with a friendly toast; the DB allows duplicates today, so we rely on app-level checks. If you'd like hard DB constraints I can add a follow-up migration.
- New route file `src/routes/products.tsx`; header nav updated to include **Warehouses / Products / Activity**.
- Query keys: `["bins", warehouseId]`, `["products"]`, plus existing keys invalidated after each mutation so the dashboard counts stay in sync.

## Out of scope (matches original brief)

No authentication, no purchase orders, no forecasting, no barcode scanning, no roles. Soft delete only — no hard deletes.
