// Walks a real browser through all four states of the demo gate against a
// running server, and screenshots each one.
//
//   npm run start          (in one terminal, or npx next start -p 3100)
//   npm run walkthrough    (in another)
//
// Sign in links are minted through Supabase's admin API rather than emailed,
// which is the same token the email would carry, so the callback is exercised
// exactly as a real sign in would exercise it.
//
// The test person uses an @example.invalid address, a reserved domain that
// cannot resolve, and is deleted at the end.

import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { loadEnv, required } from './env.mjs'

const BASE = process.env.WALKTHROUGH_BASE ?? 'http://localhost:3100'
const SLUG = 'syrup-room'
const WHO = 'walkthrough@example.invalid'

loadEnv()

const db = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})

const results = []

function report(state, detail) {
  results.push({ state, ...detail })
  console.log(`\n${'-'.repeat(64)}`)
  console.log(state)
  console.log(`${'-'.repeat(64)}`)
  for (const [k, v] of Object.entries(detail)) console.log(`  ${k.padEnd(12)} ${v}`)
}

async function ownerId() {
  const { data, error } = await db
    .from('allowlist')
    .select('id, email')
    .eq('is_super_admin', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (error || !data) throw new Error(`no super admin to act as: ${error?.message ?? 'none found'}`)
  return data.id
}

async function refuseIfLive() {
  if (process.argv.includes('--force')) return
  const { data, error } = await db
    .from('allowlist')
    .select('email')
    .eq('is_super_admin', false)
    .not('email', 'like', '%@example.invalid')
  if (error) throw new Error(error.message)
  if (data.length) {
    console.error(`\nRefusing to run: ${data.length} real people are on the allowlist.`)
    console.error('This creates and deletes a person. Use a scratch project, or --force.\n')
    process.exit(1)
  }
}

async function signedInPage(browser) {
  await db.auth.admin.createUser({ email: WHO, email_confirm: true }).catch(() => {})
  const { data, error } = await db.auth.admin.generateLink({ type: 'magiclink', email: WHO })
  if (error) throw new Error(`could not mint a sign in link: ${error.message}`)

  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } })

  // Follow the sign in link with the request API rather than a page. It shares
  // the browser's cookie jar, so the session lands in the same place, and it
  // settles on a status code instead of on the page going quiet, which is not
  // a thing a page reliably does.
  const url =
    `${BASE}/auth/callback?token_hash=${encodeURIComponent(data.properties.hashed_token)}` +
    `&type=magiclink&next=%2F`
  const response = await context.request.get(url, { maxRedirects: 0 })

  const cookies = await context.cookies()
  const signedIn = cookies.some((c) => c.name.includes('auth-token'))
  if (!signedIn) {
    throw new Error(
      `sign in set no session cookie. callback returned ${response.status()} ` +
        `to ${response.headers()['location'] ?? '(nowhere)'}`,
    )
  }

  const page = await context.newPage()
  return { context, page }
}

async function probe(context, page, shot) {
  const raw = await context.request.get(`${BASE}/demos/${SLUG}`, { maxRedirects: 0 })
  const detail = {
    status: raw.status(),
    location: raw.headers()['location'] ?? '(none)',
    cacheControl: raw.headers()['cache-control'] ?? '(none)',
    bytes: (await raw.body()).length,
  }
  if (page && shot) {
    await page.goto(`${BASE}/demos/${SLUG}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForTimeout(1500) // let the mimic tick so readouts are populated
    await page.screenshot({ path: shot })
  }
  return detail
}

async function main() {
  await refuseIfLive()
  const owner = await ownerId()
  const browser = await chromium.launch()

  try {
    // 1. signed out
    const anon = await browser.newContext({ viewport: { width: 1920, height: 1080 } })
    report('1. signed out', await probe(anon, null, null))
    await anon.close()

    // 2. signed in, no grant
    await db.rpc('add_person', {
      p_actor_id: owner,
      p_email: WHO,
      p_note: 'walkthrough test',
      p_all_demos: false,
    })
    let session = await signedInPage(browser)
    report(
      '2. signed in, no grant',
      await probe(session.context, session.page, 'shots/state-2-no-grant.png'),
    )
    await session.context.close()

    // 3. signed in, granted
    await db.rpc('grant_demo', { p_actor_id: owner, p_email: WHO, p_demo_slug: SLUG })
    session = await signedInPage(browser)
    report(
      '3. signed in, granted',
      await probe(session.context, session.page, 'shots/state-3-granted.png'),
    )
    await session.context.close()

    // 4. the same grant, expired
    await db.rpc('grant_demo', {
      p_actor_id: owner,
      p_email: WHO,
      p_demo_slug: SLUG,
      p_expires_at: new Date(Date.now() - 3600_000).toISOString(),
    })
    session = await signedInPage(browser)
    report(
      '4. grant expired',
      await probe(session.context, session.page, 'shots/state-4-expired.png'),
    )
    await session.context.close()
  } finally {
    await browser.close()
    await db.rpc('remove_person', { p_actor_id: owner, p_email: WHO })
    const { data: users } = await db.auth.admin.listUsers()
    const test = users?.users?.find((u) => u.email === WHO)
    if (test) await db.auth.admin.deleteUser(test.id)
    console.log(`\ncleaned up ${WHO}`)
  }

  const expected = [
    { state: '1. signed out', status: 307 },
    { state: '2. signed in, no grant', status: 403 },
    { state: '3. signed in, granted', status: 200 },
    { state: '4. grant expired', status: 403 },
  ]
  console.log(`\n${'='.repeat(64)}`)
  let ok = true
  for (const want of expected) {
    const got = results.find((r) => r.state === want.state)
    const pass = got?.status === want.status
    if (!pass) ok = false
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${want.state}: expected ${want.status}, got ${got?.status}`)
  }
  if (!ok) process.exitCode = 1
}

await main()
