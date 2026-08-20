import assert from "node:assert/strict";
import { parseOrderSheet, wideTemplateHeaders } from "../shared/order-import.js";
import { INPUTS } from "../shared/inputs.js";

const headers=wideTemplateHeaders(INPUTS);
const row=Array(headers.length).fill("");
const put=(name,value)=>{row[headers.indexOf(name)]=value;};
put("Party","Test Traders"); put("Order Date","2026-08-19"); put("Article","SPIKE");
put("Priority",2); put("Order Nature","MTO"); put("Print","Yes"); put("V/L","Velcro");
put("Sole Colour","Black"); put("Upper Colour","Blue"); put("Pairs 7X10S",240); put("Pairs 2X5",180);

const wide=parseOrderSheet([headers,row],INPUTS,INPUTS.packing);
assert.deepEqual(wide.errors,[]);
assert.equal(wide.orders.length,1,"one wide row must create one article order");
assert.deepEqual(wide.orders[0].lines.map(l=>[l.combo,l.qty]).sort(),[["2X5",180],["7X10S",240]]);
assert.equal(wide.orders[0].printing,true);
assert.equal(wide.orders[0].pi.upper_colour,"Blue");

const legacy=parseOrderSheet([
  ["Party","Order Date","Article","Size Range","Pairs"],
  ["Old File","2026-08-19","JILL","11X1",240],
  ["Old File","2026-08-19","JILL","2X5",180],
],INPUTS,INPUTS.packing);
assert.deepEqual(legacy.errors,[]);
assert.equal(legacy.orders.length,1,"legacy long rows still merge");
assert.equal(legacy.orders[0].lines.length,2);

console.log("\norder import: 7 assertions passed\n");
