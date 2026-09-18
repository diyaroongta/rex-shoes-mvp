import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiMocks=vi.hoisted(()=>({uploadBom:vi.fn(),patchReference:vi.fn(),
  referenceHistory:vi.fn(),restoreReference:vi.fn(),assignProductCodes:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>apiMocks);

/* A master in three states at once, which is the real thing this view is for:
   GOLA LACE is fully rated, GOLA VELCRO is part loaded, and GOLA PLUS has four
   size ranges and not one rate. The tracker would mark all three "GOLA · Done". */
vi.mock("../../src/lib/refdata.js",()=>({
  REF:{
    articles:{
      "GOLA LACE BLACK (BLACK SKINFIT)":{sole_type:"PVC",combo_order:["1X3","4X5"],
        combos:{"1X3":{rates:{CUTTING:{"REXINE||MTR":0.5}}},"4X5":{rates:{CUTTING:{"REXINE||MTR":0.6}}}}},
      "GOLA VELCRO BLACK (BLACK SKINFIT)":{sole_type:"PVC",combo_order:["1X3","4X5"],
        combos:{"1X3":{rates:{CUTTING:{"REXINE||MTR":0.5}}},"4X5":{rates:{}}}},
      "REX GOLA PLUS":{sole_type:"PVC",combo_order:["7X10","11X1","2X5","6X12B"],
        combos:{"7X10":{rates:{}},"11X1":{rates:{}},"2X5":{rates:{}},"6X12B":{rates:{}}}},
    },
    materials:{"REXINE||MTR":{name:"REXINE",uom:"MTR",stock:0}},packing:{},mrp:{},
  },
  reload:vi.fn(async()=>{}),
}));

import DataTab from "../../src/DataTab.jsx";

beforeEach(()=>{ vi.clearAllMocks(); apiMocks.referenceHistory.mockResolvedValue([]); });

/* A tracker row says somebody DID the entry. It cannot say the entry arrived
   intact — GOLA was marked Done while its master had no range covering the
   adult 6, which dropped cartons off two invoices in silence. */
it("shows what the master actually holds, so a Done row can be checked",async()=>{
  render(<DataTab/>);

  // Rolled up by FAMILY, because that is the level the tracker is written at.
  expect(screen.getByText("BOM coverage")).toBeInTheDocument();
  expect(screen.getByText("GOLA")).toBeInTheDocument();
  expect(screen.getByText("REX GOLA PLUS")).toBeInTheDocument();

  /* The silent state named outright. An article the master does not hold is
     refused loudly; one with ranges and no rates plans and books capacity
     while requiring zero material. */
  expect(screen.getByText("No rates")).toBeInTheDocument();
  expect(screen.getByText(/2 families not fully loaded/)).toBeInTheDocument();
});

/* Per-article, because a family is only as loaded as its least loaded variant
   and the fix is made against one article, not a family. */
it("names the individual ranges that carry no rates",async()=>{
  const user=userEvent.setup();
  render(<DataTab/>);
  await user.click(screen.getByRole("button",{name:"Show every article"}));

  expect(screen.getByText("GOLA VELCRO BLACK (BLACK SKINFIT)")).toBeInTheDocument();
  // The one unrated range of the part-loaded variant, named.
  expect(screen.getByText("4X5")).toBeInTheDocument();
  // And all four of the silent one.
  expect(screen.getByText("7X10, 11X1, 2X5, 6X12B")).toBeInTheDocument();
});
