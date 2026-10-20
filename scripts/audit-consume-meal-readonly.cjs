const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8');
const match = env.match(/^SUPABASE_DB_URL=(.+)$/m);
if (!match) throw new Error('SUPABASE_DB_URL nao configurada.');

const client = new Client({
  connectionString: match[1].trim().replace(/\?sslmode=.*/, ''),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const result = await client.query(`
      SELECT pg_get_functiondef(
        'public.consume_meal(uuid,text,uuid,text,text)'::regprocedure
      ) AS definition
    `);
    const lines = result.rows[0].definition.split(/\r?\n/);
    const firstInsertLine = lines.findIndex((line) =>
      line.includes('INSERT INTO public.wallet_transactions'),
    );
    const start = Math.max(0, firstInsertLine - 3);
    const end = Math.min(lines.length, firstInsertLine + 32);
    console.log(`Linhas da funcao remota: ${lines.length}`);
    for (let index = start; index < end; index += 1) {
      console.log(`${index + 1}: ${lines[index]}`);
    }

    const visitorResult = await client.query(`
      SELECT pg_get_functiondef(
        'public.register_visitor_entry(uuid,uuid,character varying,character varying)'::regprocedure
      ) AS definition
    `);
    const visitorLines = visitorResult.rows[0].definition.split(/\r?\n/);
    const visitorDefinition = visitorResult.rows[0].definition;
    const invalidColumnLine = visitorLines.findIndex((line) =>
      line.includes('validation_method'),
    );
    console.log(`Linhas da funcao remota de visitante: ${visitorLines.length}`);
    console.log('Contrato visitante:', {
      delegates_to_consume_meal: visitorDefinition.includes('public.consume_meal'),
      uses_invalid_validation_method: visitorDefinition.includes('validation_method'),
      marks_visitor_origin: visitorDefinition.includes("'visitor_entry'"),
    });
    if (invalidColumnLine >= 0) {
      const visitorStart = Math.max(0, invalidColumnLine - 6);
      const visitorEnd = Math.min(visitorLines.length, invalidColumnLine + 12);
      for (let index = visitorStart; index < visitorEnd; index += 1) {
        console.log(`visitor ${index + 1}: ${visitorLines[index]}`);
      }
    }

    const residue = await client.query(`
      SELECT
        (SELECT count(*)::integer
           FROM public.students
          WHERE registration_number LIKE 'HOMO-%') AS students,
        (SELECT count(*)::integer
           FROM public.cash_shifts
          WHERE terminal_id LIKE 'HOMO-S10-%') AS shifts
    `);
    console.log('Residuos de homologacao:', residue.rows[0]);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Falha na auditoria read-only: ${error.message}`);
  process.exit(1);
});
