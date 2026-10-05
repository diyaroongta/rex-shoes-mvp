import assert from "node:assert/strict";
import { purchaseOrderSummary, templateRows } from "../shared/purchase-orders.js";
let passed = 0, failed = 0;
function test(name, fn){ try { fn(); passed++; console.log("  pass  " + name); } catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); } }

console.log("\nPO tracking");
const po = (no, status, lines, receipts = [], expected_on = "2026-10-10") => ({ po_no:no, status, expected_on, lines, receipts });
const orders = [
  po("PO1", "open", [{ material_key:"A", name:"REXINE", uom:"MTR", ordered_qty:100, rate:85 }], [], "2026-10-01"),
  po("PO2", "open", [{ material_key:"B", name:"SOLE", uom:"PRS", ordered_qty:50, rate:20 }], [{ lines:[{ material_key:"B", quantity:20 }] }]),
  po("PO3", "open", [{ material_key:"C", name:"VELCRO", uom:"MTR", ordered_qty:10 }], [{ lines:[{ material_key:"C", quantity:10 }] }]),
  po("PO4", "cancelled", [{ material_key:"D", name:"THREAD", uom:"PCS", ordered_qty:5 }]),
];
test("outstanding, received and pending are counted from the receipts", () => {
  const s = purchaseOrderSummary(orders, "2026-10-05");
  assert.deepEqual([s.outstanding, s.open, s.partial, s.received, s.cancelled], [2, 1, 1, 1, 1]);
  assert.equal(s.pending_value, 100 * 85 + 30 * 20);
  assert.equal(s.pending_lines, 2);
});
test("an outstanding PO past its expected date is overdue", () => {
  assert.deepEqual(purchaseOrderSummary(orders, "2026-10-05").overdue_po_nos, ["PO1"]);
});

console.log("\nThe prefilled PO template, from the stock register");
const meta = { "A||MTR":{ supplier:"Shree Rexine", supplier_rate:82, dispatch_location:"Delhi" },
               "B||PRS":{ supplier:"Shree Rexine", rate:20 }, "C||MTR":{ rate:5 } };
const rows = templateRows([
  { material_key:"C||MTR", name:"VELCRO", uom:"MTR", shortfall:4 },
  { material_key:"A||MTR", name:"REXINE", uom:"MTR", shortfall:10, rate:85 },
  { material_key:"B||PRS", name:"SOLE", uom:"PRS", shortfall:30 },
], meta, "2026-10-05");
test("one PO group per supplier, supplier filled in", () => {
  const shree = rows.filter(r => r[1] === "Shree Rexine");
  assert.equal(shree.length, 2);
  assert.equal(new Set(shree.map(r => r[0])).size, 1, "same group");
});
test("the supplier's rate wins over the register rate; location goes on the PO", () => {
  const rex = rows.find(r => r[6] === "REXINE");
  assert.equal(rex[9], 82);
  assert.equal(rex[4], "Dispatch from: Delhi");
});
test("a material with no supplier is its own group with the supplier BLANK, listed last", () => {
  const last = rows[rows.length - 1];
  assert.equal(last[6], "VELCRO");
  assert.equal(last[1], "");
  assert.notEqual(last[0], rows[0][0]);
});
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode = failed ? 1 : 0;
