import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../src/lib/refdata.js",async()=>{
  const { INPUTS } = await import("../../shared/inputs.js");
  return { REF:INPUTS, reload:vi.fn(async()=>{}) };
});
vi.mock("../../src/lib/today.js",()=>({ todayIso:()=>"2026-07-06" }));
/* The real library, with the one call that would start a browser download
   captured instead — so the test edits the very workbook the app produced. */
const saved=vi.hoisted(()=>({ wb:null, name:"" }));
vi.mock("xlsx",async orig=>{
  const real=await orig();
  return { ...real, writeFile:vi.fn((wb,name)=>{ saved.wb=wb; saved.name=name; }) };
});

import * as XLSX from "xlsx";
import PlanSheet from "../../src/PlanSheet.jsx";
import { compute, fromDay, dayIndex } from "../../shared/engine.js";
import { INPUTS } from "../../shared/inputs.js";

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

beforeEach(()=>{ vi.clearAllMocks(); saved.wb=null; });

/* Download, then hand back the workbook with `edit` applied to its Plan sheet. */
async function editedFile(user, edit){
  await user.click(screen.getByRole("button",{name:"Download plan (.xlsx)"}));
  const wb=XLSX.read(XLSX.write(saved.wb,{type:"array",bookType:"xlsx"}));
  const grid=XLSX.utils.sheet_to_json(wb.Sheets.Plan,{header:1,raw:true,defval:""});
  const col=Object.fromEntries(grid[0].map((h,i)=>[String(h).replace(/ \(.*/,""),i]));
  edit(grid,col);
  wb.Sheets.Plan=XLSX.utils.aoa_to_sheet(grid);
  return new File([XLSX.write(wb,{type:"array",bookType:"xlsx"})],"plan-edited.xlsx");
}
const upload=(user,file)=>user.upload(screen.getByLabelText("Upload an edited plan workbook"),file);

describe("the plan as a spreadsheet",()=>{
  it("downloads the plan with the sheet to edit, the plan as downloaded, and how to edit it",async()=>{
    const user=userEvent.setup();
    render(<PlanSheet state={plan()} wcs={wcs} planWith={planWith} onApply={vi.fn()}/>);
    await user.click(screen.getByRole("button",{name:"Download plan (.xlsx)"}));
    expect(saved.name).toBe("production-plan-2026-07-06.xlsx");
    expect(saved.wb.SheetNames).toEqual(["Plan","As downloaded","Week view","How to edit"]);
    const grid=XLSX.utils.sheet_to_json(saved.wb.Sheets.Plan,{header:1});
    expect(grid[0].slice(0,4)).toEqual(["Date","Day","Stage","Work centre"]);
    expect(grid.length).toBeGreaterThan(14);
    expect(screen.getByRole("status")).toHaveTextContent(/Plan downloaded/);
  });

  it("shows what an edited sheet changes before saving anything, then applies it",async()=>{
    const user=userEvent.setup(), onApply=vi.fn(async()=>({saved:1,failed:[]}));
    const state=plan();
    const to=later(stage(state,"JO1","PACKING").start_date,2);
    render(<PlanSheet state={state} wcs={wcs} planWith={planWith} onApply={onApply}/>);
    const file=await editedFile(user,(grid,col)=>{ grid.find(r=>r[col.Ref]==="JO1::PACKING")[col.Date]=to; });
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
    await upload(user,await editedFile(user,(grid,col)=>{ for(const r of grid) if(r[col.Ref]==="JO1::STITCHING") r[col.Date]=cutting; }));
    const panel=await screen.findByRole("region",{name:"Uploaded plan"});
    expect(within(panel).getByRole("alert")).toHaveTextContent(/Not applied.*JO1.*STITCHING starts on .* but PREPARATION runs until/);
    expect(within(panel).getByRole("button",{name:"Nothing to apply"})).toBeDisabled();
  });

  it("locks the whole sheet when asked",async()=>{
    const user=userEvent.setup(), onApply=vi.fn(async()=>({saved:2,failed:[]}));
    render(<PlanSheet state={plan()} wcs={wcs} planWith={planWith} onApply={onApply}/>);
    await upload(user,await editedFile(user,()=>{}));
    await user.click(await screen.findByLabelText("Lock every block in the sheet"));
    await user.click(await screen.findByRole("button",{name:"Apply 14 changes to the plan"}));
    await waitFor(()=>expect(onApply).toHaveBeenCalled());
    expect(onApply.mock.calls[0][0].map(o=>o.unit_key).sort()).toEqual(["JO1","JO2"]);
  });

  it("refuses a row it cannot read rather than applying the rest of the sheet",async()=>{
    const user=userEvent.setup();
    render(<PlanSheet state={plan()} wcs={wcs} planWith={planWith} onApply={vi.fn()}/>);
    await upload(user,await editedFile(user,(grid,col)=>{ grid[3][col.Date]="next week"; grid[5][col.Pairs]="lots"; }));
    const alert=await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Nothing was applied/);
    expect(alert).toHaveTextContent(/Row 4: "next week" is not a date/);
    expect(alert).toHaveTextContent(/Row 6: Pairs must be a whole number/);
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

  it("lets anyone download, and only those who may edit the schedule upload",()=>{
    render(<PlanSheet state={plan()} wcs={wcs}/>);
    expect(screen.getByRole("button",{name:"Download plan (.xlsx)"})).toBeEnabled();
    expect(screen.queryByRole("button",{name:"Upload edited plan"})).toBeNull();
  });
});
