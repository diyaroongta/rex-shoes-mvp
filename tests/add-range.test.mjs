import assert from "node:assert/strict";
import { planAddRange } from "../shared/add-range.js";
let passed = 0, failed = 0;
function test(name, fn){ try { fn(); passed++; console.log("  pass  " + name); } catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); } }
const ref = () => ({ articles:{ "REX GOLA PLUS":{ combo_order:["7X10","6X10B"], combos:{
  "7X10":{ rates:{ CUTTING:{ "REXINE||MTR":0.05 } } },
  "6X10B":{ rates:{ CUTTING:{ "REXINE||MTR":0.07 } }, components:{ CUTTING:{ "REXINE||MTR":{ VAMP:0.04 } } } } } } },
  packing:{ "REX GOLA PLUS":{ "6X10B":18 } }, mrp:{} });

console.log("\nAdding a size range (GOLA PLUS big 11 and 12)");
test("big 11–12 is added with its sizes, rates copied ONLY from the range chosen", () => {
  const r = ref(); const plan = planAddRange(r, { article:"REX GOLA PLUS", combo:"11x12b", copy_from:"6X10B", packing:18 });
  assert.deepEqual(plan.problems, []);
  plan.apply(r);
  const c = r.articles["REX GOLA PLUS"].combos["11X12B"];
  assert.deepEqual(c.size_order, ["11","12"]);
  assert.deepEqual(c.rates, { CUTTING:{ "REXINE||MTR":0.07 } });
  assert.equal(c.rates_copied_from, "6X10B");
  assert.equal(r.packing["REX GOLA PLUS"]["11X12B"], 18);
  assert.equal(r.mrp["REX GOLA PLUS"], undefined, "no MRP typed, none invented");
  assert.ok(plan.warnings.some(w => /No MRP/.test(w)));
  assert.equal(r.articles["REX GOLA PLUS"].combo_order.at(-1), "11X12B");
});
test("the copy is independent of the range it came from", () => {
  const r = ref(); planAddRange(r, { article:"REX GOLA PLUS", combo:"11X12B", copy_from:"6X10B" }).apply(r);
  r.articles["REX GOLA PLUS"].combos["11X12B"].rates.CUTTING["REXINE||MTR"] = 0.09;
  assert.equal(r.articles["REX GOLA PLUS"].combos["6X10B"].rates.CUTTING["REXINE||MTR"], 0.07);
});
test("without a source the range has no rates and says so", () => {
  const plan = planAddRange(ref(), { article:"REX GOLA PLUS", combo:"11X12B" });
  assert.ok(plan.warnings.some(w => /no BOM rates/.test(w)));
});
test("a duplicate range, an unknown source, a bad range and a bad pack are refused", () => {
  assert.match(planAddRange(ref(), { article:"REX GOLA PLUS", combo:"7X10" }).problems[0], /already has/);
  assert.match(planAddRange(ref(), { article:"REX GOLA PLUS", combo:"11X12B", copy_from:"9X9" }).problems[0], /no range 9X9/);
  assert.match(planAddRange(ref(), { article:"REX GOLA PLUS", combo:"big eleven" }).problems[0], /not a size range/);
  assert.match(planAddRange(ref(), { article:"REX GOLA PLUS", combo:"11X12B", packing:2.5 }).problems[0], /Pairs per carton/);
});
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
