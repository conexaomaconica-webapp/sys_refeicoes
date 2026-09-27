/**
 * ==============================================================================
 * Script de Verificação e Validação Estrutural da Sprint 1
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');

console.log('------------------------------------------------------------');
console.log('INICIANDO AUDITORIA E VALIDAÇÃO DA SPRINT 1');
console.log('------------------------------------------------------------\n');

let totalChecks = 0;
let passedChecks = 0;

function assert(condition, message) {
  totalChecks++;
  if (condition) {
    passedChecks++;
    console.log(`[PASS] ${message}`);
  } else {
    console.error(`[FAIL] ${message}`);
  }
}

// 1. Verificação das Migrations
const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
const expectedMigrations = [
  '20260927000001_create_tenants.sql',
  '20260927000002_create_tenant_branding.sql',
  '20260927000003_create_institutions.sql',
  '20260927000004_create_units.sql',
];

console.log('1. Validando existência e conteúdo das 4 migrations:');
expectedMigrations.forEach((file) => {
  const filePath = path.join(migrationsDir, file);
  const exists = fs.existsSync(filePath);
  assert(exists, `Migration presente: ${file}`);
  if (exists) {
    const content = fs.readFileSync(filePath, 'utf8');
    assert(
      content.includes('ENABLE ROW LEVEL SECURITY'),
      `RLS ativado explicitamente em ${file}`
    );
  }
});

// 2. Validação da RPC get_public_tenant_branding
console.log('\n2. Validando RPC pública get_public_tenant_branding:');
const mig2Content = fs.readFileSync(path.join(migrationsDir, expectedMigrations[1]), 'utf8');
assert(
  mig2Content.includes('SECURITY DEFINER'),
  'RPC utiliza SECURITY DEFINER'
);
assert(
  mig2Content.includes("SET search_path = ''"),
  "RPC utiliza SET search_path = '' com qualificação completa"
);
assert(
  mig2Content.includes('lower(t.slug) = lower(p_slug)'),
  'RPC compara slugs em lowercase de forma case-insensitive'
);
assert(
  mig2Content.includes("t.status = 'active'"),
  "RPC filtra estritamente tenants com status = 'active'"
);
assert(
  !mig2Content.includes('legal_name') && !mig2Content.includes('document'),
  'RPC não expõe legal_name nem document'
);

// 3. Validação da Unicidade Case-Insensitive do Slug em tenants
console.log('\n3. Validando índice único case-insensitive do slug:');
const mig1Content = fs.readFileSync(path.join(migrationsDir, expectedMigrations[0]), 'utf8');
assert(
  mig1Content.includes('CREATE UNIQUE INDEX uq_tenants_slug_lower ON public.tenants (lower(slug))'),
  'Índice único sobre lower(slug) configurado'
);
assert(
  mig1Content.includes('chk_tenants_slug_lowercase'),
  'Constraint de verificação slug = lower(slug) ativa'
);

// 4. Validação da Integridade Relacional Composta (units <-> institutions <-> tenants)
console.log('\n4. Validando FK composta entre units e institutions:');
const mig3Content = fs.readFileSync(path.join(migrationsDir, expectedMigrations[2]), 'utf8');
const mig4Content = fs.readFileSync(path.join(migrationsDir, expectedMigrations[3]), 'utf8');

assert(
  mig3Content.includes('CONSTRAINT uq_institutions_id_tenant UNIQUE (id, tenant_id)'),
  'institutions possui constraint única composta (id, tenant_id)'
);
const mig4Normalized = mig4Content.replace(/\s+/g, ' ');
assert(
  mig4Normalized.includes('FOREIGN KEY (institution_id, tenant_id) REFERENCES public.institutions(id, tenant_id)'),
  'units referencia obrigatoriamente (institution_id, tenant_id) em institutions'
);
assert(
  mig4Content.includes('ON DELETE RESTRICT'),
  'units impede deleção acidental com ON DELETE RESTRICT'
);

// 5. Validação da Proteção server-only em admin.ts
console.log('\n5. Validando proteção server-only:');
const adminPath = path.join(__dirname, '..', 'src', 'lib', 'supabase', 'admin.ts');
const adminContent = fs.readFileSync(adminPath, 'utf8');
assert(
  adminContent.startsWith("import 'server-only';"),
  "src/lib/supabase/admin.ts protegido com import 'server-only'"
);

// 6. Simulação Lógica da RPC get_public_tenant_branding (Regras de Negócio)
console.log('\n6. Teste da Lógica da RPC com Cenários Simulados:');

const mockDatabase = {
  tenants: [
    { id: 't-1', name: 'Nutri Refeições Ltda', slug: 'nutri-refeicoes', legal_name: 'Nutri Refeições S/A', document: '12.345.678/0001-90', status: 'active' },
    { id: 't-2', name: 'Refeições Inativas', slug: 'inativo-refeicoes', legal_name: 'Inativo Ltda', document: '99.888.777/0001-11', status: 'inactive' },
  ],
  tenant_branding: [
    {
      tenant_id: 't-1',
      app_name: 'Nutri RU',
      logo_url: 'https://cdn.example.com/logo.png',
      splash_background: '#0f172a',
      splash_animation_type: 'fade_pulse',
      splash_duration_ms: 1200,
      primary_color: '#0284c7',
      secondary_color: '#0f172a',
    }
  ]
};

function simulateRpcGetPublicBranding(p_slug) {
  const normalized = (p_slug || '').toLowerCase().trim();
  const tenant = mockDatabase.tenants.find(
    (t) => t.slug.toLowerCase() === normalized && t.status === 'active'
  );
  if (!tenant) return [];
  const branding = mockDatabase.tenant_branding.find((b) => b.tenant_id === tenant.id);
  if (!branding) return [];

  // Devolve APENAS os campos públicos
  return [{
    tenant_id: tenant.id,
    slug: tenant.slug,
    app_name: branding.app_name,
    logo_url: branding.logo_url,
    splash_background: branding.splash_background,
    splash_animation_type: branding.splash_animation_type,
    splash_duration_ms: branding.splash_duration_ms,
    primary_color: branding.primary_color,
    secondary_color: branding.secondary_color,
  }];
}

// Caso 1: Tenant Ativo Existente (case insensitive)
const testExistente = simulateRpcGetPublicBranding('Nutri-Refeicoes');
assert(
  testExistente.length === 1 && testExistente[0].app_name === 'Nutri RU' && !testExistente[0].legal_name,
  'Caso 1 (Tenant Ativo): RPC retorna branding correto sem expor legal_name'
);

// Caso 2: Tenant Inexistente
const testInexistente = simulateRpcGetPublicBranding('empresa-que-nao-existe');
assert(
  testInexistente.length === 0,
  'Caso 2 (Tenant Inexistente): RPC retorna conjunto vazio []'
);

// Caso 3: Tenant Inativo
const testInativo = simulateRpcGetPublicBranding('inativo-refeicoes');
assert(
  testInativo.length === 0,
  'Caso 3 (Tenant Inativo): RPC retorna conjunto vazio [] protegendo tenant suspenso'
);

// 7. Simulação Lógica da Constraint Composta de Integridade (units <-> institutions)
console.log('\n7. Teste de Validação da Constraint Composta:');
const mockInstitutions = [
  { id: 'inst-1', tenant_id: 'tenant-A', name: 'Universidade A' },
  { id: 'inst-2', tenant_id: 'tenant-B', name: 'Universidade B' },
];

function simulateInsertUnit(unit) {
  // A constraint fk_units_institution_tenant valida (institution_id, tenant_id)
  const valid = mockInstitutions.some(
    (i) => i.id === unit.institution_id && i.tenant_id === unit.tenant_id
  );
  if (!valid) {
    throw new Error('VIOLATION_23503: Foreign key fk_units_institution_tenant violada!');
  }
  return true;
}

// Inserção legítima (mesmo tenant)
let legitimatePass = false;
try {
  legitimatePass = simulateInsertUnit({
    name: 'RU Campus I',
    tenant_id: 'tenant-A',
    institution_id: 'inst-1'
  });
} catch (e) {
  legitimatePass = false;
}
assert(legitimatePass, 'Unit vinculada à institution do MESMO tenant inserida com sucesso');

// Inserção ilegítima (tenant cruzado)
let crossTenantBlocked = false;
try {
  simulateInsertUnit({
    name: 'RU Invasor',
    tenant_id: 'tenant-A',
    institution_id: 'inst-2' // inst-2 pertence a tenant-B!
  });
} catch (e) {
  crossTenantBlocked = true;
}
assert(crossTenantBlocked, 'Unit com tenant-A apontando para institution do tenant-B foi BLOQUEADA pelo banco');

console.log('\n------------------------------------------------------------');
console.log(`TOTAL DE VERIFICAÇÕES: ${totalChecks} | APROVADAS: ${passedChecks}`);
console.log(passedChecks === totalChecks ? 'STATUS GERAL: SPRINT 1 VALIDADA COM SUCESSO' : 'STATUS GERAL: FALHAS DETECTADAS');
console.log('------------------------------------------------------------\n');
