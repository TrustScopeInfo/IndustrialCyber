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

// Supabase direct connections resolve to IPv6 only unless the IPv4 add-on is
// bought. On a machine with no routable IPv6 the hostname simply does not
// resolve, and the fix is the session pooler, which is IPv4 and takes the same
// password with a different host and username.
//
// Rather than send somebody back to the dashboard for a second string, the
// pooler details are derived from the one already given. The string is parsed
// into parts and never rebuilt into text, so it cannot be logged by accident.
const POOLER_REGIONS = ['eu-west-2', 'eu-west-1']

function baseConfig(url) {
  const u = new URL(url)
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, '') || 'postgres',
    // Supabase requires TLS. The certificate is not checked against a local
    // trust store, which is what Postgres clients do against Supabase by
    // default. Worth stating rather than hiding: it protects the credentials
    // in transit but would not catch an active interceptor.
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120_000,
    connectionTimeoutMillis: 20_000,
  }
}

/**
 * Says what is wrong with a password without saying what it is.
 *
 * The commonest cause of this failure is copying the connection string out of
 * the Supabase dashboard with its [YOUR-PASSWORD] placeholder still in it.
 */
function describePassword(password) {
  const notes = []
  if (!password) {
    notes.push('it is EMPTY. The string has no password in it at all.')
    return notes
  }
  if (/your[-_ ]?password|\[|\]/i.test(password)) {
    notes.push('it still contains the dashboard PLACEHOLDER, not a real password.')
    notes.push('Supabase shows the string with [YOUR-PASSWORD] in it, to be replaced by hand.')
    return notes
  }
  notes.push(`length ${password.length}, no placeholder text, so it looks like a real password.`)
  notes.push('Most likely it predates the password reset. Copy the string again.')
  return notes
}

async function tryConnect(config, label) {
  const client = new pg.Client(config)
  try {
    await client.connect()
    console.log(`connected via ${label}`)
    return client
  } catch (error) {
    await client.end().catch(() => {})
    return { error, label }
  }
}

async function connect(url) {
  const base = baseConfig(url)
  const direct = await tryConnect(base, `direct (${base.host})`)
  if (direct instanceof pg.Client) return direct

  const unresolvable = ['ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH'].includes(
    direct.error.code,
  )
  const looksLikeSupabaseDirect = /^db\.([a-z0-9]+)\.supabase\.co$/.test(base.host)

  if (!unresolvable || !looksLikeSupabaseDirect) {
    console.error(`\nFailed: ${redact(direct.error.message)}`)
    return null
  }

  const ref = base.host.match(/^db\.([a-z0-9]+)\.supabase\.co$/)[1]
  console.log(`direct host did not resolve (${direct.error.code}), trying the session pooler`)

  for (const region of POOLER_REGIONS) {
    const attempt = await tryConnect(
      { ...base, host: `aws-0-${region}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}` },
      `session pooler, ${region}`,
    )
    if (attempt instanceof pg.Client) return attempt

    // Wrong region answers with tenant not found. Anything else is a real
    // problem worth reporting rather than retrying around.
    if (!/tenant|not found/i.test(attempt.error.message)) {
      console.error(`\nFailed on ${region}: ${redact(attempt.error.message)}`)
      if (/password authentication failed/i.test(attempt.error.message)) {
        console.error('')
        console.error(`The project was found on ${region}, so the host and username are right.`)
        console.error('Only the password was rejected. Checking its shape, not its value:')
        for (const line of describePassword(base.password)) console.error(`  ${line}`)
      }
      return null
    }
    console.log(`  not in ${region}`)
  }

  console.error('\nCould not find the project on any pooler tried.')
  console.error('Copy the Session pooler connection string from Supabase, under Connect,')
  console.error('and put that in SUPABASE_DB_URL instead.')
  return null
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

  const checkOnly = process.argv.includes('--check')

  const file = join(projectRoot, 'supabase', 'schema.sql')
  const sql = readFileSync(file, 'utf8')
  const wanted = sql.match(/^--\s*SCHEMA VERSION:\s*(\S+)/m)?.[1]

  if (checkOnly) {
    console.log('checking the connection only, nothing will be applied')
  } else {
    console.log(`applying ${file}`)
    console.log(`  ${sql.length.toLocaleString()} characters, version ${wanted ?? '(none found)'}`)
  }

  const client = await connect(url)
  if (!client) {
    process.exitCode = 1
    return
  }

  if (checkOnly) {
    const who = await client.query('select current_database() as db, current_user as who')
    console.log(`  database ${who.rows[0].db}, connected as ${who.rows[0].who}`)
    console.log('\nConnection works. Run npm run apply-schema to apply.')
    await client.end().catch(() => {})
    return
  }

  try {

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
