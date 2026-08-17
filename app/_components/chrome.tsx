import { signOut } from '@/app/auth/actions'

/**
 * The dark bar and the footer, shared by the launcher and the login page so the
 * two cannot drift apart.
 */
export function SiteHeader({ email, onDemos }: { email?: string | null; onDemos?: boolean }) {
  return (
    <div className="top">
      <div className="wrap">
        <a className="logo" href="/">
          Industrial<span>Cyber</span>
          <i></i>
        </a>
        <nav>
          <a href="/#demos" aria-current={onDemos ? 'page' : undefined}>
            Demonstrations
          </a>
          <a href="/#how">How they work</a>
          <a href="mailto:info@trustscope.co.uk">Contact</a>
          {email ? (
            <form action={signOut} className="who">
              <span>{email}</span>
              <button type="submit">Sign out</button>
            </form>
          ) : null}
        </nav>
      </div>
    </div>
  )
}

export function SiteFooter() {
  return (
    <footer>
      <div className="wrap">
        <span>IndustrialCyber</span>
        <span className="sp"></span>
        <span>
          Simulated data. Representative of each sector, not any individual operator&apos;s plant.
        </span>
        <a href="mailto:info@trustscope.co.uk">Contact</a>
      </div>
    </footer>
  )
}
