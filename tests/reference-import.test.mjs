import assert from "node:assert/strict";
import { parseReferenceWorkbook } from "../shared/reference-import.js";

console.log("\nreference upload — the workbook people fill in by hand");

const BOM_HEAD = ["Article Code","Sole Type","Size Range","Stage","Material","UOM","Rate per Pair"];
const rowsFor = (lead = []) => [
  ...lead,
  BOM_HEAD,
  ["GLAMOUR","EVA","6X8","CUTTING",'MESH 58"',"MTR",0.42],
  ["GLAMOUR","EVA","6X8","PACKING","INNER BOX","PCS",1],
];

/* A hand-filled workbook routinely carries a title and a note above the table.
   Assuming the header is row 1 rejected the entire file for it, and pointed the
   row-number error at the title — which tells the user nothing. */
const titled = parseReferenceWorkbook([
  { name:"BOM", rows: rowsFor([["FACTORY OS — REFERENCE UPLOAD"], ["One row per material."], []]) },
  { name:"Packing", rows:[["Packing — pairs per carton"], [], ["Article Code","Size Range","Pairs per Carton"], ["GLAMOUR","6X8",24]] },
]);
assert.deepEqual(titled.errors, [], "a title above the header must not break the file");
assert.equal(titled.boms.length, 1);
assert.equal(titled.boms[0].article, "GLAMOUR");
assert.deepEqual(titled.packing, { GLAMOUR:{ "6X8":24 } });

const plain = parseReferenceWorkbook([{ name:"BOM", rows: rowsFor() }]);
assert.deepEqual(plain.errors, [], "a header on row 1 still works");
assert.equal(plain.boms[0].combo_order.length, 1);

// Row numbers must point at the row Excel shows, counted from the real header.
const bad = parseReferenceWorkbook([{ name:"BOM", rows:[
  ["Title"], [], BOM_HEAD,
  ["GLAMOUR","EVA","6X8","CUTTING",'MESH 58"',"MTR",0],
]}]);
assert.ok(bad.errors.some(e => e.includes("BOM row 4")),
  `the error must name the row Excel shows, got: ${bad.errors.join(" | ")}`);

console.log("  pass  a title block above the table does not break the upload");
console.log("  pass  row numbers still match what Excel shows\n");
