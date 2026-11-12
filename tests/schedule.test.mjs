/* Manual scheduling: the engine proposes, the planner decides.
 *
 * A block the planner drags is LOCKED — `at: {STAGE: date}` in the job's plan
 * override — and every re-plan books it first and flows the rest round it.
 * These lock down the three promises that makes: a locked block never moves,
 * a drop that cannot stand is refused with its reason, and a block bigger than
 * a day's capacity runs over consecutive days with nothing between them on a
 * moulding machine.
 *
 * Run: npm test
 */
import assert from "node:assert/strict";
import { compute, normalizeOverride, hasOverride, fromDay, dayIndex } from "../shared/engine.js";
import { boardRows, boardSpan, checkMove, lockAsIs, unlockStage, cleanOverride, moveEffects,
         machineFits, dropTargets } from "../shared/plan-board.js";
import { can } from "../shared/permissions.js";
import { INPUTS } from "../shared/inputs.js";

const { articles, materials, workcenters: wcs, origin } = INPUTS;
const ctx = { wcs, articles, origin };
const plan = (orders, overrides = {}, opts = {}) => compute(orders, articles, materials, wcs, origin, { overrides, ...opts });

let passed = 0, failed = 0;
function test(name, fn){
  try { fn(); passed++; console.log("  pass  " + name); }
  catch(e){ failed++; console.log("  FAIL  " + name + "\n        " + e.message); }
}

/* Two PVC rotary articles and one EVA, so a moulding machine has something to
   be contended for. Orders with no job cards are scheduled whole here because
   no units are passed in — the same shape the engine tests use. */
const order = (no, article, qty, date = "2026-07-06", combo) => ({ order_no:no, order_date:date, article_code:article,
  priority:2, party:`Party ${no}`, lines:[{ combo:combo || articles[article].combo_order[0], qty }] });
const A = order("JO1", "REX GOLA (V)", 1500);
const B = order("JO2", "SMART BOY (L) BLACK", 1200);
const C = order("JO3", "SMART BOY (L) WHITE", 900);
const E = order("JO4", "JILL", 800);
const stageOf = (state, no, stage) => state.units.find(u => u.unit_key === no).stages.find(s => s.stage === stage);
const later = (iso, n) => fromDay(dayIndex(iso, origin) + n, origin);

console.log("\nA — the override");
test("a lock is part of the override only when something is locked", () => {
  assert.deepEqual(normalizeOverride(null), { seq:null, start_on:null, machine:{}, days:{} });
  assert.deepEqual(normalizeOverride({ at:{ MOLDING:"2026-08-03", CUTTING:"soon" } }).at, { MOLDING:"2026-08-03" });
  assert.equal(hasOverride({ at:{ MOLDING:"2026-08-03" } }), true);
  assert.equal(hasOverride({ at:{} }), false);
  assert.deepEqual(cleanOverride({ seq:null, machine:{}, days:{}, at:{} }), {});
});

console.log("\nB — a locked block never moves");
test("a locked stage starts on the day it was put", () => {
  const auto = stageOf(plan([A]), "JO1", "MOLDING");
  const day = later(auto.start_date, 7);
  const st = stageOf(plan([A], { JO1:{ at:{ MOLDING:day } } }), "JO1", "MOLDING");
  assert.equal(st.start_date, nextOpen(day));
  assert.equal(st.locked, true);
});
test("re-planning with new work added leaves the locked block exactly where it is", () => {
  const auto = stageOf(plan([A]), "JO1", "MOLDING");
  const day = nextOpen(later(auto.start_date, 5));
  const ov = { JO1:{ at:{ MOLDING:day } } };
  const before = stageOf(plan([A], ov), "JO1", "MOLDING");
  /* Three more orders, two of them queued AHEAD of JO1 by priority. */
  const crowd = [A, { ...B, priority:1 }, { ...C, priority:1 }, E];
  const after = stageOf(plan(crowd, ov), "JO1", "MOLDING");
  assert.deepEqual([after.start_date, after.end_date, after.work_center, after.alloc],
                   [before.start_date, before.end_date, before.work_center, before.alloc]);
});
test("unlocked work on the same moulding machine flows round the locked block", () => {
  const ov = { JO1:{ at:{ MOLDING:stageOf(plan([A, B]), "JO2", "MOLDING").start_date } } };
  const state = plan([A, B], ov);
  const a = stageOf(state, "JO1", "MOLDING"), b = stageOf(state, "JO2", "MOLDING");
  assert.equal(a.work_center, b.work_center, "the fixture must put both on one machine");
  assert.ok(b.start > a.end || b.end < a.start, "two articles overlapped on one moulding machine");
  assert.deepEqual(state.schedule_problems, []);
});
test("the stages after a locked block are re-planned behind it", () => {
  const auto = plan([A]);
  const day = nextOpen(later(stageOf(auto, "JO1", "STITCHING").start_date, 6));
  const state = plan([A], { JO1:{ at:{ STITCHING:day } } });
  const names = ["STITCHING", "UPPER_QC", "MOLDING", "PACKING", "DISPATCH"];
  const stages = names.map(s => stageOf(state, "JO1", s));
  for(let i = 1; i < stages.length; i++) assert.ok(stages[i].start > stages[i - 1].end, `${names[i]} ran ahead of ${names[i - 1]}`);
  assert.ok(state.units[0].dispatch_day > auto.units[0].dispatch_day);
});
test("a lock on a Sunday RUNS on that Sunday and is flagged, not moved", () => {
  /* The client: "I should be able to add Sunday to the schedule if I want,
     and the system should let me, but give a warning". It used to slide the
     block to Monday, so a Sunday shift could not be planned on the board. */
  const sunday = "2026-08-02";
  assert.equal(new Date(sunday + "T00:00:00Z").getUTCDay(), 0);
  const state = plan([A], { JO1:{ at:{ PACKING:sunday } } });
  const st = stageOf(state, "JO1", "PACKING");
  assert.equal(st.start_date, sunday);
  assert.ok(state.plan_warnings.some(w => w.kind === "off_day_worked" && w.message.includes(sunday)));
  /* A person asked for it: a warning on the job, never the red banner. */
  assert.ok(!state.schedule_problems.some(p => String(p).includes(sunday)));
  /* Only the asked Sunday opens: a block longer than a day continues on
     Monday, and a following Sunday is still stepped over. */
  const long = plan([A], { JO1:{ at:{ PACKING:sunday }, days:{ PACKING:8 } } });
  const days = Object.keys(stageOf(long, "JO1", "PACKING").alloc || {}).map(Number);
  const sundays = days.filter(d => new Date(fromDay(d, origin) + "T00:00:00Z").getUTCDay() === 0);
  assert.deepEqual(sundays.map(d => fromDay(d, origin)), [sunday]);
});
test("a locked downstream block that became impossible stays put and is flagged, not moved", () => {
  const auto = plan([A]);
  const mould = stageOf(auto, "JO1", "MOLDING");
  /* Moulding locked where it is; then stitching is dragged past it. */
  const ov = { JO1:{ at:{ MOLDING:mould.start_date, STITCHING:nextOpen(later(mould.start_date, 3)) } } };
  const state = plan([A], ov);
  const st = stageOf(state, "JO1", "MOLDING");
  assert.equal(st.start_date, mould.start_date);
  assert.equal(st.precedence_broken, true);
  assert.ok(state.plan_warnings.some(w => w.kind === "precedence_broken"));
  /* A person put it there, so it is a warning on the job — not the red banner. */
  assert.deepEqual(state.schedule_problems, []);
});
test("two locks for different articles on one moulding machine are reported", () => {
  const day = stageOf(plan([A, B]), "JO2", "MOLDING").start_date;
  const state = plan([A, B], { JO1:{ at:{ MOLDING:day } }, JO2:{ at:{ MOLDING:day } } });
  assert.ok(state.plan_warnings.some(w => w.kind === "locked_clash"));
});

console.log("\nC — splitting over consecutive days");
test("a block bigger than a day's capacity runs over consecutive working days", () => {
  const state = plan([A]);
  const st = stageOf(state, "JO1", "MOLDING");
  const cap = wcs[st.work_center].capacity_per_day;
  assert.ok(1500 > cap, "the fixture must exceed one day's capacity");
  const days = Object.keys(st.alloc).map(Number).sort((a, z) => a - z);
  assert.deepEqual(Object.values(st.alloc), [cap, 1500 - cap]);
  assert.equal(days.length, 2);
});
test("no other article sits between the split days on a moulding machine", () => {
  const state = plan([A, B, C]);
  for(const row of boardRows(state, wcs).filter(r => r.exclusive)){
    for(const block of row.blocks){
      const others = row.blocks.filter(o => o.article !== block.article);
      for(const o of others)
        assert.ok(o.start > block.end || o.end < block.start,
          `${o.unit_key} runs inside ${block.unit_key} on ${row.name}`);
    }
  }
});
test("a LOCKED block splits the same way", () => {
  const day = nextOpen(later(stageOf(plan([A]), "JO1", "MOLDING").start_date, 4));
  const st = stageOf(plan([A], { JO1:{ at:{ MOLDING:day } } }), "JO1", "MOLDING");
  const cap = wcs[st.work_center].capacity_per_day;
  assert.deepEqual(Object.values(st.alloc), [cap, 1500 - cap]);
});
test("two locks that overbook a pooled line are allowed and marked amber, not a fault", () => {
  const day = nextOpen(later(stageOf(plan([A, B]), "JO1", "CUTTING").start_date, 10));
  const state = plan([A, B, C], { JO1:{ at:{ CUTTING:day } }, JO2:{ at:{ CUTTING:day } }, JO3:{ at:{ CUTTING:day } } });
  const d = dayIndex(day, origin);
  assert.ok(state.daily_load.CUTTING[d] > wcs.CUTTING.capacity_per_day);
  assert.equal(state.forced_load.CUTTING[d], true);
  assert.deepEqual(state.schedule_problems, []);
  const row = boardRows(state, wcs).find(r => r.work_center === "CUTTING");
  assert.deepEqual(row.over_days.map(o => o.day), [d]);
  assert.equal(row.over_days[0].over, 1500 + 1200 + 900 - wcs.CUTTING.capacity_per_day);
  assert.ok(row.blocks.every(b => b.over));
});

console.log("\nD — what a drop is allowed to do");
test("a drop on the same line writes a lock for that stage", () => {
  const state = plan([A]);
  const day = nextOpen(later(stageOf(state, "JO1", "PACKING").start_date, 3));
  const move = checkMove(state, { unit_key:"JO1", stage:"PACKING", date:day }, ctx);
  assert.equal(move.ok, true);
  assert.deepEqual(move.override, { at:{ PACKING:day } });
  assert.equal(stageOf(plan([A], { JO1:move.override }), "JO1", "PACKING").start_date, day);
});
test("a drop that breaks the stage order is refused, with the reason", () => {
  const state = plan([A]);
  const qc = stageOf(state, "JO1", "UPPER_QC");
  const move = checkMove(state, { unit_key:"JO1", stage:"MOLDING", date:qc.start_date }, ctx);
  assert.equal(move.ok, false);
  assert.match(move.reason, /MOLDING of JO1 cannot start on .*UPPER_QC does not finish until/);
});
test("a drop onto a locked block of another article on a moulding machine is refused, and names it", () => {
  const base = plan([A, B]);
  const b = stageOf(base, "JO2", "MOLDING");
  const state = plan([A, B], { JO2:{ at:{ MOLDING:b.start_date } } });
  const locked = stageOf(state, "JO2", "MOLDING");
  const move = checkMove(state, { unit_key:"JO1", stage:"MOLDING", date:locked.start_date }, ctx);
  if(stageOf(state, "JO1", "UPPER_QC").end >= locked.start) return assert.match(move.reason, /cannot start/);
  assert.equal(move.ok, false);
  assert.equal(move.blocked_by, "JO2");
  assert.match(move.reason, /is locked for JO2 from/);
});
test("a drop onto UNLOCKED work on a moulding machine is allowed — that work is pushed", () => {
  const state = plan([A, B]);
  const a = stageOf(state, "JO1", "MOLDING"), b = stageOf(state, "JO2", "MOLDING");
  const [firstNo, second] = a.start < b.start ? ["JO1", b] : ["JO2", a];
  const secondNo = firstNo === "JO1" ? "JO2" : "JO1";
  const first = firstNo === "JO1" ? a : b;
  /* Put the later job where the earlier one is running. */
  const move = checkMove(state, { unit_key:secondNo, stage:"MOLDING", date:first.start_date }, ctx);
  if(!move.ok) return assert.match(move.reason, /cannot start/);   // its own upper QC is not done by then
  const after = plan([A, B], { [secondNo]:move.override });
  const moved = stageOf(after, secondNo, "MOLDING"), pushed = stageOf(after, firstNo, "MOLDING");
  assert.equal(moved.start_date, first.start_date);
  assert.ok(pushed.start > moved.end, "the unlocked block was not pushed clear");
  assert.deepEqual(after.schedule_problems, []);
  assert.ok(second);
});
test("a PVC article moves between the PVC machines and nowhere else", () => {
  const unit = plan([A]).units[0];
  assert.deepEqual(dropTargets(unit, "MOLDING", wcs, articles).sort(), ["MOLDING_PVC_ROTARY", "MOLDING_PVC_VERTICAL"]);
  assert.equal(machineFits(unit, "MOLDING", "MOLDING_EVA", wcs, articles).ok, false);
  assert.match(machineFits(unit, "MOLDING", "MOLDING_EVA", wcs, articles).reason, /PVC article and cannot run on EVA/);
  assert.match(machineFits(unit, "MOLDING", "CUTTING", wcs, articles).reason, /MOLDING block.*CUTTING line/);
  assert.deepEqual(dropTargets(plan([E]).units[0], "MOLDING", wcs, articles), ["MOLDING_EVA"]);
});
test("a drop on another valid machine pins the machine as well as the day", () => {
  const state = plan([A]);
  const st = stageOf(state, "JO1", "MOLDING");
  const other = st.work_center === "MOLDING_PVC_ROTARY" ? "MOLDING_PVC_VERTICAL" : "MOLDING_PVC_ROTARY";
  const move = checkMove(state, { unit_key:"JO1", stage:"MOLDING", date:st.start_date, work_center:other }, ctx);
  assert.equal(move.ok, true);
  assert.deepEqual(move.override, { machine:{ MOLDING:other }, at:{ MOLDING:st.start_date } });
  assert.equal(stageOf(plan([A], { JO1:move.override }), "JO1", "MOLDING").work_center, other);
  assert.equal(checkMove(state, { unit_key:"JO1", stage:"MOLDING", date:st.start_date, work_center:"MOLDING_EVA" }, ctx).ok, false);
});
test("a drop on a closed day is allowed with a warning", () => {
  const state = plan([A]);
  const out = checkMove(state, { unit_key:"JO1", stage:"PACKING", date:"2026-08-02" }, ctx);
  assert.equal(out.ok, true);
  assert.equal(out.start_date, "2026-08-02");
  assert.match(out.warning, /2026-08-02 is normally a closed day/);
  assert.equal(stageOf(plan([A], { JO1:out.override }), "JO1", "PACKING").start_date, "2026-08-02");
  /* An ordinary working day carries no warning. */
  assert.equal(checkMove(state, { unit_key:"JO1", stage:"PACKING", date:"2026-08-03" }, ctx).warning, undefined);
});
test("a drop for a job that has gone, or on no day, is refused", () => {
  const state = plan([A]);
  assert.match(checkMove(state, { unit_key:"JO9", stage:"PACKING", date:"2026-08-03" }, ctx).reason, /no longer on the plan/);
  assert.match(checkMove(state, { unit_key:"JO1", stage:"ASSEMBLY", date:"2026-08-03" }, ctx).reason, /no ASSEMBLY block/);
  assert.match(checkMove(state, { unit_key:"JO1", stage:"PACKING", date:"" }, ctx).reason, /on a day/);
});

console.log("\nE — lock, unlock, and the knock-on effect");
test("lock as-is freezes a block where the engine put it", () => {
  const state = plan([A]);
  const st = stageOf(state, "JO1", "CUTTING");
  const ov = lockAsIs(state.units[0], "CUTTING");
  assert.deepEqual(ov, { at:{ CUTTING:st.start_date } });
  const again = stageOf(plan([A], { JO1:ov }), "JO1", "CUTTING");
  assert.equal(again.start_date, st.start_date);
  assert.equal(again.locked, true);
});
test("unlock hands the block back to the engine and leaves a set duration alone", () => {
  const state = plan([A], { JO1:{ at:{ MOLDING:"2026-08-10" }, machine:{ MOLDING:"MOLDING_PVC_VERTICAL" }, days:{ CUTTING:2 } } });
  assert.deepEqual(unlockStage(state.units[0], "MOLDING"), { days:{ CUTTING:2 } });
  assert.deepEqual(unlockStage(plan([A], { JO1:{ at:{ MOLDING:"2026-08-10" } } }).units[0], "MOLDING"), {});
});
test("the knock-on effect names every job whose dispatch moved, and any now late", () => {
  const before = plan([A, B]);
  const day = nextOpen(later(stageOf(before, "JO1", "CUTTING").start_date, 30));
  const after = plan([A, B], { JO1:{ at:{ CUTTING:day } } });
  const effects = moveEffects(before, after);
  const mine = effects.find(e => e.unit_key === "JO1");
  assert.ok(mine && mine.moved_days > 0);
  assert.equal(mine.from, before.units.find(u => u.unit_key === "JO1").dispatch_date);
  assert.equal(mine.now_late, true);
  assert.ok(mine.days_late > 0);
  assert.deepEqual(moveEffects(before, before), []);
});
test("the board lists every block under its work centre, in production order", () => {
  const state = plan([A, E]);
  const rows = boardRows(state, wcs);
  assert.equal(rows[0].work_center, "CUTTING");
  assert.equal(rows[rows.length - 1].stage, "DISPATCH");
  const blocks = rows.flatMap(r => r.blocks);
  assert.equal(blocks.filter(b => b.unit_key === "JO1").length, 7);
  assert.equal(blocks.find(b => b.id === "JO1::MOLDING").pairs, 1500);
  const span = boardSpan(rows);
  assert.ok(span.last > span.first);
  assert.equal(boardSpan(boardRows(plan([]), wcs)), null);
});

console.log("\nF — who may edit the schedule");
test("only the production planner and the administrator may change the plan", () => {
  const body = { plan_override:{ at:{ MOLDING:"2026-08-03" } } };
  assert.equal(can("planner", "PATCH", "/api/orders/JO1", body).allowed, true);
  assert.equal(can("admin", "PATCH", "/api/orders/JO1", body).allowed, true);
  for(const role of ["sales", "dispatch", "store", "procurement", "owner", "viewer", "auditor", "data"])
    assert.equal(can(role, "PATCH", "/api/orders/JO1", body).allowed, false, `${role} was allowed to edit the schedule`);
  /* Sales still edits the ORDER — it just cannot carry a schedule change along. */
  assert.equal(can("sales", "PATCH", "/api/orders/JO1", { party:"New name" }).allowed, true);
  assert.equal(can("sales", "PATCH", "/api/orders/JO1", { party:"New name", plan_override:{} }).allowed, false);
});

function nextOpen(iso){
  let d = dayIndex(iso, origin);
  while(new Date(fromDay(d, origin) + "T00:00:00Z").getUTCDay() === 0) d++;
  return fromDay(d, origin);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
