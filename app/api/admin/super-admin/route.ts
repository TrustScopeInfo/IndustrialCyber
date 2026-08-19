import { type NextRequest } from 'next/server'
import { callAdminRpc, currentSuperAdmin, forbidden, readBody, respond } from '@/lib/admin'
import { normaliseEmail } from '@/lib/allowlist'

/**
 * Turn Super admin on or off for one person.
 *
 * Demoting the final super admin is refused in the database, so the refusal
 * holds even if this handler is bypassed.
 */
export async function POST(request: NextRequest) {
  const actor = await currentSuperAdmin()
  if (!actor) return forbidden()

  const body = await readBody(request)
  const email = normaliseEmail(body.email ?? '')
  const on = body.on === 'on' || body.on === 'true'

  const result = await callAdminRpc('set_super_admin', { p_actor_id: actor.id, p_email: email, p_on: on })
  return respond(request, result, `Super admin ${on ? 'on' : 'off'} for ${email}`)
}
