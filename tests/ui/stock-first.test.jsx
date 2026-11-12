import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const api=vi.hoisted(()=>({getStockPlan:vi.fn(),getStockCheck:vi.fn(),decideStock:vi.fn(),lockStockForParty:vi.fn()}));
vi.mock("../../src/lib/client.js",()=>api);
vi.mock("../../src/lib/refdata.js",async()=>{
  const { INPUTS } = await import("../../shared/inputs.js");
  return { REF:INPUTS, reload:vi.fn(async()=>{}) };
});
/* The board opens at today; the fixture plan starts on the seed's origin. */
vi.mock("../../src/lib/today.js",()=>({ todayIso:()=>"2026-07-06" }));

import StockDecisions from "../../src/StockDecisions.jsx";
import StockRegisterPanel from "../../src/StockRegisterPanel.jsx";
import DispatchStockReminder from "../../src/DispatchStockReminder.jsx";
import PlanBoard from "../../src/PlanBoard.jsx";
import { compute, fromDay, dayIndex } from "../../shared/engine.js";
import { INPUTS } from "../../shared/inputs.js";

const ART="REX GOLA (V)";
const ORDER={order_no:"JO5001",party:"Belgaum Traders",article_code:ART,stock_status:"awaiting",
  lines:[{combo:"8X10B",qty:300,sizes:{"8":100,"9":100,"10":100}}]};
const row=(size,over={})=>({size,ordered:100,fg_free:0,held_fg:0,use_fg:0,upper_size_up:String(Number(size)+1),
  upper_free_own:0,upper_free_up:0,use_upper:{},held_upper:{},use_upper_total:0,produce:100,...over});
const CHECK=()=>({order_no:"JO5001",article:ART,colour:"BLACK",unsized:0,upper_other_colours:[{colour:"WHITE",pairs:25}],
  totals:{ordered:300,fg:60,upper:40,produce:200},
  rows:[row("8",{fg_free:60,use_fg:60,upper_free_up:40,produce:40}),
        row("9",{upper_free_own:40,use_upper:{"9":40},use_upper_total:40,produce:60}),
        row("10",{upper_size_up:"11"})]});

beforeEach(()=>{
  vi.clearAllMocks();
  api.getStockPlan.mockResolvedValue({awaiting:[{order_no:"JO5001",ready_pairs:100,sizes_with_stock:2,sizes:3}],
    register:{FG:[{key:"FG||REX GOLA (V)||||8",store:"FG",article:ART,colour:"",size:"8",on_hand:60,reserved:25,locked:10,free:25,
      orders:[{order_no:"JO4999",pairs:25}],party_locks:[{party:"St. Mary School",qty:10}]}],UPPER:[]},fg_sizes_unknown:[],locks:[]});
  api.getStockCheck.mockImplementation(async()=>CHECK());
  api.decideStock.mockResolvedValue({reserved_fg:60,reserved_upper:40});
  api.lockStockForParty.mockResolvedValue({});
});

describe("the stock decision on the Order Book",()=>{
  it("shows nothing at all when no order is waiting or using stock",()=>{
    const {container}=render(<StockDecisions orders={[{order_no:"JO1",lines:[]}]} canDecide/>);
    expect(container).toBeEmptyDOMElement();
    expect(api.getStockPlan).not.toHaveBeenCalled();     // nothing is fetched by looking
  });
  it("badges the orders awaiting a decision with their ready stock",async()=>{
    render(<StockDecisions orders={[ORDER]} canDecide/>);
    expect(screen.getByLabelText("1 order awaiting a stock decision")).toHaveTextContent("1");
    expect(await screen.findByText(/Ready stock: 100 pairs · 2 of 3 sizes/)).toBeInTheDocument();
  });
  it("opens the panel with the most stock that can be used, FG first, and reserves it",async()=>{
    const user=userEvent.setup(), onChanged=vi.fn();
    render(<StockDecisions orders={[ORDER]} canDecide onChanged={onChanged}/>);
    await user.click(screen.getByRole("button",{name:"Decide"}));
    const table=await screen.findByRole("table",{name:"Stock decision for JO5001"});
    expect(within(table).getByLabelText("Use finished goods for size 8")).toHaveValue(60);
    expect(within(table).getByLabelText("Use size 9 uppers for size 9")).toHaveValue(40);
    expect(screen.getByText(/another colour: WHITE 25/)).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Use selected stock"}));
    await waitFor(()=>expect(api.decideStock).toHaveBeenCalledWith("JO5001",{sizes:{
      "8":{fg:60,upper:{}},"9":{fg:0,upper:{"9":40}},"10":{fg:0,upper:{}}}}));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText(/60 pairs reserved in finished goods, 40 uppers reserved/)).toBeInTheDocument();
  });
  it("lets the planner change the boxes, and will not send more than was ordered",async()=>{
    const user=userEvent.setup();
    render(<StockDecisions orders={[ORDER]} canDecide/>);
    await user.click(screen.getByRole("button",{name:"Decide"}));
    const fg=await screen.findByLabelText("Use finished goods for size 8");
    await user.clear(fg); await user.type(fg,"20");
    const up=screen.getByLabelText("Use size 9 uppers for size 8");
    await user.clear(up); await user.type(up,"90");
    expect(screen.getByText(/More than was ordered is set against size 8/)).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Use selected stock"})).toBeDisabled();
    await user.clear(up); await user.type(up,"10");
    await user.click(screen.getByRole("button",{name:"Use selected stock"}));
    await waitFor(()=>expect(api.decideStock.mock.calls[0][1].sizes["8"]).toEqual({fg:20,upper:{"9":10}}));
  });
  it("ignoring the stock plans the full order",async()=>{
    const user=userEvent.setup();
    render(<StockDecisions orders={[ORDER]} canDecide/>);
    await user.click(screen.getByRole("button",{name:"Decide"}));
    await user.click(await screen.findByRole("button",{name:"Ignore stock, plan full order"}));
    await waitFor(()=>expect(api.decideStock).toHaveBeenCalledWith("JO5001",{ignore:true}));
    expect(await screen.findByText(/stock ignored — the full 300 pairs will be produced/)).toBeInTheDocument();
  });
  it("when the stock moved, says why and shows the figures as they now stand",async()=>{
    const user=userEvent.setup();
    api.decideStock.mockRejectedValue(new Error("409 — The stock changed while this was open — please review. Only 0 pair(s) of finished goods size 8 are free now, and 60 were asked for"));
    render(<StockDecisions orders={[ORDER]} canDecide/>);
    await user.click(screen.getByRole("button",{name:"Decide"}));
    await screen.findByRole("table",{name:"Stock decision for JO5001"});
    api.getStockCheck.mockImplementation(async()=>({...CHECK(),rows:[row("8"),row("9"),row("10")]}));
    await user.click(screen.getByRole("button",{name:"Use selected stock"}));
    expect(await screen.findByRole("alert")).toHaveTextContent(/The stock changed while this was open/);
    await waitFor(()=>expect(screen.getByLabelText("Use finished goods for size 8")).toHaveValue(0));
    expect(api.getStockCheck).toHaveBeenCalledTimes(2);
  });
  it("someone who cannot decide can look, and is told who can",async()=>{
    const user=userEvent.setup();
    render(<StockDecisions orders={[ORDER]} canDecide={false}/>);
    await user.click(screen.getByRole("button",{name:"View"}));
    expect(await screen.findByText(/Only the Production Planner or an administrator can decide this/)).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Use selected stock"})).toBeNull();
    expect(screen.getByLabelText("Use finished goods for size 8")).toBeDisabled();
  });
  it("lists the orders already using stock, with where each pair comes from",async()=>{
    const user=userEvent.setup();
    const decided={...ORDER,stock_status:"decided",stock_allocation:{mode:"use",sizes:{"8":{fg:60,upper:{}},"9":{fg:0,upper:{"9":40}}}}};
    render(<StockDecisions orders={[decided]} canDecide/>);
    await user.click(screen.getByRole("button",{name:/Show 1 order using ready stock/}));
    expect(screen.getByText(/300 ordered/)).toHaveTextContent("300 ordered · 60 from finished goods · 40 from uppers (start at moulding) · 200 to produce in full");
  });
});

describe("the reserved and free register",()=>{
  it("shows on hand, reserved, kept for a party and free, and who holds what",async()=>{
    render(<StockRegisterPanel store="FG" canLock/>);
    const table=await screen.findByRole("table",{name:/finished goods — on hand, reserved and free/});
    const cells=within(table).getAllByRole("cell").map(c=>c.textContent);
    expect(cells).toEqual(expect.arrayContaining([ART,"8","60","25","JO4999 · 25","St. Mary School · 10"]));
  });
  it("keeps stock for a party",async()=>{
    const user=userEvent.setup();
    render(<StockRegisterPanel store="FG" canLock/>);
    await user.click(await screen.findByRole("button",{name:"Change lock"}));
    const qty=screen.getByLabelText("Pairs kept for the party");
    await user.clear(qty); await user.type(qty,"30");
    await user.click(screen.getByRole("button",{name:"Save lock"}));
    await waitFor(()=>expect(api.lockStockForParty).toHaveBeenCalledWith({store:"FG",article:ART,colour:"",size:"8",party:"St. Mary School",qty:30}));
    expect(api.getStockPlan).toHaveBeenCalledTimes(2);
  });
  it("offers no lock to a role that cannot set one, and says so when a store is empty",async()=>{
    render(<StockRegisterPanel store="UPPER"/>);
    expect(await screen.findByText(/Nothing on hand/)).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:/Keep for a party|Change lock/})).toBeNull();
  });
});

describe("the dispatch reminder",()=>{
  it("pre-fills finished goods reserved for the order, and lets the clerk untick them",async()=>{
    const user=userEvent.setup(), onChange=vi.fn();
    api.getStockCheck.mockResolvedValue({prefill:{reserved:[{size:"8",pairs:60}],reserved_pairs:60,free:[],free_pairs:0}});
    const {rerender}=render(<DispatchStockReminder orderNo="JO5001" leaving={{"8":100}} value={{}} onChange={onChange}/>);
    await waitFor(()=>expect(onChange).toHaveBeenCalledWith({"8":60}));
    rerender(<DispatchStockReminder orderNo="JO5001" leaving={{"8":100}} value={{"8":60}} onChange={onChange}/>);
    expect(screen.getByRole("note")).toHaveTextContent(/60 pairs of this order are reserved in finished goods \(sizes 8\)\. Include them in this dispatch\?/);
    const box=screen.getByLabelText("Ship size 8 from finished goods");
    expect(box).toBeChecked();
    await user.click(box);
    expect(onChange).toHaveBeenLastCalledWith({});
  });
  it("reminds of matching FREE stock without pre-filling it — an order planned with Ignore stock",async()=>{
    const onChange=vi.fn();
    api.getStockCheck.mockResolvedValue({prefill:{reserved:[],reserved_pairs:0,free:[{size:"8",pairs:60}],free_pairs:60}});
    render(<DispatchStockReminder orderNo="JO5001" leaving={{"8":100}} value={{}} onChange={onChange}/>);
    expect(await screen.findByRole("note")).toHaveTextContent(/60 pairs of free finished goods match this order/);
    expect(screen.getByLabelText("Ship size 8 from finished goods")).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalled();
  });
  it("says nothing when there is no stock, and never blocks the report if the check fails",async()=>{
    api.getStockCheck.mockRejectedValue(new Error("500"));
    const {container}=render(<DispatchStockReminder orderNo="JO5001" leaving={{}} value={{}} onChange={vi.fn()}/>);
    await waitFor(()=>expect(api.getStockCheck).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

/* THE WEEKLY PRODUCTION PLAN. It was a board of floating bars; the factory
   asked for something that reads like the planning sheet they already keep —
   a table per week, a row a day, a column a work centre — and for a lock to
   say why it is there and be easy to take back. */
describe("the weekly production plan",()=>{
  const { articles, materials, workcenters:wcs, origin } = INPUTS;
  const A={order_no:"JO1",order_date:"2026-07-06",article_code:ART,priority:2,party:"Board Party",lines:[{combo:"8X10",qty:1500}]};
  const plan=(overrides={})=>compute([A],articles,materials,wcs,origin,{overrides});
  const stage=(state,name)=>state.units[0].stages.find(s=>s.stage===name);
  const job=name=>screen.getAllByRole("button",{name:new RegExp(`^JO1 ${name} on `)})[0];

  it("is one table per week: a row a day, a column a work centre, the jobs in each cell",()=>{
    render(<PlanBoard state={plan()} setPlanOverride={vi.fn()}/>);
    const week=screen.getByRole("grid",{name:"Plan for the week of 2026-07-06"});
    expect(within(week).getByRole("columnheader",{name:"Cutting hall"})).toHaveTextContent("2,500 a day");
    /* Its stage is headed over it, as on the downloaded sheet — and a stage
       with several machines is headed once, across all of them. */
    expect(within(week).getByRole("columnheader",{name:"CUTTING stage"})).toBeInTheDocument();
    expect(within(week).getAllByRole("columnheader",{name:"MOLDING stage"})).toHaveLength(1);
    const cell=within(week).getByRole("gridcell",{name:"Cutting hall 2026-07-06"});
    expect(cell).toHaveTextContent("JO1");
    expect(cell).toHaveTextContent("1,500");
    expect(cell).toHaveTextContent("REX GOLA (V)");
    expect(cell).toHaveTextContent("Board Party");
    expect(cell).toHaveTextContent("60% of 2,500");
    expect(within(week).getByRole("rowheader",{name:/Week total/})).toBeInTheDocument();
    expect(screen.getByText(/Week of 6 Jul – 12 Jul/i)).toBeInTheDocument();
  });
  it("marks the closed day, and shows a job larger than a day's capacity on each day it runs",()=>{
    const state=plan();
    render(<PlanBoard state={state} setPlanOverride={vi.fn()}/>);
    expect(screen.getAllByRole("rowheader",{name:/Sun.*closed/}).length).toBeGreaterThan(0);
    const mould=stage(state,"MOLDING");
    const days=screen.getAllByRole("button",{name:/^JO1 MOLDING on /});
    expect(days).toHaveLength(Object.keys(mould.alloc).length);
    expect(days[0]).toHaveAccessibleName(/1,200 pairs/);
    expect(days[1]).toHaveAccessibleName(/300 pairs/);
  });
  it("sums the plan up in four figures",()=>{
    render(<PlanBoard state={plan()} setPlanOverride={vi.fn()}/>);
    expect(screen.getByText("Jobs on the plan").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Locked by a planner").parentElement).toHaveTextContent(/0.*everything is planned automatically/);
  });
  it("opens a job in a box that says what it is and how it is planned",async()=>{
    const user=userEvent.setup();
    render(<PlanBoard state={plan()} setPlanOverride={vi.fn()}/>);
    await user.click(job("CUTTING"));
    const box=screen.getByRole("region",{name:"Selected job"});
    expect(box).toHaveTextContent(/Job\s*JO1/);
    expect(box).toHaveTextContent(/Stage\s*CUTTING on Cutting hall/);
    expect(box).toHaveTextContent(/Automatic — the planner places it/);
  });
  it("moves a job from the box and locks it, and offers to undo",async()=>{
    const user=userEvent.setup(), set=vi.fn();
    const state=plan();
    render(<PlanBoard state={state} setPlanOverride={set}/>);
    await user.click(job("CUTTING"));
    const to=fromDay(dayIndex(stage(state,"CUTTING").start_date,origin)+2,origin);
    fireEvent.change(screen.getByLabelText("Start this job on"),{target:{value:to}});
    await user.click(screen.getByRole("button",{name:"Move and lock"}));
    expect(set).toHaveBeenCalledWith("JO1",{at:{CUTTING:to}},"JO1");
    expect(screen.getByRole("status")).toHaveTextContent(/JO1 CUTTING moved to .* and locked there/);
    /* A lock made by a slip of the mouse is taken back in one click. */
    await user.click(screen.getByRole("button",{name:"Undo"}));
    expect(set).toHaveBeenLastCalledWith("JO1",{},"JO1");
    expect(screen.getByRole("status")).toHaveTextContent(/Undone — JO1 CUTTING is back as it was/);
  });
  it("refuses a move that breaks the stage order, and says why",async()=>{
    const user=userEvent.setup(), set=vi.fn();
    const state=plan();
    render(<PlanBoard state={state} setPlanOverride={set}/>);
    await user.click(job("STITCHING"));
    fireEvent.change(screen.getByLabelText("Start this job on"),{target:{value:stage(state,"CUTTING").start_date}});
    await user.click(screen.getByRole("button",{name:"Move and lock"}));
    expect(screen.getByRole("alert")).toHaveTextContent(/Not moved\. STITCHING of JO1 cannot start/);
    expect(set).not.toHaveBeenCalled();
  });
  it("a job dragged onto another day is checked the same way and locked",()=>{
    const set=vi.fn(), state=plan();
    render(<PlanBoard state={state} setPlanOverride={set}/>);
    const to=fromDay(dayIndex(stage(state,"CUTTING").start_date,origin)+1,origin);
    fireEvent.dragStart(job("CUTTING"),{dataTransfer:{setData(){}}});
    fireEvent.drop(screen.getByRole("gridcell",{name:`Cutting hall ${to}`}));
    expect(set).toHaveBeenCalledWith("JO1",{at:{CUTTING:to}},"JO1");
  });
  it("a job cannot be dragged onto a line that is not its stage",()=>{
    const set=vi.fn(), state=plan();
    render(<PlanBoard state={state} setPlanOverride={set}/>);
    fireEvent.dragStart(job("CUTTING"),{dataTransfer:{setData(){}}});
    const wrong=screen.getByRole("gridcell",{name:`Stitching lines ${stage(state,"CUTTING").end_date}`});
    expect(wrong).toHaveStyle({opacity:"0.35"});                    // greyed while dragging
    fireEvent.drop(wrong);
    expect(set).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/CUTTING block, and Stitching lines is a STITCHING line/);
  });
  it("says why a job is locked, and unlocks it",async()=>{
    const user=userEvent.setup(), set=vi.fn();
    const day=stage(plan(),"PACKING").start_date;
    render(<PlanBoard state={plan({JO1:{at:{PACKING:day}}})} setPlanOverride={set}/>);
    const locked=screen.getByRole("button",{name:/^JO1 PACKING on .*, locked/});
    expect(locked).toHaveTextContent("🔒");
    await user.click(locked);
    expect(screen.getByRole("region",{name:"Selected job"})).toHaveTextContent(/Locked — a planner moved it or locked it here\. Re-planning will not move it until it is unlocked/);
    await user.click(screen.getByRole("button",{name:"Unlock"}));
    expect(set).toHaveBeenCalledWith("JO1",{},"JO1");
  });
  it("says when a lock came from an uploaded planning sheet",async()=>{
    const user=userEvent.setup();
    const day=stage(plan(),"PACKING").start_date;
    render(<PlanBoard state={plan({JO1:{at:{PACKING:day},daily:{PACKING:{[day]:1500}}}})} setPlanOverride={vi.fn()}/>);
    await user.click(screen.getByRole("button",{name:/^JO1 PACKING on .*, locked/}));
    expect(screen.getByRole("region",{name:"Selected job"})).toHaveTextContent(/Locked — set by an uploaded planning sheet/);
  });
  it("counts the locks and hands them all back at once",async()=>{
    const user=userEvent.setup(), batch=vi.fn(async()=>({saved:1,failed:[]}));
    const state=plan();
    const locks={JO1:{at:{PACKING:stage(state,"PACKING").start_date,CUTTING:stage(state,"CUTTING").start_date},days:{STITCHING:2}}};
    render(<PlanBoard state={plan(locks)} setPlanOverride={vi.fn()} onApplySheet={batch}/>);
    expect(screen.getByText("Locked by a planner").parentElement).toHaveTextContent("2");
    await user.click(screen.getByRole("button",{name:"Unlock all"}));
    expect(globalThis.confirm).toHaveBeenCalled();
    await waitFor(()=>expect(batch).toHaveBeenCalledWith([{order_no:"JO1",unit_key:"JO1",override:{days:{STITCHING:2}}}]));
    expect(await screen.findByText(/2 locked job stages handed back to the automatic planner/)).toBeInTheDocument();
  });
  it("locks a job where it is, and re-plans on request",async()=>{
    const user=userEvent.setup(), set=vi.fn(), replan=vi.fn(async()=>{});
    const state=plan();
    render(<PlanBoard state={state} setPlanOverride={set} onReplan={replan}/>);
    await user.click(job("PACKING"));
    await user.click(screen.getByRole("button",{name:"Lock as-is"}));
    expect(set).toHaveBeenCalledWith("JO1",{at:{PACKING:stage(state,"PACKING").start_date}},"JO1");
    await user.click(screen.getByRole("button",{name:"Re-plan"}));
    expect(replan).toHaveBeenCalled();
    expect(await screen.findByText(/Re-planned\. 0 locked job stages kept in place/)).toBeInTheDocument();
  });
  it("reports the knock-on effect once the plan has been recomputed",async()=>{
    const user=userEvent.setup();
    const before=plan();
    const to=fromDay(dayIndex(stage(before,"CUTTING").start_date,origin)+35,origin);
    const set=vi.fn();
    const {rerender}=render(<PlanBoard state={before} setPlanOverride={set}/>);
    await user.click(job("CUTTING"));
    fireEvent.change(screen.getByLabelText("Start this job on"),{target:{value:to}});
    await user.click(screen.getByRole("button",{name:"Move and lock"}));
    const override=set.mock.calls[0][1];
    rerender(<PlanBoard state={plan({JO1:override})} setPlanOverride={set}/>);
    expect(await screen.findByRole("table",{name:"Dispatch dates that moved"}))
      .toHaveTextContent(/JO1.*dispatch .* → .*misses its promise by \d+ day/);
  });
  it("shows what the floor reported against the day it was made",()=>{
    const state=plan();
    const st=stage(state,"CUTTING");
    render(<PlanBoard state={state} setPlanOverride={vi.fn()} actuals={[
      {production_on:st.start_date,work_center:"CUTTING",stage:"CUTTING",order_no:"JO1",unit_key:"JO1",actual_pairs:900}]}/>);
    expect(screen.getByRole("gridcell",{name:`Cutting hall ${st.start_date}`})).toHaveTextContent("made 900");
  });
  it("shades a line that is over its daily capacity and says by how much",()=>{
    const state=plan({JO1:{days:{STITCHING:1}}});      // 1,500 pairs through a 2,000-a-day line is fine...
    const tight=compute([A,{...A,order_no:"JO2",party:"Second"}],articles,materials,wcs,origin,
      {overrides:{JO1:{days:{CUTTING:1}},JO2:{at:{CUTTING:"2026-07-06"}}}});      // ...two jobs forced onto one cutting day is not
    render(<PlanBoard state={tight} setPlanOverride={vi.fn()}/>);
    const cell=screen.getByRole("gridcell",{name:"Cutting hall 2026-07-06"});
    expect(cell).toHaveTextContent(/3,000 · 120% of 2,500 · \+500 over/);
    expect(screen.getByText("Days over capacity").parentElement).toHaveTextContent("1");
    expect(state).toBeTruthy();
  });
  it("is read-only for anyone who may not edit the schedule",async()=>{
    const user=userEvent.setup();
    render(<PlanBoard state={plan()}/>);
    expect(screen.getByText(/Read-only — only the Production Planner or an administrator/)).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"Re-plan"})).toBeNull();
    expect(screen.queryByRole("button",{name:"Upload edited plan"})).toBeNull();
    expect(job("CUTTING")).toHaveAttribute("draggable","false");
    await user.click(job("CUTTING"));
    expect(screen.queryByRole("button",{name:"Move and lock"})).toBeNull();
    expect(screen.getByRole("button",{name:"Download plan (.xlsx)"})).toBeEnabled();
  });
  it("says so when nothing is on the plan",()=>{
    render(<PlanBoard state={compute([],articles,materials,wcs,origin,{})} setPlanOverride={vi.fn()}/>);
    expect(screen.getByText(/Nothing is on the plan yet/)).toBeInTheDocument();
  });
});

/* Seen on the live Schedule: Adjust opened on an order with no job card and
   showed an empty "Stage by stage" table, a queue position that moved nothing
   and a release date that could be pinned and changed nothing. The plan runs
   job cards, so there was nothing there to overrule — and the panel now says
   so, and says where to go. */
describe("Adjust on an order that is not on the plan",()=>{
  const bare={order_no:"JO2246",unit_key:"JO2246",priority:2,stages:[],override:{seq:null,start_on:null,machine:{},days:{}},
    dispatch_date:null,release_date:null,plan_warnings:[]};
  it("says there is nothing to overrule and where to raise the job card",async()=>{
    const { PlanOverrideEditor } = await import("../../src/App.jsx");
    render(<PlanOverrideEditor order={bare} queue={["JO2246"]} onChange={vi.fn()} onClose={vi.fn()}/>);
    const note=screen.getByRole("note");
    expect(note).toHaveTextContent(/JO2246 is not on the plan yet, so there is nothing here to overrule/);
    expect(note).toHaveTextContent(/Job orders → Create Job Order/);
    expect(screen.queryByText("Stage by stage")).toBeNull();
    expect(screen.queryByRole("button",{name:"Run first"})).toBeNull();
  });
  it("names a pin that is doing nothing and lets it be cleared",async()=>{
    const user=userEvent.setup(), onChange=vi.fn();
    const { PlanOverrideEditor } = await import("../../src/App.jsx");
    render(<PlanOverrideEditor order={{...bare,stock_status:"awaiting",override:{...bare.override,start_on:"2026-10-07"}}}
      queue={[]} onChange={onChange} onClose={vi.fn()}/>);
    expect(screen.getByRole("note")).toHaveTextContent(/A release date of .* is pinned on this order/);
    expect(screen.getByRole("note")).toHaveTextContent(/waiting for its stock decision/);
    await user.click(screen.getByRole("button",{name:/Clear all overrides/}));
    expect(onChange).toHaveBeenCalledWith({});
  });
  it("still opens the full editor for a job that has stages",async()=>{
    const { PlanOverrideEditor } = await import("../../src/App.jsx");
    const { articles, materials, workcenters:wcs, origin } = INPUTS;
    const state=compute([{order_no:"JO1",order_date:"2026-07-06",article_code:ART,priority:2,party:"P",lines:[{combo:"8X10",qty:500}]}],
      articles,materials,wcs,origin,{});
    render(<PlanOverrideEditor order={state.units[0]} queue={["JO1"]} onChange={vi.fn()} onClose={vi.fn()}/>);
    expect(screen.getByText("Stage by stage")).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"Run first"})).toBeInTheDocument();
  });
});
