import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api=vi.hoisted(()=>({listUpperStore:vi.fn(),addUpperMoves:vi.fn(),decideUpperAdjust:vi.fn(),
  setUpperTag:vi.fn(),deleteUpperMove:vi.fn(),getSettings:vi.fn(),listFabricators:vi.fn(),putSettings:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>api);
const ref=vi.hoisted(()=>({REF:{articles:{SPIKE:{combo_order:["7X9"],combos:{"7X9":{sizes:["7","8","9"],rates:{}}}}},materials:{}}}));
vi.mock("../../src/lib/refdata.js",()=>({REF:ref.REF,reload:vi.fn(async()=>{})}));
import UpperStoreTab from "../../src/UpperStoreTab.jsx";

/* 7X9 is the kids run, so its sizes print 7s, 8s, 9s — the grid uses the
   range's own spelling, never a bare numeral. */
const IN={id:1,kind:"in",article:"SPIKE",colour:"BLUE",size:"8s",qty:10,status:"approved",moved_on:"2026-10-01",
  source_type:"line",source:"New Durga Line",order_no:"JO1"};
beforeEach(()=>{
  vi.clearAllMocks();
  api.listUpperStore.mockResolvedValue({moves:[IN],tags:[]});
  api.getSettings.mockResolvedValue({});
  api.listFabricators.mockResolvedValue([]);
  api.addUpperMoves.mockResolvedValue({saved:1,pending:1});
});

it("shows live stock by article, colour and size",async()=>{
  render(<UpperStoreTab role="store" orders={[]} jobs={[]} dispatches={[]} />);
  expect(await screen.findByText("SPIKE")).toBeInTheDocument();
  expect(screen.getByText("BLUE")).toBeInTheDocument();
  expect(screen.getAllByText("10").length).toBeGreaterThan(0);
});

it("a read-only role sees the stock but no entry screens",async()=>{
  render(<UpperStoreTab role="planner" orders={[]} jobs={[]} dispatches={[]} />);
  await screen.findByText("SPIKE");
  expect(screen.queryByRole("tab",{name:"Issue"})).toBeNull();
  expect(screen.getByRole("tab",{name:"Reports"})).toBeInTheDocument();
});

/* "Block issue if stock is short" — said beside the quantities, before the
   server is ever asked. */
it("blocks an issue above what the store holds",async()=>{
  const user=userEvent.setup();
  render(<UpperStoreTab role="store" orders={[{order_no:"JO1",party:"Belgaum",article_code:"SPIKE",lines:[]}]} jobs={[]} dispatches={[]} />);
  await screen.findByText("SPIKE");
  await user.click(screen.getByRole("tab",{name:"Issue"}));
  await user.selectOptions(screen.getByLabelText("Article"),"SPIKE");
  await user.type(screen.getByLabelText("Colour"),"BLUE");
  await user.selectOptions(screen.getByLabelText("Order"),"JO1");
  await user.type(screen.getByLabelText("Uppers of size 8s"),"12");
  await user.click(screen.getByRole("button",{name:/Record 12 uppers/}));
  expect(await screen.findByRole("alert")).toHaveTextContent(/only 10 upper/);
  expect(api.addUpperMoves).not.toHaveBeenCalled();
});

it("a physical count goes in for approval and the keeper cannot approve it",async()=>{
  const user=userEvent.setup();
  api.listUpperStore.mockResolvedValue({moves:[IN,{id:2,kind:"adjust",article:"SPIKE",colour:"BLUE",size:"8s",qty:-2,
    status:"pending",reason:"Physical count: book 10, counted 8",moved_on:"2026-10-29"}],tags:[]});
  render(<UpperStoreTab role="store" orders={[]} jobs={[]} dispatches={[]} />);
  await screen.findByText("SPIKE");
  await user.click(screen.getByRole("tab",{name:/Physical count \(1\)/}));
  expect(screen.getByText(/book 10, counted 8/)).toBeInTheDocument();
  expect(screen.queryByRole("button",{name:"Approve"})).toBeNull();
  await user.selectOptions(screen.getByLabelText("Article"),"SPIKE");
  await user.type(screen.getByLabelText("Colour"),"BLUE");
  await user.type(screen.getByLabelText("Counted size 8s"),"9");
  await user.click(screen.getByRole("button",{name:/Send 1 adjustment for approval/}));
  await waitFor(()=>expect(api.addUpperMoves).toHaveBeenCalled());
  expect(api.addUpperMoves.mock.calls[0][0][0]).toMatchObject({kind:"adjust",size:"8s",qty:-1});
});

it("the store in-charge approves",async()=>{
  const user=userEvent.setup();
  api.listUpperStore.mockResolvedValue({moves:[IN,{id:2,kind:"adjust",article:"SPIKE",colour:"BLUE",size:"8s",qty:-2,
    status:"pending",reason:"count",moved_on:"2026-10-29"}],tags:[]});
  api.decideUpperAdjust.mockResolvedValue({});
  render(<UpperStoreTab role="store_incharge" orders={[]} jobs={[]} dispatches={[]} />);
  await screen.findByText("SPIKE");
  await user.click(screen.getByRole("tab",{name:/Physical count/}));
  await user.click(screen.getByRole("button",{name:"Approve"}));
  expect(api.decideUpperAdjust).toHaveBeenCalledWith(2,"approve");
});
