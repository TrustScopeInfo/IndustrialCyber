// Screenshot tool. Two forms:
//
//   node shot.js demos/syrup-room/index.html proc shots/proc.png    a local file
//   node shot.js http://localhost:3200 "" shots/launcher.png        a running page
//
// Second argument is a demo tab id, or "" for pages with no tabs.
// Tab ids: proc, cip, ap, net, tags, arch, ass, brf
const { chromium } = require('playwright');
const [, , target, tab, out] = process.argv;
(async () => {
  const url = /^https?:\/\//.test(target)
    ? target
    : 'file://' + require('path').resolve(target);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(url, { waitUntil: 'networkidle' });
  if (tab) await p.click(`[role=tab][data-t="${tab}"]`);
  await p.waitForTimeout(1200);           // let the sim tick so values are populated
  await p.screenshot({ path: out || 'shot.png', fullPage: false });
  await b.close();
})();
