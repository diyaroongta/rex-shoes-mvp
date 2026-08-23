import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({
  listOrders:vi.fn(),getSettings:vi.fn(),putSettings:vi.fn(),listPis:vi.fn(),
  getReference:vi.fn(),getCatalogue:vi.fn(),listParties:vi.fn(),
  createOrders:vi.fn(),patchReference:vi.fn(),saveParty:vi.fn(),
  schedulePi:vi.fn(),
}));

vi.mock("../../src/lib/client.js",()=>({
  ...mocks,
  setPriority:vi.fn(),deleteOrder:vi.fn(),deleteAllOrders:vi.fn(),patchOrder:vi.fn(),
  schedulePi:mocks.schedulePi,listDispatches:vi.fn(async()=>[]),addDispatch:vi.fn(),deleteDispatch:vi.fn(),
  uploadBom:vi.fn(),putCatalogue:vi.fn(),deleteCatalogue:vi.fn(),removeParty:vi.fn(),
  readOrderPhoto:vi.fn(),readPi:vi.fn(),askCopilot:vi.fn(),
}));

import App from "../../src/App.jsx";
import ArticleRulesTab from "../../src/ArticleRulesTab.jsx";
import PartiesTab from "../../src/PartiesTab.jsx";

beforeEach(()=>{
  vi.clearAllMocks();
  mocks.listOrders.mockResolvedValue([]);
  mocks.getSettings.mockResolvedValue({});
  mocks.putSettings.mockResolvedValue({});
  mocks.listPis.mockResolvedValue([]);
  mocks.getCatalogue.mockResolvedValue({});
  mocks.listParties.mockResolvedValue([]);
  mocks.createOrders.mockResolvedValue([{order_no:"JO9001"}]);
  mocks.patchReference.mockResolvedValue({ok:true});
  mocks.saveParty.mockResolvedValue({name:"Test Buyer"});
  mocks.schedulePi.mockResolvedValue({restored:["JO77"]});
});

describe("critical UI contracts",()=>{
  it("keeps a PI draft mounted while the clerk visits another tab",async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Enter by hand"}));
    expect(screen.getByText("2 · Match & check")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Bulk upload"}));
    expect(screen.getByText("Add orders from a spreadsheet")).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"PI generation"}));
    expect(screen.getByText("2 · Match & check")).toBeInTheDocument();
  });

  it("marks a generated PI stale as soon as Match & Check changes",async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Enter by hand"}));
    await user.type(screen.getByLabelText("Customer *"),"Test Buyer");
    await user.type(screen.getByLabelText("Order nature *"),"MTO");
    await user.type(screen.getByLabelText("Upper colour *"),"Navy");
    const carton=screen.getAllByLabelText(/cartons$/)[0];
    await user.clear(carton);await user.type(carton,"1");
    await user.click(screen.getByRole("button",{name:"Generate PI from these edits"}));
    expect(screen.getByRole("button",{name:/Save & send 1 order/})).toBeEnabled();
    await user.type(screen.getByLabelText("Upper colour *")," Blue");
    expect(screen.getByText(/Match & Check has changed since this PI was generated/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:/Save & send 1 order/})).toBeDisabled();
  });

  it("saves SPIKE packing edits back to ARMOUR, its declared source list",async()=>{
    const user=userEvent.setup();
    render(<ArticleRulesTab/>);
    await user.selectOptions(screen.getByLabelText("Article"),"SPIKE");
    const ppc=screen.getAllByRole("spinbutton")[0];
    await user.clear(ppc);await user.type(ppc,"30");
    await user.click(screen.getByRole("button",{name:"Save packing changes"}));
    await waitFor(()=>expect(mocks.patchReference).toHaveBeenCalled());
    const payload=mocks.patchReference.mock.calls[0][0];
    expect(payload.packing.ARMOUR).toBeDefined();
    expect(payload.packing.SPIKE).toBeUndefined();
  });

  it("adds a party without exposing dispatch-timeline editing",async()=>{
    const user=userEvent.setup();
    render(<PartiesTab/>);
    await user.click(screen.getByRole("button",{name:"Add party"}));
    await user.type(screen.getByLabelText("Party name"),"Test Buyer");
    expect(screen.queryByLabelText(/dispatch timeline/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Save party"}));
    await waitFor(()=>expect(mocks.saveParty).toHaveBeenCalledWith(expect.objectContaining({name:"Test Buyer"})));
  });

  it("uses locked party-master terms on the PI instead of an editable discount",async()=>{
    mocks.listParties.mockResolvedValue([{name:"Test Buyer",discount_pct:35,deductions:[],gst_pct:5,payment_split_pct:50}]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Enter by hand"}));
    await user.type(screen.getByLabelText("Customer *"),"Test Buyer");
    await user.type(screen.getByLabelText("Order nature *"),"MTO");
    await user.type(screen.getByLabelText("Upper colour *"),"Navy");
    const carton=screen.getAllByLabelText(/cartons$/)[0];
    await user.clear(carton);await user.type(carton,"1");
    await waitFor(()=>expect(screen.getByText(/Test Buyer 35%/)).toBeInTheDocument());
    expect(screen.queryByLabelText("Discount %")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Generate PI from these edits"}));
    expect(screen.getAllByText("35%").length).toBeGreaterThan(0);
  });

  it("links a PI database snapshot to the schedule only through the explicit action",async()=>{
    mocks.listPis.mockResolvedValue([{pi_no:"PI77",pi_date:"2026-08-22",party:"Buyer",status:"produced",revision:0,
      snapshot:{orders:[{order_no:"JO77",order_date:"2026-08-22",article_code:"SPIKE",party:"Buyer",priority:2,lines:[{combo:"7X10S",qty:24}],pi:{pi_no:"PI77"}}]}}]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI database"}));
    await user.click(await screen.findByRole("button",{name:"Add 1 to schedule"}));
    await waitFor(()=>expect(mocks.schedulePi).toHaveBeenCalledWith("PI77"));
    expect(await screen.findByText(/1 missing order added to the production schedule/)).toBeInTheDocument();
  });
});
