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

## Swapping the AI provider

Everything provider-specific is inside `callModel` in `api/_lib/ai.js`. Reimplement it so it
still returns a plain string and nothing else changes — not the endpoints, not the UI. That
applies to another hosted model, a self-hosted one, or an OCR service plus a parser that
fuzzy-matches against the known article and combo lists.

Whatever reads the slip, keep the validation in `api/orders/index.js`. A confidently wrong read
is worse than a failed one, and that endpoint is the only thing standing between a
misread combo and a silent under-buy.
