/* Job-card scheduling — the factory releases an order in BATCHES.
   A 10,000-pair order made as five cards of 2,000 on five different days is
   five pieces of work on the machine board, not one. These tests lock down
   that the split is honest: the batches add up to the order, the material
   demand does not move, and the delivery promise is still measured from the
   ORDER's date rather than from whenever a batch happened to be released. */
import assert from "node:assert/strict";
import { compute, overridesForUnits } from "../shared/engine.js";
import { productionUnits, unitLabel, unitPairs, isoDate } from "../shared/production-units.js";
import { INPUTS } from "../shared/inputs.js";

const { articles, materials, workcenters: wcs, origin } = INPUTS;

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

const ORDER = { order_no:"JO9001", order_date:"2026-07-06", article_code:"SMART BOY (L) BLACK",
                priority:2, party:"Batch Test", lines:[{ combo:"6X8", qty:1000 }] };

const card = (id, on, qty) => ({ id, order_no:"JO9001", article:"SMART BOY (L) BLACK",
  stage:"STITCHING", qty, received:0, shortage:0, status:"issued", issued_on:on,
  card:{ card_no:`JC${id}`, date:on, lines:[{ combo:"6X8", qty, sizes:{} }] } });

const plan = (orders, jobs, opts={}) =>
  compute(orders, articles, materials, wcs, origin,
          { units: productionUnits(orders, jobs), ...opts });

console.log("\nA — splitting an order into what the floor actually releases");
test("an order with no job cards is one unit, keyed by its own order number", () => {
  const units = productionUnits([ORDER], []);
  assert.equal(units.length, 1);
  assert.equal(units[0].unit_key, "JO9001");
  assert.equal(units[0].unit_kind, "order");
  assert.equal(unitPairs(units[0]), 1000);
  assert.equal(unitLabel(units[0]), "Whole order");
});
test("two cards of 200 against a 1,000 order leave a balance of 600", () => {
  const units = productionUnits([ORDER], [card(1,"2026-07-06",200), card(2,"2026-07-20",200)]);
  assert.deepEqual(units.map(u => u.unit_kind), ["job","job","balance"]);
  assert.deepEqual(units.map(unitPairs), [200, 200, 600]);
  /* The units must add up to the order and never more, or procurement buys
     for pairs nobody ordered. */
  assert.equal(units.reduce((a,u)=>a+unitPairs(u), 0), 1000);
  assert.equal(unitLabel(units[2]), "Not yet on a job card");
});
test("a batch is released on its CARD's date, not the order's", () => {
  const units = productionUnits([ORDER], [card(1,"2026-07-06",200), card(2,"2026-07-20",200)]);
  assert.equal(units[0].order_date, "2026-07-06");
  assert.equal(units[1].order_date, "2026-07-20");
  /* The balance has not been released at all, so it keeps the order's date —
     inventing a future date for it would be inventing factory data. */
  assert.equal(units[2].order_date, "2026-07-06");
});
test("a Date object from Postgres is read in local time, not rolled back a day", () => {
  assert.equal(isoDate(new Date(2026, 6, 20)), "2026-07-20");
  assert.equal(isoDate("2026-07-20T00:00:00.000Z"), "2026-07-20");
  assert.equal(isoDate(null), null);
  const units = productionUnits([ORDER], [card(1, new Date(2026, 6, 20), 200)]);
  assert.equal(units[0].order_date, "2026-07-20");
});
test("job work with no size-wise card makes no batch, but still eats the balance", () => {
  const adhoc = { id:9, order_no:"JO9001", article:"SMART BOY (L) BLACK", stage:"STITCHING",
                  qty:400, received:0, shortage:0, status:"issued", issued_on:"2026-07-06", card:null };
  const units = productionUnits([ORDER], [card(1,"2026-07-06",200), adhoc]);
  assert.deepEqual(units.map(u => u.unit_kind), ["job","balance"]);
  assert.equal(unitPairs(units[1]), 400);          // 1000 ordered - 200 carded - 400 ad-hoc
});

console.log("\nB — the plan that comes out of it");
test("a later batch starts later; the order dispatches when its LAST batch does", () => {
  const one = plan([ORDER], [card(1,"2026-07-06",500), card(2,"2026-07-20",500)]);
  const o = one.orders[0];
  assert.equal(o.batch_count, 2);
  assert.equal(o.qty, 1000);
  const [first, second] = o.batches;
  assert.equal(first.release_date, "2026-07-06");
  assert.equal(second.release_date, "2026-07-20");
  assert.ok(second.dispatch_date > first.dispatch_date,
    `second batch should dispatch later, got ${second.dispatch_date} vs ${first.dispatch_date}`);
  assert.equal(o.dispatch_date, second.dispatch_date);
  assert.equal(o.release_date, "2026-07-06");
  /* Cutting for the whole order now spans both batches rather than pretending
     all 1,000 pairs were cut in July. */
  const cutting = o.stages.find(s => s.stage === "CUTTING");
  assert.equal(cutting.start_date, "2026-07-06");
  assert.equal(cutting.batch_count, 2);
  assert.ok(cutting.end_date >= "2026-07-20");
});
test("the machine board books each batch on its own days, not all on day one", () => {
  const whole = compute([ORDER], articles, materials, wcs, origin, {});
  const split = plan([ORDER], [card(1,"2026-07-06",500), card(2,"2026-07-20",500)]);
  const day = iso => Math.round((new Date(iso) - new Date(origin)) / 86400000);
  const cuttingWhole = whole.daily_load.CUTTING || {};
  const cuttingSplit = split.daily_load.CUTTING || {};
  assert.equal(Object.values(cuttingWhole).reduce((a,b)=>a+b,0), 1000);
  assert.equal(Math.round(Object.values(cuttingSplit).reduce((a,b)=>a+b,0)), 1000);
  /* The whole-order plan puts everything in July; the batched plan puts half
     of it on the card released on the 20th. */
  assert.equal(cuttingWhole[day("2026-07-20")], undefined);
  assert.equal(cuttingSplit[day("2026-07-20")], 500);
});
test("material demand does not move when an order is batched (to the paisa)", () => {
  const whole = compute([ORDER], articles, materials, wcs, origin, {});
  const split = plan([ORDER], [card(1,"2026-07-06",500), card(2,"2026-07-20",500)]);
  assert.deepEqual(split.netted, whole.netted);
  assert.equal(split.totals.total_pairs, whole.totals.total_pairs);
  /* Attribution is per batch, but an order's own procurement row still covers
     the whole order. The figures are summed from batches that were each
     rounded to two decimals, so 500 + 500 pairs of thread can land a PAISA
     away from 1,000 pairs of it — asserted as such rather than pretended to be
     exact, because the alternative is a test that passes by rounding away a
     real difference. */
  const a = whole.procurement_by_order.JO9001, b = split.procurement_by_order.JO9001;
  assert.deepEqual(b.materials.map(m => m.material_key), a.materials.map(m => m.material_key));
  for(const m of b.materials){
    const same = a.materials.find(x => x.material_key === m.material_key);
    assert.ok(Math.round(Math.abs(m.required - same.required) * 100) <= 1,
      `${m.material_key}: batched ${m.required} vs whole ${same.required}`);
  }
});
test("a batch released late is LATE — the promise is measured from the order date", () => {
  const late = plan([ORDER], [card(1,"2026-07-06",500), card(2,"2026-09-20",500)]);
  const o = late.orders[0];
  const [first, second] = o.batches;
  assert.equal(first.sla, "on_track");
  assert.equal(second.sla, "breach",
    "a batch released 11 weeks after the order must not reset its own delivery target");
  assert.equal(o.sla, "breach", "an order is as late as its worst batch");
});
test("every batch is listed as its own row for the screens that plan work", () => {
  const split = plan([ORDER], [card(1,"2026-07-06",500), card(2,"2026-07-20",500)]);
  assert.equal(split.units.length, 2);
  assert.equal(split.totals.batches, 2);
  assert.equal(split.batched, true);
  assert.deepEqual(split.units.map(u => u.card_no), ["JC1","JC2"]);
  assert.deepEqual(split.units.map(u => u.order_no), ["JO9001","JO9001"]);
  assert.deepEqual(split.schedule_problems, []);
});

console.log("\nC — overrides survive the move to batches, or say they did not");
test("a stage decision is inherited by every batch; a queue pin is not", () => {
  const units = productionUnits([ORDER], [card(1,"2026-07-06",500), card(2,"2026-07-20",500)]);
  const { overrides, notes } = overridesForUnits(units,
    { JO9001: { days:{ CUTTING:2 }, machine:{ MOLDING:"MOLDING_PVC_VERTICAL" }, seq:1, start_on:"2026-07-01" } });
  assert.deepEqual(Object.keys(overrides), ["JO9001#JC1","JO9001#JC2"]);
  assert.deepEqual(overrides["JO9001#JC1"], { machine:{ MOLDING:"MOLDING_PVC_VERTICAL" }, days:{ CUTTING:2 } });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "override_not_applied");
  assert.match(notes[0].message, /queue position and start date 2026-07-01/);
  assert.match(notes[0].message, /Pin the job card instead/);
});
test("an override pinned to ONE card moves only that card", () => {
  const jobs = [card(1,"2026-07-06",500), card(2,"2026-07-20",500)];
  const pinned = plan([ORDER], jobs, { overrides:{ "JO9001#JC2": { start_on:"2026-07-08" } } });
  const o = pinned.orders[0];
  assert.equal(o.batches[0].release_date, "2026-07-06");
  assert.equal(o.batches.find(b => b.card_no === "JC2").release_date, "2026-07-08");
  assert.ok(o.batches.find(b => b.card_no === "JC2").overridden);
});
test("an order scheduled whole is byte-for-byte what it was before batching existed", () => {
  const before = compute([ORDER], articles, materials, wcs, origin, {});
  const after = plan([ORDER], []);
  const strip = o => { const { batches, batch_count, unit_key, unit_kind, card_no, fabricator, job_id, ...rest } = o; return rest; };
  assert.deepEqual(strip(after.orders[0]), strip(before.orders[0]));
  assert.equal(after.orders[0].batch_count, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
