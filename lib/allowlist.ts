import { createAdminClient } from '@/lib/supabase/admin'

/** Addresses are stored lowercase, so compare lowercase. */
export function normaliseEmail(input: string): string {
  return input.trim().toLowerCase()
}

export function looksLikeEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
}

/**
 * Is this address allowed in right now?
 *
 * Checked before a sign in link is sent, and again on every attempt to open a
 * demo, so that deleting a row takes effect immediately rather than whenever
 * the person's session happens to expire.
 */
export async function isAllowed(email: string): Promise<boolean> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('allowlist')
    .select('email, expires_at')
    .eq('email', normaliseEmail(email))
    .maybeSingle()

  if (error) {
    // Fail closed. If the allowlist cannot be read, nobody gets in.
    console.error('allowlist lookup failed', error.message)
    return false
  }
  if (!data) return false

  // expires_at is null for everyone at the moment, which means never expires.
  if (data.expires_at && new Date(data.expires_at) <= new Date()) return false

  return true
}
