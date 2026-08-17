import { headers } from 'next/headers'

/**
 * Where this request thinks it is. Works on localhost, on Vercel previews and
 * on the live domain without any of them being hardcoded.
 */
export async function siteOrigin(): Promise<string> {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/**
 * Only ever redirect to a path on this site.
 *
 * Without this, a link like /login?next=https://evil.example could send someone
 * who has just signed in straight off to somewhere else, carrying the trust of
 * having arrived from our domain. Anything that is not a plain single leading
 * slash is thrown away.
 */
export function safeNext(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback
  if (!value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (value.includes('\\')) return fallback
  return value
}
