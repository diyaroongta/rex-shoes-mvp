import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({
  listOrders:vi.fn(),getSettings:vi.fn(),putSettings:vi.fn(),listPis:vi.fn(),listDispatches:vi.fn(),
  getReference:vi.fn(),getCatalogue:vi.fn(),listParties:vi.fn(),
  createOrders:vi.fn(),patchReference:vi.fn(),saveParty:vi.fn(),
  schedulePi:vi.fn(),patchOrder:vi.fn(),
  previewPartyTerms:vi.fn(),applyPartyTerms:vi.fn(),
}));

vi.mock("../../src/lib/client.js",()=>({
  ...mocks,
  setPriority:vi.fn(),deleteOrder:vi.fn(),deleteAllOrders:vi.fn(),patchOrder:mocks.patchOrder,
  schedulePi:mocks.schedulePi,listDispatches:mocks.listDispatches,addDispatch:vi.fn(),deleteDispatch:vi.fn(),
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
  mocks.listDispatches.mockResolvedValue([]);
  mocks.getCatalogue.mockResolvedValue({});
  mocks.listParties.mockResolvedValue([]);
  mocks.createOrders.mockResolvedValue([{order_no:"JO9001"}]);
  mocks.patchReference.mockResolvedValue({ok:true});
  mocks.saveParty.mockResolvedValue({name:"Test Buyer"});
  mocks.schedulePi.mockResolvedValue({restored:["JO77"]});
  mocks.patchOrder.mockResolvedValue({});
  mocks.previewPartyTerms.mockResolvedValue({orders:0,pis:[],changing:0,terms:{discount_pct:40}});
  mocks.applyPartyTerms.mockResolvedValue({updated:0,pis:[],terms:{discount_pct:40}});
});

describe("critical UI contracts",()=>{
  it("opens on the executive MIS and loads recorded dispatch history",async()=>{
    render(<App/>);
    expect(await screen.findByRole("heading",{name:"Executive MIS"})).toBeInTheDocument();
    expect(screen.getByLabelText("Executive MIS dashboard")).toBeInTheDocument();
    expect(mocks.listDispatches).toHaveBeenCalled();
  });

  it("keeps a PI draft mounted while the clerk visits another tab",async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI generation"}));
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
    await user.click(await screen.findByRole("button",{name:"PI generation"}));
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
    await user.click(await screen.findByRole("button",{name:"PI generation"}));
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

  /* The schedule is computed from the capacities saved in settings. The
     production plan used to read the BUNDLED SEED figure instead, so the moment
     anyone changed a capacity the two screens disagreed about how full a line
     was — while both claimed to describe the same plan. */
  it("shows production-plan utilisation against the saved capacity, not the seed",async()=>{
    mocks.getSettings.mockResolvedValue({capacities:{CUTTING:100}});
    mocks.listOrders.mockResolvedValue([{
      order_no:"JO6001",order_date:"2026-08-20",article_code:"SPIKE",priority:2,party:"Buyer",
      lines:[{combo:"7X10S",qty:100,label:"7X10S"}],pi:{},
    }]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Production plan"}));
    // 100 pairs of cutting against a saved 100/day is a full day, and the cell
    // must say so against 100 — not against the seed's 2,500.
    const cutting=await screen.findByText(/100% of 100/);
    expect(cutting).toBeInTheDocument();
    expect(screen.queryByText(/of 2,500/)).not.toBeInTheDocument();
  });

  /* A sheet that writes SPIKE with a Velcro section and a Lace section ordered
     ONE shoe in two rolls. It used to arrive as two article cards, two PI items
     and two jobs in the plan. The size range now decides the roll, so the
     article stays whole and the range picker offers both halves. */
  it("keeps a split article as one card and offers both rolls on every line",async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI generation"}));
    await user.click(await screen.findByRole("button",{name:"Enter by hand"}));

    const selects=()=>[...document.querySelectorAll("select")];
    const article=selects().find(s=>[...s.options].some(o=>o.value==="SPIKE") &&
      ![...s.options].some(o=>o.value==="data"));       // not the mobile nav
    await user.selectOptions(article,"SPIKE");
    expect(screen.getAllByDisplayValue("SPIKE")).toHaveLength(1);

    // The line's range picker lists the WHOLE shoe, each range labelled.
    const options=[...document.querySelectorAll("option")].map(o=>o.textContent);
    expect(options).toContain("7X10S · Velcro");
    expect(options).toContain("9X12 · Lace");

    // Choosing a Lace range makes THAT line lace without splitting the article.
    const combo=selects().find(s=>[...s.options].some(o=>o.value==="9X12"));
    await user.selectOptions(combo,"9X12");
    expect(screen.getAllByDisplayValue("SPIKE")).toHaveLength(1);
    expect(screen.getAllByText("LACE").length).toBeGreaterThan(0);
    // No card-level V/L question for a split article — the ranges answer it.
    expect(screen.queryByLabelText("V/L *")).not.toBeInTheDocument();
  });

  /* The sheet's customer is asked ONCE and stamped onto every article, because
     one slip is one customer far more often than not. */
  it("asks for the customer once for the whole sheet",async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI generation"}));
    await user.click(await screen.findByRole("button",{name:"Enter by hand"}));
    await user.click(screen.getByRole("button",{name:"+ Add category"}));

    expect(screen.getAllByLabelText("Customer *")).toHaveLength(1);
    await user.type(screen.getByLabelText("Customer *"),"R.L. Ungav");
    await user.type(screen.getByLabelText("Order nature *"),"MTS");

    // Turning on multi-party reveals one customer box per article instead.
    await user.click(screen.getByLabelText("Different customers on this sheet"));
    expect(screen.getAllByLabelText("Customer *")).toHaveLength(2);
    expect(screen.getAllByDisplayValue("R.L. Ungav").length).toBe(2);
  });

  /* Photo intake, bulk import and PI reading all store exact pairs per size.
     The editor used to offer a free-text TOTAL against an untouched size map,
     so every save was rejected by the server as "exact-size quantities total
     240, not 300" — Save edits was dead on virtually every order. */
  it("edits an exact-size order size by size and keeps the total in step",async()=>{
    mocks.listOrders.mockResolvedValue([{
      order_no:"JO5001",order_date:"2026-08-20",article_code:"SPIKE",priority:2,party:"Buyer",
      lines:[{combo:"7X10S",qty:240,label:"7X10S",size_order:["7s","8s","9s","10s"],
              sizes:{"7s":60,"8s":60,"9s":60,"10s":60}}],
      pi:{pi_no:"PI-5001"},
    }]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Orders & dispatch"}));
    await user.click(await screen.findByRole("button",{name:"Edit saved order"}));

    // No free-text total: the sizes are the quantity.
    expect(screen.queryByLabelText("7X10S pairs")).not.toBeInTheDocument();
    const size8=screen.getByLabelText("7X10S size 8s pairs");
    await user.clear(size8);await user.type(size8,"100");

    await user.click(screen.getByRole("button",{name:"Save edits"}));
    await waitFor(()=>expect(mocks.patchOrder).toHaveBeenCalled());
    const [,patch]=mocks.patchOrder.mock.calls[0];
    const line=patch.lines[0];
    expect(line.sizes).toEqual({"7s":60,"8s":100,"9s":60,"10s":60});
    expect(line.qty).toBe(280);
    expect(line.qty).toBe(Object.values(line.sizes).reduce((a,b)=>a+b,0));
    expect(line.size_order).toEqual(["7s","8s","9s","10s"]);
  });
});
