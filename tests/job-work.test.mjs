/* Job work — issuing to a line or a fabricator, and getting it back.
   The rules are the client's, from the Job Work Module note. Run: npm test */
import assert from "node:assert/strict";
import { validateIssue, receive, withFabricators, amountFor, slipFor,
         SLIP, SAMPLE_STATUS } from "../shared/job-work.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

const LINE   = { name:"Line 2", type:"internal_line", rate:0, payable:false, active:true };
const EXT    = { name:"Shree Shyam Ent.", type:"external", rate:12.5, payable:true, active:true };
const SAMPLE = { name:"Sample Room", type:"sample", rate:500, payable:true, active:true };

console.log("\nA — one flow, two documents");

/* The note: a Job Work Challan for an external, an Internal Issue Slip for a
   line. Same movement, different piece of paper. */
test("an external gets a Job Work Challan, a line gets an Internal Issue Slip", () => {
  assert.equal(slipFor(EXT), "Job Work Challan");
  assert.equal(slipFor(SAMPLE), "Job Work Challan");
  assert.equal(slipFor(LINE), "Internal Issue Slip");
  assert.equal(SLIP.internal_line, "Internal Issue Slip");
});

test("issuing to a line and to an external is otherwise the same request", () => {
  const a = validateIssue({ article:"SPIKE", qty:600 }, LINE);
  const b = validateIssue({ article:"SPIKE", qty:600 }, EXT);
  assert.equal(a.ok, true, a.problems.join("; "));
  assert.equal(b.ok, true, b.problems.join("; "));
  assert.equal(a.value.qty, b.value.qty);
  assert.notEqual(a.value.slip, b.value.slip);
});

console.log("\nB — what will not be issued");

test("work is not issued to nobody, for nothing, or in no quantity", () => {
  assert.match(validateIssue({ article:"SPIKE", qty:10 }, null).problems.join(" "), /Choose who/);
  assert.match(validateIssue({ qty:10 }, EXT).problems.join(" "), /article or style/);
  assert.match(validateIssue({ article:"SPIKE", qty:0 }, EXT).problems.join(" "), /how many to issue/);
});

test("a deactivated fabricator takes no new work", () => {
  const r = validateIssue({ article:"SPIKE", qty:10 }, { ...EXT, active:false });
  assert.match(r.problems.join(" "), /not active/);
});

/* "Keep a separate Sample Fabricator entry so sample work doesn't mix with
   bulk job work. Quantities are small (1-10 pcs)." */
test("a bulk quantity sent to a sample fabricator is stopped", () => {
  const r = validateIssue({ article:"SPIKE", qty:600 }, SAMPLE);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /samples run 1-10 pieces/);
});

test("a sample-sized quantity to a sample fabricator is fine, and starts pending", () => {
  const r = validateIssue({ article:"SPIKE", qty:6 }, SAMPLE);
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.value.sample, true);
  assert.equal(r.value.sample_status, "pending");
  assert.ok(SAMPLE_STATUS.includes(r.value.sample_status));
});

test("sample work cannot be sent to a bulk fabricator", () => {
  const r = validateIssue({ article:"SPIKE", qty:6, sample:true }, EXT);
  assert.match(r.problems.join(" "), /Only a sample fabricator/);
});

test("a bulk job carries no sample verdict at all", () => {
  assert.equal(validateIssue({ article:"SPIKE", qty:600 }, LINE).value.sample_status, null);
});

console.log("\nC — getting it back");

test("a partial return leaves the balance OUT, not short", () => {
  const r = receive({ qty:600, received:0 }, 400);
  assert.equal(r.ok, true);
  assert.equal(r.received, 400);
  assert.equal(r.outstanding, 200);
  assert.equal(r.shortage, 0, "200 still with the fabricator is not 200 lost");
  assert.equal(r.status, "partial");
});

test("returns accumulate, and the job closes when it is all back", () => {
  const first = receive({ qty:600, received:0 }, 400);
  const second = receive({ qty:600, received:first.received }, 200);
  assert.equal(second.received, 600);
  assert.equal(second.outstanding, 0);
  assert.equal(second.status, "closed");
  assert.equal(second.shortage, 0);
});

/* "System shows shortage if sent and received don't match." */
test("closing short records the shortage", () => {
  const r = receive({ qty:600, received:0 }, 580, { close:true });
  assert.equal(r.received, 580);
  assert.equal(r.shortage, 20);
  assert.equal(r.status, "closed");
});

test("more cannot come back than went out", () => {
  const r = receive({ qty:600, received:500 }, 200);
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /more than was issued/);
});

test("a return of nothing is refused", () => {
  assert.match(receive({ qty:600, received:0 }, 0).problems.join(" "), /how many came back/);
});

console.log("\nD — the money");

/* "If payable (external), amount = rate x quantity. Internal lines skip this
   step — no payment involved." */
test("external work is rate x pieces", () => {
  const m = amountFor({ qty:600, received:600 }, EXT);
  assert.equal(m.payable, true);
  assert.equal(m.amount, 7500);
});

test("an internal line is never payable, and says so rather than being skipped", () => {
  const m = amountFor({ qty:600, received:600 }, LINE);
  assert.equal(m.payable, false);
  assert.equal(m.amount, 0);
  assert.match(m.basis, /no payment/);
});

/* A shortage is not work done. */
test("payment follows what came BACK, not what went out", () => {
  const m = amountFor({ qty:600, received:580 }, EXT);
  assert.equal(m.amount, 580 * 12.5);
});

test("an open job shows what it will cost if it all returns", () => {
  const m = amountFor({ qty:600, received:0 }, EXT);
  assert.equal(m.amount, 600 * 12.5);
});

test("a sample is a flat charge, not multiplied by the pieces", () => {
  const m = amountFor({ qty:6, received:6 }, SAMPLE);
  assert.equal(m.amount, 500);
  assert.match(m.basis, /flat/);
});

console.log("\nE — what is with each fabricator right now");

const JOBS = [
  { fabricator:"Line 2", fabricator_type:"internal_line", qty:600, received:400, status:"partial" },
  { fabricator:"Line 2", fabricator_type:"internal_line", qty:300, received:300, status:"closed" },
  { fabricator:"Shree Shyam Ent.", fabricator_type:"external", qty:900, received:0, status:"issued" },
  { fabricator:"Shree Shyam Ent.", fabricator_type:"external", qty:100, received:80, shortage:20, status:"closed" },
];

test("the bucket counts only what is still out", () => {
  const b = Object.fromEntries(withFabricators(JOBS).map(x => [x.fabricator, x]));
  assert.equal(b["Line 2"].with_them, 200, "600-400 open; the closed job is settled");
  assert.equal(b["Shree Shyam Ent."].with_them, 900);
});

test("a closed job's shortage is remembered even though it is no longer out", () => {
  const b = Object.fromEntries(withFabricators(JOBS).map(x => [x.fabricator, x]));
  assert.equal(b["Shree Shyam Ent."].shortage, 20);
  assert.equal(b["Shree Shyam Ent."].open_jobs, 1);
});

test("the fabricator holding the most work is listed first", () => {
  assert.equal(withFabricators(JOBS)[0].fabricator, "Shree Shyam Ent.");
});

test("an empty register is empty, not an error", () => {
  assert.deepEqual(withFabricators([]), []);
  assert.deepEqual(withFabricators(null), []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
