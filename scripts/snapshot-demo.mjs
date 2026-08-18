// Takes a timestamped copy of a demo file, outside the project.
//
//   npm run snapshot-demo syrup-room
//
// Demos are gitignored on purpose, so they have no history and no undo. This
// is the undo. Snapshots go to industrialcyber-backup next to the project, not
// into it, so they cannot be swept into a commit.

import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { projectRoot } from './env.mjs'

const BACKUP = join(dirname(projectRoot), 'industrialcyber-backup', 'demos')

const slug = process.argv[2] ?? 'syrup-room'
const source = join(projectRoot, 'demos', slug, 'index.html')

if (!existsSync(source)) {
  console.error(`\nNo such demo: ${source}\n`)
  process.exitCode = 1
} else {
  mkdirSync(BACKUP, { recursive: true })
  const now = new Date()
  const stamp =
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '-' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')

  const target = join(BACKUP, `${slug}-${stamp}.html`)
  copyFileSync(source, target)

  const kept = readdirSync(BACKUP).filter((f) => f.startsWith(slug + '-'))
  console.log(`snapshot ${target}`)
  console.log(`  ${statSync(target).size.toLocaleString()} bytes, ${kept.length} snapshot(s) of ${slug} kept`)
}
