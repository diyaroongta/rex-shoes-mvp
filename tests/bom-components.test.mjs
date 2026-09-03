/* Components on the BOM, checked against the real job card (ARMOUR 17004).
 *
 * The one invariant that must never break: adding components changes NOTHING
 * about what the factory buys. A component is a breakdown of its material, so
 * counting it as demand in its own right would order the rexine once for the
 * sheet and again for every piece cut out of it.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { jobCardIssue, materialTotals, validateComponents,
         componentsOf, hasComponents } from "../shared/bom-components.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

/* One article, one range. CUTTING has a material carrying three cut pieces;
   STITCHING has consumables with no components, as on the real card. */
const ARTICLE = () => ({
  combos: {
    "11X1": {
      rates: {
        CUTTING:   { "ARMOR REXION||MTR": 0.08, "TOE PUFF 0.8MM||SHEET": 0.006 },
        STITCHING: { "THREAD 3 PLY||SPOOL": 0.037, "SIZE LABEL||PCS": 2 },
      },
      components: {
        CUTTING: {
          "ARMOR REXION||MTR": [
            { name:"VAMP", per_pair:2, uom:"PCS" },
            { name:"ADDI", per_pair:4, uom:"PCS" },
            { name:"PALTA", per_pair:2, uom:"PCS" },
          ],
          "TOE PUFF 0.8MM||SHEET": [ { name:"TOE PUFF", per_pair:2, uom:"PCS" } ],
        },
      },
    },
  },
});
const LINES = [{ combo:"11X1", qty:912 }];

console.log("\nA — procurement must not move");

test("material totals are identical with and without components", () => {
  const withComponents = materialTotals(LINES, ARTICLE());
  const plain = ARTICLE();
  for(const c of Object.values(plain.combos)) delete c.components;
  assert.deepEqual(materialTotals(LINES, plain), withComponents,
    "components are a breakdown, never extra demand");
});

test("a material is counted once, not once per component cut from it", () => {
  const t = materialTotals(LINES, ARTICLE());
  // 0.08/pair x 912 = 72.96, regardless of the three pieces cut from it.
  assert.equal(t["ARMOR REXION||MTR"], 72.96);
});

console.log("\nB — the job card, component-wise");

test("cutting lists COMPONENTS, in the job card's own pieces-per-pair", () => {
  const { stages } = jobCardIssue(LINES, ARTICLE());
  const cutting = stages.find(s => s.stage === "CUTTING");
  assert.equal(cutting.from_components, true);
  const by = Object.fromEntries(cutting.issued.map(c => [c.name, c.qty]));
  assert.equal(by.VAMP, 1824, "2 per pair over 912 pairs");
  assert.equal(by.ADDI, 3648, "4 per pair");
  assert.equal(by.PALTA, 1824);
  assert.equal(by["TOE PUFF"], 1824);
});

test("stitching has no components, so it lists MATERIALS — as the card does", () => {
  const { stages } = jobCardIssue(LINES, ARTICLE());
  const st = stages.find(s => s.stage === "STITCHING");
  assert.equal(st.from_components, false);
  const by = Object.fromEntries(st.issued.map(m => [m.name, m.qty]));
  assert.equal(by["SIZE LABEL"], 1824, "2 per pair, exactly as printed");
  assert.ok(Math.abs(by["THREAD 3 PLY"] - 33.744) < 0.001);
});

test("a component records which material it is cut from", () => {
  const { stages } = jobCardIssue(LINES, ARTICLE());
  const vamp = stages.find(s=>s.stage==="CUTTING").issued.find(c => c.name === "VAMP");
  assert.deepEqual(vamp.materials, ["ARMOR REXION||MTR"],
    "the store issues the material; the card names the piece");
});

test("the same component name cut from two materials is added together once", () => {
  const a = ARTICLE();
  a.combos["11X1"].components.CUTTING["TOE PUFF 0.8MM||SHEET"] =
    [{ name:"VAMP", per_pair:1, uom:"PCS" }];
  const vamp = jobCardIssue(LINES, a).stages
    .find(s=>s.stage==="CUTTING").issued.find(c => c.name === "VAMP");
  assert.equal(vamp.qty, 912 * 2 + 912 * 1, "one line on the card, both sources");
  assert.equal(vamp.materials.length, 2);
});

test("stages come out in production order, cutting before stitching", () => {
  const { stages } = jobCardIssue(LINES, ARTICLE());
  assert.deepEqual(stages.map(s => s.stage), ["CUTTING","STITCHING"]);
});

test("several size ranges on one card are summed per component", () => {
  const a = ARTICLE();
  a.combos["2X5"] = JSON.parse(JSON.stringify(a.combos["11X1"]));
  const { stages } = jobCardIssue([{combo:"11X1",qty:400},{combo:"2X5",qty:512}], a);
  const vamp = stages.find(s=>s.stage==="CUTTING").issued.find(c=>c.name==="VAMP");
  assert.equal(vamp.qty, 1824, "400 + 512 = 912 pairs at 2 per pair");
});

console.log("\nC — missing data is reported, never invented");

test("a cutting material with no components is named rather than dropped", () => {
  const a = ARTICLE();
  delete a.combos["11X1"].components.CUTTING["TOE PUFF 0.8MM||SHEET"];
  const out = jobCardIssue(LINES, a);
  assert.deepEqual(out.missing_components, ["TOE PUFF 0.8MM||SHEET"]);
});

test("a stage with no component data at all falls back to materials, not to blank", () => {
  const plain = ARTICLE();
  for(const c of Object.values(plain.combos)) delete c.components;
  const cutting = jobCardIssue(LINES, plain).stages.find(s => s.stage === "CUTTING");
  assert.equal(cutting.from_components, false);
  assert.ok(cutting.issued.length > 0, "an empty cutting list would read as nothing to cut");
});

console.log("\nD — what the BOM will not accept");

test("components against a material that is not on that stage are refused", () => {
  const a = ARTICLE();
  a.combos["11X1"].components.CUTTING["NOT A MATERIAL||MTR"] = [{name:"X", per_pair:1}];
  assert.match(validateComponents(a).join(" "), /not a material on that stage/);
});

test("a component with no consumption at all is refused", () => {
  const a = ARTICLE();
  a.combos["11X1"].components.CUTTING["ARMOR REXION||MTR"].push({ name:"NEW PIECE" });
  assert.match(validateComponents(a).join(" "), /needs a consumption per pair/);
});

/* Zero is legitimate — the workbook's RING STRIP is cut from rexine already
   being bought for the other pieces. */
test("a component at zero is accepted", () => {
  const a = ARTICLE();
  a.combos["11X1"].components.CUTTING["ARMOR REXION||MTR"].push({ name:"RING STRIP", per_pair:0 });
  assert.deepEqual(validateComponents(a), []);
});

test("a component with no name is refused", () => {
  const a = ARTICLE();
  a.combos["11X1"].components.CUTTING["ARMOR REXION||MTR"].push({ per_pair:2 });
  assert.match(validateComponents(a).join(" "), /has no name/);
});

test("a clean BOM reports no problems", () => {
  assert.deepEqual(validateComponents(ARTICLE()), []);
});

console.log("\nE — helpers");

test("componentsOf and hasComponents read the stored shape", () => {
  assert.equal(componentsOf(ARTICLE(), "11X1", "CUTTING")["ARMOR REXION||MTR"].length, 3);
  assert.equal(hasComponents(ARTICLE()), true);
  const plain = ARTICLE();
  for(const c of Object.values(plain.combos)) delete c.components;
  assert.equal(hasComponents(plain), false);
});


console.log("\nZ — the card prints the BOM's order, not the alphabet");

/* The factory's ARMOUR 17004 card reads VAMP, ADDI, PALTA, U TAPE, TOE PUFF,
   SIDE PATTI … — the order the pieces are CUT in, which is the order the
   workbook lists them. Sorting by name reshuffled that to ADDI, CALLER FOAM,
   PALTA … and the cutter working down the sheet loses the sequence. */
test("component rows keep the order the BOM listed them in", () => {
  const M = 'REXINE 54" BROWN||MTR';
  const order = ["VAMP","ADDI","PALTA","U TAPE","TOE PUFF","SIDE PATTI","VAMP ASTER",
                 "SKINFIT","R TOUNGE","TOUNGE ASTER","CALLER FOAM","TOUNGE FOAM",
                 "STIFFNER","VELCO PATTI"];
  const article = { combos: { "6X8": {
    rates: { CUTTING: { [M]: 0.5 } },
    components: { CUTTING: { [M]: order.map(name => ({ name, uom:"PCS", per_pair: 2 })) } },
  } } };
  const { stages } = jobCardIssue([{ combo:"6X8", qty:912 }], article);
  const cutting = stages.find(s => s.stage === "CUTTING");
  assert.deepEqual(cutting.components.map(c => c.name), order,
    "alphabetical order would put ADDI first and VAMP thirteenth");
  assert.equal(cutting.components[0].qty, 1824, "912 pairs x 2 per pair, as on the sample card");
});

/* Two materials, so the second material's pieces follow the first's rather
   than interleaving by name. */
test("pieces from a second material follow, they do not interleave", () => {
  const A = "MESH 58 WHITE||MTR", B = "REXINE 54||MTR";
  const article = { combos: { "6X8": {
    rates: { CUTTING: { [A]: 0.1, [B]: 0.2 } },
    components: { CUTTING: {
      [A]: [{ name:"VAMP MESH", uom:"PCS", per_pair:2 }],
      [B]: [{ name:"ADDI", uom:"PCS", per_pair:2 }],
    } },
  } } };
  const { stages } = jobCardIssue([{ combo:"6X8", qty:10 }], article);
  assert.deepEqual(stages.find(s=>s.stage==="CUTTING").components.map(c=>c.name),
    ["VAMP MESH","ADDI"]);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
/* exitCode, not exit(): process.exit() kills the process before V8 flushes
   its coverage file, so a suite that passed reported 0% and dragged the whole
   threshold down. Letting it end naturally keeps both the exit status and the
   coverage. */
process.exitCode = failed ? 1 : 0;
