import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_SECRET_KEY, SUPABASE_URL } from '@/lib/env'

/**
 * Supabase client holding the secret key.
 *
 * This bypasses every row level security rule in the project, so it must never
 * reach the browser. Nothing in this file may be imported by a client
 * component. The guard below turns a mistake into a loud crash rather than a
 * quiet leak.
 */
export function createAdminClient() {
  if (typeof window !== 'undefined') {
    throw new Error('The Supabase admin client was imported into browser code. It must not be.')
  }

  return createSupabaseClient(SUPABASE_URL(), SUPABASE_SECRET_KEY(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
