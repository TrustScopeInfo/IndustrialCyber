// Layout audit for the demo mimics.
//
//   node audit.js                 audits every drawn page: proc, cip, arch, na, net
//   node audit.js proc            audits one tab
//   node audit.js proc --verbose  lists every measured element too
//
// Reports three fault classes:
//   TEXT/TEXT  two labels overlapping each other
//   TEXT/BOX   a label hidden by a box, or straddling the edge of one so half
//              the word sits on a different background
//   TEXT/PIPE  a label sitting on a pipe run
//
// It measures the rendered page in a real browser rather than estimating from
// source. An earlier version stubbed the DOM and guessed text widths from a
// table of narrow and wide characters, which is a better idea than reading the
// source with a regex and still not a measurement. getBBox on a laid out text
// element is the actual extent of the actual glyphs in the actual font.
//
// Two stages, because a bounding box is still not the same thing as paint:
//
//   1. Candidates. Bounding boxes in viewBox units. Cheap, and it misses
//      nothing, because a shape can only paint inside its own box.
//   2. Confirmation. Every candidate is hit tested with elementsFromPoint on a
//      grid across the label's glyphs. That respects clip paths, real curved
//      geometry and draw order.
//
// Stage one on its own reported four faults on the blend screen that were not
// on the screen. The concentrate level is a rectangle clipped to the hopper
// cone, so its bounding box claims two corners it never paints, and the KG
// labels sit in one of them. Stage two drops those and keeps the real ones.
//
// All coordinates are reported in viewBox units, 0 to 1600 across and 0 to 1000
// down, so they match the numbers in the source rather than screen pixels.

const { chromium } = require('playwright')
const path = require('path')

const FILE = path.resolve(__dirname, 'demos', 'syrup-room', 'index.html')

// Every page is measured in all three architecture states. The network
// architecture page draws different kit in each of them, and the zones page
// changes its switch bar, its ESXi callout and every conduit status. A page
// that does not change simply gets measured three times, which costs a few
// seconds and removes a whole class of blind spot: state dependent content was
// invisible to this audit from the day the three states were built.
const STATES = [1, 2, 3]

const TABS = {
  proc: { panel: 'p-proc', name: 'T470_T471 blend' },
  cip: { panel: 'p-cip', name: 'CIP 497' },
  arch: { panel: 'p-arch', name: 'System Platform infrastructure' },
  // The attack propagation draws more of itself on every click, so each step is
  // its own picture and none of them were being measured either.
  na: { panel: 'p-na', name: 'Network architecture', steps: [0, 1, 2, 3, 4, 5, 'conn'] },
  net: { panel: 'p-net', name: 'Zones and conduits' },
}

/** Runs inside the browser. Returns geometry in viewBox units, and stamps every
 *  measured element with data-audit so stage two can find it again. */
function measure(panelId) {
  const panel = document.getElementById(panelId)
  if (!panel) return { error: `no panel #${panelId}` }
  const svg = panel.querySelector('svg')
  if (!svg) return { error: `no svg inside #${panelId}` }

  document.querySelectorAll('[data-audit]').forEach((n) => n.removeAttribute('data-audit'))
  document.querySelectorAll('[data-audit-root]').forEach((n) => n.removeAttribute('data-audit-root'))
  svg.setAttribute('data-audit-root', '1')
  let seq = 0
  const stamp = (el) => {
    const i = seq++
    el.setAttribute('data-audit', String(i))
    return i
  }

  // Anything inside a clipPath, a defs or a marker is a definition, not paint.
  const isDefinition = (el) => !!el.closest('clipPath, defs, marker, mask, pattern, symbol')

  // An SVG element inside a display:none group still reports its own computed
  // display as visible, still returns a real getBBox and still returns a
  // getScreenCTM. Only its client rects go away. So the state dependent layers
  // on the network architecture page all measured as if they were on screen at
  // once, and the audit reported the flat caption overlapping the FortiGate
  // that replaces it. This is the test that actually means "on the screen".
  const rendered = (el) => el.getClientRects().length > 0

  // SVG paints in document order and has no z-index, so this is paint order.
  const order = new Map()
  Array.prototype.forEach.call(svg.querySelectorAll('*'), (el, n) => order.set(el, n))

  const vb = svg.viewBox.baseVal
  const root = svg.getScreenCTM()

  // Map an element's local coordinates into the root viewBox coordinates.
  const toUser = (el) => {
    const m = el.getScreenCTM()
    if (!m || !root) return null
    return root.inverse().multiply(m)
  }

  const boxOf = (el) => {
    let bb
    try {
      bb = el.getBBox()
    } catch {
      return null
    }
    if (!bb || (bb.width === 0 && bb.height === 0)) return null
    const m = toUser(el)
    if (!m) return null
    const pt = svg.createSVGPoint()
    const xs = []
    const ys = []
    for (const [x, y] of [
      [bb.x, bb.y],
      [bb.x + bb.width, bb.y],
      [bb.x, bb.y + bb.height],
      [bb.x + bb.width, bb.y + bb.height],
    ]) {
      pt.x = x
      pt.y = y
      const p = pt.matrixTransform(m)
      xs.push(p.x)
      ys.push(p.y)
    }
    return { x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) }
  }

  const texts = []
  for (const el of svg.querySelectorAll('text')) {
    if (isDefinition(el) || !rendered(el)) continue
    const label = (el.textContent || '').trim()
    if (!label) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue
    const b = boxOf(el)
    if (b) texts.push({ i: stamp(el), o: order.get(el), label, ...b })
  }

  const canvasArea = vb.width * vb.height
  const boxes = []
  for (const el of svg.querySelectorAll('rect, ellipse, circle')) {
    if (isDefinition(el) || !rendered(el)) continue
    const cs = getComputedStyle(el)
    const fill = cs.fill
    if (!fill || fill === 'none' || fill === 'rgba(0, 0, 0, 0)') continue
    if (parseFloat(cs.fillOpacity) === 0) continue
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue
    const b = boxOf(el)
    if (!b) continue
    // The lavender canvas and any full width banding are not boxes that clip.
    if ((b.x2 - b.x1) * (b.y2 - b.y1) > canvasArea * 0.5) continue
    const solid = parseFloat(cs.fillOpacity || '1') > 0.85 && parseFloat(cs.opacity || '1') > 0.85
    boxes.push({ i: stamp(el), o: order.get(el), fill, solid, ...b })
  }

  // Pipes are thick stroked paths. Sample along each one so an L shaped run is
  // treated as its actual segments rather than one big bounding rectangle,
  // which would report faults in the empty corner it does not occupy.
  // Pipes on the process screens are stroked paths. Conduits on the zones page
  // are line elements. Both are thick strokes that a label must not sit on.
  const pipes = []
  for (const el of svg.querySelectorAll('path, line, polyline')) {
    if (isDefinition(el) || !rendered(el)) continue
    const cs = getComputedStyle(el)
    // A filled path with a thick outline is a vessel, not a run. Line and
    // polyline have a default fill that never paints, so the test is skipped.
    if (el.tagName === 'path' && cs.fill !== 'none' && cs.fill !== 'rgba(0, 0, 0, 0)') continue
    if (!cs.stroke || cs.stroke === 'none') continue
    const sw = parseFloat(cs.strokeWidth)
    if (!(sw >= 2)) continue
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue

    const m = toUser(el)
    if (!m) continue
    const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1
    const half = (sw * scale) / 2

    let total = 0
    try {
      total = el.getTotalLength()
    } catch {
      continue
    }
    if (!total) continue

    const idx = stamp(el)
    const step = Math.max(2, total / 400)
    const pt = svg.createSVGPoint()
    let prev = null
    for (let d = 0; d <= total + step; d += step) {
      const raw = el.getPointAtLength(Math.min(d, total))
      pt.x = raw.x
      pt.y = raw.y
      const p = pt.matrixTransform(m)
      if (prev) {
        pipes.push({
          i: idx,
          x1: Math.min(prev.x, p.x) - half,
          x2: Math.max(prev.x, p.x) + half,
          y1: Math.min(prev.y, p.y) - half,
          y2: Math.max(prev.y, p.y) + half,
        })
      }
      prev = { x: p.x, y: p.y }
    }
  }

  return { viewBox: { w: vb.width, h: vb.height }, texts, boxes, pipes }
}

/** Stage two. Runs inside the browser. For each candidate pair it hit tests a
 *  grid across the label's glyphs and reports what is really painted there.
 *  Verdicts: over, straddle, on, clear. */
function confirmPairs(pairs) {
  const svg = document.querySelector('[data-audit-root]')
  const find = (i) => svg.querySelector(`[data-audit="${i}"]`)
  const stackAt = (x, y) => document.elementsFromPoint(x, y).filter((n) => svg.contains(n))

  // An opaque shape between a label and whatever lies under it means the label
  // is reading against that shape, not against the thing behind it.
  const opaque = (n) => {
    if (n.tagName === 'text') return false
    const cs = getComputedStyle(n)
    if (!cs.fill || cs.fill === 'none' || cs.fill === 'rgba(0, 0, 0, 0)') return false
    return parseFloat(cs.fillOpacity || '1') > 0.85 && parseFloat(cs.opacity || '1') > 0.85
  }

  // A grid over the label, roughly one sample per rendered pixel. Coarser than
  // that and a box whose edge only clips the descenders is missed, because the
  // sample rows step straight over the two pixels of the g and the y.
  const grid = (el) => {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return []
    const nx = Math.max(3, Math.min(160, Math.round(r.width)))
    const ny = Math.max(3, Math.min(40, Math.round(r.height)))
    const pts = []
    for (let a = 0; a < nx; a++) {
      for (let b = 0; b < ny; b++) {
        pts.push([r.left + ((a + 0.5) * r.width) / nx, r.top + ((b + 0.5) * r.height) / ny])
      }
    }
    return pts
  }

  return pairs.map(({ ti, oi }) => {
    const T = find(ti)
    const O = find(oi)
    if (!T || !O) return 'clear'
    let glyph = 0
    let over = 0
    let exposed = 0
    for (const [x, y] of grid(T)) {
      const st = stackAt(x, y)
      const it = st.indexOf(T)
      if (it < 0) continue // nothing of the label is painted at this point
      glyph++
      const io = st.indexOf(O)
      if (io < 0) continue
      if (io < it) over++ // the other shape is painted on top of the label
      else if (!st.slice(it + 1, io).some(opaque)) exposed++
    }
    if (!glyph) return 'clear'
    if (over) return 'over'
    if (!exposed) return 'clear' // shielded by something opaque in between
    if (exposed === glyph) return 'on' // the label sits wholly on the other shape
    return 'straddle' // part of the label on it, part off it
  })
}

const TOL = 1 // viewBox units of slack, so a hairline touch is not a fault
const overlaps = (a, b) => a.x1 + TOL < b.x2 && b.x1 + TOL < a.x2 && a.y1 + TOL < b.y2 && b.y1 + TOL < a.y2
const contains = (inner, outer) =>
  inner.x1 >= outer.x1 - 2 && inner.x2 <= outer.x2 + 2 && inner.y1 >= outer.y1 - 3 && inner.y2 <= outer.y2 + 3

const at = (b) => `@${Math.round(b.x1)},${Math.round(b.y1)}`

/** Bounding box pass. Text on text is settled here, because nothing can be
 *  painted between two labels that would make the overlap acceptable. The other
 *  two classes only produce candidates for the hit test to confirm or drop. */
function candidates({ texts, boxes, pipes }) {
  const settled = []
  const pairs = []

  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]

    for (let j = i + 1; j < texts.length; j++) {
      if (overlaps(t, texts[j])) {
        settled.push(['TEXT/TEXT', `"${t.label}" ${at(t)} over "${texts[j].label}" ${at(texts[j])}`])
      }
    }

    for (const box of boxes) {
      if (!overlaps(t, box)) continue
      if (contains(t, box)) {
        // A label inside a box is normally a label on that box. It is only a
        // fault when the box is painted after the label, which buries it.
        if (box.solid && box.o > t.o) {
          settled.push(['TEXT/BOX', `"${t.label}" ${at(t)} is buried under a ${box.fill} box ${at(box)}`])
        }
        continue
      }
      {
        pairs.push({
          kind: 'TEXT/BOX',
          ti: t.i,
          oi: box.i,
          say: (v) =>
            v === 'over'
              ? `"${t.label}" ${at(t)} is painted over by a ${box.fill} box ${at(box)}`
              : `"${t.label}" ${at(t)} straddles the edge of a ${box.fill} box ${at(box)}`,
        })
      }
    }

    // One candidate per pipe element, not one per sampled segment.
    const seen = new Set()
    for (const p of pipes) {
      if (!seen.has(p.i) && overlaps(t, p)) seen.add(p.i)
    }
    for (const oi of seen) {
      pairs.push({
        kind: 'TEXT/PIPE',
        ti: t.i,
        oi,
        say: (v) => (v === 'over' ? `"${t.label}" ${at(t)} is crossed by a pipe` : `"${t.label}" ${at(t)} sits on a pipe`),
      })
    }
  }

  return { settled, pairs }
}

async function main() {
  const args = process.argv.slice(2)
  const verbose = args.includes('--verbose')
  const wanted = args.filter((a) => !a.startsWith('--'))
  const tabs = wanted.length ? wanted : Object.keys(TABS)

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
  await page.goto('file://' + FILE, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)

  // The demo runs on a tick that re-renders the overlay groups. Stage one
  // stamps every measured element with data-audit; stage two finds them again
  // by that stamp. A tick landing between the two throws the stamped nodes
  // away and rebuilds them, so find() returned null and the pair was recorded
  // as clear. Every candidate needing the hit test in a redrawn group, which
  // means the whole attack overlay and the whole connectivity overlay, was
  // being dropped in silence. Freeze the page first. The driver renders
  // explicitly, so nothing is lost by stopping the clock.
  await page.evaluate(() => {
    for (let i = 1; i < 10000; i++) clearInterval(i)
  })

  let total = 0

  for (const tab of tabs) {
    const meta = TABS[tab]
    if (!meta) {
      console.log(`\nunknown tab "${tab}". Known: ${Object.keys(TABS).join(', ')}`)
      continue
    }

    await page.click(`[role=tab][data-t="${tab}"]`)
    await page.waitForTimeout(400)

    console.log(`\n${'='.repeat(70)}`)
    console.log(`${meta.name}   [${tab}]`)
    console.log('='.repeat(70))

    // A page with architecture states draws a different picture in each one.
    // Measuring only whichever happens to be selected leaves the rest unchecked.
    for (const state of STATES) {
      await page.evaluate((n) => {
        setArch(n)
        render()
      }, state)
      await page.waitForTimeout(250)

      for (const step of meta.steps ?? [null]) {
        if (step !== null) {
          await page.evaluate((n) => {
            // naConn toggles, so drive it to a known state rather than flipping.
            if (S.na.conn) naConn()
            naReset()
            if (n === 'conn') naConn()
            else for (let i = 0; i < n; i++) naStep()
          }, step)
          await page.waitForTimeout(120)
        }
      console.log(`\narchitecture state ${state}${step === null ? '' : step === 'conn' ? ', connectivity on' : `, attack step ${step}`}`)

    const data = await page.evaluate(measure, meta.panel)

    if (data.error) {
      console.log(`could not measure: ${data.error}`)
      total += 1
      continue
    }

    console.log(
      `canvas ${data.viewBox.w}x${data.viewBox.h}, ` +
        `${data.texts.length} labels, ${data.boxes.length} boxes, ${data.pipes.length} pipe segments`,
    )

    if (verbose) {
      for (const t of data.texts) console.log(`  label "${t.label}" ${at(t)}`)
    }

    const { settled, pairs } = candidates(data)
    const verdicts = pairs.length
      ? await page.evaluate(
          confirmPairs,
          pairs.map(({ ti, oi }) => ({ ti, oi })),
        )
      : []

    const faults = { 'TEXT/TEXT': [], 'TEXT/BOX': [], 'TEXT/PIPE': [] }
    for (const [kind, line] of settled) faults[kind].push(line)

    let dropped = 0
    pairs.forEach((p, n) => {
      const v = verdicts[n]
      // A label sitting wholly on a box, painted on top of it, is a label on a
      // background. That is only a fault when the thing underneath is a pipe.
      if (v === 'clear' || (p.kind === 'TEXT/BOX' && v === 'on')) {
        dropped++
        return
      }
      faults[p.kind].push(p.say(v))
    })

    for (const key of Object.keys(faults)) faults[key] = [...new Set(faults[key])]

    const count = Object.values(faults).reduce((n, list) => n + list.length, 0)
    total += count

    if (verbose && dropped) {
      console.log(`  ${dropped} of ${pairs.length} bounding box candidate(s) dropped by the hit test`)
    }

    if (!count) {
      console.log('\nclean')
      continue
    }

    for (const [kind, list] of Object.entries(faults)) {
      if (!list.length) continue
      console.log(`\n${kind}  (${list.length})`)
      for (const line of list) console.log(`  ${line}`)
    }
      }
    }
  }

  await browser.close()

  console.log(`\n${'='.repeat(70)}`)
  console.log(total ? `${total} fault(s) found` : 'no faults found')
  console.log('It does not check pipe routing sanity or visual balance. Those need the screenshot.')
  process.exitCode = total ? 1 : 0
}

main()
