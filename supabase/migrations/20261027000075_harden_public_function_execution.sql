-- Etapa 8A.3: remover EXECUTE herdado de PUBLIC nas 12 funcoes detectadas
-- pelo preflight remoto. Migration preparada localmente; nao aplicar sem
-- revisao, autorizacao e snapshot dos ACLs efetivos.

-- Overload legado: o cliente atual utiliza a assinatura com meal_type_id.
REVOKE ALL ON FUNCTION public.admin_list_cash_shifts(
    UUID, VARCHAR, DATE, DATE
) FROM PUBLIC, anon, authenticated;

-- RPCs legadas retiradas da superficie authenticated pela migration 44.
REVOKE ALL ON FUNCTION public.get_active_cash_shift(
    UUID, VARCHAR
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.record_cash_movement(
    UUID, VARCHAR, NUMERIC, VARCHAR, TEXT
) FROM PUBLIC, anon, authenticated;

-- RPC ativa no relatorio do terminal: acesso somente para authenticated.
REVOKE ALL ON FUNCTION public.get_terminal_shift_reports(
    UUID, UUID, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_terminal_shift_reports(
    UUID, UUID, TEXT
) TO authenticated;

-- Overload legado: o fluxo atual utiliza register_operator_visitor_entry_v2;
-- a assinatura VARCHAR/VARCHAR restaurada na migration 47 ja e interna.
REVOKE ALL ON FUNCTION public.register_visitor_entry(
    UUID, UUID, TEXT, VARCHAR
) FROM PUBLIC, anon, authenticated;

-- Funcoes de trigger nao precisam de EXECUTE para papeis de aplicacao. Os
-- triggers existentes continuam associados; apenas a invocacao direta e
-- removida da superficie publica.
REVOKE ALL ON FUNCTION public.enrich_cash_movement()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.handle_updated_at()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.refresh_cash_shift_payment_totals()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.sync_imported_consumer_identity()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.trg_prevent_profile_escalation()
FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.trg_prevent_student_tampering()
FROM PUBLIC, anon, authenticated;

-- rls_auto_enable() existe no schema efetivo, mas nao na cadeia local. O
-- tratamento condicional reconcilia o drift sem impedir instalacoes novas.
DO $stage8a_rls_auto_enable$
BEGIN
    IF pg_catalog.to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.rls_auto_enable() '
            || 'FROM PUBLIC, anon, authenticated';
    END IF;
END;
$stage8a_rls_auto_enable$;

-- Pos-condicao: nenhuma das assinaturas existentes pode continuar executavel
-- por PUBLIC. O teste usa os ACLs efetivos, nao apenas grants diretos.
DO $stage8a_postcondition$
DECLARE
    signature TEXT;
    procedure_oid REGPROCEDURE;
BEGIN
    FOREACH signature IN ARRAY ARRAY[
        'public.admin_list_cash_shifts(uuid,character varying,date,date)',
        'public.get_active_cash_shift(uuid,character varying)',
        'public.get_terminal_shift_reports(uuid,uuid,text)',
        'public.record_cash_movement(uuid,character varying,numeric,character varying,text)',
        'public.register_visitor_entry(uuid,uuid,text,character varying)',
        'public.enrich_cash_movement()',
        'public.handle_updated_at()',
        'public.refresh_cash_shift_payment_totals()',
        'public.sync_imported_consumer_identity()',
        'public.trg_prevent_profile_escalation()',
        'public.trg_prevent_student_tampering()',
        'public.rls_auto_enable()'
    ]
    LOOP
        procedure_oid := pg_catalog.to_regprocedure(signature);
        IF procedure_oid IS NOT NULL AND EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc AS procedure,
                 LATERAL pg_catalog.aclexplode(COALESCE(
                     procedure.proacl,
                     pg_catalog.acldefault('f', procedure.proowner)
                 )) AS acl
            WHERE procedure.oid = procedure_oid
              AND acl.grantee = 0
              AND acl.privilege_type = 'EXECUTE'
        ) THEN
            RAISE EXCEPTION 'STAGE8A_PUBLIC_EXECUTE_REMAINS: %', signature;
        END IF;
    END LOOP;
END;
$stage8a_postcondition$;

NOTIFY pgrst, 'reload schema';
