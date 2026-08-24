/* Builds the client-facing reference upload template.

   Written with ExcelJS rather than SheetJS because the community build of
   SheetJS cannot write ANY cell formatting — no bold, no fills, no dropdowns.
   A file the factory is asked to fill in by hand needs the header to look like
   a header and the allowed values to be a dropdown, or it gets typed wrong.
   ExcelJS is a devDependency: this script runs here, never in the app.

   Design rules, learned from what people actually get wrong:
     - Every tab opens with a filled EXAMPLE row, tinted amber and labelled, so
       nobody faces a blank grid and nobody mistakes it for real data.
     - Only columns the parser uses. The first version asked for "Component" (a
       fallback for Material) and "Photo File Name" (used for nothing) — two
       extra decisions per row for no effect.
     - Sole Type, Stage and PVC Machine are DROPDOWNS. A typo there is the most
       common way an upload gets rejected.
     - An "Already loaded" tab, so they can see what an upload would replace
       before they start typing.

   Re-run to refresh it against live reference data:
     node scripts/build-reference-template.mjs public/Factory_OS_Reference_Upload_Template.xlsx
*/
import ExcelJS from "exceljs";
import { INPUTS } from "../shared/inputs.js";
import { pairsPerCarton } from "../shared/bridge.js";

const OUT = process.argv[2] || "Factory_OS_Reference_Upload_Template.xlsx";

const INK = "FF0F2233", ACCENT = "FF0B6BCB", RULE = "FFE4E9F0";
const EXAMPLE_BG = "FFFFF7E6", HEAD_BG = "FF0F2233", NOTE = "FF6B7C90";

const SOLE_TYPES = ["EVA","PVC","PU","STUCK-ON"];
const STAGES = ["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","ASSEMBLY","PACKING"];

const wb = new ExcelJS.Workbook();
wb.creator = "Factory OS";
wb.created = new Date();

const thin = { style:"thin", color:{ argb:RULE } };
const border = { top:thin, left:thin, bottom:thin, right:thin };

/* A data tab: title, spacer, header row, example rows, then room to type. */
function dataSheet({ name, tabColour, title, subtitle, columns, examples, validations = [], rows = 200 }){
  const ws = wb.addWorksheet(name, {
    properties:{ tabColor:{ argb:tabColour } },
    views:[{ state:"frozen", ySplit:4 }],
  });
  ws.columns = columns.map(c => ({ key:c.key, width:c.width }));

  ws.mergeCells(1, 1, 1, columns.length);
  const t = ws.getCell(1,1);
  t.value = title;
  t.font = { name:"Calibri", size:14, bold:true, color:{ argb:INK } };
  ws.getRow(1).height = 22;

  ws.mergeCells(2, 1, 2, columns.length);
  const s = ws.getCell(2,1);
  s.value = subtitle;
  s.font = { name:"Calibri", size:10, italic:true, color:{ argb:NOTE } };
  ws.getRow(2).height = 16;

  const head = ws.getRow(4);
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name:"Calibri", size:11, bold:true, color:{ argb:"FFFFFFFF" } };
    cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:HEAD_BG } };
    cell.alignment = { vertical:"middle", horizontal:"center", wrapText:true };
    cell.border = border;
  });
  head.height = 26;

  examples.forEach((row, r) => {
    const line = ws.getRow(5 + r);
    row.forEach((v, i) => {
      const cell = line.getCell(i + 1);
      cell.value = v;
      cell.font = { name:"Calibri", size:11, italic:true, color:{ argb:"FF92400E" } };
      cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:EXAMPLE_BG } };
      cell.border = border;
      if(columns[i].numFmt) cell.numFmt = columns[i].numFmt;
      if(columns[i].align) cell.alignment = { horizontal:columns[i].align };
    });
  });

  // Empty, bordered rows so the typing area is obvious and formats are ready.
  const firstBlank = 5 + examples.length;
  for(let r = firstBlank; r < firstBlank + rows; r++){
    const line = ws.getRow(r);
    columns.forEach((c, i) => {
      const cell = line.getCell(i + 1);
      cell.border = border;
      if(c.numFmt) cell.numFmt = c.numFmt;
      if(c.align) cell.alignment = { horizontal:c.align };
    });
  }

  for(const v of validations){
    for(let r = 5; r < firstBlank + rows; r++){
      ws.getCell(r, v.col).dataValidation = {
        type:"list", allowBlank:true,
        formulae:[`"${v.values.join(",")}"`],
        showErrorMessage:true,
        errorStyle:"stop",
        errorTitle:v.title,
        error:v.message,
      };
    }
  }

  ws.autoFilter = { from:{ row:4, column:1 }, to:{ row:4, column:columns.length } };
  return ws;
}

/* --------------------------------------------------------------- START HERE */
{
  const ws = wb.addWorksheet("START HERE", {
    properties:{ tabColor:{ argb:ACCENT } },
    views:[{ showGridLines:false }],
  });
  ws.columns = [{ width:4 }, { width:18 }, { width:104 }];

  let r = 1;
  const put = (text, opts = {}) => {
    const cell = ws.getCell(r, opts.col || 2);
    cell.value = text;
    cell.font = { name:"Calibri", size:opts.size || 11, bold:!!opts.bold,
                  italic:!!opts.italic, color:{ argb:opts.colour || INK } };
    if(opts.merge) ws.mergeCells(r, opts.col || 2, r, 3);
    ws.getRow(r).height = opts.height || 16;
    r += (opts.gap || 1);
    return cell;
  };
  const heading = text => { r += 1; put(text, { bold:true, size:12, colour:ACCENT, merge:true }); };
  const pair = (label, text) => {
    ws.getCell(r, 2).value = label;
    ws.getCell(r, 2).font = { name:"Calibri", size:11, bold:true, color:{ argb:INK } };
    ws.getCell(r, 3).value = text;
    ws.getCell(r, 3).font = { name:"Calibri", size:11, color:{ argb:INK } };
    ws.getCell(r, 3).alignment = { wrapText:true };
    ws.getRow(r).height = 16;
    r += 1;
  };

  put("FACTORY OS — REFERENCE UPLOAD", { bold:true, size:18, merge:true, height:28 });
  put("Use this to add a new article, or to correct one already loaded.",
      { italic:true, colour:NOTE, merge:true, gap:2 });

  heading("THE THREE TABS");
  pair("BOM",       "One row per material, per size range, per production stage. Required — without it an article cannot be planned.");
  pair("Packing",   "One row per size range: how many pairs fit in its carton. Required — without it cartons cannot be worked out.");
  pair("Catalogue", "One row per article: description, price, machine. Optional.");

  heading("THE THREE THINGS PEOPLE GET WRONG");
  pair("1", "Rate per Pair is for ONE PAIR. Not per carton, not per dozen, not per hundred.");
  pair("2", "Repeat Article Code, Sole Type and Size Range on EVERY row. Never leave a cell blank to mean “same as above” — each row is read on its own.");
  pair("3", "Use one spelling per material. MESH 58\" and Mesh-58\" would be bought as two different materials, splitting the requirement between them.");

  heading("ALLOWED VALUES");
  pair("Sole Type",   SOLE_TYPES.join(", ") + "   (dropdown on the BOM tab)");
  pair("Stage",       STAGES.join(", ") + "   (dropdown)");
  pair("PVC Machine", "ROTARY or VERTICAL. Only for PVC articles — leave blank for any other sole.");

  heading("WHEN YOU UPLOAD IT");
  pair("Where", "In Factory OS, open Data & BOM and choose this file.");
  pair("Preview", "You see exactly what will change before anything is saved.");
  pair("If a row is wrong", "Nothing at all is saved, and you get the row number to fix.");
  pair("If the article exists", "Its BOM is REPLACED in full, and you must tick a box to confirm.");
  pair("If it goes wrong", "The previous version is kept. Roll it back from the same screen, under “Recent reference changes”.");

  heading("TWO LAST THINGS");
  pair("Example rows", "Each tab opens with an amber GLAMOUR example. Delete those rows and type your own in their place.");
  pair("Photos", "Not part of this file — add them in Factory OS under Catalogue.");
}

/* ---------------------------------------------------------------------- BOM */
dataSheet({
  name:"BOM", tabColour:"FF047857",
  title:"BOM — what one pair consumes",
  subtitle:"One row per material, per size range, per stage. Amber rows are an example: delete them.",
  columns:[
    { header:"Article Code",  width:22 },
    { header:"Sole Type",     width:13 },
    { header:"Size Range",    width:13 },
    { header:"Stage",         width:16 },
    { header:"Material",      width:28 },
    { header:"UOM",           width:9,  align:"center" },
    { header:"Rate per Pair", width:15, numFmt:"0.0000", align:"right" },
  ],
  examples:[
    ["GLAMOUR","EVA","6X8","CUTTING",'MESH 58"',"MTR",0.42],
    ["GLAMOUR","EVA","6X8","CUTTING","EVA SHEET 4MM","PAIR",1],
    ["GLAMOUR","EVA","6X8","STITCHING","THREAD","MTR",1.2],
    ["GLAMOUR","EVA","6X8","PACKING","INNER BOX","PCS",1],
    ["GLAMOUR","EVA","9X12","CUTTING",'MESH 58"',"MTR",0.5],
    ["GLAMOUR","EVA","9X12","STITCHING","THREAD","MTR",1.35],
    ["GLAMOUR","EVA","9X12","PACKING","INNER BOX","PCS",1],
  ],
  validations:[
    { col:2, values:SOLE_TYPES, title:"Sole Type",
      message:`Choose one of: ${SOLE_TYPES.join(", ")}` },
    { col:4, values:STAGES, title:"Stage",
      message:`Choose one of: ${STAGES.join(", ")}` },
  ],
});

/* ------------------------------------------------------------------ PACKING */
dataSheet({
  name:"Packing", tabColour:"FFB45309",
  title:"Packing — pairs per carton",
  subtitle:"One row for EVERY size range used on the BOM tab. Whole numbers only.",
  columns:[
    { header:"Article Code",     width:22 },
    { header:"Size Range",       width:15 },
    { header:"Pairs per Carton", width:19, numFmt:"0", align:"right" },
  ],
  examples:[["GLAMOUR","6X8",24],["GLAMOUR","9X12",18]],
  rows:120,
});

/* ---------------------------------------------------------------- CATALOGUE */
dataSheet({
  name:"Catalogue", tabColour:"FF4338CA",
  title:"Catalogue — description, price, machine",
  subtitle:"Optional. One row per article. PVC Machine only for PVC articles.",
  columns:[
    { header:"Article Code",  width:22 },
    { header:"Description",   width:36 },
    { header:"Default Price", width:15, numFmt:'"₹"#,##0', align:"right" },
    { header:"Sole Type",     width:13 },
    { header:"PVC Machine",   width:15 },
  ],
  examples:[["GLAMOUR","School shoe, black",625,"EVA",null]],
  validations:[
    { col:4, values:SOLE_TYPES, title:"Sole Type", message:`Choose one of: ${SOLE_TYPES.join(", ")}` },
    { col:5, values:["ROTARY","VERTICAL"], title:"PVC Machine",
      message:"ROTARY or VERTICAL, and only for a PVC article. Leave blank otherwise." },
  ],
  rows:120,
});

/* -------------------------------------------------------- what is loaded now */
{
  const ws = wb.addWorksheet("Already loaded", {
    properties:{ tabColor:{ argb:"FF6B7C90" } },
    views:[{ state:"frozen", ySplit:4 }],
  });
  const cols = [
    { header:"Article",              width:26 },
    { header:"Sole",                 width:11, align:"center" },
    { header:"Size ranges",          width:42 },
    { header:"BOM rates on file",    width:19, align:"right" },
    { header:"Packing on file",      width:17, align:"center" },
  ];
  ws.columns = cols.map(c => ({ width:c.width }));

  ws.mergeCells(1,1,1,cols.length);
  ws.getCell(1,1).value = "ALREADY IN FACTORY OS";
  ws.getCell(1,1).font = { name:"Calibri", size:14, bold:true, color:{ argb:INK } };
  ws.getRow(1).height = 22;

  ws.mergeCells(2,1,2,cols.length);
  ws.getCell(2,1).value = "For reference — do not edit. Uploading an article listed here REPLACES its BOM completely.";
  ws.getCell(2,1).font = { name:"Calibri", size:10, italic:true, color:{ argb:NOTE } };

  const head = ws.getRow(4);
  cols.forEach((c,i) => {
    const cell = head.getCell(i+1);
    cell.value = c.header;
    cell.font = { name:"Calibri", size:11, bold:true, color:{ argb:"FFFFFFFF" } };
    cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:HEAD_BG } };
    cell.alignment = { vertical:"middle", horizontal:"center", wrapText:true };
    cell.border = border;
  });
  head.height = 26;

  let r = 5;
  for(const [code, a] of Object.entries(INPUTS.articles)){
    const ranges = a.combo_order || Object.keys(a.combos || {});
    const rates = Object.values(a.combos || {})
      .reduce((n,c) => n + Object.values(c.rates || {}).reduce((m,st) => m + Object.keys(st).length, 0), 0);
    const withPack = ranges.filter(x => pairsPerCarton(code, x) != null).length;
    const line = ws.getRow(r);
    const values = [code, a.sole_type, ranges.join("  "), rates || "none — BOM missing",
                    `${withPack} of ${ranges.length}`];
    values.forEach((v,i) => {
      const cell = line.getCell(i+1);
      cell.value = v;
      cell.border = border;
      cell.font = { name:"Calibri", size:11,
        color:{ argb: rates ? INK : "FFBE123C" }, bold: !rates };
      if(cols[i].align) cell.alignment = { horizontal:cols[i].align };
      if(r % 2 === 0) cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:"FFF8FAFC" } };
    });
    r += 1;
  }
  r += 1;
  ws.mergeCells(r,1,r,cols.length);
  ws.getCell(r,1).value = `${Object.keys(INPUTS.materials).length} materials are on file. A material you name that is not `
    + `already known is created automatically, starting at zero stock.`;
  ws.getCell(r,1).font = { name:"Calibri", size:10, italic:true, color:{ argb:NOTE } };
  ws.autoFilter = { from:{ row:4, column:1 }, to:{ row:4, column:cols.length } };
}

await wb.xlsx.writeFile(OUT);
console.log(`Wrote ${OUT}`);
console.log(wb.worksheets.map(w => `  ${w.name} (${w.rowCount} rows, ${w.columnCount} cols)`).join("\n"));
