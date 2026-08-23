import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({listDispatches:vi.fn(),addDispatch:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>({
  listDispatches:mocks.listDispatches,addDispatch:mocks.addDispatch,
  deleteDispatch:vi.fn(),
}));
import DispatchTab from "../../src/DispatchTab.jsx";

beforeEach(()=>{vi.clearAllMocks();mocks.listDispatches.mockResolvedValue([]);mocks.addDispatch.mockResolvedValue({});});

it("uses ARMOUR's inherited packing rate for SPIKE dispatch cartons",async()=>{
  const user=userEvent.setup();
  const order={order_no:"JO1",party:"Buyer",article:"SPIKE",article_code:"SPIKE",lines:[{combo:"7X10S",qty:240}]};
  render(<DispatchTab orders={[order]} onChanged={()=>{}}/>);
  await waitFor(()=>expect(mocks.listDispatches).toHaveBeenCalled());
  await user.click(screen.getByRole("button",{name:"Packing report"}));
  expect(screen.getByText("10.00")).toBeInTheDocument();
});
