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

console.log("\nZ — packed cartons and dispatch events, per order");

/* Pairs and cartons answer different questions — what left the order book,
   and how many boxes went on the lorry — so they are tracked apart. */
const packOrders = [{ order_no:"P1", article_code:"SPIKE", lines:[{combo:"6X8", qty:100}] }];
const packed = buildLedger(packOrders, [
  { id:1, order_no:"P1", dispatched:{"6X8":40}, cartons:{"6X8":2}, dispatched_on:"2026-01-05", packing_list:{} },
  { id:2, order_no:"P1", dispatched:{"6X8":30}, cartons:{"6X8":1}, dispatched_on:"2026-02-09", packing_list:{} },
], () => 20).P1;
assert.equal(packed.total_dispatched, 70);
assert.equal(packed.total_cartons, 3, "2 + 1 cartons");
assert.equal(packed.dispatch_count, 2);
assert.equal(packed.last_dispatched_on, "2026-02-09");
assert.deepEqual(packed.events.map(e => e.pairs), [30, 40], "most recent event first");
assert.equal(packed.rows[0].cartons, 3, "and per size range too");
console.log("  pass  cartons accumulate across dispatches, alongside pairs");

/* A dispatch recorded without a packing list has pairs but no carton count.
   Reporting that as "0 cartons" would say the goods shipped in no boxes. */
const uncounted = buildLedger(
  [{ order_no:"P2", article_code:"SPIKE", lines:[{combo:"6X8", qty:50}] }],
  [{ id:1, order_no:"P2", dispatched:{"6X8":50}, dispatched_on:"2026-03-01" }], () => 20).P2;
assert.equal(uncounted.total_dispatched, 50);
assert.equal(uncounted.total_cartons, null, "not 0 — nobody counted them");
assert.equal(uncounted.events[0].cartons, null);
assert.equal(uncounted.events[0].has_packing_list, false);
console.log("  pass  never counted reads as null, never as zero");

const untouched = buildLedger(
  [{ order_no:"P3", article_code:"SPIKE", lines:[{combo:"6X8", qty:10}] }], [], () => 20).P3;
assert.equal(untouched.dispatch_count, 0);
assert.equal(untouched.total_cartons, null);
assert.equal(untouched.last_dispatched_on, null);
console.log("  pass  an order with no dispatches has no events and no carton count\n");

/* A HIDDEN report is off the history list; the pairs still shipped. The server
   has always counted hidden rows when checking what is outstanding, but the
   browser was fed only the visible ones — so the screen offered 40 pairs to
   dispatch when 10 remained, and the save was then refused with "only 10 pairs
   remain outstanding". The ledger must be built from EVERY row. */
const hiddenOrders = [{ order_no:"H1", article_code:"SPIKE", lines:[{combo:"6X8", qty:100}] }];
const hiddenRows = [
  { id:1, order_no:"H1", dispatched:{"6X8":60}, cartons:{"6X8":3}, dispatched_on:"2026-01-05", packing_list:{} },
  { id:2, order_no:"H1", dispatched:{"6X8":30}, cartons:{"6X8":2}, dispatched_on:"2026-02-01", hidden:true, packing_list:{} },
];
const seesAll = buildLedger(hiddenOrders, hiddenRows, () => 20).H1;
assert.equal(seesAll.total_dispatched, 90, "a hidden report did not un-ship its pairs");
assert.equal(seesAll.total_pending, 10);
assert.equal(seesAll.total_cartons, 5, "and its cartons are still packed");
assert.equal(seesAll.dispatch_count, 2);

const seesVisibleOnly = buildLedger(hiddenOrders, hiddenRows.filter(d => !d.hidden), () => 20).H1;
assert.equal(seesVisibleOnly.total_pending, 40,
  "this is the OLD behaviour, kept here to show what the screen must never do again");
console.log("  pass  hidden reports still count as dispatched, packed and outstanding\n");
