import assert from "node:assert/strict";
import { delayReasons } from "../shared/delay-reasons.js";

let checks = 0;
const ok = (label, fn) => { fn(); checks++; console.log("  ok  " + label); };
console.log("\nshared/delay-reasons.js — why an order is late");

const WC = { CUT1:{ name:"Cutting hall" }, ROT1:{ name:"PVC rotary" } };
const base = {
  order_no:"JO2112", party:"Jyoti The School Mall", article:"REX GOLA (L)", qty:5000,
  order_date:"2026-09-01", release_date:"2026-09-01", dispatch_date:"2026-10-06",
  lead_days:35, sla:"breach", release_delay_days:0, stages:[],
};
const kinds = out => out.reasons.map(r => r.kind);

ok("a machine queue is reported with the days it cost and the machine's name", () => {
  const out = delayReasons({ ...base, stages:[
    { stage:"CUTTING", work_center:"CUT1", queue_wait_days:4, capacity_per_day:2500, duration_days:1 },
  ]}, { workcenters:WC });
  assert.deepEqual(kinds(out), ["queue"]);
  assert.equal(out.reasons[0].days, 4);
  assert.match(out.reasons[0].text, /waited 4 days for Cutting hall/);
  assert.match(out.reasons[0].text, /work ahead of it in the queue/);
});

ok("worst first, so the director triages by days", () => {
  const out = delayReasons({ ...base, release_delay_days:2, stages:[
    { stage:"CUTTING", work_center:"CUT1", queue_wait_days:9, capacity_per_day:2500, duration_days:1 },
    { stage:"MOLDING", work_center:"ROT1", queue_wait_days:1, capacity_per_day:1000, duration_days:5 },
  ]}, { workcenters:WC });
  assert.deepEqual(out.reasons.map(r => r.days), [9,5,2,1]);
});

/* Most work centres still carry PLACEHOLDER capacities. An invented rate
   printed as a cause reads as a measurement, so it is simply not claimed. */
ok("no capacity on file produces no capacity reason, not a made-up one", () => {
  const out = delayReasons({ ...base, stages:[
    { stage:"PACKING", work_center:"PACK1", queue_wait_days:0, capacity_per_day:0, duration_days:6 },
  ]}, { workcenters:WC });
  assert.deepEqual(kinds(out), [], "six days long and it says nothing rather than guessing why");
});

ok("a one-day stage is not reported as taking time", () => {
  const out = delayReasons({ ...base, stages:[
    { stage:"CUTTING", work_center:"CUT1", queue_wait_days:0, capacity_per_day:2500, duration_days:1 },
  ]}, { workcenters:WC });
  assert.deepEqual(kinds(out), []);
});

/* A decision and a constraint are different things, and the board must not
   read a planner's instruction as the factory failing. */
ok("an order moved by hand says so, in the planner's own terms", () => {
  const out = delayReasons({ ...base,
    override:{ seq:1, start_on:"2026-09-10", machine:{ MOLDING:"ROT1" }, days:{ CUTTING:1 } },
    stages:[] }, { workcenters:WC });
  assert.equal(kinds(out).every(k => k === "planned_by_hand"), true);
  assert.equal(out.reasons.length, 4);
  assert.ok(out.reasons.some(r => /pinned by hand to 2026-09-10/.test(r.text)));
  assert.ok(out.reasons.some(r => /place in the queue was set by hand to position 1/.test(r.text)));
  assert.ok(out.reasons.some(r => /MOLDING was pinned by hand to ROT1/.test(r.text)));
  assert.ok(out.reasons.some(r => /finish in 1 day/.test(r.text)));
});

/* Not the factory's fault, and it must be said first. */
ok("a missing BOM leads, because nothing is being bought for it", () => {
  const out = delayReasons({ ...base, bom_missing:true, stages:[
    { stage:"CUTTING", work_center:"CUT1", queue_wait_days:2, capacity_per_day:2500, duration_days:1 },
  ]}, { workcenters:WC });
  assert.equal(out.reasons[0].kind, "data");
  assert.match(out.reasons[0].text, /no BOM rates/);
});

ok("outside stitching reports the transit leg as elapsed time", () => {
  const out = delayReasons({ ...base, stages:[
    { stage:"TRANSIT_IN", work_center:null, transit:true, duration_days:3, queue_wait_days:0 },
  ]}, { workcenters:WC });
  assert.deepEqual(kinds(out), ["transit"]);
  assert.match(out.reasons[0].text, /stitched outside/);
});

ok("an order with nothing wrong has no reasons, and says so by being empty", () => {
  const out = delayReasons({ ...base, sla:"on_track", stages:[
    { stage:"CUTTING", work_center:"CUT1", queue_wait_days:0, capacity_per_day:2500, duration_days:1 },
  ]}, { workcenters:WC });
  assert.deepEqual(out.reasons, []);
  assert.equal(out.status, "on_track");
});

ok("no order at all answers rather than throwing", () => {
  const out = delayReasons(null);
  assert.deepEqual(out.reasons, []);
  assert.equal(out.status, "unknown");
});

console.log(`\n${checks} checks passed`);
