import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { currentSuperAdmin } from '@/lib/admin'
import { getUser } from '@/lib/supabase/server'
import { DEMOS } from '@/lib/demos'

export const dynamic = 'force-dynamic'

interface Person {
  id: string
  email: string
  expires_at: string | null
  note: string | null
  is_super_admin: boolean
  all_demos: boolean
  created_at: string
}

interface Grant {
  person_id: string
  demo_slug: string
  expires_at: string | null
}

/**
 * Who is on the list, and what they can open.
 *
 * Read with the secret key in a server component, so the key stays on the
 * server and the browser only ever receives the rendered table.
 */
async function load() {
  const admin = createAdminClient()
  const [people, grants] = await Promise.all([
    admin.from('allowlist').select('*').order('created_at'),
    admin.from('demo_access').select('person_id, demo_slug, expires_at'),
  ])
  if (people.error) throw new Error(people.error.message)
  if (grants.error) throw new Error(grants.error.message)
  return { people: (people.data ?? []) as Person[], grants: (grants.data ?? []) as Grant[] }
}

const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : null)

function expiryLabel(p: Person) {
  if (!p.expires_at) return { text: 'never', spent: false }
  const spent = new Date(p.expires_at) <= new Date()
  return { text: `${spent ? 'expired ' : ''}${dateOnly(p.expires_at)}`, spent }
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ done?: string; failed?: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/login?next=%2Fadmin')

  const actor = await currentSuperAdmin()
  if (!actor) {
    return (
      <main className="admin">
        <h1>Not for you</h1>
        <p>
          You are signed in as <b>{user.email}</b>, and that account is not a super admin.
        </p>
        <p className="after">
          <a href="/">Back to the demonstrations</a>
        </p>
      </main>
    )
  }

  const { people, grants } = await load()
  const { done, failed } = await searchParams
  const superAdmins = people.filter(
    (p) => p.is_super_admin && (!p.expires_at || new Date(p.expires_at) > new Date()),
  ).length

  return (
    <main className="admin">
      <header className="ah">
        <div>
          <h1>People</h1>
          <p className="sub">
            {people.length} on the allowlist, {superAdmins} super admin
            {superAdmins === 1 ? '' : 's'}. Signed in as {actor.email}.
          </p>
        </div>
        <a className="btn ghost" href="/">
          Back to demonstrations
        </a>
      </header>

      {done ? <p className="flash ok">{done}</p> : null}
      {failed ? <p className="flash bad">{failed}</p> : null}

      {superAdmins === 1 ? (
        <p className="flash note">
          There is one super admin. The database refuses to remove or demote the last one, so give
          the flag to somebody else before changing your own.
        </p>
      ) : null}

      <table className="people">
        <thead>
          <tr>
            <th>Email</th>
            <th>Expiry</th>
            <th>All demos</th>
            <th>Super admin</th>
            <th>Demos granted</th>
            <th>Change</th>
          </tr>
        </thead>
        <tbody>
          {people.map((p) => {
            const mine = grants.filter((g) => g.person_id === p.id).map((g) => g.demo_slug)
            const expiry = expiryLabel(p)
            const ungranted = DEMOS.filter((d) => !mine.includes(d.slug))
            return (
              <tr key={p.id}>
                <td>
                  <b>{p.email}</b>
                  {p.note ? <span className="note">{p.note}</span> : null}
                </td>
                <td className={expiry.spent ? 'bad' : ''}>{expiry.text}</td>
                <td>
                  <form method="post" action="/api/admin/all-demos">
                    <input type="hidden" name="email" value={p.email} />
                    <input type="hidden" name="on" value={p.all_demos ? 'false' : 'true'} />
                    <button className={p.all_demos ? 'pill on' : 'pill'}>
                      {p.all_demos ? 'on' : 'off'}
                    </button>
                  </form>
                </td>
                <td>
                  <form method="post" action="/api/admin/super-admin">
                    <input type="hidden" name="email" value={p.email} />
                    <input type="hidden" name="on" value={p.is_super_admin ? 'false' : 'true'} />
                    <button className={p.is_super_admin ? 'pill on' : 'pill'}>
                      {p.is_super_admin ? 'yes' : 'no'}
                    </button>
                  </form>
                </td>
                <td>
                  {p.all_demos ? <span className="every">every demo</span> : null}
                  {mine.length === 0 && !p.all_demos ? <span className="none">none</span> : null}
                  <span className="grants">
                    {mine.map((slug) => (
                      <form key={slug} method="post" action="/api/admin/revoke">
                        <input type="hidden" name="email" value={p.email} />
                        <input type="hidden" name="slug" value={slug} />
                        <button className="grant" title={`Revoke ${slug}`}>
                          {slug} <span aria-hidden="true">×</span>
                        </button>
                      </form>
                    ))}
                  </span>
                  {ungranted.length ? (
                    <form className="add-grant" method="post" action="/api/admin/grant">
                      <input type="hidden" name="email" value={p.email} />
                      <select name="slug" defaultValue={ungranted[0].slug} aria-label={`Grant a demo to ${p.email}`}>
                        {ungranted.map((d) => (
                          <option key={d.slug} value={d.slug}>
                            {d.name}
                            {d.built ? '' : ' (not built)'}
                          </option>
                        ))}
                      </select>
                      <button className="btn small">Grant</button>
                    </form>
                  ) : null}
                </td>
                <td>
                  <form method="post" action="/api/admin/person/remove">
                    <input type="hidden" name="email" value={p.email} />
                    <button className="btn danger small">Remove</button>
                  </form>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <section className="addbox">
        <h2>Add a person</h2>
        <form method="post" action="/api/admin/person" className="addform">
          <label>
            Email
            <input type="email" name="email" required placeholder="someone@example.com" />
          </label>
          <label>
            Note
            <input type="text" name="note" placeholder="Fortinet, met in Leeds" />
          </label>
          <label>
            Expiry
            <input type="date" name="expires_at" />
            <small>blank means never</small>
          </label>
          <label className="check">
            <input type="checkbox" name="all_demos" />
            All demos
          </label>
          <button className="btn">Add</button>
        </form>
        <p className="foot">
          Adding somebody is silent. They are not emailed until they ask for a sign in link.
        </p>
      </section>
    </main>
  )
}
