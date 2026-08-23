/* Builds the client input workbook.

   Deliberately SMALL. Every tab has one owner and one filling cadence, and
   nothing is asked for twice. Six tabs are filled once to replace the model's
   placeholders; one tab is the recurring daily feed.

   Everything the app already knows is pre-filled, so the client only types
   figures the factory alone can state. Placeholders are labelled as
   placeholders — a guessed capacity or pack quantity corrupts the pair count,
   the material requirement and the dispatch date together.

   Re-run after loading new BOMs:  node scripts/build-input-pack.mjs
*/
import * as XLSX from "xlsx";
import { INPUTS } from "../shared/inputs.js";
import { articleTypes, articleTypeCombos, comboSizesForArticle, pairsPerCarton } from "../shared/bridge.js";

const OUT = process.argv[2] || "Factory_OS_Input_Sheet.xlsx";
const FILL = "► ";                       // marks a column the client fills in
const wb = XLSX.utils.book_new();

function sheet(name, rows, widths, freezeRow = 0){
  const ws = XLSX.utils.aoa_to_sheet(rows);
  if(widths) ws["!cols"] = widths.map(w => ({ wch:w }));
  if(freezeRow) ws["!freeze"] = { ySplit: freezeRow };
  XLSX.utils.book_append_sheet(wb, ws, name);
  return ws;
}
const blanks = (n, cols) => Array.from({length:n}, () => Array(cols).fill(null));

/* ---------------------------------------------------------------- START HERE */
sheet("START HERE", [
  ["FACTORY OS — INPUT SHEET"],
  [],
  ["What this is"],
  ["The planning model is built and running. It currently uses PLACEHOLDER figures for capacity,"],
  ["lead times, pack quantities and prices. This sheet replaces those placeholders with your real"],
  ["numbers, and then keeps the plan honest with one daily line per machine."],
  [],
  ["Only the columns marked ► need filling. Everything else is what the model holds today,"],
  ["shown so you can check it rather than retype it. Please do not rename columns or insert"],
  ["columns between them."],
  [],
  ["Tab", "What it is for", "Who fills it", "How often"],
  ["1. Machines",  "Real output per line, shifts, working days",        "Production head",   "Once, then when a line changes"],
  ["2. Products",  "Pairs per carton and MRP for every size range",     "Planning + Sales",  "Once, then on any new article"],
  ["3. Promise",   "Delivery commitment and pre-production lead times", "Owner / Sales head","Once, then on any change"],
  ["4. Customers", "Agreed discount and payment terms per customer",    "Sales",             "Once, then per new customer"],
  ["5. Stock",     "Physical count of every material",                  "Store keeper",      "Once, then monthly"],
  ["6. Daily log", "What each machine actually produced, and downtime", "Shift supervisor",  "EVERY DAY — this is the live feed"],
  ["7. Changes",   "Order pipeline changes and feedback on the model",  "Planning",          "As things happen"],
  [],
  ["The one tab that matters most is 6. Daily log."],
  ["Tabs 1-5 make the plan correct on day one. Tab 6 is what keeps it correct — without it the"],
  ["app can only show what was PLANNED, never what actually happened, so it cannot flag a line"],
  ["falling behind or re-date the orders queued behind it."],
  [],
  ["Before you fill this in — please send us these first"],
  ["", "These are things a spreadsheet cannot capture, and two of them block the model outright."],
  [],
  ["1", "BLOCKING — the BOM workbook for REX GOLA PLUS. It is the only article we have a price for,"],
  ["",  "but it has no material rates at all, so we can invoice it and cannot plan a single metre of"],
  ["",  "material for it."],
  ["2", "BLOCKING — the BOM for SILKY BELLY (black and white). We hold 7 materials per size range"],
  ["",  "against 25-30 for every comparable article, so we believe the file we were given is partial."],
  ["3", "Your existing machine-wise daily production report or log book — a photo of one page is enough."],
  ["",  "We will reshape tab 6 to match what your supervisor already writes, so it is not extra work."],
  ["4", "Shift pattern: how many shifts, start/end times, weekly holiday, and any planned closures."],
  ["5", "Your MRP / price list for all articles — 13 of the 14 have no price in the model."],
  ["6", "Your current stock register export, in whatever format it already exists."],
  ["7", "Photos for PERCY and SPADE. Every other article has one."],
  ["8", "What is 'GLAMOUR'? It appears on your order sheets but is not a known article anywhere."],
  ["9", "Confirm the sole process for SMART BOY (black and white) — the model has it as PVC, but that"],
  ["",  "was inferred rather than told to us, and it decides which machine the order is planned on."],
  ["10","Confirm the '45 days' dispatch timeline printed on the PI is the real commitment."],
], [16, 52, 20, 32]);

/* ------------------------------------------------------------------ 1 MACHINES */
const machineRows = [
  ["1. MACHINES AND LINES"],
  ["One row per line. 'Pairs per shift' is the realistic sustained output of that line, not its best day."],
  ["'One order at a time' means the line cannot run two different orders on the same day."],
  [],
  ["Work centre code","Line / machine","Stage","Sole",
   "Model uses today (pairs/day) — PLACEHOLDER",
   FILL+"REAL pairs per shift", FILL+"Shifts per day", FILL+"Working days per week",
   FILL+"One order at a time? (Y/N)", FILL+"Notes"],
];
for(const [code, wc] of Object.entries(INPUTS.workcenters)){
  machineRows.push([code, wc.name, wc.stage, wc.sole_type || "—",
    wc.capacity_per_day, null, null, null, wc.exclusive ? "Y" : "N", null]);
}
machineRows.push([], ["If a stage above is really several separate lines (for example three stitching lines),"],
  ["add a row per line and tell us — the model can plan them separately."]);
sheet("1. Machines", machineRows, [24,24,14,10,34,20,16,22,24,30], 5);

/* ------------------------------------------------------------------ 2 PRODUCTS */
const productRows = [
  ["2. PRODUCTS — PACK QUANTITY AND PRICE"],
  ["One row per article and size range. Pairs per carton drives the pair count, the material"],
  ["requirement and the dispatch date, so a wrong figure here is wrong everywhere."],
  ["PVC machine: only PVC articles need it. Unset ones are being planned on ROTARY by default."],
  [],
  ["Article","Sole process in model", FILL+"Sole process — confirm", FILL+"PVC machine (ROTARY/VERTICAL)",
   "Type","Size range","Sizes as printed on the PI",
   "Pairs/carton in model today", FILL+"REAL pairs per carton", FILL+"MRP ₹", FILL+"Notes"],
];
for(const [code, a] of Object.entries(INPUTS.articles)){
  let firstRowOfArticle = true;
  for(const type of articleTypes(code)){
    for(const combo of articleTypeCombos(code, type)){
      // Sole process and PVC machine belong to the ARTICLE, not the size range.
      // Asking on every row invites eleven different answers for one article.
      const soleCell = firstRowOfArticle
        ? (a.sole_assumed ? `${a.sole_type} — ASSUMED, please confirm` : a.sole_type)
        : "↑";
      const machineCell = !firstRowOfArticle ? "↑"
        : a.sole_type === "PVC" ? (a.molding_machine || "NOT SET — answer once") : "—";
      productRows.push([code, soleCell, null, machineCell,
        type === "ALL" ? "—" : type,
        combo, comboSizesForArticle(code, combo, type).join(" "),
        pairsPerCarton(code, combo) ?? "NOT SET",
        null,
        ((INPUTS.mrp||{})[code]||{})[combo] ?? null,
        null]);
      firstRowOfArticle = false;
    }
  }
}
productRows.push([],
  ["Sole process and PVC machine are per ARTICLE — answer on its first row only; '↑' means same as above."],
  ["Pairs per carton in the model came from your packing chart. Please still tick each one:"],
  ["a wrong pack quantity changes the pair count, the material and the dispatch date together."]);
sheet("2. Products", productRows, [24,28,24,30,10,14,30,26,24,12,26], 6);

/* ------------------------------------------------------------------- 3 PROMISE */
const T = INPUTS.lead_time_rules || {};
sheet("3. Promise", [
  ["3. DELIVERY PROMISE AND LEAD TIMES"],
  ["These decide whether an order shows as On track, At risk or Delayed. The figures in the model"],
  ["today are placeholders implying a 30-day order-to-dispatch promise that nobody has confirmed."],
  [],
  ["A. By when should each stage be finished, counted in days from the order date?"],
  ["Stage","Model uses today — PLACEHOLDER", FILL+"REAL days from order date"],
  ["Cutting", 8, null],
  ["Preparation & printing", 11, null],
  ["Stitching", 15, null],
  ["Upper QC", 18, null],
  ["Molding", 22, null],
  ["Packing", 28, null],
  ["Dispatch", 30, null],
  [],
  ["B. Days lost before production can start"],
  ["Rule","Model uses today — PLACEHOLDER", FILL+"REAL days"],
  ["Outside stitching — days out and back", T.stitching_outside_transport_days ?? 2, null],
  ["Printing — extra days added to a printed order", T.printing_days ?? 1, null],
  ["In-house preparation — extra days before cutting", T.stitching_inhouse_prep_days ?? 0, null],
  [],
  ["C. Calendar"],
  ["Question", FILL+"Answer"],
  ["Weekly holiday (which day, or 'none')", null],
  ["Any other non-working days in the next 3 months (list the dates)", null],
  ["Dispatch timeline printed on the PI — is '45 days' correct?", null],
  ["Is the promise counted from the order date, or from the advance payment?", null],
], [58, 34, 30], 6);

/* ----------------------------------------------------------------- 4 CUSTOMERS */
sheet("4. Customers", [
  ["4. CUSTOMERS AND AGREED TERMS"],
  ["These are locked onto the invoice — a PI cannot quietly deviate from them, which is the point."],
  ["The three deductions come off in the order shown, each from the running balance. GST is added last."],
  ["Leave a cell blank only if it genuinely does not apply; a blank discount is NOT the same as 0%."],
  [],
  [FILL+"Customer name", FILL+"City", FILL+"Discount % off MRP",
   FILL+"Deduction 1 name", FILL+"%", FILL+"Deduction 2 name", FILL+"%",
   FILL+"Deduction 3 name", FILL+"%", FILL+"GST %", FILL+"Advance % on order",
   FILL+"Order nature (MTS/MTO/Institutional)"],
  ["EXAMPLE — delete this row","Mumbai",40,"F.O.R.",2,"Cash Discount",3,"GST Dis",4.76,5,50,"MTS"],
  ...blanks(60, 12),
], [30,16,20,20,8,20,8,16,8,10,20,34], 6);

/* --------------------------------------------------------------------- 5 STOCK */
const stockRows = [
  ["5. MATERIAL STOCK"],
  ["Procurement is netted against these figures. A material left at zero makes the app order the"],
  ["FULL requirement rather than the shortfall — safe, but not the real picture."],
  [],
  ["Material","UOM","Stock in model today", FILL+"Physical count", FILL+"Count date",
   FILL+"Rate ₹ per unit", FILL+"Minimum stock to hold"],
];
for(const [key, m] of Object.entries(INPUTS.materials)){
  stockRows.push([m.name, m.uom, m.stock ?? 0, null, null, null, null]);
}
sheet("5. Stock", stockRows, [46,10,24,20,16,20,26], 5);

/* ----------------------------------------------------------------- 6 DAILY LOG */
sheet("6. Daily log", [
  ["6. DAILY PRODUCTION LOG — one line per machine per shift"],
  ["THIS IS THE TAB THAT MAKES THE PLAN LIVE. Without it the app shows what was planned, never"],
  ["what happened, so it cannot tell you a line is falling behind or re-date the orders behind it."],
  ["Fill it at the end of every shift. If a machine ran nothing, enter a row with 0 and the reason."],
  ["Send us your existing log book format first — we will reshape this to match it."],
  [],
  [FILL+"Date", FILL+"Shift", FILL+"Work centre code (tab 1)", FILL+"Order no",
   FILL+"Article", FILL+"Stage", FILL+"Pairs good", FILL+"Pairs rejected",
   FILL+"Downtime hours", FILL+"Downtime reason", FILL+"Supervisor", FILL+"Remarks"],
  ["EXAMPLE — delete this row","A","MOLDING_EVA","JO2043","SPIKE","MOLDING",820,14,1.5,
   "Mould change","R. Kumar","Ran short of black compound after lunch"],
  ...blanks(300, 12),
], [12,8,26,14,22,16,12,14,16,30,16,42], 7);

/* ------------------------------------------------------------------- 7 CHANGES */
sheet("7. Changes", [
  ["7. ORDER CHANGES AND FEEDBACK"],
  ["Two things belong here, because both are 'something moved and the plan needs to know'."],
  [],
  ["A. Order pipeline changes — quantity revised, priority changed, order held, delivery re-promised"],
  [FILL+"Date", FILL+"Order no", FILL+"What changed", FILL+"From", FILL+"To",
   FILL+"Reason", FILL+"Customer informed? (Y/N)", FILL+"Raised by"],
  ["EXAMPLE — delete","JO2043","Quantity","1200 pairs","900 pairs","Customer reduced","Y","Planning"],
  ...blanks(120, 8),
  [],
  ["B. Feedback on the app — anything wrong, missing, or slower than doing it on paper"],
  [FILL+"Date", FILL+"Screen", FILL+"What happened / what is needed", FILL+"How urgent (High/Med/Low)",
   FILL+"Raised by"],
  ["EXAMPLE — delete","Machine load","Stitching shows one line but we run three","High","Production head"],
  ...blanks(120, 5),
], [12,14,44,18,18,30,26,18]);

/* ------------------------------------------------------------------------------ */
XLSX.writeFile(wb, OUT);
const counts = wb.SheetNames.map(n => {
  const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header:1, defval:null });
  return `${n} (${r.length} rows)`;
});
console.log(`Wrote ${OUT}\n  ${counts.join("\n  ")}`);
