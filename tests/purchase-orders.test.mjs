import assert from "node:assert/strict";
import { validatePurchaseOrder, validatePurchaseReceipt, purchaseOrderProgress }
  from "../shared/purchase-orders.js";

let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log("  pass  "+name);}catch(e){failed++;console.log("  FAIL  "+name+"\n        "+e.message);}}

console.log("\nPurchase orders");
const draft={supplier:"ABC Materials",po_date:"2026-09-30",expected_on:"2026-10-05",
  additional_information:"Deliver before noon",
  lines:[{material_key:"MESH||MTR",name:"MESH",uom:"mtr",ordered_qty:100.5,rate:12}]};

test("keeps supplier, material and additional information on a valid PO",()=>{
  const out=validatePurchaseOrder(draft);assert.equal(out.ok,true);assert.equal(out.value.additional_information,"Deliver before noon");
  assert.deepEqual(out.value.lines[0],{material_key:"MESH||MTR",name:"MESH",uom:"MTR",ordered_qty:100.5,rate:12});
});

test("refuses an impossible delivery date and an empty supplier",()=>{
  assert.match(validatePurchaseOrder({...draft,supplier:""}).error,/Supplier/);
  assert.match(validatePurchaseOrder({...draft,expected_on:"2026-02-30"}).error,/real date/);
  assert.match(validatePurchaseOrder({...draft,expected_on:"2026-09-01"}).error,/before the PO date/);
});

test("derives open, partial and received from the receipt log",()=>{
  const base={...draft,po_no:"PO-1",status:"open",receipts:[]};
  assert.equal(purchaseOrderProgress(base).status,"open");
  const partial={...base,receipts:[{lines:[{material_key:"MESH||MTR",quantity:40}]}]};
  assert.equal(purchaseOrderProgress(partial).status,"partial");
  assert.equal(purchaseOrderProgress(partial).lines[0].balance_qty,60.5);
  const complete={...base,receipts:[{lines:[{material_key:"MESH||MTR",quantity:100.5}]}]};
  assert.equal(purchaseOrderProgress(complete).status,"received");
});

test("a cancelled PO stays cancelled even after a partial receipt",()=>{
  const out=purchaseOrderProgress({...draft,status:"cancelled",
    receipts:[{lines:[{material_key:"MESH||MTR",quantity:40}]}]});
  assert.equal(out.status,"cancelled");assert.equal(out.received_qty,40);
});

test("receipt validation refuses an over-receipt and accepts the exact balance",()=>{
  const order={...draft,po_no:"PO-1",receipts:[{lines:[{material_key:"MESH||MTR",quantity:40}]}]};
  const tooMuch=validatePurchaseReceipt({po_no:"PO-1",received_on:"2026-10-01",
    lines:[{material_key:"MESH||MTR",quantity:61}]},order);
  assert.equal(tooMuch.ok,false);assert.match(tooMuch.error,/only 60.5 mtr remains/i);
  const exact=validatePurchaseReceipt({po_no:"PO-1",received_on:"2026-10-01",note:"GRN 9",
    lines:[{material_key:"MESH||MTR",quantity:60.5}]},order);
  assert.equal(exact.ok,true);assert.equal(exact.value.note,"GRN 9");
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode=failed?1:0;
