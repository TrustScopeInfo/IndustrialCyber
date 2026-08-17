import { NextResponse, type NextRequest } from 'next/server'
import { DEMOS } from '@/lib/demos'
import { canOpenDemo, findPerson, recordAccessRequest } from '@/lib/access'
import { notifyOwner } from '@/lib/notify'
import { getUser } from '@/lib/supabase/server'

/**
 * Somebody signed in asked for a demonstration they cannot see.
 *
 * Saved to the database first and emailed second, so a request is never lost
 * because the mail failed. Until Resend is wired up the email is skipped and
 * the row is still there.
 *
 * Posted to from two places: the card on the launcher, and the page the demo
 * route returns when access does not include that demo. Both are plain form
 * posts, so this works with no browser JavaScript at all.
 */
export async function POST(request: NextRequest) {
  // A form post from another site should not be able to make requests in
  // somebody's name. Browsers that send this header let us insist on our own.
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin') {
    return new NextResponse('Cross site form posts are not accepted', { status: 403 })
  }

  const form = await request.formData()
  const slug = String(form.get('slug') ?? '')
  const demo = DEMOS.find((d) => d.slug === slug && d.built)

  if (!demo) {
    return NextResponse.redirect(new URL('/', request.url), 303)
  }

  const user = await getUser()
  if (!user?.email) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(`/demos/${slug}`)}`, request.url),
      303,
    )
  }

  // Already has it, so there is nothing to ask for. Send them to the demo.
  if (await canOpenDemo(user.email, slug)) {
    return NextResponse.redirect(new URL(`/demos/${slug}`, request.url), 303)
  }

  const person = await findPerson(user.email)
  await recordAccessRequest(person, user.email, slug)

  await notifyOwner(`Access requested: ${demo.name}`, [
    `${user.email} asked for access to the ${demo.name} demonstration.`,
    '',
    `Demo:  ${demo.name} (${slug})`,
    `Asked: ${user.email}`,
    '',
    'To grant it, in the Supabase SQL editor:',
    `  select grant_demo('<your-admin-id>'::uuid, '${user.email}', '${slug}');`,
  ])

  return NextResponse.redirect(new URL(`/?requested=${encodeURIComponent(slug)}`, request.url), 303)
}
