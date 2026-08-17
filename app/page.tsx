import Link from 'next/link'
import { DEMOS, BUILT_COUNT, SECTOR_COUNT, type Demo } from '@/lib/demos'

/**
 * The launcher. Stays public, it is the shop window. The demos themselves are
 * gated, so nothing here links straight at a demo file.
 */

function cardChrome(state: Demo['state']) {
  switch (state) {
    case 'open':
      return { pill: 'Ready', pillClass: 'pill ready', cta: 'Run demonstration', off: false }
    case 'request':
      return { pill: 'Available', pillClass: 'pill ready', cta: 'Request access', off: false }
    default:
      return { pill: 'In development', pillClass: 'pill', cta: null, off: true }
  }
}

function href(demo: Demo) {
  if (demo.state === 'open') return `/demos/${demo.slug}`
  if (demo.state === 'request') return `/login?demo=${demo.slug}`
  return null
}

function Card({ demo }: { demo: Demo }) {
  const { pill, pillClass, cta, off } = cardChrome(demo.state)
  const to = href(demo)

  const inner = (
    <>
      <div className="body">
        <div className="hdr">
          <span className="idx">{demo.idx}</span>
          <span className={pillClass}>{pill}</span>
        </div>
        <h3>{demo.name}</h3>
        <div className="sector">{demo.sector}</div>
        <p>{demo.blurb}</p>
        <dl className="spec">
          {Object.entries(demo.spec).map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {cta ? <div className="cta">{cta}</div> : null}
    </>
  )

  if (!to) return <div className={off ? 'card off' : 'card'}>{inner}</div>

  return (
    <Link className={off ? 'card off' : 'card'} href={to}>
      {inner}
    </Link>
  )
}

export default function Home() {
  return (
    <>
      <div className="top">
        <div className="wrap">
          <a className="logo" href="/">
            Industrial<span>Cyber</span>
            <i></i>
          </a>
          <nav>
            <a href="#demos" aria-current="page">
              Demonstrations
            </a>
            <a href="#how">How they work</a>
            <a href="mailto:info@trustscope.co.uk">Contact</a>
          </nav>
        </div>
      </div>

      <section className="hero">
        <div className="wrap">
          <h1>See what an OT attack actually does to a plant</h1>
          <p>
            Each demonstration is a working process on screen, drawn to match the real control
            system of that sector. Run the plant, trigger the attack, and watch what the operator
            sees. <b>Everything runs in a browser with no install and no network.</b>
          </p>
          <div className="stats">
            <div>
              <b>{SECTOR_COUNT}</b>
              <span>Sectors covered</span>
            </div>
            <div>
              <b>{BUILT_COUNT}</b>
              <span>Ready to run</span>
            </div>
            <div>
              <b>Offline</b>
              <span>Runs with no connectivity</span>
            </div>
          </div>
        </div>
      </section>

      <div className="wrap" id="demos">
        <div className="sec">
          <h2>Demonstrations</h2>
          <p>
            Built around the control systems and protocols each sector actually runs, not a generic
            diagram.
          </p>
        </div>
        <div className="grid">
          {DEMOS.map((d) => (
            <Card key={d.slug} demo={d} />
          ))}
        </div>
      </div>

      <section className="how" id="how">
        <div className="wrap">
          <div className="sec" style={{ paddingTop: 0 }}>
            <h2>How they work</h2>
          </div>
          <div className="grid3">
            <div>
              <h4>
                <em>01</em>Run the plant
              </h4>
              <p>
                The process screen is a live mimic. Batches run, valves open, readings move. Plant
                engineers recognise it because it is drawn to their conventions.
              </p>
            </div>
            <div>
              <h4>
                <em>02</em>Trigger the attack
              </h4>
              <p>
                A single realistic scenario plays out on a clock, hop by hop, showing how far it
                spreads and how much of it ever reaches a security team.
              </p>
            </div>
            <div>
              <h4>
                <em>03</em>Add the controls
              </h4>
              <p>
                Enable one control at a time and watch the chain get cut earlier. The argument is
                not the whole stack, it is that each layer changes the outcome.
              </p>
            </div>
          </div>
        </div>
      </section>

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
    </>
  )
}
