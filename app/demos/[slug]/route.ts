import { NextResponse, type NextRequest } from 'next/server'
import { DEMOS } from '@/lib/demos'
import { canOpenDemo, findPerson, logDemoView } from '@/lib/access'
import { fetchDemoHtml } from '@/lib/demo-file'
import { getUser } from '@/lib/supabase/server'
import { escapeHtml, plainPage } from '@/lib/plain-page'

/**
 * The gate in front of a demonstration.
 *
 * Four outcomes, all of them plain:
 *
 *   no such demo            404
 *   not signed in           back to the login, carrying where they were going
 *   signed in, no grant     403 and a page that says so, with a way to ask
 *   signed in, granted      the file, streamed from the private bucket
 *
 * Access is rechecked here on every request rather than trusted from the
 * session, so revoking a grant takes effect on the next click.
 *
 * The response is private and no-store, so neither Vercel's CDN nor the
 * visitor's browser keeps a copy of a demo lying about.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const demo = DEMOS.find((d) => d.slug === slug && d.built)

  if (!demo) {
    return new NextResponse('Not found', { status: 404, headers: noStore() })
  }

  const user = await getUser()
  if (!user?.email) {
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(`/demos/${slug}`)}`, request.url),
    )
  }

  // Off the allowlist entirely, which means removed since they signed in.
  const person = await findPerson(user.email)
  if (!person) {
    return NextResponse.redirect(new URL('/login?state=expired', request.url))
  }

  if (!(await canOpenDemo(user.email, slug))) {
    return new NextResponse(noAccessPage(demo.name, user.email, slug), {
      status: 403,
      headers: noStore('text/html; charset=utf-8'),
    })
  }

  const html = await fetchDemoHtml(slug)
  if (html === null) {
    return new NextResponse(notPublishedPage(demo.name, slug), {
      status: 503,
      headers: noStore('text/html; charset=utf-8'),
    })
  }

  await logDemoView(person.id, slug)

  return new NextResponse(html, { headers: noStore('text/html; charset=utf-8') })
}

function noStore(contentType?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'cache-control': 'private, no-store, max-age=0, must-revalidate',
    'x-robots-tag': 'noindex, nofollow',
  }
  if (contentType) headers['content-type'] = contentType
  return headers
}

function noAccessPage(name: string, email: string, slug: string) {
  return plainPage(
    `${name} — access not included`,
    `<h1>Not included in your access</h1>
     <p>You are signed in as <b>${escapeHtml(email)}</b>, and that account does not
        include the <b>${escapeHtml(name)}</b> demonstration.</p>
     <p>Nothing has gone wrong. Access is given one demonstration at a time.</p>
     <form method="post" action="/api/access-request">
       <input type="hidden" name="slug" value="${escapeHtml(slug)}">
       <button type="submit">Ask for access to this one</button>
     </form>
     <p class="after"><a href="/">Back to the demonstrations</a></p>`,
  )
}

function notPublishedPage(name: string, slug: string) {
  return plainPage(
    `${name} — not published`,
    `<h1>Not published yet</h1>
     <p>Your access is correct, but the <b>${escapeHtml(name)}</b> file has not been
        uploaded to the private store yet, so there is nothing to show you.</p>
     <p class="mono">publish it with: node scripts/publish-demo.mjs ${escapeHtml(slug)}</p>
     <p class="after"><a href="/">Back to the demonstrations</a></p>`,
  )
}
