/* Planned against achieved.
 *
 * The rule under test: a row nobody reported is not a row that achieved zero.
 * Counting unreported rows as zeros makes an unfilled sheet look like a
 * stopped factory, which is the same class of lie as calling a forecast an
 * actual.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { planVsActual, biggestGaps } from "../shared/plan-vs-actual.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

const PLANNED = () => [
  { production_on:"2026-04-06", work_center:"CUTTING_1", stage:"CUTTING", order_no:"JO1", unit_key:"JO1", planned_pairs:500 },
  { production_on:"2026-04-06", work_center:"STITCH_1",  stage:"STITCHING", order_no:"JO1", unit_key:"JO1", planned_pairs:400 },
  { production_on:"2026-04-07", work_center:"CUTTING_1", stage:"CUTTING", order_no:"JO2", unit_key:"JO2", planned_pairs:600 },
];
const ACTUALS = () => [
  { production_on:"2026-04-06", work_center:"CUTTING_1", stage:"CUTTING", unit_key:"JO1", actual_pairs:450 },
];

test("achievement is measured against the rows that were REPORTED", () => {
  const a = planVsActual(PLANNED(), ACTUALS());
  assert.equal(a.totals.planned, 1500);
  assert.equal(a.totals.planned_reported, 500);
  assert.equal(a.totals.actual, 450);
  assert.equal(a.totals.pct, 90);
  assert.equal(a.totals.variance, -50);
});

test("an unreported row is counted as missing, never as zero achieved", () => {
  const a = planVsActual(PLANNED(), ACTUALS());
  assert.equal(a.totals.unreported_planned, 1000);
  assert.equal(a.totals.reported_rows, 1);
  assert.equal(a.totals.rows, 3);
  assert.equal(a.totals.coverage, 33.3);
});

test("a day with nothing reported has NO percentage at all", () => {
  const day = planVsActual(PLANNED(), ACTUALS()).days.find(d => d.date === "2026-04-07");
  assert.equal(day.pct, null, "an unreported day was given a score");
  assert.equal(day.actual, 0);
  assert.equal(day.planned, 600);
});

test("days come back in date order", () => {
  assert.deepEqual(planVsActual(PLANNED(), ACTUALS()).days.map(d => d.date),
    ["2026-04-06","2026-04-07"]);
});

test("the financial year's own weeks, not calendar weeks", () => {
  const [week] = planVsActual(PLANNED(), ACTUALS()).weeks;
  /* The Indian financial year opens on 1 April 2026, so 6 April is week 2. */
  assert.equal(week.fy, "2026-27");
  assert.equal(week.label, "FY2026-27 W02");
  assert.equal(week.from, "2026-04-06");
  assert.equal(week.week, 2);
  assert.equal(week.planned, 1500);
  assert.equal(week.actual, 450);
});

test("stage and work centre are analysed separately, biggest plan first", () => {
  const a = planVsActual(PLANNED(), ACTUALS());
  assert.deepEqual(a.stages.map(s => s.stage), ["CUTTING","STITCHING"]);
  assert.equal(a.stages[0].planned, 1100);
  assert.equal(a.stages[0].actual, 450);
  assert.equal(a.stages[1].pct, null);
  assert.deepEqual(a.work_centres.map(w => w.work_center), ["CUTTING_1","STITCH_1"]);
});

test("nothing reported at all is said once, not drawn as a board of blanks", () => {
  const a = planVsActual(PLANNED(), []);
  assert.equal(a.reported, false);
  assert.equal(a.totals.pct, null);
});

test("over-achievement is a positive variance, not an error", () => {
  const a = planVsActual(PLANNED(), [{ production_on:"2026-04-06", work_center:"CUTTING_1",
    stage:"CUTTING", unit_key:"JO1", actual_pairs:560 }]);
  assert.equal(a.totals.variance, 60);
  assert.equal(a.totals.pct, 112);
});

test("the biggest shortfalls come first, and unreported days are not among them", () => {
  const gaps = biggestGaps(planVsActual(PLANNED(), ACTUALS()));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].date, "2026-04-06");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
