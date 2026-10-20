const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const rootDir = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(rootDir, '.env.local'), 'utf8');

function requiredEnv(name) {
  const match = env.match(new RegExp(`^${name}=["']?([^"'\\r\\n]+)`, 'm'));
  if (!match) throw new Error(`${name} nao encontrada em .env.local.`);
  return match[1].trim();
}

const supabaseUrl = requiredEnv('NEXT_PUBLIC_SUPABASE_URL');
const serviceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
const anonKey = requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const dbUrl = requiredEnv('SUPABASE_DB_URL').replace(/\?sslmode=.*/, '');
const defaultTenantSlug = env.match(/^NEXT_PUBLIC_DEFAULT_TENANT_SLUG=["']?([^"'\r\n]+)/m)?.[1]?.trim() || 'nutri-refeicoes';

const email = 'eduardopedro.fsa@gmail.com';
const fullName = 'Eduardo Pedro';
const temporaryPassword = `Ma!${crypto.randomBytes(12).toString('base64url')}9a`;

async function adminRequest(pathname, options) {
  const response = await fetch(`${supabaseUrl}${pathname}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.msg || payload.message || payload.error_description || `Auth API HTTP ${response.status}`);
  }
  return payload;
}

async function main() {
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  let createdNewUser = false;
  let userId;

  try {
    let tenantResult = await client.query(
      `SELECT id, name, slug FROM public.tenants WHERE slug = $1 AND status = 'active' LIMIT 1`,
      [defaultTenantSlug]
    );
    if (tenantResult.rowCount === 0) {
      tenantResult = await client.query(
        `SELECT id, name, slug FROM public.tenants WHERE status = 'active' ORDER BY created_at`
      );
      if (tenantResult.rowCount !== 1) {
        const slugs = tenantResult.rows.map((row) => row.slug).join(', ') || 'nenhum';
        throw new Error(`Tenant "${defaultTenantSlug}" nao encontrado e nao ha um unico tenant ativo. Ativos: ${slugs}.`);
      }
    }
    const tenant = tenantResult.rows[0];

    const existingResult = await client.query(
      `SELECT id FROM auth.users WHERE lower(email) = lower($1) LIMIT 1`,
      [email]
    );

    const authPayload = {
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { full_name: fullName, must_change_password: true },
      app_metadata: { role: 'admin_general', tenant_id: tenant.id },
    };

    if (existingResult.rowCount > 0) {
      userId = existingResult.rows[0].id;
      await adminRequest(`/auth/v1/admin/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(authPayload),
      });
    } else {
      const created = await adminRequest('/auth/v1/admin/users', {
        method: 'POST',
        body: JSON.stringify(authPayload),
      });
      userId = created.id;
      createdNewUser = true;
    }

    await client.query('BEGIN');
    try {
      await client.query(
        `INSERT INTO public.profiles (id, tenant_id, full_name, email, role, status)
         VALUES ($1, $2, $3, $4, 'admin_general', 'active')
         ON CONFLICT (id) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           full_name = EXCLUDED.full_name,
           email = EXCLUDED.email,
           role = 'admin_general',
           status = 'active',
           updated_at = now()`,
        [userId, tenant.id, fullName, email]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (createdNewUser) {
        await adminRequest(`/auth/v1/admin/users/${userId}`, { method: 'DELETE' }).catch(() => {});
      }
      throw error;
    }

    const loginResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: temporaryPassword }),
    });
    const loginPayload = await loginResponse.json().catch(() => ({}));
    if (!loginResponse.ok || !loginPayload.access_token) {
      throw new Error(`Usuario criado, mas a validacao de login falhou (HTTP ${loginResponse.status}).`);
    }

    const profileResult = await client.query(
      `SELECT p.id, p.email, p.full_name, p.role, p.status, t.slug AS tenant_slug
       FROM public.profiles p
       JOIN public.tenants t ON t.id = p.tenant_id
       WHERE p.id = $1`,
      [userId]
    );
    const profile = profileResult.rows[0];
    if (!profile || profile.role !== 'admin_general' || profile.status !== 'active') {
      throw new Error('Perfil administrativo nao foi validado.');
    }

    console.log(JSON.stringify({
      success: true,
      created: createdNewUser,
      user_id: userId,
      email,
      full_name: fullName,
      role: profile.role,
      status: profile.status,
      tenant: profile.tenant_slug,
      login_validated: true,
      temporary_password: temporaryPassword,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Falha ao criar administrador master:', error.message);
  process.exit(1);
});
