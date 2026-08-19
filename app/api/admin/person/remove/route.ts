import { type NextRequest } from 'next/server'
import { callAdminRpc, currentSuperAdmin, forbidden, readBody, respond } from '@/lib/admin'
import { normaliseEmail } from '@/lib/allowlist'

/**
 * Remove a person.
 *
 * Removing the last super admin is refused by a trigger in the database, not
 * here, so the refusal holds however the row is deleted.
 */
export async function POST(request: NextRequest) {
  const actor = await currentSuperAdmin()
  if (!actor) return forbidden()

  const email = normaliseEmail((await readBody(request)).email ?? '')
  const result = await callAdminRpc('remove_person', { p_actor_id: actor.id, p_email: email })
  return respond(request, result, `Removed ${email}`)
}
