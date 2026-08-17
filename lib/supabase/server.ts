import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { unstable_rethrow } from 'next/navigation'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/lib/env'

/**
 * Supabase client for server components, server actions and route handlers.
 *
 * Uses the publishable key, so it is bound by row level security and can only
 * ever see what the signed in visitor is allowed to see.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(SUPABASE_URL(), SUPABASE_PUBLISHABLE_KEY(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server components cannot set cookies. The middleware refreshes the
          // session on every request, so this is safe to ignore.
        }
      },
    },
  })
}

/**
 * The signed in user, or null. Always use this rather than reading the session
 * from a cookie, because it verifies the token with Supabase instead of
 * trusting whatever the browser sent.
 */
export async function getUser() {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return user
  } catch (error) {
    // Next signals things like "this page must be rendered dynamically" by
    // throwing. Those are control flow, not failures, and must be passed on
    // untouched or the framework loses track of what it is rendering.
    unstable_rethrow(error)

    // Treat any real failure as nobody being signed in. The launcher is the public
    // shop window and must stay up even if Supabase is unreachable or the free
    // tier project has paused, and every gated route reads a null user as a
    // reason to send the visitor to the login page rather than let them in.
    console.error('could not read the session', error)
    return null
  }
}
