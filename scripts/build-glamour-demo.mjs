/* Filled GLAMOUR demo — ready to upload through Data & BOM's "Upload the
   Factory OS article master" box (the one with "Download upload template" and
   "Validate and save all", NOT "Upload a BOM workbook" further down that page
   — that second box wants the factory's own single-article ARTICLE-row layout
   and will reject this file with "No ARTICLE row found").

   EVERY NUMBER HERE IS A PLACEHOLDER. GLAMOUR appears on real order sheets but
   has no BOM anywhere yet — this file exists to demo the upload flow safely,
   not to state real consumption. The sheet says so on every tab; say so again
   before showing it to the client, and replace these rates with real factory
   figures before trusting procurement for GLAMOUR.

   Run:  node scripts/build-glamour-demo.mjs
*/
import ExcelJS from "exceljs";

const OUT = process.argv[2] || "GLAMOUR_demo_upload.xlsx";
const INK = "FF0F2233", HEAD_BG = "FF0F2233", NOTE = "FF6B7C90", RULE = "FFE4E9F0";
const DEMO_BG = "FFFFF7E6", DEMO_TXT = "FF92400E";

const wb = new ExcelJS.Workbook();
wb.creator = "Factory OS";
wb.created = new Date();

const thin = { style:"thin", color:{ argb:RULE } };
const border = { top:thin, left:thin, bottom:thin, right:thin };

function sheet(name, tabColour, title, subtitle, columns, rows){
  const ws = wb.addWorksheet(name, { properties:{ tabColor:{ argb:tabColour } }, views:[{ state:"frozen", ySplit:4 }] });
  ws.columns = columns.map(c => ({ width:c.width }));

  ws.mergeCells(1,1,1,columns.length);
  ws.getCell(1,1).value = title;
  ws.getCell(1,1).font = { name:"Calibri", size:14, bold:true, color:{ argb:INK } };
  ws.getRow(1).height = 22;

  ws.mergeCells(2,1,2,columns.length);
  ws.getCell(2,1).value = subtitle;
  ws.getCell(2,1).font = { name:"Calibri", size:10, italic:true, color:{ argb:DEMO_TXT } };
  ws.getCell(2,1).fill = { type:"pattern", pattern:"solid", fgColor:{ argb:DEMO_BG } };
  ws.getRow(2).height = 16;

  const head = ws.getRow(4);
  columns.forEach((c,i) => {
    const cell = head.getCell(i+1);
    cell.value = c.header;
    cell.font = { name:"Calibri", size:11, bold:true, color:{ argb:"FFFFFFFF" } };
    cell.fill = { type:"pattern", pattern:"solid", fgColor:{ argb:HEAD_BG } };
    cell.alignment = { vertical:"middle", horizontal:"center", wrapText:true };
    cell.border = border;
  });
  head.height = 24;

  rows.forEach((row,r) => {
    const line = ws.getRow(5+r);
    row.forEach((v,i) => {
      const cell = line.getCell(i+1);
      cell.value = v;
      cell.border = border;
      cell.font = { name:"Calibri", size:11, color:{ argb:INK } };
      if(columns[i].numFmt) cell.numFmt = columns[i].numFmt;
      if(columns[i].align) cell.alignment = { horizontal:columns[i].align };
    });
  });
  ws.autoFilter = { from:{ row:4, column:1 }, to:{ row:4, column:columns.length } };
  return ws;
}

const DEMO_NOTE = "PLACEHOLDER DEMO DATA — GLAMOUR has no real BOM yet. Replace every rate with the factory's actual figures before trusting procurement for it.";

/* GLAMOUR — a plain (non-split) EVA article, full roll: kids 6X8/9X12, adult
   1X5. No Velcro/Lace distinction assumed — nothing on file says it has one,
   so the demo doesn't invent one either. */
sheet("BOM", "FF047857",
  "GLAMOUR — bill of materials (DEMO)",
  DEMO_NOTE,
  [
    { header:"Article Code",  width:22 },
    { header:"Sole Type",     width:13 },
    { header:"Size Range",    width:13 },
    { header:"Stage",         width:16 },
    { header:"Material",      width:26 },
    { header:"UOM",           width:9,  align:"center" },
    { header:"Rate per Pair", width:15, numFmt:"0.0000", align:"right" },
  ],
  [
    ["GLAMOUR","EVA","6X8","CUTTING",'MESH 58"',"MTR",0.40],
    ["GLAMOUR","EVA","6X8","CUTTING","EVA SHEET 4MM","PAIR",1],
    ["GLAMOUR","EVA","6X8","STITCHING","THREAD","MTR",1.10],
    ["GLAMOUR","EVA","6X8","PACKING","INNER BOX","PCS",1],
    ["GLAMOUR","EVA","9X12","CUTTING",'MESH 58"',"MTR",0.48],
    ["GLAMOUR","EVA","9X12","CUTTING","EVA SHEET 4MM","PAIR",1],
    ["GLAMOUR","EVA","9X12","STITCHING","THREAD","MTR",1.25],
    ["GLAMOUR","EVA","9X12","PACKING","INNER BOX","PCS",1],
    ["GLAMOUR","EVA","1X5","CUTTING",'MESH 58"',"MTR",0.55],
    ["GLAMOUR","EVA","1X5","CUTTING","EVA SHEET 4MM","PAIR",1],
    ["GLAMOUR","EVA","1X5","STITCHING","THREAD","MTR",1.40],
    ["GLAMOUR","EVA","1X5","PACKING","INNER BOX","PCS",1],
  ]);

sheet("Packing", "FFB45309",
  "GLAMOUR — pairs per carton (DEMO)",
  DEMO_NOTE,
  [
    { header:"Article Code",     width:22 },
    { header:"Size Range",       width:14 },
    { header:"Pairs per Carton", width:19, numFmt:"0", align:"right" },
  ],
  [
    ["GLAMOUR","6X8",24],
    ["GLAMOUR","9X12",18],
    ["GLAMOUR","1X5",18],
  ]);

sheet("Catalogue", "FF4338CA",
  "GLAMOUR — catalogue (DEMO)",
  DEMO_NOTE,
  [
    { header:"Article Code",  width:22 },
    { header:"Description",   width:34 },
    { header:"Default Price", width:15, numFmt:'"₹"#,##0', align:"right" },
    { header:"Sole Type",     width:13 },
    { header:"PVC Machine",   width:15 },
  ],
  [
    ["GLAMOUR","Kids school shoe, EVA sole (placeholder)",449,"EVA",null],
  ]);

await wb.xlsx.writeFile(OUT);
console.log(`Wrote ${OUT}`);
