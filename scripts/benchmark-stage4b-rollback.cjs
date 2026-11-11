const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const root = path.resolve(__dirname, '..');
const env = fs.readFileSync(path.join(root, '.env.local'), 'utf8');
const match = env.match(/^SUPABASE_DB_URL=["']?([^"'\r\n]+)/m);

if (!match) throw new Error('SUPABASE_DB_URL nao configurada.');

const client = new Client({
  connectionString: match[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000,
  application_name: 'stage4b-benchmark',
});

async function explain(name, sql) {
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  const report = result.rows[0]['QUERY PLAN'][0];
  console.log(JSON.stringify({
    name,
    planningMs: report['Planning Time'],
    executionMs: report['Execution Time'],
    rootNode: report.Plan['Node Type'],
    actualRows: report.Plan['Actual Rows'],
    sharedHit: report.Plan['Shared Hit Blocks'],
    sharedRead: report.Plan['Shared Read Blocks'],
    localHit: report.Plan['Local Hit Blocks'],
    localRead: report.Plan['Local Read Blocks'],
    tempRead: report.Plan['Temp Read Blocks'],
    tempWritten: report.Plan['Temp Written Blocks'],
  }));
}

async function main() {
  await client.connect();
  await client.query('BEGIN');
  let runError;
  try {
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '90s'");
    await client.query(`
      CREATE TEMP TABLE stage4b_perf_meals (
        id bigint GENERATED ALWAYS AS IDENTITY,
        tenant_id uuid NOT NULL,
        unit_id integer NOT NULL,
        student_id integer NOT NULL,
        consumption_date date NOT NULL,
        consumed_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL,
        full_price numeric(12,2) NOT NULL,
        student_price numeric(12,2) NOT NULL,
        status text NOT NULL
      ) ON COMMIT DROP;

      INSERT INTO stage4b_perf_meals
        (tenant_id, unit_id, student_id, consumption_date, consumed_at, created_at,
         full_price, student_price, status)
      SELECT
        CASE WHEN series % 11 = 0
          THEN '4b000000-0000-4000-8000-000000000002'::uuid
          ELSE '4b000000-0000-4000-8000-000000000001'::uuid END,
        (series % 20)::integer,
        (series % 150000)::integer,
        current_date - (series % 365)::integer,
        now() - (series % 31536000) * interval '1 second',
        now() - (series % 31536000) * interval '1 second',
        CASE WHEN series % 5 = 0 THEN 18 ELSE 15 END,
        CASE WHEN series % 3 = 0 THEN 5 ELSE 0 END,
        CASE WHEN series % 100 = 0 THEN 'cancelled_unserved'
             WHEN series % 50 = 0 THEN 'financially_refunded'
             ELSE 'approved' END
      FROM generate_series(1, 1100000) AS series;

      CREATE INDEX stage4b_perf_tenant_created
        ON stage4b_perf_meals (tenant_id, created_at DESC);
      CREATE INDEX stage4b_perf_unit_date
        ON stage4b_perf_meals (unit_id, consumption_date);
      CREATE INDEX stage4b_perf_student_date
        ON stage4b_perf_meals (student_id, consumption_date);
      ANALYZE stage4b_perf_meals;
    `);

    const count = await client.query('SELECT count(*)::integer total FROM stage4b_perf_meals');
    console.log(`ROWS=${count.rows[0].total}`);

    await explain('period_totals_30d', `
      SELECT count(*) served, coalesce(sum(full_price),0) gross
        FROM stage4b_perf_meals
       WHERE tenant_id='4b000000-0000-4000-8000-000000000001'
         AND consumption_date BETWEEN current_date - 29 AND current_date
         AND status IN ('approved','financially_refunded')
    `);
    await explain('unit_aggregation_30d', `
      SELECT unit_id, count(*) served, sum(full_price) gross
        FROM stage4b_perf_meals
       WHERE tenant_id='4b000000-0000-4000-8000-000000000001'
         AND consumption_date BETWEEN current_date - 29 AND current_date
         AND status IN ('approved','financially_refunded')
       GROUP BY unit_id ORDER BY unit_id
    `);
    await explain('monthly_history_12m', `
      SELECT date_trunc('month', consumption_date)::date AS period_month,
             count(*) served, sum(full_price) gross
        FROM stage4b_perf_meals
       WHERE tenant_id='4b000000-0000-4000-8000-000000000001'
         AND consumption_date >= current_date - 365
         AND status IN ('approved','financially_refunded')
       GROUP BY 1 ORDER BY 1
    `);
    await explain('detail_page_50', `
      SELECT id, unit_id, student_id, consumption_date, full_price, status
        FROM stage4b_perf_meals
       WHERE tenant_id='4b000000-0000-4000-8000-000000000001'
         AND consumption_date BETWEEN current_date - 29 AND current_date
       ORDER BY created_at DESC
       LIMIT 50
    `);

    await client.query(`
      CREATE INDEX stage4b_perf_tenant_date_cover
        ON stage4b_perf_meals (tenant_id, consumption_date)
        INCLUDE (unit_id, full_price, status);
      ANALYZE stage4b_perf_meals;
    `);
    await explain('optimized_period_totals_30d', `
      SELECT count(*) served, coalesce(sum(full_price),0) gross
        FROM stage4b_perf_meals
       WHERE tenant_id='4b000000-0000-4000-8000-000000000001'
         AND consumption_date BETWEEN current_date - 29 AND current_date
         AND status IN ('approved','financially_refunded')
    `);
    await explain('optimized_unit_aggregation_30d', `
      SELECT unit_id, count(*) served, sum(full_price) gross
        FROM stage4b_perf_meals
       WHERE tenant_id='4b000000-0000-4000-8000-000000000001'
         AND consumption_date BETWEEN current_date - 29 AND current_date
         AND status IN ('approved','financially_refunded')
       GROUP BY unit_id ORDER BY unit_id
    `);
  } catch (error) {
    runError = error;
  } finally {
    try { await client.query('ROLLBACK'); } catch {}
    try { await client.end(); } catch {}
  }
  if (runError) throw runError;
}

main().catch((error) => {
  console.error(`FATAL code=${error.code || 'unknown'} message=${error.message}`);
  process.exitCode = 1;
});
