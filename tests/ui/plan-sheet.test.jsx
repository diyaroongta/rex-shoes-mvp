import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/refdata.js",async()=>{
  const { INPUTS } = await import("../../shared/inputs.js");
  return { REF:INPUTS, reload:vi.fn(async()=>{}) };
});
vi.mock("../../src/lib/today.js",()=>({ todayIso:()=>"2026-07-06" }));
/* The real workbook writer, with the one call that would start a browser
   download captured instead — so the test edits the very bytes the planner
   would have been handed. */
const saved=vi.hoisted(()=>({ bytes:null, name:"" }));
vi.mock("../../src/lib/save-file.js",()=>({ saveFile:vi.fn((bytes,name)=>{ saved.bytes=bytes; saved.name=name; }) }));

import * as XLSX from "xlsx";
import PlanSheet from "../../src/PlanSheet.jsx";
import { compute, fromDay, dayIndex } from "../../shared/engine.js";
import { INPUTS } from "../../shared/inputs.js";
import { sheetDate } from "../../shared/plan-sheet.js";

/* THE PLAN AS A SPREADSHEET, through the screen: the workbook the Download
   button makes is edited the way a planner would edit it in Excel and put back
   through the Upload button. */
const { articles, materials, workcenters:wcs, origin } = INPUTS;
const A={order_no:"JO1",order_date:"2026-07-06",article_code:"REX GOLA (V)",priority:2,party:"Sheet Party",lines:[{combo:"8X10",qty:1500}]};
const B={order_no:"JO2",order_date:"2026-07-06",article_code:"SMART BOY (L) BLACK",priority:2,party:"Other Party",lines:[{combo:"6X8",qty:1200}]};
const plan=(overrides={})=>compute([A,B],articles,materials,wcs,origin,{overrides});
const planWith=extra=>plan(extra);
const later=(iso,n)=>fromDay(dayIndex(iso,origin)+n,origin);
const stage=(state,no,name)=>state.units.find(u=>u.unit_key===no).stages.find(s=>s.stage===name);

beforeEach(()=>{ vi.clearAllMocks(); saved.bytes=null; });

/* THE WEEKLY SHEET, AS A PLANNER HANDLES IT. A day is a band of rows under its
   date; a machine is a JOB column with its PAIRS beside it. */
const colOf=(grid,name)=>{ const h=grid.findIndex(r=>r[0]==="DATE"); return grid[h-1].findIndex(c=>String(c).startsWith(name)); };
const bandOf=(grid,date)=>{ const top=grid.findIndex(r=>sheetDate(r[0])===date), out=[top];
  for(let i=top+1;i<grid.length&&grid[i][0]==="";i++) out.push(i); return out; };
const cellOf=(grid,date,name,job)=>{ const c=colOf(grid,name); return [bandOf(grid,date).find(i=>String(grid[i][c]).startsWith(job)),c]; };
const cutPaste=(grid,[i,c],toDate,toName)=>{ const tc=colOf(grid,toName), ti=bandOf(grid,toDate).find(r=>!grid[r][tc]);
  grid[ti][tc]=grid[i][c]; grid[ti][tc+1]=grid[i][c+1]; grid[i][c]=""; grid[i][c+1]=""; };

async function downloaded(user){
  await user.click(screen.getByRole("button",{name:"Download plan (.xlsx)"}));
  await waitFor(()=>expect(saved.bytes).not.toBeNull());
  return XLSX.read(saved.bytes);
}
/* Download, then hand back the workbook with `edit` applied to its weekly sheet. */
async function editedFile(user, edit){
  const wb=await downloaded(user);
  const grid=XLSX.utils.sheet_to_json(wb.Sheets["Weekly plan"],{header:1,raw:true,defval:""});
  edit(grid);
  wb.Sheets["Weekly plan"]=XLSX.utils.aoa_to_sheet(grid);
  return new File([XLSX.write(wb,{type:"array",bookType:"xlsx"})],"plan-edited.xlsx");
}
const upload=(user,file)=>user.upload(screen.getByLabelText("Upload an edited plan workbook"),file);

describe("the plan as a spreadsheet",()=>{
  it("downloads the factory's weekly sheet, a list of the jobs, and how to use it",async()=>{
    const user=userEvent.setup();
    render(<PlanSheet state={plan()} wcs={wcs} planWith={planWith} onApply={vi.fn()}/>);
    const wb=await downloaded(user);
    expect(saved.name).toBe("weekly-production-plan-2026-07-06.xlsx");
    expect(wb.SheetNames).toEqual(["Weekly plan","Job cards","How to use","As downloaded"]);
    /* The copy the upload compares with is in the file, and out of sight. */
    expect(wb.Workbook.Sheets.map(s=>s.Hidden)).toEqual([0,0,0,1]);
    const ws=wb.Sheets["Weekly plan"], grid=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:""});
    expect(grid[0][0]).toBe("WEEKLY PRODUCTION PLAN");
    expect(grid[3][0]).toMatch(/^WEEK 1/);
    expect(grid[5].slice(0,4)).toEqual(["DATE","DAY","JOB","PAIRS"]);
    /* Monday's cutting, as a planner reads it: the job, then its pairs. */
    expect(sheetDate(grid[6][0])).toBe("2026-07-06");
    expect(grid[6].slice(1,4)).toEqual(["MON","JO1 · REX GOLA (V)\n8X10 · Sheet Party",1500]);
    /* The date is a real date shown as 06/07, and the total is a formula. */
    expect(ws.A7.w).toBe("06/07");
    const total=grid.findIndex(r=>r[0]==="WEEK 1 TOTAL");
    expect(ws[`D${total+1}`].f).toBe(`SUM(D7:D${total})`);
    expect(ws["!merges"].length).toBeGreaterThan(30);
    const jobs=XLSX.utils.sheet_to_json(wb.Sheets["Job cards"],{header:1});
    expect(jobs[1].slice(0,6)).toEqual(["JO1 · REX GOLA (V) · Sheet Party","JO1","Sheet Party","REX GOLA (V)","8X10",1500]);
    expect(screen.getByRole("status")).toHaveTextContent(/Weekly plan downloaded — \d+ weeks, 2 jobs/);
  });

  it("shows what an edited sheet changes before saving anything, then applies it",async()=>{
    const user=userEvent.setup(), onApply=vi.fn(async()=>({saved:1,failed:[]}));
    const state=plan();
    const from=stage(state,"JO1","PACKING").start_date, to=later(from,2);
    render(<PlanSheet state={state} wcs={wcs} planWith={planWith} onApply={onApply}/>);
    const file=await editedFile(user,grid=>cutPaste(grid,cellOf(grid,from,"Packing","JO1"),to,"Packing"));
    await upload(user,file);
    const panel=await screen.findByRole("region",{name:"Uploaded plan"});
    expect(panel).toHaveTextContent(/1 job stage will follow the sheet · 13 left as planned/);
    const table=within(panel).getByRole("table",{name:"Changes from the uploaded plan"});
    expect(table).toHaveTextContent("JO1");
    expect(table).toHaveTextContent("PACKING");
    expect(panel).toHaveTextContent(/What it does to dispatch:.*JO1/);
    expect(onApply).not.toHaveBeenCalled();                        // nothing is saved by uploading
    await user.click(within(panel).getByRole("button",{name:"Apply 1 change to the plan"}));
    await waitFor(()=>expect(onApply).toHaveBeenCalledWith([
      {order_no:"JO1",unit_key:"JO1",override:{at:{PACKING:to},daily:{PACKING:{[to]:1500}}}}]));
    expect(await screen.findByRole("status")).toHaveTextContent(/Plan updated from plan-edited.xlsx: 1 job stage now follow/);
  });

  it("typing over the pairs is enough to change the plan",async()=>{
    const user=userEvent.setup(), onApply=vi.fn(async()=>({saved:1,failed:[]}));
    render(<PlanSheet state={plan()} wcs={wcs} planWith={planWith} onApply={onApply}/>);
    await upload(user,await editedFile(user,grid=>{
      const [i,c]=cellOf(grid,"2026-07-06","Cutting hall","JO1");
      grid[i][c+1]=900;
      const next=bandOf(grid,"2026-07-07").find(r=>!grid[r][c]);
      grid[next][c]="JO1"; grid[next][c+1]=600;                    // the rest the day after, by its number alone
    }));
    const panel=await screen.findByRole("region",{name:"Uploaded plan"});
    await user.click(await within(panel).findByRole("button",{name:"Apply 1 change to the plan"}));
    await waitFor(()=>expect(onApply).toHaveBeenCalled());
    expect(onApply.mock.calls[0][0][0].override.daily).toEqual({CUTTING:{"2026-07-06":900,"2026-07-07":600}});
  });

  it("a sheet uploaded unchanged has nothing to apply",async()=>{
    const user=userEvent.setup();
    render(<PlanSheet state={plan()} wcs={wcs} planWith={planWith} onApply={vi.fn()}/>);
    await upload(user,await editedFile(user,()=>{}));
    const panel=await screen.findByRole("region",{name:"Uploaded plan"});
    expect(within(panel).getByRole("button",{name:"Nothing to apply"})).toBeDisabled();
    expect(panel).toHaveTextContent(/nothing was changed in it/);
  });

  it("a job the sheet puts out of stage order is not applied, and the reason is given",async()=>{
    const user=userEvent.setup(), state=plan();
    render(<PlanSheet state={state} wcs={wcs} planWith={planWith} onApply={vi.fn()}/>);
    const cutting=stage(state,"JO1","CUTTING").start_date;
    const stitching=stage(state,"JO1","STITCHING").start_date;
    await upload(user,await editedFile(user,grid=>cutPaste(grid,cellOf(grid,stitching,"Stitching lines","JO1"),cutting,"Stitching lines")));
    const panel=await screen.findByRole("region",{name:"Uploaded plan"});
    expect(within(panel).getByRole("alert")).toHaveTextContent(/Not applied.*JO1.*STITCHING starts on .* but PREPARATION runs until/);
    expect(within(panel).getByRole("button",{name:"Nothing to apply"})).toBeDisabled();
  });

  it("locks the whole sheet when asked",async()=>{
    const user=userEvent.setup(), onApply=vi.fn(async()=>({saved:2,failed:[]}));
    render(<PlanSheet state={plan()} wcs={wcs} planWith={planWith} onApply={onApply}/>);
    await upload(user,await editedFile(user,()=>{}));
    await user.click(await screen.findByLabelText("Lock every block in the sheet"));
    expect(screen.getByText(/Fix every job where the sheet has it/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button",{name:"Apply 14 changes to the plan"}));
    await waitFor(()=>expect(onApply).toHaveBeenCalled());
    expect(onApply.mock.calls[0][0].map(o=>o.unit_key).sort()).toEqual(["JO1","JO2"]);
  });

  it("refuses a row it cannot read rather than applying the rest of the sheet",async()=>{
    const user=userEvent.setup();
    render(<PlanSheet state={plan()} wcs={wcs} planWith={planWith} onApply={vi.fn()}/>);
    await upload(user,await editedFile(user,grid=>{ grid[6][2]="GOLA PLUS"; grid[7][3]="lots"; }));
    const alert=await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Nothing was applied/);
    expect(alert).toHaveTextContent(/Cell C7: "GOLA PLUS" is not a job on the plan\. Start the cell with the job card number/);
    expect(alert).toHaveTextContent(/Cell D8: pairs must be a whole number of 0 or more, not "lots"/);
    expect(screen.queryByRole("button",{name:/Apply/})).toBeNull();
  });

  it("says so when the file is the factory's own sheet and not the downloaded plan",async()=>{
    const user=userEvent.setup();
    render(<PlanSheet state={plan()} wcs={wcs} planWith={planWith} onApply={vi.fn()}/>);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([["WEEKLY PLANNING - NOVEMBER 2026"],["WEEK 1","","CUTTING"],["02/11","MON","M/C-1","GOLA PLUS",1200]]),"November 2026");
    await upload(user,new File([XLSX.write(wb,{type:"array",bookType:"xlsx"})],"MONTHLY_PLANING_november.xlsx"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/does not look like a plan downloaded from Factory OS/);
  });

  it("still reads a workbook downloaded before the weekly sheet existed",async()=>{
    const user=userEvent.setup(), state=plan();
    const { planRows, sheetRows } = await import("../../shared/plan-sheet.js");
    const to=later(stage(state,"JO1","PACKING").start_date,2);
    render(<PlanSheet state={state} wcs={wcs} planWith={planWith} onApply={vi.fn()}/>);
    const rows=sheetRows(planRows(state,wcs,origin)), wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows.map(r=>r[11]==="JO1::PACKING"?[to,...r.slice(1)]:r)),"Plan");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),"As downloaded");
    await upload(user,new File([XLSX.write(wb,{type:"array",bookType:"xlsx"})],"old-plan.xlsx"));
    const panel=await screen.findByRole("region",{name:"Uploaded plan"});
    expect(within(panel).getByRole("button",{name:"Apply 1 change to the plan"})).toBeEnabled();
  });

  it("lets anyone download, and only those who may edit the schedule upload",()=>{
    render(<PlanSheet state={plan()} wcs={wcs}/>);
    expect(screen.getByRole("button",{name:"Download plan (.xlsx)"})).toBeEnabled();
    expect(screen.queryByRole("button",{name:"Upload edited plan"})).toBeNull();
  });
});
