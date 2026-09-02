import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({listDispatches:vi.fn(),addDispatch:vi.fn(),
  undoDispatch:vi.fn(),hideDispatch:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>({
  listDispatches:mocks.listDispatches,addDispatch:mocks.addDispatch,
  undoDispatch:mocks.undoDispatch,hideDispatch:mocks.hideDispatch,deleteDispatch:mocks.undoDispatch,
}));
import DispatchTab from "../../src/DispatchTab.jsx";

beforeEach(()=>{vi.clearAllMocks();mocks.listDispatches.mockResolvedValue([]);
  mocks.addDispatch.mockResolvedValue({});
  mocks.undoDispatch.mockResolvedValue({});mocks.hideDispatch.mockResolvedValue({});});

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

/* The packing list is the document that travels with the lorry, so it has to
   be reprintable long after the dispatch was keyed in — not only in the moment.
   It was being stored and never rendered again. */
it("reopens a stored packing list from the dispatch history, and offers to print it",async()=>{
  const user=userEvent.setup();
  const order={order_no:"JO1",party:"THE UNIFORM WORLD",article:"SPIKE",article_code:"SPIKE",
               lines:[{combo:"7X10S",qty:240}]};
  const dispatched=[{id:1,order_no:"JO1",dispatched:{"7X10S":56},cartons:{"7X10S":3},
    kind:"partial",dispatched_on:"2026-04-15",closes_order:false,
    packing_list:{customer:"THE UNIFORM WORLD",lines:[
      {article:"SPIKE",closure:"VELCRO",colour:"N.BLUE/RED",
       groups:[{sizes:[{size:"8s",pairs:28}],cartons:1},{sizes:[{size:"9s",pairs:28}],cartons:2}]}]}}];
  render(<DispatchTab orders={[order]} dispatches={dispatched} onChanged={()=>{}}/>);

  await user.click(screen.getByRole("button",{name:"Packing list for JO1"}));

  // The document itself, with its carton numbering computed from the stored counts.
  expect(await screen.findByText("Packing List")).toBeInTheDocument();
  expect(screen.getByText("1/3")).toBeInTheDocument();
  expect(screen.getByText("2-3/3")).toBeInTheDocument();
  expect(screen.getAllByText("THE UNIFORM WORLD").length).toBeGreaterThan(0);
  expect(screen.getByRole("button",{name:"Print / Save PDF"})).toBeInTheDocument();
});

it("does not offer a packing list for a dispatch that never had one",async()=>{
  const order={order_no:"JO1",party:"P",article:"SPIKE",article_code:"SPIKE",lines:[{combo:"7X10S",qty:240}]};
  render(<DispatchTab orders={[order]}
    dispatches={[{id:2,order_no:"JO1",dispatched:{"7X10S":24},kind:"partial",
                  dispatched_on:"2026-04-15",closes_order:false}]}
    onChanged={()=>{}}/>);
  expect(screen.queryByRole("button",{name:"Packing list for JO1"})).toBeNull();
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
/* Undo and delete are DIFFERENT things and must not share a button.
   Undo says the report was mis-keyed — the pairs go back to pending.
   Removing from history says the goods shipped and you just don't want the
   row on screen; the pairs keep counting. */
it("offers undo and hide as separate choices, not one Remove",async()=>{
  const user=userEvent.setup();
  const order={order_no:"JO1",party:"P",article:"SPIKE",article_code:"SPIKE",lines:[{combo:"7X10S",qty:240}]};
  const d=[{id:7,order_no:"JO1",dispatched:{"7X10S":48},kind:"partial",
            dispatched_on:"2026-04-15",closes_order:false}];
  render(<DispatchTab orders={[order]} dispatches={d} onChanged={()=>{}}/>);

  await user.click(screen.getByRole("button",{name:"Remove the JO1 packing report"}));
  expect(screen.getByRole("button",{name:/Undo the JO1 dispatch and put the pairs back/})).toBeInTheDocument();
  expect(screen.getByRole("button",{name:/Remove the JO1 report from the history only/})).toBeInTheDocument();
});

it("undoing puts the pairs back",async()=>{
  const user=userEvent.setup();
  const order={order_no:"JO1",party:"P",article:"SPIKE",article_code:"SPIKE",lines:[{combo:"7X10S",qty:240}]};
  const d=[{id:7,order_no:"JO1",dispatched:{"7X10S":48},kind:"partial",
            dispatched_on:"2026-04-15",closes_order:false}];
  render(<DispatchTab orders={[order]} dispatches={d} onChanged={()=>{}}/>);
  await user.click(screen.getByRole("button",{name:"Remove the JO1 packing report"}));
  await user.click(screen.getByRole("button",{name:/Undo the JO1 dispatch/}));
  await waitFor(()=>expect(mocks.undoDispatch).toHaveBeenCalledWith(7));
  expect(mocks.hideDispatch).not.toHaveBeenCalled();
  expect((await screen.findAllByText(/pending again/)).length).toBeGreaterThan(0);
});

it("removing from history does NOT put the pairs back",async()=>{
  const user=userEvent.setup();
  const order={order_no:"JO1",party:"P",article:"SPIKE",article_code:"SPIKE",lines:[{combo:"7X10S",qty:240}]};
  const d=[{id:7,order_no:"JO1",dispatched:{"7X10S":48},kind:"partial",
            dispatched_on:"2026-04-15",closes_order:false}];
  render(<DispatchTab orders={[order]} dispatches={d} onChanged={()=>{}}/>);
  await user.click(screen.getByRole("button",{name:"Remove the JO1 packing report"}));
  await user.click(screen.getByRole("button",{name:/from the history only/}));
  await waitFor(()=>expect(mocks.hideDispatch).toHaveBeenCalledWith(7));
  expect(mocks.undoDispatch).not.toHaveBeenCalled();
  expect((await screen.findAllByText(/still counts those pairs as dispatched/)).length).toBeGreaterThan(0);
});
