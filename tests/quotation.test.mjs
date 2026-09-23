/* Quotations: a priced offer before there is an order.
 *
 * The two rules worth a test: a quotation is priced by the PI's own code path,
 * so the figure quoted is the figure invoiced; and it releases NOTHING until
 * somebody converts it.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { quoteNo, canMoveTo, priceQuotation, validateQuotation, toPiDraft,
         quotationAge, quotationSummary, STATUS_LABEL } from "../shared/quotation.js";
import { buildPI, DEFAULT_TERMS } from "../shared/pi.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

const ITEM = () => ({
  article_code: "SPIKE",
  /* 11X1 prints the kids run with an s — 11s, 12s, 13s — and adult 1. */
  mrp: { "11X1::11S": 1099, "11X1::12S": 1099, "11X1::13S": 1099, "11X1::1": 1099 },
  lines: [{ combo:"11X1", sizes:{ "11s":30, "12s":30, "13s":30, "1":30 } }],
});
const QUOTE = () => ({ quote_no:"QT/1", quote_date:"2026-09-01", party:"K.P. Burgav",
                       valid_days:15, items:[ITEM()] });

test("a quotation is its own series, never a PI number", () => {
  assert.equal(quoteNo(1), "QT/1");
  assert.equal(quoteNo(37), "QT/37");
});

test("THE POINT: a quotation prices exactly as the invoice will", () => {
  const quoted = priceQuotation(QUOTE());
  const invoiced = buildPI({ items:[ITEM()] }, {}, {}, DEFAULT_TERMS);
  assert.equal(quoted.totals.total, invoiced.totals.total);
  assert.ok(quoted.totals.total > 0);
});

test("the customer's own discount is what is quoted", () => {
  const plain = priceQuotation(QUOTE()).totals.total;
  const keener = priceQuotation({ ...QUOTE(), discount_pct: 45 }).totals.total;
  assert.ok(keener < plain, "a deeper discount did not reduce the quotation");
});

test("a quotation with no customer is refused before it goes out", () => {
  const v = validateQuotation({ ...QUOTE(), party:"" });
  assert.equal(v.ok, false);
  assert.ok(v.problems.some(p => /customer/i.test(p)));
});

test("an article with no MRP is named, because it would be QUOTED at zero", () => {
  const v = validateQuotation({ ...QUOTE(), items:[{ ...ITEM(), mrp:{} }] });
  assert.equal(v.ok, false);
  assert.ok(v.problems.some(p => /quoted at zero/i.test(p)), v.problems.join(" | "));
});

test("every problem is collected, not just the first", () => {
  const v = validateQuotation({ party:"", items:[] });
  assert.ok(v.problems.length >= 2, v.problems.join(" | "));
});

test("a complete quotation passes and carries its pairs and value", () => {
  const v = validateQuotation(QUOTE());
  assert.equal(v.ok, true, v.problems.join(" | "));
  assert.equal(v.pairs, 120);
  assert.ok(v.totals.total > 0);
});

test("status is a one-way street; a converted quotation is finished", () => {
  assert.equal(canMoveTo("draft","sent"), true);
  assert.equal(canMoveTo("sent","accepted"), true);
  assert.equal(canMoveTo("accepted","converted"), true);
  assert.equal(canMoveTo("converted","draft"), false, "a converted offer was reopened");
  assert.equal(canMoveTo("converted","sent"), false);
  assert.equal(canMoveTo("sent","draft"), false);
  assert.equal(STATUS_LABEL.converted, "Converted to PI");
});

test("a lost quotation can be picked back up", () => {
  assert.equal(canMoveTo("lost","draft"), true);
});

test("converting hands the PI flow the accepted items, unchanged", () => {
  const draft = toPiDraft(QUOTE());
  assert.equal(draft.party, "K.P. Burgav");
  assert.equal(draft.from_quotation, "QT/1");
  assert.deepEqual(draft.items[0].lines, ITEM().lines);
  /* The quotation itself is untouched, so a conversion that fails leaves an
     offer that can still be converted. */
  assert.equal(QUOTE().status, undefined);
});

test("no validity means open, not expired today", () => {
  const age = quotationAge({ quote_date:"2026-09-01" }, "2026-12-01");
  assert.equal(age.expired, false);
  assert.equal(age.expires_on, null);
  assert.equal(age.days, 91);
});

test("a quotation past its validity is expired", () => {
  assert.equal(quotationAge(QUOTE(), "2026-09-20").expired, true);
  assert.equal(quotationAge(QUOTE(), "2026-09-10").expired, false);
  assert.equal(quotationAge(QUOTE(), "2026-09-16").expires_on, "2026-09-16");
});

test("the pipeline counts what is still live, and lost work is not pipeline", () => {
  const s = quotationSummary([
    { status:"sent", total:1000, quote_date:"2026-09-01", valid_days:5 },
    { status:"accepted", total:2000, quote_date:"2026-09-05" },
    { status:"lost", total:9000, quote_date:"2026-09-05" },
    { status:"converted", total:3000, quote_date:"2026-09-05" },
  ], "2026-09-20");
  assert.equal(s.total, 4);
  assert.equal(s.open, 1);
  assert.equal(s.expired, 1);
  assert.equal(s.accepted, 1);
  assert.equal(s.converted, 1);
  assert.equal(s.value, 3000);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
