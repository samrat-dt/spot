
CREATE TABLE public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  entity_name TEXT NOT NULL,
  action TEXT NOT NULL,
  changes JSONB NOT NULL DEFAULT '{}'::jsonb,
  warehouse_id UUID,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_at_idx ON public.audit_log (created_at DESC);
CREATE INDEX audit_log_entity_type_idx ON public.audit_log (entity_type);
CREATE INDEX audit_log_warehouse_id_idx ON public.audit_log (warehouse_id);

GRANT SELECT, INSERT ON public.audit_log TO anon, authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read audit log" ON public.audit_log FOR SELECT USING (true);
CREATE POLICY "Append audit log" ON public.audit_log FOR INSERT WITH CHECK (true);
