/* The factory's sheets, built from the system. */
import assert from "node:assert/strict";
import { compute } from "../shared/engine.js";
import { INPUTS } from "../shared/inputs.js";
import { planningSheet, mtsStockSheet, mtoStockSheet, packingReportSheet, jobCardSheet } from "../shared/formats.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}
const { articles, materials, workcenters, origin } = INPUTS;

console.log("\nFormats");
test("the planning sheet is the plan, day by machine, and names a shut day", () => {
  const s = compute([{ order_no:"JO1", order_date:"2026-07-06", article_code:"SMART BOY (L) BLACK", priority:2, party:"T",
    lines:[{ combo:"6X8", qty:960 }] }], articles, materials, workcenters, origin, {});
  const rows = planningSheet(s, origin, "2026-07-06", "2026-07-13", workcenters);
  assert.equal(rows[0][0], "Date");
  const sunday = rows.find(r => r[0] === "2026-07-12");
  assert.equal(sunday[2], "— factory shut —");
  const planned = rows.slice(1).filter(r => r[9] !== "").reduce((a, r) => a + Number(r[9] || 0), 0);
  assert.equal(planned, 960 * 7, "every stage's pairs appear once");
  assert.ok(rows.slice(1).every(r => r[10] === ""), "achieved is left blank to be filled");
});
test("the MTS sheet carries the book stock and a BLANK physical count", () => {
  const rows = mtsStockSheet({ articles:[{ article:"SPIKE", size_list:[{ size:"8s", pairs:12 }] }] }, () => ["7s","8s"], "2026-10-03");
  assert.deepEqual(rows.slice(1).map(r => [r[1], r[2], r[3]]), [["7s",0,""],["8s",12,""]]);
});
test("the MTO sheet lists ready pairs", () => {
  assert.equal(mtoStockSheet({ rows:[{ order_no:"JO1", party:"P", article:"A", ordered:5, packed:4, dispatched:1, ready:3, to_make:1 }] })[1][6], 3);
});
test("the packing report sheet is the order's own sizes, cartons blank", () => {
  const rows = packingReportSheet({ order_no:"JO1", party:"P", article_code:"SPIKE", pi:{},
    lines:[{ combo:"7X10S", qty:60, sizes:{ "7s":20, "9s":40 } }] }, () => ["7s","8s","9s","10s"]);
  const body = rows.filter(r => r[5] && r[0] !== "S.No" && r[5] !== "TOTAL");
  assert.deepEqual(body.map(r => [r[5], r[6], r[7]]), [["7s",20,""],["9s",40,""]]);
});
test("the job card sheet lists issued sizes and what was recorded", () => {
  const rows = jobCardSheet({ id:7, qty:60, article:"SPIKE", order_no:"JO1", fabricator:"Rex Internal",
    card:{ card_no:"JC7", lines:[{ combo:"7X10S", sizes:{ "7s":20, "8s":40, "9s":0 } }] } },
    [{ actual_pairs:50, rejected_pairs:2, repair_pairs:3, cartons:2 }]);
  assert.deepEqual(rows.filter(r => r[0] === "7X10S").map(r => [r[1], r[2]]), [["7s",20],["8s",40]]);
  const rec = rows.find(r => r[0] === "Recorded so far");
  assert.deepEqual(rec.slice(3, 7), [50, 2, 3, 2]);
});
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
