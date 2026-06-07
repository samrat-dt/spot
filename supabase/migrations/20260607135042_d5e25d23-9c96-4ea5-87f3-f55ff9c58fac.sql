
-- Enum for adjustment reasons
CREATE TYPE public.adjustment_reason AS ENUM (
  'received_stock','sold','damaged','returned','manual_correction','transfer_in','transfer_out'
);

-- updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- warehouses
CREATE TABLE public.warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.warehouses TO anon, authenticated;
GRANT ALL ON public.warehouses TO service_role;
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access warehouses" ON public.warehouses FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_warehouses_updated BEFORE UPDATE ON public.warehouses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- bins
CREATE TABLE public.bins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  aisle TEXT NOT NULL,
  rack TEXT NOT NULL,
  shelf TEXT NOT NULL,
  bin_label TEXT GENERATED ALWAYS AS (aisle || '-' || rack || '-' || shelf) STORED,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, aisle, rack, shelf)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bins TO anon, authenticated;
GRANT ALL ON public.bins TO service_role;
ALTER TABLE public.bins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access bins" ON public.bins FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_bins_updated BEFORE UPDATE ON public.bins FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- products
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku_code TEXT NOT NULL UNIQUE,
  unit_of_measure TEXT NOT NULL DEFAULT 'unit',
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO anon, authenticated;
GRANT ALL ON public.products TO service_role;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access products" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- inventory
CREATE TABLE public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  bin_id UUID NOT NULL REFERENCES public.bins(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0,
  is_deleted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, bin_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory TO anon, authenticated;
GRANT ALL ON public.inventory TO service_role;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public access inventory" ON public.inventory FOR ALL USING (true) WITH CHECK (true);
CREATE TRIGGER trg_inventory_updated BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- activity_log (append only)
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES public.warehouses(id) ON DELETE CASCADE,
  bin_id UUID NOT NULL REFERENCES public.bins(id) ON DELETE CASCADE,
  quantity_delta INTEGER NOT NULL,
  reason public.adjustment_reason NOT NULL,
  notes TEXT,
  reference_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.activity_log TO anon, authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read activity log" ON public.activity_log FOR SELECT USING (true);
CREATE POLICY "Append activity log" ON public.activity_log FOR INSERT WITH CHECK (true);

CREATE INDEX idx_inventory_warehouse ON public.inventory(warehouse_id);
CREATE INDEX idx_bins_warehouse ON public.bins(warehouse_id);
CREATE INDEX idx_activity_created ON public.activity_log(created_at DESC);
