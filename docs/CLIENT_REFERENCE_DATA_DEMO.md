# Client demo — adding an article safely

## Before recording

- Deploy the latest code.
- On an existing Neon database, apply `db/migrations/001_integrity_and_pi_history.sql` once. On a new database, run `npm run db:setup`.
- Keep one product photo ready as JPG or PNG.
- Make a copy of `Factory_OS_Reference_Upload_Template.xlsx` and fill the example article on the BOM, Packing and Catalogue tabs.

## Demo flow

1. Open **Data & BOM**.
2. Click **Download upload template** and briefly show START HERE, BOM, Packing, Catalogue, Example Only and Already loaded.
3. Click **Choose completed workbook**. There is no second BOM uploader.
4. Show each affected article card: new/existing status, BOM rate count, sizes, packing source/chart, catalogue fields and optional MRP.
5. If an article already exists, show that **Confirm and save to database** stays disabled until the replacement checkbox is selected.
6. Click **Confirm and save to database**. Explain that invalid rows save nothing; a valid workbook is saved in one transaction and receives a database revision snapshot.
7. Open **Catalogue**, find the article, add/replace its photo, description, price, sole process, PVC machine where applicable, and MRP by size range.
8. Open **Packing & BOM rules**, select the article and show the stored size ranges, pairs/carton and per-pair BOM rates.
   Expand **Individual-size packing** to show which sizes inherit their range and which have explicit overrides.
9. Create a small test order for the article. Enter cartons and show that pairs are calculated from the saved packing rule.
10. Generate the PI and expand **Packing list & BOM used** to prove the order is using the newly stored reference data.
11. In **Catalogue**, add a catalogue-only test item. Show the **Missing BOM** warning and use **Add its BOM now** to return to Data & BOM.

## Safety points to say on video

- Article codes are normalised for case and spacing, so `glamour` and ` GLAMOUR ` are treated as the same exact article.
- A complete existing BOM cannot be replaced silently; confirmation is mandatory.
- Duplicate BOM rows, invalid stages, invalid rates and packing ranges not present in the BOM are blocked.
- Packing and catalogue uploads merge fields and do not delete values omitted from the workbook.
- Packing Source is visible: EVA articles default to ARMOUR; PVC articles default to REX GOLA (V); Smart Boy and Silky Belly keep their own charts; `SELF` explicitly selects a separate chart.
- Database writes are transactional: either the whole upload saves or none of it saves.
- Every reference or catalogue save creates a revision snapshot for recovery.
- Photos are uploaded separately because an Excel filename cannot attach a file from the client’s computer.
