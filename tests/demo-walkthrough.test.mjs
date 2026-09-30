/* THE CLIENT DEMO, END TO END, THROUGH THE REAL MODULES.
 *
 * One order of 1,000 pairs, taken along the exact path the factory walks in
 * the demo. Every step uses the module the app itself uses — no stubs of our
 * own logic — so this fails if the chain breaks anywhere between the PI and
 * the gate pass.
 *
 *   1. an order of 1,000 pairs exists
 *   2. HALF of it is released as a job order; the rest stays visible as owed
 *   3. the card is scheduled on its own date, not the order's
 *   4. 85% of the day's plan is produced; the balance re-plans to the NEXT day
 *      and pushes the work behind it
 *   5. what was made is dispatched — 425 pairs
 *   6. the dispatch goes out as full cartons plus ONE mixed carton
 *   7. the order sheet reads 1,000 ordered / 500 released / 425 dispatched
 */
import assert from "node:assert/strict";
import { compute, dayIndex } from "../shared/engine.js";
import { productionUnits, unitPairs } from "../shared/production-units.js";
import { jobOrderBalance } from "../shared/job-orders.js";
import { progressFrom } from "../shared/production-progress.js";
import { buildLedger } from "../shared/dispatch-ledger.js";
import { buildPackingList, draftFromOrder } from "../shared/packing-list.js";
import { withSharedCarton, packingSummary } from "../shared/mixed-carton.js";
import { INPUTS } from "../shared/inputs.js";
import { setReference, comboSizesForArticle, comboType, pairsPerCarton } from "../shared/bridge.js";

setReference(INPUTS);
let checks = 0;
const ok = (label, fn) => { fn(); checks++; console.log("  ok  " + label); };
console.log("\nThe client demo, end to end");

const ORIGIN  = INPUTS.origin;
const ARTICLE = "ARMOUR (LACE)";
const COMBO   = "2X5";                                  // sizes 2,3,4,5 at 18/carton
const SIZES   = comboSizesForArticle(ARTICLE, COMBO, comboType(ARTICLE, COMBO));
const ORDER_DATE = "2026-09-01";

/* 1 ─ the order: 1,000 pairs. */
const order = {
  order_no:"JO-DEMO", order_date:ORDER_DATE, party:"Bansal Banmala",
  article_code:ARTICLE, priority:2, pi:{ pi_no:"PI/900" },
  lines:[{ combo:COMBO, qty:1000, size_order:SIZES }],
};

ok("the range resolves to its real sizes at the real packing rate", () => {
  assert.deepEqual(SIZES, ["2","3","4","5"]);
  assert.equal(pairsPerCarton(ARTICLE, COMBO), 18);
});

/* 2 ─ release HALF as a job order. */
const card = { order_no:"JO-DEMO", job_id:1, card_no:"JC-001", created_on:"2026-09-10",
  fabricator:"Rex Internal", qty:500, card:{ lines:[{ combo:COMBO, qty:500,
    sizes:{ "2":125, "3":125, "4":125, "5":125 } }] } };

ok("releasing 500 of 1,000 leaves 500 still owed, size by size", () => {
  const bal = jobOrderBalance(order, [card]);
  assert.equal(bal.lines[0].ordered, 1000);
  assert.equal(bal.lines[0].issued, 500);
  assert.equal(bal.lines[0].remaining, 500, "the order sheet still owes the other half");
});

ok("the plan carries two units — the card, and the balance with no card yet", () => {
  const units = productionUnits([order], [card]);
  assert.deepEqual(units.map(u => u.unit_kind).sort(), ["balance","job"]);
  // Before planning, a unit carries its LINES; the planner is what gives it a
  // qty. unitPairs() is the shared way to read it either way.
  assert.equal(unitPairs(units.find(u => u.unit_kind === "job")), 500);
  assert.equal(unitPairs(units.find(u => u.unit_kind === "balance")), 500);
});

/* 3 ─ schedule. The card is planned from ITS OWN date, not the order's. */
const planOf = progress => compute([order], INPUTS.articles, INPUTS.materials, INPUTS.workcenters,
  ORIGIN, { units: productionUnits([order], [card]), progress });

const plan0 = planOf({});
const cardUnit = key => plan0.units.find(u => u.unit_key === key);
const jobKey = plan0.units.find(u => u.unit_kind === "job").unit_key;

ok("the job card is scheduled, and only its 500 pairs occupy the machines", () => {
  const job = cardUnit(jobKey);
  assert.equal(job.qty, 500);
  const cutting = job.stages.find(s => s.stage === "CUTTING");
  assert.ok(cutting && cutting.start_date, "cutting is planned");
  assert.equal(Object.values(cutting.alloc).reduce((a,b)=>a+b,0), 500,
    "the card books exactly its own pairs, not the whole order");
});

/* 4 ─ 85% of the day's plan is made. The balance must move to the NEXT day —
       the work cannot be done again yesterday — and everything behind it
       shifts with it. */
const cutting0 = cardUnit(jobKey).stages.find(s => s.stage === "CUTTING");
const firstDay = cutting0.start_date;
const plannedThatDay = Object.values(cutting0.alloc)[0];
const made = Math.round(plannedThatDay * 0.85);

const plan1 = planOf(progressFrom([
  { unit_key: jobKey, stage:"CUTTING", production_on: firstDay, actual_pairs: made },
]));

ok("85% recorded against the day's plan leaves the balance to make", () => {
  assert.ok(made > 0 && made < plannedThatDay, `made ${made} of ${plannedThatDay}`);
  const cutting1 = plan1.units.find(u => u.unit_key === jobKey).stages.find(s => s.stage === "CUTTING");
  const stillPlanned = Object.values(cutting1.alloc).reduce((a,b)=>a+b,0);
  assert.equal(stillPlanned, 500 - made, "only the shortfall is still to cut");
});

ok("the balance re-plans to the day AFTER the entry, never back onto it", () => {
  const cutting1 = plan1.units.find(u => u.unit_key === jobKey).stages.find(s => s.stage === "CUTTING");
  const days = Object.keys(cutting1.alloc).map(Number).sort((a,b)=>a-b);
  assert.ok(days.length, "there is still work planned");
  assert.ok(days[0] > dayIndex(firstDay, ORIGIN),
    "what was not made today is planned for a later day, not re-planned onto today");
});

ok("and the work behind it is pushed back, not left overlapping", () => {
  const before = cardUnit(jobKey).dispatch_day;
  const after  = plan1.units.find(u => u.unit_key === jobKey).dispatch_day;
  assert.ok(after >= before, `dispatch moved from day ${before} to ${after}`);
});

/* 5, 6 ─ dispatch what was made: 425 pairs, as full cartons plus one mixed. */
const DISPATCHED = 425;
ok("the dispatch draft offers the even split across the range's sizes", () => {
  const draft = draftFromOrder(order, () => SIZES, { [COMBO]: DISPATCHED });
  const pairs = draft.lines[0].groups.map(g => g.sizes[0].pairs);
  assert.deepEqual(pairs, [107,106,106,106], "425 over four sizes, remainder on the earliest");
  assert.equal(pairs.reduce((a,b)=>a+b,0), DISPATCHED, "nothing invented in the rounding");
});

/* The packer's real sheet. 425 pairs at 18 to a carton is 23 full boxes and
   11 pairs over, so the leftovers ride in part-filled boxes — which is exactly
   why the factory's gate pass has a column for writing out what is in them.
   Sizes: 107 + 106 + 106 + 106, five full boxes of each (90), leaving
   17 + 16 + 16 + 16 = 65 pairs to box up. */
const sheet = {
  customer: order.party, order_no: order.order_no, date:"2026-09-20",
  lines:[{ article:ARTICLE, closure:"LACE", colour:"BLACK", combo:COMBO, groups:[
    { sizes:[{ size:"2", pairs:90 }], cartons:5 },
    { sizes:[{ size:"3", pairs:90 }], cartons:5 },
    { sizes:[{ size:"4", pairs:90 }], cartons:5 },
    { sizes:[{ size:"5", pairs:90 }], cartons:5 },          // 360 in 20 full boxes
    { sizes:[{ size:"2", pairs:17 },{ size:"3", pairs:1 }], cartons:1 },
    { sizes:[{ size:"3", pairs:15 },{ size:"4", pairs:3 }], cartons:1 },
    { sizes:[{ size:"4", pairs:13 },{ size:"5", pairs:5 }], cartons:1 },
    { sizes:[{ size:"5", pairs:11 }], cartons:1 },          // 65 in 4 more
  ]}],
};

ok("the packing list totals the 425 pairs and numbers every carton", () => {
  const built = buildPackingList(sheet);
  assert.equal(built.total_pairs, DISPATCHED, "the sheet is exactly what was dispatched");
  assert.equal(built.total_cartons, 24, "20 full boxes and 4 part boxes");
  assert.deepEqual(built.problems || [], [], "the sheet reconciles");
});

ok("the mixed boxes are recognised as mixed and counted as boxes", () => {
  const built = buildPackingList(sheet);
  const summary = packingSummary(built, () => pairsPerCarton(ARTICLE, COMBO));
  assert.equal(summary.mixed_cartons, 3, "three boxes hold more than one size");
  assert.equal(summary.mixed_pairs, 54, "18 + 18 + 18");
});

/* THE CLIENT'S OWN EXAMPLE, exactly as they put it: an order of 3 cartons
   each of sizes 2, 3, 4 and 5; ten full cartons go out, plus ONE mixed box
   holding 2 pairs of size 2, 4 of size 3, 6 of size 4 and 1 of size 5. */
ok("ten full cartons plus one mixed box of 2, 4, 6 and 1", () => {
  const theirs = {
    customer:"Bansal Banmala", order_no:"JO-DEMO-2", date:"2026-09-20",
    lines:[{ article:ARTICLE, closure:"LACE", colour:"BLACK", combo:COMBO, groups:[
      { sizes:[{ size:"2", pairs:54 }], cartons:3 },
      { sizes:[{ size:"3", pairs:54 }], cartons:3 },
      { sizes:[{ size:"4", pairs:54 }], cartons:3 },
      { sizes:[{ size:"5", pairs:18 }], cartons:1 },        // ten full boxes
      { sizes:[{ size:"2", pairs:2 },{ size:"3", pairs:4 },
               { size:"4", pairs:6 },{ size:"5", pairs:1 }], cartons:1 },
    ]}],
  };
  const built = buildPackingList(theirs);
  assert.equal(built.total_cartons, 11, "ten full and one mixed");
  assert.equal(built.total_pairs, 193, "180 in the full boxes, 13 in the mixed one");
  const summary = packingSummary(built, () => pairsPerCarton(ARTICLE, COMBO));
  assert.equal(summary.mixed_cartons, 1);
  assert.equal(summary.mixed_pairs, 13, "2 + 4 + 6 + 1");
  assert.deepEqual(built.problems || [], []);
});

/* 7 ─ the order sheet, which is what the client will be looking at. */
ok("the order sheet reads 1,000 ordered, 500 released, 425 dispatched", () => {
  const ledger = buildLedger([order],
    [{ id:1, order_no:"JO-DEMO", dispatched:{ [COMBO]: DISPATCHED },
       kind:"partial", dispatched_on:"2026-09-20" }],
    () => pairsPerCarton(ARTICLE, COMBO));
  const rec = ledger["JO-DEMO"];
  assert.equal(rec.total_ordered, 1000);
  assert.equal(rec.total_dispatched, DISPATCHED);
  assert.equal(rec.total_pending, 575);
  assert.equal(rec.status, "partial", "not complete, and not closed short");
  assert.equal(jobOrderBalance(order, [card]).lines[0].issued, 500);
});

console.log(`\n${checks} checks passed`);
