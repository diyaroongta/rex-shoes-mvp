import assert from "node:assert/strict";
import { cartonMix, lineMix, evenAt, spread } from "../shared/carton-mix.js";
import { splitQty } from "../shared/pi.js";

let checks = 0;
const ok = (label, fn) => { fn(); checks++; console.log("  ok  " + label); };
console.log("\nshared/carton-mix.js — what is inside one carton");

/* THE RULE, IN THE FACTORY'S OWN WORDS: a carton of 7X10 holding 24 pairs is
   six each of 7, 8, 9 and 10. */
ok("a carton of 7X10 at 24 is six of each size", () => {
  const mix = cartonMix(["7","8","9","10"], 24);
  assert.equal(mix.even, true);
  assert.equal(mix.per_size, 6);
  assert.deepEqual(mix.sizes, [{size:"7",pairs:6},{size:"8",pairs:6},{size:"9",pairs:6},{size:"10",pairs:6}]);
  assert.equal(mix.sizes.reduce((a,s)=>a+s.pairs,0), 24, "the carton still holds exactly its rate");
});

ok("six sizes in the same 24-pair carton is four of each", () => {
  const mix = cartonMix(["6","7","8","9","10","11"], 24);
  assert.equal(mix.per_size, 4);
  assert.equal(mix.sizes.reduce((a,s)=>a+s.pairs,0), 24);
});

/* THE CASE THE CHART ACTUALLY CONTAINS. 21 of the 71 live ranges do not
   divide: 2X5 is 18 pairs across 4 sizes. Half a pair does not exist, so the
   honest answer is "not even", never 4.5 and never a silent 5,5,4,4 presented
   as the factory's rule. */
ok("a rate that does not divide says so rather than inventing half a pair", () => {
  const mix = cartonMix(["2","3","4","5"], 18);
  assert.equal(mix.even, false);
  assert.equal(mix.per_size, null, "there is no single per-size figure");
  assert.deepEqual(mix.sizes.map(s=>s.pairs), [5,5,4,4]);
  assert.equal(mix.sizes.reduce((a,s)=>a+s.pairs,0), 18, "and the carton is still exactly 18");
});

/* One convention for the remainder, or a range splits one way on the invoice
   and another on the packing list. */
ok("the remainder falls the same way the invoice already splits it", () => {
  assert.deepEqual(spread(18,4), splitQty(18,4));
  assert.deepEqual(spread(750,4), splitQty(750,4));
});

/* A LINE OF TWO CARTONS OF 2X5 *IS* EVEN — 36 pairs, 9 of each. One carton of
   it is not. The two questions have different answers and both are asked. */
ok("two cartons of an uneven range come out even across the line", () => {
  const line = lineMix(["2","3","4","5"], 2, 18);
  assert.equal(line.pairs, 36);
  assert.equal(line.even, true);
  assert.equal(line.per_size, 9);
  assert.deepEqual(line.sizes.map(s=>s.pairs), [9,9,9,9]);
});

ok("three cartons of 7X10 is eighteen of each", () => {
  const line = lineMix(["7","8","9","10"], 3, 24);
  assert.equal(line.pairs, 72);
  assert.equal(line.per_size, 18);
});

ok("names the smallest carton count that divides evenly", () => {
  assert.deepEqual(evenAt(["2","3","4","5"], 18), { cartons:2, pairs:36, per_size:9 });
  assert.deepEqual(evenAt(["6","7","8","9","10"], 18), { cartons:5, pairs:90, per_size:18 });
  assert.deepEqual(evenAt(["7","8","9","10"], 24), { cartons:1, pairs:24, per_size:6 });
});

/* An unknown rate is not a rate of zero, and must not print as one. */
ok("an unknown packing rate answers 'not known', not zero", () => {
  const mix = cartonMix(["7","8"], null);
  assert.equal(mix.known, false);
  assert.equal(mix.rate, null);
  assert.deepEqual(mix.sizes, []);
  assert.equal(evenAt(["7","8"], null), null);
  assert.equal(lineMix(["7","8"], 3, 0).known, false);
});

ok("a range with no sizes, or no cartons, answers rather than throwing", () => {
  assert.equal(cartonMix([], 24).known, false);
  assert.equal(lineMix(["7"], 0, 24).pairs, 0);
  assert.equal(evenAt([], 24), null);
});

console.log(`\n${checks} checks passed`);
