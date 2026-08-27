import assert from "node:assert/strict";
import { buildMisSnapshot } from "../shared/mis.js";

console.log("\nMIS — executive dashboard contracts");

const state = {
  orders: [
    { order_no:"O1", party:"Alpha", article:"SPIKE", order_date:"2026-08-01", dispatch_date:"2026-08-10",
      qty:100, lead_days:10, sla:"on_track", pi:{pi_no:"PI1"}, stages:[{stage:"CUTTING",slip_days:-1,queue_wait_days:0}] },
    { order_no:"O2", party:"Beta", article:"ARMOUR", order_date:"2026-08-05", dispatch_date:"2026-08-25",
      qty:200, lead_days:15, sla:"at_risk", pi:{pi_no:"PI2"}, stages:[{stage:"MOLDING",slip_days:2,queue_wait_days:3}] },
    { order_no:"O3", party:"Gamma", article:"REX GOLA", order_date:"2026-07-20", dispatch_date:"2026-09-02",
      qty:300, lead_days:20, sla:"breach", pi:{pi_no:"PI3"}, stages:[{stage:"PACKING",slip_days:5,queue_wait_days:1}] },
  ],
  machine_load: [
    {work_center:"CUTTING",name:"Cutting",stage:"CUTTING",capacity_per_day:100,avg_util_pct:75,peak_util_pct:100,busy_days:2},
    {work_center:"MOLDING_EVA",name:"EVA molding",stage:"MOLDING",capacity_per_day:200,avg_util_pct:50,peak_util_pct:75,busy_days:2},
  ],
  daily_load: { CUTTING:{1:50,2:100}, MOLDING_EVA:{1:100,2:100} },
};

const dispatches = [
  {order_no:"O1",dispatched:{A:80},dispatched_on:"2026-08-12",closes_order:true,kind:"shortage"},
  {order_no:"O2",dispatched:{A:50},dispatched_on:"2026-07-30",closes_order:false},
  {order_no:"O2",dispatched:{A:150},dispatched_on:"2026-08-20",closes_order:false,kind:"full"},
  {order_no:"O3",dispatched:{A:250},dispatched_on:"2026-07-20",closes_order:true},
];

const mis = buildMisSnapshot(state, dispatches, {today:"2026-08-23"});

assert.equal(mis.total_orders, 3);
assert.equal(mis.total_pairs, 600);
assert.equal(mis.status.on_track.count, 1);
assert.equal(mis.status.at_risk.count, 1);
assert.equal(mis.status.breach.count, 1);
assert.deepEqual([mis.status.breach.from, mis.status.breach.to], ["2026-09-02", "2026-09-02"]);
assert.equal(mis.average_production_days, 15);
assert.equal(mis.capacity_util_pct, 62.5);

assert.equal(mis.ordered_last_30_days, 300);
assert.equal(mis.dispatched_last_30_days, 280);
assert.equal(mis.shortfall_last_30_days, 20);
assert.equal(Math.round(mis.order_vs_dispatch_pct), 93);
assert.equal(Math.round(mis.order_vs_dispatch_pct),93);
assert.equal(Math.round(mis.dispatch_shortage_pct*10)/10,6.7);
assert.equal(mis.shortage_pairs_last_30_days,20);
assert.equal(mis.closed_order_pairs_last_30_days,300);
assert.equal(Math.round(mis.average_dispatch_days*10)/10,8.7);
assert.equal(mis.completed_orders_used_for_dispatch_days,3);
assert.equal(mis.trend.reduce((sum,b)=>sum+b.ordered,0),300);
assert.equal(mis.trend.reduce((sum,b)=>sum+b.dispatched,0),280);

assert.equal(mis.machines[0].work_center,"CUTTING");
assert.equal(mis.machines[0].average_output,75);
assert.equal(mis.machines[1].average_output,100);

const o1=mis.orders.find(o=>o.order_no==="O1");
assert.equal(o1.dispatched,80);
assert.equal(o1.pending,0);
assert.equal(o1.shortage,20);
assert.equal(o1.completion_pct,80);
const o3=mis.orders.find(o=>o.order_no==="O3");
assert.equal(o3.pending,0,"an order closed short must not remain pending");
assert.equal(o3.shortage,50,"the undelivered quantity remains visible as shortage");
assert.equal(o3.bottleneck,"PACKING");

const empty=buildMisSnapshot({orders:[],machine_load:[],daily_load:{}},[],{today:"2026-08-23"});
assert.equal(empty.total_orders,0);
assert.equal(empty.capacity_util_pct,0);
assert.equal(empty.order_vs_dispatch_pct,0);
assert.equal(empty.dispatch_shortage_pct,0);
assert.equal(empty.average_dispatch_days,0);

console.log("  pass  order-health counts and date ranges");
console.log("  pass  30-day order versus dispatch shortfall");
console.log("  pass  planned production days, output and utilisation");
console.log("  pass  pending and closed-short order reconciliation\n");

/* Orders are read with `where active`; dispatch events are not. A dispatch
   against an order that has since been archived must stop contributing pairs,
   or the dashboard reports shipments against work that is no longer in the
   plan — "261 pairs dispatched" with nothing in production. The dispatch
   screen already drops these, so MIS must use the same rule or the two
   screens disagree about the same day. */
const ghost = buildMisSnapshot(
  { orders: [], machine_load: [], daily_load: {} },
  [{ order_no:"JO-ARCHIVED", dispatched:{ "7X10S":261 }, dispatched_on:"2026-08-23" }],
  { today:"2026-08-23" });
assert.equal(ghost.dispatched_last_30_days, 0,
  "a dispatch whose order is no longer live must not be counted");
assert.equal(ghost.total_orders, 0);
assert.equal(ghost.trend.reduce((n,b)=>n+b.dispatched,0), 0, "and must not appear in the trend");

const liveOne = buildMisSnapshot(
  { orders:[{order_no:"JO1",qty:300,lines:[{combo:"A",qty:300}],order_date:"2026-08-20",
             dispatch_date:"2026-09-01",lead_days:10,sla:"on_track",stages:[]}],
    machine_load:[], daily_load:{} },
  [{ order_no:"JO1", dispatched:{ A:120 }, dispatched_on:"2026-08-23" },
   { order_no:"JO-ARCHIVED", dispatched:{ A:261 }, dispatched_on:"2026-08-23" }],
  { today:"2026-08-23" });
assert.equal(liveOne.dispatched_last_30_days, 120, "only the live order's pairs count");
assert.equal(liveOne.orders[0].dispatched, 120);

console.log("  pass  dispatches against archived orders stop counting\n");
