// Applies supabase/schema.sql using the Supabase secret key instead of the
// database password, for when the pooler will not accept the password and the
// direct connection is unreachable.
//
//   npm run apply-via-rpc
//
// It needs one small helper function to exist in the database first. The script
// checks, and prints exactly what to type if it is missing. That helper is four
// short lines, which is the point: it can be typed by hand, so it does not
// depend on a clipboard that has already been caught truncating.
//
// The helper can run arbitrary SQL, so it is granted only to service_role and
// removed again as soon as the schema is applied. Anyone holding the secret key
// can already read and write every row; this additionally lets them change the
// shape of the database, which is why it does not stay.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadEnv, required, projectRoot } from './env.mjs'

const BOOTSTRAP = `create function public.exec_sql(sql text) returns void
language plpgsql security definer as $$ begin execute sql; end $$;
revoke execute on function public.exec_sql(text) from public;
grant execute on function public.exec_sql(text) to service_role;`

function explainMissingHelper() {
  console.error(`\n${'='.repeat(72)}`)
  console.error('The helper function is not there yet. Type these four lines into the')
  console.error('Supabase SQL editor and run them, then run this command again.')
  console.error('')
  console.error('Type them rather than pasting. They are short on purpose.')
  console.error(`${'='.repeat(72)}\n`)
  console.error(BOOTSTRAP)
  console.error('')
}

async function main() {
  loadEnv()

  const db = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Is the helper there?
  const probe = await db.rpc('exec_sql', { sql: 'select 1' })
  if (probe.error) {
    if (/could not find|schema cache|does not exist/i.test(probe.error.message)) {
      explainMissingHelper()
    } else {
      console.error(`\nThe helper is there but refused: ${probe.error.message}\n`)
    }
    process.exitCode = 1
    return
  }
  console.log('helper found')

  const file = join(projectRoot, 'supabase', 'schema.sql')
  const sql = readFileSync(file, 'utf8')
  const wanted = sql.match(/^--\s*SCHEMA VERSION:\s*(\S+)/m)?.[1]

  console.log(`applying ${file}`)
  console.log(`  ${sql.length.toLocaleString()} characters, version ${wanted ?? '(none found)'}`)

  const applied = await db.rpc('exec_sql', { sql })
  if (applied.error) {
    console.error(`\nFailed: ${applied.error.message}`)
    if (applied.error.details) console.error(`  ${applied.error.details}`)
    if (applied.error.hint) console.error(`  hint: ${applied.error.hint}`)
    process.exitCode = 1
    return
  }
  console.log('applied without error')

  // Verify against the database rather than trusting the apply, which is the
  // whole reason this file exists.
  const meta = await db.from('schema_meta').select('version, applied_at').maybeSingle()
  const demos = await db.from('demos').select('slug')
  const gate = await db.rpc('assert_selftest_is_safe')

  console.log('\nverified against the database:')
  console.log(`  recorded_version   ${meta.data?.version ?? '(none)'}`)
  console.log(`  applied_at         ${meta.data?.applied_at ?? '(none)'}`)
  console.log(`  demo_rows          ${demos.data?.length ?? 0}`)
  console.log(
    `  gate function      ${gate.error && /could not find|schema cache/i.test(gate.error.message) ? 'MISSING' : 'present'}`,
  )

  const ok = meta.data?.version === wanted && (demos.data?.length ?? 0) === 4

  // Take the helper away again whether or not it worked, so an arbitrary SQL
  // endpoint does not outlive the job it was created for.
  const removed = await db.rpc('exec_sql', { sql: 'drop function if exists public.exec_sql(text)' })
  if (removed.error) {
    console.log('\nCould not remove the helper automatically. Run this one line in the')
    console.log('Supabase SQL editor, so it does not stay behind:')
    console.log('\n  drop function if exists public.exec_sql(text);\n')
  } else {
    console.log('\nhelper removed')
  }

  if (!ok) {
    console.error('Applied, but the database does not look the way it should.')
    process.exitCode = 1
    return
  }
  console.log(`Schema ${wanted} is live.`)
}

await main()
