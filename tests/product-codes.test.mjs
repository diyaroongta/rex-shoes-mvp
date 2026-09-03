/* Product codes — families, numbering, and the stability that makes a code
   worth printing. Run: npm test */
import assert from "node:assert/strict";
import { familyOf, prefixOf, parseCode, assignCodes, families, labelFor }
  from "../shared/product-codes.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

console.log("\nA — which articles are the same product");

/* A closure or a colour says WHICH Jack, not that it is a different product. */
test("closures, colours and bracketed notes drop out of the family", () => {
  assert.equal(familyOf("JACK LACE BLACK-BLUE (BLUE SKINFIT)"), "JACK");
  assert.equal(familyOf("JACK VELCRO WHITE"), "JACK");
  assert.equal(familyOf("BOLT VELCRO WHITE N.BLUE (N.BLUE SKINFIT)"), "BOLT");
  assert.equal(familyOf("ARMOUR (VELCRO)"), "ARMOUR");
  assert.equal(familyOf("ARMOUR (LACE)"), "ARMOUR");
  assert.equal(familyOf("ARMOUR"), "ARMOUR");
});

test("a two-word family stays two words", () => {
  assert.equal(familyOf("SILKY BELLY BLACK"), "SILKY BELLY");
  assert.equal(familyOf("SILKY BELLY WHITE"), "SILKY BELLY");
  assert.equal(familyOf("SMART BOY (L) BLACK"), "SMART BOY");
});

/* REX GOLA and REX GOLA PLUS are different shoes — this project has already
   been bitten once by treating them as the same. */
test("PLUS is part of the name, not a variant marker", () => {
  assert.notEqual(familyOf("REX GOLA PLUS"), familyOf("REX GOLA (V)"));
  assert.equal(familyOf("REX GOLA (V)"), "REX GOLA");
  assert.equal(familyOf("REX GOLA PLUS"), "REX GOLA PLUS");
});

test("a name that is nothing but variant words keeps itself", () => {
  assert.equal(familyOf("BLACK"), "BLACK", "a family of \"\" would sweep unrelated articles together");
});

test("the prefix runs the family's words together", () => {
  assert.equal(prefixOf("SILKY BELLY BLACK"), "SILKYBELLY");
  assert.equal(prefixOf("JACK LACE BLACK-BLUE (BLUE SKINFIT)"), "JACK");
});

console.log("\nB — numbering within a family");

test("eighteen Jacks number JACK01 to JACK18", () => {
  /* Real variant names: closure x colour, which is how the family actually
     spreads out on the shelf. */
  const closures = ["LACE","VELCRO","V"];
  const colours = ["BLACK","WHITE","BLUE","RED","BROWN","BEIGE"];
  const jacks = closures.flatMap(c => colours.map(k => `JACK ${c} ${k}`));
  assert.equal(jacks.length, 18);
  const { codes } = assignCodes(jacks);
  assert.equal(codes[jacks[0]], "JACK01");
  assert.equal(codes[jacks[17]], "JACK18");
  assert.equal(new Set(Object.values(codes)).size, 18, "no two articles share a code");
});

test("each family numbers from 01 independently", () => {
  const { codes } = assignCodes(["ARMOUR (VELCRO)","ARMOUR (LACE)","SPIKE","SILKY BELLY BLACK","SILKY BELLY WHITE"]);
  assert.equal(codes["ARMOUR (VELCRO)"], "ARMOUR01");
  assert.equal(codes["ARMOUR (LACE)"], "ARMOUR02");
  assert.equal(codes["SPIKE"], "SPIKE01");
  assert.equal(codes["SILKY BELLY BLACK"], "SILKYBELLY01");
  assert.equal(codes["SILKY BELLY WHITE"], "SILKYBELLY02");
});

console.log("\nC — stability: a code that is printed must never move");

/* This is the whole point. A code goes on a job card, a PI and a carton. */
test("adding an article never renumbers the ones already coded", () => {
  const first = assignCodes(["ARMOUR (VELCRO)","ARMOUR (LACE)"]);
  const second = assignCodes(
    ["ARMOUR (VELCRO)","ARMOUR BLACK","ARMOUR (LACE)"],   // inserted in the MIDDLE
    first.codes);
  assert.equal(second.codes["ARMOUR (VELCRO)"], "ARMOUR01");
  assert.equal(second.codes["ARMOUR (LACE)"], "ARMOUR02", "kept its number despite the insertion");
  assert.equal(second.codes["ARMOUR BLACK"], "ARMOUR03", "the newcomer takes the next free number");
});

test("only the new codes are reported as assigned", () => {
  const first = assignCodes(["SPIKE"]);
  const second = assignCodes(["SPIKE","SPADE"], first.codes);
  assert.deepEqual(Object.keys(second.assigned), ["SPADE"]);
});

test("a gap left by a deleted article is reused, not skipped forever", () => {
  const { codes } = assignCodes(["ARMOUR (VELCRO)","ARMOUR (LACE)"], { "ARMOUR (LACE)":"ARMOUR02" });
  assert.equal(codes["ARMOUR (LACE)"], "ARMOUR02");
  assert.equal(codes["ARMOUR (VELCRO)"], "ARMOUR01", "01 was free, so it is used");
});

test("two articles claiming one code is reported, not silently resolved", () => {
  const out = assignCodes(["ONE","TWO"], { ONE:"X01", TWO:"X01" });
  assert.equal(out.conflicts.length, 1);
  assert.match(out.conflicts[0], /already used/);
  assert.notEqual(out.codes["TWO"], "X01", "the second is given a fresh code instead");
});

test("running it twice changes nothing the second time", () => {
  const list = ["JACK LACE BLACK","JACK VELCRO WHITE","SPIKE"];
  const first = assignCodes(list);
  const second = assignCodes(list, first.codes);
  assert.deepEqual(second.codes, first.codes);
  assert.deepEqual(second.assigned, {}, "nothing left to assign");
});

console.log("\nD — reading them back");

test("a code parses into its family and number", () => {
  assert.deepEqual(parseCode("JACK07"), { prefix:"JACK", n:7 });
  assert.deepEqual(parseCode("SILKYBELLY12"), { prefix:"SILKYBELLY", n:12 });
  assert.equal(parseCode("JACK"), null);
  assert.equal(parseCode(""), null);
});

test("articles group under their family, in code order", () => {
  const list = ["ARMOUR (LACE)","ARMOUR (VELCRO)","SPIKE"];
  const { codes } = assignCodes(list);
  const grouped = families(list, codes);
  assert.deepEqual(Object.keys(grouped).sort(), ["ARMOUR","SPIKE"]);
  assert.deepEqual(grouped.ARMOUR.map(x=>x.code), ["ARMOUR01","ARMOUR02"]);
});

test("the label leads with the code, because that is what gets said out loud", () => {
  assert.equal(labelFor("SPIKE", { SPIKE:"SPIKE01" }), "SPIKE01 · SPIKE");
  assert.equal(labelFor("SPIKE", {}), "SPIKE", "and falls back to the name when there is no code");
});


console.log("\nE — names off the live article master");

/* Every one of these came from the factory's own reference data, and the last
   two are why this section exists. */
test("the factory's own colour shorthand is a colour", () => {
  assert.equal(familyOf("RAY VELCRO WHITE S.BLUE"), "RAY",
    "S.BLUE is sky blue — left in, a second Ray colour would be a separate family");
  assert.equal(familyOf("X-1 VELCRO N.BLUE S.BLUE (N.BLUE SKINFIT)"), "X 1");
  assert.equal(familyOf("AERO VELCRO N.BLUE WHITE (N.BLUE SKINFIT)"), "AERO");
  assert.equal(familyOf("THUNDER N.BLUE RED (N.BLUE COUNTERN.BLUE SKINFIT)"),
               familyOf("THUNDER"));
});

/* "X1" + "01" = "X101", which reads equally well as X1 no.01 and X10 no.1 —
   so the next run would claim a number that is already on a document. */
test("a family whose prefix ends in a digit still reads back exactly", () => {
  const { codes } = assignCodes(["X-1 VELCRO N.BLUE S.BLUE", "X-1 LACE BLACK"]);
  const first = codes["X-1 VELCRO N.BLUE S.BLUE"];
  assert.equal(first, "X1-01");
  assert.deepEqual(parseCode(first), { prefix:"X1", n:1 }, "not X10 no.1, and not X no.101");
  assert.equal(codes["X-1 LACE BLACK"], "X1-02", "and the second one follows it");
});

test("a hyphenated code is honoured on a later run, like any other", () => {
  const { codes, assigned } = assignCodes(
    ["X-1 VELCRO BLACK", "X-1 LACE WHITE"], { "X-1 VELCRO BLACK": "X1-01" });
  assert.equal(codes["X-1 VELCRO BLACK"], "X1-01", "unmoved");
  assert.equal(codes["X-1 LACE WHITE"], "X1-02", "and 01 is not handed out twice");
  assert.deepEqual(Object.keys(assigned), ["X-1 LACE WHITE"]);
});

test("an ordinary code is unchanged by all this", () => {
  assert.equal(assignCodes(["JACK VELCRO BLACK"]).codes["JACK VELCRO BLACK"], "JACK01");
  assert.deepEqual(parseCode("JACK07"), { prefix:"JACK", n:7 });
});

console.log(`\n${passed} passed, ${failed} failed\n`);
/* exitCode, not exit(): process.exit() truncates V8's coverage write. */
process.exitCode = failed ? 1 : 0;
