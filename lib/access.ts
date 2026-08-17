import { createAdminClient } from '@/lib/supabase/admin'
import { normaliseEmail } from '@/lib/allowlist'

export interface Person {
  id: string
  email: string
  is_super_admin: boolean
}

/** The allowlist row for this address, or null. */
export async function findPerson(email: string): Promise<Person | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('allowlist')
    .select('id, email, is_super_admin')
    .eq('email', normaliseEmail(email))
    .maybeSingle()

  if (error) {
    console.error('could not look up person', error.message)
    return null
  }
  return data ?? null
}

/**
 * Which demos this address may open, right now.
 *
 * Read from the effective_demo_access view, so it already accounts for a super
 * admin seeing everything, the all_demos flag, individual grants, and both
 * kinds of expiry. Empty on any failure, which locks people out rather than
 * letting them in.
 */
export async function accessibleSlugs(email: string): Promise<string[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('effective_demo_access')
    .select('demo_slug')
    .eq('email', normaliseEmail(email))

  if (error) {
    console.error('could not read effective access', error.message)
    return []
  }
  return (data ?? []).map((row) => row.demo_slug as string)
}

/** May this address open this one demo, right now. */
export async function canOpenDemo(email: string, slug: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('effective_demo_access')
    .select('demo_slug')
    .eq('email', normaliseEmail(email))
    .eq('demo_slug', slug)
    .maybeSingle()

  if (error) {
    console.error('could not check demo access', error.message)
    return false
  }
  return Boolean(data)
}

/**
 * Record that somebody opened a demo.
 *
 * Never allowed to break the demo opening. A lost line in the view log is a
 * nuisance; a customer watching the screen fail is not.
 */
export async function logDemoView(personId: string, slug: string): Promise<void> {
  try {
    const admin = createAdminClient()
    const { error } = await admin.rpc('log_demo_view', {
      p_person_id: personId,
      p_demo_slug: slug,
    })
    if (error) console.error('could not log the demo view', error.message)
  } catch (error) {
    console.error('could not log the demo view', error)
  }
}

/** Somebody signed in asked for a demo they cannot see. Recorded first, emailed second. */
export async function recordAccessRequest(
  person: Person | null,
  email: string,
  slug: string,
): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.from('access_requests').insert({
    person_id: person?.id ?? null,
    email: normaliseEmail(email),
    demo_slug: slug,
  })
  if (error) console.error('could not record the access request', error.message)
}
