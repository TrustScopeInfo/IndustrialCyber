// Applies supabase/schema.sql over a direct Postgres connection, then checks
// what actually landed.
//
//   npm run apply-schema
//
// This exists because pasting a 32KB file through the clipboard was silently
// truncating it, so every apply ran an older script cleanly and reported
// success. A connection has no clipboard in it.
//
// The whole file goes to the server as one simple query, which Postgres runs
// in a single implicit transaction. It either all applies or none of it does.
//
// SUPABASE_DB_URL is never printed. It is not echoed on success, and anything
// that looks like a connection string is redacted out of error messages before
// they are shown, because pg puts the target in some of them.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { loadEnv, projectRoot } from './env.mjs'

/** Strip anything shaped like user:password@host out of a string. */
function redact(text) {
  return String(text ?? '')
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[connection string redacted]')
    .replace(/:\/\/[^:@\s]+:[^@\s]+@/g, '://[credentials redacted]@')
}

async function main() {
  loadEnv()

  const url = process.env.SUPABASE_DB_URL
  if (!url) {
    console.error('\nSUPABASE_DB_URL is not set. It belongs in .env.local, which is gitignored.')
    console.error('It is only used by this script. Do not add it to Vercel.\n')
    process.exitCode = 1
    return
  }

  const file = join(projectRoot, 'supabase', 'schema.sql')
  const sql = readFileSync(file, 'utf8')
  const wanted = sql.match(/^--\s*SCHEMA VERSION:\s*(\S+)/m)?.[1]

  console.log(`applying ${file}`)
  console.log(`  ${sql.length.toLocaleString()} characters, version ${wanted ?? '(none found)'}`)

  const client = new pg.Client({
    connectionString: url,
    // Supabase requires TLS. The certificate is not verified against a local
    // trust store, which is what every Postgres client does by default against
    // Supabase, and is worth knowing rather than hiding: it protects the
    // credentials in transit but would not catch an active interceptor.
    ssl: { rejectUnauthorized: false },
    // A 32KB DDL script is not fast.
    statement_timeout: 120_000,
  })

  try {
    await client.connect()
    console.log('connected')

    await client.query(sql)
    console.log('applied without error')

    // Verify rather than assume. These are the exact things that were missing.
    const check = await client.query(`
      select
        (select version    from public.schema_meta limit 1)                        as recorded_version,
        (select applied_at from public.schema_meta limit 1)                        as applied_at,
        (select count(*)::int from pg_proc where proname = 'assert_selftest_is_safe') as gate_function,
        (to_regclass('public.schema_meta') is not null)                            as has_schema_meta,
        (to_regclass('public.keep_alive')  is not null)                            as has_keep_alive,
        (select count(*)::int from public.demos)                                   as demo_rows,
        (select count(*)::int from pg_trigger
          where tgname in ('allowlist_guard_admin_update','allowlist_guard_admin_delete')) as guard_triggers
    `)

    const row = check.rows[0]
    console.log('\nverified against the database:')
    for (const [k, v] of Object.entries(row)) console.log(`  ${k.padEnd(18)} ${v}`)

    const ok =
      row.recorded_version === wanted &&
      row.gate_function === 1 &&
      row.has_schema_meta &&
      row.has_keep_alive &&
      row.guard_triggers === 2

    if (!ok) {
      console.error('\nApplied, but the database does not look the way it should.')
      process.exitCode = 1
      return
    }
    console.log(`\nSchema ${wanted} is live.`)
  } catch (error) {
    console.error(`\nFailed: ${redact(error.message)}`)
    if (error.position) console.error(`  at character ${error.position} of the script`)
    if (error.hint) console.error(`  hint: ${redact(error.hint)}`)
    if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      console.error('\nIf this is the direct connection string, try the Session pooler one instead.')
      console.error('Supabase direct connections are IPv6 only unless the IPv4 add-on is enabled.')
    }
    process.exitCode = 1
  } finally {
    await client.end().catch(() => {})
  }
}

await main()
