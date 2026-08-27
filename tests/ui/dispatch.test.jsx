import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({listDispatches:vi.fn(),addDispatch:vi.fn(),deleteDispatch:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>({
  listDispatches:mocks.listDispatches,addDispatch:mocks.addDispatch,deleteDispatch:mocks.deleteDispatch,
}));
import DispatchTab from "../../src/DispatchTab.jsx";

beforeEach(()=>{vi.clearAllMocks();mocks.listDispatches.mockResolvedValue([]);mocks.addDispatch.mockResolvedValue({});mocks.deleteDispatch.mockResolvedValue({});});

it("uses ARMOUR's inherited packing rate for SPIKE dispatch cartons",async()=>{
  const user=userEvent.setup();
  const order={order_no:"JO1",party:"Buyer",article:"SPIKE",article_code:"SPIKE",lines:[{combo:"7X10S",qty:240}]};
  render(<DispatchTab orders={[order]} dispatches={[]} onChanged={()=>{}}/>);
  /* Dispatch events arrive as a prop. This screen must NOT fetch its own copy:
     two copies meant the dispatch screen and the dashboard could report
     different totals for the same day, whichever refreshed last winning. */
  expect(mocks.listDispatches).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Packing report"}));
  expect(screen.getByText("10.00")).toBeInTheDocument();
});

/* A packing report can be mis-keyed. Removing one returns its pairs to the
   order's pending balance — a correction, not a way to hide a shipment, which
   is why it is confirmed and says what it did. */
it("removes a packing report and says the pairs are pending again",async()=>{
  const user=userEvent.setup();
  const order={order_no:"JO1",party:"Buyer",article:"SPIKE",article_code:"SPIKE",lines:[{combo:"7X10S",qty:240}]};
  const onChanged=vi.fn();
  render(<DispatchTab orders={[order]}
    dispatches={[{id:7,order_no:"JO1",dispatched:{"7X10S":48},kind:"partial",dispatched_on:"2026-08-25"}]}
    onChanged={onChanged}/>);

  await user.click(screen.getByLabelText("Remove the JO1 packing report"));
  expect(mocks.deleteDispatch).not.toHaveBeenCalled();          // one click must not destroy
  expect(screen.getByText(/Put these pairs back\?/)).toBeInTheDocument();

  await user.click(screen.getByLabelText("Confirm removing the JO1 packing report"));
  await waitFor(()=>expect(mocks.deleteDispatch).toHaveBeenCalledWith(7));
  expect(await screen.findByText(/48 pair\(s\) are pending again on JO1/)).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalled();                          // every tab re-reads
});
