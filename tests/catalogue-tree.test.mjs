/* The catalogue as the factory talks about it: the shoe first, then which
   colour of it, then how it fastens. */
import assert from "node:assert/strict";
import { variantOf, catalogueTree, searchTree, filterTree, facetsOf } from "../shared/catalogue-tree.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

/* Names taken off the live article master. */
const ARTICLES = {
  "JACK LACE BLACK-BLUE (BLUE SKINFIT)": { sole_type:"EVA", combos:{ "7X10S":{ rates:{ CUTTING:{ "MESH||MTR":0.06 } } } } },
  "JACK VELCRO BLACK-BLUE":              { sole_type:"EVA", combos:{ "7X10S":{ rates:{ CUTTING:{ "MESH||MTR":0.06 } } } } },
  "JACK LACE N.BLUE":                    { sole_type:"EVA", combos:{ "7X10S":{ rates:{} } } },
  "REX GOLA (V)":                        { sole_type:"PVC", combos:{ "8X10":{ rates:{ CUTTING:{ "REXINE||MTR":0.1 } } } } },
  "REX GOLA (L)":                        { sole_type:"PVC", combos:{ "8X10":{ rates:{ CUTTING:{ "REXINE||MTR":0.1 } } } } },
  "REX GOLA PLUS":                       { sole_type:"PVC", combos:{ "7X10":{ rates:{ CUTTING:{ "REXINE||MTR":0.1 } } } } },
  "SPIKE LACE N.BLUE R.BLUE":            { sole_type:"EVA", section:"MTO", combos:{} },
};

console.log("\nA — one name, three facts");
test("a name splits into shoe, colour and closure", () => {
  assert.deepEqual(variantOf("JACK LACE BLACK-BLUE (BLUE SKINFIT)"),
    { article:"JACK LACE BLACK-BLUE (BLUE SKINFIT)", family:"JACK", note:"Skinfit",
      colour:"BLACK/BLUE", colour_label:"Black / Blue",
      closure:"LACE", closure_label:"Lace" });
});
test("a bracketed note is kept, but does not decide which colour group a shoe is in", () => {
  /* The lace Jack carries "(BLUE SKINFIT)" and the velcro one does not. They
     are the same shoe in the same colour, and the client asked to see exactly
     that pair together. */
  const lace = variantOf("JACK LACE BLACK-BLUE (BLUE SKINFIT)");
  const velcro = variantOf("JACK VELCRO BLACK-BLUE");
  assert.equal(lace.colour, velcro.colour);
  assert.equal(lace.note, "Skinfit");
  assert.equal(velcro.note, "");
});
test("a bracketed (V) is the closure, not part of the name", () => {
  const v = variantOf("REX GOLA (V)");
  assert.equal(v.family, "REX GOLA");
  assert.equal(v.closure_label, "Velcro");
});
test("colours keep the order they were written in", () => {
  /* BLACK-BLUE and BLUE-BLACK are two shoes the factory keeps apart, so
     sorting the words would merge them. */
  assert.equal(variantOf("JACK LACE BLACK-BLUE").colour, "BLACK/BLUE");
  assert.equal(variantOf("JACK LACE BLUE-BLACK").colour, "BLUE/BLACK");
});
test("a shoe with no colour in its name says so rather than showing blank", () => {
  assert.equal(variantOf("REX GOLA PLUS").colour_label, "No colour on record");
});

console.log("\nB — the tree");
const tree = catalogueTree(ARTICLES);
test("families are the level a customer asks about", () => {
  assert.deepEqual(tree.map(f => f.label), ["Jack","Rex Gola","Rex Gola Plus","Spike"]);
  assert.equal(tree[0].variants, 3);
});
test("Gola Plus is its OWN shoe, never a Gola", () => {
  const gola = tree.find(f => f.label === "Rex Gola");
  const plus = tree.find(f => f.label === "Rex Gola Plus");
  assert.equal(gola.variants, 2);
  assert.equal(plus.variants, 1);
});
test("inside a family it groups by colour, and lace/velcro sit under the colour", () => {
  const jack = tree.find(f => f.label === "Jack");
  assert.deepEqual(jack.colours.map(c => c.label), ["Black / Blue","N.blue"]);
  assert.deepEqual(jack.colours[0].variants.map(v => v.closure_label), ["Lace","Velcro"]);
  assert.deepEqual(jack.colours[1].variants.map(v => v.closure_label), ["Lace"],
    "a colour that only comes in lace must not show an empty velcro slot");
});
test("a family says how many of its variants cannot be ordered yet", () => {
  const jack = tree.find(f => f.label === "Jack");
  assert.equal(jack.without_bom, 1);          // JACK LACE N.BLUE has ranges but no rates
  assert.deepEqual(jack.sole_types, ["EVA"]);
});

console.log("\nC — the search bar and the two tab rows");
test("searching narrows on every word, across shoe, colour and closure", () => {
  assert.deepEqual(searchTree(tree, "jack").map(f => f.label), ["Jack"]);
  const velcro = searchTree(tree, "jack velcro");
  assert.equal(velcro[0].variants, 1);
  assert.equal(velcro[0].colours[0].variants[0].article, "JACK VELCRO BLACK-BLUE");
  assert.deepEqual(searchTree(tree, "gola").map(f => f.label), ["Rex Gola","Rex Gola Plus"]);
  assert.deepEqual(searchTree(tree, "zzz"), []);
});
test("an empty search changes nothing", () => {
  assert.equal(searchTree(tree, "   ").length, tree.length);
});
test("material and section are SEPARATE filters, because the catalogue mixes them", () => {
  assert.deepEqual(filterTree(tree, { sole:"PVC" }).map(f => f.label), ["Rex Gola","Rex Gola Plus"]);
  assert.deepEqual(filterTree(tree, { section:"MTO" }).map(f => f.label), ["Spike"]);
  assert.deepEqual(filterTree(tree, { sole:"PVC", section:"MTO" }), []);
});
test("the tabs offered are the ones the data has, and unset sections are counted, not invented", () => {
  const facets = facetsOf(tree);
  assert.deepEqual(facets.soles, ["EVA","PVC"]);
  assert.deepEqual(facets.sections, ["MTO"]);
  assert.equal(facets.unsectioned, 6, "six articles have no section set, and the screen must say so");
  assert.equal(facets.total, 7);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
