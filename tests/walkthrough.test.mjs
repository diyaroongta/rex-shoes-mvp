/* THE CLIENT'S OWN WALKTHROUGH, end to end, in one test.
 *
 *   1,000 pairs on a PI            -> the order book
 *     500 on a job card            -> in production; 500 still waiting
 *     425 made (85% of the card)   -> the 75 short reroute to the next day,
 *                                     and everything behind them moves too
 *     425 dispatched               -> ten full cartons and one mixed box
 *
 * Every figure printed below is computed, not written down: if the planner
 * changes, this test says so in the numbers. */
import assert from "node:assert/strict";
import { compute } from "../shared/engine.js";
import { productionUnits } from "../shared/production-units.js";
import { progressFrom } from "../shared/production-progress.js";
import { jobOrderBalance } from "../shared/job-orders.js";
import { buildPackingList } from "../shared/packing-list.js";
import { buildGatePass } from "../shared/gate-pass.js";
import { buildLedger } from "../shared/dispatch-ledger.js";
import { planImpact } from "../shared/input-impact.js";
import { INPUTS } from "../shared/inputs.js";

const { articles, materials, workcenters: wcs, origin } = INPUTS;
let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}
const trace = (label, value) => console.log(`        ${label.padEnd(42)} ${value}`);

/* ---- 1. the PI reaches the order book: 1,000 pairs -------------------- */
const ORDER = { order_no:"JO9500", order_date:"2026-09-21", article_code:"SMART BOY (L) BLACK",
                priority:2, party:"Deiom India",
                pi:{ pi_no:"PI/511", vl:"VEL", upper_colour:"WHITE" },
                lines:[{ combo:"6X8", qty:1000, sizes:{ "6":250, "7":250, "8":250, "9":250 } }] };

/* ---- 2. half of it goes on a job card -------------------------------- */
const CARD = { id:41, order_no:"JO9500", article:"SMART BOY (L) BLACK", stage:"CUTTING & STITCHING",
  fabricator:"Rex Internal", qty:500, received:0, issued_on:"2026-09-21",
  card:{ card_no:"JC41", date:"2026-09-21", start_on:"2026-09-21",
         lines:[{ combo:"6X8", qty:500, sizes:{ "6":125, "7":125, "8":125, "9":125 } }] } };

const units = productionUnits([ORDER], [CARD]);
const planned = compute([ORDER], articles, materials, wcs, origin, { units });

console.log("\n1 — a PI of 1,000 pairs, with 500 released on a job card");
test("the card is in production and the other 500 are waiting, not scheduled", () => {
  const order = planned.orders[0];
  trace("ordered", `${order.qty + order.pending_pairs} pairs`);
  trace("on job card JC41 (scheduled)", `${order.qty} pairs`);
  trace("waiting for a card (not scheduled)", `${order.pending_pairs} pairs`);
  assert.equal(order.qty, 500);
  assert.equal(order.pending_pairs, 500);
  assert.equal(planned.units.length, 1, "only the card is on the board");
  assert.equal(planned.pending_release[0].pairs, 500);

  const balance = jobOrderBalance(ORDER, [CARD]);
  assert.equal(balance.issued, 500);
  assert.equal(balance.remaining, 500, "the order book shows 500 still to release");
});

console.log("\n2 — the card is scheduled from its own start date");
const cutting = planned.units[0].stages.find(s => s.stage === "CUTTING");
test("cutting starts the day the card says work starts", () => {
  trace("card start_on", CARD.card.start_on);
  trace("cutting planned", `${cutting.start_date} → ${cutting.end_date}`);
  trace("card dispatches", planned.units[0].dispatch_date);
  assert.equal(cutting.start_date, "2026-09-21");
  assert.equal(Math.round(Object.values(cutting.alloc).reduce((a,b)=>a+b,0)), 500);
});

/* ---- 3. the floor makes 85% of it ------------------------------------ */
const ACTUALS = [{ production_on:cutting.start_date, work_center:"CUTTING", stage:"CUTTING",
                   order_no:"JO9500", unit_key:"JO9500#JC41", job_card_no:"JC41",
                   planned_pairs:500, actual_pairs:425 }];
const after = compute([ORDER], articles, materials, wcs, origin,
  { units, progress: progressFrom(ACTUALS) });

console.log("\n3 — 425 of 500 made: the 75 short reroute, and the rest moves with them");
test("the balance is re-planned for the NEXT day, and only the balance", () => {
  const now = after.units[0].stages.find(s => s.stage === "CUTTING");
  const left = Math.round(Object.values(now.alloc).reduce((a,b)=>a+b,0));
  trace("achieved on " + cutting.start_date, "425 of 500 pairs (85%)");
  trace("cutting re-planned", `${now.start_date} → ${now.end_date}`);
  trace("pairs still to cut", `${left}`);
  assert.equal(left, 75);
  assert.ok(now.start_date > cutting.start_date,
    `the 75 left cannot be cut again on ${cutting.start_date}`);
});
test("every stage behind it is pushed, and so is the dispatch date", () => {
  const was = planned.units[0], now = after.units[0];
  for(const stage of ["STITCHING","MOLDING","PACKING","DISPATCH"]){
    const a = was.stages.find(s => s.stage === stage), b = now.stages.find(s => s.stage === stage);
    trace(`${stage.toLowerCase()} moves`, `${a.start_date} → ${b.start_date}`);
    assert.ok(b.start_date > a.start_date, `${stage} must be pushed`);
  }
  trace("card dispatch moves", `${was.dispatch_date} → ${now.dispatch_date}`);
  assert.ok(now.dispatch_date > was.dispatch_date);
});
test("the screen can say exactly what the entry changed", () => {
  const impact = planImpact(planned, after, ACTUALS);
  trace("recorded", `${impact.pairs_recorded} of ${impact.pairs_planned} planned pairs`);
  trace("behind plan", `${impact.behind_pairs} pairs on ${impact.behind_rows} row`);
  trace("orders whose dispatch moved", String(impact.orders.length));
  trace("buying list", impact.procurement.changed ? "changed" : "unchanged");
  assert.equal(impact.pairs_recorded, 425);
  assert.equal(impact.behind_pairs, 75);
  assert.equal(impact.orders.length, 1);
  assert.equal(impact.orders[0].dispatch_after > impact.orders[0].dispatch_before, true);
  assert.equal(impact.procurement.changed, false,
    "recording production does not change what was ordered");
  assert.ok(impact.stored[0].table === "production_actuals");
});

/* ---- 4. dispatch the 425, with a mixed carton ------------------------ */
console.log("\n4 — dispatching the 425: ten full cartons and one mixed box");
/* 18 to a carton: 23 full cartons is 414 pairs, and the 11 left over travel
   together in one mixed box. */
const SHEET = { customer:"Deiom India", order_no:"JO9500", lines:[{
  article:"SMART BOY (L) BLACK", closure:"VEL", colour:"WHITE", combo:"6X8", groups:[
    { sizes:[{ size:"6", pairs:108 }], cartons:6 },
    { sizes:[{ size:"7", pairs:108 }], cartons:6 },
    { sizes:[{ size:"8", pairs:108 }], cartons:6 },
    { sizes:[{ size:"9", pairs:90  }], cartons:5 },
    { cartons:1, sizes:[{ size:"6", pairs:2 }, { size:"7", pairs:4 },
                        { size:"8", pairs:4 }, { size:"9", pairs:1 }] },
  ]}]};

test("the sheet reconciles against the dispatch, mixed box included", () => {
  const built = buildPackingList({ ...SHEET, dispatch_pairs:425 });
  trace("full cartons", "23");
  trace("mixed carton", "1 — 6×2, 7×4, 8×4, 9×1 = 11 pairs");
  trace("total", `${built.total_pairs} pairs in ${built.total_cartons} cartons`);
  assert.equal(built.total_pairs, 425);
  assert.equal(built.total_cartons, 24);
  assert.deepEqual(built.problems, []);
  const mixed = built.lines[0].groups[4];
  assert.equal(mixed.pairs, 11);
  assert.equal(mixed.cn_from, 24, "the mixed box takes the next carton number");
});
test("the gate pass reads pairs = cartons × std. pac. on every row", () => {
  const built = buildPackingList({ ...SHEET, dispatch_pairs:425 });
  const pass = buildGatePass({ packing_list:built, party:"Deiom India", serial_no:"15941",
    order_qty:1000, packFor:() => 18, mrpFor:() => 549 });
  for(const r of pass.rows)
    trace(`row ${r.sno}: size ${r.size}`,
      `${r.cartons} ctn × ${r.std_pack} = ${r.pairs} pairs${r.mixed ? "  [MIXED " + r.contents + "]" : ""}`);
  assert.deepEqual(pass.problems, [], "the arithmetic must hold on every row");
  assert.equal(pass.total_pairs, 425);
  assert.equal(pass.total_cartons, 24);
  assert.equal(pass.mixed_cartons, 1);
  assert.equal(pass.rows.find(r => r.mixed).std_pack, 11);
});
test("the order book reads 1,000 ordered, 425 dispatched, 575 pending", () => {
  const ledger = buildLedger(after.orders,
    [{ order_no:"JO9500", dispatched:{ "6X8":425 }, dispatched_on:"2026-09-25" }], () => 18);
  const row = ledger.JO9500;
  trace("ordered", `${row.total_ordered} pairs`);
  trace("released on a job card", "500 pairs");
  trace("dispatched", `${row.total_dispatched} pairs`);
  trace("pending", `${row.total_ordered - row.total_dispatched} pairs`);
  assert.equal(row.total_ordered, 1000);
  assert.equal(row.total_dispatched, 425);
  assert.equal(row.rows[0].pending, 575);
  assert.equal(row.closed, false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
