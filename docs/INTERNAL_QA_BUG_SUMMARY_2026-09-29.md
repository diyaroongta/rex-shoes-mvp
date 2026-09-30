# Factory OS — Internal QA and Bug Summary

**Audit date:** 29 September 2026  
**Live URL:** `https://rex-shoes-mvp.vercel.app`  
**Live build:** `b646f58`  
**Desktop HEAD:** `f904fd4`  
**Tracker reviewed:** 106 rows on the Google Sheet “Live Tracker”

## Test coverage completed

- Two live navigation passes across Executive MIS plus all 20 menu screens.
- Targeted second checks on PI Database, Daily plan vs achievement, Profiles & access, Catalogue, Order Book and mixed-carton dispatch.
- No live browser warnings or errors.
- No live `500`, missing-relation, stale-schema, failed-fetch or page-load errors.
- Daily production actuals load successfully; the earlier missing `production_actuals` relation is resolved on the live database.
- Mixed-carton control verified on the live Dispatch Book without saving a dispatch.
- Two complete automated test runs:
  - 43 configured core test files, all passing on each run.
  - 19 UI/API test files and 248 tests, all passing on each run.
- Production build succeeded.
- Build warning only: the main JavaScript bundle is approximately 1.70 MB minified / 699 KB gzip.

The live audit did not submit, delete, archive, issue, dispatch, upload or otherwise alter production data. Those state-changing cases were exercised in the isolated automated suite.

The Desktop working tree changed concurrently after both test passes and the production build. Later uncommitted order-export and finished-goods work is excluded from the audited release and from the passing-test claim; it needs its own completed implementation and clean re-run.

## Bugs and readiness findings

| ID | Severity | Finding | Evidence / impact | Recommended action |
| --- | --- | --- | --- | --- |
| QA-001 | High | Live deployment is one commit behind Desktop | Live is `b646f58`; Desktop and local `main` are `f904fd4`; `origin/main` is also `b646f58`. The material check before PI/job order and floor-first Schedule are not live. | Push/deploy `f904fd4`, then verify the displayed build ID. |
| QA-002 | High | MIS and customer totals omit quantities waiting for a job card | Top bar and Dispatch Book show **5,188 ordered/pending pairs**. MIS Total live orders and Still to ship show **2,372**. JO2161 is **4,816 ordered**, but only **2,000** scheduled; the missing **2,816** is excluded from MIS and the customer-filter total. | Calculate order totals from original order lines/full ordered quantity, not scheduled `qty`; add a regression test for partial job-card release. |
| QA-003 | Medium | “Last dispatch” is actually the latest planned dispatch | Header says **Last dispatch 4 Oct** while Dispatch Book shows **0 dispatched**. Engine `totals.last_dispatch` is the maximum planned dispatch date. | Rename to “Latest planned dispatch” or derive the label from the actual dispatch ledger. |
| QA-004 | Medium | Same session uses two different “today” dates | MIS showed **As of 30 Sept 2026**, while Production status showed **29 Sept 2026**. MIS defaults from UTC; other screens use a local date helper. | Define one factory timezone and use one date helper across MIS, production input, status and schedule. |
| QA-005 | Medium / data | Stock and procurement figures are not yet operationally trustworthy | Live Stock shows **470 materials**, **399 never counted** and **₹0 stock value**. Procurement reports 120 items to buy and 112 already late against mostly zero/unentered stock. | Import/count opening stock, minimums, costs, suppliers and item codes before using procurement KPIs as commitments. |
| QA-006 | Medium / data | Party terms master is empty | Parties & terms says “No parties yet,” while the Order Book contains five customers. | Create the customer records and agreed payment/discount/deduction terms. |
| QA-007 | Medium / data | Catalogue is structurally working but incomplete | Live has **34 shoes / 165 variants**; no catalogue section is assigned, many families show “No photo,” one variant is missing a BOM, and Data & BOM offers to assign codes to 87 articles. | Complete photos, sections, the missing BOM and product-code assignment; verify final catalogue export. |
| QA-008 | Medium / setup | Recommended access allocation is incomplete and the tracker count is stale | Profiles shows **5/11 recommended seats filled** and six active logins. Remaining recommended seats are two Owner/Director plus Planner, Procurement, Catalogue/BOM and Auditor = **six**, not seven. | Create the six missing seats and update T-081. |
| QA-009 | Medium | Completed-job archive/delete/history is not a finished feature | T-108 is not present in the audited commit or live build. Concurrent uncommitted work must not be counted as released. | Finish UI, migration, tests and history export; commit and deploy as one change. |
| QA-010 | Low | MIS copy is stale | “This becomes actual output after the shop-floor actual feed is connected” remains on the machine-output section even though production actuals are live. | Rewrite to distinguish scheduled machine output from actual achievement. |
| QA-011 | Low | Main bundle is large | Vite warns that the main bundle is above 500 KB. This did not prevent a successful build. | Later: split PDF/catalogue/report code into lazy-loaded chunks. |
| QA-012 | Low / tracker | Tracker contains duplicate IDs and conflicting status fields | T-103, T-104 and T-107 are duplicated. There are 88 “Yes” rows but only 85 “Done and live” plan rows. Several Yes rows retain notes saying the feature does not exist. | Give every task a unique ID and replace formula/stale notes with audited statuses. |

## Tracker reconciliation

The tracker currently says **88 Yes, 3 Partial and 15 No**. It should not be shared unchanged.

### Rows whose old notes are wrong

| Task | Correct position |
| --- | --- |
| T-084 Add New Material | Live. The old note saying it exists only through BOM upload is stale. |
| T-085 Stock: Add/View/MTO | Live, including Add New Material. The old “Add and MTO do not exist” note is stale. |
| T-090 Production status | Live with recorded-versus-planned stage position. |
| T-091 Daily plan vs achievement | Live, including database actuals, Excel download/upload and downstream re-planning. |
| T-092 Planned vs achieved on MIS | Live. |
| T-093 FY week numbering | Live and covered by tests. |
| T-104 Pasting/Packing JC format dependency | The client files are now stored and their formats are implemented/tested. Close the dependency row. |
| T-105 Show stock during PI/job order | Implemented and tested in Desktop commit `f904fd4`, but not live. Mark “Ready to deploy,” not Done. |

### Rows that should remain partial or open

| Task | Audited status |
| --- | --- |
| T-055 Catalogue images | Partial: many live families still show no photo. |
| T-075 Remaining Procurement/Stock | Partial: functions exist, but final scope and real stock data remain. |
| T-079 Catalogue all items | Partial rather than simply No: 34 families/165 variants are loaded, but data completion remains. |
| T-081 Add 11 profiles | Partial: 5/11 recommended seats filled; six remain. |
| T-042 Final packing reports for every article | Blocked on the final client data/approval. |
| T-087 PO generation/tracking | Not built. |
| T-089 Final-format catalogue-sheet download | Generic export exists; final requested layout is not accepted. |
| T-094 Four external stitching lines/layout | Not complete. |
| T-095 Finished stock/job-card posting | Not complete. Material issue exists, but this is not the full finished-goods workflow. |
| T-096 Quotation module | Cancelled by owner request; remove from the backlog instead of showing No. |
| T-098 Hosting presentation | Ambiguous wording; website hosting is live, presentation deliverable needs clarification. |
| T-102 Stock/material code list | Client data dependency remains; live stock data is incomplete. |
| T-103 Final catalogue output format | Client acceptance dependency remains. |
| T-106 Formats package | Partial: job cards, packing list, gate pass, stock input and raw-material creation exist; final catalogue format and finished-goods report remain. |
| T-108 Completed JC/challan archive-delete/history | In progress locally; not complete or live. |
| T-111 Change password under Accounts | Not done; button remains in the header and there is no separate Accounts tab. |

## Verified end-to-end regression

The client’s 1,000-pair scenario passed in both automated runs:

- 1,000 ordered.
- 500 released to one job card and 500 waiting.
- Only the released 500 scheduled.
- 425 achieved on the planned day.
- 75 re-planned to the following day.
- Downstream work moved without overlap.
- 425 packed in full cartons plus one mixed carton.
- Gate pass and packing list reconciled.
- Order result: 1,000 ordered / 500 on job card / 425 dispatched / 575 pending.

## Release gate

Before presenting this as the final client build:

1. Fix QA-002 quantity reconciliation and add the partial-release MIS regression.
2. Deploy `f904fd4` or the later agreed commit and confirm the live build ID changes.
3. Apply any schema migration included in T-108 only when its UI and tests are complete.
4. Re-run the same two-pass suite against the release commit.
5. Populate the agreed demonstration stock, party terms, users and catalogue records.
