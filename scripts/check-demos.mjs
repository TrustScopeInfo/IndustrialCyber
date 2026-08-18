// Refuses to build when the two lists of demos disagree.
//
// Demos are named in two places: lib/demos.ts, which decides what the launcher
// shows, and the demos table, which grants point at. If a slug exists in one
// and not the other, grants quietly point at nothing, or a demo appears with no
// way to grant it, and neither failure looks like what it is. So the build
// stops here instead.
//
// Set SKIP_DB_CHECKS=1 to get past it, for the case where Supabase
// is unreachable and you need to ship anyway.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadEnv, projectRoot } from './env.mjs'

function fail(...lines) {
  console.error(`\n${'!'.repeat(64)}`)
  for (const line of lines) console.error(line)
  console.error(`${'!'.repeat(64)}\n`)
  process.exitCode = 1
}

async function main() {
  if (process.env.SKIP_DB_CHECKS === '1') {
    console.log('database checks skipped by SKIP_DB_CHECKS=1')
    return
  }

  loadEnv()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY

  if (!url || !key) {
    return fail(
      'Cannot check the demo catalogue because the Supabase settings are missing.',
      'Locally they belong in .env.local, on Vercel in Settings, Environment Variables.',
    )
  }

  // The catalogue is TypeScript, and this script runs as plain Node during the
  // build, so the slugs are read out of the source. If that ever stops matching
  // the file, the count check below turns it into a loud failure rather than a
  // silent pass.
  const source = readFileSync(join(projectRoot, 'lib', 'demos.ts'), 'utf8')
  const inCode = [...source.matchAll(/^\s*slug:\s*'([a-z0-9-]+)',/gm)].map((m) => m[1])

  if (inCode.length === 0) {
    return fail(
      'Found no demo slugs in lib/demos.ts.',
      'Either the file is empty or this script can no longer read it.',
      'Fix the script before trusting a pass.',
    )
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  // Is the database running the schema this code was written against? Pasting
  // a stale copy into the SQL editor looks like success and behaves like a
  // subtle bug, so it is checked rather than trusted.
  const schemaFile = readFileSync(join(projectRoot, 'supabase', 'schema.sql'), 'utf8')
  const wanted = schemaFile.match(/^--\s*SCHEMA VERSION:\s*(\S+)/m)?.[1]

  if (!wanted) {
    return fail(
      'No SCHEMA VERSION line found in supabase/schema.sql.',
      'Fix the file or this check before trusting a pass.',
    )
  }

  const meta = await db.from('schema_meta').select('version, applied_at').maybeSingle()

  if (meta.error) {
    return fail(
      `Could not read schema_meta: ${meta.error.message}`,
      `The database has not had supabase/schema.sql version ${wanted} applied.`,
      'Paste the whole of supabase/schema.sql into the Supabase SQL editor and run it.',
    )
  }

  if (meta.data?.version !== wanted) {
    return fail(
      'The database is running an older schema than this code expects.',
      `  database: ${meta.data?.version ?? '(none recorded)'}`,
      `  code:     ${wanted}`,
      '',
      'Paste the whole of supabase/schema.sql into the Supabase SQL editor and run it.',
    )
  }

  console.log(`schema version ${wanted}, applied ${meta.data.applied_at}`)

  const { data, error } = await db.from('demos').select('slug')

  if (error) {
    return fail(
      `Could not read the demos table: ${error.message}`,
      'Has supabase/schema.sql been run in the Supabase SQL editor?',
      'If Supabase is simply down, SKIP_DB_CHECKS=1 will get you past it.',
    )
  }

  const inDb = data.map((row) => row.slug)
  const missingFromDb = inCode.filter((slug) => !inDb.includes(slug))
  const missingFromCode = inDb.filter((slug) => !inCode.includes(slug))

  if (missingFromDb.length || missingFromCode.length) {
    const lines = ['The two lists of demos disagree.', '']
    if (missingFromDb.length) {
      lines.push(`In lib/demos.ts but not in the demos table: ${missingFromDb.join(', ')}`)
      lines.push('Fix with:')
      for (const slug of missingFromDb) {
        lines.push(`  insert into public.demos (slug, name) values ('${slug}', '<name>');`)
      }
    }
    if (missingFromCode.length) {
      lines.push(`In the demos table but not in lib/demos.ts: ${missingFromCode.join(', ')}`)
      lines.push('Either add it to the catalogue, or remove the row:')
      for (const slug of missingFromCode) {
        lines.push(`  delete from public.demos where slug = '${slug}';`)
      }
    }
    return fail(...lines)
  }

  console.log(`demo catalogue agrees on all ${inCode.length}: ${inCode.join(', ')}`)
}

await main()
