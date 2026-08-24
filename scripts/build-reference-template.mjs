/* Builds the client-facing reference upload template.

   Design rules, learned from watching what people actually get wrong:
     - Every tab opens with a filled EXAMPLE row, so nobody faces a blank grid.
     - Only columns the parser actually uses. The old template asked for
       "Component" (a fallback for Material) and "Photo File Name" (used for
       nothing), which is two extra decisions per row for no effect.
     - Allowed values are printed in the sheet, next to where they are typed.
     - A "Your current data" tab, so they can see what is already loaded and
       what an upload would replace before they start typing.

   Re-run to refresh it against live reference data:
     node scripts/build-reference-template.mjs public/Factory_OS_Reference_Upload_Template.xlsx
*/
import * as XLSX from "xlsx";
import { INPUTS } from "../shared/inputs.js";
import { pairsPerCarton } from "../shared/bridge.js";

const OUT = process.argv[2] || "Factory_OS_Reference_Upload_Template.xlsx";
const wb = XLSX.utils.book_new();
const add = (name, rows, widths) => {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map(w => ({ wch:w }));
  ws["!freeze"] = { ySplit:1 };
  XLSX.utils.book_append_sheet(wb, ws, name);
};

/* ------------------------------------------------------------------ READ ME */
add("START HERE", [
  ["FACTORY OS — REFERENCE UPLOAD"],
  [],
  ["Use this to add a NEW article, or to correct an article already loaded."],
  ["Three tabs to fill. One row per fact. Do not merge cells or rename columns."],
  [],
  ["Tab","What one row means","Needed?"],
  ["BOM",      "One material, for one size range, at one production stage.","Yes — an article without it cannot be planned"],
  ["Packing",  "One size range and how many pairs fit in its carton.",      "Yes — without it cartons cannot be worked out"],
  ["Catalogue","One article: its description, price and machine.",          "Optional"],
  [],
  ["THE THREE THINGS PEOPLE GET WRONG"],
  ["1","Rate per Pair is per ONE PAIR. Not per carton, not per dozen, not per hundred."],
  ["2","Repeat the Article Code, Sole Type and Size Range on EVERY row. Do not leave a cell"],
  ["", "blank to mean 'same as the row above' — each row is read on its own."],
  ["3","Use the same spelling for a material everywhere. MESH 58\" and Mesh-58\" would otherwise"],
  ["", "be bought as two different materials and the requirement split between them."],
  [],
  ["ALLOWED VALUES — anything else is rejected with the row number"],
  ["Sole Type","EVA, PVC, PU, STUCK-ON"],
  ["Stage","CUTTING, PREPARATION, STITCHING, UPPER_QC, MOLDING, ASSEMBLY, PACKING"],
  ["PVC Machine","ROTARY or VERTICAL. Only for PVC articles — leave blank for any other sole."],
  [],
  ["WHAT HAPPENS WHEN YOU UPLOAD IT"],
  ["In Factory OS go to Data & BOM and choose this file. You get a preview showing exactly what"],
  ["will change. If any row is wrong, nothing at all is saved and you get the row numbers to fix."],
  ["If an article is already loaded, its BOM is REPLACED in full and you have to tick a box to"],
  ["confirm that. The previous version is kept, so a wrong file can be rolled back from the same"],
  ["screen under 'Recent reference changes'."],
  [],
  ["Photos are not part of this file — add them in Factory OS under Catalogue."],
  [],
  ["THE GLAMOUR ROWS ON EACH TAB ARE AN EXAMPLE. Delete them and type your own in their place."],
  ["Do not leave notes or blank-but-not-empty rows inside a tab — every row is read as data."],
  ["Packing needs one row for EVERY size range used on the BOM tab."],
], [16, 62, 46]);

/* ---------------------------------------------------------------------- BOM */
add("BOM", [
  ["Article Code","Sole Type","Size Range","Stage","Material","UOM","Rate per Pair"],
  ["GLAMOUR","EVA","6X8","CUTTING",'MESH 58"',"MTR",0.42],
  ["GLAMOUR","EVA","6X8","CUTTING","EVA SHEET 4MM","PAIR",1],
  ["GLAMOUR","EVA","6X8","STITCHING","THREAD","MTR",1.2],
  ["GLAMOUR","EVA","6X8","PACKING","INNER BOX","PCS",1],
  ["GLAMOUR","EVA","9X12","CUTTING",'MESH 58"',"MTR",0.5],
  ["GLAMOUR","EVA","9X12","STITCHING","THREAD","MTR",1.35],
  ["GLAMOUR","EVA","9X12","PACKING","INNER BOX","PCS",1],
], [20, 12, 13, 15, 26, 8, 14]);

/* ------------------------------------------------------------------ PACKING */
add("Packing", [
  ["Article Code","Size Range","Pairs per Carton"],
  ["GLAMOUR","6X8",24],
  ["GLAMOUR","9X12",18],
], [20, 14, 18]);

/* ---------------------------------------------------------------- CATALOGUE */
add("Catalogue", [
  ["Article Code","Description","Default Price","Sole Type","PVC Machine"],
  ["GLAMOUR","School shoe, black",625,"EVA",""],
], [20, 34, 15, 12, 14]);

/* ------------------------------------------------- what is already loaded */
const current = [
  ["ALREADY IN FACTORY OS — for reference, do not edit this tab"],
  ["Uploading an article that appears here REPLACES its BOM completely."],
  [],
  ["Article","Sole","Size ranges","BOM rates on file","Pairs/carton on file"],
];
for(const [code, a] of Object.entries(INPUTS.articles)){
  const ranges = a.combo_order || Object.keys(a.combos || {});
  const rates = Object.values(a.combos || {})
    .reduce((n, c) => n + Object.values(c.rates || {}).reduce((m, st) => m + Object.keys(st).length, 0), 0);
  const withPack = ranges.filter(r => pairsPerCarton(code, r) != null).length;
  current.push([code, a.sole_type, ranges.join(" "), rates || "NONE — BOM missing",
    `${withPack} of ${ranges.length}`]);
}
current.push([], [`${Object.keys(INPUTS.materials).length} materials are on file. A material you name that is not already`],
  ["known is created automatically, starting at zero stock."]);
add("Already loaded", current, [24, 10, 40, 22, 22]);

XLSX.writeFile(wb, OUT);
console.log(`Wrote ${OUT}`);
console.log(wb.SheetNames.map(n =>
  `  ${n} (${XLSX.utils.sheet_to_json(wb.Sheets[n], {header:1, defval:null}).length} rows)`).join("\n"));
