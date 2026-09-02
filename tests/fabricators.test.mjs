/* The fabricator master. Run: npm test
 *
 * The rules here are the client's, from the Job Work Module note: internal
 * lines and external job workers live in ONE list separated by a Type, and
 * what each type requires genuinely differs. Every "required" below has a
 * matching test that it is actually refused.
 */
import assert from "node:assert/strict";
import { validateFabricator, payableFor, jobCost, selectableFor,
         DEFAULT_LINES, TYPES, RULES, optionLabel } from "../shared/fabricators.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}
const ok = input => validateFabricator(input);

console.log("\nA — an external fabricator");

test("accepts a complete entry", () => {
  const r = ok({ name:"Shree Shyam Ent.", type:"external", rate:12.5, tat_days:7,
                 contact_person:"Ramesh", contact_phone:"9876543210" });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.value.payable, true, "work leaving the factory is payable");
  assert.equal(r.value.rate, 12.5);
});

test("refuses one with no rate — an invoice will come back for it", () => {
  const r = ok({ name:"Shree Shyam", type:"external", tat_days:7, contact_person:"Ramesh" });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /Rate per piece is required/);
});

test("refuses one with no contact at all", () => {
  const r = ok({ name:"Shree Shyam", type:"external", rate:12, tat_days:7 });
  assert.match(r.problems.join(" "), /contact person or phone/);
});

test("a phone number alone is contact enough", () => {
  const r = ok({ name:"Shree Shyam", type:"external", rate:12, tat_days:7, contact_phone:"9876543210" });
  assert.equal(r.ok, true, r.problems.join("; "));
});

test("rejects a phone number that is not one", () => {
  const r = ok({ name:"S", type:"external", rate:12, tat_days:7, contact_phone:"call me" });
  assert.match(r.problems.join(" "), /does not look like a phone number/);
});

console.log("\nB — an internal line");

test("needs no rate and no contact", () => {
  const r = ok({ name:"Line 2", type:"internal_line", tat_days:2 });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(r.value.rate, 0);
});

/* Money must never attach to the factory's own line: it would put internal
   work into the payables and be invoiced to nobody. */
test("is never payable, whatever the form sends", () => {
  const r = ok({ name:"Line 2", type:"internal_line", tat_days:2, payable:true });
  assert.equal(r.value.payable, false);
  assert.equal(payableFor("internal_line", true), false);
});

test("says so when a rate is typed against a line, rather than dropping it quietly", () => {
  const r = ok({ name:"Line 2", type:"internal_line", tat_days:2, rate:5 });
  assert.equal(r.ok, false);
  assert.match(r.problems.join(" "), /internal line has no rate/);
});

console.log("\nC — a sample fabricator");

test("takes a flat charge, not a per-piece rate", () => {
  const r = ok({ name:"Sample Room", type:"sample", rate:500, tat_days:2, contact_person:"Anil" });
  assert.equal(r.ok, true, r.problems.join("; "));
  assert.equal(RULES.sample.rate, "flat");
});

test("needs that charge stated", () => {
  const r = ok({ name:"Sample Room", type:"sample", tat_days:2, contact_person:"Anil" });
  assert.match(r.problems.join(" "), /flat sample charge/);
});

test("may or may not be payable — that one is a choice", () => {
  assert.equal(payableFor("sample", true), true);
  assert.equal(payableFor("sample", false), false);
});

console.log("\nD — rules that apply to everyone");

test("a name and a known type are required", () => {
  assert.match(ok({ type:"external", rate:1, tat_days:1 }).problems.join(" "), /Name is required/);
  assert.match(ok({ name:"X", type:"partner", tat_days:1 }).problems.join(" "), /Type must be one of/);
});

test("turnaround time is required, whole, and sane", () => {
  assert.match(ok({ name:"Line 1", type:"internal_line" }).problems.join(" "), /Turnaround time in days is required/);
  assert.match(ok({ name:"Line 1", type:"internal_line", tat_days:2.5 }).problems.join(" "), /whole number of days/);
  assert.match(ok({ name:"Line 1", type:"internal_line", tat_days:400 }).problems.join(" "), /365 days or fewer/);
});

test("a negative or absurd rate is refused", () => {
  assert.match(ok({ name:"X", type:"external", rate:-1, tat_days:1, contact_phone:"9876543210" }).problems.join(" "), /negative/);
  assert.match(ok({ name:"X", type:"external", rate:999999, tat_days:1, contact_phone:"9876543210" }).problems.join(" "), /looks wrong/);
});

test("whitespace in a name is tidied so the same worker is not entered twice", () => {
  assert.equal(ok({ name:"  Shree   Shyam  ", type:"internal_line", tat_days:1 }).value.name, "Shree Shyam");
});

console.log("\nE — who can be offered work");

const LIST = [
  { name:"Line 1", type:"internal_line", active:true },
  { name:"Shree Shyam", type:"external", active:true },
  { name:"Retired Co", type:"external", active:false },
  { name:"Sample Room", type:"sample", active:true },
];

test("bulk work is offered to lines and external workers, never to samples", () => {
  assert.deepEqual(selectableFor(LIST).map(f=>f.name), ["Line 1","Shree Shyam"]);
});

test("sample work is offered only to the sample fabricator", () => {
  assert.deepEqual(selectableFor(LIST,"sample").map(f=>f.name), ["Sample Room"]);
});

/* Deactivating must not erase history — past job cards have to keep making
   sense — so an inactive worker stays in the list but takes no new work. */
test("an inactive fabricator cannot be given new work", () => {
  assert.ok(!selectableFor(LIST).some(f=>f.name==="Retired Co"));
});

console.log("\nF — what a job costs");

test("external work is rate x pieces", () => {
  assert.deepEqual(jobCost({type:"external",rate:12.5,payable:true}, 912),
                   { payable:true, amount:11400, pieces:912, rate:12.5 });
});

test("an internal line costs nothing, and says so rather than being skipped", () => {
  assert.deepEqual(jobCost({type:"internal_line",rate:0}, 912), { payable:false, amount:0 });
});

test("a sample charge is flat, not multiplied by the pieces", () => {
  const c = jobCost({type:"sample",rate:500,payable:true}, 6);
  assert.equal(c.amount, 500, "500 for the making, not 500 x 6");
});

test("a sample marked not payable costs nothing", () => {
  assert.equal(jobCost({type:"sample",rate:500,payable:false}, 6).amount, 0);
});

console.log("\nG — the two confirmed starting options");

test("are Rex Internal and New Durga Line, with unknown values left unset", () => {
  assert.deepEqual(DEFAULT_LINES.map(l=>l.name), ["Rex Internal","New Durga Line"]);
  assert.deepEqual(DEFAULT_LINES.map(l=>l.type), ["internal_line","external"]);
  assert.equal(DEFAULT_LINES[0].payable, false);
  assert.equal(DEFAULT_LINES[1].payable, true);
  for(const l of DEFAULT_LINES){
    assert.equal(l.tat_days, 0);
    assert.match(l.note, /still to be entered/i);
  }
});

test("dropdown labels state the two types in brackets",()=>{
  assert.equal(optionLabel(DEFAULT_LINES[0]),"Rex Internal (Internal)");
  assert.equal(optionLabel(DEFAULT_LINES[1]),"New Durga Line (External)");
});

test("every type has a rule set, and every rule set a type", () => {
  assert.deepEqual(Object.keys(RULES).sort(), [...TYPES].sort());
});

console.log(`\n${passed} passed, ${failed} failed\n`);
/* exitCode, not exit(): process.exit() kills the process before V8 flushes
   its coverage file, so a suite that passed reported 0% and dragged the whole
   threshold down. Letting it end naturally keeps both the exit status and the
   coverage. */
process.exitCode = failed ? 1 : 0;
