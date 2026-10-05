/* "Order was dispatched yet it was showing procurement for that order."
   "Once a job card closes, raw material procurement should go away." */
import assert from "node:assert/strict";
import { compute } from "../shared/engine.js";
import { INPUTS } from "../shared/inputs.js";
import { productionUnits } from "../shared/production-units.js";
import { materialDone } from "../shared/material-demand.js";

let passed = 0, failed = 0;
function test(name, fn){ try { fn(); passed++; console.log("  pass  " + name); } catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); } }

const { articles, materials, workcenters, origin } = INPUTS;
const ART = "SMART BOY (L) BLACK";
const order = { order_no:"JO1", order_date:"2026-07-06", article_code:ART, priority:2, party:"P", pi:{}, lines:[{ combo:"6X8", qty:960 }] };
const card = (id, qty, extra={}) => ({ id, order_no:"JO1", article:ART, qty, received:0, status:"issued",
  card:{ card_no:`JC${id}`, lines:[{ combo:"6X8", qty, sizes:{} }] }, ...extra });
const plan = (jobs, dispatches) => {
  const units = productionUnits([order], jobs);
  return compute([order], articles, materials, workcenters, origin, { units, materialDone: materialDone(units, jobs, dispatches) });
};
const needed = s => ((s.procurement_by_order.JO1 || {}).materials || []).reduce((a, m) => a + m.required, 0);

console.log("\nProcurement only for what is still to make");
const full = needed(plan([card(1, 960)], []));
test("an open job card still needs its material", () => assert.ok(full > 0));
test("a CLOSED job card needs none", () => {
  assert.equal(needed(plan([card(1, 960, { status:"closed", received:960 })], [])), 0);
});
test("a card closed SHORT needs none either — the shortfall is written off", () => {
  assert.equal(needed(plan([card(1, 960, { status:"closed", received:900, shortage:60 })], [])), 0);
});
test("pairs received on an open card need none; the rest still do", () => {
  const half = needed(plan([card(1, 960, { status:"partial", received:480 })], []));
  assert.ok(Math.abs(half - full / 2) < 0.05, `${half} vs ${full / 2}`);
});
test("a fully DISPATCHED order needs none", () => {
  assert.equal(needed(plan([], [{ order_no:"JO1", dispatched:{ "6X8":960 } }])), 0);
});
test("received and then dispatched pairs are not subtracted twice", () => {
  const s = plan([card(1, 480, { status:"partial", received:480 }), card(2, 480)], [{ order_no:"JO1", dispatched:{ "6X8":480 } }]);
  assert.ok(Math.abs(needed(s) - full / 2) < 0.05, "card 2 still needs its 480");
});
test("an order closed short in the Dispatch Book needs nothing more", () => {
  assert.equal(needed(plan([card(1, 480)], [{ order_no:"JO1", dispatched:{ "6X8":100 }, closes_order:true }])), 0);
});
test("the factory-wide buying list moves with it", () => {
  const before = plan([card(1, 960)], []).netted.reduce((a, m) => a + m.required, 0);
  const after = plan([card(1, 960, { status:"closed", received:960 })], []).netted.reduce((a, m) => a + m.required, 0);
  assert.ok(before > 0); assert.equal(after, 0);
});
test("an ARCHIVED finished card does not fall back into the balance", () => {
  const units = productionUnits([order], [card(1, 960, { status:"closed", received:960, archived:true })]);
  assert.deepEqual(units.map(u => u.unit_kind), ["job"]);
});
test("a card CANCELLED with its order is not work", () => {
  const units = productionUnits([order], [card(1, 960, { cancelled:true })]);
  assert.deepEqual(units.map(u => u.unit_kind), ["balance"]);
});
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
