-- ==============================================================================
-- Migration: 20260927000011_create_students.sql
-- Descrição: Tabela principal de cadastro de alunos com as 3 FKs compostas por tenant
--            (institution, category, profile) e unicidade de matrícula por instituição.
-- ==============================================================================

CREATE TABLE public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    institution_id UUID NOT NULL,
    user_id UUID NULL,
    category_id UUID NOT NULL,
    registration_number TEXT NOT NULL,
    full_name TEXT NOT NULL,
    course TEXT,
    email TEXT,
    phone TEXT,
    photo_path TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraint Unicidade de Matrícula por Instituição de Ensino
    CONSTRAINT uq_students_inst_registration UNIQUE (institution_id, registration_number),
    
    -- Tríplice Proteção Multi-Tenant por FKs Compostas
    CONSTRAINT fk_students_inst_tenant 
        FOREIGN KEY (institution_id, tenant_id) REFERENCES public.institutions(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_students_category_tenant 
        FOREIGN KEY (category_id, tenant_id) REFERENCES public.student_categories(id, tenant_id) ON DELETE RESTRICT,
    CONSTRAINT fk_students_user_tenant 
        FOREIGN KEY (user_id, tenant_id) REFERENCES public.profiles(id, tenant_id) ON DELETE RESTRICT,
        
    CONSTRAINT chk_students_status CHECK (status IN ('active', 'inactive', 'suspended', 'cancelled', 'graduated'))
);

COMMENT ON TABLE public.students IS 'Cadastro acadêmico e operacional principal de alunos por instituição e tenant.';

CREATE INDEX idx_students_tenant_inst ON public.students(tenant_id, institution_id);
CREATE INDEX idx_students_lookup_reg ON public.students(institution_id, registration_number);
CREATE INDEX idx_students_user_id ON public.students(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX idx_students_status ON public.students(status);

CREATE TRIGGER trg_students_updated_at
BEFORE UPDATE ON public.students
FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
