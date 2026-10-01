import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({ saveGatePass:vi.fn() }));
vi.mock("../../src/lib/client.js",()=>({ saveGatePass:mocks.saveGatePass }));
import GatePassTab from "../../src/GatePassTab.jsx";
import { REF } from "../../src/lib/refdata.js";

/* The live demo dispatch: ARMOUR 2X5, 23 full cartons and one mixed box. */
const ORDER={order_no:"JO2173",party:"DEMO",article_code:"ARMOUR (LACE)",
  pi:{customer_city:"Ludhiana"},lines:[{combo:"2X5",qty:1000}]};
const sheet={customer:"DEMO",order_no:"JO2173",lines:[{article:"ARMOUR (LACE)",closure:"Lace",colour:"Black",combo:"2X5",
  groups:[{sizes:[{size:"2",pairs:108}],cartons:6},{sizes:[{size:"3",pairs:108}],cartons:6},
          {sizes:[{size:"4",pairs:108}],cartons:6},{sizes:[{size:"5",pairs:90}],cartons:5},
          {sizes:[{size:"2",pairs:2},{size:"3",pairs:4},{size:"4",pairs:4},{size:"5",pairs:1}],cartons:1,mixed:true}]}]};
const D15={id:15,order_no:"JO2173",dispatched_on:"2026-09-30",packing_list:sheet,gate_pass:null};
const D9={id:9,order_no:"JO2112",dispatched_on:"2026-09-19",packing_list:{...sheet,customer:"Deiom India",order_no:"JO2112"},
  gate_pass:{serial_no:"15941",transporter:"",city:""}};

beforeEach(()=>{ vi.clearAllMocks();
  REF.mrp={...(REF.mrp||{}),"ARMOUR (LACE)":{"2X5":949}};
  mocks.saveGatePass.mockImplementation(async (id,g)=>({id,gate_pass:{...g,saved_by:"a"}})); });

const slipRows=slip=>[...slip.querySelectorAll("tbody tr")]
  .filter(r=>/^\d+$/.test(r.children[0]?.textContent||"")&&r.children[9]?.textContent);

it("lists every dispatch with a packing list, newest first, and says which have no SR. No",async()=>{
  const user=userEvent.setup();
  render(<GatePassTab dispatches={[D9,D15,{id:3,order_no:"JO1",dispatched_on:"2026-09-01"}]} orders={[ORDER]} />);
  await user.click(screen.getByRole("button",{name:"All"}));
  const rows=[...document.querySelector("tbody").children];
  expect(rows).toHaveLength(2);                        // the one with no packing list has no slip
  expect(rows[0].textContent).toMatch(/JO2173/);       // 30 Sept before 19 Sept
  expect(rows[0].textContent).toMatch(/not written/);
  expect(rows[1].textContent).toMatch(/15941/);
  expect(screen.getByText(/1 dispatch was recorded without a packing list/)).toBeInTheDocument();
});

it("opens a slip with the pack, the MRP and the city it should carry",async()=>{
  const user=userEvent.setup();
  render(<GatePassTab dispatches={[D15]} orders={[ORDER]} focusId={15} />);
  const slip=(await screen.findByText("GATE PASS SLIP")).closest(".gate-pass");
  expect(slip.textContent).toMatch(/LUDHIANA/);                    // from the PI
  expect(slip.textContent).toMatch(/2 x 2, 3 x 4, 4 x 4, 5 x 1/);  // the mixed box
  const rows=slipRows(slip);
  expect(rows.map(r=>r.children[8].textContent)).toEqual(["18","18","18","18","11"]);
  expect(rows.map(r=>r.children[7].textContent)).toEqual(["949","949","949","949","949"]);
  expect(rows.map(r=>r.children[9].textContent)).toEqual(["108","108","108","90","11"]);
  expect(slip.textContent).toMatch(/425/);
  expect(slip.textContent).not.toMatch(/no (MRP|standard pack) on record/);
});

it("saves what is written by hand, and will not print a slip that differs from the saved one",async()=>{
  const user=userEvent.setup();
  render(<GatePassTab dispatches={[D15]} orders={[ORDER]} focusId={15} />);
  await screen.findByText("GATE PASS SLIP");
  await user.type(screen.getByLabelText("SR. No from the book"),"15946");
  await user.type(screen.getByLabelText("Transporter"),"A.B.C. Transport");
  expect(screen.getByRole("button",{name:"Print / Save PDF"})).toBeDisabled();
  expect(screen.getByText(/Unsaved — save before printing/)).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:"Save"}));
  await waitFor(()=>expect(mocks.saveGatePass).toHaveBeenCalledWith(15,
    {serial_no:"15946",transporter:"A.B.C. Transport",city:""}));
  expect(await screen.findByText(/saved as SR\. No 15946/)).toBeInTheDocument();
  expect(screen.getByRole("button",{name:"Print / Save PDF"})).toBeEnabled();
  const slip=screen.getByText("GATE PASS SLIP").closest(".gate-pass");
  expect(slip.textContent).toMatch(/15946/);
  expect(slip.textContent).toMatch(/A\.B\.C\. TRANSPORT/);
});

it("refuses an SR. No already on another slip before it reaches the server",async()=>{
  const user=userEvent.setup();
  render(<GatePassTab dispatches={[D9,D15]} orders={[ORDER]} focusId={15} />);
  await screen.findByText("GATE PASS SLIP");
  await user.type(screen.getByLabelText("SR. No from the book"),"15941");
  expect(screen.getByRole("alert").textContent).toMatch(/15941 is already on the gate pass for JO2112/);
  expect(screen.getByRole("button",{name:"Save"})).toBeDisabled();
  expect(mocks.saveGatePass).not.toHaveBeenCalled();
});

it("finds a slip by its SR. No",async()=>{
  const user=userEvent.setup();
  render(<GatePassTab dispatches={[D9,D15]} orders={[ORDER]} />);
  await user.click(screen.getByRole("button",{name:"All"}));
  await user.type(screen.getByLabelText("Search gate passes"),"15941");
  const body=document.querySelector("tbody");
  expect(within(body).queryByText("JO2173")).toBeNull();
  expect(within(body).getByText("JO2112")).toBeInTheDocument();
});
