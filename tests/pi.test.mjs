/* Proforma Invoice tests. No database, no network.
   The reference case is the real Pawan Marketing invoice PI/596. */
import assert from "node:assert/strict";
import { buildPI, comboSizes, splitQty, inr, DEFAULT_TERMS } from "../shared/pi.js";

let passed = 0, failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
};

/* The order exactly as PI/596 states it. */
const ORDER = {
  order_no:"PI/596", party:"Pawan Marketing", customer_city:"Mumbai",
  order_date:"2026-06-26", article_code:"REX GOLA PLUS",
  lines:[
    { combo:"7X10",  qty:500,  sizes:{ "7s":125,"8s":125,"9s":125,"10s":125 } },
    { combo:"11X1",  qty:750,  sizes:{ "11s":188,"12s":188,"13s":187,"1":187 } },
    { combo:"2X5",   qty:1564, sizes:{ "2":357,"3":357,"4":400,"5":450 } },
    { combo:"6X12B", qty:2200, sizes:{ "6":450,"7":450,"8":450,"9":300,"10":300,"11":125,"12":125 } },
  ],
};
const MRP = { "7X10":679, "11X1":749, "2X5":799, "6X12B":869 };

console.log("\nA — size runs");
test("kids run keeps its s suffix, adult run does not", () => {
  assert.deepEqual(comboSizes("7X10"),  ["7s","8s","9s","10s"]);
  assert.deepEqual(comboSizes("11X1"),  ["11s","12s","13s","1"]);
  assert.deepEqual(comboSizes("2X5"),   ["2","3","4","5"]);
  assert.deepEqual(comboSizes("6X12B"), ["6","7","8","9","10","11","12"]);
  assert.deepEqual(comboSizes("NOPE"),  []);
});

console.log("\nB — quantity split");
test("remainder goes to the earliest sizes", () => {
  assert.deepEqual(splitQty(750, 4), [188,188,187,187]);   // as printed on PI/596
  assert.deepEqual(splitQty(500, 4), [125,125,125,125]);
  assert.equal(splitQty(750,4).reduce((a,b)=>a+b,0), 750, "a split must never lose a pair");
  assert.deepEqual(splitQty(0, 4), [0,0,0,0]);
});

console.log("\nC — PI/596 line by line");
test("all 19 rows match the issued invoice", () => {
  const pi = buildPI(ORDER, {}, MRP);
  assert.equal(pi.lines.length, 19);
  const expect = [
    ["7s",125,679,407,50875],  ["8s",125,679,407,50875],  ["9s",125,679,407,50875],
    ["10s",125,679,407,50875], ["11s",188,749,449,84412], ["12s",188,749,449,84412],
    ["13s",187,749,449,83963], ["1",187,749,449,83963],   ["2",357,799,479,171003],
    ["3",357,799,479,171003],  ["4",400,799,479,191600],  ["5",450,799,479,215550],
    ["6",450,869,521,234450],  ["7",450,869,521,234450],  ["8",450,869,521,234450],
    ["9",300,869,521,156300],  ["10",300,869,521,156300], ["11",125,869,521,65125],
    ["12",125,869,521,65125],
  ];
  expect.forEach(([size,qty,mrp,rate,amount], i) => {
    const l = pi.lines[i];
    assert.equal(l.size, size,     `row ${i+1} size`);
    assert.equal(l.qty, qty,       `row ${i+1} qty`);
    assert.equal(l.mrp, mrp,       `row ${i+1} MRP`);
    assert.equal(l.rate, rate,     `row ${i+1} rate — MRP x 0.60 rounded`);
    assert.equal(l.amount, amount, `row ${i+1} amount`);
  });
  assert.equal(pi.totals.total_qty, 5014, "total pairs on PI/596");
});

console.log("\nD — the deduction ladder");
test("each step applies to the running balance, not the subtotal", () => {
  // Fed the subtotal the original PI states, every downstream figure must match.
  const pi = buildPI({ ...ORDER, lines:[{ combo:"7X10", qty:4, sizes:{"7s":2384731,"8s":0,"9s":0,"10s":0} }] },
                     {}, { "7X10":1 }, { ...DEFAULT_TERMS, discount_pct:0 });
  const t = pi.totals;
  assert.equal(t.subtotal, 2384731);
  assert.deepEqual(t.steps.map(s => s.amount), [47695, 70111, 107906, 107951]);
  assert.deepEqual(t.steps.map(s => s.running), [2337036, 2266925, 2159019, 2266970]);
  assert.equal(t.total, 2266970,             "total on PI/596");
  assert.equal(t.payment.on_order, 1133485,  "50% on order");
  assert.equal(t.payment.on_dispatch, 1133485);
});

console.log("\nE — the subtotal must be the sum of every line");
test("no line is dropped from the subtotal", () => {
  const pi = buildPI(ORDER, {}, MRP);
  const sum = pi.lines.reduce((a,l) => a + l.amount, 0);
  assert.equal(pi.totals.subtotal, sum, "subtotal must equal the sum of the lines");
  assert.equal(sum, 2435606);
  // PI/596 as issued states 2,384,731 — short by exactly the first line.
  assert.equal(sum - 2384731, 50875, "the gap is the 7s line, 125 @ 407");
});

console.log("\nF — missing prices are surfaced, never guessed");
test("an unpriced size range is reported and excluded from money", () => {
  const pi = buildPI(ORDER, {}, { "7X10":679 });      // only one combo priced
  assert.ok(pi.missing.length >= 3, "unpriced combos must be reported");
  assert.equal(pi.totals.subtotal, 500 * 407, "only priced lines contribute");
  assert.equal(pi.totals.total_qty, 5014, "but every pair is still counted");
  for(const l of pi.lines.filter(x => x.combo !== "7X10")){
    assert.equal(l.rate, null);
    assert.equal(l.amount, null);
  }
});

console.log("\nH — multi-article invoices");
test("each article prices from its OWN mrp and keeps its OWN image", () => {
  const pi = buildPI({
    order_no:"PI/MULTI", party:"Multi Co",
    items:[
      { article_code:"A", article_label:"Alpha", image:"IMG-A", mrp:{ "7X10":679 },
        lines:[{ combo:"7X10", qty:400 }] },
      { article_code:"B", article_label:"Beta",  image:"IMG-B", mrp:{ "2X5":999 },
        lines:[{ combo:"2X5", qty:400 }] },
    ],
  });
  assert.equal(pi.groups.length, 2, "one group per article");
  assert.equal(pi.groups[0].image, "IMG-A");
  assert.equal(pi.groups[1].image, "IMG-B", "an article must not inherit another's photo");

  const a = pi.lines.filter(l => l.article_code === "A");
  const b = pi.lines.filter(l => l.article_code === "B");
  assert.ok(a.length && b.length);
  // The regression this guards: B used to be priced off A's MRP table.
  for(const l of a) assert.equal(l.mrp, 679, "Alpha must price from its own MRP");
  for(const l of b) assert.equal(l.mrp, 999, "Beta must NOT inherit Alpha's MRP");
  assert.equal(pi.totals.total_qty, 800, "every pair across both articles is counted");
  assert.equal(pi.totals.subtotal, 4*100*407 + 4*100*599);
});

console.log("\nF2 — pairs can never leave the invoice silently");
/* A lace range prints its sizes 6..9; the default roll calls the same positions
   6s..9s. A line stored with lace sizes but no size_order used to price at zero
   and disappear from the invoice while the planner still loaded every pair. */
test("sizes the range does not name are reported, not dropped", () => {
  const stranded = buildPI(
    { article_code:"ARMOUR", lines:[{ combo:"6X9", qty:400, sizes:{ "6":100,"7":100,"8":100,"9":100 } }] },
    {}, { "6X9":500 });
  assert.equal(stranded.totals.total_qty, 0, "the mismatch really does empty the line");
  assert.ok(stranded.missing.some(m => m.combo === "6X9" && /6, 7, 8, 9/.test(m.why)),
    "and it must be reported on the invoice rather than vanishing");

  // With the article's own printed size list the same line prices in full.
  const ok = buildPI(
    { article_code:"ARMOUR", lines:[{ combo:"6X9", qty:400, size_order:["6","7","8","9"],
      sizes:{ "6":100,"7":100,"8":100,"9":100 } }] },
    {}, { "6X9":500 });
  assert.equal(ok.totals.total_qty, 400);
  assert.equal(ok.missing.length, 0);
});

console.log("\nG — Indian digit grouping");
test("lakh/crore separators", () => {
  assert.equal(inr(2266970), "22,66,970");
  assert.equal(inr(50875), "50,875");
  assert.equal(inr(407), "407");
  assert.equal(inr(0), "0");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
