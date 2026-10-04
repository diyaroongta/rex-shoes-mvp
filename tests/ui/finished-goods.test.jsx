import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api=vi.hoisted(()=>({addFinishedStock:vi.fn(),deleteFinishedStock:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>api);
const ref=vi.hoisted(()=>({REF:{articles:{SPIKE:{combo_order:["2X5"],combos:{"2X5":{rates:{}}}}},materials:{}}}));
vi.mock("../../src/lib/refdata.js",()=>({REF:ref.REF,reload:vi.fn(async()=>{})}));
import FinishedGoodsTab from "../../src/FinishedGoodsTab.jsx";

const state={orders:[],procurement_by_order:{}};
beforeEach(()=>{ vi.clearAllMocks(); api.addFinishedStock.mockResolvedValue({saved:1}); });

/* SHOES MADE FOR STOCK. A job card with no Order Book row is the factory's own
   work; one with an order_no belongs to that customer and is counted there. */
it("counts only stock job cards, plus the ledger, as MTS stock",()=>{
  render(<FinishedGoodsTab state={state} moves={[{id:1,article:"SPIKE",size:"2",qty:10,kind:"opening"}]} jobs={[
    {article:"SPIKE",order_no:"JO1",qty:500,received:500,status:"closed",card:{lines:[{combo:"2X5",sizes:{"2":500}}]}},
    {article:"SPIKE",order_no:null,qty:300,received:300,status:"closed",card:{lines:[{combo:"2X5",sizes:{"2":150,"3":150}}]}},
  ]}/>);
  expect(screen.getByText("SPIKE")).toBeInTheDocument();
  expect(screen.getAllByText("310").length).toBeGreaterThan(0);   // 300 from the card + 10 opening
  expect(screen.queryByText("810")).toBeNull();                   // never the customer's pairs
});

it("says when the sizes of finished pairs are not known",()=>{
  render(<FinishedGoodsTab state={state} moves={[]} jobs={[
    {article:"JILL",order_no:null,qty:300,received:200,status:"partial",card:{lines:[{combo:"2X5",sizes:{"2":150,"3":150}}]}},
  ]}/>);
  expect(screen.getByText(/200 pairs back on part-received stock cards, size not recorded/)).toBeInTheDocument();
});

it("says plainly when nothing is in finished stock",()=>{
  render(<FinishedGoodsTab state={state} moves={[]} jobs={[]}/>);
  expect(screen.getByText(/Nothing is recorded in finished stock yet/)).toBeInTheDocument();
});

it("enters an opening count size by size",async()=>{
  const user=userEvent.setup();
  const onChanged=vi.fn();
  render(<FinishedGoodsTab state={state} moves={[]} jobs={[]} onChanged={onChanged}/>);
  await user.click(screen.getByRole("tab",{name:"Enter stock"}));
  await user.selectOptions(screen.getByLabelText("Article"),"SPIKE");
  await user.type(screen.getByLabelText("Pairs of size 3"),"36");
  await user.click(screen.getByRole("button",{name:/Record 36 pairs/}));
  await waitFor(()=>expect(api.addFinishedStock).toHaveBeenCalledWith([
    expect.objectContaining({article:"SPIKE",size:"3",kind:"opening",qty:36})]));
});

it("refuses an issue that does not name the order",async()=>{
  const user=userEvent.setup();
  render(<FinishedGoodsTab state={state} moves={[]} jobs={[]}/>);
  await user.click(screen.getByRole("tab",{name:"Enter stock"}));
  await user.selectOptions(screen.getByLabelText("Article"),"SPIKE");
  await user.selectOptions(screen.getByLabelText("Movement kind"),"issued");
  await user.type(screen.getByLabelText("Pairs of size 2"),"5");
  await user.click(screen.getByRole("button",{name:/Record 5 pairs/}));
  expect(screen.getByRole("alert")).toHaveTextContent(/Name the order/);
  expect(api.addFinishedStock).not.toHaveBeenCalled();
});

it("hides entry from a read-only role",()=>{
  render(<FinishedGoodsTab state={state} moves={[]} jobs={[]} readOnly/>);
  expect(screen.queryByRole("tab",{name:"Enter stock"})).toBeNull();
});
