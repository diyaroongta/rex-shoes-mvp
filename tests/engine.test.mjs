/* Factory OS — engine tests. No dependencies, no database, no network.
   Run:  npm test
   If these pass, the planner is behaving. If test D fails, the scheduler is
   wrong no matter how plausible the dates look. */
import assert from "node:assert/strict";
import { compute, queueOrder, normalizeOverride, hasOverride, extraLeadDays,
         netByOrder, shortfallByPi } from "../shared/engine.js";
import { INPUTS } from "../shared/inputs.js";

const { articles, materials, workcenters: wcs, origin } = INPUTS;
const run = (orders, overrides) => compute(orders, articles, materials, wcs, origin,
  overrides ? { overrides } : {});

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

console.log("\nA — empty input must not throw");
test("empty plan is stable", () => {
  const s = run([]);
  assert.equal(s.totals.orders, 0);
  assert.equal(s.totals.total_pairs, 0);
  assert.equal(s.procurement.length, 0);
  assert.equal(s.totals.last_dispatch, null);
  assert.deepEqual(s.schedule_problems, []);
});
test("in-house preparation is not counted twice as a release buffer", () => {
  const rules={stitching_inhouse_prep_days:1,stitching_outside_transport_days:2,printing_days:1};
  assert.equal(extraLeadDays({stitching:"inhouse",printing:false},rules),0);
  assert.equal(extraLeadDays({stitching:"outside",printing:false},rules),2);
  assert.equal(extraLeadDays({stitching:"inhouse",printing:true},rules),1);
});

console.log("\nB — single order, hand-checkable");
test("dates, SLA and one material rate", () => {
  const s = run([{ order_no:"JO2001", order_date:"2026-07-06", article_code:"SMART BOY (L) BLACK",
                   priority:2, party:"Test", lines:[{ combo:"6X8", qty:960 }] }]);
  const o = s.orders[0];
  assert.equal(o.qty, 960);
  // 7 stages now: PREPARATION and UPPER_QC were added, and DISPATCH is a real
  // stage with capacity rather than an instant marker — so a single order takes
  // 3 days longer end to end than under the old 5-stage model.
  assert.equal(o.dispatch_date, "2026-07-12");
  assert.equal(o.sla, "on_track");
  assert.deepEqual(o.stages.map(x => x.stage),
    ["CUTTING","PREPARATION","STITCHING","UPPER_QC","MOLDING","PACKING","DISPATCH"]);
  assert.deepEqual(o.stages.map(x => x.start_date),
    ["2026-07-06","2026-07-07","2026-07-08","2026-07-09","2026-07-10","2026-07-11","2026-07-12"]);
  // a PVC article with no machine assigned falls back to rotary
  assert.equal(o.stages.find(x => x.stage === "MOLDING").work_center, "MOLDING_PVC_ROTARY");
  // 0.065037 per pair x 960 pairs = 62.44 MTR
  const m = s.netted.find(r => r.material_key === "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR");
  assert.equal(m.required, 62.44);
  assert.equal(m.shortfall, 0);
  assert.deepEqual(s.schedule_problems, []);
});

console.log("\nC — each molding machine is exclusive");
test("sole types route to their own machine, and each machine runs one order at a time", () => {
  const s = run([
    { order_no:"JO1", order_date:"2026-07-26", article_code:"SMART BOY (L) BLACK", priority:2, party:"A", lines:[{combo:"6X8",  qty:3600}] },
    { order_no:"JO2", order_date:"2026-07-26", article_code:"SILKY BELLY BLACK",   priority:2, party:"B", lines:[{combo:"6X8",  qty:3000}] },
    { order_no:"JO3", order_date:"2026-07-26", article_code:"REX GOLA (V)",        priority:2, party:"C", lines:[{combo:"8X10", qty:4500}] },
    { order_no:"JO4", order_date:"2026-07-26", article_code:"ARMOUR (VELCRO)",     priority:2, party:"D", lines:[{combo:"8X10", qty:3600}] },
  ]);
  // Molding is now several machines. PVC orders queue on the PVC machine,
  // EVA orders on the EVA machine — and the two run in PARALLEL with each
  // other, which is the whole point of splitting them.
  const byCentre = {};
  for(const o of s.orders)
    for(const st of o.stages)
      if(st.stage === "MOLDING")
        (byCentre[st.work_center] = byCentre[st.work_center] || []).push([st.start, st.end, o.order_no]);

  assert.ok(Object.keys(byCentre).length >= 2, "orders must reach more than one molding machine");
  for(const [centre, blocks] of Object.entries(byCentre)){
    blocks.sort((a,b) => a[0] - b[0]);
    for(let i = 1; i < blocks.length; i++)
      assert.ok(blocks[i][0] > blocks[i-1][1],
        `${blocks[i][2]} overlaps ${blocks[i-1][2]} on ${centre} — each machine runs one order at a time`);
  }
  // every article passes through the two new stages
  for(const o of s.orders){
    assert.ok(o.stages.some(x => x.stage === "PREPARATION"), `${o.order_no} must be prepared`);
    assert.ok(o.stages.some(x => x.stage === "UPPER_QC"), `${o.order_no} must pass upper QC`);
  }
});

console.log("\nD — contention invariants (the ones that matter)");
test("exclusive machines never overlap, never overbook, never lose pairs", () => {
  const arts = ["SMART BOY (L) BLACK","SILKY BELLY BLACK","REX GOLA (V)","SMART BOY (L) WHITE",
                "SILKY BELLY WHITE","REX GOLA (L)","ARMOUR (VELCRO)","ARMOUR (LACE)"];
  const combo = { "SMART BOY (L) BLACK":"6X8","SMART BOY (L) WHITE":"6X8","SILKY BELLY BLACK":"6X8",
                  "SILKY BELLY WHITE":"6X8","REX GOLA (V)":"8X10","REX GOLA (L)":"8X10",
                  "ARMOUR (VELCRO)":"8X10","ARMOUR (LACE)":"8X10" };
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const orders = [];
  for(let i = 0; i < 14; i++){
    const a = arts[Math.floor(rnd() * arts.length)];
    orders.push({ order_no:"JO" + (3000 + i),
      order_date:["2026-07-26","2026-07-28","2026-08-01"][Math.floor(rnd() * 3)],
      article_code:a, priority:1 + Math.floor(rnd() * 3), party:"P" + i,
      lines:[{ combo:combo[a], qty:600 + Math.floor(rnd() * 20) * 300 }] });
  }
  const s = run(orders);

  for(const [code, wc] of Object.entries(wcs)){
    if(!wc.exclusive) continue;
    const cap = wc.capacity_per_day;
    const blocks = [];
    for(const o of s.orders)
      for(const st of o.stages)
        if(st.work_center === code && !st.instant) blocks.push({ ...st, order_no:o.order_no, qty:o.qty });
    blocks.sort((a,b) => a.start - b.start);

    for(const b of blocks)
      assert.equal(b.end - b.start + 1, Math.ceil(b.qty / cap),
        `${b.order_no}: block length must be ceil(qty/cap)`);
    for(let i = 1; i < blocks.length; i++)
      assert.ok(blocks[i].start > blocks[i-1].end,
        `${blocks[i].order_no} overlaps ${blocks[i-1].order_no} on ${code}`);

    const load = s.daily_load[code] || {};
    for(const [d, v] of Object.entries(load))
      assert.ok(v <= cap + 1e-6, `${code} day ${d} overbooked: ${v} > ${cap}`);

    const routed = s.orders.filter(o => o.stages.some(x => x.work_center === code))
                           .reduce((a,o) => a + o.qty, 0);
    const booked = Object.values(load).reduce((a,b) => a + b, 0);
    assert.ok(Math.abs(routed - booked) < 1e-6, `${code}: ${routed} pairs routed but ${booked} booked`);

    // priority order is respected on the contended machine
    const prio = blocks.map(b => s.orders.find(o => o.order_no === b.order_no).priority);
    for(let i = 1; i < prio.length; i++)
      assert.ok(prio[i] >= prio[i-1], "a lower-priority order took the machine first");
  }
  assert.deepEqual(s.schedule_problems, []);
});

console.log("\nE — write-time guard: unknown combos consume capacity but no material");
test("an unknown combo is visible, not silent", () => {
  const s = run([{ order_no:"JO9", order_date:"2026-07-06", article_code:"REX GOLA (V)",
                   priority:2, party:"X", lines:[{ combo:"NOT-A-COMBO", qty:1200 }] }]);
  const o = s.orders[0];
  assert.deepEqual(o.unknown_combos, ["NOT-A-COMBO"]);
  assert.equal(o.qty, 1200, "capacity is still consumed");
  assert.equal(s.procurement.length, 0, "but no material is ordered — hence the API rejects these");
});

console.log("\nF — manual planning overrides: obeyed, then accounted for");

/* Two identical orders, so nothing but the override can separate them. */
const pair = () => ([
  { order_no:"JOA", order_date:"2026-07-06", article_code:"REX GOLA (V)", priority:2, party:"A",
    lines:[{ combo:"11X13", qty:1800 }] },
  { order_no:"JOB", order_date:"2026-07-06", article_code:"REX GOLA (V)", priority:2, party:"B",
    lines:[{ combo:"1X3", qty:1800 }] },
]);

test("with no override the plan is exactly what it was", () => {
  assert.deepEqual(run(pair()).orders.map(o=>o.order_no+o.dispatch_date),
                   run(pair(), {}).orders.map(o=>o.order_no+o.dispatch_date),
                   "an empty override map must not change a single date");
});

test("a pinned queue position outranks priority and date", () => {
  const auto = queueOrder(pair(), {});
  assert.deepEqual(auto.map(o=>o.order_no), ["JOA","JOB"]);
  assert.deepEqual(queueOrder(pair(), {JOB:{seq:1}}).map(o=>o.order_no), ["JOB","JOA"],
    "seq 1 means run this one first");
  // A higher priority still loses to an explicit position — that is the point
  // of an override.
  const p1 = pair(); p1[0].priority = 1;
  assert.deepEqual(queueOrder(p1, {JOB:{seq:1}}).map(o=>o.order_no), ["JOB","JOA"]);
});

test("seq is a position, not a score — 2 means second", () => {
  const three = [...pair(), { order_no:"JOC", order_date:"2026-07-06", article_code:"REX GOLA (V)",
    priority:2, party:"C", lines:[{ combo:"4X5", qty:600 }] }];
  assert.deepEqual(queueOrder(three, {JOC:{seq:2}}).map(o=>o.order_no), ["JOA","JOC","JOB"]);
});

test("a pinned start date moves the order, in both directions", () => {
  const late = run(pair(), {JOA:{start_on:"2026-07-20"}}).orders.find(o=>o.order_no==="JOA");
  assert.equal(late.release_date, "2026-07-20");
  // Pulling an order in FRONT of its own order date is allowed, and reported.
  const early = run(pair(), {JOA:{start_on:"2026-07-01"}}).orders.find(o=>o.order_no==="JOA");
  assert.equal(early.release_date, "2026-07-01");
  assert.ok(early.plan_warnings.some(w=>w.kind==="starts_before_order_date"),
    "starting before the order's own date must be said out loud");
});

test("a forced duration is carried out even when capacity cannot support it", () => {
  const big = [{ order_no:"JOA", order_date:"2026-07-06", article_code:"REX GOLA (V)",
                 priority:2, party:"A", lines:[{ combo:"11X13", qty:9000 }] }];
  const auto = run(big).orders[0].stages.find(s=>s.stage==="CUTTING");
  assert.ok(auto.duration_days > 1, "this order genuinely needs more than a day of cutting");

  const forced = run(big, {JOA:{days:{CUTTING:1}}});
  const cut = forced.orders[0].stages.find(s=>s.stage==="CUTTING");
  assert.equal(cut.duration_days, 1, "one day was asked for and one day was given");
  assert.equal(cut.alloc[cut.start], 9000, "the whole order is booked into that day");

  const warn = forced.plan_warnings.find(w=>w.kind==="over_capacity");
  assert.ok(warn, "an instruction capacity cannot meet must come back as a warning");
  assert.ok(warn.message.includes("9000 pairs a day"), warn.message);

  /* AND IT IS NOT ALSO A FAULT. An overbooked day that was ordered is a
     decision; reporting it in schedule_problems as well lit the red banner on
     every deliberate override. */
  assert.deepEqual(forced.schedule_problems, [],
    "a day overbooked on purpose is a warning, never a schedule problem");
  // A day overbooked by accident is still a fault.
  assert.ok(forced.forced_load.CUTTING[cut.start], "the forced cell is recorded");
});

test("a stage can be pinned to a named machine", () => {
  const one = [{ order_no:"JOA", order_date:"2026-07-06", article_code:"REX GOLA (V)",
                 priority:2, party:"A", lines:[{ combo:"11X13", qty:600 }] }];
  const auto = run(one).orders[0].stages.find(s=>s.stage==="MOLDING");
  assert.equal(auto.work_center, "MOLDING_PVC_ROTARY");
  const moved = run(one, {JOA:{machine:{MOLDING:"MOLDING_PVC_VERTICAL"}}});
  const st = moved.orders[0].stages.find(s=>s.stage==="MOLDING");
  assert.equal(st.work_center, "MOLDING_PVC_VERTICAL");
  assert.ok(moved.plan_warnings.some(w=>w.kind==="machine_forced"));
  // The load follows the override, or the machine-load screen would lie.
  assert.ok(Object.keys(moved.daily_load.MOLDING_PVC_VERTICAL||{}).length>0);
});

test("a machine that does not exist falls back and says so", () => {
  const one = [{ order_no:"JOA", order_date:"2026-07-06", article_code:"REX GOLA (V)",
                 priority:2, party:"A", lines:[{ combo:"11X13", qty:600 }] }];
  const r = run(one, {JOA:{machine:{MOLDING:"NO_SUCH_MACHINE"}}});
  const st = r.orders[0].stages.find(s=>s.stage==="MOLDING");
  assert.equal(st.work_center, "MOLDING_PVC_ROTARY", "the plan must still be buildable");
  assert.ok(r.plan_warnings.some(w=>w.kind==="unknown_machine"));
});

test("rubbish in an override is dropped, not obeyed", () => {
  assert.deepEqual(normalizeOverride(null), {seq:null,start_on:null,machine:{},days:{}});
  assert.deepEqual(normalizeOverride({seq:0,start_on:"soon",days:{CUTTING:0},machine:{CUTTING:"  "}}),
    {seq:null,start_on:null,machine:{},days:{}},
    "a zero-day run, a position of 0 and an unparseable date are not instructions");
  assert.equal(normalizeOverride({seq:"3"}).seq, 3);
  assert.equal(hasOverride({}), false);
  assert.equal(hasOverride({seq:1}), true);
});

test("procurement and SLA follow the overridden plan, not the automatic one", () => {
  const orders = pair();
  const moved = run(orders, {JOB:{seq:1}});
  // The same pairs are still ordered — resequencing moves work, never creates it.
  assert.equal(moved.totals.total_pairs, run(orders).totals.total_pairs);
  assert.deepEqual(moved.procurement.map(m=>m.material_key).sort(),
                   run(orders).procurement.map(m=>m.material_key).sort());
  // …but the dates did move, and the SLA is evaluated on the moved dates.
  const before = run(orders).orders.find(o=>o.order_no==="JOB").dispatch_day;
  assert.ok(moved.orders.find(o=>o.order_no==="JOB").dispatch_day <= before,
    "an order pinned to the front cannot dispatch later than it did behind");
});

console.log("\nG — shortfall attributed to the PI that will actually feel it");

/* Two identical orders and enough stock for roughly one. The shortfall belongs
   to whichever runs SECOND — that is the one that finds the cupboard empty. */
const twoPis = () => ([
  { order_no:"JO1", order_date:"2026-07-06", article_code:"REX GOLA (V)", priority:2, party:"A",
    pi:{pi_no:"PI-1"}, lines:[{ combo:"11X13", qty:3000 }] },
  { order_no:"JO2", order_date:"2026-07-07", article_code:"REX GOLA (V)", priority:2, party:"B",
    pi:{pi_no:"PI-2"}, lines:[{ combo:"11X13", qty:3000 }] },
]);

test("stock is counted out in queue order, not divided up", () => {
  const s = run(twoPis());
  const first = s.procurement_by_pi["PI-1"], second = s.procurement_by_pi["PI-2"];
  assert.ok(first && second);
  assert.ok(second.short_count >= first.short_count,
    "the order behind carries at least as much shortfall as the one in front");
  // Every material's covered+short must equal what it required, or pairs of
  // material have gone missing in the attribution.
  for(const g of [first, second])
    for(const m of g.materials)
      assert.ok(Math.abs((m.covered + m.shortfall) - m.required) < 0.02,
        `${g.pi_no} ${m.name}: ${m.covered} + ${m.shortfall} != ${m.required}`);
});

test("re-sequencing the queue moves the shortfall with it", () => {
  const before = run(twoPis()).procurement_by_pi;
  const after  = run(twoPis(), {JO2:{seq:1}}).procurement_by_pi;
  assert.deepEqual(after["PI-2"].short_count, before["PI-1"].short_count,
    "PI-2 pinned to the front now carries what PI-1 used to");
  assert.deepEqual(after["PI-1"].short_count, before["PI-2"].short_count);
});

test("per-order requirement still sums to the factory-wide netting", () => {
  const orders = twoPis();
  const s = run(orders);
  const perOrder = {};
  for(const row of Object.values(s.procurement_by_order))
    for(const m of row.materials) perOrder[m.material_key] = (perOrder[m.material_key]||0) + m.required;
  for(const n of s.netted){
    if(!(perOrder[n.material_key] > 0)) continue;
    assert.ok(Math.abs(perOrder[n.material_key] - n.required) < 0.02,
      `${n.name}: per-order total ${perOrder[n.material_key]} != factory total ${n.required}`);
  }
});

test("an order with everything in stock reports that it can run", () => {
  const tiny = [{ order_no:"JO1", order_date:"2026-07-06", article_code:"REX GOLA (V)",
                  priority:2, party:"A", pi:{pi_no:"PI-9"}, lines:[{ combo:"11X13", qty:18 }] }];
  const g = run(tiny).procurement_by_pi["PI-9"];
  assert.equal(g.can_run, true);
  assert.equal(g.short_count, 0);
});

test("orders with no PI number are grouped, never dropped", () => {
  const loose = [{ order_no:"JO1", order_date:"2026-07-06", article_code:"REX GOLA (V)",
                   priority:2, party:"A", pi:{}, lines:[{ combo:"11X13", qty:18 }] }];
  const groups = shortfallByPi(netByOrder(loose, articles, materials, ["JO1"]));
  assert.deepEqual(groups[""].orders, ["JO1"], "unfiled work eats the same stock");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
