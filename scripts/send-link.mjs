// Sends a real sign in link, with an explicit redirect target.
//
//   npm run send-link -- someone@example.com                 (live site)
//   npm run send-link -- someone@example.com local           (localhost:3200)
//   npm run send-link -- someone@example.com https://host    (anywhere else)
//
// Why this script exists.
//
// A magic link points at Supabase's own /auth/v1/verify, not at us. Clicking it
// verifies the token and stamps last_sign_in_at at Supabase, and only then does
// Supabase redirect to redirect_to. So a link can be clicked, and the timestamp
// can move, while our application never sees anything. The redirect target is
// the part that decides whether a session lands in this project.
//
// That target must be passed explicitly on every call. Left out, Supabase falls
// back to the project's Site URL, which was http://localhost:3000. Another
// project of the owner's was serving that port and swallowed a sign in.
//
// It must also be passed the way the wire expects. GoTrue reads redirect_to
// from the QUERY STRING. Putting it in the JSON body, which looks reasonable,
// is silently ignored and you get the Site URL fallback with no error. The
// supabase-js client puts it in the right place, so this script uses the client
// rather than hand rolling the request. See auth-js/lib/fetch.js, where
// options.redirectTo becomes qs.redirect_to.

import { createClient } from '@supabase/supabase-js'
import { loadEnv, required } from './env.mjs'

loadEnv()

const LIVE = 'https://industrialcyber.co.uk'
const LOCAL = 'http://localhost:3200'

const [email, whereArg, nextArg] = process.argv.slice(2)

if (!email) {
  console.error(`
Usage: npm run send-link -- <email> [live|local|https://host] [next path]

  npm run send-link -- someone@example.com
  npm run send-link -- someone@example.com local
  npm run send-link -- someone@example.com local /admin
`)
  process.exit(1)
}

const base = !whereArg || whereArg === 'live' ? LIVE : whereArg === 'local' ? LOCAL : whereArg.replace(/\/$/, '')
// Git Bash on Windows rewrites a bare / argument into a Windows path before
// the script ever sees it, so "/" arrives as C:/Program Files/Git/. Anything
// that is not a plain site relative path is not worth guessing at.
let next = nextArg ?? '/'
if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) {
  console.warn(`ignoring next=${next}, it is not a site relative path, using /`)
  next = '/'
}
const redirectTo = `${base}/auth/callback?next=${encodeURIComponent(next)}`

const url = required('NEXT_PUBLIC_SUPABASE_URL')
const anon = createClient(url, required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})
const admin = createClient(url, required('SUPABASE_SECRET_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Only ever to somebody already on the allowlist. The same rule the login page
// follows, restated here so a script cannot quietly go around it.
const { data: person, error: listError } = await admin
  .from('allowlist')
  .select('email, expires_at')
  .eq('email', email.trim().toLowerCase())
  .maybeSingle()

if (listError) {
  console.error(`Could not read the allowlist: ${listError.message}`)
  process.exit(1)
}
if (!person) {
  console.error(`\n${email} is not on the allowlist, so no link will be sent.`)
  console.error(`Add them first:  npm run person -- add ${email}\n`)
  process.exit(1)
}
if (person.expires_at && new Date(person.expires_at) <= new Date()) {
  console.error(`\n${email} expired on ${person.expires_at}. Clear the expiry before sending.\n`)
  process.exit(1)
}

// Supabase will not mail an address it has never seen and signup is off, so the
// auth record has to exist first. The login action does the same thing.
const created = await admin.auth.admin.createUser({ email, email_confirm: true })
if (created.error && !/already|exists|registered/i.test(created.error.message)) {
  console.error(`Could not prepare the auth user: ${created.error.message}`)
  process.exit(1)
}

console.log(`\nto         ${email}`)
console.log(`redirectTo ${redirectTo}`)

const before = (await admin.auth.admin.listUsers()).data.users.find((u) => u.email === email)
console.log(`last_sign_in_at before  ${before?.last_sign_in_at ?? 'null'}`)

const { error } = await anon.auth.signInWithOtp({
  email,
  options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
})

if (error) {
  console.error(`\nFAILED  ${error.status ?? ''} ${error.message}`)
  if (/rate|429/i.test(`${error.status} ${error.message}`)) {
    console.error('That is the per address rate limit. Wait past sixty seconds and run it again.')
  }
  process.exit(1)
}

console.log(`\nSENT at ${new Date().toISOString()}`)
console.log('Clicking it stamps last_sign_in_at at Supabase, then redirects to the target above.')
console.log(`Watch the session actually land:  npm run watch-signin -- ${email}\n`)
