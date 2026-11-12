/* The Raw Material Store in the factory's STOCK MASTER layout.
 *
 * The fixture is the client's own October 2026 workbook (exported from their
 * "Stock sheet empty.numbers"), so the importer is checked against the sheet
 * the store actually keeps — including its faults: "PAIR" typed into MIN.
 * STOCK on INSOLE, items listed twice on CHEMICAL and FABRIC, and the
 * PACKAGING SUMMARY block under the packing items.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStockWorkbook, parseStockSheet, importPlan, storeItemName, storeItemKey, monthFromTitle,
         validateStoreEntry, bookStoreEntry, entryWarnings, monthSheet, storeDashboard, monthSheetAoa,
         jobMaterialAlerts, upperShortage } from "../shared/store-register.js";

const workbook = JSON.parse(readFileSync(new URL("./fixtures/stock-sheet-oct-2026.json", import.meta.url)));

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

console.log("\nA — reading the factory's workbook");
test("every category sheet is read; the DASHBOARD is not an item sheet", () => {
  const p = parseStockWorkbook(workbook);
  assert.equal(p.ok, true, p.problems.join("; "));
  assert.deepEqual(p.sheets.map(s => s.sheet), ["SOLE MASTER","INSOLE MASTER","CHEMICAL MASTER","PACKING MASTER",
    "FABRIC MASTER","GRINDERY MASTER","PVC COMPOUND MASTER","OTHER MASTER"]);
  assert.equal(parseStockSheet(workbook.DASHBOARD, "DASHBOARD"), null);
  assert.equal(p.month, "2026-10");
});
test("a sole is one item PER SIZE, the size folded into its name", () => {
  const p = parseStockWorkbook(workbook);
  const soles = p.items.filter(i => i.description === "1231 BLACK");
  assert.ok(soles.length >= 14);
  const five = soles.find(i => i.size === "5C");
  assert.equal(five.key, "1231 BLACK 5C||PAIR");
  assert.equal(five.rate, 48.5);
  /* A size written as a bare number reads "5", never "5.0". */
  assert.ok(soles.some(i => i.size === "5" && i.key === "1231 BLACK 5||PAIR"));
  assert.equal(new Set(p.items.map(i => i.key)).size, p.items.length);
});
test("a sheet with no SIZE column (CHEMICAL) keeps opening, minimum and UOM", () => {
  const pu = parseStockWorkbook(workbook).items.find(i => i.description === "PU CHEMICAL 6100DTF");
  assert.deepEqual([pu.category, pu.size, pu.uom, pu.opening, pu.min, pu.rate], ["CHEMICAL", "", "KGS", 52, 104, null]);
});
test("\"PAIR\" typed into MIN. STOCK is read as blank and said, not refused", () => {
  const p = parseStockWorkbook(workbook);
  const row = p.items.find(i => i.sheet === "INSOLE MASTER" && i.row === 28);
  assert.equal(row.description, "INSOLE-8MM MEHROON");
  assert.equal(row.min, null);
  assert.equal(row.opening, 150);
  assert.ok(p.warnings.some(w => /INSOLE MASTER row 28: .*MIN\. STOCK reads "PAIR", left blank/.test(w)));
});
test("an item on two rows is left out BOTH times and named", () => {
  const p = parseStockWorkbook(workbook);
  assert.ok(!p.items.some(i => i.key === "GOLDEN YELLOW||PCS"));
  const dup = p.skipped.find(s => s.name === "GOLDEN YELLOW (PCS)");
  assert.match(dup.where, /CHEMICAL MASTER row 32, CHEMICAL MASTER row 33/);
});
test("the PACKAGING SUMMARY block is not read as items", () => {
  const p = parseStockWorkbook(workbook);
  assert.ok(!p.items.some(i => /SUMMARY|TOTAL INNER BOX/.test(i.name)));
  assert.ok(p.skipped.some(s => /TOTAL INNER BOX/.test(s.name) && /not an item row/.test(s.reason)));
});
test("daily REC/ISSUE figures already on the sheet are counted, not silently lost", () => {
  assert.ok(parseStockWorkbook(workbook).daily_figures > 0);
});
test("a workbook with no item sheet is refused with what is missing", () => {
  const p = parseStockWorkbook({ DASHBOARD: workbook.DASHBOARD });
  assert.equal(p.ok, false);
  assert.match(p.problems[0], /ITEM DESCRIPTION/);
});
test("names and months", () => {
  assert.equal(storeItemName("insole-8mm mehroon", 7), "INSOLE-8MM MEHROON 7");
  assert.equal(storeItemName("REX GOLA INNER ", "8X10"), "REX GOLA INNER 8X10");
  assert.equal(storeItemKey("PU CHEMICAL", "", "kgs"), "PU CHEMICAL||KGS");
  assert.equal(monthFromTitle("SOLE - STOCK MASTER  (OCTOBER 2026)"), "2026-10");
  assert.equal(monthFromTitle("no month here"), null);
});

console.log("\nB — what an import would do");
test("new items are created, changed figures listed, blanks change nothing", () => {
  const items = parseStockWorkbook(workbook).items;
  const pu = items.find(i => i.key === "PU CHEMICAL 6100DTF||KGS");
  const materials = { "PU CHEMICAL 6100DTF||KGS": { name:"PU CHEMICAL 6100DTF", uom:"KGS", stock:10 } };
  const plan = importPlan(items, materials, { "PU CHEMICAL 6100DTF||KGS": { opening:10, min_stock:104, rate:300 } });
  assert.equal(plan.create.length, items.length - 1);
  assert.deepEqual(plan.update["PU CHEMICAL 6100DTF||KGS"], { category:"CHEMICAL", opening:52 });
  /* RATE is blank on the sheet: the 300 on the register stays. */
  assert.ok(!("rate" in plan.update["PU CHEMICAL 6100DTF||KGS"]));
  const again = importPlan([pu], materials, { "PU CHEMICAL 6100DTF||KGS": { opening:52, min_stock:104, category:"CHEMICAL" } });
  assert.equal(again.unchanged, 1);
  assert.equal(again.changes.length, 0);
});

console.log("\nC — the day register");
const materials = () => ({ "PU CHEMICAL||KGS": { name:"PU CHEMICAL", uom:"KGS", stock:52 },
                          "1231 BLACK 5C||PAIR": { name:"1231 BLACK 5C", uom:"PAIR", stock:0 } });
test("an entry needs a real date, a known item and a quantity", () => {
  const bad = validateStoreEntry({ type:"issue", moved_on:"2026-13-40", lines:[{ material_key:"NOPE||KGS", qty:1 },
    { material_key:"PU CHEMICAL||KGS", qty:0 }] }, materials());
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some(p => /real date/.test(p)));
  assert.ok(bad.problems.some(p => /NOPE\|\|KGS is not in the item register/.test(p)));
  assert.ok(bad.problems.some(p => /more than 0/.test(p)));
  assert.equal(validateStoreEntry({ type:"move", moved_on:"2026-10-02", lines:[{ material_key:"PU CHEMICAL||KGS", qty:1 }] }, materials()).ok, false);
});
test("issuing 50 of 52 deducts, raises MAKE ORDER below minimum, and undo puts it back", () => {
  const ref = { materials: materials(), stock_meta: { "PU CHEMICAL||KGS": { opening:52, min_stock:104 } } };
  const v = validateStoreEntry({ type:"issue", moved_on:"2026-10-02", lines:[{ material_key:"PU CHEMICAL||KGS", qty:50 }] }, ref.materials).value;
  const w = entryWarnings(v, ref.materials, ref.stock_meta);
  assert.deepEqual(w.reorder, [{ material_key:"PU CHEMICAL||KGS", name:"PU CHEMICAL", uom:"KGS", balance:2, min:104, order_qty:102 }]);
  assert.deepEqual(w.warnings, []);
  bookStoreEntry(ref, v.type, v.lines);
  assert.equal(ref.materials["PU CHEMICAL||KGS"].stock, 2);
  assert.equal(ref.stock_meta["PU CHEMICAL||KGS"].issue, 50);
  bookStoreEntry(ref, v.type, v.lines, -1);
  assert.equal(ref.materials["PU CHEMICAL||KGS"].stock, 52);
});
test("issuing more than the register shows is saved with a warning, not refused", () => {
  const v = validateStoreEntry({ type:"issue", moved_on:"2026-10-02", lines:[{ material_key:"1231 BLACK 5C||PAIR", qty:80 }] }, materials()).value;
  assert.match(entryWarnings(v, materials(), {}).warnings[0], /80 PAIR issued, but the register shows only 0/);
});
test("a receipt adds to Rec., and its opening figure is kept from the material", () => {
  const ref = { materials: materials(), stock_meta: {} };
  bookStoreEntry(ref, "rec", [{ material_key:"PU CHEMICAL||KGS", qty:100 }]);
  assert.deepEqual(ref.stock_meta["PU CHEMICAL||KGS"], { opening:52, rec:100 });
  assert.equal(ref.materials["PU CHEMICAL||KGS"].stock, 152);
});

console.log("\nD — the month, as the sheet prints it");
const rows = [{ key:"PU CHEMICAL||KGS", name:"PU CHEMICAL", description:"PU CHEMICAL", category:"CHEMICAL", uom:"KGS", stock:120, min:104, rate:300 },
              { key:"1231 BLACK 5C||PAIR", name:"1231 BLACK 5C", description:"1231 BLACK", size:"5C", category:"SOLE", uom:"PAIR", stock:400, min:0, rate:48.5 }];
const moves = [
  { material_key:"PU CHEMICAL||KGS", type:"rec",    qty:100, moved_on:"2026-10-01" },
  { material_key:"PU CHEMICAL||KGS", type:"issue",  qty:50,  moved_on:"2026-10-02" },
  { material_key:"PU CHEMICAL||KGS", type:"issue",  qty:30,  moved_on:"2026-10-02" },
  { material_key:"PU CHEMICAL||KGS", type:"return", qty:5,   moved_on:"2026-10-03" },
  { material_key:"PU CHEMICAL||KGS", type:"issue",  qty:20,  moved_on:"2026-11-04" },   // after October
];
test("Opening + Rec − Issue = Balance, and later movements are taken back off", () => {
  const s = monthSheet(rows, moves, "2026-10");
  const pu = s.rows.find(r => r.key === "PU CHEMICAL||KGS");
  /* Today 120; 20 issued in November, so October closed at 140. */
  assert.equal(pu.balance, 140);
  assert.equal(pu.rec, 100);
  assert.equal(pu.issue, 75);                 // 50 + 30 − 5 returned
  assert.equal(pu.opening, 115);
  assert.equal(pu.opening + pu.rec - pu.issue, pu.balance);
  assert.deepEqual(pu.daily[2], { rec:0, issue:80 });
  assert.equal(s.days, 31);
});
test("ALERT is their formula: MAKE ORDER below MIN. STOCK, with the order quantity", () => {
  const s = monthSheet(rows, moves, "2026-11");
  const pu = s.rows.find(r => r.key === "PU CHEMICAL||KGS");
  assert.equal(pu.balance, 120);
  assert.equal(pu.alert, "STOCK OK");
  const low = monthSheet([{ ...rows[0], stock:60 }], [], "2026-11").rows[0];
  assert.deepEqual([low.alert, low.order_qty], ["MAKE ORDER", 44]);
  /* No minimum set: never MAKE ORDER, as in the sheet. */
  assert.equal(monthSheet([rows[1]], [], "2026-11").rows[0].alert, "STOCK OK");
});
test("values are rate × quantity, and the DASHBOARD totals by category", () => {
  const s = monthSheet(rows, moves, "2026-10");
  const d = storeDashboard(s.rows);
  assert.deepEqual(d.categories.map(c => c.category), ["SOLE", "CHEMICAL"]);
  const chem = d.categories.find(c => c.category === "CHEMICAL");
  assert.equal(chem.balance_value, 140 * 300);
  assert.equal(chem.units, "KGS");
  assert.equal(d.totals.balance_value, 140 * 300 + 400 * 48.5);
  assert.equal(storeDashboard([{ ...rows[0], category:"X" }, { ...rows[1], category:"X" }]).categories[0].units, "MIXED");
});
test("the download carries their headings and a REC./ISSUE pair per day", () => {
  const aoa = monthSheetAoa(monthSheet(rows, moves, "2026-10"), "CHEMICAL");
  assert.equal(aoa[0][0], "CHEMICAL - STOCK MASTER  (OCTOBER 2026)");
  assert.equal(aoa[1][16], "ALERT");
  assert.equal(aoa[2][18], "REC.");
  assert.equal(aoa.length, 4);
  /* Day 2: 80 issued, in the ISSUE column of the day-2 pair. */
  assert.equal(aoa[3][18 + 2 * 1 + 1], 80);
});

console.log("\nE — job orders waiting on material");
const article = { combos:{ "6X9":{ rates:{ CUTTING:{ "REXINE||MTR":0.1 }, MOLDING:{ "PVC||KGS":0.2 } } } } };
const regMaterials = { "REXINE||MTR":{ name:"REXINE", uom:"MTR", stock:0 }, "PVC||KGS":{ name:"PVC", uom:"KGS", stock:0 } };
const job = (id, extra = {}) => ({ id, article:"A", order_no:"JO" + id, status:"partial",
  card:{ lines:[{ combo:"6X9", qty:100 }], ...extra } });
test("an open card needing more than the shelf holds raises an alert naming the card", () => {
  const meta = { "REXINE||MTR":{ opening:4, rec:0 }, "PVC||KGS":{ opening:100 } };
  const { alerts } = jobMaterialAlerts([job(1)], { A:article }, regMaterials, meta, []);
  assert.equal(alerts.length, 1);
  assert.deepEqual([alerts[0].name, alerts[0].outstanding, alerts[0].short], ["REXINE", 10, 6]);
  assert.equal(alerts[0].jobs[0].job_id, 1);
});
test("material already issued to the card is not asked for twice; the alert clears", () => {
  const meta = { "REXINE||MTR":{ opening:4, issue:10, rec:10 }, "PVC||KGS":{ opening:100 } };
  const issues = [{ job_id:1, material_key:"REXINE||MTR", type:"issue", qty:10 }];
  assert.equal(jobMaterialAlerts([job(1)], { A:article }, regMaterials, meta, issues).alerts.length, 0);
});
test("a release that took the register below zero is a shortage too", () => {
  const meta = { "REXINE||MTR":{ opening:4, rec:1, issue:10 }, "PVC||KGS":{ opening:100 } };
  const issues = [{ job_id:1, material_key:"REXINE||MTR", type:"issue", qty:10 }];
  const a = jobMaterialAlerts([job(1)], { A:article }, regMaterials, meta, issues).alerts[0];
  assert.deepEqual([a.balance, a.short], [-5, 5]);
});
test("closed, cancelled and never-counted are not alerted; a moulding card needs no rexine", () => {
  const meta = { "PVC||KGS":{ opening:1 } };
  const out = jobMaterialAlerts([job(1, {}), { ...job(2), status:"closed" }, { ...job(3), cancelled:true },
    { ...job(4), card:{ start_stage:"MOLDING", lines:[{ combo:"6X9", qty:100 }] } }],
    { A:article }, regMaterials, meta, []);
  /* REXINE has no figure at all — counted, not alerted. */
  assert.equal(out.uncounted, 1);
  assert.deepEqual(out.alerts.map(a => [a.name, a.jobs.map(j => j.job_id)]), [["PVC", [1, 4]]]);
});
test("uppers for a moulding card are checked size by size", () => {
  assert.deepEqual(upperShortage([{ sizes:{ "6":40, "7":30 } }, { sizes:{ "7":10 } }], { "6":50, "7":12 }),
    [{ size:"7", wanted:40, on_hand:12, short:28 }]);
  assert.deepEqual(upperShortage([{ sizes:{ "6":40 } }], { "6":-5 }), [{ size:"6", wanted:40, on_hand:-5, short:40 }]);
});

console.log(`\n${passed} passed, ${failed} failed`);
if(failed) process.exitCode = 1;
