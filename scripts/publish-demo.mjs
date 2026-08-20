// Publishes a demo file to the private bucket.
//
//   node scripts/publish-demo.mjs syrup-room
//   node scripts/publish-demo.mjs syrup-room path\to\some-other-file.html
//
// The file stays on your machine as well. It has to, because demos are
// presented on customer sites with no network, and the copy in the bucket is
// only for the website.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadEnv, required, projectRoot } from './env.mjs'

loadEnv()

const BUCKET = 'demos'
const [slug, fileArg] = process.argv.slice(2)

if (!slug) {
  console.error('\nUsage: node scripts/publish-demo.mjs <slug> [file]\n')
  process.exit(1)
}

const file = fileArg ? join(projectRoot, fileArg) : join(projectRoot, 'demos', slug, 'index.html')

if (!existsSync(file)) {
  console.error(`\nNo such file: ${file}\n`)
  process.exit(1)
}

const html = readFileSync(file, 'utf8')
const bytes = statSync(file).size

// The one thing that must never happen to a demo file. If it reaches out to
// the network for a script or a stylesheet, it will look fine here and be
// broken on a customer site with no connectivity.
const external = [
  ...html.matchAll(/<script[^>]+src\s*=\s*["']https?:\/\/[^"']+["']/gi),
  ...html.matchAll(/<link[^>]+href\s*=\s*["']https?:\/\/[^"']+["'][^>]*rel\s*=\s*["']stylesheet/gi),
  ...html.matchAll(/<link[^>]+rel\s*=\s*["']stylesheet["'][^>]*href\s*=\s*["']https?:\/\/[^"']+["']/gi),
]

if (external.length && !process.argv.includes('--force')) {
  console.error(`\n${'!'.repeat(64)}`)
  console.error('This file loads a script or stylesheet over the network:')
  for (const match of external.slice(0, 5)) console.error(`  ${match[0].slice(0, 100)}`)
  console.error('')
  console.error('It will not work when presented on a site with no connectivity.')
  console.error('Inline it, or pass --force if you are certain.')
  console.error(`${'!'.repeat(64)}\n`)
  process.exit(1)
}

const db = createClient(required('NEXT_PUBLIC_SUPABASE_URL'), required('SUPABASE_SECRET_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
})

// The slug must be a real demo, or the route will never ask for this file.
const { data: demo, error: demoError } = await db
  .from('demos')
  .select('slug, name')
  .eq('slug', slug)
  .maybeSingle()

if (demoError) {
  console.error(`\nCould not read the demos table: ${demoError.message}\n`)
  process.exit(1)
}
if (!demo) {
  console.error(`\n'${slug}' is not in the demos table, so nothing would ever serve this file.\n`)
  process.exit(1)
}

const { data: buckets, error: listError } = await db.storage.listBuckets()
if (listError) {
  console.error(`\nCould not list buckets: ${listError.message}\n`)
  process.exit(1)
}

const existing = buckets.find((b) => b.name === BUCKET)
if (!existing) {
  const { error } = await db.storage.createBucket(BUCKET, { public: false })
  if (error) {
    console.error(`\nCould not create the ${BUCKET} bucket: ${error.message}\n`)
    process.exit(1)
  }
  console.log(`created the private bucket '${BUCKET}'`)
} else if (existing.public) {
  console.error(`\n${'!'.repeat(64)}`)
  console.error(`The '${BUCKET}' bucket is PUBLIC. Every demo in it is readable by anyone with`)
  console.error('the URL, which defeats the login. Set it to private in the Supabase dashboard,')
  console.error('under Storage, then the bucket, then Settings, before publishing.')
  console.error(`${'!'.repeat(64)}\n`)
  process.exit(1)
}

const path = `${slug}/index.html`
const { error: uploadError } = await db.storage
  .from(BUCKET)
  .upload(path, html, { contentType: 'text/html; charset=utf-8', upsert: true })

if (uploadError) {
  console.error(`\nUpload failed: ${uploadError.message}\n`)
  process.exit(1)
}

// Read it straight back and hash it. An upload that reports success can still
// have put the wrong bytes there: a stale local read, an upsert that hit a
// cached object, a truncated body. The demo is presented in front of a
// customer, so 'it said OK' is not good enough.
const sha = (buf) => createHash('sha256').update(buf).digest('hex')
const localHash = sha(readFileSync(file))

const { data: back, error: backError } = await db.storage.from(BUCKET).download(path)
if (backError) {
  console.error('')
  console.error(`Uploaded, but could not read it back to verify: ${backError.message}`)
  console.error('')
  process.exit(1)
}
const remote = Buffer.from(await back.arrayBuffer())
const remoteHash = sha(remote)

if (remoteHash !== localHash) {
  console.error('')
  console.error('!'.repeat(64))
  console.error('The bytes in the bucket do not match the file on disk.')
  console.error(`  local   ${localHash}  ${bytes.toLocaleString()} bytes`)
  console.error(`  bucket  ${remoteHash}  ${remote.length.toLocaleString()} bytes`)
  console.error('The site would serve something other than what you just tested.')
  console.error('!'.repeat(64))
  console.error('')
  process.exit(1)
}
console.log(`published ${demo.name}`)
console.log(`  from  ${file}`)
console.log(`  to    ${BUCKET}/${path}`)
console.log(`  size  ${bytes.toLocaleString()} bytes`)
console.log(`  sha   ${remoteHash}`)
console.log('  hash  local and bucket match, verified by reading the object back')
console.log(`\nIt is now served to signed in people who have a grant for '${slug}'.`)
