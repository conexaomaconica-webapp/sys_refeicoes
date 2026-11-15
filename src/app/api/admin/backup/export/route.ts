import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import type { UserRole } from '@/types/auth';

const PAGE_SIZE = 1000;
const MAX_ROWS_PER_TABLE = 100_000;

interface TableExportSpec {
  key: string;
  table: string;
  select: string;
  tenantColumn?: string;
}

const TENANT_BACKUP_TABLES: TableExportSpec[] = [
  {
    key: 'tenant',
    table: 'tenants',
    select:
      'id, name, slug, app_name, primary_color, secondary_color, terminal_theme, terminal_layout, status, created_at, updated_at',
    tenantColumn: 'id',
  },
  {
    key: 'institutions',
    table: 'institutions',
    select: 'id, tenant_id, name, short_name, cnpj, status, created_at, updated_at',
  },
  {
    key: 'units',
    table: 'units',
    select:
      'id, tenant_id, institution_id, name, code, city, state, status, cash_shift_mode, created_at, updated_at',
  },
  {
    key: 'student_categories',
    table: 'student_categories',
    select:
      'id, tenant_id, code, name, description, pricing_type, charge_percentage, fixed_price, requires_wallet, allow_multi_meal, payment_mode, allowed_meal_types, status, created_at, updated_at',
  },
  {
    key: 'meal_types',
    table: 'meal_types',
    select: 'id, tenant_id, code, name, start_time, end_time, status, created_at, updated_at',
  },
  {
    key: 'unit_meal_types',
    table: 'unit_meal_types',
    select: 'id, tenant_id, unit_id, meal_type_id, enabled, created_at, updated_at',
  },
  {
    key: 'meal_rules',
    table: 'meal_rules',
    select:
      'id, tenant_id, unit_id, meal_type_id, category_id, full_price, student_price, subsidy_amount, effective_from, effective_to, status, created_at, updated_at',
  },
  {
    key: 'students',
    table: 'students',
    select:
      'id, tenant_id, institution_id, category_id, registration_number, full_name, course, email, phone, status, first_access_status, created_at, updated_at',
  },
  {
    key: 'student_category_history',
    table: 'student_category_history',
    select: 'id, tenant_id, student_id, category_id, valid_from, valid_to, reason, created_at',
  },
  {
    key: 'wallets',
    table: 'wallets',
    select: 'id, tenant_id, student_id, balance, status, created_at, updated_at',
  },
  {
    key: 'wallet_transactions',
    table: 'wallet_transactions',
    select:
      'id, tenant_id, wallet_id, student_id, type, amount, balance_before, balance_after, description, reference_id, created_at',
  },
  {
    key: 'meal_consumptions',
    table: 'meal_consumptions',
    select:
      'id, tenant_id, unit_id, meal_type_id, student_id, category_id, cash_shift_id, service_date, full_price, student_price, subsidy_amount, payment_method, status, created_at',
  },
  {
    key: 'cash_shifts',
    table: 'cash_shifts',
    select:
      'id, tenant_id, unit_id, meal_type_id, operator_id, shift_mode, status, initial_float, expected_cash_balance, counted_cash_balance, difference_amount, difference_reason, opened_at, closed_at',
  },
  {
    key: 'cash_movements',
    table: 'cash_movements',
    select: 'id, tenant_id, cash_shift_id, type, amount, description, created_by, created_at',
  },
  {
    key: 'recharges',
    table: 'recharges',
    select: 'id, tenant_id, student_id, wallet_id, payment_id, amount, status, created_at, confirmed_at',
  },
  {
    key: 'payments',
    table: 'payments',
    select:
      'id, tenant_id, student_id, provider, external_reference, payment_method, amount, status, created_at, confirmed_at',
  },
  {
    key: 'contingency_meal_batches',
    table: 'contingency_meal_batches',
    select:
      'id, tenant_id, unit_id, meal_type_id, service_date, batch_type, adjustment_modality, campaign_id, total_meals, status, justification, evidence_url, operator_id, approved_by, created_at, approved_at',
  },
  {
    key: 'contingency_meal_items',
    table: 'contingency_meal_items',
    select: 'id, tenant_id, batch_id, student_id, category_id, registration_number, notes, created_at',
  },
  {
    key: 'unit_operating_calendar',
    table: 'unit_operating_calendar',
    select: 'id, tenant_id, unit_id, service_date, meal_type_id, is_operating, reason, created_at, updated_at',
  },
  {
    key: 'meal_adjustment_campaigns',
    table: 'meal_adjustment_campaigns',
    select:
      'id, tenant_id, unit_id, reference_month, meal_type_id, selected_meal_type_ids, proven_total_meals, allocated_meals_count, unallocated_pending_meals, distribution_lines, status, justification, evidence_url, created_by, approved_by, created_at, approved_at',
  },
  {
    key: 'financial_daily_closings',
    table: 'financial_daily_closings',
    select:
      'id, tenant_id, unit_id, closing_date, pix_total, card_total, cash_total, total_received, wallet_credits, wallet_debits, custody_balance, custody_drift, student_revenue, subsidy_total, contingency_meals, justification, closed_by, created_at',
  },
];

async function fetchTenantTableRows(
  supabase: Awaited<ReturnType<typeof createClient>>,
  spec: TableExportSpec,
  tenantId: string
): Promise<{ rows: Record<string, unknown>[]; warning?: string }> {
  const rows: Record<string, unknown>[] = [];
  const column = spec.tenantColumn ?? 'tenant_id';
  let from = 0;

  while (from < MAX_ROWS_PER_TABLE) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const clientAny = supabase as any;
    const { data, error } = await clientAny
      .from(spec.table)
      .select(spec.select)
      .eq(column, tenantId)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      return { rows, warning: `${spec.table}: ${error.message}` };
    }

    const batch = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) {
      break;
    }
    from += PAGE_SIZE;
  }

  return { rows };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
  }

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('id, tenant_id, role, status, full_name')
    .eq('id', user.id)
    .single();

  const profile = profileData as {
    id: string;
    tenant_id: string;
    role: UserRole;
    status: string;
    full_name: string;
  } | null;

  if (profileError || !profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Perfil inativo ou não localizado.' }, { status: 403 });
  }

  if (profile.role !== 'admin_general') {
    return NextResponse.json(
      { error: 'Apenas o Administrador Geral pode exportar o backup completo do tenant.' },
      { status: 403 }
    );
  }

  const tables: Record<string, Record<string, unknown>[]> = {};
  const rowCounts: Record<string, number> = {};
  const warnings: string[] = [];

  for (const spec of TENANT_BACKUP_TABLES) {
    const result = await fetchTenantTableRows(supabase, spec, profile.tenant_id);
    tables[spec.key] = result.rows;
    rowCounts[spec.key] = result.rows.length;
    if (result.warning) {
      warnings.push(result.warning);
    }
  }

  const totalRows = Object.values(rowCounts).reduce((acc, count) => acc + count, 0);
  const serializedTables = JSON.stringify(tables);
  const sha256Checksum = createHash('sha256').update(serializedTables).digest('hex');

  const tenantRow = tables.tenant?.[0] as { slug?: string; name?: string } | undefined;
  const tenantSlug = (tenantRow?.slug || 'tenant').replace(/[^a-zA-Z0-9_-]/g, '');
  const now = new Date();
  const stamp = `${now.toISOString().slice(0, 10)}_${now.toISOString().slice(11, 16).replace(':', '-')}`;

  const payload = {
    metadata: {
      backup_version: '1.0',
      format: 'marefeicoes-tenant-logical-json',
      tenant_id: profile.tenant_id,
      tenant_name: tenantRow?.name || null,
      exported_at: now.toISOString(),
      exported_by_user_id: profile.id,
      exported_by_name: profile.full_name,
      total_rows: totalRows,
      row_counts: rowCounts,
      sha256_checksum: sha256Checksum,
      warnings,
      security_notice:
        'Contém apenas dados operacionais e financeiros do tenant autorizado. Credenciais de autenticação, chaves privadas e segredos de webhook não são incluídos.',
    },
    tables,
  };

  console.info(
    `[BACKUP_EXPORT] tenant=${profile.tenant_id} user=${profile.id} rows=${totalRows} sha256=${sha256Checksum}`
  );

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="backup-marefeicoes-${tenantSlug}-${stamp}.json"`,
      'Cache-Control': 'no-store',
      'X-Backup-Checksum': sha256Checksum,
      'X-Backup-Total-Rows': String(totalRows),
    },
  });
}

