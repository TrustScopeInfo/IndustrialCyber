import { createAdminClient } from '@/lib/supabase/admin'

export const DEMO_BUCKET = 'demos'

/**
 * Fetch a demo out of the private bucket.
 *
 * The bucket is private, so this only works with the secret key, which only
 * server code holds. There is no URL anywhere that reaches the file directly,
 * signed or otherwise, so the only way to it is through the route that checks
 * who is asking.
 */
export async function fetchDemoHtml(slug: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(DEMO_BUCKET).download(`${slug}/index.html`)

  if (error || !data) {
    console.error(`could not fetch demo '${slug}' from storage`, error?.message)
    return null
  }
  return await data.text()
}
