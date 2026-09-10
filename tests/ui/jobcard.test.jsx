import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({
  listFabricators:vi.fn(), listJobWork:vi.fn(), issueJobWork:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>({
  listFabricators:mocks.listFabricators, listJobWork:mocks.listJobWork,
  issueJobWork:mocks.issueJobWork }));
import JobCardTab from "../../src/JobCardTab.jsx";

const ORDER = { order_no:"JO1", party:"Buyer", article_code:"SPIKE", article:"SPIKE",
  order_date:"2026-09-01",
  lines:[{ combo:"7X10S", qty:60, sizes:{ "7s":20, "8s":20, "9s":20 },
           size_order:["7s","8s","9s"] }] };

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.listFabricators.mockResolvedValue([
    { name:"Rex Internal", type:"internal_line", rate:0, tat_days:0, payable:false, active:true }]);
  mocks.listJobWork.mockResolvedValue([]);
});

/* Issuing a job order REDUCES the Order Book balance by exactly the pairs just
   issued. The draft quantities stayed on screen, so the next render compared a
   SPENT draft against the reduced balance and accused the clerk of
   over-assigning the very pairs they had just successfully assigned — a red
   error sitting under a successful action. */
it("a successful job order does not report itself as an error",async()=>{
  mocks.issueJobWork.mockImplementation(async payload=>({
    id:77, fabricator:"Rex Internal", fabricator_type:"internal_line",
    article:"SPIKE", order_no:"JO1", qty:payload.qty, received:0,
    status:"issued", rate:0, payable:false,
    /* The server echoes the card back, which is what makes the balance drop. */
    card:payload.card }));

  const user=userEvent.setup();
  render(<JobCardTab orders={[ORDER]} />);

  await user.selectOptions(await screen.findByLabelText("Send to"), "Rex Internal");
  const pick = await screen.findByLabelText("Current Order");
  await user.selectOptions(pick, "JO1");

  await user.click(await screen.findByRole("button",{name:/Preview Job Order/i}));
  await user.click(await screen.findByRole("button",{name:/Confirm & Create Job Order/i}));

  await screen.findByText(/Job order 77 created/i);
  /* The whole point. */
  await waitFor(()=>
    expect(screen.queryByText(/More than the unassigned balance/i)).toBeNull());
});

/* The warning is still real while the card is a DRAFT — it must not be
   disabled outright, only stopped from firing on an already-issued card. */
it("still warns when a draft really does exceed the balance",async()=>{
  const user=userEvent.setup();
  render(<JobCardTab orders={[ORDER]} />);
  await user.selectOptions(await screen.findByLabelText("Send to"), "Rex Internal");
  await user.selectOptions(await screen.findByLabelText("Current Order"), "JO1");

  const box = await screen.findByLabelText("7X10S size 7s pairs");
  await user.clear(box); await user.type(box, "999");
  expect(await screen.findByText(/More than the unassigned balance/i)).toBeInTheDocument();
});
