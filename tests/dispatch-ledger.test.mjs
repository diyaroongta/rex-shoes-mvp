import assert from "node:assert/strict";
import { buildLedger, ledgerTotals } from "../shared/dispatch-ledger.js";

console.log("\ndispatch ledger — pending versus accepted shortage");

const orders = [
  { order_no:"JO1", party:"Buyer A", article_code:"SPIKE",
    lines:[{combo:"7X10S",qty:600},{combo:"11X1",qty:400}] },
  { order_no:"JO2", party:"Buyer B", article_code:"SPIKE",
    lines:[{combo:"7X10S",qty:200}] },
];
const ppc = (article, combo) => ({ "7X10S":24, "11X1":24 })[combo] ?? null;

/* JO1 ships 600 of 1000 and is then closed short. JO2 is a plain partial. */
const dispatches = [
  { id:1, order_no:"JO1", dispatched:{"7X10S":600}, kind:"partial", dispatched_on:"2026-08-10" },
  { id:2, order_no:"JO1", dispatched:{}, kind:"shortage", closes_order:true, dispatched_on:"2026-08-14" },
  { id:3, order_no:"JO2", dispatched:{"7X10S":50}, kind:"partial", dispatched_on:"2026-08-12" },
];

const ledger = buildLedger(orders, dispatches, ppc);
const jo1 = ledger.JO1, jo2 = ledger.JO2;

assert.equal(jo1.closed, true, "a dispatch marked closes_order must close the order");
assert.equal(jo1.closed_on, "2026-08-14");
assert.equal(jo1.total_pending, 0, "a closed-short order must stop counting as pending work");
assert.equal(jo1.shortfall, 400, "the undelivered balance stays on record as a shortage");
assert.equal(jo1.status, "closed short");
// The per-range rows must agree with the header, or the packing report would
// still offer the balance for dispatch.
assert.equal(jo1.rows.reduce((a,r)=>a+r.pending,0), 0);
assert.equal(jo1.rows.find(r=>r.combo==="11X1").shortfall, 400);

assert.equal(jo2.closed, false);
assert.equal(jo2.total_pending, 150, "an ordinary partial dispatch still leaves a pending balance");
assert.equal(jo2.shortfall, 0);
assert.equal(jo2.status, "partial");

const totals = ledgerTotals(ledger);
assert.deepEqual(totals, { ordered:1200, dispatched:650, pending:150, shortfall:400 });

/* Closing an order that was in fact fully shipped is completion, not a shortage. */
const exact = buildLedger([orders[1]],
  [{ id:9, order_no:"JO2", dispatched:{"7X10S":200}, closes_order:true, dispatched_on:"2026-08-20" }], ppc);
assert.equal(exact.JO2.shortfall, 0);
/* Closing an order that was in fact fully shipped is completion — but saying
   only "complete" would hide that it was closed deliberately rather than
   shipped out naturally. */
assert.equal(exact.JO2.status, "closed complete");

console.log("  pass  closing an order short clears its pending balance");
console.log("  pass  the shortfall is recorded rather than erased");
console.log("  pass  a plain partial dispatch is unaffected\n");
