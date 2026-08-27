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

// Article codes are read from the cells, not inferred from a filename or from
// catalogue defaults. A THUNDER upload must therefore remain THUNDER.
const thunder = parseReferenceWorkbook([
  { name:"BOM", rows:[BOM_HEAD,["THUNDER","EVA","6X8","CUTTING","MESH","MTR",0.5]] },
  { name:"Packing", rows:[["Article Code","Size Range","Pairs per Carton"],["THUNDER","6X8",18]] },
  { name:"Catalogue", rows:[["Article Code","Description","Default Price","Sole Type","Packing Source"],["THUNDER","Demo",500,"EVA","ARMOUR"]] },
  { name:"Example Only", rows:[BOM_HEAD,["GLAMOUR","EVA","6X8","CUTTING","MESH","MTR",0.5]] },
]);
assert.deepEqual(thunder.errors, []);
assert.deepEqual(thunder.boms.map(b=>b.article), ["THUNDER"]);
assert.deepEqual(Object.keys(thunder.packing), ["THUNDER"]);
assert.deepEqual(Object.keys(thunder.catalogue), ["THUNDER"]);
assert.equal(thunder.catalogue.THUNDER.packing_source,"ARMOUR");
assert.ok(!JSON.stringify(thunder).includes('"GLAMOUR"'), "Example Only must never be imported");

const sizeAware = parseReferenceWorkbook([
  { name:"BOM", rows:[BOM_HEAD,
    ["THUNDER","EVA","7X10","CUTTING","MESH","MTR",0.5],
    ["THUNDER","EVA","11X1","CUTTING","MESH","MTR",0.6],
  ]},
  { name:"Packing", rows:[["Article Code","Size Range","Pairs per Carton"],
    ["THUNDER","7",24],["THUNDER","8",24],["THUNDER","7X10",24],["THUNDER","11X1",18],
  ]},
  { name:"Catalogue", rows:[["Article Code","Size Range","Description","MRP per Pair","Sole Type","PVC Machine"],
    ["THUNDER","7X10","School shoe",899,"EVA",""],
    ["THUNDER","11X1","School shoe",949,"EVA",""],
  ]},
]);
assert.deepEqual(sizeAware.errors, []);
assert.deepEqual(sizeAware.packing,{THUNDER:{"7X10":24,"11X1":18}});
assert.deepEqual(sizeAware.packingSingles,{THUNDER:{"7S":24,"8S":24}});
assert.deepEqual(sizeAware.mrp,{THUNDER:{"7X10":899,"11X1":949}});
assert.deepEqual(Object.keys(sizeAware.catalogue),["THUNDER"],"range prices remain one catalogue article");
assert.ok(sizeAware.warnings.some(w=>/THUNDER 7X10: Size Run was blank and was read as Small/.test(w)),
  "an ambiguous bare BOM range must explain its fallback instead of silently guessing");

/* Regression fixture copied from the client's GLAMOUR screenshots. The same
   numerals occur once in the Small run and again in the Large run. This used
   to reject every Catalogue row and produced duplicate Packing errors because
   validation compared individual sizes only with range labels. */
const glamourRanges=["7X10","11X1","2X5","6X7","8X12"];
const screenshotSizes=["7S","8S","9S","10S","11S","12S","13","1","2","3","4","5","6","7","8","9","10","11","12"];
const screenshotUpload=parseReferenceWorkbook([
  {name:"BOM",rows:[BOM_HEAD,...glamourRanges.map((range,i)=>
    ["GLAMOUR","PVC",range,"CUTTING",`MESH ${i+1}`,"MTR",0.5+i/10])]},
  {name:"Packing",rows:[["Article Code","Size Range","Pairs per Carton"],
    ...screenshotSizes.map(size=>["GLAMOUR",size,24]),
    ["GLAMOUR","7S",24], ["GLAMOUR","8S",24]]},
  {name:"Catalogue",rows:[["Article Code","Size Range","Description","MRP per Pair","Sole Type"],
    ...screenshotSizes.map((size,i)=>["GLAMOUR",size,"Glamour shoe",900+i,"PVC"])]},
]);
assert.deepEqual(screenshotUpload.errors,[],screenshotUpload.errors.join(" | "));
assert.deepEqual(screenshotUpload.boms[0].combo_order,glamourRanges);
assert.deepEqual(new Set(Object.keys(screenshotUpload.packingSingles.GLAMOUR)),new Set(
  ["7S","8S","9S","10S","11S","12S","13S","1","2","3","4","5","6","7","8","9","10","11","12"]));
assert.equal(screenshotUpload.mrp.GLAMOUR["7S"],900);
assert.equal(screenshotUpload.mrp.GLAMOUR["7"],913,"bare 7 is the Large size once the article has both runs");
assert.ok(screenshotUpload.warnings.some(w=>w.includes("repeated identical packing rule")));

const explicitAndScoped=parseReferenceWorkbook([
  {name:"BOM",rows:[[...BOM_HEAD,"Size Run"],
    ["GLAMOUR","PVC","7-10","CUTTING","SMALL MESH","MTR",0.5,"Small"],
    ["GLAMOUR","PVC","7/10L","CUTTING","LARGE MESH","MTR",0.7,"Large"]]},
  {name:"Packing",rows:[["Article Code","Size Range","Pairs per Carton","BOM Range"],
    ["GLAMOUR","7S",24,"7X10"],["GLAMOUR","7L",18,"7X10L"]]},
  {name:"Catalogue",rows:[["Article Code","Size Range","MRP per Pair","Sole Type","BOM Range"],
    ["GLAMOUR","7S",900,"PVC","7X10"],["GLAMOUR","7L",950,"PVC","7X10L"]]},
]);
assert.deepEqual(explicitAndScoped.errors,[],explicitAndScoped.errors.join(" | "));
assert.deepEqual(explicitAndScoped.boms[0].combo_order,["7X10","7X10L"],"hyphen and slash range notation is normalised");
assert.equal(explicitAndScoped.boms[0].combos["7X10"].size_run,"SMALL");
assert.equal(explicitAndScoped.boms[0].combos["7X10L"].size_run,"LARGE");
assert.deepEqual(explicitAndScoped.packingSingles.GLAMOUR,{"7X10::7S":24,"7X10L::7":18});
assert.deepEqual(explicitAndScoped.mrp.GLAMOUR,{"7X10::7S":900,"7X10L::7":950});

const duplicateHeaders=parseReferenceWorkbook([{name:"Packing",rows:[
  ["Article Code","Size Range","Pairs per Carton","PPC"],
  ["SPIKE","7X10S",24,18],
]}],INPUTS);
assert.ok(duplicateHeaders.errors.some(e=>e.includes("duplicate column")&&e.includes("pairspercarton")),
  "two columns meaning the same thing must be rejected instead of reading whichever comes first");

const conflictingPacking=parseReferenceWorkbook([
  {name:"BOM",rows:[BOM_HEAD,["GLAMOUR","PVC","7X10","CUTTING","MESH","MTR",0.5]]},
  {name:"Packing",rows:[["Article Code","Size Range","Pairs per Carton"],
    ["GLAMOUR","7S",24],["GLAMOUR","7S",18]]},
]);
assert.ok(conflictingPacking.errors.some(e=>e.includes("conflicting packing rule")),
  "same size with different carton quantities must still stop the save");

const duplicateCatalogue = parseReferenceWorkbook([
  { name:"BOM", rows:[BOM_HEAD,["THUNDER","EVA","7X10","CUTTING","MESH","MTR",0.5]] },
  { name:"Catalogue", rows:[["Article Code","Description","Default Price","Sole Type"],
    ["THUNDER","A",899,"EVA"],["THUNDER","B",949,"EVA"],
  ]},
]);
assert.ok(duplicateCatalogue.errors.some(e=>e.includes("conflicts with the earlier THUNDER row")),duplicateCatalogue.errors.join(" | "));

const renamedRange = parseReferenceWorkbook([
  { name:"BOM", rows:[BOM_HEAD,["THUNDER","EVA","7X10","CUTTING","MESH","MTR",0.5]] },
  { name:"Catalogue", rows:[["Article Code","Description","Default Price","Sole Type"],
    ["THUNDER","School shoe",899,"EVA"],["THUNDER 1","Different model",949,"EVA"],
  ]},
]);
assert.ok(renamedRange.errors.some(e=>e.includes("THUNDER 1 has no BOM")&&e.includes("keep Article Code THUNDER")),renamedRange.errors.join(" | "));

const oldCatalogueTemplate = parseReferenceWorkbook([
  { name:"BOM", rows:[BOM_HEAD,
    ["THUNDER","EVA","7X10","CUTTING","MESH","MTR",0.5],
    ["THUNDER","EVA","11X1","CUTTING","MESH","MTR",0.6],
  ]},
  { name:"Catalogue", rows:[["Article Code","Description","Default Price","Sole Type"],
    ["THUNDER","7X10",899,"EVA"],["THUNDER 1","11X1",949,"EVA"],
  ]},
]);
assert.deepEqual(oldCatalogueTemplate.errors,[],oldCatalogueTemplate.errors.join(" | "));
assert.deepEqual(oldCatalogueTemplate.mrp,{THUNDER:{"7X10":899,"11X1":949}});
assert.deepEqual(Object.keys(oldCatalogueTemplate.catalogue),["THUNDER"]);
assert.ok(oldCatalogueTemplate.warnings.some(w=>w.includes("treated THUNDER 1 as THUNDER")));

// Row numbers must point at the row Excel shows, counted from the real header.
const bad = parseReferenceWorkbook([{ name:"BOM", rows:[
  ["Title"], [], BOM_HEAD,
  ["GLAMOUR","EVA","6X8","CUTTING",'MESH 58"',"MTR",0],
]}]);
assert.ok(bad.errors.some(e => e.includes("BOM row 4")),
  `the error must name the row Excel shows, got: ${bad.errors.join(" | ")}`);

console.log("  pass  a title block above the table does not break the upload");
console.log("  pass  row numbers still match what Excel shows\n");
console.log("  pass  THUNDER remains THUNDER and Example Only is ignored\n");
console.log("  pass  combo packing, single-size packing and range MRPs are separated\n");

/* A BOM upload REPLACES an article's ranges — it does not merge them. So the
   file someone sends to correct a single rate, holding only that one range, is
   exactly the file that deletes every other range and all its material rates.
   A live order on a deleted range keeps its machine time and loses its
   material: it occupies the line and buys nothing. */
import { INPUTS } from "../shared/inputs.js";

const HEAD = ["Article Code","Sole Type","Size Range","Stage","Material","UOM","Rate per Pair"];
const partial = parseReferenceWorkbook([{ name:"BOM", rows:[
  HEAD,
  ["SPIKE","EVA","7X10S","CUTTING",'MESH 58"',"MTR",0.5],
]}], INPUTS);

assert.deepEqual(partial.errors, [], "the file itself is valid — that is what makes it dangerous");
assert.equal(partial.removals.length, 1, "a partial re-upload of a loaded article must report what it deletes");
const [gone] = partial.removals;
assert.equal(gone.article, "SPIKE");
assert.deepEqual(gone.ranges, ["11X1","2X5","6X8","9X12"],
  "every range absent from the file is named, not just counted");
assert.ok(gone.rates > 100, `the material rates lost must be counted, got ${gone.rates}`);

// The complete file for the same article removes nothing.
const complete = parseReferenceWorkbook([{ name:"BOM", rows:[
  HEAD,
  ...["7X10S","11X1","2X5","6X8","9X12"].map(c =>
    ["SPIKE","EVA",c,"CUTTING",'MESH 58"',"MTR",0.5]),
]}], INPUTS);
assert.deepEqual(complete.removals, [], "a file holding every range deletes nothing");

// A brand-new article has nothing to lose.
const fresh = parseReferenceWorkbook([{ name:"BOM", rows:[
  HEAD, ["THUNDER","EVA","7X10","CUTTING",'MESH 58"',"MTR",0.5],
]}], INPUTS);
assert.deepEqual(fresh.removals, [], "a new article reports no removals");

console.log("  pass  a partial re-upload names the size ranges it would delete");
console.log("  pass  a complete file, and a new article, remove nothing\n");

/* The template carries a worked "Example Only" tab. If the importer ever read
   it, every upload would silently create the example article — which is
   exactly what happened when the worked rows lived inside the import tabs and
   the factory typed their real numbers over them, leaving the Article Code
   untouched. The tab must be inert, and a real article alongside it must load
   on its own. */
const withExampleTab = parseReferenceWorkbook([
  { name:"Example Only", rows:[
    ["EXAMPLE ONLY — not imported"],
    HEAD,
    ["EXAMPLE ARTICLE","EVA","6X8","CUTTING",'MESH 58"',"MTR",0.42],
  ]},
  { name:"BOM", rows:[HEAD, ["THUNDER","EVA","7X10","CUTTING",'MESH 58"',"MTR",0.5]] },
], INPUTS);

assert.deepEqual(withExampleTab.errors, []);
assert.deepEqual(withExampleTab.boms.map(b => b.article), ["THUNDER"],
  "the Example Only tab must never reach the database");
assert.ok(!withExampleTab.boms.some(b => /EXAMPLE/.test(b.article)));

console.log("  pass  the Example Only tab is never imported\n");

/* Generic article handling: names and range counts come only from the cells.
   These six deliberately vary punctuation, spacing, sole family and sizes so
   a future shortcut for a known product cannot turn them into GLAMOUR (or any
   other seeded article). Each product remains one BOM with two ranges. */
const varied=[
  ["THUNDER 27","EVA","7X10","11X1"],
  ["ORBIT-21","PVC","8X12","1X4"],
  ["KIDS STAR","PU","3X5","6X9"],
  ["AX/9","STUCK-ON","2X4","5X7"],
  ["NOVA (L)","PVC","6X8","9X12"],
  ["URBAN+","EVA","10X13","1X3"],
];
const variedWorkbook=parseReferenceWorkbook([
  {name:"BOM",rows:[BOM_HEAD,...varied.flatMap(([article,sole,a,b])=>[
    [article,sole,a,"CUTTING","MESH","MTR",0.5],
    [article,sole,b,"STITCHING","THREAD","SPOOL",0.1],
  ])]},
  {name:"Packing",rows:[["Article Code","Size Range","Pairs per Carton"],
    ...varied.flatMap(([article,,a,b])=>[[article,a,24],[article,b,18]])]},
  {name:"Catalogue",rows:[["Article Code","Size Range","Description","MRP per Pair","Sole Type"],
    ...varied.flatMap(([article,sole,a,b],i)=>[
      [article,a,`${article} shoe`,700+i*10,sole],
      [article,b,`${article} shoe`,750+i*10,sole],
    ])]},
]);
assert.deepEqual(variedWorkbook.errors,[],variedWorkbook.errors.join(" | "));
assert.deepEqual(variedWorkbook.boms.map(b=>b.article),varied.map(v=>v[0]));
for(const [article,,a,b] of varied){
  const bom=variedWorkbook.boms.find(row=>row.article===article);
  assert.deepEqual(bom.combo_order,[a,b],`${article} must remain one article with two ranges`);
  assert.deepEqual(Object.keys(variedWorkbook.packing[article]),[a,b]);
  assert.deepEqual(Object.keys(variedWorkbook.mrp[article]),[a,b]);
}
console.log("  pass  six varied article names remain six BOMs with multiple size ranges\n");
