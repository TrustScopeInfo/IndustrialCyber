// Crop a region of a rendered tab, in SVG viewBox units, and scale it up so a
// suspected label collision can actually be looked at.
//   node crop.js proc 690 90 200 120 shots/out.png [zoom]
const { chromium } = require('playwright');
const path = require('path');
const [, , tab, X, Y, W, H, out, zoom = 3] = process.argv;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: +zoom });
  await p.goto('file://' + path.resolve('demos/syrup-room/index.html'), { waitUntil: 'networkidle' });
  if (tab) await p.click(`[role=tab][data-t="${tab}"]`);
  await p.waitForTimeout(1200);
  // Map viewBox units to page pixels using the live SVG.
  const box = await p.evaluate(([t, x, y, w, h]) => {
    const svg = document.querySelector(`#p-${t} svg`);
    const m = svg.getScreenCTM();
    const pt = svg.createSVGPoint();
    const to = (a, b) => { pt.x = a; pt.y = b; const q = pt.matrixTransform(m); return q; };
    const a = to(+x, +y), c = to(+x + +w, +y + +h);
    return { x: a.x, y: a.y, width: c.x - a.x, height: c.y - a.y };
  }, [tab, X, Y, W, H]);
  await p.screenshot({ path: out, clip: box });
  await b.close();
})();
