/* Specific-size ordering. No database, no network. */
import assert from "node:assert/strict";
import { sizeCatalog, resolveSize, addSizeToLines } from "../shared/sizes.js";
import { comboSizes } from "../shared/pi.js";
import { singlePackQty, pairsPerCarton, packingRuleSource, matchArticle, setReference } from "../shared/bridge.js";
import { INPUTS } from "../shared/inputs.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
};
const JILL = INPUTS.articles["JILL"];
const PK = INPUTS.packing || {};

console.log("\nA — the S suffix");
test("a range ending in S is the small run, not an empty range", () => {
  // 7X10S used to explode to nothing, hiding the whole range.
  assert.deepEqual(comboSizes("7X10S"), ["7s","8s","9s","10s"]);
  assert.deepEqual(comboSizes("7X10S"), comboSizes("7X10"));
});

console.log("\nA2 — a plain name must not match a longer article name");
test("Gala matches Gola, not Gola Plus", () => {
  // Both contain "gola", but PLUS carries a word the sheet never wrote.
  // Getting this wrong invoices a different product at a different price.
  assert.equal(matchArticle("Gala","Blk"), "REX GOLA (V)");
  assert.equal(matchArticle("Gala (L)","Blk"), "REX GOLA (L)");
  assert.equal(matchArticle("Gala Plus","Blk"), "REX GOLA PLUS", "only an explicit Plus reaches PLUS");
  assert.equal(matchArticle("Gala Plus (V)","Blk"), "REX GOLA PLUS");
});

console.log("\nB — size catalog");
test("every size maps to the range(s) that contain it", () => {
  const cat = sizeCatalog(JILL);
  const by = Object.fromEntries(cat.map(c => [c.size, c.combos]));
  assert.deepEqual(by["6s"], ["6X8"], "a size in one range only");
  assert.ok(by["11s"].includes("11X1") && by["11s"].includes("9X12"),
    "a size can sit in more than one range");
  assert.equal(by["99"], undefined);
});

console.log("\nC — kids sizes carry an s, adult sizes do not");
test("pack quantity resolves for both runs", () => {
  assert.equal(singlePackQty("JILL","8s"), 24, "kids size written with s");
  assert.equal(singlePackQty("JILL","3"), 18, "adult size written bare");
  assert.equal(singlePackQty("JILL","99"), null, "unknown size gives nothing, not a guess");
});
test("SPIKE follows the ARMOUR packing list", () => {
  assert.deepEqual(INPUTS.packing.SPIKE, {
    "7X10S":24, "11X1":24, "2X5":18, "6X8":18, "9X12":18,
  });
  assert.equal(singlePackQty("SPIKE","8s"), 24);
  assert.equal(singlePackQty("SPIKE","3"), 18);
  assert.equal(pairsPerCarton("SPIKE","7X10S"), pairsPerCarton("ARMOUR","7X10S"));
  assert.equal(pairsPerCarton("SPIKE","6X8"), pairsPerCarton("ARMOUR","6X9"));
  assert.deepEqual(packingRuleSource("SPIKE","6X8"), {article:"ARMOUR",combo:"6X9",inherited:true},
    "editing SPIKE must update the corresponding ARMOUR source range");
  assert.deepEqual(packingRuleSource("SPADE","6X7"), {article:"SPADE",combo:"6X7",inherited:false});
});
test("an uploaded exact-size packing rule overrides inherited bands", () => {
  setReference({...INPUTS,
    articles:{...INPUTS.articles,THUNDER:{combo_order:["7X10"],combos:{"7X10":{}}}},
    packing_singles_exact:{THUNDER:{"7":30}},
  });
  assert.equal(singlePackQty("THUNDER","7s"),30);
  setReference(INPUTS);
});

console.log("\nD — resolution reports what it cannot know");
test("an ambiguous size is flagged rather than silently picked", () => {
  const r = resolveSize("JILL", JILL, "11s", PK, singlePackQty);
  assert.equal(r.ambiguous, true);
  assert.deepEqual(r.candidates, ["11X1","9X12"]);
  assert.ok(r.issues.some(i => /confirm which one/.test(i)));
});
test("choosing the range clears the ambiguity", () => {
  const r = resolveSize("JILL", JILL, "8s", PK, singlePackQty, "6X8");
  assert.equal(r.ok, true);
  assert.equal(r.combo, "6X8");
  assert.equal(r.ppc, 24);
  assert.equal(r.issues.length, 0);
});
test("a size outside every range is reported, never guessed", () => {
  const r = resolveSize("JILL", JILL, "99", PK, singlePackQty);
  assert.equal(r.ok, false);
  assert.equal(r.inBom, false);
  assert.equal(r.ppc, null, "no invented pack quantity");
  assert.ok(r.issues.some(i => /no BOM rate/.test(i)));
});

console.log("\nE — adding sizes to an order");
test("a specific size becomes an ordinary line on its borrowed range", () => {
  const one = addSizeToLines([], { combo:"6X8", size:"8s", qty:240 });
  assert.equal(one.length, 1);
  assert.equal(one[0].combo, "6X8", "material comes from the range it borrows");
  assert.deepEqual(one[0].sizes, { "8s":240 });
  assert.equal(one[0].qty, 240);

  const two = addSizeToLines(one, { combo:"6X8", size:"7s", qty:120 });
  assert.equal(two.length, 1, "a second size on the same range merges, not duplicates");
  assert.equal(two[0].qty, 360, "qty must always equal the sum of its sizes");
  assert.deepEqual(two[0].sizes, { "8s":240, "7s":120 });

  const three = addSizeToLines(two, { combo:"2X5", size:"3", qty:60 });
  assert.equal(three.length, 2, "a different range is its own line");
  assert.equal(three[0].qty, 360, "the original line is untouched");
});
test("adding the same size twice accumulates", () => {
  let l = addSizeToLines([], { combo:"6X8", size:"8s", qty:100 });
  l = addSizeToLines(l, { combo:"6X8", size:"8s", qty:50 });
  assert.equal(l[0].sizes["8s"], 150);
  assert.equal(l[0].qty, 150);
});
test("a specific size does not overwrite a whole-range line", () => {
  const lines=addSizeToLines([{combo:"2X5",qty:180,label:"2X5"}],{combo:"2X5",size:"3",qty:18});
  assert.equal(lines.length,2);
  assert.equal(lines[0].qty,180);
  assert.deepEqual(lines[1].sizes,{"3":18});
});
/* A lace range prints 6..9 where the default roll says 6s..9s. Without the
   article's own size list on the line the invoice re-derives the wrong labels,
   matches none of the stored sizes and prices the whole line at zero while the
   planner still loads the pairs. */
test("a specific size carries the article's own printed size list", () => {
  const order=["6","7","8","9"];
  const one=addSizeToLines([],{combo:"6X9",size:"8",qty:240,size_order:order});
  assert.deepEqual(one[0].size_order,order);

  const two=addSizeToLines(one,{combo:"6X9",size:"7",qty:60,size_order:order});
  assert.equal(two.length,1);
  assert.deepEqual(two[0].size_order,order,"merging a second size keeps the list");

  const none=addSizeToLines([],{combo:"6X8",size:"8s",qty:24});
  assert.equal(none[0].size_order,undefined,"callers without a list are unchanged");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
