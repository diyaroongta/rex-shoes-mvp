# Factory OS — product and engineering audit

Date: 22 August 2026

## Executive assessment

Factory OS has a sound calculation core, but the application is still an operational
prototype rather than a production-controlled factory system. The pure scheduling,
PI and size logic is strong. The main risks are incomplete reference data, a very
large React shell, incomplete live-database testing, missing authentication/audit,
and overlapping setup screens.

This audit fixed the photographed SPIKE regression and several related cross-layer
defects. It also added enforceable coverage gates. It does **not** claim that every
external workflow is proven: there is no test `DATABASE_URL` in this folder and live
AI/provider calls were not made.

## What was fixed in this audit

1. **Handwritten exact sizes were lost.** A stack such as size 11 over one carton was
   converted to a whole range. PI generation then spread it over all sizes in that
   range. `shared/intake.js` now retains exact per-size quantities and groups them
   onto the correct BOM range without changing their meaning.
2. **SPIKE adult packing used the children’s rate.** Single-size packing now receives
   V/L context. SPIKE Velcro uses ARMOUR kids packing and SPIKE Lace uses ARMOUR adult
   packing.
3. **Per-size data was dropped between Match & Check, PI preview and save.** `sizes`
   and `size_order` now survive the whole path.
4. **Adding a specific size could overwrite a whole-range order.** Exact-size and
   whole-range lines can coexist safely.
5. **Dispatch bypassed SPIKE’s inherited packing rule.** It now calls the same shared
   packing resolver as intake and order editing.
6. **A partial settings update reset untouched settings.** Capacities, SLA targets,
   PI terms and letterhead configuration now merge with the stored value.
7. **Party terms were disconnected from PI generation.** Each PI now applies the
   matching party master’s locked discount, deductions, GST and payment split. The
   PI screen no longer exposes an editable discount.
8. **Bulk upload could silently import only part of a workbook.** Unknown articles,
   unreadable required fields and unsupported sizes are now blocking errors.
9. **Exact-size totals could disagree with the planner quantity.** Create and edit
   APIs reject lines whose `sizes` do not sum to `qty`.
10. **Clear all orders had no confirmation.** It now requires explicit confirmation.
11. **Duplicate combo lines were lost in CSV export.** They are now summed.
12. **Date display could shift by a day in western time zones.** Date-only values are
   now rendered as local midnight.

## Supplied order-book result

`Order book 17-07-2026.xlsm` contains 84 non-empty order rows across the read sheets.
With the current reference data:

- 27 orders parse safely.
- 57 rows are blocked.
- The SPIKE rows parse into the correct VELCRO and LACE ranges while retaining their
  individual size quantities.

Most blocked rows reference products for which this application has no BOM/catalogue,
including FOUNDER, JACK, TODDLER, ICON, BOLT, GLIDE, THUNDER, TANNER, ROCKET, RYDER,
TREK and others. Some known rows also contain sizes inconsistent with their selected
V/L type. Importing those rows without factory data would invent material usage and
packing, so the safe behaviour is to block and explain them.

## Product-manager perspective

### Keep and strengthen

- **Match & Check → Generate PI → Save to production** should remain the primary
  workflow. It creates a useful human approval boundary around AI extraction.
- **PI database with explicit “Add to schedule”** is correct. Historical PIs must
  not automatically flood the live plan.
- **Per-article Packing & BOM evidence** is valuable for trust and troubleshooting.
- **Partial/full/shortage dispatch reporting** is operationally important and should
  remain separate from the original ordered quantity.
- **Editable catalogue/reference data** is necessary, provided changes are versioned
  and attributable.

### Consolidate

The navigation currently exposes 15 screens. For a factory clerk this is too much
surface area and too many overlapping concepts.

- Combine Schedule, Production plan and Machine load into one **Production** workspace
  with Timeline, Machines and Capacity views.
- Combine Procurement and Stock register into one **Materials** workspace.
- Combine Catalogue, Packing & BOM rules and Data & BOM into one **Article master**
  with tabs for Commercial, Packing, BOM and Routing.
- Keep PI generation, Orders, Dispatch and PI database as the four primary daily
  operational destinations.

### Remove, hide or restrict

- Hide **Copilot** until underlying data completeness is high and its answers can cite
  the exact schedule rows used. It is currently less valuable than dependable data.
- Remove or relabel **Default price/pair** in Catalogue. PI money is driven by MRP by
  size range, so a second price field creates ambiguity.
- Restrict **Clear all orders**, reference edits, machine capacity edits and party
  terms to administrators.
- Do not expose placeholder capacities or lead times as if they are confirmed facts.

### Features needed before client-wide rollout

1. User accounts and roles: clerk, production planner, dispatch and administrator.
2. Immutable audit log: who changed quantities, packing, BOM, terms and machine data.
3. A data-readiness dashboard showing missing MRP, BOM, packing, machine and photo by
   article before orders are accepted.
4. Explicit PI lifecycle: Draft → Issued → Confirmed → Sent to production → Revised →
   Closed/Cancelled.
5. Server-generated PI numbers and idempotency protection against double submits.
6. Factory calendar: working days, holidays, planned downtime and machine maintenance.
7. Import reconciliation showing input rows, accepted rows, blocked rows and pair
   totals before commit.
8. Backup/restore and a test environment separate from production data.

## Software-engineering perspective

### Current test evidence

- Core/shared logic: 82.09% line coverage, 66.06% branch coverage.
- React + API layer: 44.82% line coverage, 41.91% branch coverage.
- Production build passes.
- Coverage thresholds fail CI below 80% core lines or below 35% React/API lines.
- Browser verification opened all 15 screens and ran the photographed SPIKE data
  through Match & Check and PI rendering.

### Highest remaining risks

| Priority | Risk | Why it matters | Recommended correction |
|---|---|---|---|
| P0 | No authentication or authorization | Anyone with the URL can read or modify operational data | Add identity, roles and server-side authorization before wider deployment |
| P0 | No live Postgres integration test environment | Mocked handlers cannot prove SQL, constraints or transaction behaviour | Create a disposable Neon branch in CI, apply migrations and run API journeys |
| P0 | Incomplete reference data | The supplied workbook blocks 57 of 84 rows | Complete article/BOM/packing/MRP master before relying on bulk import |
| P1 | Client-generated random PI numbers | A collision can merge unrelated orders into one PI master record | Allocate PI numbers in Postgres with a unique sequence |
| P1 | PI-master sync failures are swallowed | Order save can succeed while PI database silently remains stale | Make sync transactional or queue/retry it visibly; never ignore the error |
| P1 | Runtime DDL and no migration history | Schema drift between Neon and code is hard to detect or reverse | Add numbered, immutable migrations and a schema-version check |
| P1 | `xlsx` dependency has one high-severity audit finding | Uploaded workbooks are untrusted input | Replace SheetJS npm 0.18.5 or isolate parsing with strict size/time limits |
| P1 | `App.jsx` is about 1,800 lines | Intake, PI, planning and edit regressions share one stateful file | Extract PI intake, PI database, orders and production views into tested modules |
| P1 | MRP/BOM completeness is not a server invariant | A UI bypass can still store commercially incomplete orders | Validate issuance requirements server-side, not only in React |
| P2 | 1.27 MB production JavaScript bundle | Slower first load and serverless/mobile friction | Lazy-load XLSX and infrequently used setup screens |
| P2 | AI output has no formal schema/checksum response | Malformed but valid JSON can reach Match & Check | Validate with a versioned schema and show reader confidence/checksum differences |
| P2 | Printing/download flows are not automated | Browser popup and file behaviour can regress | Add Playwright tests for one- and multi-party PDF/print flows |

### Architecture direction

Maintain the existing rule: calculations belong in pure `shared/` modules with tests.
React should orchestrate state and presentation only. API request validation should use
the same versioned schemas as the browser. Database changes should be migrations, and
external workflows should be tested against an isolated database before production.

## Release gate

A change should not be deployed unless all of the following pass:

1. `npm run check`
2. The changed feature has a new or updated regression test.
3. The critical journey passes against a test database.
4. No migration is pending.
5. The supplied representative workbook/photo fixtures reconcile their input and
   output pair totals.
6. A production backup/rollback point exists for schema or reference-data changes.
