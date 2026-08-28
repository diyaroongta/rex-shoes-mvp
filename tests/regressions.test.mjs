import assert from "node:assert/strict";
import { compute } from "../shared/engine.js";
import { INPUTS } from "../shared/inputs.js";
import { mergePiSnapshot, ordersFromPiSnapshot } from "../shared/pi-schedule.js";
import { routingForSole } from "../shared/reference-edit.js";
import { colouredMaterialName, mergeBom } from "../shared/bom-import.js";

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

/* Colour on a BOM upload — two different things sharing a word.

   A colour written against a MATERIAL makes it a different material to buy.
   A colour written against the ARTICLE is the shoe's standard sole/upper
   colour: it prefills an order and must never touch procurement. */
assert.equal(colouredMaterialName('REXINE 54"',"blue"),'REXINE 54" BLUE');
assert.equal(colouredMaterialName('REXINE 54"',"Default"),'REXINE 54"',"Default means no colour");
assert.equal(colouredMaterialName('REXINE 54"',""),'REXINE 54"');
assert.equal(colouredMaterialName("BLACK THREAD","BLACK"),"BLACK THREAD","a name already carrying the colour is left alone");

const baseReference = {
  articles:{ GOLA:{ sole_type:"PVC", sole_colour:"Black", upper_colour:"Black",
    combo_order:["6X8"], combos:{ "6X8":{ stitching_combo:"6X8", rates:{ CUTTING:{ "MESH||MTR":0.4 } } } } } },
  materials:{ "MESH||MTR":{ name:"MESH", uom:"MTR", stock:120 } },
};
const uploadWithColours = mergeBom(baseReference,{
  article:"GOLA", soleType:"PVC", soleColour:"White", upperColour:"White/Grey",
  combo_order:["6X8"],
  combos:{ "6X8":{ stitching_combo:"6X8", rates:{ CUTTING:{ "MESH BLUE||MTR":0.4 } } } },
  materials:{ "MESH BLUE||MTR":{ name:"MESH BLUE", uom:"MTR", colour:"BLUE" } },
},{mode:"replace"});
assert.equal(uploadWithColours.reference.articles.GOLA.sole_colour,"White");
assert.equal(uploadWithColours.reference.articles.GOLA.upper_colour,"White/Grey");
assert.deepEqual(uploadWithColours.newMaterials,["MESH BLUE||MTR"],
  "a colour-specific material is a NEW material, reported so its stock is not assumed");
assert.equal(uploadWithColours.reference.materials["MESH BLUE||MTR"].stock,0);
assert.equal(uploadWithColours.reference.materials["MESH||MTR"].stock,120,"existing stock is never touched");

/* The colour columns are optional. A file that leaves them out is saying
   nothing about colour — it must not wipe the colours already on file. */
const uploadWithout = mergeBom(uploadWithColours.reference,{
  article:"GOLA", soleType:"PVC",
  combo_order:["6X8"],
  combos:{ "6X8":{ stitching_combo:"6X8", rates:{ CUTTING:{ "MESH||MTR":0.5 } } } },
  materials:{ "MESH||MTR":{ name:"MESH", uom:"MTR" } },
},{mode:"replace"});
assert.equal(uploadWithout.reference.articles.GOLA.sole_colour,"White");
assert.equal(uploadWithout.reference.articles.GOLA.upper_colour,"White/Grey");
console.log("  pass  material colour buys separately; article colour only prefills, and neither is wiped by an upload that omits it");
