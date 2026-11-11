import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api=vi.hoisted(()=>({listJobWork:vi.fn(),listMaterialIssues:vi.fn(),addMaterialIssue:vi.fn(),
  undoMaterialIssue:vi.fn(),listFabricators:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>api);
const REXINE="REXINE 54\" BLACK||MTR", THREAD="THREAD||SPOOL", GLUE="GLUE||KG";
const ref=vi.hoisted(()=>({REF:{
  articles:{SPIKE:{combos:{"2X5":{rates:{CUTTING:{"REXINE 54\" BLACK||MTR":0.05},STITCHING:{"THREAD||SPOOL":0.01}}}}}},
  materials:{
    "REXINE 54\" BLACK||MTR":{name:"REXINE 54\" BLACK",uom:"MTR",stock:90},
    "THREAD||SPOOL":{name:"THREAD",uom:"SPOOL",stock:40},
    "GLUE||KG":{name:"GLUE",uom:"KG",stock:5},
  },
  stock_meta:{"THREAD||SPOOL":{opening:40,issue_mode:"on_demand"}},
}}));
vi.mock("../../src/lib/refdata.js",()=>({REF:ref.REF,reload:vi.fn(async()=>{})}));

import IssueMaterialTab, { CardMaterials } from "../../src/IssueMaterialTab.jsx";
import JobWorkTab from "../../src/JobWorkTab.jsx";

/* 200 pairs: the BOM calls for 10 MTR of rexine and 2 spools of thread. */
const JOB={id:"12",fabricator:"Rex Internal",fabricator_type:"internal_line",article:"SPIKE",order_no:"JO1",
  qty:200,received:0,shortage:0,status:"issued",rate:0,payable:false,issued_on:"2026-11-03",
  card:{lines:[{combo:"2X5",qty:200}]}};
const RELEASED={id:1,job_id:12,material_key:REXINE,name:"REXINE 54\" BLACK",uom:"MTR",type:"issue",
  basis:"job_order",qty:10,moved_on:"2026-11-03",note:"Released with job card 12",moved_by:"planner"};

beforeEach(()=>{
  vi.clearAllMocks();
  api.listJobWork.mockResolvedValue([JOB,{...JOB,id:"13",cancelled:true}]);
  api.listMaterialIssues.mockResolvedValue([RELEASED]);
  api.listFabricators.mockResolvedValue([]);
});
const account=()=>screen.getByRole("table",{name:"Material account for job card 12"});
const rowOf=name=>within(account()).getByText(name).closest("tr");

it("shows one job card's material account: BOM, issued, kept and still to issue",async()=>{
  const user=userEvent.setup();
  render(<IssueMaterialTab/>);
  /* A cancelled card takes no material and is not offered. */
  const pick=await screen.findByLabelText("Job card");
  expect(within(pick).queryByRole("option",{name:/^13 /})).toBeNull();
  await user.selectOptions(pick,"12");

  /* Rexine went out with the job order: 10 of 10, done. */
  expect(rowOf("REXINE 54\" BLACK")).toHaveTextContent("By job order");
  expect(rowOf("REXINE 54\" BLACK")).toHaveTextContent("not set");
  expect(rowOf("REXINE 54\" BLACK")).toHaveTextContent("done");
  /* Thread is on demand: nothing was released, the whole 2 is still to issue. */
  expect(rowOf("THREAD")).toHaveTextContent("On demand");
  expect(rowOf("THREAD")).not.toHaveTextContent("done");
  expect(screen.getByText("1 material still to issue")).toBeInTheDocument();
  expect(screen.getByText("With the job order")).toBeInTheDocument();
});

it("issues an on-demand material against the card and says it is updated",async()=>{
  api.addMaterialIssue.mockResolvedValue({movements:[{id:2,job_id:12,material_key:THREAD,name:"THREAD",uom:"SPOOL",
    type:"issue",basis:"on_demand",qty:2,moved_on:"2026-11-10",note:"",moved_by:"keeper"}],warnings:[]});
  const onChanged=vi.fn();
  const user=userEvent.setup();
  render(<IssueMaterialTab onChanged={onChanged}/>);
  await user.selectOptions(await screen.findByLabelText("Job card"),"12");
  expect(screen.getByRole("button",{name:"Save issue"})).toBeDisabled();

  /* One click puts each remaining BOM quantity in its box; nothing is saved. */
  await user.click(screen.getByRole("button",{name:"Fill what is still to issue"}));
  expect(screen.getByLabelText("Issue now THREAD")).toHaveValue(2);
  expect(screen.getByLabelText("Issue now REXINE 54\" BLACK")).toHaveValue(null);
  expect(api.addMaterialIssue).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button",{name:"Save issue"}));
  await waitFor(()=>expect(api.addMaterialIssue).toHaveBeenCalled());
  expect(api.addMaterialIssue.mock.calls[0][0]).toMatchObject({job_id:"12",type:"issue",
    lines:[{material_key:THREAD,qty:2}]});
  expect(await screen.findByText(/1 material issued to job card 12/)).toBeInTheDocument();
  /* The account moves without a reload, and the entry boxes are cleared. */
  expect(rowOf("THREAD")).toHaveTextContent("done");
  expect(screen.getByText("Everything the BOM calls for has been issued")).toBeInTheDocument();
  expect(screen.getByLabelText("Issue now THREAD")).toHaveValue(null);
  expect(onChanged).toHaveBeenCalled();
});

it("warns before saving more than the BOM, and still lets it be saved",async()=>{
  const user=userEvent.setup();
  render(<IssueMaterialTab/>);
  await user.selectOptions(await screen.findByLabelText("Job card"),"12");
  await user.type(screen.getByLabelText("Issue now THREAD"),"5");
  expect(screen.getByText(/This will still be saved/).parentElement)
    .toHaveTextContent("THREAD: this takes the card to 5 SPOOL against a BOM requirement of 2.");
  expect(screen.getByRole("button",{name:"Save issue"})).toBeEnabled();
});

it("lets the keeper issue a material the BOM never asked for, flagged as such",async()=>{
  const user=userEvent.setup();
  render(<IssueMaterialTab/>);
  await user.selectOptions(await screen.findByLabelText("Job card"),"12");
  await user.type(screen.getByLabelText("Add another material"),"glu");
  await user.click(screen.getByRole("button",{name:/GLUE/}));
  expect(rowOf("GLUE")).toHaveTextContent("not on the BOM");
  await user.type(screen.getByLabelText("Issue now GLUE"),"1");
  expect(screen.getByText(/This will still be saved/).parentElement).toHaveTextContent("GLUE is not on this card's BOM.");
});

it("refuses a return of more than the card holds before anything is sent",async()=>{
  const user=userEvent.setup();
  render(<IssueMaterialTab/>);
  await user.selectOptions(await screen.findByLabelText("Job card"),"12");
  await user.click(screen.getByRole("tab",{name:"Take back into the store"}));
  await user.type(screen.getByLabelText("Take back REXINE 54\" BLACK"),"11");
  expect(screen.getByRole("alert")).toHaveTextContent("only 10 MTR is out against job card 12");
  expect(screen.getByRole("button",{name:"Save return"})).toBeDisabled();
  await user.clear(screen.getByLabelText("Take back REXINE 54\" BLACK"));
  await user.type(screen.getByLabelText("Take back REXINE 54\" BLACK"),"4");
  expect(screen.getByRole("button",{name:"Save return"})).toBeEnabled();
});

it("undoes a mis-keyed entry only after it is confirmed",async()=>{
  api.undoMaterialIssue.mockResolvedValue({id:1,undone:true,note:"Undone. 10 MTR of REXINE 54\" BLACK is back on the register."});
  const user=userEvent.setup();
  render(<IssueMaterialTab/>);
  await user.selectOptions(await screen.findByLabelText("Job card"),"12");
  await user.click(screen.getByRole("button",{name:"Undo"}));
  expect(api.undoMaterialIssue).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Yes, undo"}));
  expect(await screen.findByText(/is back on the register/)).toBeInTheDocument();
  expect(api.undoMaterialIssue).toHaveBeenCalledWith(1);
  expect(screen.getByText("Nothing has been logged against this card.")).toBeInTheDocument();
});

it("is read-only for a role that may not issue: the account shows, nothing can be typed",async()=>{
  const user=userEvent.setup();
  render(<IssueMaterialTab canWrite={false}/>);
  await user.selectOptions(await screen.findByLabelText("Job card"),"12");
  expect(account()).toBeInTheDocument();
  expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  expect(screen.queryByRole("button",{name:"Save issue"})).toBeNull();
  expect(screen.queryByRole("button",{name:"Undo"})).toBeNull();
});

it("says a card with nothing logged may predate the log, rather than calling it un-issued",async()=>{
  api.listMaterialIssues.mockResolvedValue([]);
  render(<CardMaterials job={JOB}/>);
  expect(await screen.findByText(/A card raised before the issue log existed/)).toBeInTheDocument();
  expect(api.listMaterialIssues).toHaveBeenCalledWith({job_id:"12"});
});

it("opens a job order's material account from the Job Orders Database",async()=>{
  api.listJobWork.mockResolvedValue([JOB]);
  api.listFabricators.mockResolvedValue([
    {name:"Rex Internal",type:"internal_line",rate:0,tat_days:0,payable:false,active:true}]);
  const user=userEvent.setup();
  render(<JobWorkTab allowDirectIssue={false}/>);
  await user.click(await screen.findByRole("button",{name:"Materials"}));
  expect(await screen.findByRole("table",{name:"Material account for job card 12"})).toBeInTheDocument();
  expect(api.listMaterialIssues).toHaveBeenCalledWith({job_id:"12"});
});
