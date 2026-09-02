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

/* The screen used to show a carton figure derived as pairs / packing rate —
   "10.00" for 240 pairs. The factory's own packing list counts cartons instead,
   and it has to: sizes inside one range do not pack alike, and a fraction of a
   carton cannot go on a lorry. The derived column is gone. */
it("does not derive a carton count from the packing rate any more",async()=>{
  const user=userEvent.setup();
  const order={order_no:"JO1",party:"Buyer",article:"SPIKE",article_code:"SPIKE",lines:[{combo:"7X10S",qty:240}]};
  render(<DispatchTab orders={[order]} dispatches={[]} onChanged={()=>{}}/>);
  /* Dispatch events arrive as a prop. This screen must NOT fetch its own copy:
     two copies meant the dispatch screen and the dashboard could report
     different totals for the same day, whichever refreshed last winning. */
  expect(mocks.listDispatches).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button",{name:"Packing report"}));
  expect(screen.queryByText("10.00")).toBeNull();
  expect(screen.getByRole("button",{name:"Fill in the packing list"})).toBeInTheDocument();
});

it("counts cartons per size on the packing list, and totals what was entered",async()=>{
  const user=userEvent.setup();
  const order={order_no:"JO1",party:"THE UNIFORM WORLD",article:"SPIKE",article_code:"SPIKE",
               pi:{vl:"VELCRO",upper_colour:"N.BLUE/RED"},lines:[{combo:"7X10S",qty:240}]};
  render(<DispatchTab orders={[order]} dispatches={[]} onChanged={()=>{}}/>);
  await user.click(screen.getByRole("button",{name:"Packing report"}));
  await user.click(screen.getByRole("button",{name:"Fill in the packing list"}));

  // The article, closure and colour come across so they are not re-keyed.
  expect(screen.getByText(/VELCRO/)).toBeInTheDocument();
  expect(screen.getByText(/N\.BLUE\/RED/)).toBeInTheDocument();

  // Cartons are typed, not computed.
  const cartons=screen.getAllByLabelText(/^Cartons for size/);
  expect(cartons.length).toBeGreaterThan(0);
  await user.clear(cartons[0]); await user.type(cartons[0],"3");
  // The running total is split across elements, so match on the container.
  await waitFor(()=>{
    const summary=screen.getByText("Packing list").parentElement.textContent.replace(/\s+/g," ");
    expect(summary).toMatch(/3 cartons/);
  });
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
  // Shown twice on purpose: once at the top, once beside the history table
  // where the button actually is.
  expect((await screen.findAllByText(/48 pair\(s\) are pending again on JO1/)).length).toBe(2);
  expect(onChanged).toHaveBeenCalled();                          // every tab re-reads
});
