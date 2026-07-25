# SAGA — Brand Book

Edition 1.1 (light-led) · registry entry no. 001 · mark **Bar S**

This is the canonical, version-controlled brand book. It supersedes all
"JK Platform" and "JK Software" identity material.

A _brand book_ is the registry a jurisdiction publishes of every livestock
brand and the outfit entitled to burn it. That is what this document is, and
why it is structured as a numbered register: sections are meant to be cited
("per §3.2 the accent never carries body copy").

**Machine-readable tokens live at
[`apps/web/src/brand-tokens.css`](../../apps/web/src/brand-tokens.css)** — treat
that file and this document as one change. Assets are in [`assets/`](assets).

---

## 01 Foundation

### §1.1 The name

A saga is a prose history — an account of real people, real herds, real land,
told plainly and kept for generations. The word survives unchanged in English,
Portuguese and Spanish, and means the same thing in all three.

It is the only name this product could carry. SAGA's central technical
commitment is that history is append-only: nothing is overwritten, nothing is
deleted, and a correction is filed as a new and explicit entry. An animal's
record _is_ its saga — birth to sale, unbroken, in order, permanent.

Pronounced **SAH-gah** in all three languages. Set as `SAGA`. Never _Saga_,
never _S.A.G.A._ — it is a word, not an acronym, and it is never translated.

### §1.2 Brand idea

One line governs product, marketing, support and sales.

| Locale            | Line                  |
| ----------------- | --------------------- |
| en                | Nothing is forgotten. |
| pt-BR _(primary)_ | Nada se perde.        |
| es                | Nada se olvida.       |

Note the deliberate drift: Portuguese says _nothing is lost_, the sharper
promise for a rancher who has watched a phone die in a corral. We localise the
idea, never the wording. A literal back-translation is a failed translation.

### §1.3 Purpose, vision, mission

- **Purpose** — Livestock is the oldest continuously running enterprise on
  earth, and most of what it knows still dies with the notebook, the battery,
  or the person. SAGA exists to make that knowledge permanent, provable and
  useful, so a herd's history compounds instead of resetting.
- **Vision** — Every animal's history complete, portable and trusted: by the
  rancher who raised it, the vet who treated it, and the buyer who bought it.
- **Mission** — Give livestock enterprises one traceable system of record for
  animals, land, health, genetics, money and machines, working in the paddock,
  offline, in the operator's own language and currency.

### §1.4 Positioning (internal — not for publication)

For **livestock enterprises that are accountable for what they sell**, SAGA is
the **farm operating system** that keeps an **unbroken, auditable record of
every animal**, because it is built on an append-only ledger, offline-first
capture, and AI that must show its evidence — unlike spreadsheets that quietly
lose history, or generic ERPs never built for a living, breeding, moving
inventory.

### §1.5 Promise and proof

The brand may only claim what the system enforces. Each proof is a real
engineering invariant from [`CLAUDE.md`](../../CLAUDE.md). **If an invariant is
ever weakened, the corresponding claim comes out of the marketing.**

| #   | Claim                        | Enforced by                                                        |
| --- | ---------------------------- | ------------------------------------------------------------------ |
| 01  | The record holds             | Invariant 2 — append-only history; corrections are new entries     |
| 02  | The animal is the animal     | Invariant 3 — stable identity, independent of lot/paddock/tag      |
| 03  | The paddock beats the signal | Invariant 4 — offline workflows never silently lose an observation |
| 04  | The machine shows its work   | Invariant 6 — AI carries evidence, uncertainty, audit, approval    |
| 05  | Your herd is yours alone     | Invariant 1 — tenant isolation on every path, job, cache, export   |

### §1.6 Audiences

| Reader               | What they want                     | Speak in                        |
| -------------------- | ---------------------------------- | ------------------------------- |
| Principal / owner    | Margin, provenance, asset value    | Currency, risk, certification   |
| Farm manager         | Fewer surprises; work on time      | Plain instruction, exact counts |
| Technician / handler | Speed with gloves on and no signal | Few words, large numerals       |
| Veterinarian         | Protocols, withdrawal, compliance  | Precision, citations, dates     |
| Buyer / auditor      | Proof they can carry away          | Documents, identifiers, chain   |

The technician is the hardest and most important reader. If a screen fails in
dust, sun glare and gloves, it fails — however well it reads on a desk.

### §1.7 Personality — The Chronicler

Keeper of the record, with a streak of the steward. Not the disruptor;
agriculture has heard that voice and discounted it. Authority is earned by
being right, repeatedly, in public.

**We are** plain (not simplistic) · precise (not clinical) · warm (not folksy) ·
confident (not loud).

**We are not** disruptive (we are continuous) · playful (money and animals are
at stake) · rustic (no rope fonts, no wagon wheels) · silicon (no gradients
pretending to be intelligence).

---

## 02 Verbal identity

### §2.1 Message house

- **Roof** — Nothing is forgotten.
- **P1** One unbroken record — append-only from birth to sale; corrections are
  entries, not erasures.
- **P2** Built for the paddock — offline capture that cannot silently drop an
  observation.
- **P3** Money traced to an animal — cost, revenue and margin down to lot and
  head.
- **P4** AI that shows evidence — every recommendation cites its records and
  states what it does not know.
- **Foundation** — multi-tenant · append-only ledger · offline-first ·
  pt-BR / en / es · BRL, USD, EUR.

### §2.2 Boilerplate — use verbatim

**Short (en)** — SAGA is the farm operating system for livestock enterprises:
one unbroken, auditable record of every animal, from birth to sale, that keeps
working offline in the paddock.

**Short (pt-BR)** — A SAGA é o sistema operacional para pecuária: um registro
íntegro e auditável de cada animal, do nascimento à venda, que continua
funcionando sem sinal no pasto.

**Short (es)** — SAGA es el sistema operativo para empresas ganaderas: un
registro íntegro y auditable de cada animal, del nacimiento a la venta, que
sigue funcionando sin señal en el potrero.

**Long (en)** — SAGA is the farm operating system for livestock enterprises. It
holds animals, land, health, reproduction, genetics, inventory, finance and
machines in one tenant-isolated system of record built on an append-only
ledger, so history can be corrected but never quietly rewritten. Field work is
captured offline and reconciled on return. Recommendations arrive with their
evidence, their uncertainty, and an approval step.

### §2.3 Voice

Name the thing that happened and what to do next.

| Don't                                                       | Do                                                                                                          |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| "Revolutionise your herd with AI-powered insights!"         | "Every recommendation lists the records it was based on."                                                   |
| "Oops! Something went wrong."                               | "That weight isn't saved yet. It's queued and will sync when you're back in range."                         |
| "Utilise the platform to leverage data-driven decisioning." | "See which lots made money last month."                                                                     |
| "Delete animal?"                                            | "Animals are never deleted. Mark this one sold, dead, or recorded in error — the history stays either way." |

The last pair matters most: the product cannot delete an animal, so a delete
button lies. Voice and architecture must agree.

**Words we do not use** — revolutionary, seamless, cutting-edge, unlock,
empower, leverage, robust, solution, game-changing, effortless. Never call an
animal "inventory" or "a unit" in customer-facing copy: say **animal**,
**head**, **lot**.

### §2.4 Localisation

pt-BR is the default locale, not a localisation target. Copy is written in
Portuguese and adapted outward.

| Concern             | pt-BR (default) | en           | es         |
| ------------------- | --------------- | ------------ | ---------- |
| Locale tag          | pt-BR           | en-US        | es-ES      |
| Date                | 25/07/2026      | Jul 25, 2026 | 25/07/2026 |
| Decimal / thousands | 1.284,50        | 1,284.50     | 1.284,50   |
| Default currency    | R$ 1.284,50     | $1,284.50    | 1.284,50 € |
| Weight              | kg · @ (arroba) | kg           | kg         |

Currency is per **tenant**, not per locale — a Brazilian operation reporting in
USD is normal and must not be corrected to reais. Never hard-code a currency
symbol; reference the tenant's setting.

### §2.5 Brand architecture

SAGA is a master brand. Capability areas are descriptive and never spun into
sub-brands.

- **Do** — SAGA · Herd, SAGA · Health, SAGA · Finance, SAGA · Field
- **Don't** — SagaHerd™, HerdIQ, SAGA Nexus, Bovina AI

**The AI is not a character.** Never give the recommendation engine a persona,
name, face or first-person voice. It says "Based on 42 weight records…", never
"I think…". A system that must show evidence cannot also be a friendly mascot.

---

## 03 Visual identity

### §3.1 The mark — Bar S

Livestock branding is the oldest persistent identity system humans built: a
geometric mark, burned once, readable across a paddock, registered in a book.
Our mark is drawn as a brand iron and named the way brands are named aloud — a
letter and its modifier. This one is **Bar S**.

Uniform stroke, round terminals, no fill, no detail a hot iron or an embroidery
needle would lose. The bar is not decoration: in brand vocabulary it is the
modifier that makes the mark specific, and here it doubles as the ledger line
the S is written on.

| Use                  | Minimum       |
| -------------------- | ------------- |
| Mark, screen         | 24 px         |
| Mark, print          | 8 mm          |
| Horizontal lockup    | 96 px / 25 mm |
| Branded / stencilled | 40 mm         |

Clear space equals the height of the bar on all four sides. Below the lockup
minimum, drop the wordmark and use the mark alone.

**Never** rotate, stretch, recolour off-palette, place on a gradient, add a
shadow or bevel, set the wordmark in sentence case, or add a container the mark
does not have.

Assets: [`saga-mark-bar-s-ink.svg`](assets/saga-mark-bar-s-ink.svg) ·
[`saga-mark-bar-s-paper.svg`](assets/saga-mark-bar-s-paper.svg) ·
[`saga-app-icon.svg`](assets/saga-app-icon.svg)

> **Lockup files are not committed.** The wordmark requires Archivo Expanded
> outlined; generate lockups in the design tool with the licensed face rather
> than substituting a system font.

### §3.2 Colour — Paper and Tag

The identity is **light-led**. Its two dominant surfaces are a bright
cool-green paper and the high-visibility yellow of a livestock ear tag — both
functional colours in this industry before they are aesthetic ones. Deep tone
appears as _type_, not as a field.

The neutral is deliberately cool and faintly green: ledger stock, not warm
cream. Warm cream with a terracotta accent is the reflexive palette for
anything agricultural and would make SAGA look like every other farm brand.

| Name     | Hex       | Role                                                          |
| -------- | --------- | ------------------------------------------------------------- |
| Paper    | `#F4F6F1` | Dominant ground, everywhere                                   |
| Tag      | `#E8B317` | Signature **field** — covers, bands, underlines, icon         |
| Tag Wash | `#FBF1D2` | Quiet field for callouts                                      |
| Tag Text | `#8A6A0E` | Text-safe ochre, where an ochre must behave like type         |
| Pasto    | `#2E7D4F` | Positive state — healthy, synced, cleared for sale            |
| Hide     | `#C0491F` | Attention — withdrawal periods, blocks, destructive actions   |
| Ink      | `#222B26` | **Type only** — headings, body, the mark. Never a large field |
| Slate    | `#5A6560` | Secondary type, rules, disabled                               |

**Two rules that catch everyone:**

1. **Tag never carries text on paper.** Yellow on Paper is 1.8:1 — invisible.
   Tag is a field with Ink type on it (7.5:1). For ochre type use `#8A6A0E`.
2. **Ink is a type colour.** It does not ground covers, cards, navigation or
   signage.

Measured contrast:

| Pair            | Ratio  | Body text |
| --------------- | ------ | --------- |
| Ink on Paper    | 13.3:1 | Pass AAA  |
| Ink on Tag Wash | 12.8:1 | Pass AAA  |
| Ink on Tag      | 7.5:1  | Pass AAA  |
| Slate on Paper  | 5.6:1  | Pass AA   |
| Pasto on Paper  | 4.7:1  | Pass AA   |
| Hide on Paper   | 4.6:1  | Pass AA   |
| Tag on Paper    | 1.8:1  | **Never** |

Brightening the ground to `#F4F6F1` is what lifted Pasto and Hide over the
4.5:1 body-text threshold — on a darker paper both were large-text-only. The
lighter palette is measurably more accessible here, not merely a preference.

**Single visual world.** SAGA does not ship an inverted dark identity. If
pre-dawn field use later demands a low-light screen mode, that is a product
accessibility decision requiring its own validation pass — not a second brand
palette, and not a licence to invert marketing.

### §3.3 Typography

A registry is set in a grotesque and a monospace, not a magazine serif.

- **Archivo Expanded** — display. Plaque-wide grotesque, drawn by Omnibus-Type
  with Latin-American diacritics as a first concern.
- **Archivo** — body and UI. Same skeleton, normal width.
- **IBM Plex Mono** — every identifier, weight, date and amount.

All three are OFL-licensed, so they may legally embed in the shipped
applications — a hard requirement, not a preference.

Rules:

- Identifiers, weights, currency and dates are **always** mono with
  `tabular-nums`.
- Display is uppercase, tracked `-0.02em`. Body is never letterspaced.
- The wordmark is tracked `+0.09em` — it is drawn, not typed.
- Running text stays near 65 characters.

### §3.4 Data visualisation

**The accent is not a data colour.** Tag is the signature and a poor series
colour — too light and too low-contrast to carry a bar. Charts draw from a
separate palette, in a fixed order that never cycles.

Every adjacent pair clears colour-blind separation, sits inside the lightness
band, holds chroma above the grey floor, and passes 3:1 against Paper. Warm and
green hues are interleaved with blues and violets so no two neighbours sit on
the red-green axis that protanopia collapses.

| Slot | Hex       | Role                                |
| ---- | --------- | ----------------------------------- |
| 01   | `#C0491F` | First series — brand-adjacent red   |
| 02   | `#1F6FA8` | Cool, maximum separation from 01    |
| 03   | `#2E7D4F` | Pasture green                       |
| 04   | `#7B4FA8` | Violet, breaks the warm run         |
| 05   | `#B07A0B` | Ochre — the data-safe cousin of Tag |
| 06   | `#B23A6F` | Magenta                             |

A seventh series is never a generated hue: fold it into "Other", facet into
small multiples, or cut it.

- **One axis, always.** Never two y-scales; two measures means two charts or an
  indexed base.
- **Colour follows the entity** — filtering must not repaint the survivors.
- **Sequential** one hue light→dark; **diverging** two poles through neutral
  grey, never a hue at the midpoint.
- **Status is reserved** — Pasto and Hide mean state, never "series 3", and
  always ship with a label or icon.
- **Uncertainty is visible** — a prediction without a stated interval violates
  §1.5 proof 04.
- **Units always** — kg, @, R$, kg/ha. A bare number is a bug.

### §3.5 Iconography and imagery

**Icons** — 24px grid, 1.75px stroke, round caps and joins, no fill.
Geometric, at most one organic curve each. Drawn from the work: ear tag, scale,
syringe, gate, paddock, straw, bale, ledger. Never a metaphor the reader must
decode.

**Photography** — Do: real animals in daylight; working hands with dirt on
them; mid-action; Portuguese signage in frame; texture close-ups of hide, tag,
grass. Don't: golden-hour cowboy silhouettes; laughing-farmer-with-tablet
stock; spotless boots; American West iconography; animals styled like product.
Treatment bright and airy, shadows open rather than crushed.

### §3.6 Motion

Motion confirms, never decorates.

- 160–240ms, ease-out for entrances. Nothing bounces.
- A captured weight gets one 200ms stamp-down of the mark — the single moment
  of delight we allow.
- A pending offline queue pulses slowly. Never an indeterminate spinner: it
  reads as data loss.
- `prefers-reduced-motion` is honoured everywhere, no exceptions.

---

## 04 Applications

- **Console** — Paper ground, white panels. Active navigation is an Ink label
  with a Tag underline, never Tag type. State is carried by shape and label as
  well as colour, so it survives greyscale, sun glare and colour-blindness.
- **Traceability packet** — the brand's most persuasive artefact and the thing
  a buyer or auditor carries away. It must look like a record, not a brochure:
  mark, identifiers in mono, the event chain in order, and an integrity hash.
- **Field** — legible at distance, in motion, in bad light. Yellow does the
  heavy lifting; it is the colour agriculture already uses for "look at this".
  Ear tags, gate signs and cards are Tag grounds with Ink type.
- **App icon** — Ink mark on Tag, 20px corner radius on a 96px grid. The mark
  alone; never the wordmark at icon scale.
- **Reproduction floor** — one colour only. Stencil and brand: mark alone,
  stroke thickened 15% to survive burn spread. Embroidery: 40mm minimum, bar
  merged into a single satin stitch.

---

## 05 Governance

### §5.1 Naming law

**"JK Platform" and "JK Software" are retired.** They appear in no new material
of any kind, and survive only as a historical footnote against specification
§92 so old documents remain traceable.

| Context                | Correct       | Wrong              |
| ---------------------- | ------------- | ------------------ |
| Product, all languages | `SAGA`        | Saga · S.A.G.A.    |
| First mention, formal  | `SAGA®`       | SAGA (JK Platform) |
| Company reference      | `SAGA`        | JK Software        |
| Module                 | `SAGA · Herd` | SagaHerd · HerdIQ  |

Internal identifiers are deliberately **not** rebranded: the `@jk/*` package
scope, the `jk_app` database roles, the specification id `JK-PLT-EES-001` and
error codes such as `JK-FORBIDDEN` are structural or contractual values.
Renaming a published error code breaks every integrator. Brand rules govern
what humans read, not what machines match on.

### §5.2 Files and approvals

Assets are lower-case and hyphenated, colour named last:
`saga-mark-bar-s-ink.svg`. No version suffixes on marks — the mark does not
version.

| Change                          | Needs                                     |
| ------------------------------- | ----------------------------------------- |
| New copy in an approved pattern | No review                                 |
| New boilerplate or endline      | Brand owner                               |
| Palette or type change          | Brand owner + accessibility re-validation |
| Mark change                     | Founder sign-off                          |
| New claim in §1.5               | Engineering confirms the invariant holds  |

### The standing test

Before anything ships, ask: **would a rancher who has been lied to by software
before believe this?** If the honest answer is no, it is not ready — however
good it looks.
