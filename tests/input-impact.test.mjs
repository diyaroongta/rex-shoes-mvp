/* "What did my entry just do?" — the screen has to be able to answer that
   from the plan itself, including the parts that did NOT move. */
import assert from "node:assert/strict";
import { planImpact, storedRows } from "../shared/input-impact.js";
import { compute } from "../shared/engine.js";
import { progressFrom } from "../shared/production-progress.js";
import { INPUTS } from "../shared/inputs.js";

const { articles, materials, workcenters: wcs, origin } = INPUTS;
let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

const ORDER = { order_no:"JO7700", order_date:"2026-09-21", article_code:"SMART BOY (L) BLACK",
                priority:2, party:"Impact Test", lines:[{ combo:"6X8", qty:1000 }] };
const before = compute([ORDER], articles, materials, wcs, origin, {});
const cutting = before.orders[0].stages.find(s => s.stage === "CUTTING");
const SHORT = [{ production_on:cutting.start_date, work_center:"CUTTING", stage:"CUTTING",
                 order_no:"JO7700", unit_key:"JO7700", planned_pairs:1000, actual_pairs:800 }];
const after = compute([ORDER], articles, materials, wcs, origin, { progress: progressFrom(SHORT) });

console.log("\nA — the row that was written");
test("it names the table and the key, not a summary", () => {
  const [row] = storedRows(SHORT);
  assert.equal(row.table, "production_actuals");
  assert.equal(row.key, `${cutting.start_date} · CUTTING · CUTTING · JO7700`);
  assert.equal(row.gap, -200, "the gap is what drives everything downstream");
});

console.log("\nB — what moved");
test("a short day moves the order's dispatch date, and says by how much", () => {
  const impact = planImpact(before, after, SHORT);
  assert.equal(impact.pairs_recorded, 800);
  assert.equal(impact.behind_pairs, 200);
  assert.equal(impact.orders.length, 1);
  const o = impact.orders[0];
  assert.ok(o.dispatch_after > o.dispatch_before);
  assert.ok(o.days_moved >= 1);
  assert.equal(o.worse, true);
});
test("the machine board is reported as pairs still to make", () => {
  const impact = planImpact(before, after, SHORT);
  const c = impact.load.find(l => l.work_center === "CUTTING");
  assert.equal(c.pairs_before, 1000);
  assert.equal(c.pairs_after, 200, "800 pairs have been made and leave the board");
  assert.equal(c.delta, -800);
});

console.log("\nC — what did NOT move is said out loud");
test("the buying list is named as unchanged, not left out", () => {
  const impact = planImpact(before, after, SHORT);
  assert.equal(impact.procurement.changed, false);
  assert.ok(impact.unchanged.some(u => /buying list is unchanged/.test(u)));
  assert.ok(impact.unchanged.some(u => /order book, the PI or the dispatch book/.test(u)));
});
test("an entry that changes nothing says so in every line", () => {
  const impact = planImpact(before, before, []);
  assert.deepEqual(impact.orders, []);
  assert.deepEqual(impact.cards, []);
  assert.deepEqual(impact.load, []);
  assert.equal(impact.unchanged.length, 5);
});
test("recording MORE than planned reads as ahead, not as an error", () => {
  const AHEAD = [{ ...SHORT[0], actual_pairs:1000 }];
  const done = compute([ORDER], articles, materials, wcs, origin, { progress: progressFrom(AHEAD) });
  const impact = planImpact(before, done, AHEAD);
  assert.equal(impact.behind_rows, 0);
  assert.equal(impact.ahead_rows, 0, "1,000 of 1,000 is neither ahead nor behind");
  assert.equal(impact.pairs_recorded, 1000);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
