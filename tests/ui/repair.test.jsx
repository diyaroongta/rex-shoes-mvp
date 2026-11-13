import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({ listRepairs:vi.fn(), deleteRepair:vi.fn() }));
vi.mock("../../src/lib/client.js",()=>({ listRepairs:mocks.listRepairs, deleteRepair:mocks.deleteRepair }));
vi.mock("../../src/lib/refdata.js",async()=>{
  const { INPUTS } = await import("../../shared/inputs.js");
  return { REF:INPUTS, reload:vi.fn(async()=>{}) };
});
import RepairTab from "../../src/RepairTab.jsx";

const SENT={ id:9, order_no:"JO1", article:"SPIKE", size:"8s", kind:"sent", qty:12, moved_on:"2026-11-10", note:"sole open" };

beforeEach(()=>{ vi.clearAllMocks(); mocks.listRepairs.mockResolvedValue([SENT]); mocks.deleteRepair.mockResolvedValue({}); });

/* PAIRS ON THE REPAIR BENCH ARE HELD BACK FROM DISPATCH. Recording a movement
   told the rest of the app; removing a wrong one did not, so the Dispatch Book
   went on holding pairs that were no longer on the bench until the page was
   reloaded. Every screen that writes reports it. */
it("tells the rest of the app when a repair movement is removed",async()=>{
  const changed=vi.fn();
  const user=userEvent.setup();
  render(<RepairTab orders={[]} dispatches={[]} onChanged={changed}/>);
  await user.click(await screen.findByTitle("Remove this movement"));
  expect(changed).not.toHaveBeenCalled();                        // asking is not doing
  await user.click(screen.getByRole("button",{name:"Remove"}));
  expect(await screen.findByText("That movement was removed from the repair record.")).toBeInTheDocument();
  expect(mocks.deleteRepair).toHaveBeenCalledWith(9);
  expect(changed).toHaveBeenCalledTimes(1);
});
