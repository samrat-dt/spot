import { supabase } from "@/integrations/supabase/client";

export const LOW_STOCK_THRESHOLD = 10;

export type Reason =
  | "received_stock"
  | "sold"
  | "damaged"
  | "returned"
  | "manual_correction"
  | "transfer_in"
  | "transfer_out";

export const REASON_LABELS: Record<Reason, string> = {
  received_stock: "Received Stock",
  sold: "Sold",
  damaged: "Damaged",
  returned: "Returned",
  manual_correction: "Manual Correction",
  transfer_in: "Transfer In",
  transfer_out: "Transfer Out",
};

export async function fetchWarehouseSummaries() {
  const { data: warehouses, error: wErr } = await supabase
    .from("warehouses")
    .select("*")
    .eq("is_deleted", false)
    .order("created_at", { ascending: true });
  if (wErr) throw wErr;

  const { data: inv, error: iErr } = await supabase
    .from("inventory")
    .select("warehouse_id, product_id, quantity")
    .eq("is_deleted", false);
  if (iErr) throw iErr;

  return (warehouses ?? []).map((w) => {
    const rows = (inv ?? []).filter((r) => r.warehouse_id === w.id);
    const totalProducts = new Set(rows.map((r) => r.product_id)).size;
    const totalUnits = rows.reduce((s, r) => s + (r.quantity ?? 0), 0);
    const lowStock = rows.filter((r) => (r.quantity ?? 0) < LOW_STOCK_THRESHOLD).length;
    return { ...w, totalProducts, totalUnits, lowStock };
  });
}

export async function fetchWarehouseDetail(warehouseId: string) {
  const { data: warehouse, error: wErr } = await supabase
    .from("warehouses").select("*").eq("id", warehouseId).maybeSingle();
  if (wErr) throw wErr;

  const { data: rows, error } = await supabase
    .from("inventory")
    .select("id, quantity, updated_at, bin_id, product_id, bins(id, bin_label), products(id, name, sku_code)")
    .eq("warehouse_id", warehouseId)
    .eq("is_deleted", false);
  if (error) throw error;

  return { warehouse, rows: rows ?? [] };
}

export async function fetchActivity() {
  const { data, error } = await supabase
    .from("activity_log")
    .select("id, created_at, quantity_delta, reason, notes, reference_id, products(name, sku_code), warehouses(name, code), bins(bin_label)")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

export async function adjustInventory(args: {
  inventoryId: string;
  productId: string;
  warehouseId: string;
  binId: string;
  currentQuantity: number;
  delta: number;
  reason: Reason;
  notes?: string;
}) {
  const next = args.currentQuantity + args.delta;
  if (next < 0) throw new Error(`Cannot reduce below 0. Current stock is ${args.currentQuantity} units.`);

  const { error: uErr } = await supabase
    .from("inventory")
    .update({ quantity: next, updated_at: new Date().toISOString() })
    .eq("id", args.inventoryId);
  if (uErr) throw uErr;

  const { error: lErr } = await supabase.from("activity_log").insert({
    product_id: args.productId,
    warehouse_id: args.warehouseId,
    bin_id: args.binId,
    quantity_delta: args.delta,
    reason: args.reason,
    notes: args.notes || null,
  });
  if (lErr) throw lErr;
  return next;
}

export async function transferStock(args: {
  sourceInventoryId: string;
  productId: string;
  sourceWarehouseId: string;
  sourceBinId: string;
  sourceQuantity: number;
  destWarehouseId: string;
  destBinId: string;
  quantity: number;
  notes?: string;
}) {
  if (args.quantity <= 0) throw new Error("Quantity must be greater than 0.");
  if (args.quantity > args.sourceQuantity)
    throw new Error(`Cannot transfer more than current stock (${args.sourceQuantity}).`);
  if (args.sourceBinId === args.destBinId)
    throw new Error("Pick a different destination bin.");

  // decrement source
  const { error: srcErr } = await supabase
    .from("inventory")
    .update({ quantity: args.sourceQuantity - args.quantity, updated_at: new Date().toISOString() })
    .eq("id", args.sourceInventoryId);
  if (srcErr) throw srcErr;

  // upsert destination
  const { data: existing, error: exErr } = await supabase
    .from("inventory")
    .select("id, quantity")
    .eq("product_id", args.productId)
    .eq("bin_id", args.destBinId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (exErr) throw exErr;

  if (existing) {
    const { error: upErr } = await supabase
      .from("inventory")
      .update({ quantity: (existing.quantity ?? 0) + args.quantity, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (upErr) throw upErr;
  } else {
    const { error: insErr } = await supabase.from("inventory").insert({
      product_id: args.productId,
      bin_id: args.destBinId,
      warehouse_id: args.destWarehouseId,
      quantity: args.quantity,
    });
    if (insErr) throw insErr;
  }

  const referenceId = crypto.randomUUID();
  const { error: logErr } = await supabase.from("activity_log").insert([
    {
      product_id: args.productId,
      warehouse_id: args.sourceWarehouseId,
      bin_id: args.sourceBinId,
      quantity_delta: -args.quantity,
      reason: "transfer_out" as Reason,
      notes: args.notes || null,
      reference_id: referenceId,
    },
    {
      product_id: args.productId,
      warehouse_id: args.destWarehouseId,
      bin_id: args.destBinId,
      quantity_delta: args.quantity,
      reason: "transfer_in" as Reason,
      notes: args.notes || null,
      reference_id: referenceId,
    },
  ]);
  if (logErr) throw logErr;
}

export async function listWarehouses() {
  const { data, error } = await supabase
    .from("warehouses").select("*").eq("is_deleted", false).order("name");
  if (error) throw error;
  return data ?? [];
}

export async function listBins(warehouseId: string) {
  const { data, error } = await supabase
    .from("bins").select("*").eq("warehouse_id", warehouseId).eq("is_deleted", false).order("bin_label");
  if (error) throw error;
  return data ?? [];
}

// ---- Warehouses ----
export async function createWarehouse(input: { name: string; city: string; code: string }) {
  const code = input.code.trim().toUpperCase();
  const { data: dup } = await supabase
    .from("warehouses").select("id").eq("code", code).eq("is_deleted", false).maybeSingle();
  if (dup) throw new Error(`A warehouse with code "${code}" already exists.`);
  const { data, error } = await supabase
    .from("warehouses")
    .insert({ name: input.name.trim(), city: input.city.trim(), code })
    .select().single();
  if (error) throw error;
  return data;
}

export async function updateWarehouse(id: string, input: { name: string; city: string; code: string }) {
  const code = input.code.trim().toUpperCase();
  const { data: dup } = await supabase
    .from("warehouses").select("id").eq("code", code).eq("is_deleted", false).neq("id", id).maybeSingle();
  if (dup) throw new Error(`A warehouse with code "${code}" already exists.`);
  const { error } = await supabase
    .from("warehouses")
    .update({ name: input.name.trim(), city: input.city.trim(), code, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function archiveWarehouse(id: string) {
  const { data: rows, error: invErr } = await supabase
    .from("inventory").select("id, quantity")
    .eq("warehouse_id", id).eq("is_deleted", false);
  if (invErr) throw invErr;
  const remaining = (rows ?? []).reduce((s, r) => s + (r.quantity ?? 0), 0);
  if (remaining > 0)
    throw new Error(`Cannot archive: ${remaining.toLocaleString()} units still in stock. Transfer or remove them first.`);
  const { error } = await supabase
    .from("warehouses").update({ is_deleted: true, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// ---- Bins ----
export type BinSummary = {
  id: string;
  bin_label: string | null;
  aisle: string;
  rack: string;
  shelf: string;
  productCount: number;
  totalUnits: number;
};

export async function fetchBinsForWarehouse(warehouseId: string): Promise<BinSummary[]> {
  const { data: bins, error } = await supabase
    .from("bins").select("id, bin_label, aisle, rack, shelf")
    .eq("warehouse_id", warehouseId).eq("is_deleted", false).order("bin_label");
  if (error) throw error;
  const { data: inv } = await supabase
    .from("inventory").select("bin_id, quantity")
    .eq("warehouse_id", warehouseId).eq("is_deleted", false);
  return (bins ?? []).map((b) => {
    const rows = (inv ?? []).filter((r) => r.bin_id === b.id);
    return {
      ...b,
      productCount: rows.length,
      totalUnits: rows.reduce((s, r) => s + (r.quantity ?? 0), 0),
    };
  });
}

function binLabel(aisle: string, rack: string, shelf: string) {
  return `${aisle.trim().toUpperCase()}-${rack.trim().toUpperCase()}-${shelf.trim().toUpperCase()}`;
}

export async function createBin(input: { warehouseId: string; aisle: string; rack: string; shelf: string }) {
  const label = binLabel(input.aisle, input.rack, input.shelf);
  const { data: existing } = await supabase
    .from("bins").select("id").eq("warehouse_id", input.warehouseId)
    .eq("bin_label", label).eq("is_deleted", false).maybeSingle();
  if (existing) throw new Error(`Bin "${label}" already exists in this warehouse.`);
  const { data, error } = await supabase.from("bins").insert({
    warehouse_id: input.warehouseId,
    aisle: input.aisle.trim().toUpperCase(),
    rack: input.rack.trim().toUpperCase(),
    shelf: input.shelf.trim().toUpperCase(),
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateBin(id: string, input: { warehouseId: string; aisle: string; rack: string; shelf: string }) {
  const label = binLabel(input.aisle, input.rack, input.shelf);
  const { data: dup } = await supabase
    .from("bins").select("id").eq("warehouse_id", input.warehouseId)
    .eq("bin_label", label).eq("is_deleted", false).neq("id", id).maybeSingle();
  if (dup) throw new Error(`Bin "${label}" already exists in this warehouse.`);
  const { error } = await supabase.from("bins").update({
    aisle: input.aisle.trim().toUpperCase(),
    rack: input.rack.trim().toUpperCase(),
    shelf: input.shelf.trim().toUpperCase(),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

export async function archiveBin(id: string) {
  const { data: rows } = await supabase
    .from("inventory").select("id, quantity").eq("bin_id", id).eq("is_deleted", false);
  const units = (rows ?? []).reduce((s, r) => s + (r.quantity ?? 0), 0);
  if ((rows ?? []).length > 0 && units > 0)
    throw new Error(`Cannot archive: bin still holds ${units.toLocaleString()} units. Transfer or remove them first.`);
  // remove any zero-qty rows in this bin
  if ((rows ?? []).length > 0) {
    await supabase.from("inventory").update({ is_deleted: true }).eq("bin_id", id);
  }
  const { error } = await supabase.from("bins").update({ is_deleted: true, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// ---- Products ----
export type ProductSummary = {
  id: string;
  name: string;
  sku_code: string;
  unit_of_measure: string;
  totalUnits: number;
  binCount: number;
};

export async function fetchProducts(): Promise<ProductSummary[]> {
  const { data: products, error } = await supabase
    .from("products").select("id, name, sku_code, unit_of_measure")
    .eq("is_deleted", false).order("name");
  if (error) throw error;
  const { data: inv } = await supabase
    .from("inventory").select("product_id, bin_id, quantity").eq("is_deleted", false);
  return (products ?? []).map((p) => {
    const rows = (inv ?? []).filter((r) => r.product_id === p.id);
    return {
      ...p,
      totalUnits: rows.reduce((s, r) => s + (r.quantity ?? 0), 0),
      binCount: new Set(rows.map((r) => r.bin_id)).size,
    };
  });
}

export async function listProducts() {
  const { data, error } = await supabase
    .from("products").select("id, name, sku_code, unit_of_measure")
    .eq("is_deleted", false).order("name");
  if (error) throw error;
  return data ?? [];
}

export async function createProduct(input: { name: string; sku_code: string; unit_of_measure: string }) {
  const sku = input.sku_code.trim().toUpperCase();
  const { data: dup } = await supabase
    .from("products").select("id").eq("sku_code", sku).eq("is_deleted", false).maybeSingle();
  if (dup) throw new Error(`A product with SKU "${sku}" already exists.`);
  const { data, error } = await supabase.from("products").insert({
    name: input.name.trim(),
    sku_code: sku,
    unit_of_measure: input.unit_of_measure.trim() || "unit",
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateProduct(id: string, input: { name: string; unit_of_measure: string }) {
  const { error } = await supabase.from("products").update({
    name: input.name.trim(),
    unit_of_measure: input.unit_of_measure.trim() || "unit",
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
}

export async function archiveProduct(id: string) {
  const { data: rows } = await supabase
    .from("inventory").select("id, quantity").eq("product_id", id).eq("is_deleted", false);
  const units = (rows ?? []).reduce((s, r) => s + (r.quantity ?? 0), 0);
  if (units > 0)
    throw new Error(`Cannot archive: ${units.toLocaleString()} units still in stock across warehouses.`);
  if ((rows ?? []).length > 0) {
    await supabase.from("inventory").update({ is_deleted: true }).eq("product_id", id);
  }
  const { error } = await supabase.from("products").update({ is_deleted: true, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// ---- Add inventory (first placement) ----
export async function addInventory(args: {
  warehouseId: string;
  binId: string;
  productId: string;
  quantity: number;
  reason: Reason;
  notes?: string;
}) {
  if (args.quantity < 0) throw new Error("Quantity must be 0 or more.");

  // If row already exists for product+bin, top it up instead of duplicating
  const { data: existing, error: exErr } = await supabase
    .from("inventory").select("id, quantity")
    .eq("product_id", args.productId).eq("bin_id", args.binId).eq("is_deleted", false).maybeSingle();
  if (exErr) throw exErr;

  if (existing) {
    const next = (existing.quantity ?? 0) + args.quantity;
    const { error } = await supabase.from("inventory")
      .update({ quantity: next, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("inventory").insert({
      product_id: args.productId,
      bin_id: args.binId,
      warehouse_id: args.warehouseId,
      quantity: args.quantity,
    });
    if (error) throw error;
  }

  if (args.quantity > 0) {
    const { error: lErr } = await supabase.from("activity_log").insert({
      product_id: args.productId,
      warehouse_id: args.warehouseId,
      bin_id: args.binId,
      quantity_delta: args.quantity,
      reason: args.reason,
      notes: args.notes || null,
    });
    if (lErr) throw lErr;
  }
}

export async function seedDemoData() {
  const { count } = await supabase
    .from("warehouses").select("*", { count: "exact", head: true }).eq("is_deleted", false);
  if ((count ?? 0) > 0) return false;

  const warehouses = [
    { name: "Delhi Warehouse", city: "Delhi", code: "DEL-01" },
    { name: "Mumbai Warehouse", city: "Mumbai", code: "MUM-01" },
    { name: "Bangalore Warehouse", city: "Bangalore", code: "BLR-01" },
  ];
  const { data: ws, error: wErr } = await supabase.from("warehouses").insert(warehouses).select();
  if (wErr) throw wErr;

  const products = [
    { name: "Wireless Mouse", sku_code: "SKU-MOUSE-01", unit_of_measure: "unit" },
    { name: "USB-C Cable 2m", sku_code: "SKU-USBC-2M", unit_of_measure: "unit" },
    { name: "Mechanical Keyboard", sku_code: "SKU-KBD-MX", unit_of_measure: "unit" },
    { name: "27\" Monitor", sku_code: "SKU-MON-27", unit_of_measure: "unit" },
    { name: "Webcam HD", sku_code: "SKU-CAM-HD", unit_of_measure: "unit" },
  ];
  const { data: ps, error: pErr } = await supabase.from("products").insert(products).select();
  if (pErr) throw pErr;

  const binRows: { warehouse_id: string; aisle: string; rack: string; shelf: string }[] = [];
  for (const w of ws ?? []) {
    for (const aisle of ["A", "B"]) {
      for (const rack of ["01", "02"]) {
        for (const shelf of ["A", "B"]) {
          binRows.push({ warehouse_id: w.id, aisle, rack, shelf });
        }
      }
    }
  }
  const { data: bs, error: bErr } = await supabase.from("bins").insert(binRows).select();
  if (bErr) throw bErr;

  const invRows: { product_id: string; bin_id: string; warehouse_id: string; quantity: number }[] = [];
  for (const w of ws ?? []) {
    const wbins = (bs ?? []).filter((b) => b.warehouse_id === w.id);
    (ps ?? []).forEach((p, i) => {
      const bin = wbins[i % wbins.length];
      const qty = [120, 48, 7, 5, 230][i] ?? 25;
      invRows.push({ product_id: p.id, bin_id: bin.id, warehouse_id: w.id, quantity: qty });
    });
  }
  const { error: iErr } = await supabase.from("inventory").insert(invRows);
  if (iErr) throw iErr;
  return true;
}
