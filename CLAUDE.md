# Factory OS — project context

Read this before making any change. It is the accumulated context of the project,
including several hard-won corrections that were expensive to discover.

---

## What this is

Production planning for an Indian shoe factory (brand: REX). A clerk photographs a
handwritten order slip or uploads an existing Proforma Invoice; an AI reads it into
structured order lines; the clerk checks and prices it; a PI is generated in the
factory's exact format; and the order joins a shared order sheet.

Everything downstream then recomputes automatically for every live order: dispatch
dates stage by stage, machine loading day by day, material procurement netted
against stock, and delivery risk per order.

Live on Vercel, Postgres on Neon.

---

## The single most important architectural fact

**`shared/engine.js` is a pure function.** Give it orders plus reference data and it
returns the whole plan. No database, no network, no clock, no framework.

It has survived every round of changes without breaking, because it is pure and
covered by tests. Keep it that way. If a new feature needs a calculation, the
calculation goes in `shared/` with a test, and the component calls it.

Everything reads from the **orders** table. Schedule, procurement, machine load and
dispatch all derive from it. Nothing else is visible to the planner.

**The plan is automatic; the planner outranks it.** Each order carries a
`plan_override` blob (`orders.plan_override`), fed into `compute()` as
`opts.overrides`. Four things can be forced, all optional:

| Field | Means |
|---|---|
| `seq` | queue POSITION, not a score — `1` runs first, `2` runs second |
| `start_on` | pin the release date, in either direction |
| `machine` | `{STAGE: WORK_CENTRE}` — which machine a stage runs on |
| `days` | `{STAGE: n}` — finish that stage in exactly n days |

**Nothing here is ever refused.** A stage pinned to one day gets one day even
when that needs 9,000 pairs from a 2,500-pair line; the engine carries it out
and returns the cost in `plan_warnings`. A day overbooked *because it was told
to* is recorded in `forced_load` and is deliberately NOT a
`schedule_problem` — leaving it in both lit the red "broken plan" banner on
every deliberate override. Because the whole plan is recomputed from the
overrides, procurement, machine load, SLA and the dashboard all move together;
nothing is patched onto a stale schedule. Clearing the blob to `{}` hands the
order back to the automatic planner.

---

**Shortfall is attributed by consumption order, not divided up.** Stock is
shared, so "what is this PI short of" only has an answer once you fix who takes
the stock first. `netByOrder` walks orders in the sequence the plan runs them;
each takes what it needs from what is left, and the order that finds the
cupboard empty carries the shortfall. Re-sequencing the queue therefore moves
the shortfall onto whichever PI now waits behind — which is what actually
happens on the floor. `shortfallByPi` rolls the same figures onto the
commercial document. Both are pure and tested.

**A PI can be released into production in parts.** `POST /api/pis` takes an
optional `order_nos` array; without it the whole PI is released, exactly as
before. What is left off stays on the PI master untouched and can be released
later by sending the request again — the invoice is not altered either way, and
the response names what it skipped so nothing looks lost.

## Layout

```
shared/            imported by BOTH browser and server — pure, testable
  engine.js        the planner: scheduling, netting, SLA. No imports.
  pi.js            invoice maths: size explosion, deduction ladder
  sizes.js         resolving one specific size to a range's BOM rates
  bridge.js        article matching + the handwriting-reading prompt
  bom-import.js    parsing the factory's BOM workbooks
  order-import.js  parsing bulk order spreadsheets
  intake.js        photo-read normalization; preserves exact sizes and V/L
  mis.js           pure executive MIS KPIs: health, dispatch gap, output/utilisation
  inputs.js        SEED reference data only — real data lives in Postgres
  catalogue-seed.js article photos + MRP bands from the catalogue PDF
src/
  App.jsx          ~1,800 lines. Still the largest refactoring/test target.
  *Tab.jsx         one file per screen
  PiDocument.jsx   the invoice, matching the factory's existing layout
  lib/refdata.js   hydrates live reference data over the seed at startup
  lib/client.js    the only thing the browser calls — never a provider directly
api/
  _lib/ai.js       the ONLY file that reads ANTHROPIC_API_KEY
  _lib/db.js       pooled Postgres
  orders/          create, list, edit, delete
  reference.js     BOM upload, stock, MRP, sole type, molding machine
  dispatches.js    packing reports
  parties.js       customers and their locked commercial terms
db/schema.sql      safe to re-run; everything uses IF NOT EXISTS
tests/             4 suites, ~26 checks
```

---

## Working rules

These came from the original handoff and still hold:

1. **Never invent factory data.** Not a capacity, not a pack quantity, not a
   material rate, not a sole type. If a number isn't known, surface that it isn't
   known. A guessed pack quantity silently corrupts the pair count, the material
   requirement and the dispatch date together.
2. **Label placeholders as placeholders**, in the UI and in the data.
3. **Don't rewrite what already works.** Prefer targeted edits.
4. **Verify numbers before claiming them.** Run the code, print the result,
   hand-check one value against the source. Do not assert an output you haven't seen.
5. **Every bug fixed gets a test in the same commit.** A fixed bug without a test
   comes back — this has happened repeatedly on this project.

---

## Domain model — corrections that were expensive to learn

**Work centres and routing.** Seven stages:
`CUTTING → PREPARATION → STITCHING → UPPER_QC → MOLDING → PACKING → DISPATCH`

- PREPARATION is printing and preparing cutting. UPPER_QC sits before molding.
- Packing and dispatch are **separate stages**; dispatch has its own capacity.
- **Molding is several distinct machines**, not one: `MOLDING_PVC_ROTARY`,
  `MOLDING_PVC_VERTICAL`, `MOLDING_PU`, `MOLDING_EVA`. Each is *exclusive* — one
  order at a time, contiguous whole-day blocks — but they run **in parallel with
  each other**. This reversed an earlier "molding is one machine" model.
- Cutting, stitching, preparation, upper QC, packing and dispatch are pooled: several
  orders share a day's capacity.
- Which PVC machine an article uses comes from `article.molding_machine`

**Executive MIS.** Factory OS opens on a management dashboard backed by the
same computed order schedule and recorded dispatch events as the operating
screens. `shared/mis.js` owns the KPI definitions and is date-injected/tested.
Order health, planned dates, scheduled machine output and planned utilisation
are forecasts; dispatch events are recorded actuals. Do not label machine
figures as actual until a shop-floor actual-production feed is stored.
  (`ROTARY`/`VERTICAL`). Unassigned falls back to rotary and is flagged.

**Sizes.** The roll is `6,7,8,9,10,11,12,13,1,2,3,4,5,5.5`. Positions 6–13 are the
kids run and print with an `s` suffix (`8s`); 1–5 are adult. A `B` combo is the adult
repeat of the same numerals printed *without* a suffix — which is why one invoice
legitimately shows both `8s` and `8`. A combo ending in `S` (`7X10S`) is the small run
of an ordinary range.

**Packing.** A *combination pack* is a named range packed together. A *single
packsize* is one size on its own at its own rate. These are different rates and must
not be conflated. Rules: PVC articles use Gola packing except Smart Boy and Silky
Belly which have their own; EVA articles use Armour packing; Gola Plus uses Gola.

**Invoices.** Rate = MRP less the customer's discount, rounded. Then F.O.R., Cash
Discount and GST Dis are deducted **in order, each from the running balance**, and GST
is added to what remains. Re-ordering those steps changes the total.

> The client's own invoice template has a defect: its subtotal formula skips the
> first line item (₹48,363 on the sample PI). This app sums every line; test E in
> `tests/pi.test.mjs` locks that in. Do not "fix" it to match their spreadsheet.

**Colour.** Two different things share the word, and they must not be merged:

- A colour against a **material row** makes it a *different material*: black and
  blue rexine are bought, stocked and netted separately (their sheets even price
  them apart). The colour is folded into the material name — `REXINE 54" BLACK` —
  so every downstream key stays the flat `NAME||UOM`. `Default` means no colour.
  This is why two rows for one material are no longer "duplicates".
- **Sole Colour / Upper Colour** on a BOM or Catalogue row describe the *shoe*.
  They are one value per article, prefill a new order and the PI, and change
  nothing about procurement.

**Columns the factory adds.** `parseReferenceWorkbook` returns every column it
does not recognise, with sample values and its best guess, and the upload screen
makes the user confirm each one before anything saves — map it to a field, keep
it as a free-text note, or leave it out. A guessed column is applied to the
preview so the outcome shown is honest, but is never saved unconfirmed, and no
column is ever dropped in silence. A bare `Colour` is the one genuinely
ambiguous heading: material colour on the BOM sheet, upper colour on Catalogue.

**Parties.** One handwritten sheet routinely lists **several different customers**,
each with their own order. Party belongs to each order, never to the sheet. A PI is
issued to one customer, so a multi-party sheet produces one invoice each.

---

## Traps already hit — do not reintroduce

Each of these was a real bug found in production. Most have a regression test now.

| Trap | What happened |
|---|---|
| Validating against the seed | `api/orders` checked `article_code` against bundled `inputs.js`, so anything uploaded via Data & BOM was rejected and saves silently failed. **Always read `reference_data` from Postgres**, seed only as fallback. |
| Hardcoded work-centre lists | The Machines tab listed 5 of 11 machines. **Derive lists from reference data.** |
| Name matching by prefix | "Gala" matched REX GOLA **PLUS** instead of Gola. Tie-break must prefer the article with the fewest words the input never mentioned. |
| `getElementById` with repeated ids | Print emitted only the first invoice. Use `querySelectorAll`. |
| Silent size ranges | `comboSizes("7X10S")` returned `[]`, hiding a whole range. |
| Unresized image uploads | Phone photos exceeded the serverless request limit and failed silently. Always resize client-side. |
| Sharing catalogue photos | Gola Plus inherited Gola's photo and pictured the wrong shoe on invoices. |
| Guessing a combo for a lone size | `mapToCombo` used to snap any size to the nearest range. It must return `{combo:null, single:size}` and let the user resolve it. |
| Reading a colour as a duplicate row | The client's BOM sheet has a COLOUR column per material. Read as one material, `REXINE-54" BLACK` and `REXINE-54" blue` were "duplicate BOM material" and the whole upload was rejected. Colour belongs to material identity. |
| Losing a column to its own heading | The shipped template writes `Size Run (optional)`; the header key kept `optional`, so the column was ignored. `key()` now strips it. |
| A hard-coded default colour | The PI screen started every order at sole colour "Black" — invented factory data on every invoice. It starts empty; the article master supplies the real colour. |
| A control shipped where nobody can see it | The Adjust button went at the far right of the gantt row, inside a horizontally scrolling 860px-wide box. The order-number column is `position:sticky;left:0`; the button was not, so on a laptop it sat off the right edge and the feature read as "never deployed". A control at the end of a scrolling row must be pinned too. |
| An override the plan never saw | `plan_override` was added to the schema, selected by both order endpoints and stored correctly — then dropped by the list endpoint's `row()` mapper, so the browser fed `{}` back into `compute()` every time. A column is not wired until something asserts it arrives. |
| A queue position treated as a score | `seq` must be a POSITION in the natural queue. Sorting by `seq ?? Infinity` made "run this fifth" jump ahead of every un-pinned order, so the one control meant to push work later pulled it earlier. |
| Re-planning reissuing the invoice | Patching an order bumps the PI revision. A queue position is a shop-floor decision, so an override-only patch skips that — otherwise moving a job up the board filled the commercial audit trail with scheduling noise. |
| Reading a fraction bar as a range joiner | The slip stacks its entries: `11X13` over `4` is the range with 4 cartons, `11` over `2` is size 11 with 2 cartons. The reader's own prompt offered `12/1` as an example of a size-pair, which is what a stacked `11/2` looks like transcribed flat — so stacks became pairs and pairs became stacks. Only `X`, `×`, `\|` or `-` join two sizes; **a bar with a number beneath it is always size-over-cartons**, and the top of a stack is often itself a range. |
| Merging every unresolved line into one | `mergeSpecific` matched on `line.combo === incoming.combo`, and `null === null` — so three separate stacks (11, 2, 6) arrived as a single row labelled "11s, 2, 6" carrying 12.75 cartons, the sum divided by one size's packing rate. An unresolved size is precisely one that cannot be keyed, so it can never merge. |
| Letting the closure switch off the size run | The ascending Small-then-Large inference only ran when no V/L had been read. Knowing a line was Velcro says nothing about whether its numerals are the kids run or the adult repeat, so a sheet that named its closure never spelled a single size `11s`, and its ranges came back for the clerk to pick by hand. |
| Choosing the packing band from the closure | `singlePackingRule` used `type.startsWith("L")` for kids-vs-adult, so on Velcro articles every bare 6..13 read as kids. A `6` costed against REX GOLA (V)'s adult `6X7B` packed at 24/carton where its own range says 18 — 7 cartons became 168 pairs instead of 126. **The band comes from the range's own spelling of that size** (`8s` kids, bare `8` adult), never from the closure. |
| An editable label the invoice never printed | Match & Check showed `l.raw` — an inferred spelling such as "11s\|13s" — in a free-text box. The PI prints the range and its sizes; `raw` reached it only as an unused `label`, so every correction typed there came out of the printer unchanged. It is provenance now, and read-only. |
| Review-block edits stopping at `piCards` | The "Review before saving" quantity boxes wrote to `piCards` while the invoice renders from `piPreviewCards`. Both go through `editPiCell`, which writes cards, review block and preview together and re-stamps the signature. |
| An uncosted line silently leaving the invoice | A line with cartons but no range computes to zero pairs, so `buildLines` emits no row — an invoice that looked complete was short 5 cartons. Save already refused it; step 3 now says so where the clerk is actually looking. |
| Treating repeated numerals as one size run | The factory can have both Small `7S–12S` and Large `7–12`. Explicit S/L always wins. When omitted, preserve the client’s ascending written order: all Small entries first; `1–6` starts Large; later repeated `7–13` remain Large. Never key packing/MRP only by bare size when two BOM ranges can use it — store `RANGE::SIZE`. |

---

## Testing and CI

```bash
npm test           # core + React interaction + mocked API/database contracts
npm run test:coverage
npm run check      # coverage thresholds + production build
```

`.github/workflows/ci.yml` runs the complete check on every push to main and PR.

`shared/intake.js` now owns the handwritten size/type conversion and is covered by
a regression based on the 19-Aug SPIKE slip. React interaction and mocked API tests
now cover the highest-risk paths, but the UI/API layer is not complete: current line
coverage is 44.82%. Live Postgres, live AI calls, printing and several setup screens
still need end-to-end tests against an isolated test environment.

`tests/api.test.mjs` deliberately asserts *shape* rather than examples — e.g. "every
endpoint touching articles must read `reference_data`", "every column the code writes
must exist in `schema.sql`". These catch a class of bug rather than one instance.

---

## Current state

**14 articles**, 71 size ranges, ~1,237 BOM rate entries, 109 materials, 11 work
centres, 13 screens, 7 API endpoints.

**Data still missing from the client** — the app is only as accurate as these:

- Which PVC machine (rotary/vertical) each of the 7 PVC articles runs on
- Real capacities for all 11 work centres (all placeholders)
- Real delivery targets (currently a placeholder 30-day promise)
- Lead-time day counts: in-house prep, outside stitching transport, printing
- Pairs-per-carton for combos `7X10S`, `6X7`, `6X8`, `6X9`, `8X12`, `9X12`
- MRP per size range for 13 of 14 articles (only Gola Plus is priced)
- BOM workbooks for Rex Gola Plus and possibly Silky Belly (looks incomplete)
- Stock figures for materials added with the EVA articles
- Photos for PERCY and SPADE
- "GLAMOUR" appears on order sheets but is not a known article at all

**Not built:** authentication. There are no user accounts, so anyone with the URL can
read and edit every order. This also blocks the audit trail the client asked for.

---

## The task in front of you

The user built a **PI database** with bulk upload of historical PIs. Those PIs are
stored but **do not appear on the schedule**.

The cause is almost certainly structural: the planner reads only the `orders` table.
If bulk-uploaded PIs land in their own table, nothing bridges them across.

What they want: *"an option to add those PIs to production plan"* — an explicit
action, not automatic. Historical PIs must not flood the plan with work already
shipped. A PI already added must be marked so it cannot be added twice.

Start by reading their PI table in `db/schema.sql` and whichever `api/` and `src/`
files handle the upload, then wire the conversion with a test.
