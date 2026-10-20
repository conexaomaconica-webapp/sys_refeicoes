const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, '.e2e-sprint11-manifest.json');
const csvPath = path.join(root, '.e2e-sprint11-input.csv');
const envText = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
function env(name) {
  const match = envText.match(new RegExp(`^${name}=["']?([^"'\\r\\n]+)`, 'm'));
  if (!match) throw new Error(`${name} não configurada.`);
  return match[1].trim();
}
const db = new Client({ connectionString: env('SUPABASE_DB_URL').replace(/\?sslmode=.*/, ''), ssl: { rejectUnauthorized: false } });
const admin = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
const publicClient = createClient(env('NEXT_PUBLIC_SUPABASE_URL'), env('NEXT_PUBLIC_SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });

async function setup() {
  if (fs.existsSync(manifestPath)) throw new Error('Manifesto E2E anterior ainda existe; execute cleanup primeiro.');
  await db.connect();
  const context = await db.query(`
    SELECT p.tenant_id, i.id AS institution_id, i.name AS institution_name
    FROM public.profiles p
    JOIN public.institutions i ON i.tenant_id = p.tenant_id AND i.status = 'active'
    WHERE p.status = 'active' AND p.role = 'admin_general'
    ORDER BY p.created_at, i.created_at LIMIT 1
  `);
  if (context.rowCount !== 1) throw new Error('Tenant/instituição de teste não localizados.');
  const runId = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const marker = `E2E-S11-${runId}`;
  const email = `e2e-s11-${runId}@example.invalid`;
  const password = `E2e!${crypto.randomBytes(18).toString('base64url')}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) throw new Error(`Falha ao criar usuário E2E: ${error?.message}`);
  try {
    await db.query(`
      INSERT INTO public.profiles (id, tenant_id, full_name, email, role, status)
      VALUES ($1, $2, 'Administrador E2E Sprint 11', $3, 'admin_general', 'active')
    `, [data.user.id, context.rows[0].tenant_id, email]);
    const loginProbe = await publicClient.auth.signInWithPassword({ email, password });
    if (loginProbe.error || !loginProbe.data.user) throw new Error(`Credencial E2E não autenticou: ${loginProbe.error?.message}`);
    await publicClient.auth.signOut();
    const lines = ['matricula,nome,categoria,curso,email,status'];
    for (let index = 1; index <= 8; index++) {
      lines.push(`${marker}-${String(index).padStart(3, '0')},Aluno E2E ${index},partial,Curso E2E,e2e-${runId}-${index}@example.invalid,active`);
    }
    lines.push(`,Aluno Sem Matricula,partial,Curso E2E,,active`);
    lines.push(`${marker}-BAD,Aluno Categoria Invalida,categoria_inexistente,Curso E2E,,active`);
    fs.writeFileSync(csvPath, `\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
    fs.writeFileSync(manifestPath, JSON.stringify({
      runId, marker, email, password, userId: data.user.id,
      tenantId: context.rows[0].tenant_id,
      institutionId: context.rows[0].institution_id,
      institutionName: context.rows[0].institution_name,
      csvPath,
    }), 'utf8');
    console.log('Fixture E2E criada com usuário, instituição e CSV sintéticos.');
  } catch (error) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw error;
  } finally {
    await db.end();
  }
}

async function verify() {
  const fixture = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  await db.connect();
  try {
    const result = await db.query(`
      SELECT
        (SELECT count(*)::int FROM public.students WHERE registration_number LIKE $1) AS students,
        (SELECT count(*)::int FROM public.imports WHERE original_filename = $2) AS imports,
        (SELECT count(*)::int FROM public.import_rows ir JOIN public.imports i ON i.id = ir.import_id WHERE i.original_filename = $2 AND ir.status = 'processed') AS processed,
        (SELECT count(*)::int FROM public.import_rows ir JOIN public.imports i ON i.id = ir.import_id WHERE i.original_filename = $2 AND ir.action = 'error') AS rejected
    `, [`${fixture.marker}%`, path.basename(fixture.csvPath)]);
    const row = result.rows[0];
    console.log('Verificação E2E persistida:', row);
    if (row.students !== 8 || row.imports !== 1 || row.processed !== 8 || row.rejected !== 2) {
      throw new Error('Contagens persistidas do E2E divergentes.');
    }
  } finally { await db.end(); }
}

async function cleanup() {
  if (!fs.existsSync(manifestPath)) { console.log('Nenhuma fixture E2E para limpar.'); return; }
  const fixture = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  await db.connect();
  try {
    const paths = await db.query('SELECT storage_path FROM public.imports WHERE original_filename = $1 AND created_by = $2', [path.basename(fixture.csvPath), fixture.userId]);
    const ownedPaths = paths.rows.map((row) => row.storage_path);
    if (ownedPaths.length) {
      const { error: storageError } = await admin.storage.from('import-files').remove(ownedPaths);
      if (storageError) throw new Error(`Falha ao limpar Storage E2E: ${storageError.message}`);
      const storageResidue = await db.query("SELECT count(*)::int AS count FROM storage.objects WHERE bucket_id = 'import-files' AND name = ANY($1::text[])", [ownedPaths]);
      if (storageResidue.rows[0].count !== 0) throw new Error('Limpeza E2E deixou arquivo no Storage.');
    }
    await db.query('BEGIN');
    await db.query(`DELETE FROM public.student_category_history WHERE import_id IN (SELECT id FROM public.imports WHERE original_filename = $1)`, [path.basename(fixture.csvPath)]);
    await db.query(`DELETE FROM public.imports WHERE original_filename = $1`, [path.basename(fixture.csvPath)]);
    await db.query(`DELETE FROM public.students WHERE registration_number LIKE $1`, [`${fixture.marker}%`]);
    await db.query(`DELETE FROM public.profiles WHERE id = $1`, [fixture.userId]);
    await db.query('COMMIT');
    await admin.auth.admin.deleteUser(fixture.userId);
    const residue = await db.query(`
      SELECT
        (SELECT count(*)::int FROM public.students WHERE registration_number LIKE $1) AS students,
        (SELECT count(*)::int FROM public.imports WHERE original_filename = $2) AS imports,
        (SELECT count(*)::int FROM public.profiles WHERE id = $3) AS profiles
    `, [`${fixture.marker}%`, path.basename(fixture.csvPath), fixture.userId]);
    if (Object.values(residue.rows[0]).some((value) => value !== 0)) throw new Error('Limpeza E2E deixou resíduos no banco.');
    fs.rmSync(csvPath, { force: true });
    fs.rmSync(manifestPath, { force: true });
    console.log('Limpeza E2E concluída sem resíduos no banco.');
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { await db.end(); }
}

const mode = process.argv[2];
({ setup, verify, cleanup }[mode]?.() || Promise.reject(new Error('Use setup, verify ou cleanup.')))
  .catch((error) => { console.error(error.message); process.exit(1); });
