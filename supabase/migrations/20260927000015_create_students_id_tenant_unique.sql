-- ==============================================================================
-- Migration: 20260927000015_create_students_id_tenant_unique.sql
-- Descrição: Adiciona constraint UNIQUE (id, tenant_id) em public.students para
--            permitir FKs compostas indissociáveis a partir de import_rows.
-- ==============================================================================

ALTER TABLE public.students 
ADD CONSTRAINT uq_students_id_tenant UNIQUE (id, tenant_id);
