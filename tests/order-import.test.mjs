import assert from "node:assert/strict";
import { parseOrderSheet, parseOrderWorkbook, wideTemplateHeaders } from "../shared/order-import.js";
import { INPUTS } from "../shared/inputs.js";

const headers=wideTemplateHeaders(INPUTS);
const row=Array(headers.length).fill("");
const put=(name,value)=>{row[headers.indexOf(name)]=value;};
put("Party","Test Traders"); put("Order Date","2026-08-19"); put("Article","SPIKE");
put("PI No","PI-WIDE-1");
put("Priority",2); put("Order Nature","MTO"); put("Print","Yes"); put("Closure (Lace/Velcro)","Velcro");
put("Dispatch Timeline","30 days");
put("Sole Colour","Black"); put("Upper Colour","Blue"); put("Pairs 7X10S",240); put("Pairs 2X5",180);

const wide=parseOrderSheet([headers,row],INPUTS,INPUTS.packing);
assert.deepEqual(wide.errors,[]);
assert.equal(wide.orders.length,1,"one wide row must create one article order");
assert.deepEqual(wide.orders[0].lines.map(l=>[l.combo,l.qty]).sort(),[["2X5",180],["7X10S",240]]);
assert.equal(wide.orders[0].printing,true);
assert.equal(wide.orders[0].pi.upper_colour,"Blue");
assert.equal(wide.orders[0].pi.pi_no,"PI-WIDE-1","wide imports must retain the PI link");
assert.equal(wide.orders[0].pi.dispatch_timeline,"30 days");

const badClosure=[...row];badClosure[headers.indexOf("Closure (Lace/Velcro)")]="L";
assert.match(parseOrderSheet([headers,badClosure],INPUTS,INPUTS.packing).errors[0].error,/L means Large size run/,
  "L is a size-run marker and must never silently become Lace");

const legacy=parseOrderSheet([
  ["Party","Order Date","Article","Size Range","Pairs"],
  ["Old File","2026-08-19","JILL","11X1",240],
  ["Old File","2026-08-19","JILL","2X5",180],
],INPUTS,INPUTS.packing);
assert.deepEqual(legacy.errors,[]);
assert.equal(legacy.orders.length,1,"legacy long rows still merge");
assert.equal(legacy.orders[0].lines.length,2);

const separatePis=parseOrderSheet([
  ["PI No","Party","Order Date","Article","Size Range","Pairs"],
  ["PI-A","Same Buyer","2026-08-19","JILL","11X1",240],
  ["PI-B","Same Buyer","2026-08-19","JILL","2X5",180],
],INPUTS,INPUTS.packing);
assert.deepEqual(separatePis.errors,[]);
assert.equal(separatePis.orders.length,2,"different PI numbers must not be merged into one order");
assert.deepEqual(separatePis.orders.map(o=>o.pi.pi_no),["PI-A","PI-B"]);

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

/* Client fallback: S/L is normally written, but if it is omitted the columns
   still keep their factory order — all Small sizes first, then Large. */
const ascendingHeaders=["Party","Order Date","Article","7","8","1","2","3"];
const ascending=parseOrderSheet([ascendingHeaders,["Sequence Buyer","2026-08-26","SPIKE",24,24,24,18,18]],INPUTS,INPUTS.packing);
assert.deepEqual(ascending.errors,[],ascending.errors.map(e=>e.error));
assert.deepEqual(ascending.orders[0].lines.flatMap(line=>Object.keys(line.sizes)),["7s","8s","1","2","3"],
  "7,8 before the reset to 1 are Small; 1,2,3 start the Large run");
assert.ok(ascending.warnings.some(w=>/inferred 7s, 8s/.test(w)),"fallback inference must be visible for review");

const unknown=[...institutionalRow];unknown[institutionalHeaders.indexOf("ARTICLE NAME")]="NOT IN CATALOGUE";
const mixed=parseOrderSheet([institutionalHeaders,institutionalRow,unknown],INPUTS,INPUTS.packing,{sheetName:"INSTITUTIONAL ORDER BOOK"});
assert.equal(mixed.orders.length,1,"unknown articles must not block recognised rows");
assert.equal(mixed.errors.length,1,"a skipped unknown article must block commit so the batch cannot be half-imported");

const workbook=parseOrderWorkbook([
  {sheetName:"Orders",rows:[headers,row]},
  {sheetName:"Read me",rows:[["Factory OS order template"],["Use one row per article."]]},
],INPUTS,INPUTS.packing);
assert.deepEqual(workbook.errors,[],"instruction sheets must not block a valid order sheet");
assert.equal(workbook.orders.length,1);

const unitRow=[...row];unitRow[headers.indexOf("Pairs 7X10S")]="24 pairs";
unitRow[headers.indexOf("Pairs 2X5")]="";
const units=parseOrderSheet([headers,unitRow],INPUTS,INPUTS.packing);
assert.deepEqual(units.errors,[],"common quantity suffixes must be accepted");
assert.equal(units.orders[0].lines[0].qty,24);

const badDate=[...row];badDate[headers.indexOf("Order Date")]="2026-02-31";
assert.match(parseOrderSheet([headers,badDate],INPUTS,INPUTS.packing).errors[0].error,/Could not read the order date/,
  "an impossible calendar date must not roll into March");
const badPrint=[...row];badPrint[headers.indexOf("Print")]="Perhaps";
assert.match(parseOrderSheet([headers,badPrint],INPUTS,INPUTS.packing).errors[0].error,/Print must be Yes or No/,
  "unknown print text must not silently become No");

const buyerTwo=[...row];buyerTwo[headers.indexOf("Party")]="Another Buyer";
const crossSheet=parseOrderWorkbook([
  {sheetName:"Orders A",rows:[headers,row]},
  {sheetName:"Orders B",rows:[headers,buyerTwo]},
],INPUTS,INPUTS.packing);
assert.ok(crossSheet.errors.some(e=>/PI PI-WIDE-1 is assigned to more than one customer/.test(e.error)),
  "PI/customer conflicts must be caught across workbook tabs");

const skipped=parseOrderWorkbook([
  {sheetName:"Orders",rows:[headers,row]},
  {sheetName:"Mystery Data",rows:[["Something","Else"],[1,2]]},
],INPUTS,INPUTS.packing);
assert.ok(skipped.warnings.some(w=>/Mystery Data: skipped/.test(w)),"unread sheets must be surfaced, not silently ignored");

console.log("\norder import: uploaded Order Book, wide and legacy formats passed\n");
