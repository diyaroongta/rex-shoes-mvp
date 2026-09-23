import assert from "node:assert/strict";
import { stockSheetRows, stockPatchFromRows, STOCK_INPUT_HEADERS } from "../shared/stock-upload.js";

let passed=0,failed=0;
function test(name,fn){try{fn();passed++;console.log("  pass  "+name);}catch(e){failed++;console.log("  FAIL  "+name+"\n        "+e.message);}}

const CURRENT=[{sn:1,key:"GLUE||LTR",name:"GLUE",uom:"LTR",category:"CHEMICAL",size:"",
  opening:10,rec:5,issue:2,stock:13,min:4,alert:false,order_qty:0,rate:100,value:1300}];

console.log("\nstock input workbook — only real inputs come back");

test("the download carries a stable material key and all stock inputs",()=>{
  const rows=stockSheetRows(CURRENT);
  assert.deepEqual(rows[0],STOCK_INPUT_HEADERS);
  assert.equal(rows[1][1],"GLUE||LTR");
  assert.equal(rows[1][7],5);
});

test("an uploaded row updates every maintained stock field",()=>{
  const out=stockPatchFromRows([{
    "MATERIAL KEY":"GLUE||LTR",CATEGORY:"CHEMICAL",SIZE:"5 L",
    "OPENING STOCK":12,"TOTAL RECEIVED":8,"TOTAL ISSUED":3,"MIN. STOCK":6,RATE:110,
    STOCK:9999,ALERT:"LOW","ORDER QUANTITY":999,"STOCK VALUE":999999,
  }],CURRENT);
  assert.equal(out.ok,true);
  assert.deepEqual(out.patch,{"GLUE||LTR":{size:"5 L",opening:12,rec:8,issue:3,min:6,rate:110}});
  assert.equal(out.patch["GLUE||LTR"].stock,undefined,"calculated stock is never imported");
});

test("unknown and duplicate materials are refused",()=>{
  const out=stockPatchFromRows([
    {"MATERIAL KEY":"NOPE||KG","OPENING STOCK":1},
    {"MATERIAL KEY":"GLUE||LTR","OPENING STOCK":11},
    {"MATERIAL KEY":"GLUE||LTR","OPENING STOCK":12},
  ],CURRENT);
  assert.equal(out.ok,false);
  assert.ok(out.problems.some(p=>/not found/.test(p)));
  assert.ok(out.problems.some(p=>/more than once/.test(p)));
});

test("negative quantities are refused",()=>{
  const out=stockPatchFromRows([{"MATERIAL KEY":"GLUE||LTR","TOTAL ISSUED":-1}],CURRENT);
  assert.equal(out.ok,false);
  assert.match(out.problems[0],/0 or more/);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exitCode=failed?1:0;
