import { type EmailOtpType } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeNext } from '@/lib/site'

/**
 * Where a sign in link lands.
 *
 * Two shapes are accepted, because Supabase can send either depending on how
 * the email template is written:
 *
 *   token_hash + type   works when the link is opened on a different device to
 *                       the one that asked for it, which is what happens when
 *                       somebody requests a link on a laptop and opens the mail
 *                       on a phone. This is the one we want.
 *   code                only works in the same browser that asked.
 *
 * Either way the visitor ends up signed in, or back at the login page with an
 * honest message.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const code = searchParams.get('code')
  const next = safeNext(searchParams.get('next'))

  const supabase = await createClient()

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) return NextResponse.redirect(`${origin}${next}`)
    console.error('sign in link rejected', error.message)
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
    console.error('sign in code rejected', error.message)
  }

  return NextResponse.redirect(`${origin}/login?state=expired`)
}
