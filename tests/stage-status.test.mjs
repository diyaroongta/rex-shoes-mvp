/* The status board. Its whole job is to keep two different claims apart:
   where the PLAN says work is (a forecast) and where the last thing anybody
   WROTE DOWN puts it (a fact). */
import assert from "node:assert/strict";
import { plannedPosition, recordedPosition, statusRow, statusBoard } from "../shared/stage-status.js";
import { compute } from "../shared/engine.js";
import { productionUnits } from "../shared/production-units.js";
import { INPUTS } from "../shared/inputs.js";

const { articles, materials, workcenters: wcs, origin } = INPUTS;
let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

const ORDER = { order_no:"JO7001", order_date:"2026-07-06", article_code:"SMART BOY (L) BLACK",
                priority:2, party:"Status Test", lines:[{ combo:"6X8", qty:960 }] };
const state = compute([ORDER], articles, materials, wcs, origin, {});
const view = state.orders[0];

console.log("\nA — where the plan says it is");
test("before the first stage starts, it has not started", () => {
  const p = plannedPosition(view, "2026-07-01");
  assert.equal(p.phase, "not_started");
  assert.equal(p.until, "2026-07-06");
});
test("on a working day it names the stage and the machine", () => {
  const p = plannedPosition(view, "2026-07-08");
  assert.equal(p.phase, "running");
  assert.equal(p.stage, "STITCHING");
  assert.equal(p.work_center, "STITCHING");
});
test("after the last stage it is finished, not still in dispatch", () => {
  assert.equal(plannedPosition(view, "2026-08-01").phase, "finished");
});
test("an order with no stages says so rather than guessing a stage", () => {
  assert.deepEqual(plannedPosition({ stages:[] }, "2026-07-08"),
    { phase:"unplanned", stage:null, since:null, until:null });
});

console.log("\nB — where the recorded movements put it");
const jobs = [
  { id:1, order_no:"JO7001", article:"SMART BOY (L) BLACK", stage:"CUTTING & STITCHING",
    fabricator:"Rex Internal", qty:500, received:0, issued_on:"2026-07-07",
    card:{ card_no:"JC1", date:"2026-07-07", lines:[{ combo:"6X8", qty:500, sizes:{} }] } },
];
test("nothing keyed is NOT 'in cutting' — it is nothing recorded", () => {
  const r = recordedPosition(view, { jobs:[], dispatches:[] });
  assert.equal(r.phase, "nothing_recorded");
  assert.equal(r.stage, null);
  assert.deepEqual(r.events, []);
});
test("a job card issued is a movement, with its date and its pairs", () => {
  const r = recordedPosition(view, { jobs, dispatches:[] });
  assert.equal(r.phase, "issued");
  assert.equal(r.stage, "CUTTING");        // "CUTTING & STITCHING" is read as the stage it starts at
  assert.equal(r.on, "2026-07-07");
  assert.equal(r.last.pairs, 500);
  assert.match(r.last.detail, /500 pairs issued to Rex Internal/);
});
test("a dispatch is the last word", () => {
  const r = recordedPosition(view, { jobs,
    dispatches:[{ order_no:"JO7001", dispatched:{ "6X8":300 }, dispatched_on:"2026-07-20" }] });
  assert.equal(r.stage, "DISPATCH");
  assert.equal(r.last.pairs, 300);
  assert.equal(r.events.length, 2);
});
test("a hidden dispatch row is not a movement", () => {
  const r = recordedPosition(view, { jobs:[],
    dispatches:[{ order_no:"JO7001", dispatched:{ "6X8":300 }, dispatched_on:"2026-07-20", hidden:true }] });
  assert.equal(r.phase, "nothing_recorded");
});
test("a card issued against ANOTHER batch says nothing about this one", () => {
  const units = productionUnits([ORDER], [
    { id:1, order_no:"JO7001", qty:500, received:0, issued_on:"2026-07-07", stage:"STITCHING",
      card:{ card_no:"JC1", date:"2026-07-07", lines:[{ combo:"6X8", qty:500, sizes:{} }] } },
    { id:2, order_no:"JO7001", qty:460, received:0, issued_on:"2026-07-21", stage:"STITCHING",
      card:{ card_no:"JC2", date:"2026-07-21", lines:[{ combo:"6X8", qty:460, sizes:{} }] } }]);
  const batched = compute([ORDER], articles, materials, wcs, origin, { units });
  const [a, b] = batched.units;
  const ctx = { jobs:[{ id:1, order_no:"JO7001", qty:500, received:0, issued_on:"2026-07-07",
                        stage:"STITCHING", fabricator:"Line 1",
                        card:{ card_no:"JC1", date:"2026-07-07", lines:[] } }], dispatches:[] };
  assert.equal(recordedPosition(a, ctx).phase, "issued");
  assert.equal(recordedPosition(b, ctx).phase, "nothing_recorded",
    "the second card must not inherit the first card's movement");
});

console.log("\nC — the two claims side by side");
test("a row says where the plan has it AND where it was last seen", () => {
  const row = statusRow(view, { today:"2026-07-10", jobs, dispatches:[] });
  assert.equal(row.planned.stage, "MOLDING");
  assert.equal(row.recorded.stage, "CUTTING");
  assert.equal(row.agrees, false);
  assert.equal(row.behind, true, "cutting is behind moulding, and that is the point of the board");
  assert.equal(row.column, "CUTTING", "a recorded movement outranks a forecast");
  assert.equal(row.column_is_recorded, true);
});
test("with nothing recorded, the row is drawn where the plan says, and says so", () => {
  const row = statusRow(view, { today:"2026-07-10", jobs:[], dispatches:[] });
  assert.equal(row.column, "MOLDING");
  assert.equal(row.column_is_recorded, false);
  assert.equal(row.agrees, null, "there is nothing to agree WITH");
  assert.equal(row.behind, false);
});
test("the board has one column per stage, in the order a shoe is made", () => {
  const board = statusBoard(state.orders, { today:"2026-07-10", jobs, dispatches:[] });
  assert.deepEqual(board.columns.map(c => c.stage),
    ["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","ASSEMBLY","PACKING","DISPATCH"]);
  assert.equal(board.columns.find(c => c.stage === "CUTTING").rows.length, 1);
  assert.deepEqual(board.counts, { total:1, recorded:1, behind:1, nothing_recorded:0 });
});
test("the counts name how much of the board is forecast rather than fact", () => {
  const board = statusBoard(state.orders, { today:"2026-07-10", jobs:[], dispatches:[] });
  assert.deepEqual(board.counts, { total:1, recorded:0, behind:0, nothing_recorded:1 });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
