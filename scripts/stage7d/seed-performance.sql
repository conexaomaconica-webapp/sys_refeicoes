-- Carga sintetica deterministica: 240 mil consumos em dois tenants.

INSERT INTO public.tenants (id, name) VALUES
('7d000000-0000-4000-8000-000000000001', 'Tenant A'),
('7d000000-0000-4000-8000-000000000002', 'Tenant B');

INSERT INTO public.institutions (id, tenant_id, name, status) VALUES
('7d100000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000001', 'Instituicao A1', 'active'),
('7d100000-0000-4000-8000-000000000002', '7d000000-0000-4000-8000-000000000001', 'Instituicao A2', 'active'),
('7d100000-0000-4000-8000-000000000003', '7d000000-0000-4000-8000-000000000002', 'Instituicao B1', 'active');

INSERT INTO public.units (id, tenant_id, institution_id, name, status) VALUES
('7d200000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000001', '7d100000-0000-4000-8000-000000000001', 'Central', 'active'),
('7d200000-0000-4000-8000-000000000002', '7d000000-0000-4000-8000-000000000001', '7d100000-0000-4000-8000-000000000001', 'Norte', 'active'),
('7d200000-0000-4000-8000-000000000003', '7d000000-0000-4000-8000-000000000001', '7d100000-0000-4000-8000-000000000002', 'Sul', 'active'),
('7d200000-0000-4000-8000-000000000004', '7d000000-0000-4000-8000-000000000002', '7d100000-0000-4000-8000-000000000003', 'Outro tenant', 'active');

INSERT INTO public.student_categories (id, tenant_id, code, name) VALUES
('7d300000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000001', 'integral', 'Bolsista integral'),
('7d300000-0000-4000-8000-000000000002', '7d000000-0000-4000-8000-000000000001', 'partial', 'Comensal parcial'),
('7d300000-0000-4000-8000-000000000003', '7d000000-0000-4000-8000-000000000001', 'visitante', 'Visitante'),
('7d300000-0000-4000-8000-000000000004', '7d000000-0000-4000-8000-000000000002', 'integral', 'Integral B');

INSERT INTO public.profiles (id, tenant_id, role, status) VALUES
('7da00000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000001', 'admin_general', 'active'),
('7da00000-0000-4000-8000-000000000002', '7d000000-0000-4000-8000-000000000001', 'operations_director', 'active'),
('7da00000-0000-4000-8000-000000000003', '7d000000-0000-4000-8000-000000000001', 'finance', 'active'),
('7da00000-0000-4000-8000-000000000004', '7d000000-0000-4000-8000-000000000001', 'supervisor', 'active'),
('7da00000-0000-4000-8000-000000000005', '7d000000-0000-4000-8000-000000000001', 'unit_manager', 'active'),
('7da00000-0000-4000-8000-000000000006', '7d000000-0000-4000-8000-000000000001', 'institution_user', 'active'),
('7da00000-0000-4000-8000-000000000007', '7d000000-0000-4000-8000-000000000001', 'operator', 'active'),
('7da00000-0000-4000-8000-000000000008', '7d000000-0000-4000-8000-000000000001', 'student', 'active'),
('7da00000-0000-4000-8000-000000000009', '7d000000-0000-4000-8000-000000000001', 'supervisor', 'inactive'),
('7da00000-0000-4000-8000-000000000010', '7d000000-0000-4000-8000-000000000002', 'admin_general', 'active');

INSERT INTO public.user_unit_access (tenant_id, user_id, unit_id) VALUES
('7d000000-0000-4000-8000-000000000001', '7da00000-0000-4000-8000-000000000004', '7d200000-0000-4000-8000-000000000001'),
('7d000000-0000-4000-8000-000000000001', '7da00000-0000-4000-8000-000000000005', '7d200000-0000-4000-8000-000000000002');

INSERT INTO public.user_institution_access (tenant_id, user_id, institution_id) VALUES
('7d000000-0000-4000-8000-000000000001', '7da00000-0000-4000-8000-000000000006', '7d100000-0000-4000-8000-000000000001');

-- Estudantes minimos exigidos pela FK do baseline.
INSERT INTO public.students (id, tenant_id, institution_id, full_name, status) VALUES
('7d400000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000001', '7d100000-0000-4000-8000-000000000001', 'Comensal sintetico A', 'active'),
('7d400000-0000-4000-8000-000000000002', '7d000000-0000-4000-8000-000000000002', '7d100000-0000-4000-8000-000000000003', 'Comensal sintetico B', 'active');

-- Tenant A: 120k no periodo atual, 90k no anterior. Cinco por cento cancelados.
INSERT INTO public.meal_consumptions (
    id, tenant_id, unit_id, institution_id, student_id, category_id,
    consumption_date, consumed_at, status
)
SELECT md5('a-current-' || series)::UUID,
       '7d000000-0000-4000-8000-000000000001'::UUID,
       (ARRAY[
          '7d200000-0000-4000-8000-000000000001'::UUID,
          '7d200000-0000-4000-8000-000000000002'::UUID,
          '7d200000-0000-4000-8000-000000000003'::UUID
       ])[1 + (series % 3)],
       CASE WHEN series % 3 = 2
            THEN '7d100000-0000-4000-8000-000000000002'::UUID
            ELSE '7d100000-0000-4000-8000-000000000001'::UUID END,
       '7d400000-0000-4000-8000-000000000001'::UUID,
       (ARRAY[
          '7d300000-0000-4000-8000-000000000001'::UUID,
          '7d300000-0000-4000-8000-000000000002'::UUID,
          '7d300000-0000-4000-8000-000000000003'::UUID
       ])[1 + (series % 3)],
       DATE '2026-10-01' + ((series - 1) % 31),
       TIMESTAMPTZ '2026-10-01 12:00:00-03' + ((series - 1) % 31) * INTERVAL '1 day',
       CASE WHEN series % 20 = 0 THEN 'cancelled_unserved'
            WHEN series % 10 = 0 THEN 'financially_refunded'
            ELSE 'approved' END
  FROM generate_series(1, 120000) AS source(series);

INSERT INTO public.meal_consumptions (
    id, tenant_id, unit_id, institution_id, student_id, category_id,
    consumption_date, consumed_at, status
)
SELECT md5('a-previous-' || series)::UUID,
       '7d000000-0000-4000-8000-000000000001'::UUID,
       (ARRAY[
          '7d200000-0000-4000-8000-000000000001'::UUID,
          '7d200000-0000-4000-8000-000000000002'::UUID,
          '7d200000-0000-4000-8000-000000000003'::UUID
       ])[1 + (series % 3)],
       CASE WHEN series % 3 = 2
            THEN '7d100000-0000-4000-8000-000000000002'::UUID
            ELSE '7d100000-0000-4000-8000-000000000001'::UUID END,
       '7d400000-0000-4000-8000-000000000001'::UUID,
       (ARRAY[
          '7d300000-0000-4000-8000-000000000001'::UUID,
          '7d300000-0000-4000-8000-000000000002'::UUID,
          '7d300000-0000-4000-8000-000000000003'::UUID
       ])[1 + (series % 3)],
       DATE '2026-08-31' + ((series - 1) % 31),
       TIMESTAMPTZ '2026-08-31 12:00:00-03' + ((series - 1) % 31) * INTERVAL '1 day',
       CASE WHEN series % 20 = 0 THEN 'cancelled_unserved'
            WHEN series % 10 = 0 THEN 'financially_refunded'
            ELSE 'approved' END
  FROM generate_series(1, 90000) AS source(series);

-- Tenant B: 15k em cada periodo, para provar isolamento lateral.
INSERT INTO public.meal_consumptions (
    id, tenant_id, unit_id, institution_id, student_id, category_id,
    consumption_date, consumed_at, status
)
SELECT md5('b-' || period_key || '-' || series)::UUID,
       '7d000000-0000-4000-8000-000000000002'::UUID,
       '7d200000-0000-4000-8000-000000000004'::UUID,
       '7d100000-0000-4000-8000-000000000003'::UUID,
       '7d400000-0000-4000-8000-000000000002'::UUID,
       '7d300000-0000-4000-8000-000000000004'::UUID,
       CASE WHEN period_key = 'current' THEN DATE '2026-10-01' ELSE DATE '2026-08-31' END + ((series - 1) % 31),
       CASE WHEN period_key = 'current' THEN TIMESTAMPTZ '2026-10-01 12:00:00-03' ELSE TIMESTAMPTZ '2026-08-31 12:00:00-03' END + ((series - 1) % 31) * INTERVAL '1 day',
       CASE WHEN series % 20 = 0 THEN 'cancelled_unserved' ELSE 'approved' END
  FROM (VALUES ('current'), ('previous')) AS periods(period_key)
 CROSS JOIN generate_series(1, 15000) AS source(series);

ANALYZE public.meal_consumptions;
ANALYZE public.units;
ANALYZE public.student_categories;

