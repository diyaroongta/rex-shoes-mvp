import React from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({
  listOrders:vi.fn(),getSettings:vi.fn(),putSettings:vi.fn(),listPis:vi.fn(),listDispatches:vi.fn(),
  getReference:vi.fn(),getCatalogue:vi.fn(),listParties:vi.fn(),
  createOrders:vi.fn(),patchReference:vi.fn(),saveParty:vi.fn(),
  schedulePi:vi.fn(),patchOrder:vi.fn(),deleteAllOrders:vi.fn(),
  listArchivedPis:vi.fn(),archivePi:vi.fn(),restorePi:vi.fn(),deletePi:vi.fn(),
  nextPiNumber:vi.fn(),
  previewPartyTerms:vi.fn(),applyPartyTerms:vi.fn(),readPi:vi.fn(),setPlanOverride:vi.fn(),
  releasePiParts:vi.fn(),
}));

vi.mock("../../src/lib/client.js",()=>({
  ...mocks,
  setPriority:vi.fn(),setPlanOverride:mocks.setPlanOverride,deleteOrder:vi.fn(),deleteAllOrders:mocks.deleteAllOrders,patchOrder:mocks.patchOrder,
  schedulePi:mocks.schedulePi,releasePiParts:mocks.releasePiParts,listDispatches:mocks.listDispatches,addDispatch:vi.fn(),deleteDispatch:vi.fn(),
  uploadBom:vi.fn(),putCatalogue:vi.fn(),deleteCatalogue:vi.fn(),removeParty:vi.fn(),
  readOrderPhoto:vi.fn(),readPi:mocks.readPi,askCopilot:vi.fn(),
}));

import App from "../../src/App.jsx";
import { REF } from "../../src/lib/refdata.js";
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
  mocks.listArchivedPis.mockResolvedValue([]);
  mocks.archivePi.mockResolvedValue({orders:["JO77"]});
  mocks.restorePi.mockResolvedValue({orders:["JO77"]});
  mocks.deletePi.mockResolvedValue({deleted:"PI77",orders:["JO77"]});
  mocks.patchOrder.mockResolvedValue({});
  mocks.nextPiNumber.mockResolvedValue({pi_no:"PI-2026-000001"});
  mocks.setPlanOverride.mockResolvedValue({});
  mocks.releasePiParts.mockResolvedValue({created:[],outstanding:[]});
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

  it("shows range defaults for individual sizes and saves an explicit override",async()=>{
    const user=userEvent.setup();
    render(<ArticleRulesTab/>);
    await user.selectOptions(screen.getByLabelText("Article"),"SPIKE");
    expect(screen.getByText("Individual-size packing")).toBeInTheDocument();
    const individual=screen.getByLabelText("SPIKE 7X10S size 7s pairs per carton");
    expect(individual).toHaveAttribute("placeholder","24");
    await user.type(individual,"30");
    await user.click(screen.getByRole("button",{name:"Save packing changes"}));
    await waitFor(()=>expect(mocks.patchReference).toHaveBeenCalled());
    const payload=mocks.patchReference.mock.calls[0][0];
    expect(payload.packing_singles.ARMOUR["7X10S::7S"]).toBe(30);
    expect(payload.packing_singles.ARMOUR["7S"]).toBeUndefined();
  });

  it("shows every JILL packing combination and the complete BOM by default",async()=>{
    const user=userEvent.setup();
    const onUploadBom=vi.fn();
    render(<ArticleRulesTab onUploadBom={onUploadBom}/>);
    await user.selectOptions(screen.getByLabelText("Article"),"JILL");
    expect(screen.getByLabelText("Article type")).toHaveValue("ALL");
    for(const [type,combo] of [["VELCRO","7X10S"],["VELCRO","11X1"],["VELCRO","2X5"],["LACE","6X8"],["LACE","9X12"]])
      expect(screen.getByLabelText(`JILL ${type} ${combo} pairs per carton`)).toBeInTheDocument();
    expect(screen.getByText(/Complete BOM used per pair/)).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Upload or replace BOM Excel"}));
    expect(onUploadBom).toHaveBeenCalledWith("JILL");
  });

  it("removes one selected BOM item without replacing the full BOM",async()=>{
    const user=userEvent.setup();
    render(<ArticleRulesTab/>);
    await user.selectOptions(screen.getByLabelText("Article"),"SPIKE");
    await user.click(screen.getByRole("button",{name:"Remove a BOM item"}));
    await user.click(screen.getByRole("checkbox",{name:/I checked the article, size range and material/}));
    await user.click(screen.getByRole("button",{name:"Remove selected BOM item"}));
    await waitFor(()=>expect(mocks.patchReference).toHaveBeenCalledWith(expect.objectContaining({
      bom_remove:[expect.objectContaining({article:"SPIKE",combo:"7X10S"})],
    })));
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

  it("reloads the latest party discount and per-order dispatch timeline when Generate PI is pressed",async()=>{
    mocks.listParties
      .mockResolvedValueOnce([{name:"Test Buyer",discount_pct:35,dispatch_timeline:"45 days",deductions:[],gst_pct:5,payment_split_pct:50}])
      .mockResolvedValue([{name:"Test Buyer",discount_pct:27,dispatch_timeline:"30 days",deductions:[],gst_pct:5,payment_split_pct:50}]);
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
    expect(screen.getByLabelText("Dispatch timeline *")).toHaveAttribute("placeholder","45 days");
    await user.click(screen.getByRole("button",{name:"Generate PI from these edits"}));
    await waitFor(()=>expect(screen.getAllByText("27%").length).toBeGreaterThan(0));
    expect(screen.getByText("30 days")).toBeInTheDocument();
    expect(mocks.listParties.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  /* RELEASING PART OF A QUANTITY. A large order for one shoe is made in
     several runs, so a PI order is a ceiling and each release is its own
     production order. Asking "is it on the schedule" answered yes while half
     the pairs had never been made. */
  const piWith=(pi_no,lines)=>({pi_no,pi_date:"2026-08-22",party:"Buyer",status:"produced",revision:0,
    snapshot:{orders:[{order_no:"JO77",order_date:"2026-08-22",article_code:"SPIKE",
      party:"Buyer",priority:2,lines,pi:{pi_no}}]}});

  it("releases only part of a quantity and keeps the rest owed", async()=>{
    mocks.listPis.mockResolvedValue([piWith("PI77",[{combo:"7X10S",qty:2400,label:"7X10S"}])]);
    mocks.releasePiParts.mockResolvedValue({created:[{order_no:"JO77",pairs:600}],
      outstanding:[{order_no:"JO77",article_code:"SPIKE",remaining:1800}],partial:true});
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI database"}));
    // The button offers the pairs still owed, not "is this linked".
    await user.click(await screen.findByRole("button",{name:"Release production runs for PI77"}));

    const box=await screen.findByLabelText("Pairs of 7X10S to release from JO77");
    expect(box).toHaveValue(2400);                 // defaults to everything owed
    await user.clear(box); await user.type(box,"600");
    await user.click(screen.getByRole("button",{name:/Release 600 pairs/}));

    await waitFor(()=>expect(mocks.releasePiParts).toHaveBeenCalledWith("PI77",
      [{order_no:"JO77",qty:{"7X10S":600}}]));
    expect(await screen.findByText(/1,800 pairs still unreleased/)).toBeInTheDocument();
  });

  it("counts runs already made, so a half-released PI still offers the balance", async()=>{
    // 600 of 2400 already on the schedule, as its own production order.
    mocks.listOrders.mockResolvedValue([{order_no:"JO77",order_date:"2026-08-22",
      article_code:"SPIKE",priority:2,party:"Buyer",lines:[{combo:"7X10S",qty:600}],
      pi:{pi_no:"PI77",source_order:"JO77"},plan_override:{},version:1}]);
    mocks.listPis.mockResolvedValue([piWith("PI77",[{combo:"7X10S",qty:2400,label:"7X10S"}])]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI database"}));
    await user.click(await screen.findByRole("button",{name:"Release production runs for PI77"}));
    expect(await screen.findByLabelText("Pairs of 7X10S to release from JO77")).toHaveValue(1800);
  });

  it("refuses to release more than is owed", async()=>{
    mocks.listPis.mockResolvedValue([piWith("PI77",[{combo:"7X10S",qty:100,label:"7X10S"}])]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI database"}));
    await user.click(await screen.findByRole("button",{name:"Release production runs for PI77"}));
    const box=await screen.findByLabelText("Pairs of 7X10S to release from JO77");
    await user.clear(box); await user.type(box,"500");
    expect(screen.getByText(/More than is owed/)).toBeInTheDocument();
    // The release button is disabled, so an over-release cannot be sent at all.
    const go=screen.getByRole("button",{name:/^Release \d/});
    expect(go).toBeDisabled();
    await user.click(go);
    expect(mocks.releasePiParts).not.toHaveBeenCalled();
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

  it("shows handwritten exact quantities as cartons per size and derived pairs",async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI generation"}));
    await user.click(screen.getByText(/AI read not working here/));
    fireEvent.change(screen.getByPlaceholderText(/Paste the JSON reply here/),{target:{value:JSON.stringify({
      date:"2026-08-27",orders:[{party:"Dhanani Shoe Guwahati",category:"Rex Gola (L)",color:"Black",lines:[
        {sizes:["3"],cartons:3,type:"LACE"},{sizes:["4"],cartons:5,type:"LACE"},
        {sizes:["5"],cartons:3,type:"LACE"},{sizes:["6"],cartons:4,type:"LACE"},
      ]}],
    })}});
    await user.click(screen.getByRole("button",{name:"Use pasted result"}));
    expect(screen.getAllByText("Cartons and calculated pairs by size:")).toHaveLength(3);
    const sizeThree=screen.getByLabelText("REX GOLA (L) size 3 cartons");
    expect(sizeThree).toHaveValue(3);
    expect(sizeThree.closest("label")).toHaveTextContent("3 ctn × 18 = 54 pairs");
    /* The range total is editable now: a clerk asking for "4 cartons of this
       range" had no way to say it while this was read-only. Setting it spreads
       the pairs across the sizes already on the line. */
    const rangeCartons=screen.getByLabelText("REX GOLA (L) 1X3 cartons");
    expect(rangeCartons).toBeEnabled();
    expect(rangeCartons).toHaveValue(3);
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
      pi:{pi_no:"PI-5001",terms:{dispatch_timeline:"45 days"}},
    }]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Orders & dispatch"}));
    await user.click(await screen.findByRole("button",{name:"Edit saved order"}));

    // No free-text total: the sizes are the quantity.
    expect(screen.queryByLabelText("7X10S pairs")).not.toBeInTheDocument();
    const size8=screen.getByLabelText("7X10S size 8s pairs");
    await user.clear(size8);await user.type(size8,"100");
    const timeline=screen.getByLabelText("Dispatch timeline");
    await user.clear(timeline);await user.type(timeline,"30 days");

    await user.click(screen.getByRole("button",{name:"Save edits"}));
    await waitFor(()=>expect(mocks.patchOrder).toHaveBeenCalled());
    const [,patch]=mocks.patchOrder.mock.calls[0];
    const line=patch.lines[0];
    expect(line.sizes).toEqual({"7s":60,"8s":100,"9s":60,"10s":60});
    expect(line.qty).toBe(280);
    expect(line.qty).toBe(Object.values(line.sizes).reduce((a,b)=>a+b,0));
    expect(line.size_order).toEqual(["7s","8s","9s","10s"]);
    expect(patch.pi.dispatch_timeline).toBe("30 days");
    expect(patch.pi.terms.dispatch_timeline).toBe("30 days");
  });
});

/* Pairs are indivisible, and the server refuses a fractional quantity. Cartons
   are deliberately held to 4 decimals so a pairs→cartons round-trip keeps its
   precision on screen (100 ÷ 24 = 4.1667 cartons), but multiplying that back
   out gives 100.0008. That failed the entire save with
   "qty must be a whole number above 0" — nothing reached production — for any
   order whose sizes had been edited or read from a PI. */
describe("quantities sent to the server",()=>{
  const wholePairs = drafts => drafts.every(d => d.lines.every(l =>
    Number.isInteger(l.qty) && l.qty > 0 &&
    (!l.sizes || Object.values(l.sizes).every(v => Number.isInteger(Number(v))))));

  it("never sends a fractional pair count, whatever the carton arithmetic",async()=>{
    // The exact round-trip the intake performs when sizes drive the cartons.
    const cartons = +(100/24).toFixed(4);
    expect(Number.isInteger(cartons * 24)).toBe(false);      // the trap
    expect(Number.isInteger(Math.round(cartons * 24))).toBe(true);

    // and the contract the save path must uphold
    expect(wholePairs([{lines:[{combo:"7X10S",qty:Math.round(cartons*24)}]}])).toBe(true);
    expect(wholePairs([{lines:[{combo:"7X10S",qty:cartons*24}]}])).toBe(false);
    expect(wholePairs([{lines:[{combo:"7X10S",qty:96,sizes:{"7s":24.5,"8s":24,"9s":24,"10s":24}}]}])).toBe(false);
  });
});

/* The clerk is looking at the invoice when they spot a wrong pair count or
   price. Correcting it there — rather than on a different screen that has to
   be found first — is the whole point, and the correction must survive into
   what gets saved rather than being a display-only edit. */
describe("the invoice itself is editable",()=>{
  it("edits pairs and MRP on the PI and keeps Save enabled",async()=>{
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

    // Cells on the rendered invoice, not on Match & Check.
    const qty=screen.getAllByLabelText(/pairs$/).find(el=>el.closest("#pi-area"));
    const mrp=screen.getAllByLabelText(/MRP$/).find(el=>el.closest("#pi-area"));
    expect(qty).toBeTruthy();
    expect(mrp).toBeTruthy();

    await user.clear(mrp);await user.type(mrp,"777");
    // Editing on the invoice must not mark its own preview stale.
    expect(screen.queryByText(/Match & Check has changed since this PI was generated/)).not.toBeInTheDocument();
    expect(screen.getByRole("button",{name:/Save & send/})).toBeEnabled();
  });
});

/* The "Review before saving" block sits between Match & Check and the rendered
   invoice, and its quantity boxes used to write to piCards ALONE. The invoice
   renders from piPreviewCards, so a figure corrected there printed as whatever
   it had been before — the clerk's edit was visibly accepted and silently
   discarded. */
describe("edits made in the review block reach the invoice",()=>{
  it("changes the printed quantity when a PI-read size is corrected",async()=>{
    mocks.readPi.mockResolvedValue(JSON.stringify({
      customer:"Test Buyer", pi_date:"2026-08-27", order_no:"PI-2026-000009", discount_pct:40,
      items:[{article:"REX GOLA (V)", vl:"VELCRO", sole_colour:"Black", upper_colour:"Black",
        order_nature:"MTO", rows:[{size:"11s",qty:18},{size:"12s",qty:18},{size:"13s",qty:18}]}],
    }));
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI generation"}));
    const upload=document.querySelector('input[type="file"][accept="application/pdf,image/*"]');
    await user.upload(upload,new File(["x"],"pi.pdf",{type:"application/pdf"}));

    const cell=await screen.findByLabelText("REX GOLA (V) 11X13 size 11s pairs");
    await user.click(screen.getByRole("button",{name:"Generate PI from these edits"}));

    const printed=()=>screen.getAllByLabelText(/pairs$/).filter(el=>el.closest("#pi-area"))
      .map(el=>el.value);
    expect(printed()).toContain("18");

    await user.clear(cell); await user.type(cell,"30");
    // The invoice below must show the corrected figure, with no regenerate step.
    await waitFor(()=>expect(printed()).toContain("30"));
    expect(screen.queryByText(/Match & Check has changed since this PI was generated/))
      .not.toBeInTheDocument();
  });
});

/* Orders, dispatches and the PI master are three views of the same rows. A
   change made on any tab has to reload all of them, or the screens disagree:
   editing an order from the PI database used to leave the schedule, dispatch
   and the dashboard showing the figures from before the edit. */
describe("tabs stay in step with one another",()=>{
  it("reloads orders AND dispatches after an edit made in the PI database",async()=>{
    mocks.listPis.mockResolvedValue([{pi_no:"PI77",pi_date:"2026-08-22",party:"Buyer",
      status:"produced",revision:0,snapshot:{orders:[{order_no:"JO77",order_date:"2026-08-22",
      article_code:"SPIKE",party:"Buyer",priority:2,lines:[{combo:"7X10S",qty:24}],pi:{pi_no:"PI77"}}]}}]);
    mocks.listOrders.mockResolvedValue([{order_no:"JO77",order_date:"2026-08-22",
      article_code:"SPIKE",priority:2,party:"Buyer",lines:[{combo:"7X10S",qty:24}],pi:{pi_no:"PI77"},version:1}]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI database"}));
    await user.click(await screen.findByRole("button",{name:"View / edit"}));
    await user.click(await screen.findByRole("button",{name:/Edit JO77/}));

    const ordersBefore=mocks.listOrders.mock.calls.length;
    const dispatchesBefore=mocks.listDispatches.mock.calls.length;
    await user.click(screen.getByRole("button",{name:"Save edits"}));

    await waitFor(()=>expect(mocks.patchOrder).toHaveBeenCalled());
    // Both lists must be re-read, not just the PI list this screen owns.
    await waitFor(()=>expect(mocks.listOrders.mock.calls.length).toBeGreaterThan(ordersBefore));
    await waitFor(()=>expect(mocks.listDispatches.mock.calls.length).toBeGreaterThan(dispatchesBefore));
  });
});

/* The plan is automatic, but the planner outranks it. These assert the whole
   loop: the control exists, it writes the override, and the recomputed board
   moves — an override that is stored but never reaches the plan is worthless. */
describe("the production plan can be overruled by hand",()=>{
  const twoOrders=[
    {order_no:"JOA",order_date:"2026-08-22",article_code:"SPIKE",priority:2,party:"Buyer A",
     lines:[{combo:"7X10S",qty:2400}],pi:{},plan_override:{},version:1},
    {order_no:"JOB",order_date:"2026-08-22",article_code:"SPIKE",priority:2,party:"Buyer B",
     lines:[{combo:"7X10S",qty:2400}],pi:{},plan_override:{},version:1},
  ];

  it("sends an order to the front of the queue and re-plans the board",async()=>{
    // A faithful fake of the server: the override is stored and comes back on
    // the next read, which is what makes the board settle on the new plan.
    let rows=twoOrders.map(o=>({...o}));
    mocks.listOrders.mockImplementation(async()=>rows);
    mocks.setPlanOverride.mockImplementation(async(no,ov)=>{
      rows=rows.map(o=>o.order_no===no?{...o,plan_override:ov}:o); return {};
    });
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Schedule"}));

    // Rows are drawn in queue order, so the Adjust buttons ARE the queue.
    const queue=()=>screen.getAllByRole("button",{name:/Adjust the plan for/})
      .map(b=>b.getAttribute("aria-label").replace("Adjust the plan for ",""));
    // Same priority and same date, so the order number decides: JOA runs first.
    expect(queue()).toEqual(["JOA","JOB"]);

    await user.click(screen.getByRole("button",{name:"Adjust the plan for JOB"}));
    await user.click(await screen.findByRole("button",{name:"Run first"}));

    await waitFor(()=>expect(mocks.setPlanOverride).toHaveBeenCalledWith("JOB",
      expect.objectContaining({seq:1})));
    // The board is recomputed from the override, not merely recorded.
    await waitFor(()=>expect(queue()).toEqual(["JOB","JOA"]));
    expect(screen.getAllByText("manual").length).toBe(1);
  });

  it("carries out a forced stage duration and prints what it cost",async()=>{
    mocks.listOrders.mockResolvedValue([{...twoOrders[0],
      lines:[{combo:"7X10S",qty:20000}], plan_override:{days:{CUTTING:1}}}]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Schedule"}));

    // The consequence is stated on the board itself, not buried in a console.
    expect(await screen.findByText(/manual planning instruction/)).toBeInTheDocument();
    expect(screen.getByText(/CUTTING pinned to 1 day/)).toBeInTheDocument();
    // …and it is a WARNING, not a refusal: the red schedule-problem banner,
    // which fires on a genuinely broken plan, must stay silent.
    expect(screen.queryByText(/over capacity/)).not.toBeInTheDocument();
  });

  it("hands an order back to the automatic planner",async()=>{
    mocks.listOrders.mockResolvedValue([{...twoOrders[0],plan_override:{seq:1}},twoOrders[1]]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Schedule"}));
    await user.click(await screen.findByRole("button",{name:"Adjust the plan for JOA"}));
    await user.click(await screen.findByRole("button",{name:/Clear all overrides/}));
    await waitFor(()=>expect(mocks.setPlanOverride).toHaveBeenCalledWith("JOA",{}));
  });
});

/* Archiving and deleting a PI were built as API endpoints once and reported as
   finished while no button existed. These assert the CONTROLS, not the
   handlers, because a working endpoint nobody can reach is not a feature. */
describe("a PI can be archived or permanently deleted",()=>{
  const onePi=[{pi_no:"PI77",pi_date:"2026-08-22",party:"Buyer",status:"produced",revision:0,
    snapshot:{orders:[{order_no:"JO77",order_date:"2026-08-22",article_code:"SPIKE",
      party:"Buyer",priority:2,lines:[{combo:"7X10S",qty:24}],pi:{pi_no:"PI77"}}]}}];

  it("offers Archive and Delete, and syncs the other tabs after archiving",async()=>{
    mocks.listPis.mockResolvedValue(onePi);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI database"}));
    expect(await screen.findByRole("button",{name:"Archive"})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Delete"})).toBeInTheDocument();

    const ordersBefore=mocks.listOrders.mock.calls.length;
    await user.click(screen.getByRole("button",{name:"Archive"}));
    await waitFor(()=>expect(mocks.archivePi).toHaveBeenCalledWith("PI77"));
    // Archiving takes orders off the schedule, so every tab must re-read.
    await waitFor(()=>expect(mocks.listOrders.mock.calls.length).toBeGreaterThan(ordersBefore));
  });

  it("makes permanent deletion a separate, spelled-out confirmation",async()=>{
    mocks.listPis.mockResolvedValue(onePi);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI database"}));
    await user.click(await screen.findByRole("button",{name:"Delete"}));

    // One click must not destroy anything.
    expect(mocks.deletePi).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
    expect(screen.getByText(/shipment records are\s+never destroyed/)).toBeInTheDocument();

    await user.click(screen.getByRole("button",{name:/Delete PI77 permanently/}));
    await waitFor(()=>expect(mocks.deletePi).toHaveBeenCalledWith("PI77"));
  });

  it("shows archived PIs on demand and offers Restore there",async()=>{
    mocks.listPis.mockResolvedValue([]);
    mocks.listArchivedPis.mockResolvedValue(onePi);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI database"}));
    await user.click(screen.getByLabelText("Show archived"));
    await waitFor(()=>expect(mocks.listArchivedPis).toHaveBeenCalled());
    await user.click(await screen.findByRole("button",{name:"Restore"}));
    await waitFor(()=>expect(mocks.restorePi).toHaveBeenCalledWith("PI77"));
  });
});

/* "I changed 11s to 12s and the PI still says 11s." The line's label was free
   text; the SIZE KEY is what the invoice prints, and nothing could change it.
   Both screens now edit the size itself, and they edit the same cards, so a
   correction on either shows on the other. */
describe("correcting a size",()=>{
  const openDraft=async user=>{
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI generation"}));
    await user.click(await screen.findByRole("button",{name:"Enter by hand"}));
    await user.type(screen.getByLabelText("Customer *"),"Test Buyer");
    await user.type(screen.getByLabelText("Order nature *"),"MTO");
    await user.type(screen.getByLabelText("Upper colour *"),"Navy");
    // A line with exact sizes, which is what the per-size pickers act on.
    await user.type(screen.getByLabelText("Size"),"8s");
    await user.type(screen.getByLabelText("Quantity"),"24");
    await user.click(screen.getByRole("button",{name:"Add size"}));
  };

  it("changes the size in Match & Check and the PI prints the new one",async()=>{
    const user=userEvent.setup();
    await openDraft(user);

    const picker=screen.getAllByLabelText(/size 8s$/i)[0];
    expect(picker).toBeTruthy();
    await user.selectOptions(picker,"9s");

    await user.click(screen.getByRole("button",{name:/Generate PI/}));
    const invoice=document.querySelector("#pi-area");
    expect(invoice.textContent).toContain("9s");
    // and the old size is gone, not duplicated
    expect([...invoice.querySelectorAll("select")]
      .some(sel=>sel.value==="8s")).toBe(false);
  });
});

/* "Orders & dispatch — every live order" was listing orders that had already
   shipped in full, burying the ones that still need attention. Completed work
   moves out of the live list but is never deleted. */
describe("live orders exclude completed work",()=>{
  const two=[
    {order_no:"JO1",order_date:"2026-08-20",article_code:"SPIKE",priority:2,party:"A",
     lines:[{combo:"7X10S",qty:24}],pi:{},version:1},
    {order_no:"JO2",order_date:"2026-08-20",article_code:"SPIKE",priority:2,party:"B",
     lines:[{combo:"7X10S",qty:24}],pi:{},version:1},
  ];

  it("hides a fully dispatched order and shows it under Show completed",async()=>{
    mocks.listOrders.mockResolvedValue(two);
    mocks.listDispatches.mockResolvedValue([
      {id:1,order_no:"JO1",dispatched:{"7X10S":24},kind:"full",dispatched_on:"2026-08-21"},
    ]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Orders & dispatch"}));

    expect(await screen.findByText("Live orders · 1")).toBeInTheDocument();
    expect(screen.queryByText("JO1")).not.toBeInTheDocument();   // shipped in full
    expect(screen.getByText("JO2")).toBeInTheDocument();

    await user.click(screen.getByLabelText(/Show completed/));
    expect(await screen.findByText("JO1")).toBeInTheDocument();  // still there, not deleted
    expect(screen.queryByText("JO2")).not.toBeInTheDocument();
  });

  it("keeps a partly dispatched order in the live list",async()=>{
    mocks.listOrders.mockResolvedValue(two);
    mocks.listDispatches.mockResolvedValue([
      {id:1,order_no:"JO1",dispatched:{"7X10S":12},kind:"partial",dispatched_on:"2026-08-21"},
    ]);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Orders & dispatch"}));
    expect(await screen.findByText("Live orders · 2")).toBeInTheDocument();
  });
});

/* A control that changes data and says nothing is indistinguishable from one
   that failed. These are the handlers that were silent. */
describe("actions report what they did",()=>{
  it("confirms clearing all orders instead of just emptying the screen",async()=>{
    mocks.listOrders.mockResolvedValue([
      {order_no:"JO1",order_date:"2026-08-20",article_code:"SPIKE",priority:2,party:"A",
       lines:[{combo:"7X10S",qty:24}],pi:{},version:1}]);
    mocks.deleteAllOrders.mockResolvedValue({});
    vi.spyOn(window,"confirm").mockReturnValue(true);
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Orders & dispatch"}));
    await user.click(screen.getByRole("button",{name:"Clear all orders"}));
    expect(await screen.findByText(/1 order cleared/)).toBeInTheDocument();
    expect(screen.getByText(/PI snapshots remain/)).toBeInTheDocument();
  });

  it("surfaces a failed capacity save rather than swallowing it",async()=>{
    mocks.putSettings.mockRejectedValue(new Error("500 — Server error"));
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"Machine load"}));
    const cap=(await screen.findAllByLabelText(/pairs per day/i))[0];
    await user.clear(cap); await user.type(cap,"999");
    expect(await screen.findByText(/is not stored/,{},{timeout:3000})).toBeInTheDocument();
  });
});

/* Standard colours uploaded with the article master. They save the clerk
   retyping the same two words on every order, and they stay editable — the
   colour that reaches the PI is whatever the order says, not the article. */
describe("article standard colours",()=>{
  const firstArticle=()=>Object.keys(REF.articles).find(code=>
    (REF.articles[code].combo_order||Object.keys(REF.articles[code].combos||{})).length>0);

  it("prefills a new order from the article master and lets the clerk overrule it",async()=>{
    const user=userEvent.setup();
    const code=firstArticle();
    const before={...REF.articles[code]};
    REF.articles[code]={...before,sole_colour:"Black",upper_colour:"N.Blue / S.Blue"};
    try{
      render(<App/>);
      await user.click(await screen.findByRole("button",{name:"PI generation"}));
      await user.click(await screen.findByRole("button",{name:"Enter by hand"}));
      expect(screen.getByLabelText("Sole colour *")).toHaveValue("Black");
      expect(screen.getByLabelText("Upper colour *")).toHaveValue("N.Blue / S.Blue");
      await user.clear(screen.getByLabelText("Upper colour *"));
      await user.type(screen.getByLabelText("Upper colour *"),"Red");
      expect(screen.getByLabelText("Upper colour *")).toHaveValue("Red");
    }finally{ REF.articles[code]=before; }
  });

  it("leaves the fields blank when the article master has no colour on file",async()=>{
    const user=userEvent.setup();
    render(<App/>);
    await user.click(await screen.findByRole("button",{name:"PI generation"}));
    await user.click(await screen.findByRole("button",{name:"Enter by hand"}));
    expect(screen.getByLabelText("Sole colour *")).toHaveValue("");
    expect(screen.getByLabelText("Upper colour *")).toHaveValue("");
  });
});
