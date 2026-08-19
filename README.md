# Factory OS

Production planning for a shoe factory. Photograph a handwritten order slip → an AI reads it
into structured lines → clerk checks it and prices it → Proforma Invoice → the order joins the
order sheet → dispatch dates, machine load and material procurement recompute for every order.

Vite + React frontend, Vercel serverless functions, Postgres.

---

## The one thing to understand first

**The planner has no AI in it.** `shared/engine.js` is a pure function: give it the list of
orders plus the four reference tables and it returns the whole plan. No database, no network,
no clock. Everything valuable in this app lives there, and it's independently testable —
`npm test` exercises it with no infrastructure at all.

The AI does two narrow jobs: reading a photo into structured data, and narrating numbers the
engine already computed. It never calculates. If it starts producing dates or quantities of
its own, the app stops being reproducible.

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Create a Postgres database

Vercel has no database of its own — Vercel Postgres was discontinued in December 2024 and
everything moved to the Vercel Marketplace. You provision from the Vercel dashboard, Vercel
injects the credentials, and it lands on one bill. Fastest path:

```bash
vercel install neon
```

That creates the database, links it to the project, injects `DATABASE_URL`, and pulls it into
`.env.local`. Neon is the direct successor to Vercel Postgres.

**Pick Supabase instead if you want auth bundled in** — see known gap 1. It's also a Marketplace
provider, so still one Vercel bill. Neon is Postgres only; you'd add Clerk or Auth0 separately.

Nothing in this codebase is provider-specific: it uses the standard `pg` driver and a plain
`DATABASE_URL`. Neon, Supabase, Aurora, Railway, RDS and local Postgres all work unchanged.

Two notes:

- **Use the pooled connection string** (Neon's `-pooler` host). Serverless functions open
  connections per invocation and will exhaust a direct endpoint. `api/_lib/db.js` also caps
  its pool at 3 per function for this reason.
- **Do NOT install `@vercel/postgres`.** Vercel no longer maintains that driver. Any tutorial
  recommending it is out of date.

### 3. Apply the schema

```bash
psql "$DATABASE_URL" -f db/schema.sql      # or: npm run db:setup
```

Safe to re-run. Creates two tables and the order-number sequence.

### 4. Environment variables

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `ANTHROPIC_API_KEY` | yes | from `console.anthropic.com` — a separate account and bill from a Claude subscription |
| `AI_MODEL` | no | defaults to `claude-sonnet-4-6` |
| `PGSSL` | no | set to `disable` only for local Postgres without TLS |

On Vercel these go in **Project → Settings → Environment Variables**. Set them for Preview and
Production, not just Development — a missing key in Production is the classic "works locally,
401 in prod" failure.

### 5. Run

```bash
npm run dev          # vercel dev — serves the UI and /api together
```

`npm run dev:ui-only` runs Vite alone; the UI loads but every API call fails, which is
occasionally useful for pure styling work.

### 6. Deploy

```bash
vercel
```

Vercel auto-detects Vite and the `/api` directory. No build configuration needed beyond
`vercel.json`, which only raises the function timeout for the AI calls.

---

## Layout

```
shared/            imported by BOTH the browser and the server
  inputs.js        reference data: articles, combos, material rates, stock, work centres
  engine.js        the planner — pure, no imports
  bridge.js        size-roll mapping, packing chart, article matching, the read prompt
src/
  App.jsx          the entire UI
  lib/client.js    thin wrapper over our own API — the browser talks to nothing else
api/
  _lib/ai.js       the ONLY file that reads ANTHROPIC_API_KEY
  _lib/db.js       pooled Postgres client
  _lib/http.js     error handling, deliberately free of db/provider imports
  orders/          GET list · POST create · PATCH priority · DELETE
  settings.js      machine capacities (shared config, not per-browser)
  read-order-photo.js
  copilot.js
db/schema.sql
tests/engine.test.mjs
```

### Data flow

```
browser ──▶ /api/*  ──▶ Postgres          (order sheet, capacities)
                    └─▶ api/_lib/ai.js ──▶ provider   (key lives here only)

engine runs IN THE BROWSER on the order list + reference data.
```

The engine runs client-side because it's pure and fast, and because keeping it framework-free
means it can move server-side later without changing a line. If you want the plan computed
once and shared, import the same module from a new function under `/api`.

---

## What changed from the prototype

The prototype was a single file running inside a chat artifact. Four things were borrowed from
that sandbox and now have real implementations:

| Prototype | Now |
|---|---|
| Sandbox injected AI auth; no key existed anywhere | `api/_lib/ai.js` reads `ANTHROPIC_API_KEY` server-side |
| `window.storage` — **per-user**, so no shared order sheet | Postgres `orders` table |
| Order numbers computed in the browser from `max(existing) + 1` | Postgres sequence, collision-proof |
| Capacities in React state, lost on reload | `settings` table |
| React + Tailwind provided for free | real Vite build, Tailwind v3 |

Two behaviour changes worth knowing:

- **Order numbers are assigned by the server.** The intake screen no longer picks them; it
  posts drafts and displays whatever numbers come back. This is what makes two clerks saving
  simultaneously safe.
- **The API rejects unknown combos** (`api/orders/index.js`). In the prototype an unrecognised
  combo would consume machine capacity but order zero material — a silent under-buy. Test E
  documents the behaviour; the endpoint now refuses it at write time.

Also removed: eight demo orders sat unreferenced in the reference data. Nothing read them.

---

## Tests

```bash
npm test
```

No database, no network, no install beyond `npm install`. Five groups:

- **A** empty input doesn't throw
- **B** one order, hand-checkable: dispatch 2026-07-09, and 0.065037 × 960 = **62.44 MTR**

`npm test` also runs `tests/pi.test.mjs`, which reconciles all nineteen lines of the real
invoice PI/596 — every size, rate and amount — plus the deduction ladder and the payment split.
- **C** the molding machine is one machine — PVC, PU and EVA occupy days 24–26, 27–29, 30–33
- **D** contention invariants: block length is exactly `ceil(qty/capacity)`, no overlaps, no
  overbooked days, every pair reconciled, priority respected
- **E** an unknown combo shows up in `unknown_combos` rather than vanishing

**If D fails, the scheduler is wrong regardless of how plausible the dates look.** That test
exists because the model originally had three separate molding centres, which let three orders
mold simultaneously and implied 3,700 pairs/day of capacity the factory does not have. They are
one machine. Collapsing them turned 8 of 14 test orders from "on track" into SLA breaches —
the dates were wrong, not the SLA rules.

---

## Real data vs placeholders

**Real**, from the client's BOM compilation — don't regenerate or round these:
articles, combos, material rates, the packing chart.

The reference data now holds **13 articles and 109 materials**. JILL, ARMOUR, PERCY, SPADE and
SPIKE were loaded from the client's per-article BOM workbooks (894 rate rows across 25 size
ranges). Notes on that load:

- Their `BURN` column is the per-pair rate, used directly.
- All five are **EVA, client-confirmed** (`sole_assumed: false`). Every other article's sole
  type is still a guess — see known gap 2.
- The **sole was absent from every sheet and from the original data entirely**. It is now
  `SOLE 1231 EVA||PAIR` at 2 per pair, matching how the client records insoles.
- Velcro, back tape and polyester binding were recorded in CM and converted to MTR (82 rows),
  so they merge with the existing MTR materials instead of duplicating them.
- 11 materials merged into existing entries and keep their real stock; 38 are new at stock 0.
- 21 rows had no rate (`#DIV/0!` in the source). They are complementary by size range —
  e.g. JILL 6X8 uses 25mm velcro and 11X1 uses 20mm — so they were skipped as "not used here".

**Placeholder**, needs the client's actual figures:
- every `stock` value in `inputs.js` — the 38 materials added with the five new articles are
  at **0**, so procurement lists their full requirement rather than a netted shortfall. That
  errs toward over-ordering, which is the safe direction, but replace them with real figures
- every `capacity_per_day` — all five are guesses
- prices, which are per-article and typed on the PI

Until stock is real, the procurement list is illustrative rather than actionable.

---

## Known gaps

Ordered by how much they matter.

1. **No authentication.** Anyone with the URL can read and write the order sheet. This is the
   blocker before it goes near a factory floor. If you haven't chosen a database yet, this is
   the one argument for Supabase over Neon — it bundles auth, so you solve both at once.
2. **Sole types are guesses for 4 of 13 articles.** Confirmed by the client: JILL, ARMOUR, PERCY,
   SPADE and SPIKE are EVA; SILKY BELLY and REX GOLA are PVC. Still guesses:
   SMART BOY (PVC) and ARMOUR (VELCRO)/(LACE) (STUCK-ON). The stuck-on pair matters most —
   that is the one guess that routes an article to a different machine.
3. **Molding runs at one rate for all sole types.** The prototype implied PVC 1200 / PU 1000 /
   EVA 1500 — different cycle times. It's now a single 1200/day. Because the machine is
   exclusive, a per-sole rate is easy to add: one order occupies it at a time, so the rate can
   follow whichever order is on it. Needs the client's real numbers.
3. **Changeover time is zero.** Switching the machine from PVC to EVA presumably costs a mold
   change or purge. The next order currently starts the very next day.
4. **`validateSchedule` doesn't check exclusivity.** It catches over-capacity days and broken
   stage ordering, but the no-overlap invariant on exclusive machines is only enforced by test
   D. Worth adding to the validator itself.
5. ~~Reference data is a file, not tables.~~ **Done.** Reference data now lives in the
   `reference_data` table and is uploaded through the Data & BOM tab. `shared/inputs.js` is only
   the seed used on first run. See "Adding BOMs and catalogue" below.
6. **No audit trail.** Worth storing the source photo and what the AI originally read
   alongside the clerk's corrections — that's how you find out whether the reader is any good.
   Vercel Blob is first-party and built for exactly this; no Marketplace provider needed.
7. **Database cold starts.** Serverless Postgres sleeps when idle and the first request after
   that takes noticeably longer. Survivable for a pilot; irritating for a clerk mid-shift.
   Keeping one compute unit warm costs more and fixes it.
8. **Sole sticking is capacity-pooled**, not exclusive — assumed to be a bench line with
   several stations rather than a single machine. Confirm with the client.

---

## Adding BOMs and catalogue — no deploy needed

This is the split that matters for day-to-day use:

| Change | Example | Goes through |
|---|---|---|
| **Code** | a new tab, a bug fix, the PI layout | `git push` → Vercel redeploys |
| **Data** | BOM workbooks, catalogue, stock, prices, capacities, delivery targets | the app itself → database |

**BOM upload.** Data & BOM tab → pick the sole type → choose one of the per-article workbooks in
the factory's existing layout. The sheet is parsed in the browser by `shared/bom-import.js` — the
same module the server validates against, so the preview is exactly what gets stored. The preview
reports anything it had to interpret: CM→MTR conversions, unit typos, and rows whose rate cell was
unusable. Confirm and it writes to `reference_data`. The article is live immediately, including in
the order reader's vocabulary.

**Catalogue.** One card per article, generated from the reference data. Photos are resized to
640px in the browser and stored as data URLs. Move to Vercel Blob if the images get large.

**Stock.** The Data tab lists every material sitting at zero and lets you fill them in. Until
they're real, procurement shows full requirements instead of shortfalls — it over-orders rather
than under-orders.

**Delivery targets.** Machine load tab. See "How lateness is decided" below.

## Order remarks, order nature, and attachments

`pi` is a free-form JSON blob on each order (no schema migration needed to extend it), and now
carries `remarks`, `order_nature` (MTS / Institutional / MTO), and `attachment` (a base64
screenshot). Set on intake — both the photo/manual flow and the PI-read flow — and editable
afterward from **Orders &amp; Dispatch → Edit**, which is also where this data now shows in the
order's detail row. `PATCH /api/orders/:order_no` **merges** the `pi` blob rather than replacing
it, so editing just the remarks can't silently wipe `pi_no` or the price.

## Editable PI review

After reading an existing PI, the per-size quantities the reader extracted are now editable
before saving — previously only the header fields (party, city, discount) had inputs, so a
misread quantity had no way to be corrected before the order was scheduled.

## Single sizes vs combination packs

The factory's own packing chart draws a real distinction: a **SINGLE PACKSIZE** is one size
sold on its own, at its own pairs-per-carton rate; a **COMBINATION PACK** is a named range of
sizes (like `6X8`) packed and priced together. `mapToCombo` used to collapse that distinction —
every parsed size, even one that matched no combo, was snapped to the *nearest* range combo, so
a genuinely individual-size order silently became a combination-pack order with the wrong
quantity and the wrong (or missing) material rate.

It no longer does that. A size that falls inside a named combo still matches it normally. A size
that doesn't is returned as `{combo:null, single:"8"}` rather than guessed, and the intake screen
shows it as its own line with an amber note rather than folding it into a combo silently. Its
carton size comes from `packing_singles` (the chart's blue rows) when known.

**The real limit this doesn't remove:** the BOM only has material rates per named combo. A
single-size line, correctly identified as such, still can't be costed or scheduled until you
tell the app which combo's rates it should draw from — that's a data gap, not a bug, and the app
now says so explicitly instead of hiding it. Saving is blocked until every single-size line has
a combo picked or its cartons are zeroed out.

## AI copilot — what it can see

The copilot only answers from the state it's handed — it never recalculates. That state now
includes, per order, its **worst stage**: which stage is causing any At risk / Delayed status
and by how many days it slipped past target, not just the headline colour. It also gets the
per-machine utilisation and busy-day counts, `schedule_problems`, and any `unknown_combos`
flagged on an order.

If it's giving vague answers again, the first thing to check is whether that detail actually
reached it — log `ctx` in `askAI()` (App.jsx) and confirm `worst_stage` is populated on the
orders you're asking about, and that `machines` shows real utilisation numbers rather than
zeros.

## Proforma Invoices

The PI matches the format the factory already issues: one row per size, MRP and rate per row,
then the deduction ladder and the payment split.

**Reading an existing PI.** Intake &rarr; **Upload a PI**, accepting a PDF or a scan. Per-size
quantities are stored exactly as printed rather than re-derived from carton counts, so a PI
read in and re-issued reproduces line for line.

**Generating one.** Combos explode into their sizes, and a combo total is split across those
sizes with the remainder going to the earliest &mdash; 750 across 4 sizes becomes
188/188/187/187, matching how the factory writes them.

**Size runs.** Positions 6&ndash;13 of the roll are the kids run, printed with an `s` suffix;
1&ndash;5 are adult. `B` combos are the adult repeat of the same numerals, 6&ndash;12, printed
without a suffix. This is why one invoice legitimately shows both `8s` and `8`.

**The ladder** (`settings.pi_terms`, editable): rate = MRP less the customer discount, rounded.
Then F.O.R., Cash Discount and GST Dis are deducted **in order, each from the running balance**,
and GST is added to what is left. Re-ordering the steps changes the total, so the order is
preserved as stored.

**MRP** lives in reference data per article per size range, editable in **Data &amp; BOM**. An
unpriced range prints as a dash and is excluded from the total rather than guessed, and the
invoice carries a visible note naming what is unpriced.

> **Known defect in the source spreadsheet.** On the reference invoice PI/596, the stated
> subtotal is 23,84,731 while the nineteen lines sum to 24,35,606 &mdash; short by exactly the
> first line (125 @ 407 = 50,875). The SUM range appears to start one row late. Carried through
> the ladder that under-invoices by 48,363 on that one PI. This app sums every line; test E in
> `tests/pi.test.mjs` locks that behaviour in.

## How lateness is decided

Each stage has a target measured in days from the order date — by default cutting 8, stitching 15,
printing 18, molding 22, assembly 22, packing 28, dispatch 30. For each stage,
`slip = actual finish − target`. Zero or less is **On track**, 1–3 days over is **At risk**, more
than 3 is **Delayed**. An order takes the worst status of any of its stages.

Those defaults encode a 30-day order-to-dispatch promise that was never confirmed with the factory,
so they are editable in the Machine load tab and stored in `settings`. Changing them re-colours
every order without moving a single date — the schedule is unchanged, only the promise it is
measured against.

## Article photos

`shared/catalogue-seed.js` holds the 21 article photos and MRP bands extracted from the client's
catalogue PDF, resized to 420px JPEG (~400 KB total). `articlePhoto(code)` maps a system article
code onto its catalogue entry, since one catalogue name covers several coded variants — "Gola"
serves REX GOLA (V), (L) and PLUS.

Every PI uses the Catalogue tab's uploaded photo when there is one and falls back to the seeded
catalogue photo otherwise, so invoices picture the right shoe with no manual step.

12 of the 14 loaded articles have a photo. **PERCY and SPADE do not** — they have BOMs but no
catalogue entry. 15 catalogue articles (Toddler, Courage, Jem, Thunder, Ryder, Glide, Grace,
Bolt, Nova, Swan, Trek, Symbol, Apex, Aero, Tennis shoe) have photos and MRP bands but no BOM,
so they cannot be scheduled or costed yet.

## Multi-article invoices, and per-article images

A PI can cover several articles. Each item carries **its own MRP table and its own catalogue
photo**, because pricing one article against another's MRP is silently wrong money — that
defect existed and is now fixed, with test H in `tests/pi.test.mjs` locking it in. The renderer
groups rows per article and spans each photo over exactly the rows it belongs to.

`buildPI` accepts either shape. Pass `order.items` (each with `article_code`, `mrp`, `image`,
`lines`) for multi-article; the older single-article call still works unchanged, which is why
the original PI/596 reconciliation tests are unaffected.

Article photos come from the Catalogue tab — upload one per article there and it flows into
every invoice for that article automatically.

## Interface

Thirteen screens is past what a row of tabs can carry, so navigation is a grouped sidebar:

- **Orders** — PI generation, Bulk upload, Orders &amp; dispatch, Dispatch &amp; packing
- **Production** — Schedule, Production plan, Machine load
- **Materials** — Procurement, Stock register
- **Setup** — Parties &amp; terms, Catalogue, Data &amp; BOM

Copilot sits on its own at the foot of the sidebar. On narrow screens the sidebar collapses to a
grouped dropdown.

**Sidebar badges show work outstanding** — orders at risk, materials short — so the nav answers
"what needs me?" without opening anything. They are driven by live computed state, not decoration.

The five KPI cards became three figures in a sticky header alongside the view's name and a line
saying what the screen is for. That reclaims most of a screenful of vertical space on every view.

Type is deliberate rather than default: **Barlow Condensed** for labels and headings (the
condensed caps of factory signage), **Inter** for body, **IBM Plex Mono** with tabular figures
for every number — the numbers are the content here, so they get their own face and stay aligned
in columns. The palette is steel navy against near-white with a working blue accent; warm ambers
and rose are reserved for genuine attention states so they still mean something.

## Work centres and routing

Seven stages, eleven work centres:

`CUTTING → PREPARATION → STITCHING → UPPER_QC → MOLDING → PACKING → DISPATCH`

**PREPARATION** (printing and preparing cutting) sits between cutting and stitching.
**UPPER QC & preparation** sits between stitching and molding. **Packing and dispatch are
separate stages** — dispatch has its own capacity rather than being an instant marker, which is
why an order now takes three days longer end to end than under the old five-stage model.

**Molding is several machines, not one.** PVC rotary, PVC vertical, PU, and EVA are distinct
physical machines; each is exclusive (one order at a time) but they run *in parallel with each
other*. Stuck-on articles go to sole sticking, which is a pooled line. Which PVC machine an
article uses comes from its `molding_machine` field (`ROTARY` / `VERTICAL`), set in
**Machine load → PVC molding**. Anything unassigned falls back to rotary, which inflates
rotary's load and understates vertical's — the panel says how many are still unset.

**Every capacity is a placeholder and every one is editable** in Machine load. The list is
derived from reference data rather than hardcoded, so adding a work centre makes it appear
there automatically, ordered by production sequence.

**Per-order lead time.** Outside stitching adds transport days, in-house adds a preparation
window, and printing adds its own — set per order in intake, configured in
`INPUTS.lead_time_rules`. All three day counts are placeholders.

## Ordering a specific size

The factory writes orders both ways — a whole range ("6X8, 5 cartons") and a single size
("size 8, 40 pairs"). **Add a specific size** appears in intake and in Orders &amp; Dispatch → Edit.

A single size needs two things it doesn't carry by itself:

- **Material.** The BOM prices per *range*, not per size, so a single size borrows a range's
  rates. Where a size sits in more than one range — JILL's `11s` is in both `11X1` and `9X12` —
  the picker asks which rather than choosing for you.
- **Packing.** Pairs per carton comes from the chart's SINGLE PACKSIZES rows, falling back to
  the range's own pack rate. If neither exists, the field is left for you to type; nothing is
  guessed, because a wrong pack quantity changes the pair count, the material requirement and
  the dispatch date together.

A size outside every range can still be ordered — you pick which range's rates it should be
costed at, and the screen says plainly that's what it's doing.

Internally a specific size is stored as an ordinary line on its borrowed range carrying a
`sizes` map, the same shape a PI-read line uses, so the planner, the invoice and the dispatch
tracker all handle it with no special cases. `tests/sizes.test.mjs` covers this.

Two bugs fixed alongside it: ranges ending in `S` (`7X10S`) exploded to *no sizes at all*,
hiding the whole range; and pack quantity didn't recognise the `s` suffix on kids sizes, so
`8s` resolved to nothing.

## Dispatch and packing reports

**Dispatch & packing** tab. A packing report records what actually shipped against an order, by
size range, as **partial**, **full**, or **shortage**. Pending = ordered − dispatched, shown in
pairs and (where a packing chart exists) in cartons.

**Complete order despite shortage** closes an order with part of it never delivered. It ships
whatever is entered, then stops the balance counting as pending — but records it as a
**shortfall** against the order rather than erasing it, because an order closed 40 pairs short
must still be answerable for those 40. The panel states the exact shortfall before you confirm,
and confirms again on click. Closing an order that is already fully shipped reads "complete",
not "closed short".

Dispatches are their own table and never edit the order, so what was ordered stays auditable
against what shipped. The API refuses a dispatch for a size range that isn't on the order, or
for more than remains outstanding — an over-dispatch would show as negative pending and quietly
corrupt the shortage figure.

## Parties and terms

**Parties & terms** tab. Discount, the ordered deduction ladder, GST, payment split and dispatch
timeline are held per customer. Invoices read them and show them read-only — a PI cannot quietly
deviate from the agreed terms, which is the point of holding them here. Removing a party
deactivates rather than deletes it, since existing orders reference it.

## Stock register

**Stock register** tab, laid out to match the factory's own STOCK MASTER sheet: S.N · Category ·
Item Description · Size · UOM · Opening Stock · Rec. · Issue · Stock · Min. Stock · Alert ·
Order Qty · Rate · Stock Value.

`Stock` is derived, never typed: **Opening + Rec − Issue**. That identity is what makes the
register auditable — a stock figure that can be edited directly can't be reconciled against
movements. `Alert` fires and the row turns red when stock falls below Min. Stock, and Order Qty
is the shortfall. Categories are pre-filled by a name-matching guess and are editable; the guess
is a starting point, not an authority. Exports to xlsx in the same column order.

Editing here also updates `materials.stock`, so **procurement nets against the same number** the
register shows rather than a second, drifting copy.

## Bulk order upload

**Bulk upload** tab. One row per size range; rows sharing party + date + article merge into a
single order with several lines. Give either `Pairs` or `Cartons` — cartons convert through the
packing chart, and pairs wins when both are present so no packing assumption is needed.

Columns (order doesn't matter, names do; common aliases like Qty/Ctn/Customer are accepted):
`Party`, `Order Date`, `Article`, `Size Range`, `Cartons`, `Pairs`, `Priority`, `Order Nature`,
`Remarks`. A blank template is downloadable from the tab itself.

**Nothing is imported while any row is rejected.** A partly-imported batch is harder to unpick
than a corrected sheet, so the preview lists every bad row with its reason and the import button
stays disabled until the sheet is clean. Article and size-range names are validated against live
reference data — the same guard that stops an unknown combo consuming capacity while ordering
zero material.

## Known open requests from the client

Received as two feedback documents, 2026-08-04. Status of each:

- **PI upload not editable** — fixed, see "Editable PI review" above.
- **Order remarks / order nature / screenshot attachment** — fixed, see above.
- **Order modification** — already existed (Orders &amp; Dispatch → Edit); now also covers
  remarks/nature/attachment.
- **Multi-article PI pricing bug** — caught and blocked, not yet properly supported; needs a
  decision on whether combined invoices are actually required.
- **Excel bulk order upload** — not started. Needs the client's fixed field template before
  building; guessing the mapping risks the same silent-wrong-quantity failure mode as an
  unvalidated BOM import.
- **"PI addition in a separate tab" / initial party-nature tab** — the intake tab is already
  separate from order management; unclear whether the client means a deeper restructuring.
  Needs a concrete description of the desired tab layout before rebuilding navigation.
- **Audit trail on edits** — blocked on authentication (known gap 1) — there is no user identity
  to attach an edit to yet.

## Swapping the AI provider

Everything provider-specific is inside `callModel` in `api/_lib/ai.js`. Reimplement it so it
still returns a plain string and nothing else changes — not the endpoints, not the UI. That
applies to another hosted model, a self-hosted one, or an OCR service plus a parser that
fuzzy-matches against the known article and combo lists.

Whatever reads the slip, keep the validation in `api/orders/index.js`. A confidently wrong read
is worse than a failed one, and that endpoint is the only thing standing between a
misread combo and a silent under-buy.
