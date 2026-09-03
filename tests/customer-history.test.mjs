/* What a customer has been given before. Run: npm test */
import assert from "node:assert/strict";
import { customerSummaries, historyFor, priorSupply, pairsOf, variantNote, partyKey, isoDate }
  from "../shared/customer-history.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

/* Shaped like the live orders table: `lines` with exact sizes, the PI blob
   carrying the closure and colours. */
const order = (order_no, party, article_code, pairs, order_date, pi = {}) => ({
  order_no, party, article_code, order_date, pi,
  lines: [{ combo: "6X8", qty: pairs, sizes: { 6: pairs } }],
});

const BOOK = [
  order("JO1", "JTSM", "JACK LACE BLACK-BLUE (BLUE SKINFIT)", 300, "2026-01-10", { vl:"L", upper_colour:"Black-Blue" }),
  order("JO2", "JTSM", "JACK LACE WHITE-RED (RED SKINFIT)",   200, "2026-03-02", { vl:"L", upper_colour:"White-Red" }),
  order("JO3", "JTSM", "SPIKE",                                120, "2026-04-01"),
  order("JO4", "Khandelwal School", "BOLT VELCRO N.BLUE (N.BLUE SKINFIT)", 24, "2026-05-06"),
  order("JO5", "khandelwal school ", "BOLT VELCRO N.BLUE (N.BLUE SKINFIT)", 21, "2026-06-09"),
];

console.log("\nA — pairs, whichever shape the order arrived in");

test("a raw row is summed from its lines, a computed one uses qty", () => {
  assert.equal(pairsOf(BOOK[0]), 300);
  assert.equal(pairsOf({ qty: 750, lines: [] }), 750, "the engine's own total wins when present");
  assert.equal(pairsOf({ lines: [{ sizes: { 6: 10, 7: 5 } }] }), 15, "no qty, no line total — sum the sizes");
  assert.equal(pairsOf({}), 0);
});

console.log("\nB — one customer, however they spelled it");

/* The factory writes "JTSM" and "jtsm " on different slips. A history that
   splits them answers the question wrongly in the most misleading direction
   available: it shows LESS than was actually supplied. */
test("spelling and spacing do not split a customer in two", () => {
  assert.equal(partyKey("Khandelwal School"), partyKey("khandelwal school "));
  const rows = customerSummaries(BOOK);
  assert.equal(rows.length, 2, "two customers, not three");
  const k = rows.find(r => r.key === partyKey("Khandelwal School"));
  assert.equal(k.orders, 2);
  assert.equal(k.pairs, 45, "24 + 21");
});

test("customers are listed most recently ordered first", () => {
  assert.deepEqual(customerSummaries(BOOK).map(r => r.key),
    [partyKey("Khandelwal School"), partyKey("JTSM")]);
});

test("an order with no customer is not a customer", () => {
  assert.equal(customerSummaries([order("JO9", "", "SPIKE", 10, "2026-01-01")]).length, 0);
});

console.log("\nC — the shoe, then the variant of it");

/* The question is asked one level up before it is asked one level down: "have
   they had Jack before?" then "which Jack?". */
test("variants nest under the shoe they are variants of", () => {
  const h = historyFor(BOOK, "JTSM");
  assert.equal(h.orders, 3);
  assert.equal(h.pairs, 620);
  assert.deepEqual(h.families.map(f => f.family), ["JACK", "SPIKE"], "biggest first");
  const jack = h.families[0];
  assert.equal(jack.pairs, 500);
  assert.equal(jack.variants.length, 2, "black-blue and white-red are two variants of one shoe");
  assert.equal(jack.variants[0].article, "JACK LACE BLACK-BLUE (BLUE SKINFIT)", "300 pairs, so first");
});

test("the variant note is what the factory would say, with blanks dropped", () => {
  assert.equal(variantNote(BOOK[0]), "Lace · upper Black-Blue");
  assert.equal(variantNote(BOOK[2]), "", "nothing recorded is not the same as an empty field");
  assert.equal(variantNote({ pi:{ vl:"V", sole_colour:"White" } }), "Velcro · sole White");
});

/* The same article bought once in velcro and once in lace is genuinely two
   different things to send the customer. */
test("one article in two closures is two variants", () => {
  const h = historyFor([
    order("A1", "X", "ARMOUR", 100, "2026-01-01", { vl:"V" }),
    order("A2", "X", "ARMOUR", 50,  "2026-02-01", { vl:"L" }),
  ], "X");
  assert.equal(h.families.length, 1);
  assert.equal(h.families[0].variants.length, 2);
  assert.deepEqual(h.families[0].variants.map(v => v.note), ["Velcro", "Lace"]);
});

test("first and last supplied dates come back per variant", () => {
  const h = historyFor([
    order("B1", "X", "SPIKE", 10, "2026-01-05"),
    order("B2", "X", "SPIKE", 20, "2026-07-09"),
  ], "X");
  const v = h.families[0].variants[0];
  assert.equal(v.first_date, "2026-01-05");
  assert.equal(v.last_date, "2026-07-09");
  assert.equal(v.pairs, 30);
  assert.deepEqual(v.orders.map(o => o.order_no), ["B2","B1"], "most recent order first");
});

test("history covers completed orders too — that is the point of it", () => {
  const withDone = [...BOOK, order("JO0", "JTSM", "SPIKE", 500, "2025-02-02")];
  assert.equal(historyFor(withDone, "JTSM").families.find(f => f.family === "SPIKE").pairs, 620);
});

test("a customer with nothing on the book reads as empty, not as an error", () => {
  const h = historyFor(BOOK, "Nobody");
  assert.equal(h.orders, 0);
  assert.deepEqual(h.families, []);
});

console.log("\nD — the question asked while keying a repeat order");

test("prior supply of one exact article, or null for a first time", () => {
  const seen = priorSupply(BOOK, "JTSM", "JACK LACE BLACK-BLUE (BLUE SKINFIT)");
  assert.equal(seen.pairs, 300);
  assert.equal(seen.last_date, "2026-01-10");
  assert.equal(priorSupply(BOOK, "JTSM", "PERCY"), null, "never supplied — say so rather than show nothing");
  assert.equal(priorSupply(BOOK, "JTSM", ""), null);
});


console.log("\nE — dates as the database actually returns them");

/* Postgres hands `order_date` back as a Date OBJECT. String(date).slice(0,10)
   is "Wed Aug 20", which sorts alphabetically — so the most-recently-ordering
   customer came out wrong and every supplied date was nonsense. */
test("a Date object is read as a date, not as its own text", () => {
  assert.equal(isoDate(new Date(2026, 7, 20)), "2026-08-20");
  assert.equal(isoDate("2026-08-20"), "2026-08-20");
  assert.equal(isoDate("2026-08-20T00:00:00.000Z"), "2026-08-20");
  assert.equal(isoDate(null), "");
  assert.equal(isoDate("not a date"), "");
});

/* A date-only value comes back at LOCAL midnight; toISOString() on that can
   roll back a day and date an order to the day before it was placed. */
test("a local-midnight date does not slip to the previous day", () => {
  assert.equal(isoDate(new Date(2026, 0, 1)), "2026-01-01");
  assert.equal(isoDate(new Date(2026, 11, 31)), "2026-12-31");
});

test("customers sort by recency with real Date objects", () => {
  const rows = customerSummaries([
    { order_no:"D1", party:"Older", article_code:"SPIKE", order_date:new Date(2026,0,5),  lines:[{qty:1}] },
    { order_no:"D2", party:"Newer", article_code:"SPIKE", order_date:new Date(2026,8,20), lines:[{qty:1}] },
  ]);
  assert.deepEqual(rows.map(r => r.party), ["Newer","Older"]);
  assert.equal(rows[0].last_date, "2026-09-20");
});

test("first and last supplied survive Date objects too", () => {
  const h = historyFor([
    { order_no:"E1", party:"X", article_code:"SPIKE", order_date:new Date(2026,0,5),  lines:[{qty:10}] },
    { order_no:"E2", party:"X", article_code:"SPIKE", order_date:new Date(2026,6,9), lines:[{qty:20}] },
  ], "X");
  const v = h.families[0].variants[0];
  assert.equal(v.first_date, "2026-01-05");
  assert.equal(v.last_date, "2026-07-09");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
/* exitCode, not exit(): process.exit() truncates V8's coverage write. */
process.exitCode = failed ? 1 : 0;
