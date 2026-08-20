# Third party assets

Where the artwork in the demos comes from, and how to get it again.

## Cisco network topology icons

Two Cisco switch icons are used on the syrup room demo's Network Architecture
page, to draw the plant as it is actually found before any Fortinet kit is
added:

| File | Used as |
| --- | --- |
| `cisco-workgroup-switch.svg` | the L1 Cisco IE switch, on the CONTROL band |
| `cisco-layer3-switch.svg` | the L3 aggregation switch, on the OPERATIONS band |

A third file, `cisco-multilayer-switch.svg`, was evaluated and not used. It
carries its label as glyph outlines, which are unreadable at icon size.

**Source.** Cisco's brand center, network topology icon set, EPS library.
Converted from EPS to SVG. The only edit is that the internal clip path ids
were renamespaced, because all three files ship `clip-0` through `clip-N` and
those collide the moment the icons share one document. Every path, fill and
transform is byte for byte what Cisco shipped.

**Licence.** Cisco's terms are use but do not alter. The icons are scaled
uniformly inside their own aspect ratio, never stretched, never recoloured and
never greyed. Where a state of the demo shows Fortinet kit instead, the Cisco
icon is replaced by a different icon rather than being restyled.

**Embedded, not linked.** The icons live inside the demo HTML as SVG symbols.
The demo has to run with no network at all, on a customer site, so nothing it
draws is ever fetched at runtime.

**Not in this repo.** The loose source files are gitignored. This repo is
public and the icons are Cisco's, so they are kept locally only. Nothing in
the repo depends on them: the demo already carries its own copy.

**To regenerate.** Download the EPS network topology icons from Cisco's brand
center, convert EPS to SVG, renamespace the clip path ids so two icons can
share a document, then embed as symbols.
