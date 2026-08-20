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

const institutionalHeaders=["PI NO","ORDER DATE","CUSTOMER NAME","CITY","ARTICLE NAME","COLOUR","SOLE COLOUR","LACE /VELCRO","SOLE","CURRENT STATUS 2.0",
  "5s","6s","7s","8s","9s","10s","11s","12s","13s","1","2","3","4","5","6","7","8","9","10","11","12","TOTAL"];
const institutionalRow=Array(institutionalHeaders.length).fill(null);
const iput=(name,value)=>{institutionalRow[institutionalHeaders.indexOf(name)]=value;};
iput("PI NO","PI-101");iput("ORDER DATE",46242);iput("CUSTOMER NAME","School Buyer");iput("CITY","Delhi");
iput("ARTICLE NAME","SPIKE");iput("COLOUR","Black");iput("SOLE COLOUR","White");iput("LACE /VELCRO","VELCRO");
iput("SOLE","EVA");iput("CURRENT STATUS 2.0","CUTTING");iput("11s",24);iput("1",12);iput("5",6);
const institutional=parseOrderSheet([institutionalHeaders,institutionalRow],INPUTS,INPUTS.packing,{sheetName:"INSTITUTIONAL ORDER BOOK"});
assert.deepEqual(institutional.errors,[]);
assert.equal(institutional.orders.length,1);
assert.deepEqual(institutional.orders[0].lines.map(l=>[l.combo,l.qty]),[["11X1",36],["2X5",6]]);
assert.equal(institutional.orders[0].pi.customer_city,"Delhi");
assert.equal(institutional.orders[0].pi.order_nature,"Institutional");

const mtoHeaders=["DATE","CUSTOMER NAME","ARTICLE NAME","COLOUR","LACE /VELCRO","SOLE","STATUS 2.0","6","7","8","9","10","11","12","13","13.5","1","2","3","4","5","6","7","8","9","10","11","12","TOTAL"];
const mtoRow=Array(mtoHeaders.length).fill(null);
mtoRow[0]="20/08/2026";mtoRow[1]="MTO Buyer";mtoRow[2]="SPIKE";mtoRow[3]="Blue";mtoRow[4]="LACE";mtoRow[5]="EVA";
// Adult 6, 8, 9 and 11 are the repeated numeric columns after the reset to 1.
mtoRow[21]=18;mtoRow[23]=18;mtoRow[24]=9;mtoRow[26]=9;
const mto=parseOrderSheet([mtoHeaders,mtoRow],INPUTS,INPUTS.packing,{sheetName:"MTO ORDER BOOK (2)"});
assert.deepEqual(mto.errors,[]);
assert.deepEqual(mto.orders[0].lines.map(l=>[l.combo,l.qty]),[["6X8",36],["9X12",18]]);
assert.deepEqual(mto.orders[0].lines[0].size_order,["6","7","8"]);

const unknown=[...institutionalRow];unknown[institutionalHeaders.indexOf("ARTICLE NAME")]="NOT IN CATALOGUE";
const mixed=parseOrderSheet([institutionalHeaders,institutionalRow,unknown],INPUTS,INPUTS.packing,{sheetName:"INSTITUTIONAL ORDER BOOK"});
assert.equal(mixed.orders.length,1,"unknown articles must not block recognised rows");
assert.equal(mixed.warnings.length,1);

console.log("\norder import: uploaded Order Book, wide and legacy formats passed\n");
