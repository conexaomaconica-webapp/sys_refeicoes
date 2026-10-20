-- ==============================================================================
-- AUDITORIA COMPLETA DO BANCO REMOTO SUPABASE
-- ==============================================================================

-- 1. CONTAGEM REAL DE REGISTROS EM TODAS AS TABELAS PÚBLICAS
SELECT 'public.tenants' as table_name, count(*)::bigint as total_rows FROM public.tenants
UNION ALL SELECT 'public.tenant_branding', count(*) FROM public.tenant_branding
UNION ALL SELECT 'public.institutions', count(*) FROM public.institutions
UNION ALL SELECT 'public.units', count(*) FROM public.units
UNION ALL SELECT 'public.user_institution_access', count(*) FROM public.user_institution_access
UNION ALL SELECT 'public.user_unit_access', count(*) FROM public.user_unit_access
UNION ALL SELECT 'public.profiles', count(*) FROM public.profiles
UNION ALL SELECT 'public.student_categories', count(*) FROM public.student_categories
UNION ALL SELECT 'public.students', count(*) FROM public.students
UNION ALL SELECT 'public.imports', count(*) FROM public.imports
UNION ALL SELECT 'public.import_rows', count(*) FROM public.import_rows
UNION ALL SELECT 'public.meal_types', count(*) FROM public.meal_types
UNION ALL SELECT 'public.unit_meal_types', count(*) FROM public.unit_meal_types
UNION ALL SELECT 'public.meal_rules', count(*) FROM public.meal_rules
UNION ALL SELECT 'public.wallets', count(*) FROM public.wallets
UNION ALL SELECT 'public.wallet_transactions', count(*) FROM public.wallet_transactions
UNION ALL SELECT 'public.payment_providers', count(*) FROM public.payment_providers
UNION ALL SELECT 'public.payments', count(*) FROM public.payments
UNION ALL SELECT 'public.recharges', count(*) FROM public.recharges
UNION ALL SELECT 'public.payment_webhook_events', count(*) FROM public.payment_webhook_events
UNION ALL SELECT 'public.cards', count(*) FROM public.cards
UNION ALL SELECT 'public.qr_tokens', count(*) FROM public.qr_tokens
UNION ALL SELECT 'public.meal_consumptions', count(*) FROM public.meal_consumptions
UNION ALL SELECT 'public.blocked_attempts', count(*) FROM public.blocked_attempts;

-- 2. CONTAGEM EM SCHEMAS GERENCIADOS (AUTH E STORAGE)
SELECT 'auth.users' as managed_table, count(*)::bigint as total_rows FROM auth.users
UNION ALL SELECT 'storage.buckets', count(*) FROM storage.buckets
UNION ALL SELECT 'storage.objects', count(*) FROM storage.objects;

-- 3. BUCKETS DE STORAGE DETALHADOS
SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets;

-- 4. FUNÇÕES DEFINIDAS NO SCHEMA PUBLIC
SELECT p.proname as function_name, 
       pg_get_function_identity_arguments(p.oid) as arguments,
       p.prosecdef as security_definer
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- 5. POLICIES DE ROW LEVEL SECURITY (RLS)
SELECT tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- 6. TRIGGERS ATIVOS NO SCHEMA PUBLIC
SELECT event_object_table as table_name, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- 7. ENUMS CRIADOS NO BANCO
SELECT t.typname as enum_name, string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) as values
FROM pg_type t
JOIN pg_enum e ON t.oid = e.enumtypid
JOIN pg_namespace n ON t.typnamespace = n.oid
WHERE n.nspname = 'public'
GROUP BY t.typname
ORDER BY t.typname;
