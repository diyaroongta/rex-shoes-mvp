/* The stock sheet: what the planner nets against, and what a job card takes.
 *
 * The bug this locks down: the register printed OPENING + RECEIVED - ISSUED
 * while the planner netted against OPENING alone, so a receipt the store had
 * entered never reached the buying list.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { balanceOf, withStockBalances, jobCardIssueRows, issuePatch, jobCardKind } from "../shared/stock.js";
import { netting, netByOrder } from "../shared/engine.js";

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

const MATERIALS = () => ({
  "REXINE 54 BLACK||MTR": { name:"REXINE 54 BLACK", uom:"MTR", stock: 100 },
  "THREAD||SPOOL":        { name:"THREAD", uom:"SPOOL", stock: 40 },
});

test("a material with no movements reads its opening figure", () => {
  assert.equal(balanceOf({ stock: 100 }, {}), 100);
});

test("received adds and issued takes away", () => {
  assert.equal(balanceOf({ stock: 100 }, { opening:100, rec:25, issue:30 }), 95);
});

test("the balance never mutates the reference data it was built from", () => {
  const materials = MATERIALS();
  const out = withStockBalances(materials, { "THREAD||SPOOL": { rec: 10 } });
  assert.equal(out["THREAD||SPOOL"].stock, 50);
  assert.equal(materials["THREAD||SPOOL"].stock, 40, "the original map was written to");
});

test("THE FIX: netting sees a receipt the store entered", () => {
  const total = { "THREAD||SPOOL": 60 };
  /* Opening 40 against a need of 60 is 20 short. */
  assert.equal(netting(total, MATERIALS())[0].shortfall, 20);
  /* 25 spools were received and booked. 65 on the shelf, nothing short. */
  const live = withStockBalances(MATERIALS(), { "THREAD||SPOOL": { opening:40, rec:25 } });
  assert.equal(netting(total, live)[0].shortfall, 0);
});

test("an issue booked against a job card reaches the order-by-order netting", () => {
  const articles = { SPIKE: { combos: { "11X1": { rates: { CUTTING: { "THREAD||SPOOL": 1 } } } } } };
  const orders = [{ order_no:"JO1", article_code:"SPIKE", lines:[{ combo:"11X1", qty:40 }] }];
  const before = netByOrder(orders, articles, MATERIALS(), ["JO1"]);
  assert.equal(before.JO1.can_run, true);
  /* 30 spools have already gone out on a job card: 10 left, 40 needed. */
  const after = netByOrder(orders, articles,
    withStockBalances(MATERIALS(), { "THREAD||SPOOL": { opening:40, issue:30 } }), ["JO1"]);
  assert.equal(after.JO1.can_run, false);
  assert.equal(after.JO1.short[0].shortfall, 30);
});

const ARTICLE = () => ({ combos: { "11X1": { rates: {
  CUTTING:   { "REXINE 54 BLACK||MTR": 0.5 },
  STITCHING: { "THREAD||SPOOL": 0.02 },
} } } });

test("a job card takes the BOM's material total for its pairs", () => {
  const rows = jobCardIssueRows([{ combo:"11X1", qty:100 }], ARTICLE());
  assert.deepEqual(rows.map(r => [r.name, r.qty, r.uom]),
    [["REXINE 54 BLACK", 50, "MTR"], ["THREAD", 2, "SPOOL"]]);
});

test("a material the BOM is silent on is not issued at all", () => {
  const rows = jobCardIssueRows([{ combo:"11X1", qty:100 }], { combos:{ "11X1": { rates:{} } } });
  assert.deepEqual(rows, []);
});

test("issues ACCUMULATE — a second card does not erase the first", () => {
  const rows = jobCardIssueRows([{ combo:"11X1", qty:100 }], ARTICLE());
  const first = issuePatch(rows, {});
  assert.equal(first["REXINE 54 BLACK||MTR"].issue, 50);
  const second = issuePatch(rows, { "REXINE 54 BLACK||MTR": { issue: 50 } });
  assert.equal(second["REXINE 54 BLACK||MTR"].issue, 100);
});

test("a card against an order is a customer card; one without is for stock", () => {
  assert.equal(jobCardKind({ order_no:"JO2112" }), "customer");
  assert.equal(jobCardKind({ order_no:"" }), "stock");
  assert.equal(jobCardKind({}), "stock");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
