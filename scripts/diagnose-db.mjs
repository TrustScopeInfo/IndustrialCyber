// Works out which Postgres endpoint actually accepts the credentials in
// SUPABASE_DB_URL, by trying every plausible combination and reporting what
// each one said.
//
//   npm run diagnose-db
//
// Supabase has several pooler generations and two pooler modes, and the string
// shown in the dashboard differs between projects. Rather than reason about
// which applies, this tries them and reports.
//
// The password is never printed. Its shape is described so it can be checked
// against what was typed, without its value leaving this machine.

import net from 'node:net'
import dns from 'node:dns/promises'
import pg from 'pg'
import { loadEnv } from './env.mjs'

function redact(text) {
  return String(text ?? '')
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, '[redacted]')
    .replace(/:\/\/[^:@\s]+:[^@\s]+@/g, '://[redacted]@')
}

function shape(password) {
  if (!password) return 'EMPTY'
  const kinds = []
  if (/[a-z]/.test(password)) kinds.push('lowercase')
  if (/[A-Z]/.test(password)) kinds.push('uppercase')
  if (/[0-9]/.test(password)) kinds.push('digits')
  const other = password.replace(/[a-zA-Z0-9]/g, '')
  if (other) kinds.push(`${other.length} character(s) outside letters and digits`)
  return `${password.length} characters, ${kinds.join(' + ')}`
}

async function reachable(host, port) {
  try {
    await dns.lookup(host, { family: 4 })
  } catch {
    return 'no IPv4 address'
  }
  return await new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 6000 })
    socket.on('connect', () => {
      socket.destroy()
      resolve(null)
    })
    socket.on('timeout', () => {
      socket.destroy()
      resolve('port did not answer')
    })
    socket.on('error', (e) => {
      socket.destroy()
      resolve(e.code ?? 'refused')
    })
  })
}

async function attempt({ host, port, user, password, database }) {
  const client = new pg.Client({
    host,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12_000,
  })
  try {
    await client.connect()
    const who = await client.query('select current_database() db, current_user usr, version() v')
    await client.end()
    return { ok: true, detail: `${who.rows[0].db} as ${who.rows[0].usr}` }
  } catch (error) {
    await client.end().catch(() => {})
    return { ok: false, detail: redact(error.message) }
  }
}

async function main() {
  loadEnv()

  const raw = process.env.SUPABASE_DB_URL
  if (!raw) {
    console.error('SUPABASE_DB_URL is not set in .env.local')
    process.exitCode = 1
    return
  }

  const u = new URL(raw)
  const password = decodeURIComponent(u.password)
  const database = u.pathname.replace(/^\//, '') || 'postgres'
  const givenUser = decodeURIComponent(u.username)

  // Project ref, from whichever form the string is in.
  const ref =
    u.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1] ??
    givenUser.match(/^postgres\.([a-z0-9]+)$/)?.[1] ??
    null

  console.log('what is in SUPABASE_DB_URL')
  console.log(`  host      ${u.hostname}`)
  console.log(`  port      ${u.port || '(none given)'}`)
  console.log(`  username  ${givenUser}`)
  console.log(`  database  ${database}`)
  console.log(`  password  ${shape(password)}`)
  console.log(`  ref       ${ref ?? 'could not be worked out'}`)

  if (!ref) {
    console.error('\nCannot continue without a project ref.')
    process.exitCode = 1
    return
  }

  const hosts = [
    u.hostname,
    `aws-0-eu-west-2.pooler.supabase.com`,
    `aws-1-eu-west-2.pooler.supabase.com`,
    `aws-0-eu-west-1.pooler.supabase.com`,
    `aws-1-eu-west-1.pooler.supabase.com`,
  ].filter((h, i, all) => all.indexOf(h) === i)

  console.log('\nreachability')
  const live = []
  for (const host of hosts) {
    for (const port of [5432, 6543]) {
      const problem = await reachable(host, port)
      console.log(`  ${host}:${port}  ${problem ?? 'open'}`)
      if (!problem) live.push({ host, port })
    }
  }

  if (!live.length) {
    console.error('\nNothing was reachable at all. This looks like a network problem, not a password.')
    process.exitCode = 1
    return
  }

  console.log('\nauthentication')
  const wins = []
  for (const { host, port } of live) {
    const users = host.includes('pooler') ? [`postgres.${ref}`, 'postgres'] : ['postgres']
    for (const user of users) {
      const result = await attempt({ host, port, user, password, database })
      const label = `${host}:${port} as ${user}`
      console.log(`  ${result.ok ? 'WORKS  ' : 'no     '} ${label}`)
      if (!result.ok) console.log(`          ${result.detail}`)
      else {
        console.log(`          ${result.detail}`)
        wins.push({ host, port, user })
      }
    }
  }

  console.log(`\n${'='.repeat(64)}`)
  if (wins.length) {
    const w = wins[0]
    console.log('A working combination exists:')
    console.log(`  host ${w.host}   port ${w.port}   username ${w.user}`)
    return
  }

  console.log('No combination accepted the password.')
  console.log('Every endpoint that answered rejected these credentials, which points at the')
  console.log('password itself rather than at the host, port or username format.')
  process.exitCode = 1
}

await main()
