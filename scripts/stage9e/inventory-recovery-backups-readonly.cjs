const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const envPath = path.join(root, '.env.local');
const projectRefPath = path.join(root, 'supabase', '.temp', 'project-ref');
const evidencePath = path.join(root, 'docs', 'evidence', 'stage9e', 'stage9e1a-backups-inventory.json');

function fail(message) {
  throw new Error(message);
}

function envValue(name) {
  const source = fs.readFileSync(envPath, 'utf8');
  const match = source.match(new RegExp(`^${name}=["']?([^"'\\r\\n]+)["']?$`, 'm'));
  return match?.[1]?.trim() || null;
}

function unixToIso(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return new Date(number * 1000).toISOString();
}

async function main() {
  if (process.env.STAGE9E1_ALLOW_BACKUPS_READ !== 'YES') {
    fail('Janela de leitura de backups nao habilitada explicitamente.');
  }

  const token = envValue('SUPABASE_ACCESS_TOKEN');
  if (!token) fail('SUPABASE_ACCESS_TOKEN ausente.');
  if (!token.startsWith('sbp_fc')) fail('Somente token fine-grained sbp_fc e aceito.');

  const projectRef = fs.readFileSync(projectRefPath, 'utf8').trim();
  if (!/^[a-z0-9]{20}$/.test(projectRef)) fail('Project ref local invalido.');

  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/backups`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      'user-agent': 'ma-refeicoes-stage9e1-readonly',
    },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const safeStatus = `${response.status} ${response.statusText}`.trim();
    fail(`Management API recusou a leitura: ${safeStatus}.`);
  }

  const payload = await response.json();
  const backups = Array.isArray(payload.backups) ? payload.backups : [];
  const timestamps = backups
    .map((backup) => backup.inserted_at)
    .filter((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)))
    .sort();

  const sanitized = {
    stage: '9E.1-A',
    collectedAt: new Date().toISOString(),
    source: 'supabase_management_api_backups_read',
    request: { method: 'GET', mutationsPerformed: 0 },
    region: typeof payload.region === 'string' ? payload.region : null,
    walgEnabled: payload.walg_enabled === true,
    pitrEnabled: payload.pitr_enabled === true,
    backups: {
      count: backups.length,
      completed: backups.filter((backup) => backup.status === 'COMPLETED').length,
      physical: backups.filter((backup) => backup.is_physical_backup === true).length,
      oldestTimestamp: timestamps.at(0) || null,
      newestTimestamp: timestamps.at(-1) || null,
      statuses: [...new Set(backups.map((backup) => backup.status).filter(Boolean))].sort(),
    },
    physicalWindow: {
      earliest: unixToIso(payload.physical_backup_data?.earliest_physical_backup_date_unix),
      latest: unixToIso(payload.physical_backup_data?.latest_physical_backup_date_unix),
    },
    tokenPersisted: false,
    backupIdsPersisted: false,
    projectRefPersisted: false,
  };

  fs.writeFileSync(evidencePath, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 });
  console.log('STAGE9E1_BACKUPS_INVENTORY_WRITTEN docs/evidence/stage9e/stage9e1a-backups-inventory.json');
}

main().catch((error) => {
  console.error(`STAGE9E1_BACKUPS_ABORTED ${error.message}`);
  process.exitCode = 1;
});

