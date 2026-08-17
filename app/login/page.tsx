import Link from 'next/link'
import { SiteFooter, SiteHeader } from '@/app/_components/chrome'
import { getUser } from '@/lib/supabase/server'
import { safeNext } from '@/lib/site'
import { requestLink } from './actions'

export const metadata = {
  title: 'Sign in — IndustrialCyber',
  robots: { index: false, follow: false },
}

// Reads cookies, so it must never be cached.
export const dynamic = 'force-dynamic'

type Search = { state?: string; next?: string }

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  const { state, next: rawNext } = await searchParams
  const next = safeNext(rawNext)
  const user = await getUser()

  return (
    <div className="fill">
      <SiteHeader email={user?.email} />

      <div className="wrap">
        <div className="auth">
          {user ? (
            <>
              <h1>You are signed in</h1>
              <p className="lead">
                Signed in as <b>{user.email}</b>.
              </p>
              <p>
                <Link className="back" href={next}>
                  Continue
                </Link>
              </p>
            </>
          ) : (
            <>
              <h1>Sign in</h1>
              <p className="lead">
                The demonstrations are not public. Enter the address the invitation was sent to and
                we will email you a link that signs you in. There is no password to remember.
              </p>

              {state === 'sent' ? (
                <p className="note ok">
                  If that address is on the list, a sign in link is on its way. It is good for one
                  hour and can only be used once. Check the junk folder if it does not arrive.
                </p>
              ) : null}
              {state === 'invalid' ? (
                <p className="note bad">That does not look like an email address.</p>
              ) : null}
              {state === 'expired' ? (
                <p className="note bad">
                  That link has expired or has already been used. Request a new one below.
                </p>
              ) : null}

              <form action={requestLink}>
                <input type="hidden" name="next" value={next} />
                <label htmlFor="email">Email address</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@company.com"
                />
                <button type="submit">Email me a sign in link</button>
              </form>

              <p className="small">
                Access is granted to named people rather than to companies. If you have not been
                invited and would like a demonstration, email{' '}
                <a href="mailto:info@trustscope.co.uk">info@trustscope.co.uk</a>.
              </p>
            </>
          )}
        </div>
      </div>

      <SiteFooter />
    </div>
  )
}
