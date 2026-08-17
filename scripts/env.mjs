import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Reads .env.local when the values are not already in the environment.
 *
 * On Vercel they are set in the dashboard and already present. On your machine
 * they live in .env.local, which Next reads by itself but a plain script does
 * not, so this fills the gap. Values are never printed.
 */
export function loadEnv() {
  const file = join(projectRoot, '.env.local')
  if (!existsSync(file)) return

  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const name = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (!process.env[name]) process.env[name] = value
  }
}

export function required(name) {
  const value = process.env[name]
  if (!value) {
    console.error(`\nMissing ${name}.`)
    console.error('Locally it belongs in .env.local, on Vercel in Settings, Environment Variables.\n')
    process.exit(1)
  }
  return value
}
