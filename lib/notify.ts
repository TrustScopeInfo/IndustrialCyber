/**
 * Outbound email for things that are not sign in links.
 *
 * Sign in links are sent by Supabase. This is for telling the owner that
 * somebody asked for a demo they cannot see.
 *
 * Until RESEND_API_KEY is set, this records the attempt in the log and returns
 * false. The request itself is already saved in the database by then, so
 * nothing is lost, it just waits to be noticed rather than arriving.
 */
export async function notifyOwner(subject: string, lines: string[]): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  const to = process.env.OWNER_EMAIL ?? 'info@trustscope.co.uk'
  // Sent from the verified subdomain, but replies go to a mailbox that is
  // actually read. Nobody should ever have to reply to a noreply address.
  const from = process.env.NOTIFY_FROM ?? 'IndustrialCyber <noreply@send.industrialcyber.co.uk>'
  const replyTo = process.env.REPLY_TO ?? 'info@trustscope.co.uk'

  if (!key) {
    console.log(`[notify, not sent, no RESEND_API_KEY] ${subject} :: ${lines.join(' | ')}`)
    return false
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: replyTo,
        subject,
        text: lines.join('\n'),
      }),
    })

    if (!response.ok) {
      console.error(`notify failed: ${response.status} ${await response.text()}`)
      return false
    }
    return true
  } catch (error) {
    console.error('notify failed', error)
    return false
  }
}
