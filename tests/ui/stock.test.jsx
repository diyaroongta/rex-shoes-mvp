import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const apiMocks=vi.hoisted(()=>({patchReference:vi.fn(),addMaterial:vi.fn(),listMaterialIssues:vi.fn()}));
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
  expect(screen.getByRole("tab",{name:"View Stock"})).toHaveAttribute("aria-selected","true");
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
  await user.click(screen.getByRole("tab",{name:"Add Stock"}));

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
  await user.click(screen.getByRole("tab",{name:"Add Stock"}));
  await user.type(screen.getByLabelText("Material to receive"),"mesh");
  await user.click(within(screen.getByRole("listbox")).getByRole("option",{name:/MESH/}));
  await user.type(screen.getByLabelText("Quantity received"),"0");
  expect(screen.getByRole("button",{name:"Add to stock"})).toBeDisabled();
  expect(apiMocks.patchReference).not.toHaveBeenCalled();
});

it("offers to add a material the search cannot find",async()=>{
  const user=userEvent.setup();
  render(<StockTab/>);
  await user.click(screen.getByRole("tab",{name:"Add Stock"}));
  await user.type(screen.getByLabelText("Material to receive"),"velcro 25mm");
  await user.click(screen.getByRole("button",{name:"Add it as a new material"}));
  expect(screen.getByLabelText("Material name")).toHaveValue("velcro 25mm");
});

/* Finished goods (MTS / MTO) moved to Dispatch → Finished goods; their tests
   are in tests/ui/finished-goods.test.jsx. This screen is raw material only. */
it("no longer carries finished goods — they are shoes, not raw material",()=>{
  render(<StockTab/>);
  expect(screen.queryByRole("tab",{name:"Finished Goods"})).toBeNull();
  expect(screen.queryByRole("tab",{name:"MTO Stock"})).toBeNull();
});

/* Add Item is its own page, and records who supplies it — plus, from the
   client's store notes, the item code, category, size and supplier terms. */
it("adds a new item with its code, category, size, supplier, rate and terms",async()=>{
  const user=userEvent.setup();
  apiMocks.addMaterial.mockResolvedValue({ok:true});
  render(<StockTab mode="material"/>);
  expect(screen.queryByRole("tab",{name:"Add Stock"})).toBeNull();            // a page, not a tab strip
  await user.type(screen.getByLabelText("Material name"),"EVA SHEET");
  await user.type(screen.getByLabelText("Unit of measure"),"PCS");
  await user.type(screen.getByLabelText("Supplier name"),"Shree Polymers");
  await user.type(screen.getByLabelText("Supplier rate"),"42.5");
  await user.type(screen.getByLabelText("Dispatch location"),"Bahadurgarh");
  await user.type(screen.getByLabelText("Item code"),"rm-sol-001");
  await user.selectOptions(screen.getByLabelText("Category"),"SOLE");
  await user.type(screen.getByLabelText("Item size"),"5c");
  await user.type(screen.getByLabelText("Supplier terms"),"30 days credit");
  /* The size is folded into the name, as the stock sheet keeps one row per size. */
  expect(screen.getByText("EVA SHEET 5C||PCS")).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"Add item"}));
  expect(apiMocks.addMaterial).toHaveBeenCalledWith(expect.objectContaining({
    name:"EVA SHEET",uom:"PCS",supplier:"Shree Polymers",supplier_rate:42.5,dispatch_location:"Bahadurgarh",
    sku:"RM-SOL-001",category:"SOLE",size:"5C",terms:"30 days credit"}));
});

/* How a material leaves the store is set per material. Unset is not a third
   mode: it is released with the job order, as it always has been. */
it("sets how a material is issued, and says what an unset one does",async()=>{
  const user=userEvent.setup();
  render(<StockTab/>);
  await user.click(screen.getByText("REXINE 54\" BLACK"));
  expect(screen.getByText(/not set, so it is released with the job order/)).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"Correct figures"}));
  await user.selectOptions(screen.getByLabelText("How REXINE 54\" BLACK is issued"),"on_demand");
  await user.click(screen.getByRole("button",{name:"Save"}));
  expect(apiMocks.patchReference).toHaveBeenCalledWith({stock_meta:{"REXINE 54\" BLACK||MTR":{issue_mode:"on_demand"}}});
});

it("shows which job cards a material went to, when asked",async()=>{
  const key="REXINE 54\" BLACK||MTR";
  apiMocks.listMaterialIssues.mockResolvedValue([
    {id:1,job_id:12,material_key:key,type:"issue",qty:16,moved_on:"2026-11-01",fabricator:"Rex Internal",article:"SPIKE",order_no:"JO1"},
    {id:2,job_id:12,material_key:key,type:"return",qty:2,moved_on:"2026-11-04",fabricator:"Rex Internal",article:"SPIKE",order_no:"JO1"},
  ]);
  const user=userEvent.setup();
  render(<StockTab/>);
  await user.click(screen.getByText("REXINE 54\" BLACK"));
  expect(apiMocks.listMaterialIssues).not.toHaveBeenCalled();       // only when asked for
  await user.click(screen.getByRole("button",{name:"Where it went"}));
  const trail=await screen.findByRole("table",{name:"Where REXINE 54\" BLACK went"});
  expect(apiMocks.listMaterialIssues).toHaveBeenCalledWith({material_key:key});
  expect(within(trail).getByText("Rex Internal")).toBeInTheDocument();
  expect(within(trail).getByText("14 MTR")).toBeInTheDocument();    // 16 issued, 2 back
});
