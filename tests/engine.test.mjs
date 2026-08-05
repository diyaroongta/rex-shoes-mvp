/* Factory OS — engine tests. No dependencies, no database, no network.
   Run:  npm test
   If these pass, the planner is behaving. If test D fails, the scheduler is
   wrong no matter how plausible the dates look. */
import assert from "node:assert/strict";
import { compute } from "../shared/engine.js";
import { INPUTS } from "../shared/inputs.js";

const { articles, materials, workcenters: wcs, origin } = INPUTS;
const run = orders => compute(orders, articles, materials, wcs, origin);

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

console.log("\nB — single order, hand-checkable");
test("dates, SLA and one material rate", () => {
  const s = run([{ order_no:"JO2001", order_date:"2026-07-06", article_code:"SMART BOY (L) BLACK",
                   priority:2, party:"Test", lines:[{ combo:"6X8", qty:960 }] }]);
  const o = s.orders[0];
  assert.equal(o.qty, 960);
  assert.equal(o.dispatch_date, "2026-07-09");
  assert.equal(o.sla, "on_track");
  assert.deepEqual(o.stages.map(x => x.stage),
    ["CUTTING","STITCHING","MOLDING","PACKING","DISPATCH"]);
  assert.deepEqual(o.stages.map(x => x.start_date),
    ["2026-07-06","2026-07-07","2026-07-08","2026-07-09","2026-07-09"]);
  // 0.065037 per pair x 960 pairs = 62.44 MTR
  const m = s.netted.find(r => r.material_key === "REXION 1.5MM FRENZY (HEAVY) BLACK||MTR");
  assert.equal(m.required, 62.44);
  assert.equal(m.shortfall, 0);
  assert.deepEqual(s.schedule_problems, []);
});

console.log("\nC — the molding machine is ONE machine");
test("every sole type queues sequentially on the one molding machine", () => {
  const s = run([
    { order_no:"JO1", order_date:"2026-07-26", article_code:"SMART BOY (L) BLACK", priority:2, party:"A", lines:[{combo:"6X8",  qty:3600}] },
    { order_no:"JO2", order_date:"2026-07-26", article_code:"SILKY BELLY BLACK",   priority:2, party:"B", lines:[{combo:"6X8",  qty:3000}] },
    { order_no:"JO3", order_date:"2026-07-26", article_code:"REX GOLA (V)",        priority:2, party:"C", lines:[{combo:"8X10", qty:4500}] },
    { order_no:"JO4", order_date:"2026-07-26", article_code:"ARMOUR (VELCRO)",     priority:2, party:"D", lines:[{combo:"8X10", qty:3600}] },
  ]);
  const blocks = [];
  for(const o of s.orders)
    for(const st of o.stages)
      if(st.work_center === "MOLDING" && !st.instant) blocks.push([st.start, st.end, o.order_no]);
  blocks.sort((a,b) => a[0] - b[0]);
  // Since the client's catalogue confirmed Armour is EVA (not stuck-on), every
  // article molds — so all four orders contend for the single molding machine.
  assert.equal(blocks.length, 4, "all four articles mold");
  for(let i = 1; i < blocks.length; i++)
    assert.ok(blocks[i][0] > blocks[i-1][1],
      `${blocks[i][2]} overlaps ${blocks[i-1][2]} — molding is one machine`);
  // no article routes to sole sticking any more
  const anyAssembly = s.orders.some(o => o.stages.some(x => x.work_center === "ASSEMBLY_STUCK-ON"));
  assert.equal(anyAssembly, false, "sole sticking is unused now that Armour is EVA");
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

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
