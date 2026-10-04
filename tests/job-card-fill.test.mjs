import assert from "node:assert/strict";
import { jobCardFill, jobIdOfUnit } from "../shared/job-card-fill.js";
import { validateJobCardFields } from "../shared/production-actuals.js";
let passed = 0, failed = 0;
function test(name, fn){ try { fn(); passed++; console.log("  pass  " + name); } catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); } }

console.log("\nJob card filled %");
const jobs = [
  { id:1, issued_on:"2026-09-28", card:{ card_no:"JC1" } },
  { id:2, issued_on:"2026-09-30" },
  { id:3, issued_on:"2026-10-01", cancelled:true },
  { id:4, issued_on:"2026-10-02", sample:true },
  { id:5, issued_on:"2026-09-20" },
];
test("received = cards with a completed-card photo, of the cards issued that week", () => {
  const r = jobCardFill(jobs, [{ job_id:1 }, { job_id:1 }], "2026-09-28", "2026-10-03");
  assert.deepEqual([r.issued, r.received, r.open, r.pct], [2, 1, 1, 50]);
  assert.equal(r.open_cards[0].id, 2);
});
test("cancelled cards and samples do not count; older unreturned cards are still outstanding", () => {
  const r = jobCardFill(jobs, [{ job_id:1 }], "2026-09-28", "2026-10-03");
  assert.equal(r.outstanding, 2, "card 2 this week and card 5 from the week before");
});
test("no card issued is 'no figure', not 0%", () => {
  assert.equal(jobCardFill([], [], "2026-09-28", "2026-10-03").pct, null);
});
test("the job id is read off a plan row's unit key", () => {
  assert.equal(jobIdOfUnit("JO2175#JC12"), 12);
  assert.equal(jobIdOfUnit("JO2175#BAL"), null);
});

console.log("\nJob-card fields recorded with production");
test("rejected and repair are part of the achieved pairs", () => {
  assert.match(validateJobCardFields({ actual_pairs:10, rejected_pairs:6, repair_pairs:5 }).problem, /cannot exceed/);
  assert.deepEqual(validateJobCardFields({ actual_pairs:10, rejected_pairs:2, cartons:"1", supervisor:" Ravi " }).fields,
    { rejected_pairs:2, repair_pairs:0, cartons:1, operators:null, supervisor:"Ravi", shift:null });
});
test("a blank count stays blank, a negative one is refused", () => {
  assert.equal(validateJobCardFields({ actual_pairs:5, operators:"" }).fields.operators, null);
  assert.match(validateJobCardFields({ actual_pairs:5, cartons:-1 }).problem, /Cartons packed/);
});
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
