import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const inputPath = "/Users/diyaroongta/Downloads/factory-os/outputs/simple-change-tracker/Factory_OS_Simple_Change_Tracker_Improved.xlsx";
const outputDir = "/Users/diyaroongta/Downloads/factory-os/outputs/01a082f4-eedf-7700-a6fa-64094b3f808d";

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath));
await fs.mkdir(outputDir, { recursive: true });

const summary = await workbook.inspect({
  kind: "workbook,sheet,table,definedName,drawing",
  maxChars: 12000,
  tableMaxRows: 10,
  tableMaxCols: 14,
});
console.log(summary.ndjson);

for (const sheetName of ["Changes", "Live Tracker"]) {
  const sheet = workbook.worksheets.getItem(sheetName);
  const used = sheet.getUsedRange();
  const region = await workbook.inspect({
    kind: "table,region,formula",
    sheetId: sheetName,
    range: used.address.split("!").at(-1),
    maxChars: 26000,
    tableMaxRows: 100,
    tableMaxCols: 14,
    options: { maxResults: 400 },
  });
  console.log(region.ndjson);

  const preview = await workbook.render({
    sheetName,
    autoCrop: "all",
    scale: 1.2,
    format: "png",
  });
  await fs.writeFile(`${outputDir}/${sheetName.replaceAll(" ", "_")}-before.png`, new Uint8Array(await preview.arrayBuffer()));
}
