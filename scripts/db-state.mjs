// Shows who is on the list, what each of them can open, and what has happened
// lately. Read only.
//
//   npm run db-state

import { createClient } from '@supabase/supabase-js'
import { loadEnv, required } from './env.mjs'

function table(rows, columns) {
  if (!rows.length) return '  (none)'
  const widths = columns.map((c) =>
    Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)),
  )
  const line = (cells) => '  ' + cells.map((v, i) => String(v).padEnd(widths[i])).join('  ')
  return [line(columns), line(widths.map((w) => '-'.repeat(w))), ...rows.map((r) => line(columns.map((c) => r[c] ?? '')))].join(
    '\n',
  )
}

async function main() {
  loadEnv()
  const db = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const people = await db
    .from('allowlist')
    .select('email, is_super_admin, all_demos, expires_at, note')
    .order('email')
  console.log('\nPeople')
  console.log(table(people.data ?? [], ['email', 'is_super_admin', 'all_demos', 'expires_at', 'note']))

  const access = await db
    .from('effective_demo_access')
    .select('email, demo_slug, via')
    .order('email')
  console.log('\nWho can open what')
  console.log(table(access.data ?? [], ['email', 'demo_slug', 'via']))

  const audit = await db
    .from('access_audit')
    .select('at, actor_email, action, subject_email, demo_slug')
    .order('at', { ascending: false })
    .limit(10)
  console.log('\nLast 10 access changes')
  console.log(table(audit.data ?? [], ['at', 'actor_email', 'action', 'subject_email', 'demo_slug']))

  const views = await db
    .from('demo_views')
    .select('at, demo_slug, person_id')
    .order('at', { ascending: false })
    .limit(10)
  console.log('\nLast 10 demo views')
  console.log(table(views.data ?? [], ['at', 'demo_slug', 'person_id']))

  const requests = await db
    .from('access_requests')
    .select('at, email, demo_slug, notified')
    .order('at', { ascending: false })
    .limit(10)
  console.log('\nLast 10 access requests')
  console.log(table(requests.data ?? [], ['at', 'email', 'demo_slug', 'notified']))
  console.log('')
}

await main()
