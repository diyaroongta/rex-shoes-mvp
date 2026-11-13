import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({
  listFabricators:vi.fn(), listJobWork:vi.fn(), issueJobWork:vi.fn(), listUpperStore:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>({
  listFabricators:mocks.listFabricators, listJobWork:mocks.listJobWork,
  issueJobWork:mocks.issueJobWork, listUpperStore:mocks.listUpperStore }));
import JobCardTab from "../../src/JobCardTab.jsx";

/* STOCK FIRST, where the job order is raised. An order still waiting for its
   stock decision cannot be carded; one that uses ready stock is carded for the
   balance only, and the pairs whose uppers are in the store get their own card
   that starts at moulding. */
const ORDER = { order_no:"JO1", party:"Buyer", article_code:"SPIKE", article:"SPIKE", order_date:"2026-09-01",
  lines:[{ combo:"7X10S", qty:300, sizes:{ "7s":100, "8s":100, "9s":100 }, size_order:["7s","8s","9s"] }] };
const DECIDED = { ...ORDER, stock_status:"decided",
  stock_allocation:{ mode:"use", sizes:{ "7s":{ fg:60, upper:{} }, "8s":{ fg:0, upper:{ "8s":40 } } } } };

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.listFabricators.mockResolvedValue([
    { name:"Rex Internal", type:"internal_line", rate:0, tat_days:0, payable:false, active:true }]);
  mocks.listJobWork.mockResolvedValue([]);
  mocks.issueJobWork.mockImplementation(async payload=>({ id:31, order_no:"JO1", qty:payload.qty,
    received:0, status:"issued", card:payload.card }));
});
const choose=async user=>{
  await user.selectOptions(await screen.findByLabelText("Send to"), "Rex Internal");
  await user.selectOptions(await screen.findByLabelText("Current Order"), "JO1");
};

it("will not raise a job order while the order waits for its stock decision",async()=>{
  const user=userEvent.setup();
  render(<JobCardTab orders={[{ ...ORDER, stock_status:"awaiting" }]} />);
  await choose(user);
  expect(await screen.findByRole("alert")).toHaveTextContent(/JO1 is waiting for its stock decision/);
  expect(screen.getByRole("button",{name:/Preview Job Order/i})).toBeDisabled();
});

it("an order from before stock decisions existed is carded exactly as it always was",async()=>{
  const user=userEvent.setup();
  render(<JobCardTab orders={[ORDER]} />);
  await choose(user);
  expect(await screen.findByLabelText("7X10S size 7s pairs")).toHaveValue(100);
  expect(screen.queryByText(/uses ready stock/)).toBeNull();
});

it("offers only the balance to make in full — finished-goods pairs are never carded",async()=>{
  const user=userEvent.setup();
  render(<JobCardTab orders={[DECIDED]} />);
  await user.selectOptions(await screen.findByLabelText("Send to"), "Rex Internal");
  /* 300 ordered − 60 from finished goods = 240 left to card in all. */
  expect(await screen.findByRole("option",{name:/JO1 · SPIKE · Buyer · .* · 240 left/})).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Current Order"), "JO1");
  expect(await screen.findByText(/This order uses ready stock/)).toBeInTheDocument();
  expect(screen.getByText(/60 come from finished goods and are not made/)).toBeInTheDocument();
  expect(screen.getByLabelText("7X10S size 7s pairs")).toHaveValue(40);
  expect(screen.getByLabelText("7X10S size 8s pairs")).toHaveValue(60);
  expect(screen.getByLabelText("7X10S size 9s pairs")).toHaveValue(100);
});

it("raises the upper-stock pairs on their own card, starting at moulding",async()=>{
  const user=userEvent.setup();
  render(<JobCardTab orders={[DECIDED]} />);
  await choose(user);
  await user.click(await screen.findByLabelText("Card starting at moulding from upper stock"));
  expect(screen.getByLabelText("7X10S size 8s pairs")).toHaveValue(40);
  expect(screen.getByLabelText("7X10S size 7s pairs")).toHaveValue(0);
  expect(screen.getByText(/Nothing is cut or stitched for this card/)).toBeInTheDocument();
  await user.click(screen.getByRole("button",{name:/Preview Job Order/i}));
  await user.click(await screen.findByRole("button",{name:/Confirm & Create Job Order/i}));
  await waitFor(()=>expect(mocks.issueJobWork).toHaveBeenCalled());
  const sent=mocks.issueJobWork.mock.calls[0][0];
  expect(sent.qty).toBe(40);
  expect(sent.card.start_stage).toBe("MOLDING");
  /* The line carries it too, so the material booked out begins at moulding. */
  expect(sent.card.lines).toEqual([expect.objectContaining({ combo:"7X10S", qty:40, from_stage:"MOLDING" })]);
  expect(sent.card.lines[0].sizes["8s"]).toBe(40);
});

it("a full-routing card does not carry a start stage",async()=>{
  const user=userEvent.setup();
  render(<JobCardTab orders={[DECIDED]} />);
  await choose(user);
  await user.click(await screen.findByRole("button",{name:/Preview Job Order/i}));
  await user.click(await screen.findByRole("button",{name:/Confirm & Create Job Order/i}));
  await waitFor(()=>expect(mocks.issueJobWork).toHaveBeenCalled());
  const sent=mocks.issueJobWork.mock.calls[0][0];
  expect(sent.qty).toBe(200);
  expect(sent.card.start_stage).toBeUndefined();
  expect(sent.card.lines[0].from_stage).toBeUndefined();
});

/* ONE COLOUR RULE with the upper store's shortage report and the stock
   decision: only uppers of the order's own colour count, and the others on the
   shelf are named rather than counted — "short, blue on the shelf", not "none". */
it("checks a moulding card's uppers in the order's own colour and names the others",async()=>{
  const IN=(colour,qty)=>({ id:qty, kind:"in", article:"SPIKE", colour, size:"8s", qty, source_type:"line",
    source:"New Durga Line", mts:true, moved_on:"2026-10-01", status:"approved" });
  mocks.listUpperStore.mockResolvedValue({ moves:[IN("BLUE",50), IN("BLACK",10)], tags:[] });
  const user=userEvent.setup();
  render(<JobCardTab orders={[{ ...DECIDED, pi:{ upper_colour:"Black" } }]} />);
  await choose(user);
  await user.click(await screen.findByLabelText("Card starting at moulding from upper stock"));
  const alert=await screen.findByText(/Uppers are short in the upper store/);
  expect(alert.parentElement).toHaveTextContent("SPIKE · BLACK");
  expect(alert.parentElement).toHaveTextContent("size 8s — 40 wanted, 10 on the shelf (not counted: 50 BLUE)");
});
