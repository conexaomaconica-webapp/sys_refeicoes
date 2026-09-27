-- ==============================================================================
-- Migration: 20260927000005_create_user_role_enum.sql
-- Descrição: Declaração do tipo enumerado public.user_role contendo os 8 perfis
--            previstos na arquitetura (/docs/PERMISSIONS_v1_2.md).
-- ==============================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role' AND typnamespace = 'public'::regnamespace) THEN
        CREATE TYPE public.user_role AS ENUM (
            'admin_general',
            'operations_director',
            'finance',
            'supervisor',
            'unit_manager',
            'operator',
            'institution_user',
            'student'
        );
    END IF;
END $$;

COMMENT ON TYPE public.user_role IS 'Matriz de perfis de usuário do sistema conforme PERMISSIONS_v1_2.md.';
