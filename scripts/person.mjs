// Manage access from the command line, until the admin screen exists.
//
//   npm run person -- add    someone@example.com "Fortinet, met in Leeds"
//   npm run person -- grant  someone@example.com syrup-room
//   npm run person -- grant  someone@example.com syrup-room 2026-12-31
//   npm run person -- revoke someone@example.com syrup-room
//   npm run person -- remove someone@example.com
//   npm run person -- all-demos someone@example.com on
//
// Every one of these goes through the database functions, so the change and
// its audit row happen together and neither can happen without the other.
// Nothing here sends email; adding somebody is silent until pass 4.

import { createClient } from '@supabase/supabase-js'
import { loadEnv, required } from './env.mjs'

const USAGE = `
Usage:
  npm run person -- add        <email> [note]
  npm run person -- remove     <email>
  npm run person -- grant      <email> <demo-slug> [expires YYYY-MM-DD]
  npm run person -- revoke     <email> <demo-slug>
  npm run person -- all-demos  <email> <on|off>
  npm run person -- admin      <email> <on|off>
`

async function main() {
  loadEnv()
  const db = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const [action, email, third, fourth] = process.argv.slice(2)
  if (!action || !email) {
    console.log(USAGE)
    process.exitCode = 1
    return
  }

  // Act as the oldest super admin, which is the owner unless that has changed.
  const { data: actor, error: actorError } = await db
    .from('allowlist')
    .select('id, email')
    .eq('is_super_admin', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()

  if (actorError || !actor) {
    console.error(`No super admin to act as: ${actorError?.message ?? 'none found'}`)
    process.exitCode = 1
    return
  }

  const calls = {
    add: ['add_person', { p_actor_id: actor.id, p_email: email, p_note: third ?? null, p_all_demos: false }],
    remove: ['remove_person', { p_actor_id: actor.id, p_email: email }],
    grant: [
      'grant_demo',
      {
        p_actor_id: actor.id,
        p_email: email,
        p_demo_slug: third,
        p_expires_at: fourth ? new Date(fourth).toISOString() : null,
      },
    ],
    revoke: ['revoke_demo', { p_actor_id: actor.id, p_email: email, p_demo_slug: third }],
    'all-demos': ['set_all_demos', { p_actor_id: actor.id, p_email: email, p_on: third === 'on' }],
    admin: ['set_super_admin', { p_actor_id: actor.id, p_email: email, p_on: third === 'on' }],
  }

  const call = calls[action]
  if (!call) {
    console.log(USAGE)
    process.exitCode = 1
    return
  }
  if ((action === 'grant' || action === 'revoke') && !third) {
    console.error('Which demo? Pass a slug, for example syrup-room.')
    process.exitCode = 1
    return
  }

  const [fn, args] = call
  const { error } = await db.rpc(fn, args)

  if (error) {
    console.error(`\n${action} failed: ${error.message}\n`)
    process.exitCode = 1
    return
  }

  console.log(`${action} ${email}${third && action !== 'add' ? ` ${third}` : ''}, done as ${actor.email}`)
}

await main()
