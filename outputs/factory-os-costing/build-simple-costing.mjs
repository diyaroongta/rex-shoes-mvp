import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "/Users/diyaroongta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

process.on("uncaughtException", (error) => {
  console.error(`BUILD_ERROR: ${error?.message ?? error}`);
  process.exit(1);
});

const outputDir = "/Users/diyaroongta/Downloads/factory-os/outputs/factory-os-costing";
const outputPath = `${outputDir}/Factory_OS_Simple_Costing_and_Quotation.xlsx`;
const previewPath = `${outputDir}/Factory_OS_Simple_Costing_and_Quotation.png`;

const navy = "#17324D", blue = "#2563EB", green = "#0F766E", amber = "#B45309";
const lightBlue = "#DCEBFF", lightGreen = "#E8F5F1", lightAmber = "#FFF4D6";
const grey = "#E7ECF1", grid = "#D9E1E8", ink = "#1F2937", white = "#FFFFFF", font = "Aptos";

const wb = Workbook.create();
const s = wb.worksheets.add("Costing");
s.showGridLines = false;
s.freezePanes.freezeRows(3);

function section(row, text, color = blue) {
  s.getRange(`A${row}:F${row}`).merge();
  s.getRange(`A${row}`).values = [[text]];
  s.getRange(`A${row}:F${row}`).format.fill = color;
  s.getRange(`A${row}:F${row}`).format.font = { bold: true, color: white, size: 11, name: font };
  s.getRange(`A${row}:F${row}`).format.rowHeight = 23;
}

function header(range) {
  s.getRange(range).format.fill = grey;
  s.getRange(range).format.font = { bold: true, color: navy, size: 10, name: font };
  s.getRange(range).format.borders = { bottom: { style: "medium", color: "#9AA7B3" } };
}

function body(range) {
  s.getRange(range).format.font = { color: ink, size: 10, name: font };
  s.getRange(range).format.borders = { bottom: { style: "thin", color: grid } };
  s.getRange(range).format.verticalAlignment = "center";
}

s.getRange("A1:F1").merge();
s.getRange("A1").values = [["FACTORY OS COSTING"]];
s.getRange("A1:F1").format.fill = navy;
s.getRange("A1:F1").format.font = { bold: true, color: white, size: 17, name: font };
s.getRange("A1:F1").format.rowHeight = 33;
s.getRange("A2:F2").merge();
s.getRange("A2").values = [["One client | 20 users | 2 locations | 1 legal entity | all amounts shown in ₹ | AI API billed separately"]];
s.getRange("A2:F2").format.fill = "#F5F7FA";
s.getRange("A2:F2").format.font = { italic: true, color: "#5B6875", size: 10, name: font };

section(4, "ASSUMPTIONS");
s.getRange("A5:C5").values = [["Operating input", "Value", "Unit"]];
s.getRange("D5:F5").values = [["Financial input", "Value", "Unit"]];
header("A5:F5");
s.getRange("A6:F13").values = [
  ["Named users", 20, "users", "FX conversion rate", 88, "₹ per unit"],
  ["Concurrent users", 15, "users", "Forex/card uplift", 0.035, "%"],
  ["Working days", 26, "days/month", "GST", 0.18, "%"],
  ["Operating hours", 12, "hours/day", "Founder rate", 2500, "₹/hour"],
  ["Locations", 2, "sites", "Target margin — first client", 0.30, "%"],
  ["Legal entities", 1, "entity", "Target margin — steady state", 0.65, "%"],
  ["Function calls", 697840, "per month", "Initial contract", 24, "months"],
  ["File storage after 2 years", 17, "GB", "Founder support", 30, "hours/month"],
];
body("A6:F13");
s.getRange("B6:B13").format.fill = lightBlue;
s.getRange("E6:E13").format.fill = lightBlue;
s.getRange("E7:E8").format.numberFormat = "0.0%";
s.getRange("E10:E11").format.numberFormat = "0.0%";
s.getRange("B12").format.numberFormat = "#,##0";

section(16, "MONTHLY COST — ONE CLIENT", green);
s.getRange("A17:F17").values = [["Cost head", "Basis", "Expected ₹", "Guardrail ₹", "Unit", "Notes"]];
header("A17:F17");
const costs = [
  ["Vercel Pro", "Shared", 20, 40, "Hosting, functions and CDN"],
  ["Neon Scale", "Per client", 55, 100, "Production, staging and 30-day PITR"],
  ["Anthropic production API", "Client-paid usage", 0, 0, "Billed directly to client at actual usage; separate from Claude Pro"],
  ["File storage and backups", "Per client", 10, 20, "Private files plus independent backup"],
  ["Monitoring, email, security and misc.", "Shared", 30, 60, "Small operational tools; revise when paid plans are selected"],
  ["Domain and DNS", "Per client", 2, 2, "Annualized"],
  ["SSO and communications", "Optional", 0, 150, "Only when contracted"],
  ["Claude Pro", "Founder development", 20, 20, "Claude + Claude Code subscription"],
  ["ChatGPT Plus / Codex", "Founder development", 20, 20, "Codex subscription"],
  ["Claude usage bundle", "Founder development", 0, 50, "Only when Pro usage limit is reached"],
  ["Codex usage credits", "Founder development", 0, 50, "Only when included Codex usage is exhausted"],
];
for (let i = 0; i < costs.length; i++) {
  const row = 18 + i;
  s.getRange(`A${row}:B${row}`).values = [[costs[i][0], costs[i][1]]];
  s.getRange(`C${row}`).formulas = [[`=${costs[i][2]}*$E$6*(1+$E$7)*(1+$E$8)`]];
  s.getRange(`D${row}`).formulas = [[`=${costs[i][3]}*$E$6*(1+$E$7)*(1+$E$8)`]];
  s.getRange(`E${row}`).values = [["₹/month"]];
  s.getRange(`F${row}`).values = [[costs[i][4]]];
}
body("A18:F28");
s.getRange("C18:D28").format.numberFormat = "#,##0";
s.getRange("A29:B29").merge(); s.getRange("A29").values = [["Production platform"]];
s.getRange("C29:D29").formulas = [["=SUM(C18:C24)", "=SUM(D18:D24)"]];
s.getRange("E29").values = [["₹/month"]];
s.getRange("F29").values = [["Live service cost"]];
s.getRange("A30:B30").merge(); s.getRange("A30").values = [["Founder development tools"]];
s.getRange("C30:D30").formulas = [["=SUM(C25:C28)", "=SUM(D25:D28)"]];
s.getRange("E30").values = [["₹/month"]];
s.getRange("F30").values = [["Shared product cost"]];
s.getRange("A31:B31").merge(); s.getRange("A31").values = [["TOTAL MONTHLY CASH"]];
s.getRange("C31:D31").formulas = [["=C29+C30", "=D29+D30"]];
s.getRange("E31").values = [["₹/month"]];
s.getRange("F31").values = [["Expected one-client cash burn"]];
s.getRange("A29:F30").format.fill = lightGreen;
s.getRange("A29:F30").format.font = { bold: true, color: green, size: 10, name: font };
s.getRange("A31:F31").format.fill = navy;
s.getRange("A31:F31").format.font = { bold: true, color: white, size: 10, name: font };
s.getRange("C29:D31").format.numberFormat = "#,##0";

section(34, "ONE-TIME LAUNCH COST", amber);
s.getRange("A35:F35").values = [["Cost head", "Basis", "Cash cost ₹", "Founder hours", "Economic cost ₹", "Notes"]];
header("A35:F35");
s.getRange("A36:F43").values = [
  ["Development-tool runway", "6 months", null, 0, 0, "Funds Claude, Codex and development tools"],
  ["Independent penetration test", "Optional", 0, 0, 0, "Add when client/security review requires it"],
  ["Legal, privacy, IP and DPA", "Optional", 0, 0, 0, "Add when client requires formal documents"],
  ["Accounting and tax setup", "Budget", 50000, 0, 0, "GST and invoicing"],
  ["Equipment and backup internet", "If required", 50000, 0, 0, "Replace if already owned"],
  ["Migration, UAT, training and travel", "First client", 150000, 0, 0, "Two locations"],
  ["DR and release rehearsal", "Budget", 50000, 0, 0, "Restore and rollback test"],
  ["Product hardening", "Founder time", 0, 840, null, "Location model, audit, files, auth, tests and recovery"],
];
s.getRange("C36").formulas = [["=C30*6"]];
s.getRange("E43").formulas = [["=D43*$E$9"]];
body("A36:F43");
s.getRange("C36:C43").format.numberFormat = "#,##0";
s.getRange("D36:D43").format.numberFormat = "#,##0";
s.getRange("E36:E43").format.numberFormat = "#,##0";
s.getRange("A44:B44").merge(); s.getRange("A44").values = [["Cash subtotal"]];
s.getRange("C44").formulas = [["=SUM(C36:C43)"]];
s.getRange("D44").values = [["Contingency"]];
s.getRange("E44").formulas = [["=C44*20%"]];
s.getRange("F44").values = [["20%"]];
s.getRange("A45:B45").merge(); s.getRange("A45").values = [["TOTAL LAUNCH CASH"]];
s.getRange("C45").formulas = [["=C44+E44"]];
s.getRange("D45").values = [["Founder time"]];
s.getRange("E45").formulas = [["=E43"]];
s.getRange("F45").values = [["Separate economic investment"]];
s.getRange("A44:F45").format.fill = lightAmber;
s.getRange("A44:F45").format.font = { bold: true, color: amber, size: 10, name: font };
s.getRange("C44:C45").format.numberFormat = "#,##0";
s.getRange("E44:E45").format.numberFormat = "#,##0";

section(48, "COST AND SELLING PRICE");
s.getRange("A49:F49").values = [["Pricing item", "Cost basis ₹", "Target margin", "Calculated price ₹", "Proposed price ₹", "Result"]];
header("A49:F49");
s.getRange("A50:F53").values = [
  ["Implementation and go-live", null, 0.20, null, null, "20% implementation margin on total launch cash"],
  ["Monthly — one client", null, 0.10, null, 25000, "Includes 4 founder support hours; AI API extra"],
  ["Monthly — five clients", null, 0.10, null, 25000, "Shared subscriptions allocated across clients"],
  ["Monthly — ten clients", null, 0.10, null, 25000, "Shared subscriptions allocated across clients"],
];
s.getRange("B50").formulas = [["=$C$45"]];
s.getRange("D50").formulas = [["=ROUND(B50/(1-C50),-5)"]];
s.getRange("E50").formulas = [["=D50"]];
s.getRange("B51").formulas = [["=$C$31+4*$E$9"]];
s.getRange("B52").formulas = [["=($C$18+$C$30)/5+$C$19+$C$20+$C$22+$C$23+4*$E$9"]];
s.getRange("B53").formulas = [["=($C$18+$C$30)/10+$C$19+$C$20+$C$22+$C$23+4*$E$9"]];
s.getRange("D50:D53").formulas = [["=ROUND(B50/(1-C50),-5)"], ["=B51/(1-C51)"], ["=B52/(1-C52)"], ["=B53/(1-C53)"]];
body("A50:F53");
s.getRange("B50:B53").format.numberFormat = "#,##0";
s.getRange("C50:C53").format.numberFormat = "0.0%";
s.getRange("D50:E53").format.numberFormat = "#,##0";
s.getRange("A54:C54").merge(); s.getRange("A54").values = [["24-month founding contract value"]];
s.getRange("D54:E54").merge(); s.getRange("D54").formulas = [["=E50+E51*$E$12"]];
s.getRange("F54").values = [["GST extra"]];
s.getRange("A54:F54").format.fill = lightGreen;
s.getRange("A54:F54").format.font = { bold: true, color: green, size: 10, name: font };
s.getRange("D54:E54").format.numberFormat = "#,##0";

section(57, "MONTHLY PRICE INCLUDES", green);
s.getRange("A58:F58").values = [["Users", "Locations", "Legal entities", "AI document reads", "Copilot requests", "File storage"]];
header("A58:F58");
s.getRange("A59:F59").values = [[20, 2, 1, 1000, 1500, 25]];
s.getRange("A60:F60").values = [["₹2,000 per extra user", "₹25,000 per extra site", "₹35,000 per extra entity", "₹25 per extra document", "₹10 per extra request", "₹100 per extra GB/month"]];
body("A59:F60");
s.getRange("A59:F59").format.numberFormat = "#,##0";

section(63, "SOURCES", navy);
s.getRange("A64:F67").values = [
  ["Vercel", "https://vercel.com/docs/plans/pro-plan", "", "", "", ""],
  ["Neon", "https://neon.com/pricing", "", "", "", ""],
  ["Anthropic", "https://platform.claude.com/docs/en/about-claude/pricing", "", "", "", ""],
  ["OpenAI", "https://openai.com/chatgpt/pricing", "", "", "", ""],
];
body("A64:F67");
s.getRange("B64:B67").format.fill = lightGreen;
s.getRange("B64:B67").format.font = { color: green, size: 9, name: font };
s.getRange("A64:F67").format.rowHeight = 30;

s.getRange("A1:F67").format.wrapText = true;
s.getRange("A:A").format.columnWidth = 38;
s.getRange("B:B").format.columnWidth = 34;
s.getRange("C:C").format.columnWidth = 19;
s.getRange("D:D").format.columnWidth = 24;
s.getRange("E:E").format.columnWidth = 22;
s.getRange("F:F").format.columnWidth = 49;

await fs.mkdir(outputDir, { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(wb);
await xlsx.save(outputPath);

const preview = await wb.render({ sheetName: "Costing", range: "A1:F67", scale: 1.0, format: "png" });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const check = await wb.inspect({ kind: "table", range: "Costing!A16:F54", include: "values,formulas", tableMaxRows: 45, tableMaxCols: 6, maxChars: 10000 });
const errors = await wb.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!", options: { useRegex: true, maxResults: 100 }, summary: "final formula error scan" });
console.log(JSON.stringify({ outputPath, previewPath }));
console.log(check.ndjson);
console.log(errors.ndjson);
