import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiMocks=vi.hoisted(()=>({patchReference:vi.fn(),addMaterial:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>apiMocks);
const ref=vi.hoisted(()=>({REF:{
  materials:{
    "REXINE 54\" BLACK||MTR":{name:"REXINE 54\" BLACK",uom:"MTR",stock:130},
    "MESH 58\" WHITE||MTR":{name:"MESH 58\" WHITE",uom:"MTR",stock:0},
    "PP BAG||PCS":{name:"PP BAG",uom:"PCS",stock:0},
  },
  stock_meta:{
    "REXINE 54\" BLACK||MTR":{opening:100,rec:40,issue:10,min_stock:200,rate:85},
    "MESH 58\" WHITE||MTR":{opening:60,rec:0,issue:0,min_stock:10},
  },
}}));
vi.mock("../../src/lib/refdata.js",()=>({REF:ref.REF,reload:vi.fn(async()=>{})}));

import StockTab from "../../src/StockTab.jsx";

beforeEach(()=>{ vi.clearAllMocks(); apiMocks.patchReference.mockResolvedValue({ok:true}); });

/* Looking and changing used to be one grid of two hundred inputs. They are two
   views now, and View stock changes nothing unless a row is deliberately
   opened and corrected. */
it("opens on a read-only view of the store with the numbers that matter on top",async()=>{
  const user=userEvent.setup();
  render(<StockTab/>);
  expect(screen.getByRole("tab",{name:"View stock"})).toHaveAttribute("aria-selected","true");
  expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);          // nothing editable by default

  // 100 + 40 − 10 = 130, below its minimum of 200.
  // (Each status is rendered twice — once as a column, once under the name for
  // phones — and jsdom applies no CSS, so both copies are present here.)
  expect(screen.getAllByText("Below minimum",{selector:"span"}).length).toBeGreaterThan(0);
  expect(screen.getAllByText("order 70").length).toBeGreaterThan(0);
  // PP BAG has no figure at all — unfilled, not zero.
  expect(screen.getAllByText("Not counted").length).toBeGreaterThan(0);

  // The tiles are the filters.
  await user.click(screen.getByRole("button",{name:/Below minimum/}));
  expect(screen.getByText("REXINE 54\" BLACK")).toBeInTheDocument();
  expect(screen.queryByText("MESH 58\" WHITE")).not.toBeInTheDocument();

  // Opening a row shows the arithmetic behind the figure.
  await user.click(screen.getByText("REXINE 54\" BLACK"));
  expect(screen.getByText("Received")).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Correct figures"})).toBeInTheDocument();
});

/* A delivery is ADDED on the server, never totalled in the browser — two
   people booking deliveries at once must both land. */
it("books a delivery as an addition, not a new running total",async()=>{
  const user=userEvent.setup();
  render(<StockTab/>);
  await user.click(screen.getByRole("tab",{name:"Add stock"}));

  expect(screen.getByRole("button",{name:"Add to stock"})).toBeDisabled();
  await user.type(screen.getByLabelText("Material to receive"),"rexine");
  await user.click(within(screen.getByRole("listbox")).getByRole("option",{name:/REXINE 54" BLACK/}));
  await user.type(screen.getByLabelText("Quantity received"),"25");
  expect(screen.getByText(/Stock will go from/)).toHaveTextContent("130");
  expect(screen.getByText(/Stock will go from/)).toHaveTextContent("155");

  await user.click(screen.getByRole("button",{name:"Add to stock"}));
  expect(apiMocks.patchReference).toHaveBeenCalledWith({stock_meta:{"REXINE 54\" BLACK||MTR":{rec_add:25}}});
  expect(screen.getByText("+25 MTR")).toBeInTheDocument();
});

it("refuses a delivery of nothing",async()=>{
  const user=userEvent.setup();
  render(<StockTab/>);
  await user.click(screen.getByRole("tab",{name:"Add stock"}));
  await user.type(screen.getByLabelText("Material to receive"),"mesh");
  await user.click(within(screen.getByRole("listbox")).getByRole("option",{name:/MESH/}));
  await user.type(screen.getByLabelText("Quantity received"),"0");
  expect(screen.getByRole("button",{name:"Add to stock"})).toBeDisabled();
  expect(apiMocks.patchReference).not.toHaveBeenCalled();
});

it("offers to add a material the search cannot find",async()=>{
  const user=userEvent.setup();
  render(<StockTab/>);
  await user.click(screen.getByRole("tab",{name:"Add stock"}));
  await user.type(screen.getByLabelText("Material to receive"),"velcro 25mm");
  await user.click(screen.getByRole("button",{name:"Add it as a new material"}));
  expect(screen.getByLabelText("Material name")).toHaveValue("velcro 25mm");
});
