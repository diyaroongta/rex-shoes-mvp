/* THE FEEDBACK LOOP. The floor reports what it actually made, and tomorrow's
   plan is built from what is genuinely still to make — not from the forecast
   that has already been overtaken. */
import assert from "node:assert/strict";
import { progressFrom, unitProgress, remainingOn } from "../shared/production-progress.js";
import { compute } from "../shared/engine.js";
import { productionUnits } from "../shared/production-units.js";
import { INPUTS } from "../shared/inputs.js";

const { articles, materials, workcenters: wcs, origin } = INPUTS;
let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

console.log("\nA — rolling the daily entries up");
test("achievement is cumulative across days", () => {
  const p = progressFrom([
    { production_on:"2026-07-06", work_center:"CUTTING", stage:"CUTTING", unit_key:"JO1#JC1", actual_pairs:200 },
    { production_on:"2026-07-07", work_center:"CUTTING", stage:"CUTTING", unit_key:"JO1#JC1", actual_pairs:150 },
  ]);
  assert.deepEqual(unitProgress(p, "JO1#JC1", "CUTTING"), { done:350, on:"2026-07-07", entries:2 });
});
test("the date kept is the LAST one recorded, whatever order they arrive in", () => {
  const p = progressFrom([
    { production_on:"2026-07-09", stage:"CUTTING", unit_key:"JO1", actual_pairs:10 },
    { production_on:"2026-07-06", stage:"CUTTING", unit_key:"JO1", actual_pairs:10 },
  ]);
  assert.equal(unitProgress(p, "JO1", "CUTTING").on, "2026-07-09");
});
test("a row with no card falls back to its order, and rubbish is ignored", () => {
  const p = progressFrom([
    { production_on:"2026-07-06", stage:"CUTTING", order_no:"JO2", actual_pairs:90 },
    { production_on:"2026-07-06", stage:"", unit_key:"JO3", actual_pairs:90 },
    { production_on:"2026-07-06", stage:"CUTTING", unit_key:"", actual_pairs:90 },
  ]);
  assert.deepEqual(Object.keys(p), ["JO2"]);
  assert.equal(remainingOn(p, "JO2", "CUTTING", 500), 410);
});
test("over-recording is a keying error, not negative work", () => {
  const p = progressFrom([{ production_on:"2026-07-06", stage:"CUTTING", unit_key:"JO1", actual_pairs:900 }]);
  assert.equal(remainingOn(p, "JO1", "CUTTING", 500), 0);
});

console.log("\nB — the plan that comes back");
const ORDER = { order_no:"JO8001", order_date:"2026-07-06", article_code:"SMART BOY (L) BLACK",
                priority:2, party:"Loop Test", lines:[{ combo:"6X8", qty:1000 }] };
const plain = compute([ORDER], articles, materials, wcs, origin, {});
const cutting = plain.orders[0].stages.find(s => s.stage === "CUTTING");

test("a short day pushes the balance to the NEXT day, not back to the start", () => {
  /* The plan cut the whole 1,000 on its first day. The floor made 850. */
  const short = compute([ORDER], articles, materials, wcs, origin, {
    progress: progressFrom([{ production_on:cutting.start_date, stage:"CUTTING",
                              unit_key:"JO8001", actual_pairs:850 }]) });
  const after = short.orders[0].stages.find(s => s.stage === "CUTTING");
  assert.equal(after.start_date > cutting.start_date, true,
    `the 150 left must be planned after ${cutting.start_date}, got ${after.start_date}`);
  const booked = Object.values(after.alloc).reduce((a,b)=>a+b,0);
  assert.equal(Math.round(booked), 150, "only the balance is planned again");
});
test("everything behind it moves with it", () => {
  const short = compute([ORDER], articles, materials, wcs, origin, {
    progress: progressFrom([{ production_on:cutting.start_date, stage:"CUTTING",
                              unit_key:"JO8001", actual_pairs:850 }]) });
  assert.ok(short.orders[0].dispatch_date > plain.orders[0].dispatch_date,
    `dispatch must move: was ${plain.orders[0].dispatch_date}, now ${short.orders[0].dispatch_date}`);
  const stitching = short.orders[0].stages.find(s => s.stage === "STITCHING");
  const wasStitching = plain.orders[0].stages.find(s => s.stage === "STITCHING");
  assert.ok(stitching.start_date > wasStitching.start_date, "the next stage waits for the balance");
});
test("a stage finished on the floor books no more capacity", () => {
  const done = compute([ORDER], articles, materials, wcs, origin, {
    progress: progressFrom([{ production_on:cutting.start_date, stage:"CUTTING",
                              unit_key:"JO8001", actual_pairs:1000 }]) });
  const after = done.orders[0].stages.find(s => s.stage === "CUTTING");
  assert.equal(after.complete, true);
  assert.deepEqual(after.alloc, {});
  assert.equal(Object.values(done.daily_load.CUTTING||{}).reduce((a,b)=>a+b,0), 0,
    "finished work must leave the machine board");
});
test("recording MORE than planned pulls the order in, and never below zero work", () => {
  const ahead = compute([ORDER], articles, materials, wcs, origin, {
    progress: progressFrom([{ production_on:cutting.start_date, stage:"CUTTING",
                              unit_key:"JO8001", actual_pairs:1200 }]) });
  const after = ahead.orders[0].stages.find(s => s.stage === "CUTTING");
  assert.equal(after.complete, true);
  assert.deepEqual(ahead.schedule_problems, []);
});
test("achievement is matched to the CARD, not to the order", () => {
  const jobs = [
    { id:1, order_no:"JO8001", qty:500, issued_on:"2026-07-06", stage:"STITCHING",
      card:{ card_no:"JC1", date:"2026-07-06", lines:[{ combo:"6X8", qty:500, sizes:{} }] } },
    { id:2, order_no:"JO8001", qty:500, issued_on:"2026-07-06", stage:"STITCHING",
      card:{ card_no:"JC2", date:"2026-07-06", lines:[{ combo:"6X8", qty:500, sizes:{} }] } },
  ];
  const units = productionUnits([ORDER], jobs);
  const base = compute([ORDER], articles, materials, wcs, origin, { units });
  const firstCut = base.units[0].stages.find(s => s.stage === "CUTTING");
  const after = compute([ORDER], articles, materials, wcs, origin, { units,
    progress: progressFrom([{ production_on:firstCut.start_date, stage:"CUTTING",
                              unit_key:"JO8001#JC1", actual_pairs:500 }]) });
  assert.equal(after.units[0].stages.find(s => s.stage === "CUTTING").complete, true);
  assert.notEqual(after.units[1].stages.find(s => s.stage === "CUTTING").complete, true,
    "the second card must not inherit the first card's production");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
