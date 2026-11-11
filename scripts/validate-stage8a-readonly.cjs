const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const runner = fs.readFileSync(path.join(root, 'scripts/audit-stage8a-readonly.cjs'), 'utf8');
const inventory = fs.readFileSync(path.join(root, 'scripts/stage7d/staging-inventory-readonly.sql'), 'utf8');
const checks = [];

function check(name, condition) { checks.push([name, Boolean(condition)]); }

check('runner exige autorizacao explicita', runner.includes("STAGE8A_ALLOW_REMOTE_READONLY !== 'YES'"));
check('runner exige credencial dedicada', runner.includes('STAGE8A_DB_URL') && runner.includes('SUPABASE_DB_URL nao e aceita'));
check('credencial postgres e service role sao recusadas', runner.includes('/^postgres') && runner.includes('service[_-]?role'));
check('destino fica restrito ao projeto Supabase', runner.includes("endsWith('.supabase.com')") && runner.includes('project-ref'));
check('TLS valida certificado', runner.includes('rejectUnauthorized: true'));
check('transacao e estritamente read-only', runner.includes('BEGIN TRANSACTION READ ONLY') && inventory.includes('BEGIN TRANSACTION READ ONLY'));
check('transacao sempre tenta rollback', runner.includes("await client.query('ROLLBACK')") && inventory.trimEnd().endsWith('ROLLBACK;'));
check('papeis privilegiados sao recusados', ['rolsuper', 'rolbypassrls', 'rolcreaterole', 'rolcreatedb', 'rolreplication'].every((token) => runner.includes(token)));
check('privilegios efetivos de escrita sao recusados', runner.includes('can_mutate_public') && runner.includes('INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'));
check('leitura de dados operacionais e recusada', runner.includes('can_read_operational') && runner.includes("has_table_privilege(current_user, class.oid, 'SELECT')"));
check('CREATE no schema public e recusado', runner.includes('can_create_public'));
check('inventario nao le linhas operacionais', !/FROM public\.(students|wallets|payments|recharges|meal_consumptions|offline_contingency_events)\b/i.test(inventory));
check('inventario nao contem DDL ou DML', !/^\s*(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/im.test(inventory));
check('evidencia fica confinada ao diretorio stage8a', runner.includes("'docs', 'evidence', 'stage8a'") && runner.includes("path.extname(resolved) !== '.json'"));
check('arquivo de evidencia nao pode ser sobrescrito', runner.includes("flag: 'wx'"));
check('erros nao imprimem URL ou credencial', !runner.includes('console.error(error)') && !runner.includes('console.log(rawUrl)'));

const runnerPath = path.join(root, 'scripts/audit-stage8a-readonly.cjs');
const noCredential = spawnSync(process.execPath, [runnerPath], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, STAGE8A_ALLOW_REMOTE_READONLY: 'YES', STAGE8A_DB_URL: '' },
});
check('ausencia de credencial falha antes da rede', noCredential.status !== 0 && noCredential.stderr.includes('STAGE8A_DB_URL nao configurada'));

const administrativeCredential = spawnSync(process.execPath, [runnerPath], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    STAGE8A_ALLOW_REMOTE_READONLY: 'YES',
    STAGE8A_DB_URL: 'postgresql://postgres.ltydhrmfhzhiuygqqeol:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres',
  },
});
check('credencial administrativa falha antes da rede', administrativeCredential.status !== 0 && administrativeCredential.stderr.includes('Credencial administrativa recusada'));

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) failed += 1;
}
console.log(`RESULT passed=${checks.length - failed} failed=${failed} total=${checks.length}`);
if (failed) process.exit(1);
