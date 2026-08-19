import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { normaliseEmail } from '@/lib/allowlist'
import { getUser } from '@/lib/supabase/server'

export interface Actor {
  id: string
  email: string
}

/**
 * The signed in super admin, or null.
 *
 * Re-read from the database on every single call. Never inferred from the
 * session, never from what the page happened to render, and never cached. So
 * demoting somebody takes effect on their next request rather than whenever
 * their token expires.
 */
export async function currentSuperAdmin(): Promise<Actor | null> {
  const user = await getUser()
  if (!user?.email) return null

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('allowlist')
    .select('id, email, is_super_admin, expires_at')
    .eq('email', normaliseEmail(user.email))
    .maybeSingle()

  // Fail closed. If the allowlist cannot be read, nobody is an admin.
  if (error) {
    console.error('super admin lookup failed', error.message)
    return null
  }
  if (!data || !data.is_super_admin) return null
  if (data.expires_at && new Date(data.expires_at) <= new Date()) return null

  return { id: data.id, email: data.email }
}

/**
 * Postgres error codes the admin functions raise on purpose, mapped to the
 * status a caller should see. Anything else is a genuine fault and becomes a
 * 500, because guessing at an unknown failure is how a refusal turns into a
 * silent success.
 */
const STATUS: Record<string, number> = {
  '42501': 403, // insufficient_privilege, from require_super_admin
  '23505': 409, // unique_violation, already on the list
  '23001': 409, // restrict_violation, the last super admin guard
  '23503': 404, // foreign_key_violation, no such demo
  P0002: 404, // no_data_found, no such person
}

export function forbidden(reason = 'Not a super admin.') {
  return NextResponse.json({ error: reason }, { status: 403 })
}

/**
 * Runs one of the database admin functions as this actor.
 *
 * The route handler has already checked that the caller is a super admin. The
 * function checks again, in the database, through require_super_admin. Both
 * checks are deliberate: the route handler is the gate people meet, and the
 * database one holds even if a future route forgets to call this helper.
 */
export async function callAdminRpc(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient()
  const { data, error } = await admin.rpc(fn, args)

  if (error) {
    const status = STATUS[error.code ?? ''] ?? 500
    if (status === 500) console.error(`admin rpc ${fn} failed`, error)
    return { ok: false, status, error: error.message }
  }
  return { ok: true, data }
}

/**
 * Answer a mutation in whatever shape the caller asked for.
 *
 * The admin screens post plain HTML forms, so they want a redirect back to the
 * page with something to read. A script or a curl asks for JSON and gets the
 * status code it needs to act on. Same handler, same checks, two audiences.
 */
export function respond(request: Request, result: { ok: boolean; status?: number; error?: string }, note: string) {
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json')

  if (wantsJson) {
    return result.ok
      ? NextResponse.json({ ok: true, note })
      : NextResponse.json({ error: result.error }, { status: result.status ?? 400 })
  }

  const url = new URL('/admin', request.url)
  url.searchParams.set(result.ok ? 'done' : 'failed', result.ok ? note : (result.error ?? 'Failed'))
  return NextResponse.redirect(url, 303)
}

/** Read a field from a JSON body or an HTML form body, whichever arrived. */
export async function readBody(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('content-type') ?? ''
  if (type.includes('application/json')) {
    try {
      const raw = (await request.json()) as Record<string, unknown>
      return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v ?? '')]))
    } catch {
      return {}
    }
  }
  const form = await request.formData()
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
}
