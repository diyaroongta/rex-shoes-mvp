import React from "react";
import { render, screen } from "@testing-library/react";
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
    render(<MISDashboard state={state} dispatches={dispatches} onRefresh={refresh} today="2026-08-26"/>);
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

  it("filters the complete order-health table without changing KPI totals",async()=>{
    const user=userEvent.setup();
    render(<MISDashboard state={state} dispatches={dispatches} today="2026-08-26"/>);
    await user.click(screen.getByRole("button",{name:"Delayed · 1"}));
    expect(screen.getAllByText("O-LATE").length).toBeGreaterThan(0);
    expect(screen.queryByText("O-ON")).not.toBeInTheDocument();
    expect(screen.getByTestId("kpi-total-orders")).toHaveTextContent("3");
  });
});
