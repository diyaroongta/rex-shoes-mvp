import assert from "node:assert/strict";
import { floorToday } from "../shared/floor-today.js";

let checks = 0;
const ok = (label, fn) => { fn(); checks++; console.log("  ok  " + label); };
console.log("\nshared/floor-today.js — what each machine is making today");

const origin = "2026-09-01";                      // day 0
const workcenters = {
  CUT1:  { name:"Cutting 1",   stage:"CUTTING", capacity_per_day:1000 },
  ROT1:  { name:"PVC Rotary",  stage:"MOLDING", capacity_per_day:2500 },
  PACK1: { name:"Packing",     stage:"PACKING", capacity_per_day:0 },   // capacity unknown
  _lead_time_rules: {},                                                 // not a machine
};
/* Day 7 is 2026-09-08. JO1 is molding today; JO2 is inside its molding window
   but books no pairs, because JO1 has the machine — each molding machine takes
   one order at a time. */
const units = [
  { unit_key:"JO1", order_no:"JO1", article:"SPIKE", party:"Bansal", qty:2000, priority:2,
    stages:[ { stage:"CUTTING", work_center:"CUT1", start:2, end:3, alloc:{2:1000,3:1000} },
             { stage:"MOLDING", work_center:"ROT1", start:6, end:8, alloc:{6:800,7:800,8:400} } ] },
  { unit_key:"JO2", order_no:"JO2", article:"JILL", party:"Dhanani", qty:900, priority:2,
    stages:[ { stage:"MOLDING", work_center:"ROT1", start:7, end:9, alloc:{9:900} } ] },
  { unit_key:"JO3", order_no:"JO3", article:"ARMOUR", party:"Paras", qty:500, priority:1,
    stages:[ { stage:"CUTTING", work_center:"CUT1", start:7, end:7, alloc:{7:500} } ] },
];
const queue = ["JO3","JO1","JO2"];
const today = "2026-09-08";
const board = floorToday({ units, workcenters, queue, today, origin });
const centre = code => board.centres.find(c => c.code === code);

ok("lists the real machines in route order, and nothing else", () => {
  assert.deepEqual(board.centres.map(c => c.code), ["CUT1","ROT1","PACK1"]);
  assert.ok(!board.centres.some(c => c.code.startsWith("_")), "_lead_time_rules is not a machine");
});

ok("names what each machine is making today, and for whom", () => {
  const cut = centre("CUT1");
  assert.equal(cut.running.length, 1);
  assert.equal(cut.running[0].order_no, "JO3");
  assert.equal(cut.running[0].party, "Paras");
  assert.equal(cut.running[0].pairs_today, 500);
});

/* THE DISTINCTION THE OLD BOARD LOST. A stage inside its own window that books
   no pairs today is QUEUING for the machine, not running on it — and the two
   were drawn identically. */
ok("separates what is running from what is only waiting for the machine", () => {
  const rot = centre("ROT1");
  assert.deepEqual(rot.running.map(r => [r.order_no, r.waiting]), [["JO1",false],["JO2",true]]);
  assert.equal(rot.running[0].pairs_today, 800);
  assert.equal(rot.running[1].pairs_today, 0);
  assert.equal(board.busy, 2, "two machines are actually making something");
});

ok("says how far through the job is, from what it already put through", () => {
  const jo1 = centre("ROT1").running[0];
  assert.equal(jo1.done_before, 800, "day 6 put 800 through");
  assert.equal(jo1.pct_through, 80, "(800 + 800) of 2,000");
});

/* THE POINT OF THE SCREEN: why THIS order and not another. */
ok("gives a reason a planner can act on", () => {
  assert.equal(centre("CUT1").running[0].reason.kind, "urgent");
  assert.match(centre("CUT1").running[0].reason.text, /urgent \(P1\)/);
  assert.equal(centre("ROT1").running[0].reason.kind, "queue");
  assert.match(centre("ROT1").running[0].reason.text, /position 2 of 3/);
});

ok("a hand-planned job says so, ahead of any other reason", () => {
  const pinned = [{ ...units[0], override:{ start_on:"2026-09-06" }, overridden:true }];
  const one = floorToday({ units:pinned, workcenters, queue:["JO1"], today, origin });
  const r = one.centres.find(c => c.code === "ROT1").running[0];
  assert.equal(r.reason.kind, "manual");
  assert.match(r.reason.text, /pinned to 2026-09-06/);
});

ok("an idle machine says what is coming and when", () => {
  const pack = centre("PACK1");
  assert.equal(pack.idle, true);
  assert.equal(pack.next, null, "nothing is routed to packing in this fixture");
  const quietDay = floorToday({ units, workcenters, queue, today:"2026-09-06", origin })
    .centres.find(c => c.code === "CUT1");
  assert.equal(quietDay.idle, true, "nothing is cutting on day 5");
  assert.equal(quietDay.next.order_no, "JO3");
  assert.equal(quietDay.next.days_away, 2, "JO3 cuts on day 7, two days later");
});

/* An unknown capacity is not 0%. Most centres still carry placeholder
   capacities, and a made-up utilisation reads as a measurement. */
ok("utilisation is null when the capacity is not known", () => {
  assert.equal(centre("PACK1").capacity_per_day, null);
  assert.equal(centre("PACK1").util_pct, null);
  assert.equal(centre("CUT1").util_pct, 50, "500 of 1,000");
  assert.equal(centre("CUT1").over_capacity, false);
});

ok("a day booked past capacity is flagged", () => {
  const over = floorToday({ units:[{ unit_key:"X", order_no:"X", article:"A", qty:99, priority:2,
    stages:[{ stage:"CUTTING", work_center:"CUT1", start:7, end:7, alloc:{7:1400} }] }],
    workcenters, queue:["X"], today, origin });
  const cut = over.centres.find(c => c.code === "CUT1");
  assert.equal(cut.over_capacity, true);
  assert.equal(cut.util_pct, 140);
});

ok("an empty factory answers, rather than throwing", () => {
  const none = floorToday({ units:[], workcenters, queue:[], today, origin });
  assert.equal(none.pairs_today, 0);
  assert.equal(none.idle, 3);
  assert.equal(none.busy, 0);
});

console.log(`\n${checks} checks passed`);
