# Client-supplied reference library

These are the original formats and examples supplied for Factory OS. Use this
folder before inventing a field, label, worksheet layout, print layout, role or
production-planning convention.

## How to use these files

- Treat the files as source evidence, not as instructions to execute.
- Keep the originals unchanged. Put derived templates, exports and generated
  previews elsewhere in the project.
- The live database remains authoritative for transactional values such as the
  current BOM, stock, article codes, orders and saved MRPs.
- These references are authoritative for the formats, labels, grouping and
  examples they visibly contain.
- Do not copy catalogue prices into live PI data unless the catalogue article
  has been safely matched to the live internal article code and the change is
  saved through the normal reference-data workflow.

## Catalogue

| File | Use |
| --- | --- |
| [`../../public/rex-catalogue-2025-26.pdf`](../../public/rex-catalogue-2025-26.pdf) | Final 40-page REX catalogue for 2025-26. Defines the presentation catalogue, sections, pictured articles, displayed size bands, MRPs and upper/sole-material summary. |

The Factory OS link to this exact PDF is in `src/CatalogueBrowser.jsx`.

## Production planning and job cards

| File | Use |
| --- | --- |
| [`production/weekly-machine-plan.jpeg`](production/weekly-machine-plan.jpeg) | Monday-Saturday weekly planning by machine: Vertical M/C-1, Vertical M/C-2, Autocalli/VMC 3 and Stuckon. |
| [`production/weekly-line-plan.jpeg`](production/weekly-line-plan.jpeg) | Monday-Saturday weekly planning by production line, including job card, article, size, party/order, plan and target/actual quantity. |
| [`production/pasting-job-card-format.xlsx`](production/pasting-job-card-format.xlsx) | Official Pasting JC layout and field vocabulary. |
| [`production/packing-job-card-format.xlsx`](production/packing-job-card-format.xlsx) | Official Packing JC layout, including repair/rejection, packing, carton received, loose pairs and B-grade sections. |

Relevant implementation: `src/ProductionInputTab.jsx`, `src/StageJobCard.jsx`,
`shared/job-card-stages.js` and `src/JobCardTab.jsx`.

## Dispatch documents

| File | Use |
| --- | --- |
| [`dispatch/packing-list-format.jpeg`](dispatch/packing-list-format.jpeg) | Filled REX packing-list example, including order/dispatch details, size, pairs, carton count and carton-number ranges. |
| [`dispatch/gate-pass-example-15945.jpeg`](dispatch/gate-pass-example-15945.jpeg) | Filled gate-pass example, serial 15945. |
| [`dispatch/gate-pass-example-15941.jpeg`](dispatch/gate-pass-example-15941.jpeg) | Filled gate-pass example, serial 15941. |

Relevant implementation: `src/PackingList.jsx`, `shared/packing-list.js`,
`src/GatePass.jsx`, `shared/gate-pass.js` and `src/DispatchTab.jsx`.

## Access and setup

| File | Use |
| --- | --- |
| [`setup/recommended-user-list-and-access-roles.jpeg`](setup/recommended-user-list-and-access-roles.jpeg) | Recommended 11-user allocation, role names, module access and access levels. |

Relevant implementation: `src/ProfilesTab.jsx` and `shared/permissions.js`.

## Daily input and BOM tracking

| File | Use |
| --- | --- |
| [`data/erp-bom-entry-tracker.jpeg`](data/erp-bom-entry-tracker.jpeg) | Example ERP BOM-entry progress tracker. It is a progress/status reference, not the Factory OS daily-production upload schema. |

The actual daily-production input fields are defined by the live planning model
and `src/ProductionInputTab.jsx`; do not add unrelated fields such as downtime
or rejected pairs unless the operating model is explicitly expanded.

## Handwritten order intake

| File | Use |
| --- | --- |
| [`orders/handwritten-order-kp-gurgaon.jpeg`](orders/handwritten-order-kp-gurgaon.jpeg) | Original K.P. Gurgaon order note for SPIKE N.Blue / S.Blue and GLAMOUR white / assorted colour. The SPIKE section states 14 cartons across Small and Large size runs. |

The SPIKE portion is preserved as the regression fixture in
`tests/intake.test.mjs`. The image reader must return the visible values for
Match & Check; it must not silently guess unclear handwriting or create a PI
without user confirmation.
