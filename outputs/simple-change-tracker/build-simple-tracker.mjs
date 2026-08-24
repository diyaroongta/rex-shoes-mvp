import fs from "node:fs/promises";
import {
  SpreadsheetFile,
  Workbook,
} from "/Users/diyaroongta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const outputDir = "/Users/diyaroongta/Downloads/factory-os/outputs/simple-change-tracker";
const outputPath = `${outputDir}/Factory_OS_Simple_Change_Tracker.xlsx`;
const previewPath = `${outputDir}/Factory_OS_Simple_Change_Tracker.png`;

const rows = [
  ["Demo how to add BOMs, catalogue pictures and packing lists", "Diya", "No"],
  ["Treat L as Large; keep Lace and Velcro separate", "Diya", "No"],
  ["Add individual sizes alongside combo sizes", "Diya", "No"],
  ["Send the packing report format", "Abhay", "No"],
  ["Review MIS capacity utilisation and production days", "Diya", "No"],
  ["Warn when MIS data is stale or old PIs are added", "Diya", "No"],
  ["Add average dispatch days to MIS", "Diya", "No"],
  ["Add dispatch shortage and order-vs-dispatch percentages", "Diya", "No"],
  ["Show the MIS calculation logic", "Diya", "No"],
  ["Add repair quantity capture and repair production planning before dispatch", "Diya", "No"],
  ["Password-protect Machine Load", "Diya", "No"],
  ["Show procurement shortfall against each PI", "Diya", "No"],
  ["Allow article-specific production plans in Catalogue", "Diya", "No"],
  ["Allow partial PI scheduling", "Diya", "No"],
  ["Allow manual production-plan editing with warnings and override", "Diya", "No"],
  ["Create the management MIS dashboard", "Diya", "No"],
  ["Fix order reading when one article has multiple size lines", "Diya", "No"],
  ["Create the client input sheet for machines, live plans and actual production", "Diya", "No"],
  ["Make Catalogue editable for all categories, including Gola Plus", "Diya", "No"],
  ["Link scheduling to the PI database", "Diya", "No"],
  ["Generate a PI after Match & Check edits", "Diya", "Yes"],
  ["Require PI regeneration when checked data changes", "Diya", "Yes"],
  ["Retain PI draft while changing tabs", "Diya", "Yes"],
  ["Create a new PI after edits", "Diya", "Yes"],
  ["Remove Party & Article Defaults from Match & Check", "Diya", "Yes"],
  ["Keep customer and order fields on every article", "Diya", "Yes"],
  ["Recalculate packing when article or type changes", "Diya", "Yes"],
  ["Make Spike follow Armour packing", "Diya", "Yes"],
  ["Show the packing list for every article and type", "Diya", "Yes"],
  ["Show the BOM for every article and type", "Diya", "Yes"],
  ["Edit pairs per carton in Packing & BOM Rules", "Diya", "Yes"],
  ["Read the supplied Institutional and MTO order book", "Diya", "Yes"],
  ["Read all workbook sheets and XLSM files in bulk upload", "Diya", "Yes"],
  ["Use a one-row-per-article order template", "Diya", "Yes"],
  ["Edit orders after saving a PI", "Diya", "Yes"],
  ["Create a master PI database", "Diya", "Yes"],
  ["Remove dispatch timeline from Parties & Terms", "Diya", "Yes"],
  ["Remove the unnecessary one-day production buffer", "Diya", "Yes"],
  ["Show production-planning logic for each order", "Diya", "Yes"],
  ["Document Vercel and database deployment steps", "Diya", "Yes"],
  ["Use party discount and payment terms on each PI", "Diya", "Yes"],
  ["Allow order entry in cartons", "Diya", "Yes"],
  ["Add Preparation between Cutting and Stitching", "Diya", "Yes"],
  ["Choose in-house or outside stitching and capture printing", "Diya", "Yes"],
  ["Add Upper QC between Stitching and Molding", "Diya", "Yes"],
  ["Separate PVC Rotary, PVC Vertical, PU and Stuck-on machines", "Diya", "Yes"],
  ["Separate Packing and Dispatch stages", "Diya", "Yes"],
  ["Create dispatch reports and reduce pending quantity", "Diya", "Yes"],
  ["Allow specific sizes on an article", "Diya", "Yes"],
  ["Add Partial, Full and Shortage dispatch statuses", "Diya", "Yes"],
];

const workbook = Workbook.create();
const sheet = workbook.worksheets.add("Changes");
sheet.showGridLines = false;
sheet.freezePanes.freezeRows(1);

const values = [["Changes discussed", "Task for", "Made yet?"], ...rows];
const lastRow = values.length;
sheet.getRange(`A1:C${lastRow}`).values = values;

const header = sheet.getRange("A1:C1");
header.format.fill = "#E7EAEE";
header.format.font = { bold: true, color: "#1F2937", size: 11 };
header.format.rowHeight = 26;
header.format.verticalAlignment = "center";
header.format.borders = { bottom: { style: "medium", color: "#9CA3AF" } };

const body = sheet.getRange(`A2:C${lastRow}`);
body.format.font = { color: "#1F2937", size: 10 };
body.format.rowHeight = 23;
body.format.verticalAlignment = "center";
body.format.borders = { bottom: { style: "thin", color: "#E5E7EB" } };

sheet.getRange(`A2:A${lastRow}`).format.horizontalAlignment = "left";
sheet.getRange(`B2:C${lastRow}`).format.horizontalAlignment = "center";
sheet.getRange(`A1:A${lastRow}`).format.columnWidth = 64;
sheet.getRange(`B1:B${lastRow}`).format.columnWidth = 14;
sheet.getRange(`C1:C${lastRow}`).format.columnWidth = 14;

sheet.getRange(`B2:B${lastRow}`).dataValidation = {
  rule: { type: "list", values: ["Abhay", "Diya"] },
};
sheet.getRange(`C2:C${lastRow}`).dataValidation = {
  rule: { type: "list", values: ["Yes", "No"] },
};

await fs.mkdir(outputDir, { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

const preview = await workbook.render({
  sheetName: "Changes",
  range: "A1:C24",
  scale: 1.15,
  format: "png",
});
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const inspection = await workbook.inspect({
  kind: "sheet,table,region",
  sheetId: "Changes",
  range: `A1:C${lastRow}`,
  maxChars: 5000,
  tableMaxRows: 8,
  tableMaxCols: 3,
});

console.log(JSON.stringify({ outputPath, previewPath, rows: rows.length }));
console.log(inspection.ndjson);
