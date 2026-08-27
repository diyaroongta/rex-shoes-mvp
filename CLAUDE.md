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

---

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
