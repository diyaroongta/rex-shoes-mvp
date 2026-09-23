/* Mixed cartons — the box at the end that is not a full one of anything.
   The scenario is the client's own: 50 cartons on the order, 45 packed full in
   ready sizes, and carton 46 made up of what is left. It has to say how many
   pairs are in it and which sizes. */
import assert from "node:assert/strict";
import { splitAtRate, lineBreakdown, suggestMixedCarton, withMixedCarton,
         describeCartons, packingSummary, withSharedCarton, nextCartonLabel,
         sharedCartons } from "../shared/mixed-carton.js";
import { buildPackingList, cartonNumbers } from "../shared/packing-list.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

/* GOLA packs 18 to a carton at these sizes. */
const RATE = { "8":18, "9":18, "10":18, "11":24 };
const rateFor = size => RATE[String(size)] ?? null;

console.log("\nA — what is full, and what is left over");
test("pairs split into whole boxes and a remainder", () => {
  assert.deepEqual(splitAtRate(810, 18), { pairs:810, rate:18, full_cartons:45, loose_pairs:0 });
  assert.deepEqual(splitAtRate(816, 18), { pairs:816, rate:18, full_cartons:45, loose_pairs:6 });
});
test("an unknown rate answers 'I do not know', never zero", () => {
  assert.deepEqual(splitAtRate(100, null), { pairs:100, rate:null, full_cartons:null, loose_pairs:null });
  assert.deepEqual(splitAtRate(100, 0),    { pairs:100, rate:null, full_cartons:null, loose_pairs:null });
});
test("sizes inside one range do not pack alike", () => {
  const line = { groups:[{ sizes:[{size:"10",pairs:20}], cartons:1 },
                         { sizes:[{size:"11",pairs:26}], cartons:1 }] };
  assert.deepEqual(lineBreakdown(line, rateFor).map(r => [r.size, r.rate, r.loose_pairs]),
                   [["10",18,2],["11",24,2]]);
});

console.log("\nB — carton 46");
const line = { article:"REX GOLA (V)", closure:"VEL", colour:"BLK", combo:"8X10",
  groups:[{ sizes:[{size:"8",pairs:288}], cartons:16 },
          { sizes:[{size:"9",pairs:288}], cartons:16 },
          { sizes:[{size:"10",pairs:240}], cartons:13 }] };
test("the leftovers are offered as one carton, with its sizes and its pairs", () => {
  /* 288 = 16 full boxes exactly; 240 = 13 boxes and 6 pairs over. */
  const suggestion = suggestMixedCarton(line, rateFor);
  assert.deepEqual(suggestion, { sizes:[{ size:"10", pairs:6 }], pairs:6 });
});
test("nothing left over means no carton is offered", () => {
  const clean = { groups:[{ sizes:[{size:"8",pairs:288}], cartons:16 }] };
  assert.equal(suggestMixedCarton(clean, rateFor), null);
});
test("carton 46 carries several sizes, its own pairs, and the next number", () => {
  /* 45 full cartons already: 16 + 16 + 13. */
  const before = buildPackingList({ lines:[line] });
  assert.equal(before.total_cartons, 45);

  const sheet = withMixedCarton({ lines:[line] }, 0,
    { sizes:[{ size:"8", pairs:6 }, { size:"9", pairs:6 }] });
  const built = buildPackingList(sheet);
  assert.equal(built.total_cartons, 46);
  assert.equal(built.total_pairs, 816 + 12);

  const mixed = built.lines[0].groups[3];
  assert.equal(mixed.cartons, 1);
  assert.equal(mixed.pairs, 12, "the packer counted 12 pairs into that box");
  assert.equal(mixed.cn_from, 46);
  assert.equal(cartonNumbers(mixed, built.total_cartons), "46/46");
  assert.deepEqual(mixed.sizes.map(s => s.size), ["8","9"]);
});
test("a mixed carton is named as one, and an under-filled single size as a part carton", () => {
  const sheet = withMixedCarton({ lines:[line] }, 0,
    { sizes:[{ size:"8", pairs:6 }, { size:"9", pairs:6 }] });
  const built = buildPackingList(sheet);
  const rows = describeCartons(built.lines[0], rateFor);
  assert.deepEqual(rows.map(r => r.mixed), [false, false, false, true]);
  assert.equal(rows[3].contents, "8 x 6, 9 x 6");
  assert.equal(rows[3].part, true, "a box of two sizes is never a full carton");
  /* 240 pairs in 13 boxes is 18.46 a box — the packer counted them, and the
     standard is 18, so this is NOT reported as a part carton. */
  assert.equal(rows[2].standard_pack, 18);
});
test("an unrated size is not called a part carton on the strength of a guess", () => {
  const odd = { groups:[{ sizes:[{ size:"5.5", pairs:10 }], cartons:1 }] };
  const built = buildPackingList({ lines:[odd] });
  const [row] = describeCartons(built.lines[0], rateFor);
  assert.equal(row.standard_pack, null);
  assert.equal(row.part, false);
});

console.log("\nC — a box holding two different shoes");
const TWO = { lines:[
  { article:"STRIKE", closure:"VEL",  colour:"WHT", groups:[{ sizes:[{ size:"8", pairs:18 }], cartons:1 }] },
  { article:"STRIKE", closure:"LACE", colour:"WHT", groups:[{ sizes:[{ size:"11", pairs:18 }], cartons:1 }] },
]};
test("one box takes sizes from two shoes and is counted once", () => {
  const sheet = withSharedCarton(TWO, [
    { line:0, size:"6", pairs:12 }, { line:0, size:"4", pairs:10 }, { line:1, size:"10", pairs:3 }]);
  const built = buildPackingList(sheet);
  assert.equal(built.total_cartons, 3, "two full boxes and the shared one");
  assert.equal(built.total_pairs, 18 + 18 + 25);
  const [box] = sharedCartons(built);
  assert.equal(box.label, "M1");
  assert.equal(box.cartons, 1);
  assert.equal(box.pairs, 25);
  assert.deepEqual(box.contents.map(c => `${c.closure} ${c.size}x${c.pairs}`),
    ["VEL 6x12","VEL 4x10","LACE 10x3"]);
  assert.deepEqual(built.problems, []);
});
test("each shoe keeps its own pairs, so the order book stays right", () => {
  const built = buildPackingList(withSharedCarton(TWO, [
    { line:0, size:"6", pairs:12 }, { line:1, size:"10", pairs:3 }]));
  assert.equal(built.lines[0].pairs, 30);
  assert.equal(built.lines[1].pairs, 21);
});
test("a second box takes the next label", () => {
  const one = withSharedCarton(TWO, [{ line:0, size:"6", pairs:2 }, { line:1, size:"10", pairs:2 }]);
  assert.equal(nextCartonLabel(one), "M2");
  const two = withSharedCarton(one, [{ line:0, size:"7", pairs:1 }, { line:1, size:"11", pairs:1 }]);
  assert.deepEqual(sharedCartons(buildPackingList(two)).map(b => b.label), ["M1","M2"]);
});
test("nothing usable makes no box at all", () => {
  assert.deepEqual(withSharedCarton(TWO, []), TWO);
  assert.deepEqual(withSharedCarton(TWO, [{ line:9, size:"6", pairs:2 }]), TWO);
  assert.deepEqual(withSharedCarton(TWO, [{ line:0, size:"6", pairs:0 }]), TWO);
});

console.log("\nD — what the dispatcher reads back");
test("the summary counts the boxes, the mixed ones and their pairs", () => {
  const sheet = withMixedCarton({ lines:[line] }, 0,
    { sizes:[{ size:"8", pairs:6 }, { size:"9", pairs:6 }] });
  const built = buildPackingList(sheet);
  assert.deepEqual(packingSummary(built, rateFor),
    { cartons:46, mixed_cartons:1, mixed_pairs:12, part_cartons:0, pairs:828 });
});
test("the sheet still refuses to disagree with the dispatch", () => {
  const sheet = withMixedCarton({ lines:[line] }, 0, { sizes:[{ size:"8", pairs:6 }] });
  const built = buildPackingList({ ...sheet, dispatch_pairs: 816 });
  assert.ok(built.problems.some(p => /822 pairs but the header says 816/.test(p)),
    `expected the mixed carton's pairs to be reconciled, got ${JSON.stringify(built.problems)}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
