/* THE PLAN AS A WORKBOOK A PERSON CAN WORK IN.
 *
 * shared/plan-sheet.js decides what is on the weekly sheet and where; this
 * draws it — headings banded by stage, a day's rows boxed together, closed
 * days greyed, totals as formulas, the two left columns frozen, a week to a
 * printed page. ExcelJS is used because the community build of SheetJS cannot
 * write a fill or a border, and a planning sheet with neither is a wall of
 * text. It is loaded only when Download is pressed.
 *
 *   Weekly plan     the sheet to edit
 *   Job cards       every job on the plan: what a card number stands for
 *   How to use      eight lines
 *   As downloaded   HIDDEN — the plan as it stood, so an upload can tell what
 *                   the planner changed from what merely moved by itself
 */
import { planRows, sheetRows, helpRows, weeklyLayout, jobList,
         WEEKLY_SHEET, JOBS_SHEET, HELP_SHEET, SNAPSHOT_SHEET, STAGE_TINTS } from "../../shared/plan-sheet.js";

const INK = "FF1F3348", GREY = "FF5B6B7C", RULE = "FFC9D2DC", EDGE = "FF7A8A9C";
const TONES = STAGE_TINTS.map(pair => pair.map(hex => `FF${hex}`));
const fill = argb => ({ type:"pattern", pattern:"solid", fgColor:{ argb } });
const line = (style, argb) => ({ style, color:{ argb } });
const box = { top:line("thin", RULE), bottom:line("thin", RULE), left:line("thin", RULE), right:line("thin", RULE) };
const HEIGHT = { band:22, centres:30, head:15, day:27, total:20 };

function styleOf(cell, row, col){
  const tone = TONES[(cell.tone || 0) % TONES.length];
  const firstOfPair = col >= 2 && col % 2 === 0;
  /* A day's rows are boxed together, and each machine's pair of columns is
     set off from the next, so the eye reads a block and not a grid. */
  const edges = { ...box, ...(firstOfPair ? { left:line("thin", EDGE) } : {}), ...(row.last ? { bottom:line("medium", EDGE) } : {}) };
  switch(cell.s){
    case "title":  return { font:{ bold:true, size:15, color:{ argb:INK } }, alignment:{ vertical:"middle" } };
    case "hint":   return { font:{ italic:true, size:9, color:{ argb:GREY } }, alignment:{ vertical:"middle" } };
    case "week":   return { font:{ bold:true, size:11, color:{ argb:"FFFFFFFF" } }, fill:fill(INK),
                            alignment:{ horizontal:"center", vertical:"middle", wrapText:true }, border:box };
    case "stage":  return { font:{ bold:true, size:11, color:{ argb:INK } }, fill:fill(tone[0]),
                            alignment:{ horizontal:"center", vertical:"middle" }, border:{ ...box, left:line("thin", EDGE) } };
    case "centre": return { font:{ bold:true, size:9, color:{ argb:INK } }, fill:fill(tone[1]),
                            alignment:{ horizontal:"center", vertical:"middle", wrapText:true }, border:{ ...box, left:line("thin", EDGE) } };
    case "head":   return { font:{ bold:true, size:8, color:{ argb:GREY } }, fill:fill("FFF5F7FA"),
                            alignment:{ horizontal:"center", vertical:"middle" }, border:{ ...box, bottom:line("medium", EDGE) } };
    case "date":   return { font:{ bold:true, size:10, color:{ argb:cell.off ? GREY : INK } }, fill:fill(cell.off ? "FFE3E7EC" : "FFFFFFFF"),
                            alignment:{ horizontal:"center", vertical:"middle" }, border:{ ...box, bottom:line("medium", EDGE) }, numFmt:"dd/mm" };
    case "day":    return { font:{ size:9, color:{ argb:cell.off ? GREY : INK } }, fill:fill(cell.off ? "FFE3E7EC" : "FFFFFFFF"),
                            alignment:{ horizontal:"center", vertical:"middle" }, border:{ ...box, bottom:line("medium", EDGE) } };
    case "job":    return { font:{ size:9, color:{ argb:INK } }, fill:fill(cell.off ? "FFF1F3F6" : "FFFFFFFF"),
                            alignment:{ vertical:"middle", wrapText:true }, border:edges };
    case "pairs":  return { font:{ bold:true, size:10, color:{ argb:INK } }, fill:fill(cell.off ? "FFF1F3F6" : "FFFFFFFF"),
                            alignment:{ horizontal:"right", vertical:"middle" }, border:{ ...edges, left:line("thin", RULE) }, numFmt:"#,##0" };
    case "total":  return { font:{ bold:true, size:10, color:{ argb:INK } }, fill:fill("FFE9EDF2"),
                            alignment:{ horizontal:col < 2 ? "left" : "right", vertical:"middle" },
                            border:{ ...box, top:line("medium", EDGE), bottom:line("medium", EDGE) }, numFmt:"#,##0" };
    default:       return {};
  }
}

const asDate = iso => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)));

/* Returns the workbook's bytes, or null when nothing is on the plan. */
export async function planWorkbook(state, wcs, origin){
  const layout = weeklyLayout(state, wcs, origin);
  if(!layout) return null;
  const mod = await import("exceljs");
  const ExcelJS = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Factory OS";
  const jobs = jobList(state, wcs);

  const ws = wb.addWorksheet(WEEKLY_SHEET, {
    views:[{ state:"frozen", xSplit:2, ySplit:0, showGridLines:false }],
    pageSetup:{ orientation:"landscape", paperSize:8, fitToPage:true, fitToWidth:1, fitToHeight:0,
                margins:{ left:0.3, right:0.3, top:0.4, bottom:0.4, header:0.2, footer:0.2 } },
  });
  ws.columns = layout.cols.map(c => ({ width:c.width }));
  const pick = `'${JOBS_SHEET}'!$A$2:$A$${jobs.length + 1}`;
  layout.rows.forEach((row, r) => {
    const line = ws.getRow(r + 1);
    if(HEIGHT[row.kind]) line.height = HEIGHT[row.kind];
    if(r === 0) line.height = 26;
    for(const [c, cell] of Object.entries(row.cells)){
      const col = Number(c), target = line.getCell(col + 1);
      if(cell.f) target.value = { formula:cell.f, result:cell.v };
      else if(cell.s === "date" && cell.v) target.value = asDate(cell.v);
      else if(cell.v !== "" && cell.v != null) target.value = cell.v;
      Object.assign(target, styleOf(cell, row, col));
      /* A JOB cell offers the list of jobs, and still takes a typed number. */
      if(cell.s === "job" && jobs.length)
        target.dataValidation = { type:"list", allowBlank:true, showErrorMessage:false, formulae:[pick] };
    }
  });
  for(const [r1, c1, r2, c2] of layout.merges) ws.mergeCells(r1 + 1, c1 + 1, r2 + 1, c2 + 1);
  /* A week to a printed page — but not a blank page after the last one. */
  layout.breaks.slice(0, -1).forEach(r => ws.getRow(r + 1).addPageBreak());

  const list = wb.addWorksheet(JOBS_SHEET, { views:[{ state:"frozen", ySplit:1 }] });
  list.columns = [{ width:46 }, { width:12 }, { width:26 }, { width:30 }, { width:26 }, { width:10 }, { width:16 }, { width:8 }];
  list.addRow(["Job — as it is written on the weekly plan", "Order", "Party", "Article", "Sizes", "Pairs", "Planned dispatch", ""]);
  for(const j of jobs)
    list.addRow([j.pick, j.order_no, j.party, j.article, j.sizes, j.pairs, j.dispatch ? asDate(j.dispatch) : "", j.late ? "LATE" : ""]);
  list.getRow(1).eachCell(cell => Object.assign(cell, { font:{ bold:true, size:10, color:{ argb:"FFFFFFFF" } }, fill:fill(INK),
    alignment:{ vertical:"middle" } }));
  list.getRow(1).height = 20;
  list.getColumn(6).numFmt = "#,##0";
  list.getColumn(7).numFmt = "dd mmm yyyy";
  list.getColumn(8).font = { bold:true, color:{ argb:"FFBE123C" } };
  list.getCell("H1").font = { bold:true, size:10, color:{ argb:"FFFFFFFF" } };

  const help = wb.addWorksheet(HELP_SHEET);
  help.columns = [{ width:22 }, { width:110 }, { width:14 }];
  helpRows(wcs).forEach(r => help.addRow(r));
  help.getCell("A1").font = { bold:true, size:14, color:{ argb:INK } };
  help.eachRow(row => { const first = String(row.getCell(1).value || "");
    if(/^(Good to know|MACHINES AND LINES)/.test(first)) row.font = { bold:true, color:{ argb:INK } }; });

  /* Kept out of sight, not out of the file: it is what the upload compares with. */
  const snap = wb.addWorksheet(SNAPSHOT_SHEET, { state:"hidden" });
  sheetRows(planRows(state, wcs, origin)).forEach(r => snap.addRow(r));

  return { bytes:await wb.xlsx.writeBuffer(), weeks:layout.weeks, jobs:jobs.length };
}
