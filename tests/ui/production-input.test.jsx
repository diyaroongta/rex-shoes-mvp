import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiMocks=vi.hoisted(()=>({saveProductionActuals:vi.fn(),listProductionActuals:vi.fn(),
  listJobCardDocs:vi.fn(async()=>[]),uploadJobCardDoc:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>apiMocks);

import ProductionInputTab, { workbookFor, mondayOf, plusDays } from "../../src/ProductionInputTab.jsx";
import { INPUTS } from "../../shared/inputs.js";
import { dayIndex } from "../../shared/engine.js";
import { todayIso } from "../../src/lib/today.js";

/* The screen shows the CURRENT Monday-to-Saturday week, so the fixture has to
   be planned inside it — a row dated last August is correctly not on screen. */
const MONDAY = mondayOf(todayIso());
const DAY = dayIndex(MONDAY, INPUTS.origin);

beforeEach(()=>{
  vi.clearAllMocks();
  apiMocks.saveProductionActuals.mockResolvedValue({saved:1});
});

/* One order, planned, with a card on the board — enough for the screen to
   draw a row the floor can type a number against. */
const STATE = {
  orders:[{ order_no:"JO9500", party:"Deiom India", article_code:"SMART BOY (L) BLACK",
            article:"SMART BOY (L) BLACK", qty:500, pending_pairs:500, lines:[{combo:"6X8",qty:500}],
            dispatch_date:"2026-09-27", sla:"on_track", stages:[] }],
  units:[{ unit_key:"JO9500#JC41", order_no:"JO9500", card_no:"JC41", party:"Deiom India",
           article:"SMART BOY (L) BLACK", qty:500, lines:[{combo:"6X8",qty:500}],
           dispatch_date:"2026-09-27", sla:"on_track",
           stages:[{ stage:"CUTTING", work_center:"CUTTING", instant:false,
                     start:DAY, end:DAY, alloc:{ [DAY]:500 },
                     start_date:MONDAY, end_date:MONDAY }] }],
  procurement:[], daily_load:{},
};


it("downloads the supplied Monday-to-Saturday machine planning layout",()=>{
  const rows=[
    {production_on:"2026-09-21",work_center:"CUTTING",stage:"Cutting",job_card_no:"JC-1",
      order_no:"JO1",article:"BOLT",size_ranges:"4X9",party:"A2Z",planned_pairs:100,actual_pairs:90,unit_key:"u1"},
    {production_on:"2026-09-21",work_center:"CUTTING",stage:"Cutting",job_card_no:"JC-2",
      order_no:"JO2",article:"GOLA",size_ranges:"7X12",party:"MTS",planned_pairs:50,actual_pairs:null,unit_key:"u2"},
    {production_on:"2026-09-22",work_center:"STITCHING",stage:"Stitching",job_card_no:"JC-3",
      order_no:"JO3",article:"JEM",size_ranges:"1X6",party:"RANGOLI",planned_pairs:72,actual_pairs:70,unit_key:"u3"},
  ];
  const wb=workbookFor(rows,"2026-09-21");
  const weekly=wb.Sheets["Weekly Planning Output"];
  const input=wb.Sheets["Daily Input"];

  expect(weekly.A1.v).toContain("2026-09-21 to 2026-09-26");
  expect(weekly.B3.v).toBe("JOB DETAILS");
  expect(weekly.C3.v).toBe("PROPOSED / ACTUAL QTY");
  expect(weekly.B4.v).toContain("JC NO: JC-1");
  expect(weekly.B4.v).toContain("ARTICLE NAME: BOLT");
  expect(weekly.C4.v).toContain("PROPOSED: 100");
  expect(weekly.C4.v).toContain("ACTUAL: 90");
  expect(Object.values(weekly).some(cell=>cell?.v==="SAT\n2026-09-26")).toBe(true);
  expect(Object.values(weekly).some(cell=>String(cell?.v||"").includes("PROPOSED: 150"))).toBe(true);
  expect(input.A1.v).toBe("Production Date");
  expect(input.K1.v).toBe("Achieved Pairs");
  expect(input["!autofilter"].ref).toBe("A1:S4");
});

/* TYPED ON THE SCREEN. The factory's ask (T-104) was that the ERP asks for
   production against the planned job cards — downloading a workbook, filling
   it in and uploading it again is three steps for one number. */
it("records production typed straight into the table, and says what it changed", async () => {
  const user = userEvent.setup();
  render(<ProductionInputTab state={STATE} actuals={[]} onChanged={vi.fn()} replan={()=>STATE} />);

  const box = await screen.findByLabelText(/Pairs achieved for JC41/);
  await user.type(box, "425");
  await user.click(screen.getByRole("button",{ name:"Save today's production" }));

  await waitFor(()=>expect(apiMocks.saveProductionActuals).toHaveBeenCalled());
  const [rows] = apiMocks.saveProductionActuals.mock.calls[0];
  expect(rows).toHaveLength(1);
  expect(rows[0].actual_pairs).toBe(425);
  expect(rows[0].unit_key).toBe("JO9500#JC41");
  /* Not just "saved" — the screen reports the consequence. */
  expect(await screen.findByText("What this entry changed")).toBeInTheDocument();
});

/* THE JOB CARD FILLS ITSELF from what is typed with the production figure. */
it("records rejection, repair and the people on the line with the pairs", async () => {
  const user = userEvent.setup();
  render(<ProductionInputTab state={STATE} actuals={[]} onChanged={vi.fn()} replan={()=>STATE} />);
  await user.type(await screen.findByLabelText(/Pairs achieved for JC41/), "425");
  await user.click(screen.getByRole("button",{ name:/Job card details for JC41/ }));
  await user.type(screen.getByLabelText(/^Rejected for JC41/), "5");
  await user.type(screen.getByLabelText(/^Sent for repair for JC41/), "8");
  await user.type(screen.getByLabelText(/^People on the line for JC41/), "12");
  expect(screen.getByText(/no photo yet — open/)).toBeInTheDocument();
  await user.click(screen.getByRole("button",{ name:"Save today's production" }));
  await waitFor(()=>expect(apiMocks.saveProductionActuals).toHaveBeenCalled());
  const [rows] = apiMocks.saveProductionActuals.mock.calls[0];
  expect(rows[0]).toMatchObject({ actual_pairs:425, rejected_pairs:5, repair_pairs:8, operators:12 });
});

it("refuses more rejected and repaired pairs than were made", async () => {
  const user = userEvent.setup();
  render(<ProductionInputTab state={STATE} actuals={[]} onChanged={vi.fn()} replan={()=>STATE} />);
  await user.type(await screen.findByLabelText(/Pairs achieved for JC41/), "10");
  await user.click(screen.getByRole("button",{ name:/Job card details for JC41/ }));
  await user.type(screen.getByLabelText(/^Rejected for JC41/), "11");
  await user.click(screen.getByRole("button",{ name:"Save today's production" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/cannot exceed/);
  expect(apiMocks.saveProductionActuals).not.toHaveBeenCalled();
});

/* The re-plan a dispatch date can absorb. The card still ships the same day,
   so the panel used to say "No job card's own dates moved" while cutting's
   balance had just gone to the next day. */
it("names the stages the entry re-planned even when dispatch did not move", async () => {
  const user = userEvent.setup();
  const NEXT = plusDays(MONDAY, 1);
  const AFTER = { ...STATE, units:[{ ...STATE.units[0],
    stages:[{ ...STATE.units[0].stages[0], start:DAY+1, end:DAY+1, alloc:{ [DAY+1]:75 },
              start_date:NEXT, end_date:NEXT }] }] };
  render(<ProductionInputTab state={STATE} actuals={[]} onChanged={vi.fn()} replan={()=>AFTER} />);
  await user.type(await screen.findByLabelText(/Pairs achieved for JC41/), "425");
  await user.click(screen.getByRole("button",{ name:"Save today's production" }));
  expect(await screen.findByText("Stages re-planned")).toBeInTheDocument();
  expect(screen.getByText(/card JC41/)).toBeInTheDocument();
  expect(screen.queryByText("No job card's own dates moved.")).toBeNull();
});

it("cannot be saved until something has been typed", async () => {
  render(<ProductionInputTab state={STATE} actuals={[]} onChanged={vi.fn()} replan={()=>STATE} />);
  expect(await screen.findByRole("button",{ name:"Save today's production" })).toBeDisabled();
  expect(apiMocks.saveProductionActuals).not.toHaveBeenCalled();
});

/* HOW THE FLOOR ACTUALLY REPORTS IT.
   The screen showed a whole week as one flat list of number boxes, so
   reporting a day meant finding its rows among five other days' and filling
   them one at a time. A day that ran to plan is one click now, and a line
   that ran at about 85% is one figure — which is how it is said out loud.
   Nothing is pre-filled and nothing auto-saves: these write into the boxes,
   every figure stays visible and editable, and Save is still its own press. */
it("fills a whole day at a percentage of plan, and still asks to be saved",async()=>{
  const user=userEvent.setup();
  render(<ProductionInputTab state={STATE} actuals={[]} onChanged={async()=>{}} />);

  const box = await screen.findByLabelText(/Pairs achieved for JC41/);
  expect(box).toHaveValue(null);                       // nothing is pre-filled

  const pct = screen.getByLabelText("Percent of plan achieved");
  await user.clear(pct); await user.type(pct, "85");
  await user.click(screen.getByRole("button",{name:"Apply"}));

  expect(box).toHaveValue(425);                        // 85% of the 500 planned
  expect(apiMocks.saveProductionActuals).not.toHaveBeenCalled();  // still an assertion

  await user.click(screen.getByRole("button",{name:"Save today's production"}));
  await waitFor(()=>expect(apiMocks.saveProductionActuals).toHaveBeenCalled());
  expect(apiMocks.saveProductionActuals.mock.calls[0][0][0].actual_pairs).toBe(425);
});

it("fills a day that ran to plan in one click",async()=>{
  const user=userEvent.setup();
  render(<ProductionInputTab state={STATE} actuals={[]} onChanged={async()=>{}} />);
  await screen.findByLabelText(/Pairs achieved for JC41/);
  await user.click(screen.getByRole("button",{name:"Ran to plan"}));
  expect(screen.getByLabelText(/Pairs achieved for JC41/)).toHaveValue(500);
});

/* A row's own shortcut, for the commonest entry of all. */
it("marks one row as having run to plan",async()=>{
  const user=userEvent.setup();
  render(<ProductionInputTab state={STATE} actuals={[]} onChanged={async()=>{}} />);
  await screen.findByLabelText(/Pairs achieved for JC41/);
  await user.click(screen.getByLabelText(/JC41 CUTTING ran to plan/));
  expect(screen.getByLabelText(/Pairs achieved for JC41/)).toHaveValue(500);
});

/* Typing is one thing; knowing what you have typed is another. The totals
   used to appear only after saving. */
it("totals what has been entered before it is saved",async()=>{
  const user=userEvent.setup();
  render(<ProductionInputTab state={STATE} actuals={[]} onChanged={async()=>{}} />);
  await screen.findByLabelText(/Pairs achieved for JC41/);
  // The figures sit in their own <b> tags, so match on the line's whole text.
  const line = () => document.body.textContent.replace(/\s+/g," ");
  expect(line()).toMatch(/0 of 500 pairs/);
  await user.click(screen.getByRole("button",{name:"Ran to plan"}));
  expect(line()).toMatch(/500 of 500 pairs/);
  expect(line()).toMatch(/100% · 1 of 1 rows/);
});
