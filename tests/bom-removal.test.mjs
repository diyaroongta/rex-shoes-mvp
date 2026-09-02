/* Bulk BOM removal — what would go, and what must not.
   Run: npm test */
import assert from "node:assert/strict";
import { planRemoval, applyRemoval, ordersAtRisk, rateCount } from "../shared/bom-removal.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

/* A small reference document in the real shape: two articles, the first with
   two ranges, one of which has two materials in one stage. */
const REF = () => ({
  articles: {
    "REX GOLA (V)": {
      sole_type: "PVC",
      combo_order: ["11X13", "7X10S"],
      combos: {
        "11X13": { rates: { CUTTING: { "REXINE 54\" BLACK": 0.5, "FOAM 3MM": 0.2 },
                            MOLDING: { "PVC COMPOUND": 0.8 } } },
        "7X10S": { rates: { CUTTING: { "REXINE 54\" BLACK": 0.4 } } },
      },
    },
    "SPIKE": {
      sole_type: "EVA",
      combo_order: ["8X12"],
      combos: { "8X12": { rates: { CUTTING: { "EVA SHEET": 0.9 } } } },
    },
  },
  materials: { "REXINE 54\" BLACK": { stock: 100 }, "FOAM 3MM": { stock: 50 },
               "PVC COMPOUND": { stock: 10 }, "EVA SHEET": { stock: 5 } },
  packing: { "REX GOLA (V)": { "11X13": 18, "7X10S": 24 }, "SPIKE": { "8X12": 12 } },
  mrp:     { "REX GOLA (V)": { "11X13": 749, "7X10S": 679 } },
  packing_singles_exact: { "REX GOLA (V)": { "11X13::12": 24, "7X10S::8S": 18, "9": 20 } },
  packing_singles_by_article: { "REX GOLA (V)": "GOLA" },
});

console.log("\nA — what a selection resolves to");

test("removing a whole article accounts for all its ranges and rates", () => {
  const plan = planRemoval(REF(), { articles: ["SPIKE"] });
  assert.equal(plan.articles.length, 1);
  assert.equal(plan.articles[0].ranges, 1);
  assert.equal(plan.articles[0].rates, 1);
  assert.equal(plan.totals.rates, 1);
});

test("an article name is matched the way the rest of the app matches it", () => {
  const plan = planRemoval(REF(), { articles: ["rex gola (v)"] });
  assert.equal(plan.articles[0].article, "REX GOLA (V)");
});

test("an unknown selection is reported, not thrown, so a batch reports everything at once", () => {
  const plan = planRemoval(REF(), { articles: ["GLAMOUR", "NOPE"], ranges: [{ article:"SPIKE", combo:"9X9" }] });
  assert.equal(plan.errors.length, 3);
  assert.match(plan.errors[0], /GLAMOUR/);
  assert.match(plan.errors[2], /9X9/);
  assert.equal(plan.empty, true, "nothing valid was selected, so nothing would be deleted");
});

console.log("\nB — a higher level absorbs the lower ones");

test("selecting an article and one of its ranges does not count the range twice", () => {
  const plan = planRemoval(REF(), {
    articles: ["REX GOLA (V)"],
    ranges: [{ article:"REX GOLA (V)", combo:"11X13" }],
  });
  assert.equal(plan.ranges.length, 0, "the range is inside the article that is going");
  assert.equal(plan.totals.ranges, 2, "both of the article's ranges, counted once");
  assert.equal(plan.totals.rates, 4);
});

test("selecting a range and a material inside it does not count the material twice", () => {
  const plan = planRemoval(REF(), {
    ranges: [{ article:"REX GOLA (V)", combo:"11X13" }],
    materials: [{ article:"REX GOLA (V)", combo:"11X13", stage:"CUTTING", material:"FOAM 3MM" }],
  });
  assert.equal(plan.materials.length, 0);
  assert.equal(plan.totals.rates, 3, "the range's three rates, once");
});

test("the same selection sent twice is the same plan", () => {
  const twice = planRemoval(REF(), { materials: [
    { article:"SPIKE", combo:"8X12", stage:"CUTTING", material:"EVA SHEET" },
    { article:"SPIKE", combo:"8X12", stage:"CUTTING", material:"EVA SHEET" },
  ]});
  assert.equal(twice.totals.rates, 1);
});

console.log("\nC — a range must never be left empty");

/* An empty range still exists, so orders can still be placed on it — and it
   then books machine capacity while requiring no material at all. */
test("removing the last material in a range removes the range, and says so", () => {
  const plan = planRemoval(REF(), { materials: [
    { article:"REX GOLA (V)", combo:"7X10S", stage:"CUTTING", material:"REXINE 54\" BLACK" },
  ]});
  assert.equal(plan.materials.length, 0, "promoted");
  assert.deepEqual(plan.ranges.map(r => r.combo), ["7X10S"]);
  assert.equal(plan.ranges[0].because_emptied, true, "and it is flagged, not done silently");
  assert.deepEqual(plan.emptied_ranges, [{ article:"REX GOLA (V)", combo:"7X10S" }]);
});

test("removing every range of an article removes the article, and says so", () => {
  const plan = planRemoval(REF(), { ranges: [
    { article:"REX GOLA (V)", combo:"11X13" },
    { article:"REX GOLA (V)", combo:"7X10S" },
  ]});
  assert.deepEqual(plan.articles.map(a => a.article), ["REX GOLA (V)"]);
  assert.equal(plan.articles[0].because_emptied, true);
  assert.deepEqual(plan.emptied_articles, ["REX GOLA (V)"]);
});

test("removing SOME materials from a range leaves the range alone", () => {
  const plan = planRemoval(REF(), { materials: [
    { article:"REX GOLA (V)", combo:"11X13", stage:"CUTTING", material:"FOAM 3MM" },
  ]});
  assert.equal(plan.ranges.length, 0);
  assert.equal(plan.materials.length, 1);
  assert.equal(plan.emptied_ranges.length, 0);
});

console.log("\nD — applying the plan");

test("a removed range takes its packing, MRP and scoped size packing with it", () => {
  const ref = REF();
  applyRemoval(ref, planRemoval(ref, { ranges: [{ article:"REX GOLA (V)", combo:"11X13" }] }));
  assert.equal(ref.articles["REX GOLA (V)"].combos["11X13"], undefined);
  assert.deepEqual(ref.articles["REX GOLA (V)"].combo_order, ["7X10S"], "combo_order is kept in step");
  assert.equal(ref.packing["REX GOLA (V)"]["11X13"], undefined);
  assert.equal(ref.mrp["REX GOLA (V)"]["11X13"], undefined);
  assert.equal(ref.packing_singles_exact["REX GOLA (V)"]["11X13::12"], undefined,
    "a per-size rate scoped to this range goes with the range");
  assert.equal(ref.packing_singles_exact["REX GOLA (V)"]["7X10S::8S"], 18,
    "another range's per-size rate is untouched");
  assert.equal(ref.packing_singles_exact["REX GOLA (V)"]["9"], 20,
    "an unscoped rate is not this range's to delete");
});

test("what was not selected survives untouched", () => {
  const ref = REF();
  applyRemoval(ref, planRemoval(ref, { articles: ["SPIKE"] }));
  assert.equal(ref.articles["SPIKE"], undefined);
  assert.equal(ref.packing["SPIKE"], undefined);
  assert.ok(ref.articles["REX GOLA (V)"], "the other article is untouched");
  assert.equal(rateCount(ref.articles, "REX GOLA (V)", "11X13"), 3);
  assert.equal(ref.materials["EVA SHEET"].stock, 5,
    "materials and their stock are shared, so removing an article never deletes them");
});

test("removing one material leaves the rest of the stage intact", () => {
  const ref = REF();
  applyRemoval(ref, planRemoval(ref, { materials: [
    { article:"REX GOLA (V)", combo:"11X13", stage:"CUTTING", material:"FOAM 3MM" },
  ]}));
  const rates = ref.articles["REX GOLA (V)"].combos["11X13"].rates;
  assert.equal(rates.CUTTING["FOAM 3MM"], undefined);
  assert.equal(rates.CUTTING["REXINE 54\" BLACK"], 0.5);
  assert.equal(rates.MOLDING["PVC COMPOUND"], 0.8);
});

test("a stage emptied of materials is dropped rather than left as an empty shell", () => {
  const ref = REF();
  applyRemoval(ref, planRemoval(ref, { materials: [
    { article:"REX GOLA (V)", combo:"11X13", stage:"MOLDING", material:"PVC COMPOUND" },
  ]}));
  assert.equal(ref.articles["REX GOLA (V)"].combos["11X13"].rates.MOLDING, undefined);
});

console.log("\nE — which live orders it would strand");

const ORDERS = [
  { order_no:"JO1", article_code:"REX GOLA (V)", lines:[{ combo:"11X13", qty:60 }] },
  { order_no:"JO2", article_code:"REX GOLA (V)", lines:[{ combo:"7X10S", qty:24 }] },
  { order_no:"JO3", article_code:"SPIKE",        lines:[{ combo:"8X12",  qty:12 }] },
];

test("an order on a deleted article is named, with the reason", () => {
  const risk = ordersAtRisk(planRemoval(REF(), { articles:["SPIKE"] }), ORDERS);
  assert.equal(risk.length, 1);
  assert.equal(risk[0].order_no, "JO3");
  assert.equal(risk[0].reason, "article");
});

test("an order on a deleted range is named, and orders on other ranges are not", () => {
  const risk = ordersAtRisk(planRemoval(REF(), { ranges:[{ article:"REX GOLA (V)", combo:"11X13" }] }), ORDERS);
  assert.deepEqual(risk.map(r => r.order_no), ["JO1"]);
  assert.equal(risk[0].reason, "range");
  assert.deepEqual(risk[0].combos, ["11X13"]);
});

test("removing only a material strands nothing — the range still exists", () => {
  const risk = ordersAtRisk(planRemoval(REF(), { materials:[
    { article:"REX GOLA (V)", combo:"11X13", stage:"CUTTING", material:"FOAM 3MM" },
  ]}), ORDERS);
  assert.deepEqual(risk, []);
});

test("a removal that empties a range reports the order on it, via the promotion", () => {
  // JO2's only range loses its last material, so the range goes — and JO2 with it.
  const risk = ordersAtRisk(planRemoval(REF(), { materials:[
    { article:"REX GOLA (V)", combo:"7X10S", stage:"CUTTING", material:"REXINE 54\" BLACK" },
  ]}), ORDERS);
  assert.deepEqual(risk.map(r => r.order_no), ["JO2"],
    "the promoted range removal must carry its order risk with it");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
/* exitCode, not exit(): process.exit() kills the process before V8 flushes
   its coverage file, so a suite that passed reported 0% and dragged the whole
   threshold down. Letting it end naturally keeps both the exit status and the
   coverage. */
process.exitCode = failed ? 1 : 0;
