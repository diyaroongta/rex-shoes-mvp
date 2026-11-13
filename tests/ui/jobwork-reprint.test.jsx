import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({ listFabricators:vi.fn(), listJobWork:vi.fn(), receiveJobWork:vi.fn() }));
vi.mock("../../src/lib/client.js",()=>({
  listFabricators:mocks.listFabricators, listJobWork:mocks.listJobWork, receiveJobWork:mocks.receiveJobWork }));
import JobWorkTab from "../../src/JobWorkTab.jsx";

/* The job card as it was ISSUED — the snapshot stored on the job row. */
const ISSUED = { id:"77", fabricator:"Rex Internal", fabricator_type:"internal_line",
  article:"SPIKE", order_no:"JO1", qty:60, received:0, shortage:0, status:"issued",
  slip:"Internal Issue Slip", rate:0, payable:false, issued_on:new Date(2026,10,2).toISOString(),   // a date column, as the API sends it: the server's midnight
  card:{ article:"SPIKE", order_no:"JO1", fabricator:"Rex Internal", date:"2026-11-02", card_no:"",
    lines:[{ combo:"7X10S", qty:60, sizes:{ "7s":20, "8s":20, "9s":20 }, size_order:["7s","8s","9s"] }] } };

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.listFabricators.mockResolvedValue([
    { name:"Rex Internal", type:"internal_line", rate:0, tat_days:0, payable:false, active:true }]);
  mocks.listJobWork.mockResolvedValue([ISSUED]);
});

/* A job card's PDF can fail half-way, and the floor still needs the pairs and
   sizes on it. It is reopened from the Job Orders Database, from the snapshot
   taken when it was issued, carrying its own job order number. */
it("reopens an issued job card and prints it again",async()=>{
  const written=[];
  const fake={ document:{ open(){}, write(html){ written.push(html); }, close(){} } };
  const open=vi.spyOn(window,"open").mockReturnValue(fake);
  const user=userEvent.setup();
  render(<JobWorkTab />);

  await user.click(await screen.findByRole("button",{name:"Job card"}));
  expect(screen.getByText(/Job order 77 — SPIKE · JO1/)).toBeInTheDocument();
  /* The day it was keyed, as a date — never the raw timestamp, and never a
     day early because the server keeps its midnight in another zone. */
  expect(screen.getByText(/As issued on 2 Nov 2026/)).toBeInTheDocument();
  expect(screen.queryByText(/T\d\d:\d\d:\d\d/)).toBeNull();

  await user.click(screen.getByRole("button",{name:"Reprint / Save PDF"}));
  expect(open).toHaveBeenCalled();
  expect(written.join("")).toContain("job-card");
  expect(written.join("")).toContain("77");
  open.mockRestore();

  await user.click(screen.getByRole("button",{name:"Close"}));
  expect(screen.queryByText(/Job order 77 — SPIKE/)).toBeNull();
});

/* A row from before card snapshots existed has nothing to reprint, so it is
   offered the slip only — never an empty card. */
it("offers no job card for a row issued without one",async()=>{
  mocks.listJobWork.mockResolvedValue([{ ...ISSUED, card:null }]);
  render(<JobWorkTab />);
  await screen.findByRole("button",{name:"Slip"});
  expect(screen.queryByRole("button",{name:"Job card"})).toBeNull();
});

/* JOB CARDS ARE WHAT THE PLAN IS BUILT FROM. Work received here closes a card
   and moves the Production plan, the dashboard and the Order Book — but this
   screen reloaded only its own list, so every other screen went on showing the
   plan from before until the page was reloaded. */
it("tells the rest of the app when work is received",async()=>{
  const changed=vi.fn();
  mocks.receiveJobWork.mockResolvedValue({ fabricator:"Rex Internal", received:60, qty:60, shortage:0 });
  const user=userEvent.setup();
  render(<JobWorkTab onChanged={changed}/>);
  await user.click(await screen.findByRole("button",{name:"Receive"}));
  expect(changed).not.toHaveBeenCalled();                       // nothing changes by opening the form
  const back=screen.getByLabelText("Pieces back from Rex Internal");
  expect(back).toHaveValue(60);                                  // offered: everything still out
  await user.clear(back); await user.type(back,"60");
  await user.click(screen.getByRole("button",{name:"Record"}));
  expect(await screen.findByRole("status")).toHaveTextContent("Rex Internal: 60 of 60 back.");
  expect(mocks.receiveJobWork).toHaveBeenCalledWith("77",60,false);
  expect(changed).toHaveBeenCalledTimes(1);
});
