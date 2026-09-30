/* "What did my entry just do?" — the screen has to be able to answer that
   from the plan itself, including the parts that did NOT move. */
import assert from "node:assert/strict";
import { planImpact, storedRows } from "../shared/input-impact.js";
import { compute } from "../shared/engine.js";
import { progressFrom } from "../shared/production-progress.js";
import { INPUTS } from "../shared/inputs.js";
import { productionUnits } from "../shared/production-units.js";

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

console.log("\nD — a re-plan the dispatch date absorbed is still reported");
/* The client demo, exactly: a 500-pair card, 425 cut on its first day. The
   75 move to the next day and preparation is pushed back — but slack meant
   the card still shipped on the same day, and the panel used to say "No job
   card's own dates moved" over a schedule that had just moved twice. */
{
  const order = { order_no:"JO-DEMO", order_date:"2026-09-01", party:"Demo", article_code:"ARMOUR (LACE)",
                  priority:2, lines:[{ combo:"2X5", qty:1000 }] };
  const card = { order_no:"JO-DEMO", id:1, created_on:"2026-09-10", qty:500,
                 card:{ card_no:"9", lines:[{ combo:"2X5", qty:500, sizes:{ "2":125, "3":125, "4":125, "5":125 } }] } };
  const plan = progress => compute([order], articles, materials, wcs, origin,
                                   { units: productionUnits([order],[card]), progress });
  const was = plan({});
  const job = was.units.find(u => u.unit_kind === "job");
  const cut = job.stages.find(s => s.stage === "CUTTING");
  const planned = Object.values(cut.alloc)[0];
  const saved = [{ production_on:cut.start_date, work_center:cut.work_center, stage:"CUTTING",
                   order_no:"JO-DEMO", unit_key:job.unit_key, planned_pairs:planned,
                   actual_pairs:Math.round(planned*0.85) }];
  const now = plan(progressFrom(saved));
  const impact = planImpact(was, now, saved);
  test("the cutting stage is reported as running a day longer", () => {
    const m = impact.stage_moves.find(s => s.unit_key === job.unit_key && s.stage === "CUTTING");
    assert.ok(m, "cutting's balance moved to the next day");
    assert.ok(m.end_after > m.end_before);
    assert.equal(m.card_no, "9");
  });
  test("and the stage behind it is pushed back, not left overlapping", () => {
    const next = impact.stage_moves.find(s => s.unit_key === job.unit_key && s.stage !== "CUTTING");
    assert.ok(next, "a later stage moved too");
    assert.ok(next.start_after > next.start_before);
  });
  test("so the panel does not claim the card's dates stood still", () => {
    assert.ok(!impact.unchanged.some(u => /job card's own dates/.test(u)));
  });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
