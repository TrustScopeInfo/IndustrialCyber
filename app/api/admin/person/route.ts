import { type NextRequest } from 'next/server'
import { callAdminRpc, currentSuperAdmin, forbidden, readBody, respond } from '@/lib/admin'
import { looksLikeEmail, normaliseEmail } from '@/lib/allowlist'

/**
 * Add a person to the allowlist.
 *
 * Expiry is a second call because add_person does not take one. Both write
 * their own audit row, so a person added with an expiry leaves two entries and
 * that is correct: they are two decisions.
 */
export async function POST(request: NextRequest) {
  const actor = await currentSuperAdmin()
  if (!actor) return forbidden()

  const body = await readBody(request)
  const email = normaliseEmail(body.email ?? '')
  if (!looksLikeEmail(email)) {
    return respond(request, { ok: false, status: 400, error: `Not an email address: ${email}` }, '')
  }

  const added = await callAdminRpc('add_person', {
    p_actor_id: actor.id,
    p_email: email,
    p_note: body.note?.trim() || null,
    p_all_demos: body.all_demos === 'on' || body.all_demos === 'true',
  })
  if (!added.ok) return respond(request, added, '')

  if (body.expires_at?.trim()) {
    const when = new Date(body.expires_at)
    if (Number.isNaN(when.getTime())) {
      return respond(request, { ok: false, status: 400, error: 'Could not read that expiry date.' }, '')
    }
    const dated = await callAdminRpc('set_person_expiry', {
      p_actor_id: actor.id,
      p_email: email,
      p_expires_at: when.toISOString(),
    })
    if (!dated.ok) return respond(request, dated, '')
  }

  return respond(request, { ok: true }, `Added ${email}`)
}
