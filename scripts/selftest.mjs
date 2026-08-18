// Runs the database self tests and prints their reports.
//
//   npm run selftest
//
// Both tests deliberately end by raising an error, which rolls their whole
// transaction back. That is why nothing they create survives, and why an error
// coming back here is the expected outcome rather than a problem.

import { createClient } from '@supabase/supabase-js'
import { loadEnv, required } from './env.mjs'

const MARKER = 'SELFTEST '

async function run(db, name) {
  process.stdout.write(`\n${'='.repeat(64)}\n${name}\n${'='.repeat(64)}\n`)

  const { error } = await db.rpc(name)

  if (!error) {
    console.log('UNEXPECTED  the test returned without raising, so it did not roll itself back.')
    return false
  }

  const message = error.message ?? ''
  const at = message.indexOf(MARKER)

  if (at === -1) {
    console.log(`COULD NOT RUN  ${message}`)
    if (/does not exist|schema cache/i.test(message)) {
      console.log('\nHas supabase/schema.sql been run in the Supabase SQL editor yet?')
    }
    return false
  }

  const [rawVerdict, ...rest] = message.slice(at + MARKER.length).split('|')
  const verdict = rawVerdict.trim()
  console.log(rest.join('|').trim())
  console.log(`\nverdict: ${verdict}`)
  return verdict
}

async function main() {
  loadEnv()

  const db = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const results = []
  for (const name of ['selftest_admin_guard', 'selftest_access_functions']) {
    results.push(await run(db, name))
  }

  console.log(`\n${'='.repeat(64)}`)

  if (results.every((v) => v === 'PASS')) {
    console.log('All self tests passed. Nothing was left behind.')
    return
  }

  // Refused is not the same as failed. The guard is working, it has simply
  // decided this database has real people in it and is not a test subject.
  if (results.every((v) => v === 'REFUSED')) {
    console.log('Self tests REFUSED to run against this database. Nothing was touched.')
    console.log('This is the guard doing its job, not a failure of the code it tests.')
    process.exitCode = 2
    return
  }

  console.log('Self tests FAILED. Nothing was left behind.')
  process.exitCode = 1
}

await main()
