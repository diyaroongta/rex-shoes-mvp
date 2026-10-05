import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import MISDashboard from "../../src/MISDashboard.jsx";

const state={
  orders:[
    {order_no:"O-ON",party:"Alpha",article:"SPIKE",order_date:"2026-08-01",dispatch_date:"2026-08-10",qty:100,lead_days:10,sla:"on_track",pi:{pi_no:"PI-1"},stages:[{stage:"CUTTING",slip_days:0}]},
    {order_no:"O-RISK",party:"Beta",article:"ARMOUR",order_date:"2026-08-05",dispatch_date:"2026-08-25",qty:200,lead_days:15,sla:"at_risk",pi:{pi_no:"PI-2"},stages:[{stage:"MOLDING",slip_days:2}]},
    {order_no:"O-LATE",party:"Gamma",article:"REX GOLA",order_date:"2026-08-08",dispatch_date:"2026-09-02",qty:300,lead_days:20,sla:"breach",pi:{pi_no:"PI-3"},stages:[{stage:"PACKING",slip_days:5}]},
  ],
  machine_load:[{work_center:"CUTTING",name:"Cutting hall",stage:"CUTTING",capacity_per_day:1000,avg_util_pct:75,peak_util_pct:90,busy_days:2}],
  daily_load:{CUTTING:{1:500,2:1000}},
};
const dispatches=[
  {order_no:"O-ON",dispatched:{A:100},dispatched_on:"2026-08-11",closes_order:false,kind:"full"},
  {order_no:"O-RISK",dispatched:{A:150},dispatched_on:"2026-08-20",closes_order:true,kind:"shortage"},
];

describe("Executive MIS dashboard",()=>{
  it("shows management KPIs, dispatch completion and planned machine output",async()=>{
    const user=userEvent.setup();
    const refresh=vi.fn();
    render(<MISDashboard state={state} dispatches={dispatches}
      onRefresh={refresh} today="2026-08-26"/>);
    expect(screen.getByTestId("kpi-total-orders")).toHaveTextContent("3");
    expect(screen.getByTestId("kpi-on-time")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-at-risk")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-delayed")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-production-days")).toHaveTextContent("15");
    expect(screen.getByTestId("kpi-utilisation")).toHaveTextContent("75");
    expect(screen.getByTestId("kpi-order-dispatch-pct")).toHaveTextContent("41.7%");
    expect(screen.getByTestId("kpi-dispatch-shortage-pct")).toHaveTextContent("16.7%");
    expect(screen.getByTestId("kpi-average-dispatch-days")).toHaveTextContent("12.5");
    expect(screen.getByText("Cutting hall")).toBeInTheDocument();
    expect(screen.getByText(/scheduled—not actual/i)).toBeInTheDocument();
    expect(screen.getByRole("img",{name:/six five-day periods/i})).toBeInTheDocument();
    await user.click(screen.getByText("Show MIS calculation logic"));
    expect(screen.getByText(/250 ÷ 600 × 100/)).toBeInTheDocument();
    expect(screen.getByText(/50 ÷ 300 × 100/)).toBeInTheDocument();
    await user.click(screen.getByRole("button",{name:"Refresh live data"}));
    expect(refresh).toHaveBeenCalledOnce();
  });

  /* Planned against achieved must not draw a board of zeros before anyone has
     reported anything — an unfilled sheet is not a stopped factory. */
  it("says nothing has been reported rather than scoring the plan at zero",()=>{
    render(<MISDashboard state={state} dispatches={dispatches} productionActuals={[]} today="2026-08-26"/>);
    expect(screen.getByText("Planned against achieved")).toBeInTheDocument();
    expect(screen.getByText(/No achievement has been reported yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Furthest behind:")).toBeNull();
  });

  it("filters the complete order-health table without changing KPI totals",async()=>{
    const user=userEvent.setup();
    render(<MISDashboard state={state} dispatches={dispatches} today="2026-08-26"/>);
    await user.click(screen.getByRole("button",{name:"Delayed · 1"}));
    expect(screen.getAllByText("O-LATE").length).toBeGreaterThan(0);
    expect(screen.queryByText("O-ON")).not.toBeInTheDocument();
    expect(screen.getByTestId("kpi-total-orders")).toHaveTextContent("3");
  });

  it("shows a PI without a job card as waiting, not on time or delayed",async()=>{
    const user=userEvent.setup();
    const waiting={orders:[{order_no:"JO2171",party:"K.P. Gurgaon",article:"SPIKE",
      order_date:"2026-09-29",dispatch_date:null,qty:0,pending_pairs:288,
      lead_days:null,sla:null,pi:{pi_no:"PI/2171"},stages:[]}],machine_load:[],daily_load:{}};
    render(<MISDashboard state={waiting} dispatches={[]} today="2026-09-29"/>);
    expect(screen.getByTestId("kpi-waiting")).toHaveTextContent("1");
    expect(screen.getByTestId("kpi-on-time")).toHaveTextContent("0");
    await user.click(screen.getByRole("button",{name:"Waiting · 1"}));
    expect(screen.getAllByText("JO2171").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Waiting for job card").length).toBeGreaterThan(0);
  });
});

/* THE BOARD IS READ BY CUSTOMER, because that is who rings up. Search already
   matched a party name, but only if you knew how it was spelled. */
describe("the dashboard answers by customer, and says why",()=>{
  const withReasons={
    ...state,
    orders:[
      state.orders[0],
      /* Beta's order: four days behind the rotary, and a planner pinned it. */
      {...state.orders[1], release_delay_days:2, override:{seq:1},
       stages:[{stage:"MOLDING",work_center:"MOLDING_PVC_ROTARY",slip_days:2,
                queue_wait_days:4,capacity_per_day:1000,duration_days:1}]},
      state.orders[2],
    ],
  };

  it("filters the board to one customer",async()=>{
    const user=userEvent.setup();
    render(<MISDashboard state={withReasons} dispatches={[]} today="2026-08-26"/>);
    expect(screen.getByText("O-ON")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Customer"),"Beta");
    // O-RISK appears in both the attention list and the order table.
    expect(screen.getAllByText("O-RISK").length).toBeGreaterThan(0);
    expect(screen.queryByText("O-ON")).not.toBeInTheDocument();
    // …and the whole board follows the customer, not just the bottom table.
    expect(screen.queryByText("O-LATE")).not.toBeInTheDocument();
  });

  /* "At risk" tells a director what they can already see. The inputs to that
     verdict were computed and thrown away; this puts them back. */
  it("opens an order and gives the reasons, worst first",async()=>{
    const user=userEvent.setup();
    render(<MISDashboard state={withReasons} dispatches={[]} today="2026-08-26"/>);
    // Click the row in the full order table (now the first section), not the attention summary.
    const table=screen.getByText("Complete order health").closest("section");
    await user.click(within(table).getByText("O-RISK"));

    expect(screen.getByText(/Why it sits where it does/)).toBeInTheDocument();
    // The machine queue, named and costed — and by the machine's real name.
    expect(screen.getByText(/waited 4 days for PVC rotary/)).toBeInTheDocument();
    // The planner's own instruction, kept apart from the factory's constraints.
    expect(screen.getByText(/set by hand to position 1/)).toBeInTheDocument();
    // And the release delay.
    expect(screen.getByText(/could not start for 2 days/)).toBeInTheDocument();
  });

  it("says plainly when nothing is holding an order up",async()=>{
    const user=userEvent.setup();
    render(<MISDashboard state={withReasons} dispatches={[]} today="2026-08-26"/>);
    await user.click(screen.getByText("O-ON"));
    expect(screen.getByText(/Nothing is holding this order up/)).toBeInTheDocument();
  });
});
