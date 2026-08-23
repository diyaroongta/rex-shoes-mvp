# Factory OS test matrix

Date: 22 August 2026

Status meanings: **Automated** runs in CI; **Browser verified** was exercised in the
rendered local application; **Partial** has important uncovered branches; **Blocked**
needs an external test environment or missing factory data.

| Area | Status | Evidence / remaining gap |
|---|---|---|
| Scheduling engine and machine exclusivity | Automated | Capacity, routing, contention and no one-day in-house buffer |
| PI size explosion and invoice maths | Automated | Size suffixes, exact quantities, MRP discount and deduction ladder |
| Handwritten SPIKE intake | Automated + Browser verified | Exact Velcro/Lace sizes and ARMOUR packing retained through PI |
| Draft retention across tabs | Automated + Browser verified | Match & Check state remains mounted until Save or Close PI |
| Regenerate PI after edits | Automated | Editing Match & Check marks preview stale and blocks save |
| Bulk workbook parser | Automated + representative workbook checked | Correct known rows; current workbook is blocked because 57 rows lack safe reference mappings |
| Bulk upload browser commit | Partial | Parser is covered; file chooser/download and live DB commit need Playwright + test DB |
| Order create | Automated with mocked DB | Live-reference validation and exact-size totals; real Postgres pending |
| Saved-order edit | Automated with mocked DB | `sizes`, `size_order` and `ppc` preservation; full UI edit branches partial |
| PI database → schedule | Automated UI + mocked API | Explicit link and duplicate protection logic; real Postgres pending |
| Dispatch | Automated UI + mocked API | SPIKE packing inheritance and over-dispatch; delete/full/shortage UI branches partial |
| Party terms | Automated UI + mocked API | Party creation validation and locked PI terms; deactivate branch partial |
| Packing & BOM edits | Automated UI + mocked API | SPIKE edits persist to ARMOUR source; full BOM upload parser remains uncovered |
| Catalogue | Partial | Rendered screen and price validation; photo resize, clear/delete and all edit branches uncovered |
| Stock register | Partial | Screen renders; edit/export/database flows uncovered |
| Machine settings | Automated API contract | Partial updates preserve prior settings; all UI controls not individually exercised |
| All 15 navigation screens | Browser verified | Every screen opened without a React crash using bundled fallback data |
| Print / Save PDF | Partial | PI DOM renders; popup, pagination and browser download are not automated |
| Live AI photo/PI reading | Blocked | Requires test provider credentials and deterministic recorded fixtures |
| Live Neon/Postgres | Blocked | No `DATABASE_URL` is present in the supplied folder |
| Authentication and roles | Not built | Must exist before production-wide access |

Run `npm run check` before every push. Coverage reports are written to
`coverage/core` and `coverage/ui-api` locally and are ignored by Git.
