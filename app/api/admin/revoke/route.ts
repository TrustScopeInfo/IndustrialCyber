import { type NextRequest } from 'next/server'
import { callAdminRpc, currentSuperAdmin, forbidden, readBody, respond } from '@/lib/admin'
import { normaliseEmail } from '@/lib/allowlist'
import { DEMOS } from '@/lib/demos'

/** Revoked one demo for one person. */
export async function POST(request: NextRequest) {
  const actor = await currentSuperAdmin()
  if (!actor) return forbidden()

  const body = await readBody(request)
  const email = normaliseEmail(body.email ?? '')
  const slug = (body.slug ?? '').trim()

  // A slug that is not in the catalogue would become a grant pointing at
  // nothing, which is invisible rather than broken. Refuse it here.
  if (!DEMOS.some((d) => d.slug === slug)) {
    return respond(request, { ok: false, status: 400, error: `No such demo: ${slug}` }, '')
  }

  const result = await callAdminRpc('revoke_demo', { p_actor_id: actor.id, p_email: email, p_demo_slug: slug })
  return respond(request, result, `Revoked ${slug} for ${email}`)
}
