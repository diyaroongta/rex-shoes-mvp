# Client demo — adding an article safely

## Before recording

- Deploy the latest code.
- Run `npm run db:setup` once against Neon so the revision-history tables exist.
- Keep one product photo ready as JPG or PNG.
- Make a copy of `Factory_OS_Reference_Upload_Template.xlsx` and fill the example article on the BOM, Packing and Catalogue tabs.

## Demo flow

1. Open **Data & BOM**.
2. Click **Download upload template** and briefly show the Instructions, BOM, Packing, Catalogue and Example tabs.
3. Upload the completed workbook under **Upload the Factory OS article master**.
4. Show the preview counts for BOM, packing and catalogue.
5. If the article already exists, show that **Validate and save all** stays disabled until the replacement checkbox is selected.
6. Click **Validate and save all**. Explain that invalid rows save nothing; a valid workbook is saved in one transaction and receives a database revision snapshot.
7. Open **Catalogue**, find the article, add/replace its photo, description, price, sole process, PVC machine where applicable, and MRP by size range.
8. Open **Packing & BOM rules**, select the article and show the stored size ranges, pairs/carton and per-pair BOM rates.
9. Create a small test order for the article. Enter cartons and show that pairs are calculated from the saved packing rule.
10. Generate the PI and expand **Packing list & BOM used** to prove the order is using the newly stored reference data.

## Safety points to say on video

- Article codes are normalised for case and spacing, so `glamour` and ` GLAMOUR ` are treated as the same exact article.
- A complete existing BOM cannot be replaced silently; confirmation is mandatory.
- Duplicate BOM rows, invalid stages, invalid rates and packing ranges not present in the BOM are blocked.
- Packing and catalogue uploads merge fields and do not delete values omitted from the workbook.
- Database writes are transactional: either the whole upload saves or none of it saves.
- Every reference or catalogue save creates a revision snapshot for recovery.
- Photos are uploaded separately because an Excel filename cannot attach a file from the client’s computer.
