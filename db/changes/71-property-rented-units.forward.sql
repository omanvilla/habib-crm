-- SQL71 (6 Nov 2026, owner's decision): an optional note on a property about what is rented and for how much, as a reference
-- for follow-ups and the reply agent. The form reads it directly, so the view and the column list stay as they are.
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS rented_units text;
GRANT SELECT (rented_units) ON public.properties TO authenticated;
