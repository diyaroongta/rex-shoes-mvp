import assert from "node:assert/strict";
import { compute } from "../shared/engine.js";
import { INPUTS } from "../shared/inputs.js";
import { mergePiSnapshot, ordersFromPiSnapshot } from "../shared/pi-schedule.js";
import { routingForSole } from "../shared/reference-edit.js";

console.log("\nregressions — cross-feature contracts");

const snapshot={orders:[{
  order_no:"JO-PI-LINK-1",order_date:"2026-08-20",article_code:"SPIKE",priority:2,party:"Linked Buyer",
  lines:[{combo:"7X10S",qty:240,label:"7X10S"}],
  pi:{pi_no:"PI-LINK-1",production_status:"produced",printing:false,stitching:"inhouse"},
}]};
const restored=ordersFromPiSnapshot(snapshot,INPUTS);
assert.deepEqual(restored.errors,[]);
assert.equal(restored.orders.length,1);
const state=compute(restored.orders,INPUTS.articles,INPUTS.materials,INPUTS.workcenters,INPUTS.origin);
assert.equal(state.orders.length,1,"a restored PI order must enter the schedule");
assert.equal(state.orders[0].order_no,"JO-PI-LINK-1");
assert.ok(state.orders[0].stages.length>0);

const stale=ordersFromPiSnapshot({orders:[{...snapshot.orders[0],lines:[{combo:"OLD-RANGE",qty:10}]}]},INPUTS);
assert.ok(stale.errors.some(e=>e.includes("OLD-RANGE")),"stale PI ranges must be blocked rather than silently under-planned");

const historic={orders:[snapshot.orders[0],{...snapshot.orders[0],order_no:"JO-PI-LINK-2",article_code:"JILL",lines:[{combo:"11X1",qty:120}]}]};
const merged=mergePiSnapshot(historic,[{...snapshot.orders[0],party:"Updated Buyer"}]);
assert.equal(merged.orders.length,2,"syncing one live line must not erase another PI snapshot line");
assert.equal(merged.orders.find(o=>o.order_no==="JO-PI-LINK-1").party,"Updated Buyer");

const base=["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","PACKING","DISPATCH"];
assert.deepEqual(routingForSole(base,"STUCK-ON"),
  ["CUTTING","PREPARATION","STITCHING","UPPER_QC","ASSEMBLY","PACKING","DISPATCH"]);
assert.deepEqual(routingForSole(routingForSole(base,"STUCK-ON"),"PVC"),base,
  "changing catalogue sole type must keep the route compatible with the selected process");

console.log("  pass  PI snapshots can be safely restored into the schedule");
console.log("  pass  stale PI lines are blocked visibly");
console.log("  pass  partial live sync preserves the full PI audit snapshot");
console.log("  pass  catalogue sole edits keep routing consistent\n");
