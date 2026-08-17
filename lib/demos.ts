/**
 * The demonstration catalogue.
 *
 * `built` means the demo file exists and is finished. It drives the counter on
 * the hero, so the counter reports what has been built rather than what a
 * particular visitor happens to be allowed to open.
 *
 * What a card offers is worked out per visitor at render time and is not stored
 * here. See DemoState.
 *
 * Every slug here must also exist in the demos table in Supabase. The build
 * refuses to run when the two disagree, see scripts/check-demos.mjs.
 */

/**
 *  soon     not built yet, nothing to click
 *  request  built, visitor is not signed in, so send them to the login
 *  ask      built, visitor is signed in but has no grant for it
 *  open     built, visitor has a grant, run it
 */
export type DemoState = 'soon' | 'request' | 'ask' | 'open'

export interface Demo {
  idx: string
  slug: string
  name: string
  sector: string
  blurb: string
  spec: Record<string, string>
  built: boolean
}

export const DEMOS: Demo[] = [
  {
    idx: '01',
    slug: 'syrup-room',
    name: 'Syrup room',
    sector: 'Food and beverage',
    built: true,
    blurb:
      'Blending and CIP for a soft drinks line. A paid insider plugs a USB stick into an operator panel and the plant goes blind while the PLCs keep running.',
    spec: {
      Process: 'Blend and CIP, two mix tanks',
      Control: 'AVEVA System Platform on ESXi',
      Protocols: 'S7comm, OPC UA, SuiteLink',
      Scenario: 'Insider, removable media',
    },
  },
  {
    idx: '02',
    slug: 'substation',
    name: 'Digital substation',
    sector: 'Electrical utilities',
    built: false,
    blurb:
      'An IEC 61850 substation targeted at 62443 SL3. Protection and control on a PRP network, with GOOSE and sampled values as the thing an attacker actually reaches.',
    spec: {
      Process: 'Protection and control bays',
      Control: '61850 station and bay level',
      Protocols: '61850 MMS, GOOSE, 60870-5-104',
      Scenario: 'In development',
    },
  },
  {
    idx: '03',
    slug: 'warehouse',
    name: 'Distribution centre',
    sector: 'Warehousing and logistics',
    built: false,
    blurb:
      'Automated storage and retrieval, conveyor sortation and the WMS link. Where operational technology stops and the business system begins is the whole argument.',
    spec: {
      Process: 'ASRS, sortation, dock',
      Control: 'PLC and WCS under a WMS',
      Protocols: 'EtherNet/IP, Profinet, SQL',
      Scenario: 'In development',
    },
  },
  {
    idx: '04',
    slug: 'water',
    name: 'Water treatment',
    sector: 'Water utilities',
    built: false,
    blurb:
      'Dosing, filtration and distribution across remote sites. Telemetry over public networks and unmanned assets are the two problems that define this sector.',
    spec: {
      Process: 'Dosing and filtration',
      Control: 'SCADA with remote outstations',
      Protocols: 'DNP3, Modbus, 60870-5-104',
      Scenario: 'In development',
    },
  },
]

export const SECTOR_COUNT = DEMOS.length
export const BUILT_COUNT = DEMOS.filter((d) => d.built).length
