import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const sourcePath = "/Users/diyaroongta/Downloads/factory-os/outputs/simple-change-tracker/Factory_OS_Simple_Change_Tracker.xlsx";
const outputDir = "/Users/diyaroongta/Downloads/factory-os/outputs/simple-change-tracker";
const outputPath = `${outputDir}/Factory_OS_Simple_Change_Tracker_Improved.xlsx`;
const previewDir = "/Users/diyaroongta/Downloads/factory-os/.codex-spreadsheet-work";

const palette = {
  ink: "#1F2937",
  muted: "#667085",
  navy: "#203864",
  navy2: "#2F5597",
  header: "#E7EAEE",
  line: "#D0D5DD",
  blue: "#D9EAF7",
  pink: "#F4D0EC",
  green: "#DDF2D4",
  greenInk: "#256D37",
  red: "#FDE2E2",
  redInk: "#A12622",
  amber: "#FFF2CC",
  white: "#FFFFFF",
};

const input = await FileBlob.load(sourcePath);
const sourceWorkbook = await SpreadsheetFile.importXlsx(input);
const sourceChanges = sourceWorkbook.worksheets.getItem("Changes");
const rawRows = sourceChanges.getRange("A2:D59").values;
let carriedDate = null;
const entries = rawRows.map((row, index) => {
  const [rawDate, rawTask, rawOwner, rawDone] = row;
  if (rawDate != null && String(rawDate).trim() !== "") {
    const day = Number(String(rawDate).match(/\d+/)?.[0]);
    carriedDate = new Date(2026, 7, day);
  }
  return {
    id: `T-${String(index + 1).padStart(3, "0")}`,
    date: carriedDate ? new Date(carriedDate) : null,
    task: rawTask == null ? "" : String(rawTask),
    owner: rawOwner == null || String(rawOwner).trim() === "" ? "Unassigned" : String(rawOwner),
    done: String(rawDone ?? "").trim().toLowerCase() === "yes" ? "Yes" : "No",
    originalIndex: index,
  };
}).filter((entry) => entry.task !== "");

entries.sort((a, b) => {
  const dateDiff = (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
  return dateDiff || a.originalIndex - b.originalIndex;
});

const workbook = Workbook.create();
const changes = workbook.worksheets.add("Changes");
changes.showGridLines = false;
changes.freezePanes.freezeRows(4);

changes.getRange("A1:E1").merge();
changes.getRange("A1").values = [["Factory OS Change Log"]];
changes.getRange("A1:E1").format = {
  fill: palette.navy,
  font: { bold: true, color: palette.white, fontSize: 18 },
  verticalAlignment: "center",
};
changes.getRange("A1:E1").format.rowHeight = 34;

changes.getRange("A2:E2").merge();
changes.getRange("A2").values = [["Tasks are grouped by day. Update owners and Yes/No status on the Live Tracker tab."]];
changes.getRange("A2:E2").format = {
  fill: "#F5F7FA",
  font: { italic: true, color: palette.muted, fontSize: 10 },
  verticalAlignment: "center",
};
changes.getRange("A2:E2").format.rowHeight = 24;

changes.getRange("A4:E4").values = [["Task ID", "Date", "Changes discussed", "Task for", "Made yet?"]];
changes.getRange("A4:E4").format = {
  fill: palette.header,
  font: { bold: true, color: palette.ink, fontSize: 11 },
  borders: { bottom: { style: "medium", color: "#9CA3AF" } },
  verticalAlignment: "center",
};
changes.getRange("A4:E4").format.rowHeight = 25;

const tracker = workbook.worksheets.add("Live Tracker");
tracker.showGridLines = false;
tracker.freezePanes.freezeRows(7);

tracker.getRange("A1:H1").merge();
tracker.getRange("A1").values = [["Factory OS Live Tracker"]];
tracker.getRange("A1:H1").format = {
  fill: palette.navy,
  font: { bold: true, color: palette.white, fontSize: 18 },
  verticalAlignment: "center",
};
tracker.getRange("A1:H1").format.rowHeight = 34;

const cards = [
  ["A2:B2", "A3:B3", "Total Tasks", "=COUNTA(C8:C65)", palette.blue, palette.navy2, "0"],
  ["C2:D2", "C3:D3", "Completed", '=COUNTIF(E8:E65,"Yes")', palette.green, palette.greenInk, "0"],
  ["E2:F2", "E3:F3", "Outstanding", '=COUNTIF(E8:E65,"No")', palette.red, palette.redInk, "0"],
  ["G2:H2", "G3:H3", "Completion", "=IFERROR(C3/A3,0)", palette.amber, palette.navy, "0%"],
];
for (const [labelRange, valueRange, label, formula, fill, valueColor, numberFormat] of cards) {
  tracker.getRange(labelRange).merge();
  tracker.getRange(valueRange).merge();
  tracker.getRange(labelRange.split(":")[0]).values = [[label]];
  tracker.getRange(valueRange.split(":")[0]).formulas = [[formula]];
  tracker.getRange(labelRange).format = {
    fill,
    font: { bold: true, color: palette.muted, fontSize: 10 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    borders: { top: { style: "thin", color: palette.line }, left: { style: "thin", color: palette.line }, right: { style: "thin", color: palette.line } },
  };
  tracker.getRange(valueRange).format = {
    fill,
    font: { bold: true, color: valueColor, fontSize: 18 },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    numberFormat,
    borders: { bottom: { style: "thin", color: palette.line }, left: { style: "thin", color: palette.line }, right: { style: "thin", color: palette.line } },
  };
  tracker.getRange(labelRange).format.rowHeight = 20;
  tracker.getRange(valueRange).format.rowHeight = 30;
}

tracker.getRange("A5:H5").merge();
tracker.getRange("A5").values = [["Use the dropdown in Done? to toggle each task between Yes and No. Filter the table to focus by date, owner, or status."]];
tracker.getRange("A5:H5").format = {
  fill: "#F5F7FA",
  font: { italic: true, color: palette.muted, fontSize: 10 },
  verticalAlignment: "center",
};
tracker.getRange("A5:H5").format.rowHeight = 24;

tracker.getRange("A7:E7").values = [["Task ID", "Date", "Change / Task", "Owner", "Done?"]];
const trackerRows = entries.map((entry) => [entry.id, entry.date, entry.task, entry.owner, entry.done]);
tracker.getRange(`A8:E${7 + trackerRows.length}`).values = trackerRows;
const trackerTable = tracker.tables.add(`A7:E${7 + trackerRows.length}`, true, "LiveTrackerTable");
trackerTable.style = "TableStyleMedium2";
trackerTable.showBandedRows = true;
trackerTable.showFilterButton = true;

tracker.getRange(`B8:B${7 + trackerRows.length}`).format.numberFormat = "d mmm yyyy";
tracker.getRange(`C8:C${7 + trackerRows.length}`).format.wrapText = true;
tracker.getRange(`A8:A${7 + trackerRows.length}`).format.font = { color: palette.muted, fontSize: 9 };
tracker.getRange(`A8:B${7 + trackerRows.length}`).format.horizontalAlignment = "center";
tracker.getRange(`D8:E${7 + trackerRows.length}`).format.horizontalAlignment = "center";
tracker.getRange(`A8:E${7 + trackerRows.length}`).format.verticalAlignment = "center";
tracker.getRange(`A8:E${7 + trackerRows.length}`).format.rowHeight = 25;

const ownerRange = tracker.getRange(`D8:D${7 + trackerRows.length}`);
ownerRange.dataValidation = { allowBlank: false, list: { inCellDropDown: true, source: ["Diya", "Abhay", "Unassigned"] } };
ownerRange.conditionalFormats.add("containsText", { text: "Diya", format: { fill: palette.blue, font: { color: palette.ink } } });
ownerRange.conditionalFormats.add("containsText", { text: "Abhay", format: { fill: palette.pink, font: { color: palette.ink } } });
ownerRange.conditionalFormats.add("containsText", { text: "Unassigned", format: { fill: palette.amber, font: { color: palette.redInk, bold: true } } });

const statusRange = tracker.getRange(`E8:E${7 + trackerRows.length}`);
statusRange.dataValidation = { allowBlank: false, list: { inCellDropDown: true, source: ["Yes", "No"] } };
statusRange.conditionalFormats.add("containsText", { text: "Yes", format: { fill: palette.green, font: { color: palette.greenInk, bold: true } } });
statusRange.conditionalFormats.add("containsText", { text: "No", format: { fill: palette.red, font: { color: palette.redInk, bold: true } } });

let outputRow = 5;
const sectionRows = [];
const grouped = new Map();
for (const entry of entries) {
  const key = entry.date.toISOString().slice(0, 10);
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(entry);
}

for (const groupEntries of grouped.values()) {
  const groupDate = groupEntries[0].date;
  sectionRows.push(outputRow);
  const dateLabel = groupDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const excelDate = `DATE(${groupDate.getFullYear()},${groupDate.getMonth() + 1},${groupDate.getDate()})`;
  changes.getRange(`A${outputRow}:D${outputRow}`).merge();
  changes.getRange(`A${outputRow}`).values = [[dateLabel]];
  changes.getRange(`E${outputRow}`).formulas = [[`=COUNTIFS('Live Tracker'!$B$8:$B$65,${excelDate},'Live Tracker'!$E$8:$E$65,"Yes")&" of "&COUNTIF('Live Tracker'!$B$8:$B$65,${excelDate})&" done"`]];
  changes.getRange(`A${outputRow}:E${outputRow}`).format = {
    fill: palette.navy2,
    font: { bold: true, color: palette.white, fontSize: 11 },
    verticalAlignment: "center",
  };
  changes.getRange(`E${outputRow}`).format.horizontalAlignment = "right";
  changes.getRange(`A${outputRow}:E${outputRow}`).format.rowHeight = 24;
  outputRow += 1;

  for (const entry of groupEntries) {
    changes.getRange(`A${outputRow}:C${outputRow}`).values = [[entry.id, entry.date, entry.task]];
    changes.getRange(`D${outputRow}`).formulas = [[`=IFERROR(INDEX('Live Tracker'!$D$8:$D$65,MATCH($A${outputRow},'Live Tracker'!$A$8:$A$65,0)),"")`]];
    changes.getRange(`E${outputRow}`).formulas = [[`=IFERROR(INDEX('Live Tracker'!$E$8:$E$65,MATCH($A${outputRow},'Live Tracker'!$A$8:$A$65,0)),"")`]];
    outputRow += 1;
  }
}

const finalChangeRow = outputRow - 1;
changes.getRange(`B6:B${finalChangeRow}`).format.numberFormat = "d mmm yyyy";
changes.getRange(`C6:C${finalChangeRow}`).format.wrapText = true;
changes.getRange(`A6:A${finalChangeRow}`).format.font = { color: palette.muted, fontSize: 9 };
changes.getRange(`A6:B${finalChangeRow}`).format.horizontalAlignment = "center";
changes.getRange(`D6:E${finalChangeRow}`).format.horizontalAlignment = "center";
changes.getRange(`A6:E${finalChangeRow}`).format.verticalAlignment = "center";
changes.getRange(`A6:E${finalChangeRow}`).format.rowHeight = 25;
changes.getRange(`A6:E${finalChangeRow}`).format.borders = {
  insideHorizontal: { style: "thin", color: "#ECEFF3" },
};

for (const sectionRow of sectionRows) {
  changes.getRange(`A${sectionRow}:E${sectionRow}`).format = {
    fill: palette.navy2,
    font: { bold: true, color: palette.white, fontSize: 11 },
    verticalAlignment: "center",
    borders: { preset: "none" },
  };
  changes.getRange(`A${sectionRow}:D${sectionRow}`).format.horizontalAlignment = "left";
  changes.getRange(`E${sectionRow}`).format.horizontalAlignment = "right";
  changes.getRange(`A${sectionRow}:E${sectionRow}`).format.rowHeight = 24;
}

const changeOwnerRange = changes.getRange(`D6:D${finalChangeRow}`);
changeOwnerRange.conditionalFormats.add("containsText", { text: "Diya", format: { fill: palette.blue } });
changeOwnerRange.conditionalFormats.add("containsText", { text: "Abhay", format: { fill: palette.pink } });
changeOwnerRange.conditionalFormats.add("containsText", { text: "Unassigned", format: { fill: palette.amber, font: { color: palette.redInk, bold: true } } });
const changeStatusRange = changes.getRange(`E6:E${finalChangeRow}`);
changeStatusRange.conditionalFormats.add("containsText", { text: "Yes", format: { fill: palette.green, font: { color: palette.greenInk, bold: true } } });
changeStatusRange.conditionalFormats.add("containsText", { text: "No", format: { fill: palette.red, font: { color: palette.redInk, bold: true } } });

changes.getRange("A:A").format.columnWidth = 11;
changes.getRange("B:B").format.columnWidth = 15;
changes.getRange("C:C").format.columnWidth = 62;
changes.getRange("D:D").format.columnWidth = 16;
changes.getRange("E:E").format.columnWidth = 14;

tracker.getRange("A:A").format.columnWidth = 11;
tracker.getRange("B:B").format.columnWidth = 15;
tracker.getRange("C:C").format.columnWidth = 62;
tracker.getRange("D:D").format.columnWidth = 16;
tracker.getRange("E:E").format.columnWidth = 12;
tracker.getRange("F:H").format.columnWidth = 11;

// Remove the original sheet's old dropdown validations after rebuilding it.
for (const col of ["A", "B", "C", "D", "E"]) {
  changes.getRange(`${col}1:${col}${finalChangeRow}`).dataValidation = null;
}

const changeCheck = await workbook.inspect({
  kind: "table",
  sheetId: "Changes",
  range: `A1:E${finalChangeRow}`,
  include: "values,formulas",
  tableMaxRows: 18,
  tableMaxCols: 5,
  maxChars: 12000,
});
console.log(changeCheck.ndjson);

const trackerCheck = await workbook.inspect({
  kind: "table",
  sheetId: "Live Tracker",
  range: "A1:H16",
  include: "values,formulas",
  tableMaxRows: 16,
  tableMaxCols: 8,
  maxChars: 12000,
});
console.log(trackerCheck.ndjson);

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 300 },
  summary: "final formula error scan",
});
console.log(errors.ndjson);

const changesPreview = await workbook.render({ sheetName: "Changes", range: `A1:E${Math.min(finalChangeRow, 32)}`, scale: 1.25, format: "png" });
await fs.writeFile(`${previewDir}/improved-changes.png`, new Uint8Array(await changesPreview.arrayBuffer()));
const trackerPreview = await workbook.render({ sheetName: "Live Tracker", range: "A1:H28", scale: 1.25, format: "png" });
await fs.writeFile(`${previewDir}/live-tracker.png`, new Uint8Array(await trackerPreview.arrayBuffer()));

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(JSON.stringify({ outputPath, taskCount: entries.length, finalChangeRow }));
