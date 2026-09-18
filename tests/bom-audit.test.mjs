import assert from "node:assert/strict";
import { auditArticle, auditBom } from "../shared/bom-audit.js";
import { INPUTS } from "../shared/inputs.js";
import { familyOf } from "../shared/product-codes.js";
import { pairsPerCarton } from "../shared/bridge.js";

const opts = { familyOf, packQty:(article, combo) => pairsPerCarton(article, combo) };
let checks = 0;
const ok = (label, fn) => { fn(); checks++; console.log("  ok  " + label); };

console.log("\nshared/bom-audit.js — what is actually loaded");

/* THE WHOLE POINT: the factory's entry tracker says a row is Done. That
   records that somebody did the work, not that the work arrived intact. */
const audit = auditBom(INPUTS, opts);

ok("counts the master the same way the project's own notes do", () => {
  assert.equal(audit.totals.articles, 14);
  assert.equal(audit.totals.ranges, 71);
  assert.equal(audit.totals.rate_entries, 1237);
});

/* THE SILENT STATE, WHICH IS THE ONE THAT MATTERS.
   REX GOLA PLUS has four size ranges and not one material rate. It schedules
   normally, books machine capacity and requires ZERO material — on the live
   book it carried the two largest orders, 10,015 pairs, and produced no line
   of demand at all. An article the master does not hold is loud; this is not. */
ok("names an article that has ranges but no rates at all", () => {
  const plus = audit.articles.find(a => a.article === "REX GOLA PLUS");
  assert.equal(plus.state, "no_rates");
  assert.equal(plus.ranges, 4);
  assert.equal(plus.rate_entries, 0);
  assert.deepEqual(plus.without_rates, ["7X10","11X1","2X5","6X12B"]);
  assert.equal(audit.totals.no_rates, 1);
});

/* An empty rates object is what an interrupted upload leaves behind. Counting
   it as rated would report the gap as filled. */
ok("an empty rates object is not a rated range", () => {
  const ref = { articles:{ HOLLOW:{ combo_order:["2X5"], combos:{ "2X5":{ rates:{ CUTTING:{} } } } } } };
  const row = auditArticle(ref, "HOLLOW");
  assert.equal(row.state, "no_rates");
  assert.deepEqual(row.without_rates, ["2X5"]);
  assert.equal(row.rate_entries, 0);
});

ok("an article with no size ranges is empty, not silent", () => {
  const row = auditArticle({ articles:{ NEWNAME:{} } }, "NEWNAME");
  assert.equal(row.state, "empty");
  assert.equal(row.ranges, 0);
});

/* Part-loaded is its own state: those ranges price to nothing, the rest are
   fine, and the invoice looks complete either way. */
ok("some ranges rated and some not is partial, and names which", () => {
  const ref = { articles:{ HALF:{ combo_order:["1X3","4X5"], combos:{
    "1X3":{ rates:{ CUTTING:{ "REXINE||MTR":0.5 } } }, "4X5":{ rates:{} } } } } };
  const row = auditArticle(ref, "HALF");
  assert.equal(row.state, "partial");
  assert.equal(row.ranges_rated, 1);
  assert.deepEqual(row.without_rates, ["4X5"]);
});

/* MRP and packing are counted SEPARATELY from rates. Thirteen of fourteen
   articles carry no MRP at all, and letting that colour the rate state would
   paint the whole master red and teach people to ignore it. */
ok("prices and packing are reported apart from material rates", () => {
  const priced = audit.articles.filter(a => a.ranges_priced > 0).map(a => a.article);
  assert.deepEqual(priced, ["REX GOLA PLUS"], "only Gola Plus has an MRP on file");
  const spike = audit.articles.find(a => a.article === "SPIKE");
  assert.equal(spike.state, "rated", "SPIKE's rates are complete");
  assert.equal(spike.ranges_priced, 0, "and it still has no MRP");
  assert.equal(spike.ranges_packed, 5, "its packing rates are inherited and DO resolve");
});

/* The tracker is family-level (GOLA, SPIKE); the master is variant-level. The
   roll-up is what lets one be checked against the other. */
ok("rolls variants up into the family the tracker names", () => {
  const gola = audit.families.find(f => f.family === "REX GOLA");
  assert.deepEqual(gola.articles, ["REX GOLA (L)","REX GOLA (V)"]);
  assert.equal(gola.ranges, 12);
  assert.equal(audit.totals.families, 9);
});

/* Worst wins: one unrated variant among many is still an order that prices to
   nothing, so the family must not read as done. */
ok("a family is only as loaded as its least loaded article", () => {
  const ref = { articles:{
    "JACK ONE":{ combo_order:["1X3"], combos:{ "1X3":{ rates:{ CUTTING:{ "M||MTR":1 } } } } },
    "JACK TWO":{ combo_order:["1X3"], combos:{ "1X3":{ rates:{} } } },
  } };
  const out = auditBom(ref, { familyOf:() => "JACK" });
  assert.equal(out.families.length, 1);
  assert.equal(out.families[0].state, "no_rates", "the rated variant does not cover for the unrated one");
});

ok("an absent reference audits to nothing rather than throwing", () => {
  const out = auditBom(undefined);
  assert.deepEqual(out.articles, []);
  assert.equal(out.totals.articles, 0);
});

console.log(`\n${checks} checks passed`);
