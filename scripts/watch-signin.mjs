// Watches for a sign in to actually complete.
//
//   npm run watch-signin -- someone@example.com
//
// last_sign_in_at moving proves the link was clicked and Supabase verified the
// token. It does NOT prove our application received the code and set a session,
// because Supabase stamps it before it redirects anywhere. Treat a flip as "the
// mail path works", and check the redirect target separately.
import { createClient } from '@supabase/supabase-js'
import { loadEnv, required } from './env.mjs'
loadEnv()

const email = process.argv[2]
const minutes = Number(process.argv[3] ?? 6)
if (!email) {
  console.error('\nUsage: npm run watch-signin -- <email> [minutes]\n')
  process.exit(1)
}

const admin = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const read = async () => (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email)

const start = await read()
if (!start) {
  console.error(`\nNo auth user for ${email}. Send a link first.\n`)
  process.exit(1)
}
const was = start.last_sign_in_at ?? null
console.log(`\nwatching ${email}`)
console.log(`last_sign_in_at is currently ${was ?? 'null'}`)
console.log(was ? 'waiting for it to change to something newer\n' : 'waiting for it to stop being null\n')

const until = Date.now() + minutes * 60_000
while (Date.now() < until) {
  const now = await read()
  const value = now?.last_sign_in_at ?? null
  if (value && value !== was) {
    console.log(`\nFLIPPED at ${value}`)
    process.exit(0)
  }
  console.log(`  ${new Date().toISOString().slice(11, 19)}  unchanged`)
  await sleep(15000)
}
console.log('\nNo change inside the window. The link stays valid until it expires.')
process.exit(2)
