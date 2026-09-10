import fs from "node:fs/promises";
import {
  SpreadsheetFile,
  Workbook,
} from "/Users/diyaroongta/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs";

const outputDir = "/Users/diyaroongta/Downloads/factory-os/outputs/factory-os-costing";
const outputPath = `${outputDir}/Factory_OS_Complete_Cost_and_Quotation_Model.xlsx`;
const previewPath = `${outputDir}/Factory_OS_Costing_Summary.png`;
const previewDir = `${outputDir}/previews`;

const navy = "#17324D";
const blue = "#2563EB";
const paleBlue = "#EAF2FF";
const green = "#0F766E";
const paleGreen = "#E8F5F1";
const amber = "#B45309";
const paleAmber = "#FFF4D6";
const red = "#B91C1C";
const paleRed = "#FDECEC";
const ink = "#1F2937";
const muted = "#5B6875";
const grid = "#D9E1E8";
const white = "#FFFFFF";
const inputFill = "#DCEBFF";
const sourceFill = "#E9F7EF";
const font = "Aptos";

const workbook = Workbook.create();

function title(sheet, text, subtitle, endCol = "F") {
  sheet.showGridLines = false;
  sheet.getRange(`A1:${endCol}1`).merge();
  sheet.getRange("A1").values = [[text]];
  sheet.getRange(`A1:${endCol}1`).format.fill = navy;
  sheet.getRange(`A1:${endCol}1`).format.font = { bold: true, color: white, size: 18, name: font };
  sheet.getRange(`A1:${endCol}1`).format.rowHeight = 34;
  sheet.getRange(`A2:${endCol}2`).merge();
  sheet.getRange("A2").values = [[subtitle]];
  sheet.getRange(`A2:${endCol}2`).format.fill = "#F3F6F9";
  sheet.getRange(`A2:${endCol}2`).format.font = { color: muted, italic: true, size: 10, name: font };
  sheet.getRange(`A2:${endCol}2`).format.rowHeight = 28;
  sheet.getRange(`A2:${endCol}2`).format.wrapText = true;
  sheet.freezePanes.freezeRows(3);
}

function section(sheet, row, text, endCol = "F", fill = blue) {
  sheet.getRange(`A${row}:${endCol}${row}`).merge();
  sheet.getRange(`A${row}`).values = [[text]];
  const r = sheet.getRange(`A${row}:${endCol}${row}`);
  r.format.fill = fill;
  r.format.font = { bold: true, color: white, size: 11, name: font };
  r.format.rowHeight = 24;
}

function header(sheet, range) {
  const r = sheet.getRange(range);
  r.format.fill = "#DCE4EC";
  r.format.font = { bold: true, color: navy, size: 10, name: font };
  r.format.verticalAlignment = "center";
  r.format.borders = { bottom: { style: "medium", color: "#9AA7B3" } };
}

function body(sheet, range) {
  const r = sheet.getRange(range);
  r.format.font = { color: ink, size: 10, name: font };
  r.format.verticalAlignment = "center";
  r.format.borders = { bottom: { style: "thin", color: grid } };
}

function setWidths(sheet, widths) {
  for (const [range, width] of Object.entries(widths)) sheet.getRange(range).format.columnWidth = width;
}

// Assumptions
const a = workbook.worksheets.add("Assumptions");
title(a, "Factory OS — editable assumptions", "Blue cells are inputs. Expected is the operating forecast; Guardrail is funded capacity so service does not stop when usage spikes.", "F");
section(a, 4, "A. Client and operating profile");
a.getRange("A5:F5").values = [["Assumption", "Expected", "Guardrail", "Unit", "Scope", "Why it matters"]];
header(a, "A5:F5");
const ops = [
  ["Named users", 20, 40, "users", "Client", "Locked user input"],
  ["Concurrent users", 15, 30, "users", "Client", "Locked user input"],
  ["Working days", 26, 26, "days/month", "Client", "Locked user input"],
  ["Operating hours", 12, 12, "hours/day", "Client", "Locked user input"],
  ["Locations", 2, 2, "sites", "Client", "Requires site-aware inventory/capacity/dispatch"],
  ["Legal entities", 1, 1, "entity", "Client", "Single books/tax boundary"],
  ["Polling interval", 60, 60, "seconds", "Product", "Current app refresh pattern"],
  ["Job screens active share", 20, 40, "% of active time", "Product", "Extra Job Card/Job Work polling"],
  ["Other interactions", 40, 80, "requests/user/day", "Product", "Saves, searches, reports and edits"],
  ["Startup requests", 6, 10, "requests/user/day", "Product", "Initial data loads"],
  ["Combined poll response after fix", 250, 600, "KB", "Product", "Requires lean list endpoints and external files"],
  ["Average function wall time", 180, 600, "ms", "Infra", "Serverless duration model"],
  ["Active CPU per invocation", 15, 35, "ms", "Infra", "Fluid compute estimate"],
  ["Function memory", 2, 2, "GB", "Infra", "Working estimate"],
];
a.getRange(`A6:F${5 + ops.length}`).values = ops;
body(a, `A6:F${5 + ops.length}`);
a.getRange(`B6:C${5 + ops.length}`).format.fill = inputFill;

section(a, 21, "B. Data, files and reliability");
a.getRange("A22:F22").values = [["Assumption", "Expected", "Guardrail", "Unit", "Scope", "Why it matters"]];
header(a, "A22:F22");
const data = [
  ["Database at launch", 2, 4, "GB", "Client", "Structured ERP data only"],
  ["Database growth", 0.4, 0.8, "GB/month", "Client", "24-month planning"],
  ["Production database warm compute", 0.25, 0.5, "CU", "Client", "Avoid first-user cold starts"],
  ["Staging + CI compute", 30, 60, "CU-hours/month", "Client", "Release confidence"],
  ["Order slips per user-day", 1.15, 2.3, "documents", "Client", "AI extraction demand"],
  ["PIs per user-day", 0.5, 1, "documents", "Client", "AI extraction demand"],
  ["Product images", 20, 40, "files/month", "Client", "Catalogue growth"],
  ["Excel/CSV imports", 30, 60, "files/month", "Client", "Bulk order/reference updates"],
  ["Other files", 20, 40, "files/month", "Client", "Packing/supporting records"],
  ["PITR retention", 30, 30, "days", "Client", "Neon Scale default"],
  ["Off-provider backup retention", 90, 90, "days", "Client", "Vendor-independent recovery"],
  ["Target uptime", 99.9, 99.9, "%", "Client", "Requires monitoring and incident process"],
];
a.getRange(`A23:F${22 + data.length}`).values = data;
body(a, `A23:F${22 + data.length}`);
a.getRange(`B23:C${22 + data.length}`).format.fill = inputFill;

section(a, 36, "C. Finance, pricing and founder capacity");
a.getRange("A37:F37").values = [["Assumption", "Value", "Alternative", "Unit", "Treatment", "Note"]];
header(a, "A37:F37");
const finance = [
  ["USD/INR planning rate", 88, 92, "₹ per US$", "Input", "Use treasury rate when invoiced"],
  ["Card/forex uplift", 3.5, 5, "%", "Input", "Bank/card conversion buffer"],
  ["GST", 18, 18, "%", "Input", "Cash view; input-credit treatment needs CA"],
  ["Founder economic rate", 2500, 3500, "₹/hour", "Input", "Opportunity cost, not cash salary"],
  ["Target steady-state gross margin", 65, 70, "%", "Input", "After direct platform + support cost"],
  ["Recommended implementation fee", 1000000, 1200000, "₹", "Quote", "Founding client / standard client"],
  ["Recommended monthly fee", 150000, 175000, "₹/month", "Quote", "20 users, 2 sites, 1 entity"],
  ["Initial term", 24, 36, "months", "Quote", "Protects implementation recovery"],
  ["Founder hardening hours", 840, 1000, "hours", "Build", "Remaining official-launch work"],
  ["Hardening tool runway", 6, 9, "months", "Build", "Developer subscriptions and test runway"],
];
a.getRange(`A38:F${37 + finance.length}`).values = finance;
body(a, `A38:F${37 + finance.length}`);
a.getRange(`B38:C${37 + finance.length}`).format.fill = inputFill;
a.getRange("B38:C39").format.numberFormat = "0.0";
a.getRange("B40:C42").format.numberFormat = "0.0";
a.getRange("B43:C44").format.numberFormat = "#,##0";
setWidths(a, { "A:A": 34, "B:C": 16, "D:D": 19, "E:E": 14, "F:F": 54 });

// Usage model
const u = workbook.worksheets.add("Usage Model");
title(u, "Application usage model", "Derived from the current 60-second polling architecture and the locked 20-user / 15-concurrent-user operating profile.", "G");
section(u, 4, "Monthly request model", "G");
u.getRange("A5:G5").values = [["Driver", "Expected", "Guardrail", "Unit", "Expected formula", "Guardrail formula", "Control"]];
header(u, "A5:G5");
const usageRows = [
  ["Active concurrent user-hours", "='Assumptions'!B7*'Assumptions'!B8*'Assumptions'!B9", "='Assumptions'!C7*'Assumptions'!C8*'Assumptions'!C9", "hours/month", "days × hours × concurrent users", "same", "Capacity baseline"],
  ["Main orders + dispatch polls", "=B6*2*3600/'Assumptions'!B12", "=C6*2*3600/'Assumptions'!C12", "invocations", "2 endpoints every poll interval", "same", "Replace with event refresh before scale"],
  ["Job Card + Job Work polls", "=B6*2*3600/'Assumptions'!B12*'Assumptions'!B13/100", "=C6*2*3600/'Assumptions'!C12*'Assumptions'!C13/100", "invocations", "2 endpoints × active share", "same", "Pause hidden tabs; cache"],
  ["Other interactions", "='Assumptions'!B6*'Assumptions'!B8*'Assumptions'!B14", "='Assumptions'!C6*'Assumptions'!C8*'Assumptions'!C14", "invocations", "users × days × requests", "same", "Normal ERP actions"],
  ["Startup loads", "='Assumptions'!B6*'Assumptions'!B8*'Assumptions'!B15", "='Assumptions'!C6*'Assumptions'!C8*'Assumptions'!C15", "invocations", "users × days × startup calls", "same", "Cache reference data"],
  ["Total function invocations", "=SUM(B7:B10)", "=SUM(C7:C10)", "invocations", "sum", "sum", "Expected stays inside 1M included"],
  ["Estimated response transfer", "=(B7+B8)*'Assumptions'!B16/1024/1024", "=(C7+C8)*'Assumptions'!C16/1024/1024", "GB/month", "polls × combined KB", "same", "Target under 1TB included"],
  ["Function CPU time", "=B11*'Assumptions'!B18/1000/3600", "=C11*'Assumptions'!C18/1000/3600", "CPU-hours", "invocations × active CPU", "same", "Expected near included 4h"],
  ["Function memory duration", "=B11*'Assumptions'!B17/1000/3600*'Assumptions'!B19", "=C11*'Assumptions'!C17/1000/3600*'Assumptions'!C19", "GB-hours", "invocations × wall time × memory", "same", "Expected inside included 360 GB-h"],
];
for (let i = 0; i < usageRows.length; i++) {
  const row = 6 + i;
  u.getRange(`A${row}`).values = [[usageRows[i][0]]];
  u.getRange(`B${row}`).formulas = [[usageRows[i][1]]];
  u.getRange(`C${row}`).formulas = [[usageRows[i][2]]];
  u.getRange(`D${row}:G${row}`).values = [[...usageRows[i].slice(3)]];
}
body(u, "A6:G14");
u.getRange("B6:C14").format.numberFormat = "#,##0.0";
u.getRange("A11:G11").format.fill = paleBlue;
u.getRange("A11:G11").format.font = { bold: true, color: navy, name: font };
section(u, 17, "File growth estimate", "G", green);
u.getRange("A18:G18").values = [["File class", "Files/month", "Average MB", "GB/month", "24-month GB", "Storage rule", "Note"]];
header(u, "A18:G18");
const files = [
  ["Order slips", "='Assumptions'!B6*'Assumptions'!B8*'Assumptions'!B27", 0.15, "=B19*C19/1024", "=D19*24", "Private object storage", "Never return file bodies in list APIs"],
  ["PIs", "='Assumptions'!B6*'Assumptions'!B8*'Assumptions'!B28", 1.5, "=B20*C20/1024", "=D20*24", "Private object storage", "Signed URLs; retention policy"],
  ["Product images", "='Assumptions'!B29", 0.25, "=B21*C21/1024", "=D21*24", "Object storage", "Store URLs, not data URLs"],
  ["Excel/CSV imports", "='Assumptions'!B30", 2, "=B22*C22/1024", "=D22*24", "Object storage", "Quarantine + malware scan"],
  ["Other files", "='Assumptions'!B31", 0.5, "=B23*C23/1024", "=D23*24", "Object storage", "Purpose-limited retention"],
];
for (let i = 0; i < files.length; i++) {
  const row = 19 + i;
  u.getRange(`A${row}`).values = [[files[i][0]]];
  u.getRange(`B${row}`).formulas = [[files[i][1]]];
  u.getRange(`C${row}`).values = [[files[i][2]]];
  u.getRange(`D${row}:E${row}`).formulas = [[files[i][3], files[i][4]]];
  u.getRange(`F${row}:G${row}`).values = [[files[i][5], files[i][6]]];
}
u.getRange("A24:C24").values = [["Total", null, null]];
u.getRange("D24:E24").formulas = [["=SUM(D19:D23)", "=SUM(E19:E23)*1.3"]];
u.getRange("F24:G24").merge();
u.getRange("F24").values = [["Includes 30% versioning / metadata headroom"]];
body(u, "A19:G24");
u.getRange("A24:G24").format.fill = paleGreen;
u.getRange("A24:G24").format.font = { bold: true, color: green, name: font };
u.getRange("B19:B24").format.numberFormat = "#,##0";
u.getRange("C19:E24").format.numberFormat = "0.00";
setWidths(u, { "A:A": 31, "B:C": 16, "D:E": 16, "F:F": 27, "G:G": 45 });

// AI usage
const ai = workbook.worksheets.add("AI Usage");
title(ai, "Production AI usage and exhaustion controls", "AI is used for document reading and explanation—not for Factory OS planning calculations, which remain deterministic.", "I");
section(ai, 4, "Anthropic API token model", "I");
ai.getRange("A5:I5").values = [["Workload", "Expected calls", "Input tok/call", "Output tok/call", "Guardrail calls", "Guardrail input", "Guardrail output", "Expected US$", "Guardrail US$"]];
header(ai, "A5:I5");
const aiRows = [
  ["Order slip extraction", "='Assumptions'!B6*'Assumptions'!B8*'Assumptions'!B27", 4500, 1200, "='Assumptions'!C6*'Assumptions'!C8*'Assumptions'!C27", 6500, 2000],
  ["PI extraction", "='Assumptions'!B6*'Assumptions'!B8*'Assumptions'!B28", 8000, 3000, "='Assumptions'!C6*'Assumptions'!C8*'Assumptions'!C28", 12000, 5000],
  ["ERP copilot", "='Assumptions'!B6*'Assumptions'!B8*60%*3", 25000, 600, "='Assumptions'!C6*'Assumptions'!C8*60%*6", 40000, 1000],
  ["Background evals / retries", 100, 10000, 1000, 200, 20000, 2000],
];
for (let i = 0; i < aiRows.length; i++) {
  const row = 6 + i;
  ai.getRange(`A${row}`).values = [[aiRows[i][0]]];
  if (typeof aiRows[i][1] === "string") ai.getRange(`B${row}`).formulas = [[aiRows[i][1]]]; else ai.getRange(`B${row}`).values = [[aiRows[i][1]]];
  ai.getRange(`C${row}:D${row}`).values = [[aiRows[i][2], aiRows[i][3]]];
  if (typeof aiRows[i][4] === "string") ai.getRange(`E${row}`).formulas = [[aiRows[i][4]]]; else ai.getRange(`E${row}`).values = [[aiRows[i][4]]];
  ai.getRange(`F${row}:G${row}`).values = [[aiRows[i][5], aiRows[i][6]]];
  ai.getRange(`H${row}`).formulas = [[`=B${row}*(C${row}*$B$14+D${row}*$D$14)/1000000`]];
  ai.getRange(`I${row}`).formulas = [[`=E${row}*(F${row}*$B$14+G${row}*$D$14)/1000000`]];
}
body(ai, "A6:I9");
ai.getRange("A10:G10").merge();
ai.getRange("A10").values = [["Subtotal"]];
ai.getRange("H10:I10").formulas = [["=SUM(H6:H9)", "=SUM(I6:I9)"]];
ai.getRange("A11:G11").merge();
ai.getRange("A11").values = [["With retries / variance reserve"]];
ai.getRange("H11:I11").formulas = [["=H10*1.25", "=I10*1.15"]];
ai.getRange("A10:I11").format.fill = paleBlue;
ai.getRange("A10:I11").format.font = { bold: true, color: navy, name: font };
ai.getRange("H6:I11").format.numberFormat = "$#,##0.00";
ai.getRange("A13:D13").values = [["Model input price / MTok", "US$", "Model output price / MTok", "US$"]];
header(ai, "A13:D13");
ai.getRange("A14:D15").values = [["Claude Sonnet 4.6 input", 3, "Claude Sonnet 4.6 output", 15], ["Potential Sonnet 5 input", 2, "Potential Sonnet 5 output", 10]];
body(ai, "A14:D15");
ai.getRange("B14:B15").format.fill = inputFill;
ai.getRange("D14:D15").format.fill = inputFill;
section(ai, 18, "Controls that prevent API stoppage", "I", amber);
ai.getRange("A19:I19").values = [["Control", "Setting", "Trigger", "Response", "Owner", "Evidence", "Risk prevented", "Launch status", "Monthly allowance"]];
header(ai, "A19:I19");
const controls = [
  ["Anthropic organization tier", "Build tier", "$1,000 monthly cap", "Request tier raise before 70%", "Founder", "Console screenshot", "Provider hard stop", "Required", "$1,000"],
  ["Production workspace limit", "$750", "50/75/90% alerts", "Review anomalies; raise deliberately", "Founder", "Billing alerts", "Runaway spend", "Required", "$750"],
  ["Prepaid credit auto-reload", "$200 threshold → $500 balance", "Balance below threshold", "Automatic refill + card backup", "Founder", "Test transaction", "Credit exhaustion", "Required", "$500 funded"],
  ["Per-user AI quota", "Soft warning then admin override", "80% of allowance", "Continue critical extraction; defer chat", "Client admin", "Usage dashboard", "Noisy-user outage", "Required", "Policy"],
  ["Fallback workflow", "Manual review queue", "API timeout / 429 / low confidence", "Save document; retry with backoff", "Ops", "Runbook + drill", "Business stoppage", "Required", "Included"],
];
ai.getRange("A20:I24").values = controls;
body(ai, "A20:I24");
ai.getRange("H20:H24").format.fill = paleAmber;
setWidths(ai, { "A:A": 28, "B:B": 22, "C:C": 19, "D:D": 34, "E:E": 14, "F:F": 19, "G:G": 22, "H:H": 15, "I:I": 18 });

// Runtime costs
const r = workbook.worksheets.add("Runtime COGS");
title(r, "Monthly production COGS", "Expected is likely monthly consumption. Funded guardrail is the cash/credit envelope held to avoid a usage-limit incident.", "G");
section(r, 4, "Shared production services", "G");
r.getRange("A5:G5").values = [["Cost head", "Expected US$", "Guardrail US$", "Allocation", "Billing basis", "Included capability", "Source / note"]];
header(r, "A5:G5");
const shared = [
  ["Vercel Pro", 20, 40, "Shared", "Team platform + overage buffer", "Deployment, CDN, functions, WAF", "One deploying seat; usage credit included"],
  ["Monitoring + incident response", 64, 64, "Shared", "Better Stack Responder + telemetry", "Uptime, logs, on-call", "Do not launch with provider logs alone"],
  ["Transactional email", 20, 20, "Shared", "Resend Pro allowance", "Password reset, alerts, reports", "50k emails/month allowance"],
  ["Security / dependency scanning", 20, 30, "Shared", "Allowance", "Secrets/dependencies/app checks", "May be replaced by bundled service"],
];
r.getRange("A6:G9").values = shared;
body(r, "A6:G9");
r.getRange("A10").values = [["Shared production subtotal"]];
r.getRange("B10:C10").formulas = [["=SUM(B6:B9)", "=SUM(C6:C9)"]];
r.getRange("D10:G10").merge();
r.getRange("D10").values = [["Allocated across every live client deployment"]];
r.getRange("A10:G10").format.fill = paleGreen;
r.getRange("A10:G10").format.font = { bold: true, color: green, name: font };

section(r, 13, "Per-client isolated deployment", "G", green);
r.getRange("A14:G14").values = [["Cost head", "Expected US$", "Guardrail US$", "Allocation", "Billing basis", "Included capability", "Source / note"]];
header(r, "A14:G14");
const client = [
  ["Neon Scale database", 55, 100, "Per client", "Warm prod + staging + storage/PITR", "30-day recovery, SLA/security controls", "Launch is cheaper but lacks enterprise controls"],
  ["Anthropic production API", "='AI Usage'!H11", 500, "Per client", "Tokens + funded reserve", "Document extraction + copilot", "Guardrail intentionally exceeds stress forecast"],
  ["Private object storage", 5, 10, "Per client", "Files + versions + transfer", "Slips, PIs, images and imports", "Move all base64 bodies out of Postgres"],
  ["Off-provider encrypted backup", 5, 10, "Per client", "Daily dump + retention", "Vendor-independent restore", "Quarterly restore drill"],
  ["Domain / DNS allocation", 2, 2, "Per client", "Annualized", "Client URL", "Dedicated subdomain may reduce this"],
  ["SSO / SCIM reserve", 0, 125, "Optional/client", "Enterprise connection", "Identity lifecycle", "Quote separately unless required"],
  ["WhatsApp/SMS reserve", 0, 25, "Optional/client", "Provider usage", "Operational messages / OTP", "Pass through usage + service margin"],
];
for (let i = 0; i < client.length; i++) {
  const row = 15 + i;
  r.getRange(`A${row}`).values = [[client[i][0]]];
  if (typeof client[i][1] === "string") r.getRange(`B${row}`).formulas = [[client[i][1]]]; else r.getRange(`B${row}`).values = [[client[i][1]]];
  r.getRange(`C${row}:G${row}`).values = [[...client[i].slice(2)]];
}
body(r, "A15:G21");
r.getRange("A22").values = [["Per-client subtotal"]];
r.getRange("B22:C22").formulas = [["=SUM(B15:B21)", "=SUM(C15:C21)"]];
r.getRange("D22:G22").merge();
r.getRange("D22").values = [["Expected includes usage; Guardrail includes funded resilience and optional enterprise capacity"]];
r.getRange("A22:G22").format.fill = paleGreen;
r.getRange("A22:G22").format.font = { bold: true, color: green, name: font };

section(r, 25, "Shared solo-founder engineering capacity", "G", amber);
r.getRange("A26:G26").values = [["Cost head", "Expected US$", "Guardrail US$", "Allocation", "Billing basis", "Purpose", "Note"]];
header(r, "A26:G26");
const dev = [
  ["Claude Max 20×", 200, 200, "Shared", "Subscription", "Primary product development", "Separate from production API"],
  ["ChatGPT Pro / Codex", 200, 200, "Shared", "Subscription", "Code generation, review, testing", "Separate from production API"],
  ["Claude overflow API credits", 100, 100, "Shared", "Funded allowance", "Agentic overflow / batch work", "Auto-reload with cap"],
  ["Codex flexible credits", 100, 100, "Shared", "Funded allowance", "Work beyond included usage", "Auto-top-up with cap"],
  ["GitHub Team", 4, 4, "Shared", "One seat", "Source control and review", "Add seats when staffing"],
  ["1Password Teams Starter", 24.95, 24.95, "Shared", "Team plan", "Secrets and recovery", "Up to 10 users"],
  ["Misc. developer services", 25, 50, "Shared", "Allowance", "Testing, email, package services", "Review quarterly"],
];
r.getRange("A27:G33").values = dev;
body(r, "A27:G33");
r.getRange("A34").values = [["Shared engineering subtotal"]];
r.getRange("B34:C34").formulas = [["=SUM(B27:B33)", "=SUM(C27:C33)"]];
r.getRange("D34:G34").merge();
r.getRange("D34").values = [["This is a company operating cost, not a per-client API charge"]];
r.getRange("A34:G34").format.fill = paleAmber;
r.getRange("A34:G34").format.font = { bold: true, color: amber, name: font };

section(r, 37, "One-client monthly cash view", "G");
r.getRange("A38:G38").values = [["Metric", "Expected", "Guardrail", "Unit", "Formula", "Interpretation", "Commercial treatment"]];
header(r, "A38:G38");
const summaryRows = [
  ["Production platform", "=B10+B22", "=C10+C22", "US$/month", "shared production + client", "Live service cost", "Recurring COGS"],
  ["Including founder engineering tools", "=B39+B34", "=C39+C34", "US$/month", "+ shared engineering", "One-client cash burn", "Do not pretend this is zero"],
  ["Cash burn incl. FX + GST", "=B40*'Assumptions'!B38*(1+'Assumptions'!B39/100)*(1+'Assumptions'!B40/100)", "=C40*'Assumptions'!B38*(1+'Assumptions'!B39/100)*(1+'Assumptions'!B40/100)", "₹/month", "US$ × FX × card × GST", "Funding requirement", "GST may be creditable"],
  ["24-month cash run-rate", "=B41*24", "=C41*24", "₹", "monthly × 24", "Excludes one-time launch", "Use in runway plan"],
];
for (let i = 0; i < summaryRows.length; i++) {
  const row = 39 + i;
  r.getRange(`A${row}`).values = [[summaryRows[i][0]]];
  r.getRange(`B${row}:C${row}`).formulas = [[summaryRows[i][1], summaryRows[i][2]]];
  r.getRange(`D${row}:G${row}`).values = [[...summaryRows[i].slice(3)]];
}
body(r, "A39:G42");
r.getRange("A41:G42").format.fill = paleBlue;
r.getRange("A41:G42").format.font = { bold: true, color: navy, name: font };
r.getRange("B6:C40").format.numberFormat = "$#,##0.00";
r.getRange("B41:C42").format.numberFormat = "#,##0";
setWidths(r, { "A:A": 32, "B:C": 17, "D:D": 17, "E:E": 30, "F:F": 38, "G:G": 44 });

// Build and launch
const b = workbook.worksheets.add("Build & Launch");
title(b, "Official-launch investment", "Cash readiness is separated from founder time so the model does not hide the real economic cost of a solo build.", "G");
section(b, 4, "One-time cash requirement", "G");
b.getRange("A5:G5").values = [["Workstream", "Basis", "Cash ₹", "Included", "Acceptance evidence", "Owner", "Notes"]];
header(b, "A5:G5");
const launch = [
  ["Six-month development-tool runway", "='Assumptions'!B47*'Runtime COGS'!B34*'Assumptions'!B38*(1+'Assumptions'!B39/100)*(1+'Assumptions'!B40/100)", null, "Claude/Codex/GitHub/secrets/services", "Funded subscriptions and caps", "Founder", "Avoid stopping mid-hardening"],
  ["Independent penetration test", null, 250000, "Web app + API retest", "Report and closure evidence", "External", "Budgetary allowance; obtain quotes"],
  ["Legal, privacy, IP and DPA", null, 125000, "MSA/SOW/DPA/privacy/IP assignment", "Signed templates", "Counsel", "Budgetary allowance"],
  ["Accounting, tax and business setup", null, 50000, "GST/invoicing/insurance review", "CA sign-off", "CA", "Budgetary allowance"],
  ["Laptop, test devices, UPS, backup internet", null, 125000, "Founder continuity equipment", "Asset and failover test", "Founder", "Replace if already owned"],
  ["Client migration, UAT, training and travel", null, 150000, "Two sites; first go-live", "Signed UAT and training record", "Founder", "Client-specific"],
  ["DR and release rehearsal", null, 50000, "Restore, rollback and incident drill", "Timestamped drill report", "Founder", "Budgetary allowance"],
];
for (let i = 0; i < launch.length; i++) {
  const row = 6 + i;
  b.getRange(`A${row}`).values = [[launch[i][0]]];
  if (launch[i][1]) b.getRange(`C${row}`).formulas = [[launch[i][1]]]; else b.getRange(`C${row}`).values = [[launch[i][2]]];
  b.getRange(`B${row}`).values = [[launch[i][1] ? "6 months × shared engineering tools" : "Budgetary allowance"]];
  b.getRange(`D${row}:G${row}`).values = [[...launch[i].slice(3)]];
}
body(b, "A6:G12");
b.getRange("A13:B13").merge(); b.getRange("A13").values = [["Cash subtotal"]]; b.getRange("C13").formulas = [["=SUM(C6:C12)"]]; b.getRange("D13:G13").merge();
b.getRange("A14:B14").merge(); b.getRange("A14").values = [["Contingency"]]; b.getRange("C14").formulas = [["=C13*20%"]]; b.getRange("D14:G14").merge(); b.getRange("D14").values = [["20% until external quotes and client data are locked"]];
b.getRange("A15:B15").merge(); b.getRange("A15").values = [["Total launch cash"]]; b.getRange("C15").formulas = [["=C13+C14"]]; b.getRange("D15:G15").merge(); b.getRange("D15").values = [["Fund before committing a go-live date"]];
b.getRange("A13:G15").format.fill = paleGreen;
b.getRange("A13:G15").format.font = { bold: true, color: green, name: font };
b.getRange("C6:C15").format.numberFormat = "#,##0";

section(b, 18, "Founder hardening work — economic cost", "G", amber);
b.getRange("A19:G19").values = [["Workstream", "Hours", "Rate ₹/h", "Economic ₹", "Why required", "Exit criterion", "Cash/economic"]];
header(b, "A19:G19");
const hardening = [
  ["Location-aware data model", 120, "Two sites need stock/capacity/order boundaries", "Site isolation tests pass"],
  ["Immutable audit trail", 80, "ERP changes need accountability", "Exportable actor/time/before-after log"],
  ["Object storage + pagination", 90, "Remove base64 blobs and large list responses", "No API list response approaches 4.5MB"],
  ["MFA/SSO/session hardening", 90, "Current built-in auth is not enterprise-grade", "Security review and access tests pass"],
  ["Live-Postgres integration + E2E tests", 150, "Browser engine tests are not enough", "Critical workflows pass against staging"],
  ["Observability, backups and recovery", 90, "Official uptime needs evidence", "Restore and alert drills pass"],
  ["Performance and polling reduction", 100, "Polling dominates requests and transfer", "Load test meets p95 targets"],
  ["Data readiness and migration", 70, "Client masters are incomplete", "Reconciled import and sign-off"],
  ["UAT, training and operating docs", 50, "Adoption and support continuity", "Signed UAT and runbooks"],
];
for (let i = 0; i < hardening.length; i++) {
  const row = 20 + i;
  b.getRange(`A${row}:B${row}`).values = [[hardening[i][0], hardening[i][1]]];
  b.getRange(`C${row}`).formulas = [["='Assumptions'!B41"]];
  b.getRange(`D${row}`).formulas = [[`=B${row}*C${row}`]];
  b.getRange(`E${row}:G${row}`).values = [[hardening[i][2], hardening[i][3], "Economic"]];
}
body(b, "A20:G28");
b.getRange("A29").values = [["Total founder hardening"]];
b.getRange("B29").formulas = [["=SUM(B20:B28)"]];
b.getRange("C29").formulas = [["='Assumptions'!B41"]];
b.getRange("D29").formulas = [["=SUM(D20:D28)"]];
b.getRange("E29:G29").merge(); b.getRange("E29").values = [["Product R&D investment; amortize across multiple clients"]];
b.getRange("A29:G29").format.fill = paleAmber;
b.getRange("A29:G29").format.font = { bold: true, color: amber, name: font };
b.getRange("C20:D29").format.numberFormat = "#,##0";
setWidths(b, { "A:A": 34, "B:B": 28, "C:D": 16, "E:E": 45, "F:F": 42, "G:G": 17 });

// Multi-client model
const m = workbook.worksheets.add("Multi-client");
title(m, "Shared-code, isolated-deployment economics", "Recommended path: one codebase; one Vercel project and one Neon project/database per client. This limits blast radius without duplicating code.", "H");
section(m, 4, "Monthly economics by active client count", "H");
m.getRange("A5:H5").values = [["Clients", "Total cash ₹", "Cash ₹/client", "Support hours", "Support econ. ₹/client", "True ₹/client", "Monthly quote ₹", "Gross margin"]];
header(m, "A5:H5");
const counts = [1, 2, 3, 5, 10, 25];
for (let i = 0; i < counts.length; i++) {
  const row = 6 + i;
  m.getRange(`A${row}`).values = [[counts[i]]];
  m.getRange(`B${row}`).formulas = [[`=('Runtime COGS'!B10+'Runtime COGS'!B34+A${row}*'Runtime COGS'!B22)*'Assumptions'!B38*(1+'Assumptions'!B39/100)*(1+'Assumptions'!B40/100)`]];
  m.getRange(`C${row}`).formulas = [[`=B${row}/A${row}`]];
  m.getRange(`D${row}`).formulas = [[`=30+8*(A${row}-1)`]];
  m.getRange(`E${row}`).formulas = [[`=D${row}*'Assumptions'!B41/A${row}`]];
  m.getRange(`F${row}`).formulas = [[`=C${row}+E${row}`]];
  m.getRange(`G${row}`).formulas = [["='Assumptions'!B44"]];
  m.getRange(`H${row}`).formulas = [[`=(G${row}-F${row})/G${row}`]];
}
body(m, "A6:H11");
m.getRange("B6:G11").format.numberFormat = "#,##0";
m.getRange("H6:H11").format.numberFormat = "0.0%";
m.getRange("A9:H9").format.fill = paleGreen;
m.getRange("A11:H11").format.fill = paleRed;
section(m, 14, "Scale decisions", "H", amber);
m.getRange("A15:H15").values = [["Breakpoint", "Decision", "Reason", "Minimum control", "Owner", "Budget impact", "Timing", "Status"]];
header(m, "A15:H15");
m.getRange("A16:H20").values = [
  ["1–3 clients", "Founder-led, isolated deployments", "Product boundaries still changing", "Runbooks + per-client backups", "Founder", "Contained", "Now", "Recommended"],
  ["4–5 clients", "Add part-time support / implementation help", "Support reaches 50–62 hours/month", "Ticketing and release calendar", "Founder", "Quote-funded", "Before client 5", "Plan"],
  ["6–10 clients", "Hire full-time support/QA", "Solo coverage and regression risk rise", "Separation of duties", "Company", "Add payroll", "Before client 8", "Required"],
  ["10+ clients", "Evaluate control plane and tenant automation", "Manual environment operations stop scaling", "Provisioning/audit automation", "Engineering", "Product investment", "After repeatable fit", "Evaluate"],
  ["25 clients", "Do not remain solo", "222 modeled support hours/month before sales/build", "Named backup owner and on-call", "Company", "Material", "Well before 25", "Hard stop"],
];
body(m, "A16:H20");
m.getRange("H16:H20").format.fill = paleAmber;
setWidths(m, { "A:A": 14, "B:B": 31, "C:C": 39, "D:D": 34, "E:E": 15, "F:G": 17, "H:H": 17 });
const chart = m.charts.add("line", m.getRange("A5:C11"));
chart.title = "Cash cost falls as shared services spread across clients";
chart.hasLegend = true;
chart.legend = { position: "top", textStyle: { typeface: font } };
chart.xAxis = { axisType: "textAxis", textStyle: { typeface: font, fontSize: 10 } };
chart.yAxis = { numberFormatCode: "#,##0", numberFormatSourceLinked: false, textStyle: { typeface: font } };
chart.setPosition("J4", "Q18");

// Quotation
const q = workbook.worksheets.add("Quotation");
title(q, "Proposed quotation — Factory OS", "Commercial proposal for one legal entity, two locations and up to 20 named users. GST is additional on customer invoices.", "G");
section(q, 4, "Recommended founding-client commercial", "G");
q.getRange("A5:G5").values = [["Line item", "Quantity", "Rate ₹", "Amount ₹", "Billing", "Included", "Commercial note"]];
header(q, "A5:G5");
q.getRange("A6:G9").values = [
  ["Implementation and go-live", 1, null, null, "One-time", "Configuration, migration, UAT, two-site training, production launch", "50% start / 30% UAT / 20% go-live"],
  ["Managed Factory OS subscription", 24, null, null, "Monthly", "20 users, 2 locations, 1 entity, standard support", "24-month initial term"],
  ["Enterprise SSO / SCIM", 0, 25000, null, "Monthly optional", "One identity connection", "Provider fees may be passed through"],
  ["Custom integrations", 0, 3500, null, "Per hour", "Work outside signed scope", "Written estimate before work"],
];
q.getRange("C6").formulas = [["='Assumptions'!B43"]];
q.getRange("C7").formulas = [["='Assumptions'!B44"]];
q.getRange("D6").formulas = [["=B6*C6"]];
q.getRange("D7").formulas = [["=B7*C7"]];
q.getRange("D8").formulas = [["=B8*C8"]];
q.getRange("D9").formulas = [["=B9*C9"]];
body(q, "A6:G9");
q.getRange("A10:C10").merge(); q.getRange("A10").values = [["24-month contract value before GST"]]; q.getRange("D10").formulas = [["=SUM(D6:D9)"]]; q.getRange("E10:G10").merge(); q.getRange("E10").values = [["Usage beyond included allowances is billed monthly"]];
q.getRange("A10:G10").format.fill = paleGreen;
q.getRange("A10:G10").format.font = { bold: true, color: green, name: font };
q.getRange("C6:D10").format.numberFormat = "#,##0";

section(q, 13, "Included monthly allowances and overages", "G", green);
q.getRange("A14:G14").values = [["Meter", "Included", "Unit", "Overage", "Rate ₹", "Protection", "Notes"]];
header(q, "A14:G14");
q.getRange("A15:G22").values = [
  ["Named users", 20, "users", "Per additional user/month", 2000, "Fair-use concurrency", "Role-based access"],
  ["Locations", 2, "sites", "Per additional site/month", 25000, "Separate implementation fee", "Site dimension must be enabled"],
  ["Legal entities", 1, "entity", "Per additional entity/month", 35000, "Separate books/data boundary", "Requires scoping"],
  ["AI document reads", 1000, "slips + PIs", "Per additional document", 25, "Admin usage dashboard", "Failed low-confidence read is not double billed"],
  ["Copilot requests", 1500, "requests", "Per additional request", 10, "Per-user soft limits", "Planning output remains deterministic"],
  ["File storage", 25, "GB", "Per extra GB/month", 100, "Retention policy", "Private object storage"],
  ["Email notifications", 10000, "emails", "Provider overage + 20%", 0, "Rate-limit", "No marketing mail"],
  ["WhatsApp / SMS", 0, "messages", "Provider usage + 20%", 0, "Explicit opt-in", "Not included by default"],
];
body(q, "A15:G22");
q.getRange("E15:E22").format.numberFormat = "#,##0";

section(q, 25, "Price tests — do not confuse first-client burn with steady-state COGS", "G", amber);
q.getRange("A26:G26").values = [["Metric", "1 client", "3 clients", "5 clients", "10 clients", "Target", "Conclusion"]];
header(q, "A26:G26");
q.getRange("A27:G30").values = [
  ["Cash cost/client", null, null, null, null, "Declines with scale", "Shared engineering is a product investment"],
  ["True cost/client incl. support", null, null, null, null, "Below quote", "Founder time must not disappear"],
  ["Gross margin at recommended fee", null, null, null, null, "65% steady-state", "Reached near 10 clients in solo model"],
  ["Monthly floor at 65% GM", null, null, null, null, "Formula-driven", "Useful for enterprise/custom work"],
];
q.getRange("B27:E27").formulas = [["='Multi-client'!C6", "='Multi-client'!C8", "='Multi-client'!C9", "='Multi-client'!C10"]];
q.getRange("B28:E28").formulas = [["='Multi-client'!F6", "='Multi-client'!F8", "='Multi-client'!F9", "='Multi-client'!F10"]];
q.getRange("B29:E29").formulas = [["='Multi-client'!H6", "='Multi-client'!H8", "='Multi-client'!H9", "='Multi-client'!H10"]];
q.getRange("B30:E30").formulas = [["=B28/(1-'Assumptions'!B42/100)", "=C28/(1-'Assumptions'!B42/100)", "=D28/(1-'Assumptions'!B42/100)", "=E28/(1-'Assumptions'!B42/100)"]];
body(q, "A27:G30");
q.getRange("B27:E28").format.numberFormat = "#,##0";
q.getRange("B29:E29").format.numberFormat = "0.0%";
q.getRange("B30:E30").format.numberFormat = "#,##0";
q.getRange("A31:G31").merge(); q.getRange("A31").values = [["Founding-client pricing is a deliberate market-entry price. It does not recover the entire reusable product R&D from one client; margin improves only if the same codebase is sold repeatedly."]];
q.getRange("A31:G31").format.fill = paleAmber; q.getRange("A31:G31").format.font = { bold: true, color: amber, name: font }; q.getRange("A31:G31").format.wrapText = true; q.getRange("A31:G31").format.rowHeight = 38;

section(q, 34, "Commercial terms to put in the signed SOW", "G");
q.getRange("A35:G35").values = [["Term", "Recommended wording", "Why", "Client decision", "Owner", "Deadline", "Status"]];
header(q, "A35:G35");
q.getRange("A36:G43").values = [
  ["Scope", "20 named users, 2 sites, 1 legal entity; modules listed in annexure", "Prevents unbounded implementation", "Confirm", "Both", "Before signature", "Open"],
  ["Payment", "Implementation 50/30/20; subscription quarterly in advance", "Funds delivery and reduces collection risk", "Confirm", "Client", "Before signature", "Open"],
  ["Acceptance", "UAT scenarios, data reconciliation, training attendance and go-live checklist", "Makes completion objective", "Confirm", "Both", "Before build", "Open"],
  ["Support", "Business-hours support; severity definitions; exclusions for new features", "Avoids unlimited maintenance", "Confirm", "Both", "Before signature", "Open"],
  ["SLA", "Target 99.9%; service credits only on a paid premium plan", "Upstream plans and solo coverage have limits", "Choose", "Both", "Before signature", "Open"],
  ["Usage", "Included allowances, dashboard, alerts, overage, and no silent service cutoff", "Protects continuity and margin", "Confirm", "Both", "Before go-live", "Open"],
  ["Data", "Client ownership, export, retention, deletion, DPA, subprocessors", "ERP data is business-critical", "Confirm", "Both", "Before signature", "Open"],
  ["Annual revision", "8% annual increase or pass-through of vendor price/tax changes", "Protects multi-year economics", "Confirm", "Both", "Before signature", "Open"],
];
body(q, "A36:G43");
q.getRange("G36:G43").format.fill = paleAmber;
setWidths(q, { "A:A": 32, "B:B": 24, "C:D": 18, "E:E": 18, "F:F": 40, "G:G": 46 });

// Risks and limits
const l = workbook.worksheets.add("Limits & Risks");
title(l, "Production limits, controls and unresolved decisions", "These are launch gates, not optional polish. They are based on the current Factory OS architecture and official provider limits.", "H");
section(l, 4, "Critical launch gates", "H", red);
l.getRange("A5:H5").values = [["Priority", "Risk", "Current evidence", "Failure mode", "Required control", "Budget/workstream", "Owner", "Gate"]];
header(l, "A5:H5");
l.getRange("A6:H14").values = [
  ["P0", "Files embedded in DB/API payloads", "PI attachments and catalogue images can be base64; order lists return PI JSON", "4.5MB serverless response limit and runaway transfer", "Private object storage, signed URLs, pagination, lean DTOs", "Object storage + 90h hardening", "Founder", "Before pilot data"],
  ["P0", "Two locations lack a data dimension", "No site/location fields found in current app/schema", "Stock and capacity can mix across factories", "Site ID across users, orders, stock, work, dispatch and reports", "120h hardening", "Founder + client", "Before migration"],
  ["P0", "Single-founder continuity", "One person builds, deploys and supports", "No incident coverage or knowledge backup", "Runbooks, credential recovery, named backup engineer by client 5", "Tools + staffing", "Founder", "Before SLA"],
  ["P0", "AI prepaid credits can exhaust", "Anthropic API uses prepaid credits and monthly tier limits", "Document intake/coplay stops", "Auto-reload, workspace cap, alerts, manual queue", "Funded $500 reserve", "Founder", "Before go-live"],
  ["P1", "Polling dominates traffic", "Orders/dispatch plus job screens poll every 60 seconds", "Costs and stale/high-volume responses grow with users", "Visibility-aware refresh, caching, events or longer intervals", "100h hardening", "Founder", "Before client 3"],
  ["P1", "Auth below large-business expectation", "Built-in roles; MFA/SSO not established", "Account takeover / failed security review", "MFA now; SSO/SCIM as enterprise add-on", "90h + optional provider", "Founder", "Before production"],
  ["P1", "Provider-only backups", "PITR alone is a single-vendor recovery path", "Deletion/provider event affects recovery", "Daily encrypted off-provider dump and quarterly restore", "$5–10/client/month", "Founder", "Before production"],
  ["P1", "No proven live-load envelope", "Small deterministic engine tests do not prove API/database path", "Slow or failed peak shifts", "15/30 concurrent load test with p95 targets", "Testing + monitoring", "Founder", "Before go-live"],
  ["P2", "Separate codebase per client", "Tempting during custom pilots", "Fixes drift and upgrades become expensive", "One codebase, configuration flags, isolated deployments", "Architecture policy", "Founder", "Always"],
];
body(l, "A6:H14");
l.getRange("A6:A14").format.fill = paleRed;
section(l, 17, "Recommended architecture boundary", "H", green);
l.getRange("A18:H18").values = [["Layer", "Now (1–5 clients)", "Later trigger", "Later option", "Why", "Data boundary", "Operational burden", "Decision"]];
header(l, "A18:H18");
l.getRange("A19:H22").values = [
  ["Code", "One shared repository", "Never fork casually", "Feature flags/configuration", "One fix reaches all clients", "N/A", "Low", "Adopt"],
  ["Vercel", "Separate project per client under shared team", "10+ repeatable clients", "Automated provisioning/control plane", "Deployment isolation", "Per client", "Medium", "Adopt"],
  ["Neon", "Separate project/database per client", "Only after mature tenancy/security", "True multi-tenant or managed clusters", "Clear backup/export/blast radius", "Per client", "Medium", "Adopt"],
  ["Locations", "One client DB with mandatory site ID", "If client demands legal isolation", "Separate client deployments", "Two sites share one entity but need operational separation", "Per site in schema", "Low after build", "Build"],
];
body(l, "A19:H22");
l.getRange("H19:H22").format.fill = paleGreen;
setWidths(l, { "A:A": 13, "B:B": 31, "C:C": 31, "D:D": 36, "E:E": 39, "F:F": 28, "G:G": 22, "H:H": 17 });

// Sources
const s = workbook.worksheets.add("Sources");
title(s, "Sources and model boundary", "Official vendor sources are linked below. Budgetary professional-service allowances must be replaced by written quotes before signing a client commitment.", "E");
section(s, 4, "Official pricing and limits", "E");
s.getRange("A5:E5").values = [["Area", "Source", "URL", "Used for", "Accessed"]];
header(s, "A5:E5");
const sources = [
  ["Vercel Pro", "Vercel Pro plan", "https://vercel.com/docs/plans/pro-plan", "$20 plan and included usage", "2026-09-09"],
  ["Vercel Functions", "Usage and pricing", "https://vercel.com/docs/functions/usage-and-pricing", "Invocations, CPU and memory billing", "2026-09-09"],
  ["Vercel limits", "Functions limitations", "https://vercel.com/docs/functions/limitations", "4.5MB request/response body limit", "2026-09-09"],
  ["Vercel Blob", "Blob general availability", "https://vercel.com/blog/vercel-blob-now-generally-available", "Storage/transfer allowances", "2026-09-09"],
  ["Neon", "Pricing", "https://neon.com/pricing", "Scale compute, storage, PITR and SLA", "2026-09-09"],
  ["Anthropic models", "Sonnet 4.6 overview", "https://platform.claude.com/docs/en/models/sonnet-4-6/overview", "$3/$15 per MTok current-code model", "2026-09-09"],
  ["Anthropic pricing", "Claude API pricing", "https://platform.claude.com/docs/en/about-claude/pricing", "Token pricing cross-check", "2026-09-09"],
  ["Anthropic limits", "Rate limits", "https://platform.claude.com/docs/en/api/rate-limits", "Monthly usage tiers and caps", "2026-09-09"],
  ["Anthropic credits", "API billing help", "https://support.anthropic.com/en/articles/8977456-how-do-i-pay-for-my-api-usage", "Prepaid credits and auto-reload", "2026-09-09"],
  ["Claude developer plan", "Choose a Claude plan", "https://support.claude.com/en/articles/11049762-choose-a-claude-plan", "Max subscription allowance", "2026-09-09"],
  ["ChatGPT/Codex", "ChatGPT pricing", "https://openai.com/chatgpt/pricing", "Pro subscription", "2026-09-09"],
  ["Codex credits", "Flexible usage credits", "https://help.openai.com/en/articles/12642688-using-credits-for-flexible-usage-in-chatgpt-freegopluspro-sora", "Overflow credit control", "2026-09-09"],
  ["Monitoring", "Better Stack pricing", "https://betterstack.com/pricing", "Responder and telemetry", "2026-09-09"],
  ["Email", "Resend pricing", "https://resend.com/pricing", "Transactional email", "2026-09-09"],
  ["Source control", "GitHub pricing", "https://github.com/pricing", "Team seat", "2026-09-09"],
  ["Secrets", "1Password business pricing", "https://1password.com/pricing/business", "Teams Starter", "2026-09-09"],
];
s.getRange(`A6:E${5 + sources.length}`).values = sources;
body(s, `A6:E${5 + sources.length}`);
s.getRange(`C6:C${5 + sources.length}`).format.fill = sourceFill;
section(s, 24, "Reference-sheet structure retained (numbers rejected)", "E", amber);
s.getRange("A25:E25").values = [["Reference", "Useful idea", "Why its numbers were not used", "How this model improves it", "Status"]];
header(s, "A25:E25");
s.getRange("A26:E28").values = [
  ["New bot Costing — Google Sheet", "List fixed infrastructure, maintenance, migration, training and profit", "Flat annual estimates; no usage, limits, reliability or scale mechanics", "Separates assumptions, COGS, founder tools, launch cash, time and quotation", "Structure only"],
  ["factory-os-costs.pdf", "One-time vs monthly and 24-month view", "Neon and AI assumptions are too low for official operation; agency labor does not match solo build", "Uses current product traffic and founder economics", "Superseded"],
  ["Factory OS repository", "Actual screens, API routes, polling, file handling and current AI model", "Code is evidence, not a price quote", "Turns architecture into drivers and launch gates", "Primary product evidence"],
];
body(s, "A26:E28");
setWidths(s, { "A:A": 27, "B:B": 31, "C:C": 60, "D:D": 58, "E:E": 18 });

// Executive summary last, so all formula references exist.
const e = workbook.worksheets.add("Executive Summary");
title(e, "Factory OS — complete costing and proposed quotation", "Prepared for a solo founder building with Claude and Codex. This is a funded production model, not a cheapest-possible demo estimate.", "H");
section(e, 4, "Decision summary", "H");
e.getRange("A5:H5").values = [["Decision", "Recommended", "Expected result", "Why", "Owner", "When", "Gate", "Notes"]];
header(e, "A5:H5");
e.getRange("A6:H10").values = [
  ["Client architecture", "One codebase; separate Vercel + Neon per client", "Isolation without code forks", "Limits blast radius and supports export/restore", "Founder", "Now", "Adopt", "Two sites remain in one client DB via site ID"],
  ["Production database", "Neon Scale", "30-day PITR and enterprise controls", "Launch pricing is not a complete business baseline", "Founder", "Pre-launch", "Required", "Keep staging separate"],
  ["AI continuity", "$500 funded workspace reserve; $750 workspace cap; $1,000 org tier", "No surprise credit exhaustion", "Expected use is about $150; stress is about $446", "Founder", "Pre-launch", "Required", "Manual fallback queue remains mandatory"],
  ["Commercial", "₹10L setup + ₹1.50L/month, GST extra", "₹46L 24-month contract value", "Founding-partner price; later standard price can rise", "Founder", "Proposal", "Recommended", "24-month initial term"],
  ["Scale", "Add support help by client 5; hire before client 8", "Founder is not the availability layer", "Modeled support reaches 102 h/month at 10 clients", "Founder", "Growth", "Hard gate", "Do not promise enterprise SLA while solo"],
];
body(e, "A6:H10");

section(e, 13, "One-client economics", "H", green);
e.getRange("A14:H14").values = [["Metric", "Expected", "Funded guardrail", "Unit", "Included", "Excluded", "Use", "Interpretation"]];
header(e, "A14:H14");
const execRows = [
  ["Production platform", "='Runtime COGS'!B39", "='Runtime COGS'!C39", "US$/month", "Hosting, DB, AI, monitoring, email, files", "Founder tools", "Operating COGS", "Expected ≈ $341"],
  ["One-client cash burn", "='Runtime COGS'!B41", "='Runtime COGS'!C41", "₹/month", "Platform + founder engineering tools + FX/GST", "Founder time", "Runway", "Expected ≈ ₹1.07L"],
  ["Official-launch cash", "='Build & Launch'!C15", "='Build & Launch'!C15", "₹ one-time", "External assurance, runway, first migration", "Founder hardening time", "Funding gate", "Expected ≈ ₹14.1L"],
  ["Founder hardening economic cost", "='Build & Launch'!D29", "='Assumptions'!C46*'Assumptions'!C41", "₹ one-time", "840 modeled hours", "Cash salary", "Investment accounting", "Expected ≈ ₹21L"],
  ["24-month quote value", "='Quotation'!D10", "='Assumptions'!C43+'Assumptions'!C44*'Assumptions'!C45", "₹ before GST", "Setup + recurring", "Overages / add-ons", "Sales proposal", "Founding quote ≈ ₹46L"],
];
for (let i = 0; i < execRows.length; i++) {
  const row = 15 + i;
  e.getRange(`A${row}`).values = [[execRows[i][0]]];
  e.getRange(`B${row}:C${row}`).formulas = [[execRows[i][1], execRows[i][2]]];
  e.getRange(`D${row}:H${row}`).values = [[...execRows[i].slice(3)]];
}
body(e, "A15:H19");
e.getRange("B15:C15").format.numberFormat = "$#,##0.00";
e.getRange("B16:C19").format.numberFormat = "#,##0";
e.getRange("A16:H19").format.fill = paleGreen;

section(e, 22, "What changed from the earlier costing", "H", amber);
e.getRange("A23:H23").values = [["Earlier assumption", "Problem", "Replacement", "Effect", "Evidence", "Decision", "Owner", "Status"]];
header(e, "A23:H23");
e.getRange("A24:H29").values = [
  ["Neon ≈ $9/month", "Assumes sleeping compute and limited controls", "Neon Scale allowance $55 expected / $100 guardrail", "Higher but production-capable", "Scale pricing and PITR/SLA", "Use Scale", "Founder", "Required"],
  ["Claude API ≈ $21/month", "Misses large copilot context, retries and growth", "$150 expected / $500 funded reserve", "Prevents hard stop", "Current Sonnet 4.6 token model", "Fund reserve", "Founder", "Required"],
  ["Domain + backup ≈ $2/month", "No off-provider recovery", "Private files + independent encrypted backup", "Recoverable operation", "Current file architecture", "Build", "Founder", "Required"],
  ["Agency/team build ≈ ₹27.9L", "Does not match solo AI-assisted build", "₹14.1L cash launch + ₹21L founder time", "Separates cash and economic cost", "840-hour hardening model", "Track both", "Founder", "Adopt"],
  ["₹45k/month selling price", "Thin at one client and ignores support risk", "₹1.50L/month founding quote", "Can support a real service", "Multi-client cost curve", "Quote", "Founder", "Recommended"],
  ["Same app copied per client", "Creates code drift", "Shared codebase + isolated environments", "Repeatable product economics", "Architecture review", "Adopt", "Founder", "Required"],
];
body(e, "A24:H29");
e.getRange("H24:H29").format.fill = paleAmber;
e.getRange("A31:H32").merge();
e.getRange("A31").values = [["Bottom line: budget about ₹14.1L cash to reach an official first-client launch, plus ₹21L of founder time as product investment. Carry roughly ₹1.07L/month expected cash burn while only one client exists, with a ₹1.70L funded guardrail. Quote the founding client ₹10L implementation plus ₹1.50L/month before GST, and treat multi-client reuse—not underfunding—as the path to healthy margin."]];
e.getRange("A31:H32").format.fill = navy;
e.getRange("A31:H32").format.font = { bold: true, color: white, size: 12, name: font };
e.getRange("A31:H32").format.wrapText = true;
e.getRange("A31:H32").format.rowHeight = 32;
setWidths(e, { "A:A": 30, "B:C": 26, "D:D": 18, "E:E": 45, "F:F": 31, "G:G": 19, "H:H": 36 });

// Move Executive Summary first.
e.position = 0;

// Global presentation.
for (const sheet of workbook.worksheets.items) {
  sheet.getRange("A1:Z200").format.wrapText = true;
}

await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(outputPath);

const preview = await workbook.render({ sheetName: "Executive Summary", range: "A1:H32", scale: 1.1, format: "png" });
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()));

const previewRanges = {
  "Executive Summary": "A1:H32",
  "Assumptions": "A1:F47",
  "Usage Model": "A1:G24",
  "AI Usage": "A1:I24",
  "Runtime COGS": "A1:G42",
  "Build & Launch": "A1:G29",
  "Multi-client": "A1:Q20",
  "Quotation": "A1:G43",
  "Limits & Risks": "A1:H22",
  "Sources": "A1:E28",
};
for (const [sheetName, range] of Object.entries(previewRanges)) {
  const image = await workbook.render({ sheetName, range, scale: 0.9, format: "png" });
  const slug = sheetName.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and");
  await fs.writeFile(`${previewDir}/${slug}.png`, new Uint8Array(await image.arrayBuffer()));
}

const checks = {};
for (const sheetName of ["Executive Summary", "Usage Model", "AI Usage", "Runtime COGS", "Build & Launch", "Multi-client", "Quotation"]) {
  const inspection = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 50 }, summary: sheetName });
  checks[sheetName] = inspection.ndjson;
}

console.log(JSON.stringify({ outputPath, previewPath, checks }));
