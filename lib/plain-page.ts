/**
 * A small self contained page for the handful of answers that come out of a
 * route handler rather than a React page: no access, not published.
 *
 * Written as a string because these are returned by route handlers, and kept
 * to the same colours as the rest of the site so they do not look like an
 * error somebody else's server produced.
 */
export function plainPage(title: string, body: string) {
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${escapeHtml(title)}</title>
<style>
:root{--ink:#101418;--ink-2:#1b2128;--line:#dde2e8;--body:#48525d;--mute:#7a8590;--accent:#b81d2c;--wash:#f4f6f8}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--ink-2);color:#fff;
font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;padding:24px}
main{max-width:56ch;border-top:3px solid var(--accent);background:#fff;color:var(--ink);padding:34px 34px 30px}
h1{margin:0 0 14px;font-size:25px;font-weight:800;letter-spacing:-.024em;line-height:1.15}
p{margin:0 0 12px;color:var(--body);font-size:15.5px}
b{color:var(--ink);font-weight:600}
form{margin:22px 0 0}
button{font:inherit;font-size:14.5px;font-weight:700;color:#fff;background:var(--ink);
border:0;padding:12px 18px;cursor:pointer}
button:hover{background:var(--accent)}
.after{margin:22px 0 0;padding-top:18px;border-top:1px solid var(--line);font-size:14px}
.after a{color:var(--accent);font-weight:700;text-decoration:none}
.after a:hover{text-decoration:underline}
.mono{font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:13px;background:var(--wash);
border:1px solid var(--line);padding:10px 12px;color:var(--ink);overflow-x:auto}
</style></head>
<body><main>${body}</main></body></html>`
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
