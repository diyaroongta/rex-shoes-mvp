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

**Job work is one flow for a line and for an outside fabricator.** Issue,
receive, shortage — identical. Only three things differ, and all three follow
from the fabricator's `type`:

| | internal line | external | sample |
|---|---|---|---|
| slip printed | Internal Issue Slip | Job Work Challan | Job Work Challan |
| money | none, ever | rate x pieces | flat charge |
| quantity | bulk | bulk | 1-10, bulk is REFUSED |

That is why it is one screen with one "who is doing this" dropdown. Two lists
would mean two screens and two ways to get the same question wrong.

**A partial return is still OUT, not short.** `receive()` is cumulative, and
`shortage` is written only when the job is CLOSED — at which point the balance
is accepted as never coming back. An open job with 400 of 900 back is 500 still
with the fabricator. `withFabricators()` is the note's "with fabricator/line"
bucket and counts only open jobs, while a closed job's shortage stays on record.

**Payment follows what came BACK, not what went out** — a shortage is not work
done — and the rate is SNAPSHOTTED onto the job row, so renegotiating a
fabricator's rate next month cannot rewrite what last month's work cost.

**Fabricators and internal lines are ONE list.** `shared/fabricators.js` keeps
them apart by `type` only — `internal_line`, `external`, `sample` — so the job
card issue screen asks "who is doing this" once, whether the answer is Rex Internal or
New Durga Line. Two lists would mean two dropdowns and two ways to get the
same question wrong. What each type requires genuinely differs and is enforced,
not merely hinted at in the form:

| | rate | contact | payable |
|---|---|---|---|
| internal_line | none — a typed rate is an error | optional | **never**, whatever the form sends |
| external | per piece, required | required | always |
| sample | flat charge, required | required | optional |

`payableFor()` derives payability from the type rather than trusting the
caller, so the factory's own line can never end up in the payables. The same
`RULES` object drives the form's fields and the server's validation, so a field
cannot be demanded in one place and hidden in the other.

**A fabricator is never deleted, only deactivated.** A name on a past job card
has to stay resolvable; `DELETE` sets `active=false` and says so. Inactive
entries stay listed and take no new work (`selectableFor`), and sample makers
are kept out of bulk issuing.

**It lives in `api/parties.js` behind `?resource=fabricators`** — not because
it belongs there conceptually but because Vercel's Hobby plan allows 12
serverless functions and the project is at exactly 12. Parties are who work
comes in from, fabricators who it goes out to; both are counterparty master
data under the same admin-only policy, so the neighbour is a reasonable one.

**Product codes are ASSIGNED, never derived.** Twelve Jack articles are twelve
VARIANTS of one product, so they read JACK01 … JACK12 and are talked about as
one family. `shared/product-codes.js` strips closures, colours and bracketed
notes to get the family (`JACK LACE BLACK-BLUE (BLUE SKINFIT)` -> `JACK`), and
`assignCodes` only ever FILLS GAPS — a code on a job card or a PI has to keep
meaning the same article, so recomputing the list from the article master would
renumber everything after an insertion and invalidate last month's paperwork.
Two things the live master taught it: `S.BLUE` is the factory's sky blue and
must be in the colour set, or `RAY VELCRO WHITE S.BLUE` becomes a family called
"RAY S.BLUE" and the next Ray colour is a separate family; and a prefix ending
in a DIGIT takes a hyphen (`X1-01`), because `X1`+`01` = `X101` reads equally
well as X10 №1 and a later run would hand out a number already in print.
Assigning is master data — the `reference` allowlist refuses
`assign_product_codes` to everyone but admin and the data manager, without
needing a rule of its own. It is a ONE-OFF action on **Data & BOM -> Product
codes**, not something that happens on its own: until it is run every article
has no code and every document correctly prints a blank, because an invented
code on an invoice is worse than none. **The PI prints the code as its first
column**, ahead of the article name — the code is how the article is identified
on the floor and on the phone, and the name stays beside it because a code
alone is not a description. Adding that column moved `SPAN_LEFT` in
`PiDocument.jsx` from 7 to 8; a stale 7 puts F.O.R., Cash Discount, GST Dis and
the total one cell out of line on every invoice.

**A customer's history is the SHOE first, the variant second.** "Which variant
had been given to that customer" is asked one level up ("have they had Jack?")
before it is asked one level down ("which Jack?"), so `shared/customer-history.js`
returns families with variants nested, reusing `familyOf`. A variant is the
ARTICLE plus what the PI recorded — the same article once in velcro and once in
lace is two variants, and collapsing them answers the question wrongly. History
covers COMPLETED orders too; a history of only live work would answer the
opposite of what was asked. Two spellings of one customer are one customer
(`partyKey`), but two genuinely different names are never merged — the live book
holds both `K.P. Burgav` and `K.P. Nurgav`, which is probably a typo and is the
factory's to fix, not the app's to guess at.

**The packing report follows the PI's three steps** — choose what is leaving,
check the packing list, confirm — for the same reason the job card does:
something is read out of the system, a person corrects it, and only then is the
document raised. Editing after Generate marks the preview stale and blocks
recording. The sheet is reconciled against the dispatch IN THE SCREEN, because
`api/dispatches.js` refuses a mismatch outright and discovering that after
pressing Record turns a visible disagreement into a server error.

**A component carries a RATE, not a piece count.** The revised workbook writes
`VAMP MESH  MESH 58"  MTR  0.06` — consumption of its material, in that
material's unit. The factory's paper card also shows `VAMP 1824 PCS`, and
pieces per pair are a DIFFERENT figure the workbook does not carry. The job
card issues what the BOM supplies; when piece counts arrive they slot in beside
the rate rather than replacing it.

**The job card follows the PI's three steps** — choose, check, confirm — for the
same reason: something is read out of the system, a person corrects it, and only
then is the document raised. Editing after Generate marks the preview stale and
blocks issuing, exactly as the PI does. Issuing creates the job work record,
which is what gives the card its number and puts the pairs in that fabricator's
bucket; until then it is a preview.

**Components are a BREAKDOWN of a material, never extra demand.** The revised
BOM hangs cut pieces off a material row — ARMOR REXION becomes VAMP, ADDI,
PALTA — and the material rate already covers all of them. Counting a component
as demand in its own right would order the rexine once for the sheet and again
for every piece cut out of it. So there are two views of one BOM, and
`shared/bom-components.js` owns the split:

| View | Shows | Used by |
|---|---|---|
| material-wise | the material, combined | every BOM screen, procurement, netting, stock |
| component-wise | the cut pieces, per stage | the job card only |

`materialTotals()` is asserted to return identical figures with and without
component data, which is the test that stops this leaking into procurement.
Components live at `combos[COMBO].components[STAGE][MATERIAL]` — beside `rates`,
never inside it, so every existing reader of `rates` is untouched.

**A job card is per stage, and falls back rather than printing blank.** The
client's ARMOUR 17004 card is two stages in one document: rows 1–14 are CUTTING
(cut pieces), the thread/labels/velcro/PP-bag list is STITCHING (consumables
with no components). So a stage prints its COMPONENTS where they exist and its
MATERIALS where they do not — an empty cutting list would read as "nothing to
cut". Cutting materials with no components are named in `missing_components`,
never silently dropped.

**The Dispatch Book prints the factory's own Packing List.** The layout is a
faithful copy of the client's sheet, because it travels with the lorry and is
checked at the customer's gate. Two levels, and conflating them gets the S.NO
column wrong: an **S.NO** is one article/closure/colour and spans however many
size rows it needs; a **carton group** is the set of sizes sharing a box, and
that is what the C/N numbers follow. The sample sheet's S.NO 1 holds three
groups of one carton (1/49, 2/49, 3/49) while its S.NO 3 holds one group of two
sizes in a single box (5/49). `tests/packing-list.test.mjs` reproduces that
whole sheet — 971 pairs, 49 cartons — so a change that breaks the numbering
fails loudly.

**The REX mark is in `public/brand/`, not inlined.** Real files served at
`/brand/...`, so the header, the login banner and every printed document use
the same artwork and it can be replaced without touching code. Catalogue photos
are data URLs because they are DATA, uploaded per article; branding is an ASSET
and belongs on disk. The header mark carries `data-noprint` — a document has
its own letterhead, and a second logo on an invoice is worse than none.

**The letterhead and mark are part of the FORM, not configuration.** REX and
"Mark Of Originality" ship as defaults in `DEFAULT_PACKING_CONFIG` and print on
every sheet — they are on every one the factory issues, so requiring them to be
configured before the first sheet can go out would be wrong. `logo` and
`footer_logo` take image data URLs (the same way catalogue photos are stored)
so the real artwork drops in without a code change; the wordmark prints until
it does. EVERYTHING BELOW the letterhead is data: customer, order number,
sizes, pairs, cartons.

**A packing list is reprintable, not a one-off.** It travels with the lorry and
is checked at the customer's gate, so it can be reopened from the dispatch
history and printed long after it was keyed in. Printing opens its own clean
window rather than hiding the app with CSS — the same mechanism the invoice
uses, because a print stylesheet has to anticipate every piece of chrome on the
page and a clean document cannot get one wrong.

**Cartons are COUNTED on the dispatch screen now, never derived.** The old
screen showed `pairs / packing rate` to two decimals — "2.67 cartons" — which
cannot go on a lorry and is wrong whenever sizes inside a range pack at
different rates. The packer enters the count. C/N numbers ARE derived, because
numbering is not quantity. `dispatched` stays per size range and keeps driving
the pending balance and the ledger; the packing list is the document beside it,
and `api/dispatches.js` refuses a sheet whose pairs disagree with the dispatch
so the gate pass and the order book can never differ.

**The menu names the factory's own books.** Orders & dispatch is the **Order
Book**, Dispatch & packing is the **Dispatch Book**. Bulk upload is not a
top-level screen: it is a second way of doing what PI generation does — getting
orders in — so it is a mode inside that screen. `NewOrderFlow` stays MOUNTED
when the spreadsheet mode is showing, because it holds an unsaved draft and
switching modes must not discard a slip the clerk has already checked.

There are exactly **two job-order screens** after the Order Book. **Create Job
Order** reads every active Order Book row live and accepts the date, destination
and size-wise quantities. **Job Orders Database** lists every issued record for
receiving, shortage and payment. “Job Card” is only the two-page printable
document produced by creation, not another tab. `shared/job-orders.js` derives
the remaining Order Book balance, and the server refuses an issue above it.

**BOM removal is bulk, previewed, and undoable.** `shared/bom-removal.js` is a
pure planner: give it the reference document and a selection of articles, size
ranges and individual materials in any mix, and it returns exactly what would
go. The browser calls it to keep the running count honest and the server calls
it twice — once for the preview, once inside the locked transaction — so the
list the clerk confirms is the list that is deleted, and a BOM uploaded in
between cannot make a stale plan delete something nobody saw. A higher level
absorbs the lower ones, so selecting an article and one of its ranges never
double-counts. Materials are shared between articles and are never deleted with
one. Every removal is snapshotted to `reference_data_history` first and restores
cleanly, packing and MRP included.

**Live orders block a removal, but the block is overridable.** `ordersAtRisk`
names every active order that would lose its article or its size range; without
`confirm_in_use` the endpoint refuses with those order numbers. The override is
deliberate and was asked for — which is why `compute()` had to be made
orphan-safe first, since before that an override would have taken every screen
down rather than just the affected orders.

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
  bom-removal.js   what a bulk BOM removal would delete — pure, shared by preview and delete
  permissions.js   who may do what — enforced in wrap(), read by the UI for tabs
  order-import.js  parsing bulk order spreadsheets
  intake.js        photo-read normalization; preserves exact sizes and V/L
  mis.js           pure executive MIS KPIs: health, dispatch gap, output/utilisation
  packing-list.js  the dispatch document: carton numbering, totals, reconciliation
  bom-components.js  cut pieces per material: job cards read these, procurement never does
  product-codes.js the article families and their codes — assigned once, then kept
  customer-history.js what a customer has been given before: shoes, then variants
  fabricators.js   internal lines and job workers in one list; what each type requires
  job-work.js      issuing work out and taking it back: slips, shortage, what it costs
  inputs.js        SEED reference data only — real data lives in Postgres
  catalogue-seed.js article photos + MRP bands from the catalogue PDF
src/
  App.jsx          ~1,800 lines. Still the largest refactoring/test target.
  *Tab.jsx         one file per screen
  PiDocument.jsx   the invoice, matching the factory's existing layout
  BomRemovalPanel.jsx  bulk BOM removal: articles, ranges and materials in one action
  JobCardTab.jsx       Create Job Order: live Order Book balance, assignee and sizes
  JobCard.jsx          the printable document generated by a job order
  FabricatorsTab.jsx   the fabricator master: lines, job workers, sample makers
  JobWorkTab.jsx       Job Orders Database: issued, received, short and payable
  PackingList.jsx      the dispatch document, in the factory's own layout
  lib/refdata.js   hydrates live reference data over the seed at startup
  lib/client.js    the only thing the browser calls — never a provider directly
api/
  _lib/ai.js       the ONLY file that reads ANTHROPIC_API_KEY
  _lib/db.js       pooled Postgres
  orders/          create, list, edit, delete
  pis.js           PI master, release into production, and PI number allocation
  reference.js     BOM upload, stock, MRP, sole type, molding machine, bulk removal
  dispatches.js    packing reports, AND job work (?resource=job_work)
  parties.js       customers, AND fabricators (?resource=fabricators) — see below
public/brand/      the factory's own artwork — rex-logo.jpg, rex-banner.jpg
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

**Work centres and routing.** The order a shoe is actually made in, confirmed
by the client:

`CUTTING → PREPARATION (printing) → STITCHING → UPPER_QC (qc & prep) → MOLDING → PACKING → DISPATCH`

`STAGE_SEQUENCE` in `shared/engine.js` is the ONE definition; `workCentresInOrder()`
sorts any list of lines by it. Every screen that lists stages or work centres
uses those — reading `Object.keys(workcenters)` gave the reference document's
storage order, which on live data put PACKING second and DISPATCH third.

**Outside stitching adds a TRANSIT leg, not a release delay.** Work sent out
has to come back before it can be QC'd, so `TRANSIT_STAGE` sits between
STITCHING and UPPER_QC for `stitching:"outside"` orders, lasting
`stitching_outside_transport_days`. It books NO capacity and never appears on
the machine board — nothing is being made — but it is real elapsed time and
every dispatch date depends on it. It used to be added to `extraLeadDays`, i.e.
to the RELEASE date, which delayed cutting for a lorry that had nothing to
carry yet and put the wait in the wrong place on the schedule.

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
| Reading a bracketed (L) as a customer number | The slip marks its Large row `(L)`, which in handwriting is all but identical to `(1)`. The prompt said customers are "often numbered 1) 2) 3)", so the whole row was taken for a nameless customer and dropped — 5 of 14 cartons gone, with the lines that survived each looking perfectly reasonable. A bracketed marker describes its ROW: a letter is the size run, a number is just which row it is. Neither starts a customer. |
| Re-deriving a carton count the sheet already wrote | `mergeSpecific` recomputed cartons as merged pairs ÷ the line's rate. Sizes inside one range do not pack alike — SPIKE's 11X1 packs 12s/13s at 24 and size 1 at 18 — so `1+2+2` written cartons came back as `108/24 = 4.5` and the slip's own "= 14 CTN" stopped adding up. Cartons are counted, never derived; only pairs are derived, per size, at that size's own rate. |
| A stated total nobody checked | The sheet writes "= 14 CTN". The reader was told to use it and had no way to report it, so nothing verified the read. `stated_cartons` now comes back on the order and `buildPhotoCards` compares — the only check that catches a whole row going missing, because the remaining lines are individually plausible. |
| Reading a fraction bar as a range joiner | The slip stacks its entries: `11X13` over `4` is the range with 4 cartons, `11` over `2` is size 11 with 2 cartons. The reader's own prompt offered `12/1` as an example of a size-pair, which is what a stacked `11/2` looks like transcribed flat — so stacks became pairs and pairs became stacks. Only `X`, `×`, `\|` or `-` join two sizes; **a bar with a number beneath it is always size-over-cartons**, and the top of a stack is often itself a range. |
| Merging every unresolved line into one | `mergeSpecific` matched on `line.combo === incoming.combo`, and `null === null` — so three separate stacks (11, 2, 6) arrived as a single row labelled "11s, 2, 6" carrying 12.75 cartons, the sum divided by one size's packing rate. An unresolved size is precisely one that cannot be keyed, so it can never merge. |
| Letting the closure switch off the size run | The ascending Small-then-Large inference only ran when no V/L had been read. Knowing a line was Velcro says nothing about whether its numerals are the kids run or the adult repeat, so a sheet that named its closure never spelled a single size `11s`, and its ranges came back for the clerk to pick by hand. |
| Choosing the packing band from the closure | `singlePackingRule` used `type.startsWith("L")` for kids-vs-adult, so on Velcro articles every bare 6..13 read as kids. A `6` costed against REX GOLA (V)'s adult `6X7B` packed at 24/carton where its own range says 18 — 7 cartons became 168 pairs instead of 126. **The band comes from the range's own spelling of that size** (`8s` kids, bare `8` adult), never from the closure. |
| An editable label the invoice never printed | Match & Check showed `l.raw` — an inferred spelling such as "11s\|13s" — in a free-text box. The PI prints the range and its sizes; `raw` reached it only as an unused `label`, so every correction typed there came out of the printer unchanged. It is provenance now, and read-only. |
| Review-block edits stopping at `piCards` | The "Review before saving" quantity boxes wrote to `piCards` while the invoice renders from `piPreviewCards`. Both go through `editPiCell`, which writes cards, review block and preview together and re-stamps the signature. |
| An uncosted line silently leaving the invoice | A line with cartons but no range computes to zero pairs, so `buildLines` emits no row — an invoice that looked complete was short 5 cartons. Save already refused it; step 3 now says so where the clerk is actually looking. |
| An arrow key inside a hidden password | The account script read keys one byte at a time and skipped control characters. An arrow key is not one byte — it is `ESC [ A` — so the ESC was dropped and `[A` was welded into the password, invisibly, because the prompt echoes nothing. The user then either got "the two passwords do not match" with no explanation, or set a password containing `[A` that cannot be typed into a browser field at all. Escape sequences must be parsed and swallowed WHOLE (`scripts/hidden-prompt.mjs`), and `hashPassword` refuses any control character as a backstop. |
| A password that was never really stored | The account script reported success on the strength of the INSERT alone. A write against the wrong `DATABASE_URL` — local instead of Neon is the easy mistake — looked identical to a correct one, and the only symptom was "Incorrect username or password" at a login that could never work. It now reads the hash back and verifies the typed password against it before saying the account exists, and prints which database it wrote to. |
| A wrong password that was actually a missing env var | An unset `AUTH_SECRET` surfaced through the generic 500 handler, so an unconfigured deployment was indistinguishable from a typo. Neither retyping nor resetting the account can fix it. Login now checks the secret FIRST and answers 503 with the fix, an empty `users` table answers "No accounts exist yet", and the login screen renders both as a setup fault rather than a rejected password. |
| A mocked query that Postgres would refuse | The failed-attempt counter used `$2` in both `failed_attempts = $2` and a `case when $2 >= $3`, which real Postgres rejects outright (42P08). Every mocked test passed — they assert SQL text, not that a server accepts it — while in production a wrong password returned 500 and the lockout never advanced. Mocked API tests cannot catch parameter-type errors; anything non-trivial in SQL needs one run against a real database. |
| An order that outlived its article | The article master is editable and a bulk BOM removal can be confirmed over a live order, so `articles[o.article_code]` can be undefined. `compute()` read `.routing` off it and threw — and because ONE call builds every screen, a single orphaned order blanked the whole app: dashboard, schedule, procurement and PI list together. Orphans are now set aside, listed at the top of the board with `article_missing`, counted in the pair totals and reported in `schedule_problems`. Never let one bad row take the planner down. |
| A range emptied instead of removed | Removing the last material from a size range left the range in place with no rates. Orders could still be placed on it, and it then booked machine capacity while requiring zero material — the same silent failure as an unpriced line. `planRemoval` promotes that to removing the range itself, and says so in the preview rather than doing it quietly. Same rule one level up: an article whose every range is selected goes too. |
| A thirteenth serverless function | Vercel's Hobby plan builds one function per file under `api/` and allows 12. Adding `api/auth.js` made it 13, and the DEPLOYMENT was rejected even though the build succeeded — so tests, coverage and `vite build` all passed while the app could not ship. PI number allocation moved into `api/pis.js` as `action:"next_number"`, and a shape test in `tests/api/auth.test.js` now asserts the count. Helpers go under `api/_lib/`, which Vercel ignores because of the underscore. |
| A session that invented a role | `signSession` defaulted a missing role to `"admin"` (`user.role \|\| "admin"`), and `readSession` did the same on the way back. Any path that produced a user without a role — a hand-written row, a future SSO mapping, a bug — therefore minted an ADMINISTRATOR session. Access control has to fail closed: the default is gone, an absent role reaches `can()` as absent, and it is refused with a message telling the user to have it set. |
| A guess wearing the reading's clothes | The Match &amp; Check card was titled by the article the matcher CHOSE, in confident bold, while the words actually on the slip sat beside it as grey `read: "Spike Blue"` micro-text. So a card headed "JACK LACE BLACK-BLUE (BLUE SKINFIT)" was really an unconfirmed guess at "Spike Blue", and the person checking the order could not see what was written — only what the machine decided. The slip's own words are the card's title now; the product is a labelled field under it. |
| A warning that could never be cleared | `onArticleChange` remapped the card but left `ambiguous` set, so "More than one product fits" stayed up after the correction was made. A banner that survives the fix teaches people to scroll past every banner. Choosing from the list now IS the confirmation. |
| A range mistaken for an invented size | Match &amp; Check bolded the RANGE (`11X1`) while the slip's own `12, 13, 1` sat in ten-point grey, so a range covering a size nobody wrote looked like the app adding one. It is not: a range is only the RATE BASIS, and an unwritten size carries no quantity, so nothing extra is priced or made. The written sizes lead now and the range follows as "mapped to 11X1". The warning fires only when an unwritten size actually carries pairs — which would be the real invented-size fault. |
| Refusing where a warning would do | Issuing a PI was blocked by five separate refusals — customer, colours, size range, packing rate, MRP — each stopping the clerk dead at a different point. During setup, and on a genuinely urgent order, that is the wrong trade. They are collected and shown ONCE with "Issue the PI anyway". What is not negotiable is honesty about the cost: a line with no size range or no packing rate prices to zero pairs and is DROPPED from the invoice entirely, so those two say so in as many words rather than reading as cosmetic. |
| Reading pairs as cartons | The slip stacks size over quantity, and that bottom figure is sometimes cartons and sometimes PAIRS. The factory's rule is the size of the number: a carton count for ONE size is small, so anything above ten is pairs (`CARTON_LIMIT` in `shared/intake.js`). Read the other way round it is multiplied by the packing rate — the 2026-27 SPIKE BLUE revised order is 288 pairs and came back with a single line reading 1,728. `readQuantity()` decides, `basis` says which way it went so the screen can show it, and the AI prompt now says to transcribe the figure verbatim rather than convert it. |
| One button for two different intentions | Dispatch history had a single "Remove" that put the pairs back. But "this report was mis-keyed" and "I do not want this row on screen any more" are opposite instructions: the first must return the pairs to pending, the second must NOT, because the goods really shipped. They are now separate actions — **Undo dispatch** (moves to `dispatches_removed`, pairs return) and **Just remove from history** (`hidden=true`, pairs keep counting). A hidden row is still summed into `already` when validating a new dispatch, or hiding one would let the same pairs ship twice. |
| A 404 that read as a bug | Undoing a dispatch that was already undone — a second click, or a stale tab — answered a bare "404 — no such dispatch", which looks like the app is broken rather than like the screen being out of date. It now says the report may already have been undone and to reload, and the list refreshes on the failure as well as on success. |
| Four copies of the stage order, one wrong | The stage-targets editor carried its own list: it omitted PREPARATION and UPPER_QC — so neither could ever be given a delivery target — and included PRINTING, which is part of PREPARATION and not a stage at all. `STAGE_SEQUENCE` in `shared/engine.js` is now the single definition and everything that lists stages sorts by it. |
| One material on several component rows | The revised BOM writes a row per CUT PIECE, so `MESH 58" WHITE` appears as VAMP MESH and again as MESH TOUNGE. The importer read those as duplicate materials and rejected the file. Removing the check naively is worse: the first row wins and the rest are discarded, understating MESH by 25% and REXINE 54" by 75% — silently, in the figure procurement buys from. Rates now ACCUMULATE (`+=`), a true duplicate is the same COMPONENT twice, and the components are stored beside `rates` so nothing that reads rates changes. |
| A column nobody thought was missing | The factory's sheet heads that column "Cutting componenet" — with the typo. It fell into the unrecognised-column flow, so components were silently not stored at all while the upload otherwise looked fine. Their spelling is aliased. Read the client's actual header, not the one the template says. |
| Tests that hide their own coverage | `process.exit()` at the end of a core test kills the process before V8 writes its coverage file. It looked like six new modules had no tests at all and dropped the gate to 68%. `process.exitCode` instead. (The real cause that day was a broken chain — but the exit pattern makes any such failure much harder to read.) |
| A test file that ended in process.exit() | `tests/pi.test.mjs` finished with `process.exit()`, so tests appended after it NEVER RAN — they printed nothing and were not counted, which reads exactly like "the new tests pass". It was also truncating V8's coverage write: switching to `process.exitCode` took core coverage from ~74% to 93.84% with no new tests. The rule is already in this file; this was a live instance of it. |
| Opening the app writing to the database | Two load-time faults with the same shape. The capacity auto-save was guarded by a "skip the first run" ref, but the effect runs on mount BEFORE the settings request returns, so the ref was spent by the time the async hydrate called `setCaps` — the hydrate then looked like a user edit and the app PUT settings back on EVERY page load, flashing "Machine capacities saved" at someone who saved nothing and showing every non-admin role a red 403 on a screen they had just opened. Separately, `next_number` is `nextval()`, and allocating on mount burned a PI number per page load: 113 consumed against 3 filed. Only a real edit marks capacities dirty, and a PI number is issued when a reading STARTS (`resetReadState`). Nothing is written by looking. |
| A reading that inherited the last one | Reading a PI sets the PI number to that invoice's own number, plus the customer, city, agreed discount and colours. Reading a photo afterwards replaced only the CARDS — so a handwritten SPIKE slip keyed after a PI upload was filed under the uploaded PI's number and came back `409 — PI number already exists: PI/590`. The number fails loudly; the customer, the discount and the colours carried over in SILENCE, which is worse — a Spike order wearing another customer's 40% discount looks perfectly reasonable on screen. `resetReadState()` is now the one place a new reading starts from, shared by the photo path, "Enter by hand" and the PI reader, so the three cannot drift apart again. A photo-read order takes a newly issued number; an uploaded PI keeps its own. |
| Advice that duplicated the order it was refusing | Saving a PI whose number is taken answered "PI number already exists: PI/590. Request a new PI number." That is right for a genuinely new PI that landed on a taken number, and actively harmful for the commoner case — the SAME PI being saved twice. Following it files a SECOND copy of the same customer order under an invented number, and every pair is counted twice in production, procurement and dispatch. The refusal now names what it collided with (customer, date, and the orders it already created) and says plainly what saving again would do. A collision with no orders behind it still just asks for another number. |
| A colour outranking the product | `matchArticle("Spike Blue")` returned JACK LACE BLACK-BLUE. `blue` occurs TWICE in that name — once in `BLACK-BLUE`, again in the `(BLUE SKINFIT)` note — so a colour mentioned in passing scored 2 while SPIKE, the product actually written, scored 1; `COLOURS` was only `["black","white"]`, so every other colour counted as part of the name. `thunder red` reached JACK too. The match is made on the FAMILY alone now, tokens are deduped, bracketed notes are dropped before the family is read, and a colour or closure can only choose BETWEEN articles of the family the slip named. |
| The narrowing order inside a family | Fixing the above by narrowing on colour/closure BEFORE the fewest-unmentioned-words rule sent `Gola` to REX GOLA PLUS — PLUS carries no closure, so "prefer the plain name" picked it. Fewest-unmentioned-words settles WHICH PRODUCT and must run first; colour then closure settle which one of it. Colour before closure, or `Jill Blue` answers plain JILL and silently drops the only word that narrowed anything. |
| A date that was really a Date | Postgres returns `order_date` as a Date OBJECT. `String(date).slice(0,10)` is `"Wed Aug 20"`, which sorts alphabetically — so the most-recent customer came out wrong and every first/last-supplied date was nonsense. `isoDate()` normalises, and reads LOCAL time: `toISOString()` on a date-only value stored at local midnight rolls back a day and dates an order to the day before it was placed. |
| A hidden dispatch the browser could not see | `GET /api/dispatches` hides hidden rows by default, and the browser built its ledger from that — while the server has always counted hidden rows when checking what is outstanding. So an order with 60 shipped and 30 hidden showed **40 pairs pending when 10 remained**, and the save was refused with "only 10 pairs remain outstanding"; its packed cartons were invisible too. The app fetches WITH hidden now and only the history LIST filters. |
| Sorting the cut pieces alphabetically | The job card's component rows went through `localeCompare`, so the factory's cutting order — VAMP, ADDI, PALTA, U TAPE, TOE PUFF — printed as ADDI, CALLER FOAM, PALTA. The cutter reads that list top-down; the order is the point of it. Rows keep the BOM's own row order via a `seq` stamped at first sight. |
| A job order thrown away by a tab click | `{tab==="jobs" && <JobCardTab/>}` UNMOUNTS the component, so the fabricator, article and size-by-size quantities were discarded the moment the user looked at another screen. Unsaved work stays MOUNTED behind `display:none`, the same way the intake screen already did. |
| Refusing an oversized PI instead of shrinking it | The factory's own PI export is ONE page of text carrying 3.4 MB of letterhead artwork — 3.7 MB total, which is 4.9 MB as base64 and past Vercel's 4.5 MB body cap, so every PI they raise came back `413`. The content was never the problem. The browser now re-renders an oversized PDF to one JPEG per page (`pdfPagesToJpeg`, pdf.js lazy-loaded): 3.71 MB -> 0.30 MB in 846 ms, every figure still legible. A file that already fits is sent untouched, because a PDF read AS a PDF beats a picture of one. |
| Rendering only the first page | The obvious version of that fix renders page 1 and sends it. A two-page PI would come back looking complete and be short whole lines — the same silent-loss failure as a dropped row. Every page is rendered, `api/read-pi.js` takes a page ARRAY as readily as one file, and `tests/api/read-pi.test.js` asserts three pages produce three image blocks. |
| Measuring a render in a hidden tab | Timing `page.render` in a background tab said 20 s and "hangs"; the same call in a fronted tab took 846 ms. Background tabs throttle timers to ~1/s and pdf.js schedules its work through them. Front the tab before timing anything that renders. |
| Treating repeated numerals as one size run | The factory can have both Small `7S–12S` and Large `7–12`. Explicit S/L always wins. When omitted, preserve the client’s ascending written order: all Small entries first; `1–6` starts Large; later repeated `7–13` remain Large. Never key packing/MRP only by bare size when two BOM ranges can use it — store `RANGE::SIZE`. |

---

## Testing and CI

```bash
npm test           # core + React interaction + mocked API/database contracts
npm run test:coverage
npm run check      # coverage thresholds + production build
```

`.github/workflows/ci.yml` runs the complete check on every push to main and PR.

`shared/product-codes.js` is covered by `tests/product-codes.test.mjs`, whose
last section is built from names taken off the live article master.

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

**Authentication.** Built, single-account to start, designed for IAM to grow into.

- `api/_lib/auth.js` — scrypt password hashing and HMAC-signed session cookies, both
  from `node:crypto`. **No database import**, for the same reason `http.js` has none:
  the guard runs on every request, so anything it imports lands in the AI endpoints'
  cold start.
- **The guard lives in `wrap()`**, not in each handler. An endpoint cannot be shipped
  unprotected by forgetting a line; `wrap(handler, { public:true })` is the deliberate
  opt-out and only `api/auth.js` takes it. A shape test in `tests/api/auth.test.js`
  asserts this over the whole `api/` tree.
- **Fails closed.** No `AUTH_SECRET` (or one under 32 characters) means every endpoint
  answers 503 with that message — never "open because unconfigured".
- The session is a 12-hour HttpOnly cookie, so the browser holds no token and no
  script can read one. There is no sessions table: revoking everybody at once is done
  by rotating `AUTH_SECRET` on Vercel.
- **Roles are enforced.** `shared/permissions.js` is pure and is consulted by `wrap()`
  on every request, so an endpoint cannot ship without a policy any more than it can
  ship without a session. It **denies anything it does not recognise**, so a new
  endpoint is admin-only until classified, and a shape test fails the build until
  someone classifies it.
  Roles come from the factory's own access list and each is TWO things and no
  more: the screens it may open (`tabs`) and the endpoints it may change
  (`writes`). Reading follows the screens.
  - `admin` — everything, including the article master, BOM, parties, capacities
  - `owner` — sees the whole factory, changes nothing (Owner / Director)
  - `planner` — Production Planner: schedule, production plan, machine load. Edits
    the PLAN, never the order — see below
  - `sales` — PIs, bulk orders, parties and their terms
  - `dispatch` — records dispatch ONLY; reads the order book and packing rules
  - `procurement` / `store` — the buying list and stock figures, never the BOM
  - `data` — the article master, BOM workbooks, packing and MRP
  - `auditor` / `viewer` — read-only
  The three-role model could not express a dispatch clerk who records a shipment
  but must not raise an invoice, which is why it is a table now rather than a
  chain of ifs. Roles are NOT constrained in the database: adding one would
  otherwise mean a schema migration to hand somebody a login, and a role the app
  does not recognise is refused everything anyway.
  The one split worth knowing: `api/reference.js` carries BOTH stock figures (daily
  clerical work, store/procurement) and the BOM (master data, admin), so it is judged
  on the body keys, not the endpoint. Mixing a BOM change in beside a stock change
  sinks the whole request.
  **The planner is judged the same way, and for a sharper reason.** Permissions are
  enforced per ENDPOINT, but re-sequencing production is a `PATCH /api/orders` — so
  granting that endpoint would also allow rewriting quantities and DELETING orders,
  which the factory's access list gives to Sales. `orders:"plan"` allows a PATCH whose
  body is `plan_override` or `priority` and nothing else, so a planner can move work
  about but cannot change what was ordered. `isReadOnly()` counts it, or the screen
  would hide the very controls the role exists to use.
- The UI hides screens a role cannot use rather than disabling their buttons — a
  screen whose every control is refused reads as a broken app, not as a permission.
  The server is still the only thing that enforces it.
- Roles are changed with `--set-role`, which does NOT reset the password. The role
  rides in the signed cookie, so it takes effect at the user's next sign-in.
- Accounts: `node scripts/create-user.mjs <username>`. The password is typed at a
  hidden prompt — never an argument, never an environment variable, never logged.
  Also `--list`, `--verify <user>` (checks a password against the stored hash with no
  browser involved), `--unlock <user>` and `--secret`. Creating an account reads the
  hash back and verifies it before reporting success, so "created" means "can sign in".
- `scripts/hidden-prompt.mjs` owns the terminal key handling and is covered by
  `tests/scripts.test.mjs`, which is in `npm run test:core`. Everything it gets wrong is
  invisible — the prompt echoes nothing — so it is tested rather than eyeballed.

**Still open:** the built SPA shell (`index.html` and its bundle) is served by Vercel
as static files and is NOT behind the guard. It contains no factory data — every order,
PI and reference read is an `/api` call and returns 401 — but the login screen is
reachable by anyone with the URL. The audit trail the client asked for is now
unblocked: `req.user.username` is available on every write.

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
