# Factory OS — Client Feature Status

**Audit date:** 29 September 2026  
**Live website checked:** `https://rex-shoes-mvp.vercel.app`  
**Live build checked:** `b646f58`

## Executive summary

Factory OS now covers the main operating flow from PI intake through production planning, daily achievement, repair, packing and dispatch. All 21 deployed screens opened successfully in two live navigation passes, with no browser-console, server, database-schema or page-load errors.

The full automated suite was also run twice. Both runs passed every configured core suite and all **248 UI/API tests**. A production build completed successfully.

The system is suitable for a guided client walkthrough, subject to the three pre-demo points below:

1. Deploy the latest Desktop commit, which adds the material-stock check before PI/job-order issue and improves the Schedule's floor view.
2. Correct the dashboard quantity reconciliation: 2,816 pairs waiting for a job card are currently omitted from several MIS totals.
3. Complete the client's operating data: stock counts, party terms, remaining user accounts, catalogue photos/sections and missing BOM/product codes.

## Live features verified

### 1. Management overview and MIS

- Executive MIS dashboard with live-order health, on-time/at-risk/delayed counts and planned dispatch outlook.
- Order-versus-dispatch analysis for the latest 30 days.
- Five-day movement chart for ordered and dispatched pairs.
- Orders-needing-attention list with risk stage, planned dispatch and pending quantity.
- Planned production days, machine output and utilisation.
- Today's production plan and recorded achievement.
- Planned-versus-achieved analysis by day, financial-year week, stage and work centre.
- Complete order-health table with customer, article, quantities and dispatch completion.

### 2. PI generation and order intake

- PI intake from a photographed/handwritten slip.
- PI intake from a spreadsheet.
- Manual PI entry.
- Match-and-check review before issuing the PI.
- Exact-size and size-range handling.
- Article/type packing recalculation.
- Multi-article and multi-customer workbook handling.
- PI draft retention while moving between screens.
- PI regeneration after reviewed data changes.
- Editable quantities, sizes, MRP and discount before issue.
- Printed PI with article image, product code, pricing, deductions and customer terms.
- Missing or ambiguous catalogue/BOM data is surfaced instead of guessed.

### 3. PI database and Order Book

- Master PI database with revision number and issued status.
- View/edit, archive and guarded permanent-delete actions.
- Order Book with order, party, article, ordered quantity, quantity on job cards, dispatched quantity, priority and planned dispatch.
- Partial release to job cards: the unreleased balance remains visible as “waiting for a card.”
- Customer filter and previous-product history.
- Manual priority movement and planning override.
- Completed-order view and downloadable order sheet.

### 4. Job orders and production planning

- Create a job order from the remaining quantity in the Order Book.
- Size-wise release against an order without exceeding the quantity still owed.
- Internal-line and external-fabricator issue flows.
- Job Orders Database with issued, received, shortage, payment and slip details.
- Job-card-wise scheduling: separate cards for one order are scheduled independently.
- Unreleased quantities stay outside the machine plan until a card is created.
- Stage-by-stage routing through cutting, stitching, upper QC, molding/pasting, packing and dispatch.
- Parallel machine scheduling with capacity protection.
- Manual queue, date, duration and machine overrides.
- Production plan by machine and day, with print/PDF output.
- Machine-load view with capacity, utilisation, targets, lead times and assignments.
- Production-status board showing recorded movements first and forecast location where no movement exists.
- Financial-year week numbering and Monday-to-Saturday working weeks.
- External fabricator transport time is included without consuming factory-machine capacity.

### 5. Daily plan versus achievement

- The daily sheet is generated from the current production plan; users enter only achieved pairs and an optional note.
- Achievement is recorded against the exact date, job card, stage and work centre.
- Short production is re-planned from the following day.
- Later stages and later queued work move with the unfinished balance.
- Over-achievement is handled without producing negative remaining work.
- Weekly Excel download and completed-workbook upload are available.
- Dashboard and planned-versus-achieved reporting read the recorded achievement.

### 6. Repair, packing and dispatch

- Repair movements for sent, returned and rejected pairs, by order and size.
- “On the bench” repair quantity is separated from permanent rejection/shortage.
- Pairs still in repair are held back from dispatch.
- Repair production is prioritised against dispatch need.
- Dispatch Book shows ordered, dispatched, packed and pending quantities.
- Partial, full/final and close-short dispatch types.
- Packing reports are segregated within each order so separate dispatches are not mixed.
- Counted-carton packing list with sequential carton numbers.
- Mixed-carton entry with exact size and pair composition.
- Live control “+ Add a mixed carton” was verified on the deployed website.
- Gate-pass and packing-list generation use the same reconciled carton data.
- Existing packing reports can be viewed by order.

### 7. Procurement, materials and stock

- Procurement list nets material demand against the stock register.
- Required date is linked to the production stage that consumes the material.
- Late, seven-day and later requirements are separated.
- Stock screen has four operating sections: **Add Stock, View Stock, MTO Stock and Add New Material**.
- Stock opening, receipt, issue, adjustment, minimum level, supplier and cost fields.
- Stock input workbook download/upload and Excel export.
- Job-card material issue accumulates in the stock register.
- MTO/customer and stock-job-card distinction is represented in the model.

### 8. Catalogue, packing rules and BOM

- Browse catalogue by shoe family, colour and closure.
- Separate material and catalogue-section filters.
- Gola Plus remains separate from Gola; variants are grouped under their correct family.
- Editable article photo, description, material/sole information, price and MRP.
- Official 2025–26 REX catalogue PDF is linked in the application.
- Live catalogue data-sheet download.
- Packing source, range packing and individual-size overrides.
- BOM workbook upload with preview, validation and replacement confirmation.
- Add/remove article, range or material with impact checks.
- Database revision snapshots and restore points.
- Product-code assignment and grouping.
- Client-supplied weekly plans, Pasting JC, Packing JC, packing list and gate-pass references are stored with the project and covered by regression tests.

### 9. Setup, people and access

- Party-level commercial terms.
- Internal lines, external fabricators and sample fabricators.
- Fabricator rates, turnaround, contacts, active/inactive status and payment calculation.
- Named profiles with role-based access.
- Roles cover Admin, Owner/Director, Sales, Dispatch, Production Planning, Procurement, Store, Catalogue/BOM and Auditor access.
- Server-side permission checks and screen-level restrictions.
- Password change, session-expiry handling and sign-out.

## End-to-end client demo scenario

The requested demonstration has been exercised twice by the automated suite:

1. Start with a PI for **1,000 pairs**.
2. Release **500 pairs** on a job card; the Order Book retains **500 waiting for a card**.
3. Schedule only the released 500 pairs from the job card's start date.
4. Record **425 pairs achieved**, or 85% of the scheduled quantity.
5. Re-plan the remaining **75 pairs** to the next day and push the work behind it.
6. Dispatch the 425 produced pairs using full cartons plus a mixed carton.
7. Reconcile the order as **1,000 ordered / 500 on a job card / 425 dispatched / 575 still pending**.

This scenario passed twice in the full suite. The production website was not mutated during the audit; live checks were intentionally limited to read-only navigation and non-saving packing-list preview.

## Ready locally but not yet deployed

The Desktop project is one commit ahead of the live website:

- Material availability is shown before a PI or job order is issued. It reports whether the required **materials** are in the store; it does not invent finished-goods stock that is not recorded by the system.
- Schedule opens with an “On the floor today” view by machine, followed by a two-week/six-week/full planning window.

These changes are fully tested locally but are not present in live build `b646f58`.

## Remaining product work

| Priority | Item | Current position |
| --- | --- | --- |
| Before demo | Reconcile full ordered quantity in MIS/customer totals | 2,816 unreleased pairs are omitted from some totals; fix required. |
| Before demo | Deploy the latest Desktop commit | Tested and ready locally; live site is one commit behind. |
| High | Complete recommended user allocation | 5 of 11 recommended seats are covered; six seats remain. |
| High | Complete stock onboarding | 399 of 470 materials have never been counted; stock value is currently ₹0. |
| High | Complete customer/party terms | Live orders have five customers, but the party-terms master has no records. |
| High | Complete catalogue data | 34 shoes / 165 variants are loaded, but sections are unset, many photos are missing, one variant is missing a BOM and product codes remain unassigned. |
| Medium | PO generation and PO tracking | Procurement shortfall list exists; a purchase-order workflow does not. |
| Medium | Final client-format catalogue export | A data-sheet export exists; the final client-designed output has not been accepted. |
| Medium | Four external stitching lines/layout | External work is supported; the requested four-line weekly layout is not complete. |
| Medium | Finished-goods/stock-job-card workflow | Material issue exists; a finished-goods stock report and completed stock-job-card posting remain. |
| Medium | Archive/delete completed job orders and export full history | Not present in the audited commit or live build; separate uncommitted work must not be treated as released. |
| Low | Move Change password under an Accounts area | It currently appears in the page header. |

## Items that should not be shown as pending development

- **Quotation module:** intentionally removed at the owner's request; this is cancelled, not an unfinished feature.
- **JC format dependency:** the Pasting and Packing JC files have now been received, stored and implemented.
- **Mixed cartons:** live and verified.
- **Daily production input:** live and loading successfully; the former `production_actuals` schema error is no longer present.
- **Repair planning:** live and verified.
- **Stock tabs and Add New Material:** live and verified; old tracker notes saying they do not exist are stale.

## Audit boundary

The Desktop working tree changed concurrently after the two test passes. Uncommitted order-export and finished-goods experiments are therefore excluded from every “live” or “verified” claim above. They must be completed, committed and re-tested before being added to the client list.
