// Layout audit for the demo mimics.
//
//   node audit.js                 audits proc, cip and net
//   node audit.js proc            audits one tab
//   node audit.js proc --verbose  lists every measured element too
//
// Reports three fault classes:
//   TEXT/TEXT  two labels overlapping each other
//   TEXT/BOX   a label overlapping a box it is not inside, so it is clipped
//              or sitting across an edge it does not belong to
//   TEXT/PIPE  a label sitting on a pipe run
//
// It measures the rendered page in a real browser rather than estimating from
// source. The previous version stubbed the DOM and guessed text widths from a
// table of narrow and wide characters, which is a better idea than reading the
// source with a regex and still not a measurement. getBBox on a laid out text
// element is the actual extent of the actual glyphs in the actual font.
//
// All coordinates are reported in viewBox units, 0 to 1600 across and 0 to 1000
// down, so they match the numbers in the source rather than screen pixels.

const { chromium } = require('playwright')
const path = require('path')

const FILE = path.resolve(__dirname, 'demos', 'syrup-room', 'index.html')

const TABS = {
  proc: { panel: 'p-proc', name: 'T470_T471 blend' },
  cip: { panel: 'p-cip', name: 'CIP 497' },
  net: { panel: 'p-net', name: 'Zones and conduits' },
}

/** Runs inside the browser. Returns geometry in viewBox units. */
function measure(panelId) {
  const panel = document.getElementById(panelId)
  if (!panel) return { error: `no panel #${panelId}` }
  const svg = panel.querySelector('svg')
  if (!svg) return { error: `no svg inside #${panelId}` }

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
    const label = (el.textContent || '').trim()
    if (!label) continue
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue
    const b = boxOf(el)
    if (b) texts.push({ label, ...b })
  }

  const canvasArea = vb.width * vb.height
  const boxes = []
  for (const el of svg.querySelectorAll('rect')) {
    const cs = getComputedStyle(el)
    const fill = cs.fill
    if (!fill || fill === 'none' || fill === 'rgba(0, 0, 0, 0)') continue
    if (parseFloat(cs.fillOpacity) === 0) continue
    const b = boxOf(el)
    if (!b) continue
    // The lavender canvas and any full width banding are not boxes that clip.
    if ((b.x2 - b.x1) * (b.y2 - b.y1) > canvasArea * 0.5) continue
    boxes.push({ fill, ...b })
  }

  // Pipes are thick stroked paths. Sample along each one so an L shaped run is
  // treated as its actual segments rather than one big bounding rectangle,
  // which would report faults in the empty corner it does not occupy.
  // Pipes on the process screens are stroked paths. Conduits on the zones page
  // are line elements. Both are thick strokes that a label must not sit on.
  const pipes = []
  for (const el of svg.querySelectorAll('path, line, polyline')) {
    const cs = getComputedStyle(el)
    // A filled path with a thick outline is a vessel, not a run. Line and
    // polyline have a default fill that never paints, so the test is skipped.
    if (el.tagName === 'path' && cs.fill !== 'none' && cs.fill !== 'rgba(0, 0, 0, 0)') continue
    if (!cs.stroke || cs.stroke === 'none') continue
    const sw = parseFloat(cs.strokeWidth)
    if (!(sw >= 5)) continue
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

const TOL = 1 // viewBox units of slack, so a hairline touch is not a fault
const overlaps = (a, b) => a.x1 + TOL < b.x2 && b.x1 + TOL < a.x2 && a.y1 + TOL < b.y2 && b.y1 + TOL < a.y2
const contains = (inner, outer) =>
  inner.x1 >= outer.x1 - 2 && inner.x2 <= outer.x2 + 2 && inner.y1 >= outer.y1 - 3 && inner.y2 <= outer.y2 + 3

const at = (b) => `@${Math.round(b.x1)},${Math.round(b.y1)}`

function findFaults({ texts, boxes, pipes }) {
  const faults = { 'TEXT/TEXT': [], 'TEXT/BOX': [], 'TEXT/PIPE': [] }

  for (let i = 0; i < texts.length; i++) {
    const t = texts[i]

    for (let j = i + 1; j < texts.length; j++) {
      if (overlaps(t, texts[j])) {
        faults['TEXT/TEXT'].push(`"${t.label}" ${at(t)} over "${texts[j].label}" ${at(texts[j])}`)
      }
    }

    for (const box of boxes) {
      if (overlaps(t, box) && !contains(t, box)) {
        faults['TEXT/BOX'].push(`"${t.label}" ${at(t)} across the edge of a ${box.fill} box ${at(box)}`)
      }
    }

    // A label sitting inside an opaque box is visually on the box, whatever
    // runs underneath it, so it is not on a pipe.
    const shielded = boxes.some((box) => contains(t, box))
    if (!shielded) {
      const hit = pipes.find((p) => overlaps(t, p))
      if (hit) faults['TEXT/PIPE'].push(`"${t.label}" ${at(t)} sits on a pipe`)
    }
  }

  for (const key of Object.keys(faults)) faults[key] = [...new Set(faults[key])]
  return faults
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

  let total = 0

  for (const tab of tabs) {
    const meta = TABS[tab]
    if (!meta) {
      console.log(`\nunknown tab "${tab}". Known: ${Object.keys(TABS).join(', ')}`)
      continue
    }

    await page.click(`[role=tab][data-t="${tab}"]`)
    await page.waitForTimeout(400)

    const data = await page.evaluate(measure, meta.panel)

    console.log(`\n${'='.repeat(70)}`)
    console.log(`${meta.name}   [${tab}]`)
    console.log('='.repeat(70))

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

    const faults = findFaults(data)
    const count = Object.values(faults).reduce((n, list) => n + list.length, 0)
    total += count

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

  await browser.close()

  console.log(`\n${'='.repeat(70)}`)
  console.log(total ? `${total} fault(s) found` : 'no faults found')
  console.log('It does not check pipe routing sanity or visual balance. Those need the screenshot.')
  process.exitCode = total ? 1 : 0
}

main()
