import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Stops the Supabase project going to sleep.
 *
 * The free tier pauses a project after seven days without activity, and a
 * paused project means nobody can sign in, which would be discovered in front
 * of a customer. A Vercel cron calls this once a day and it writes one row.
 *
 * It refuses to run without CRON_SECRET rather than defaulting to open. An
 * unauthenticated endpoint that writes to the database is not worth the
 * convenience, and a keep alive that quietly never ran is worse than one that
 * fails loudly on the first day.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET

  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not set, so this endpoint refuses to run.' },
      { status: 503 },
    )
  }

  // Vercel sends this header automatically once CRON_SECRET exists.
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('keep_alive')
    .update({ at: new Date().toISOString() })
    .eq('id', 1)

  if (error) {
    console.error('keep alive failed', error.message)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString() })
}
