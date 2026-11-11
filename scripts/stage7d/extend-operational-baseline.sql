-- Extensao exclusivamente sintetica do baseline da Etapa 7C.
-- Reproduz apenas as colunas e indices necessarios para homologar a RPC 74.

CREATE TABLE public.student_categories (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    UNIQUE (tenant_id, code)
);

ALTER TABLE public.meal_consumptions
    ADD COLUMN institution_id UUID REFERENCES public.institutions(id),
    ADD COLUMN category_id UUID REFERENCES public.student_categories(id),
    ADD COLUMN consumption_date DATE,
    ADD COLUMN consumed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN status TEXT NOT NULL DEFAULT 'approved',
    ADD CONSTRAINT chk_stage7d_consumption_status
        CHECK (status IN ('approved', 'financially_refunded', 'cancelled_unserved'));

CREATE INDEX idx_meal_consumptions_unit_date
    ON public.meal_consumptions(unit_id, consumption_date);

CREATE INDEX idx_meal_consumptions_tenant_created
    ON public.meal_consumptions(tenant_id, consumed_at DESC);

ALTER TABLE public.meal_consumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meal_consumptions FORCE ROW LEVEL SECURITY;

