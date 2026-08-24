import assert from "node:assert/strict";
import { parseReferenceWorkbook } from "../shared/reference-import.js";
import { mergeBom } from "../shared/bom-import.js";
import { INPUTS } from "../shared/inputs.js";

console.log("\nreference import — safe BOM, packing and catalogue workbook");

const parsed=parseReferenceWorkbook([
  {name:"BOM",rows:[
    ["Article Code","Sole Type","Size Range","Stage","Component","Material","UOM","Rate per Pair"],
    ["Glamour","EVA","6X8","CUTTING","Upper","Mesh 58\"","MTR",0.42],
    ["Glamour","EVA","6X8","STITCHING","Thread","Thread","MTR",1.2],
  ]},
  {name:"Packing",rows:[
    ["Article Code","Size Range","Pairs per Carton"],
    ["Glamour","6X8",24],
  ]},
  {name:"Catalogue",rows:[
    ["Article Code","Description","Default Price","Sole Type","PVC Machine","Photo File Name"],
    ["Glamour","School shoe",625,"EVA","","glamour.jpg"],
  ]},
]);
assert.deepEqual(parsed.errors,[]);
assert.equal(parsed.boms[0].article,"GLAMOUR");
assert.equal(parsed.boms[0].combos["6X8"].rates.CUTTING['MESH 58"||MTR'],0.42);
assert.equal(parsed.packing.GLAMOUR["6X8"],24);
assert.equal(parsed.catalogue.GLAMOUR.price,625);
assert.equal(parsed.warnings.length,1,"photo filename must be surfaced for separate image upload");

const merged=mergeBom(INPUTS,parsed.boms[0]);
assert.deepEqual(merged.reference.articles.GLAMOUR.routing,
  ["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","PACKING","DISPATCH"]);

const duplicate=parseReferenceWorkbook([{name:"BOM",rows:[
  ["Article Code","Sole Type","Size Range","Stage","Component","Material","UOM","Rate per Pair"],
  ["GLAMOUR","EVA","6X8","CUTTING","Upper","Mesh","MTR",0.4],
  [" glamour ","EVA","6X8","CUTTING","Upper","Mesh","MTR",0.4],
]}]);
assert.ok(duplicate.errors.some(e=>e.includes("duplicate BOM material")));

console.log("  pass  one workbook parses all three master-data sections");
console.log("  pass  article names are canonical and duplicate BOM rows are blocked");
console.log("  pass  new articles receive the complete seven-stage route\n");
