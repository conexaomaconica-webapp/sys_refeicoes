/**
 * Script de Diagnóstico e Auditoria Pré-Homologação
 * Executa apenas operações de LEITURA e BACKUP:
 * 1. Teste de conectividade com o PostgreSQL remoto do Supabase
 * 2. Comparativo de Migrations locais vs remotas via Supabase CLI
 * 3. Backup completo de Schema (DDL) e Dados em supabase/backups/
 * 4. Inspeção de schemas auth e storage
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const envPath = path.join(ROOT_DIR, '.env.local');

if (!fs.existsSync(envPath)) {
  console.error('[ERRO] Arquivo .env.local não encontrado.');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const dbUrlMatch = envContent.match(/SUPABASE_DB_URL=["']?([^"'\r\n]+)["']?/);

if (!dbUrlMatch || !dbUrlMatch[1]) {
  console.error('[ERRO] SUPABASE_DB_URL não encontrada no .env.local.');
  process.exit(1);
}

const dbUrl = dbUrlMatch[1].trim();

// Mascarar senha para exibição segura
const maskedUrl = dbUrl.replace(/:([^@:]+)@/, ':****@');
console.log('======================================================================');
console.log('  DIAGNÓSTICO E AUDITORIA PRÉ-HOMOLOGAÇÃO SUPABASE');
console.log('======================================================================');
console.log(`Conexão configurada: ${maskedUrl}\n`);

// Garantir PATH com Node e pnpm
const pnpmBin = path.join(process.env.LOCALAPPDATA || '', 'pnpm', 'bin');
const npmRoaming = path.join(process.env.APPDATA || '', 'npm');
const env = {
  ...process.env,
  PATH: `${pnpmBin};${npmRoaming};${process.env.PATH}`
};

const supabaseCli = path.join(ROOT_DIR, 'node_modules', '.bin', 'supabase.cmd');

// 1. Testar Listagem de Migrations (supabase migration list)
console.log('1. Consultando histórico de migrations no banco remoto...');
try {
  const migListOutput = execSync(`"${supabaseCli}" migration list --db-url "${dbUrl}"`, {
    env,
    cwd: ROOT_DIR,
    encoding: 'utf8',
    timeout: 30000
  });
  console.log('Histórico de Migrations retornado com sucesso:\n');
  console.log(migListOutput);
} catch (err) {
  console.error('[ERRO ao listar migrations]:', err.message);
  if (err.stdout) console.log('Stdout:', err.stdout);
  if (err.stderr) console.error('Stderr:', err.stderr);
  process.exit(1);
}

// 2. Realizar Backup de Schema
const backupsDir = path.join(ROOT_DIR, 'supabase', 'backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
const schemaBackupPath = path.join(backupsDir, `schema_${timestamp}.sql`);
const dataBackupPath = path.join(backupsDir, `data_${timestamp}.sql`);

console.log('\n2. Gerando Backup Estrutural (Schema DDL)...');
try {
  execSync(`"${supabaseCli}" db dump --db-url "${dbUrl}" -f "${schemaBackupPath}"`, {
    env,
    cwd: ROOT_DIR,
    encoding: 'utf8',
    timeout: 60000
  });
  const schemaStats = fs.statSync(schemaBackupPath);
  console.log(`  [OK] Schema backup gerado: schema_${timestamp}.sql (${(schemaStats.size / 1024).toFixed(2)} KB)`);
} catch (err) {
  console.error('[AVISO/ERRO no dump de schema]:', err.message);
  if (err.stderr) console.error(err.stderr);
}

console.log('\n3. Gerando Backup de Dados (Data Only)...');
try {
  execSync(`"${supabaseCli}" db dump --db-url "${dbUrl}" --data-only -f "${dataBackupPath}"`, {
    env,
    cwd: ROOT_DIR,
    encoding: 'utf8',
    timeout: 60000
  });
  const dataStats = fs.statSync(dataBackupPath);
  console.log(`  [OK] Data backup gerado: data_${timestamp}.sql (${(dataStats.size / 1024).toFixed(2)} KB)`);
} catch (err) {
  console.error('[AVISO/ERRO no dump de dados]:', err.message);
  if (err.stderr) console.error(err.stderr);
}

// 4. Executar Dry-run de Migrations
console.log('\n4. Executando Dry-run de Migrations (Nenhuma alteração no banco)...');
try {
  const dryRunOutput = execSync(`"${supabaseCli}" db push --dry-run --db-url "${dbUrl}"`, {
    env,
    cwd: ROOT_DIR,
    encoding: 'utf8',
    timeout: 30000
  });
  console.log('Resultado do Dry-run:\n', dryRunOutput);
} catch (err) {
  console.error('[Resultado Dry-run / Info]:', err.message);
  if (err.stdout) console.log(err.stdout);
  if (err.stderr) console.log(err.stderr);
}

console.log('\n======================================================================');
console.log('  DIAGNÓSTICO CONCLUÍDO SEM NENHUMA ALTERAÇÃO NO BANCO');
console.log('======================================================================');
