'use server'

import { redirect } from 'next/navigation'
import { isAllowed, looksLikeEmail, normaliseEmail } from '@/lib/allowlist'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { safeNext, siteOrigin } from '@/lib/site'

/**
 * A sign in link is only ever sent to an address already on the allowlist.
 *
 * The reply is the same either way. Someone who is not on the list is told the
 * same thing as someone who is, so this page cannot be used to work out who a
 * customer is.
 */
export async function requestLink(formData: FormData) {
  const email = normaliseEmail(String(formData.get('email') ?? ''))
  const next = safeNext(String(formData.get('next') ?? ''))
  const query = next === '/' ? '' : `&next=${encodeURIComponent(next)}`

  if (!looksLikeEmail(email)) {
    redirect(`/login?state=invalid${query}`)
  }

  if (await isAllowed(email)) {
    await ensureAuthUser(email)

    const supabase = await createClient()
    const origin = await siteOrigin()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // The allowlist is the only way in. A sign in attempt must never be
        // able to create an account by itself.
        shouldCreateUser: false,
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })

    if (error) {
      // Logged for us, never shown to the visitor, because the message would
      // give away whether the address exists.
      console.error('sign in link failed to send', error.message)
    }
  }

  redirect(`/login?state=sent${query}`)
}

/**
 * Supabase will not send a magic link to an address it has never seen, and we
 * have signup switched off. So the first time an allowlisted person signs in,
 * create their auth record first. Their place on the allowlist is what earned
 * it, not the act of asking.
 */
async function ensureAuthUser(email: string) {
  const admin = createAdminClient()
  const { error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  })

  // Already registered is the normal case on every sign in after the first.
  if (error && !/already|exists|registered/i.test(error.message)) {
    console.error('could not prepare the auth user', error.message)
  }
}
