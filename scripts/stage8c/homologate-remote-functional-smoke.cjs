const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

function loadEnvFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  loadEnvFile(path.join(process.cwd(), '.env.local'));
  assert(
    process.env.STAGE8C_REMOTE_SMOKE_CONFIRM === 'official-production-ephemeral-identity',
    'Confirmação efêmera da Etapa 8C.1 ausente.'
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && anonKey && serviceKey, 'Configuração Supabase incompleta.');
  const parsedUrl = new URL(url);
  assert(parsedUrl.protocol === 'https:' && parsedUrl.hostname.endsWith('.supabase.co'), 'Host Supabase não autorizado.');

  const service = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonymous = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: units, error: unitsError } = await service
    .from('units')
    .select('id,tenant_id,status')
    .order('created_at', { ascending: true });
  if (unitsError) throw unitsError;
  const allowedUnit = (units || []).find((unit) => unit.status === 'active');
  assert(allowedUnit, 'É necessária ao menos uma unidade ativa para o smoke remoto.');
  const forbiddenSameTenant = (units || []).find(
    (unit) => unit.id !== allowedUnit.id && unit.tenant_id === allowedUnit.tenant_id
  );
  const forbiddenOtherTenant = (units || []).find(
    (unit) => unit.id !== allowedUnit.id && unit.tenant_id !== allowedUnit.tenant_id
  );
  const forbiddenUnit =
    forbiddenSameTenant ||
    forbiddenOtherTenant ||
    { id: crypto.randomUUID(), tenant_id: allowedUnit.tenant_id };
  const deniedTargetKind = forbiddenSameTenant
    ? 'unscoped_same_tenant_unit'
    : forbiddenOtherTenant
      ? 'other_tenant_unit'
      : 'nonexistent_unit';

  const runId = crypto.randomUUID();
  const email = `stage8c-smoke-${runId}@example.invalid`;
  const password = `S8c!${crypto.randomBytes(20).toString('base64url')}`;
  let userId = null;
  const results = {
    anonymousShiftReportsDenied: false,
    anonymousIntelligenceDenied: false,
    scopedShiftReportsAllowed: false,
    crossUnitShiftReportsDenied: false,
    scopedIntelligenceAllowed: false,
    crossUnitIntelligenceDenied: false,
    cleanupVerified: false,
  };

  try {
    const { data: created, error: createError } = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { purpose: 'stage8c_ephemeral_smoke' },
    });
    if (createError || !created.user) throw createError || new Error('Falha ao criar identidade efêmera.');
    userId = created.user.id;

    const { error: profileError } = await service.from('profiles').insert({
      id: userId,
      tenant_id: allowedUnit.tenant_id,
      full_name: 'Stage 8C Ephemeral Smoke',
      email,
      role: 'supervisor',
      status: 'active',
      must_change_password: false,
    });
    if (profileError) throw profileError;
    const { error: accessError } = await service.from('user_unit_access').insert({
      tenant_id: allowedUnit.tenant_id,
      user_id: userId,
      unit_id: allowedUnit.id,
    });
    if (accessError) throw accessError;

    const { error: anonymousShiftError } = await anonymous.rpc('get_terminal_shift_reports', {
      p_unit_id: allowedUnit.id,
      p_meal_type_id: null,
      p_terminal_id: null,
    });
    results.anonymousShiftReportsDenied = Boolean(anonymousShiftError);

    const today = new Date();
    const currentEnd = today.toISOString().slice(0, 10);
    const currentStartDate = new Date(today);
    currentStartDate.setUTCDate(currentStartDate.getUTCDate() - 7);
    const currentStart = currentStartDate.toISOString().slice(0, 10);
    const previousEndDate = new Date(currentStartDate);
    const previousEnd = previousEndDate.toISOString().slice(0, 10);
    const previousStartDate = new Date(previousEndDate);
    previousStartDate.setUTCDate(previousStartDate.getUTCDate() - 7);
    const previousStart = previousStartDate.toISOString().slice(0, 10);
    const intelligenceArgs = {
      p_period_start: currentStart,
      p_period_end: currentEnd,
      p_previous_start: previousStart,
      p_previous_end: previousEnd,
      p_institution_ids: null,
      p_unit_ids: [allowedUnit.id],
      p_category_ids: null,
    };
    const { error: anonymousIntelligenceError } = await anonymous.rpc(
      'get_operational_intelligence_v1',
      intelligenceArgs
    );
    results.anonymousIntelligenceDenied = Boolean(anonymousIntelligenceError);

    const scoped = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await scoped.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;

    const { data: allowedShiftData, error: allowedShiftError } = await scoped.rpc(
      'get_terminal_shift_reports',
      { p_unit_id: allowedUnit.id, p_meal_type_id: null, p_terminal_id: null }
    );
    results.scopedShiftReportsAllowed = !allowedShiftError && allowedShiftData?.success === true;

    const { error: forbiddenShiftError } = await scoped.rpc('get_terminal_shift_reports', {
      p_unit_id: forbiddenUnit.id,
      p_meal_type_id: null,
      p_terminal_id: null,
    });
    results.crossUnitShiftReportsDenied = Boolean(forbiddenShiftError);

    const { data: allowedIntelligenceData, error: allowedIntelligenceError } = await scoped.rpc(
      'get_operational_intelligence_v1',
      intelligenceArgs
    );
    results.scopedIntelligenceAllowed =
      !allowedIntelligenceError && allowedIntelligenceData?.schema_version === 'stage7d-operational-v1';

    const { error: forbiddenIntelligenceError } = await scoped.rpc(
      'get_operational_intelligence_v1',
      { ...intelligenceArgs, p_unit_ids: [forbiddenUnit.id] }
    );
    results.crossUnitIntelligenceDenied = Boolean(forbiddenIntelligenceError);

    await scoped.auth.signOut();
    assert(Object.values(results).slice(0, 6).every(Boolean), 'Um ou mais controles remotos falharam.');
  } finally {
    if (userId) {
      const { error: deleteError } = await service.auth.admin.deleteUser(userId);
      if (deleteError) {
        await service.from('user_unit_access').delete().eq('user_id', userId);
        await service.from('profiles').delete().eq('id', userId);
        throw deleteError;
      }
      const { data: residualProfile, error: residualError } = await service
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();
      if (residualError) throw residualError;
      results.cleanupVerified = residualProfile === null;
    }
  }

  assert(results.cleanupVerified, 'A limpeza da identidade efêmera não foi comprovada.');
  process.stdout.write(
    `${JSON.stringify({ stage: '8C.1', approved: true, deniedTargetKind, checks: results }, null, 2)}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`Stage 8C.1 smoke failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
