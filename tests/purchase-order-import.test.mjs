import assert from "node:assert/strict";
import { parsePurchaseOrderRows, PURCHASE_ORDER_TEMPLATE_HEADERS } from "../shared/purchase-order-import.js";

let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log("  pass  "+name);}catch(e){failed++;console.log("  FAIL  "+name+"\n        "+e.message);}}

console.log("\nPurchase-order Excel upload");
const materials=[
  {material_key:"MESH||MTR",name:"MESH",uom:"MTR",shortfall:100},
  {material_key:"EVA||SHEET",name:"EVA",uom:"SHEET",shortfall:50},
];

test("turns PO groups into separate POs and keeps additional information",()=>{
  const rows=[PURCHASE_ORDER_TEMPLATE_HEADERS,
    ["PO-1","ABC Materials","2026-09-30","2026-10-05","Deliver before noon","MESH||MTR","MESH","MTR",100,12],
    ["PO-1","","","","","EVA||SHEET","EVA","SHEET",50,20],
    ["PO-2","Other Supplier","30/09/2026","","Cash purchase","MESH||MTR","MESH","MTR",25,""]];
  const out=parsePurchaseOrderRows(rows,materials);
  assert.deepEqual(out.errors,[]);assert.equal(out.purchase_orders.length,2);
  assert.equal(out.purchase_orders[0].lines.length,2);
  assert.equal(out.purchase_orders[0].additional_information,"Deliver before noon");
  assert.equal(out.purchase_orders[1].po_date,"2026-09-30");
});

test("accepts a material by the stable downloaded key even if its display name was edited",()=>{
  const rows=[PURCHASE_ORDER_TEMPLATE_HEADERS,
    ["PO-1","ABC","2026-09-30","","","MESH||MTR","typed differently","MTR",10,""]];
  const out=parsePurchaseOrderRows(rows,materials);
  assert.deepEqual(out.errors,[]);assert.equal(out.purchase_orders[0].lines[0].name,"MESH");
});

test("reads an Excel date serial without a timezone shifting the PO date",()=>{
  const rows=[PURCHASE_ORDER_TEMPLATE_HEADERS,
    ["PO-1","ABC",46295,"","","MESH||MTR","MESH","MTR",10,""]];
  const out=parsePurchaseOrderRows(rows,materials);
  assert.deepEqual(out.errors,[]);assert.equal(out.purchase_orders[0].po_date,"2026-09-30");
});

test("reports all unsafe rows instead of partially accepting the workbook",()=>{
  const rows=[PURCHASE_ORDER_TEMPLATE_HEADERS,
    ["PO-1","ABC","2026-09-30","","","UNKNOWN","Unknown","KG",-2,-1],
    ["PO-1","A different supplier","2026-09-30","","","MESH||MTR","MESH","MTR",0,12]];
  const out=parsePurchaseOrderRows(rows,materials);
  assert.equal(out.purchase_orders.length,0);
  assert.ok(out.errors.some(e=>/supplier conflicts/i.test(e)));
  assert.ok(out.errors.some(e=>/not in Factory OS/i.test(e)));
  assert.ok(out.errors.some(e=>/ORDER QUANTITY/i.test(e)));
});

test("refuses a renamed or unrelated spreadsheet",()=>{
  const out=parsePurchaseOrderRows([["Supplier","Qty"],["ABC",10]],materials);
  assert.equal(out.purchase_orders.length,0);assert.match(out.errors[0],/downloaded Factory OS template/i);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode=failed?1:0;
