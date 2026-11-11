-- Etapa 7B: hardening das policies identificadas na homologacao da Etapa 4B.
-- Migration preparada localmente. Nao aplicar sem homologacao e autorizacao.

-- Sem relacao canonica estudante <-> unidade, inferir a unidade por instituicao
-- permitiria acesso lateral. Supervisores e gerentes dependem, por ora, de um
-- vinculo institucional explicito. Acesso baseado apenas em user_unit_access
-- fica fechado ate a decisao de modelagem.
CREATE OR REPLACE FUNCTION public.can_manage_students_at_institution(
    p_institution_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
          FROM public.profiles AS profile
          JOIN public.institutions AS institution
            ON institution.id = p_institution_id
           AND institution.tenant_id = profile.tenant_id
         WHERE profile.id = auth.uid()
           AND profile.status = 'active'
           AND (
                profile.role IN ('admin_general', 'operations_director', 'finance')
                OR (
                    profile.role IN ('supervisor', 'unit_manager', 'institution_user')
                    AND EXISTS (
                        SELECT 1
                          FROM public.user_institution_access AS institution_access
                         WHERE institution_access.user_id = profile.id
                           AND institution_access.tenant_id = profile.tenant_id
                           AND institution_access.institution_id = p_institution_id
                    )
                )
           )
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_students_at_institution(UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_students_at_institution(UUID)
TO authenticated;

DROP POLICY IF EXISTS sel_students ON public.students;
CREATE POLICY sel_students
ON public.students
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        user_id = auth.uid()
        OR public.can_manage_students_at_institution(institution_id)
    )
);

-- Financeiro e perfis organizacionais globais conservam leitura por tenant.
-- Perfis de unidade ficam fail-closed enquanto nao existir origem canonica de
-- unit_id em estudante/carteira/pagamento/recarga.
DROP POLICY IF EXISTS sel_wallets_staff ON public.wallets;
CREATE POLICY sel_wallets_staff
ON public.wallets
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
);

DROP POLICY IF EXISTS sel_wallet_tx_staff ON public.wallet_transactions;
CREATE POLICY sel_wallet_tx_staff
ON public.wallet_transactions
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
);

DROP POLICY IF EXISTS sel_payments_staff ON public.payments;
CREATE POLICY sel_payments_staff
ON public.payments
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
);

DROP POLICY IF EXISTS sel_recharges_staff ON public.recharges;
CREATE POLICY sel_recharges_staff
ON public.recharges
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
);

DROP POLICY IF EXISTS cash_shifts_select_policy ON public.cash_shifts;
CREATE POLICY cash_shifts_select_policy
ON public.cash_shifts
FOR SELECT TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
        OR (
            public.get_auth_user_role() IN ('supervisor', 'unit_manager', 'operator')
            AND public.has_unit_access(unit_id)
        )
    )
);

DROP POLICY IF EXISTS cash_shifts_insert_policy ON public.cash_shifts;
CREATE POLICY cash_shifts_insert_policy
ON public.cash_shifts
FOR INSERT TO authenticated
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'unit_manager', 'operator')
    AND public.has_unit_access(unit_id)
);

DROP POLICY IF EXISTS cash_shifts_update_policy ON public.cash_shifts;
CREATE POLICY cash_shifts_update_policy
ON public.cash_shifts
FOR UPDATE TO authenticated
USING (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
        OR (
            public.get_auth_user_role() IN ('unit_manager', 'operator')
            AND public.has_unit_access(unit_id)
        )
    )
)
WITH CHECK (
    tenant_id = public.get_auth_tenant_id()
    AND public.get_auth_user_status() = 'active'
    AND (
        public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
        OR (
            public.get_auth_user_role() IN ('unit_manager', 'operator')
            AND public.has_unit_access(unit_id)
        )
    )
);

DROP POLICY IF EXISTS cash_movements_select_policy ON public.cash_movements;
CREATE POLICY cash_movements_select_policy
ON public.cash_movements
FOR SELECT TO authenticated
USING (
    public.get_auth_user_status() = 'active'
    AND EXISTS (
        SELECT 1
          FROM public.cash_shifts AS shift
         WHERE shift.id = cash_movements.cash_shift_id
           AND shift.tenant_id = public.get_auth_tenant_id()
           AND (
                public.get_auth_user_role() IN ('admin_general', 'operations_director', 'finance')
                OR (
                    public.get_auth_user_role() IN ('supervisor', 'unit_manager', 'operator')
                    AND public.has_unit_access(shift.unit_id)
                )
           )
    )
);

DROP POLICY IF EXISTS cash_movements_insert_policy ON public.cash_movements;
CREATE POLICY cash_movements_insert_policy
ON public.cash_movements
FOR INSERT TO authenticated
WITH CHECK (
    public.get_auth_user_status() = 'active'
    AND public.get_auth_user_role() IN ('admin_general', 'operations_director', 'unit_manager', 'operator')
    AND EXISTS (
        SELECT 1
          FROM public.cash_shifts AS shift
         WHERE shift.id = cash_movements.cash_shift_id
           AND shift.tenant_id = public.get_auth_tenant_id()
           AND public.has_unit_access(shift.unit_id)
    )
);

NOTIFY pgrst, 'reload schema';
