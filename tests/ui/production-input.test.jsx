import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiMocks=vi.hoisted(()=>({saveProductionActuals:vi.fn(),listProductionActuals:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>apiMocks);

import ProductionInputTab, { workbookFor, mondayOf } from "../../src/ProductionInputTab.jsx";
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
  expect(input["!autofilter"].ref).toBe("A1:M4");
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

it("cannot be saved until something has been typed", async () => {
  render(<ProductionInputTab state={STATE} actuals={[]} onChanged={vi.fn()} replan={()=>STATE} />);
  expect(await screen.findByRole("button",{ name:"Save today's production" })).toBeDisabled();
  expect(apiMocks.saveProductionActuals).not.toHaveBeenCalled();
});
