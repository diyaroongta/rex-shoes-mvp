/* Product codes — families, numbering, and the stability that makes a code
   worth printing. Run: npm test */
import assert from "node:assert/strict";
import { familyOf, prefixOf, prefixCandidates, parseCode, assignCodes, families,
         labelFor, isCurrentShape } from "../shared/product-codes.js";

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

/* TWO characters, because a customer has to write it on an order without
   mistyping it. "REXGOLAPLUS01" is a code nobody copies correctly twice. */
test("the prefix is two characters, taken from the family", () => {
  assert.equal(prefixOf("SILKY BELLY BLACK"), "SB");
  assert.equal(prefixOf("JACK LACE BLACK-BLUE (BLUE SKINFIT)"), "JA");
  assert.equal(prefixOf("JILL VELCRO WHITE-RED (RED SKINFIT)"), "JI",
    "Jack and Jill must not be confusable — the whole point of the code");
});

/* Two characters cannot be unique by construction, so a family takes the best
   candidate still free. The ladder matters: the second choice should still
   LOOK like the product. */
test("the fallback prefix still resembles the product", () => {
  assert.deepEqual(prefixCandidates("SPIKE").slice(0,3), ["SP","SI","SK"]);
  assert.deepEqual(prefixCandidates("REX GOLA PLUS").slice(0,2), ["RG","RP"]);
  assert.equal(prefixCandidates("X 1")[0], "X1");
});

console.log("\nB — numbering within a family");

test("eighteen Jacks number JA001 to JA018", () => {
  /* Real variant names: closure x colour, which is how the family actually
     spreads out on the shelf. */
  const closures = ["LACE","VELCRO","V"];
  const colours = ["BLACK","WHITE","BLUE","RED","BROWN","BEIGE"];
  const jacks = closures.flatMap(c => colours.map(k => `JACK ${c} ${k}`));
  assert.equal(jacks.length, 18);
  const { codes } = assignCodes(jacks);
  assert.equal(codes[jacks[0]], "JA001");
  assert.equal(codes[jacks[17]], "JA018");
  assert.equal(new Set(Object.values(codes)).size, 18, "no two articles share a code");
});

test("each family numbers from 01 independently", () => {
  const { codes } = assignCodes(["ARMOUR (VELCRO)","ARMOUR (LACE)","SPIKE","SILKY BELLY BLACK","SILKY BELLY WHITE"]);
  assert.equal(codes["ARMOUR (VELCRO)"], "AR001");
  assert.equal(codes["ARMOUR (LACE)"], "AR002");
  assert.equal(codes["SPIKE"], "SP001");
  assert.equal(codes["SILKY BELLY BLACK"], "SB001");
  assert.equal(codes["SILKY BELLY WHITE"], "SB002");
});

console.log("\nC — stability: a code that is printed must never move");

/* This is the whole point. A code goes on a job card, a PI and a carton. */
test("adding an article never renumbers the ones already coded", () => {
  const first = assignCodes(["ARMOUR (VELCRO)","ARMOUR (LACE)"]);
  const second = assignCodes(
    ["ARMOUR (VELCRO)","ARMOUR BLACK","ARMOUR (LACE)"],   // inserted in the MIDDLE
    first.codes);
  assert.equal(second.codes["ARMOUR (VELCRO)"], "AR001");
  assert.equal(second.codes["ARMOUR (LACE)"], "AR002", "kept its number despite the insertion");
  assert.equal(second.codes["ARMOUR BLACK"], "AR003", "the newcomer takes the next free number");
});

test("only the new codes are reported as assigned", () => {
  const first = assignCodes(["SPIKE"]);
  const second = assignCodes(["SPIKE","SPADE"], first.codes);
  assert.deepEqual(Object.keys(second.assigned), ["SPADE"]);
});

test("a gap left by a deleted article is reused, not skipped forever", () => {
  const { codes } = assignCodes(["ARMOUR (VELCRO)","ARMOUR (LACE)"], { "ARMOUR (LACE)":"AR002" });
  assert.equal(codes["ARMOUR (LACE)"], "AR002");
  assert.equal(codes["ARMOUR (VELCRO)"], "AR001", "001 was free, so it is used");
});

test("two articles claiming one code is reported, not silently resolved", () => {
  const out = assignCodes(["ONE","TWO"], { ONE:"ON001", TWO:"ON001" });
  assert.equal(out.conflicts.length, 1);
  assert.match(out.conflicts[0], /already used/);
  assert.notEqual(out.codes["TWO"], "ON001", "the second is given a fresh code instead");
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
  assert.deepEqual(parseCode("JA007"), { prefix:"JA", n:7, current:true });
  assert.deepEqual(parseCode("SB012"), { prefix:"SB", n:12, current:true });
  assert.equal(parseCode("JACK"), null);
  assert.equal(parseCode(""), null);
  /* An older code is still recognised, so it can be released and reissued
     rather than duplicated. */
  assert.equal(isCurrentShape("JACK07"), false);
  assert.equal(isCurrentShape("JA007"), true);
});

test("articles group under their family, in code order", () => {
  const list = ["ARMOUR (LACE)","ARMOUR (VELCRO)","SPIKE"];
  const { codes } = assignCodes(list);
  const grouped = families(list, codes);
  assert.deepEqual(Object.keys(grouped).sort(), ["ARMOUR","SPIKE"]);
  assert.deepEqual(grouped.ARMOUR.map(x=>x.code), ["AR001","AR002"]);
});

test("the label leads with the code, because that is what gets said out loud", () => {
  assert.equal(labelFor("SPIKE", { SPIKE:"SP001" }), "SP001 · SPIKE");
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

/* The old variable-width scheme needed a hyphen for X-1, because "X1"+"01"
   read equally well as X10 no.1. A FIXED width settles it by construction:
   two characters then three digits, always, so X1001 can only be X1 no.001. */
test("a prefix ending in a digit needs no separator now", () => {
  const { codes } = assignCodes(["X-1 VELCRO N.BLUE S.BLUE", "X-1 LACE BLACK"]);
  assert.equal(codes["X-1 VELCRO N.BLUE S.BLUE"], "X1001");
  assert.deepEqual(parseCode("X1001"), { prefix:"X1", n:1, current:true },
    "not X10 no.1, and not X no.1001");
  assert.equal(codes["X-1 LACE BLACK"], "X1002");
});

test("every code is exactly five characters", () => {
  const { codes } = assignCodes(["SPIKE","JACK LACE BLACK","REX GOLA PLUS","X-1 VELCRO"]);
  for(const c of Object.values(codes))
    assert.match(c, /^[A-Z][A-Z0-9]\d{3}$/, `${c} is not in the issued shape`);
});

/* A master carrying half AA000 and half REXGOLAPLUS01 is worse than either,
   so a code from the older scheme is recognised, released and reissued. */
test("an older code is reissued, not left alongside the new shape", () => {
  const out = assignCodes(["SPIKE","SPADE"], { SPIKE:"SPIKE01" });
  assert.equal(out.reissued["SPIKE"], "SPIKE01", "reported, not silently dropped");
  assert.match(out.codes["SPIKE"], /^[A-Z][A-Z0-9]\d{3}$/, "reissued in the current shape");
  assert.notEqual(out.codes["SPADE"], out.codes["SPIKE"]);
  /* SPADE sorts first, so it holds SP and SPIKE takes the next candidate that
     still looks like the product. */
  assert.equal(out.codes["SPADE"], "SP001");
  assert.equal(out.codes["SPIKE"], "SI001");
});

/* SPADE and SPIKE both want SP. Whoever holds it keeps it; the other takes the
   next candidate that still looks like the product. */
test("two families wanting one prefix are separated, stably", () => {
  const list = ["SPADE","SPIKE VELCRO BLACK"];
  const first = assignCodes(list);
  assert.equal(first.prefixes["SPADE"], "SP");
  assert.equal(first.prefixes["SPIKE"], "SI");
  const second = assignCodes([...list, "SPIKE LACE WHITE"], first.codes);
  assert.equal(second.codes["SPADE"], first.codes["SPADE"], "nothing already issued moves");
  assert.equal(second.codes["SPIKE VELCRO BLACK"], first.codes["SPIKE VELCRO BLACK"]);
  assert.equal(second.codes["SPIKE LACE WHITE"], "SI002");
});

/* Reading order must not decide the prefixes, or two people running this on the
   same master would hand the factory different codes. */
test("the same master gives the same prefixes whatever order it is read in", () => {
  const list = ["SPIKE","SPADE","SILKY BELLY BLACK","SMART BOY (L) WHITE","REX GOLA (V)","REX GOLA PLUS"];
  const a = assignCodes(list);
  const b = assignCodes([...list].reverse());
  assert.deepEqual(a.prefixes, b.prefixes);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
/* exitCode, not exit(): process.exit() truncates V8's coverage write. */
process.exitCode = failed ? 1 : 0;
